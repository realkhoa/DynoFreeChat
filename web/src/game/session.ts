/**
 * @file session.ts
 * @brief Manages the online multiplayer session for Tic-Tac-Toe over ephemeral game frames.
 * @details Game traffic no longer travels as chat messages. Moves are relayed by the room
 * worker on the `game` channel, which is not persisted, does not enter chat history, and
 * has its own token bucket, so a game can never be throttled by chat limits.
 */

import { roomSlugFromCode } from "./tictactoe";
import {
  decodeGameMessage,
  encodeGameMessage,
  type GameMessage,
  type GameSnapshot,
  type HelloMessage,
  type MoveMessage,
} from "./protocol";
import type { PlayerMark } from "./tictactoe";
import { ChatSocket, type SocketState } from "../net/socket";
import { roomSocketUrl } from "../env";
import type { Identity } from "../lib/identity";

/**
 * @brief Configuration handlers and dependencies for an online multiplayer game session.
 */
export interface OnlineGameSessionOptions {
  /** Room code (e.g. "9B2X") */
  roomCode: string;
  /** True if creating the room, false if joining an existing one */
  asHost: boolean;
  /** WebSocket server base URL */
  wsUrl: string;
  /** REST API base URL */
  apiBase: string;
  /** Current user identity */
  identity: Identity;
  /** Optional function to register the room on first creation */
  createRoomImpl?: (apiBase: string, body: { slug: string; pass?: string }) => Promise<{ ok: boolean; code?: string }>;
  /** Initial role; may be revised by the handshake */
  role: PlayerMark;
  /** Stable id for this session, used to break role ties deterministically */
  clientId: string;
  /** Callback on status/connection text change */
  onStatusText: (text: string) => void;
  /** Callback on connection state change */
  onConnectedChange: (connected: boolean) => void;
  /** Callback with the number of sockets currently in the room, including ours */
  onPeerCount: (online: number) => void;
  /** Callback on the peer's opening handshake */
  onHello: (message: HelloMessage) => void;
  /** Callback on authoritative state from the host */
  onState: (snapshot: GameSnapshot) => void;
  /** Callback on a peer move */
  onMove: (message: MoveMessage) => void;
  /** Callback on a rematch request */
  onRematch: (starter: PlayerMark) => void;
  /** Callback when the peer asks for the authoritative state */
  onResyncRequest: () => void;
  /** Optional WebSocket factory, injected by tests */
  socketFactory?: (url: string) => WebSocket;
}

/**
 * @brief Turns a room-creation failure into a sentence the player can act on.
 * @param roomCode The code the host tried to register.
 * @param code Failure code from the registry API.
 * @return Human readable status line.
 */
export function createFailureText(roomCode: string, code: string | undefined): string {
  switch (code) {
    case "TRY_LATER":
      return `Máy chủ đang giới hạn tạo phòng. Thử lại sau vài phút, hoặc vào phòng có sẵn bằng mã.`;
    case "TOO_MANY_ROOMS":
      return `Lobby đã đủ phòng, không tạo thêm được. Hãy vào phòng có sẵn bằng mã.`;
    case "BAD_SLUG":
      return `Mã phòng [${roomCode}] không hợp lệ.`;
    case "NETWORK":
      return `Không gọi được máy chủ để tạo phòng [${roomCode}]. Kiểm tra kết nối mạng.`;
    default:
      return `Không tạo được phòng [${roomCode}]${code === undefined ? "" : ` (${code})`}. Thử lại sau.`;
  }
}

/**
 * @brief Owns the WebSocket for one online game and translates frames into game messages.
 */
export class OnlineGameSession {
  private socket: ChatSocket | null = null;
  private readonly options: OnlineGameSessionOptions;
  private isClosed = false;
  private role: PlayerMark;
  /** True once the handshake was re-announced for the peer that is now present. */
  private announcedPeer = false;

  /**
   * @brief Initializes a new OnlineGameSession.
   * @param options Dependency options and callbacks.
   */
  constructor(options: OnlineGameSessionOptions) {
    this.options = options;
    this.role = options.role;
  }

  /**
   * @brief Updates the local role after the handshake settled a tie.
   * @param role The role this client now plays.
   */
  setRole(role: PlayerMark): void {
    this.role = role;
  }

  /**
   * @brief The role this client currently plays.
   * @return "X" or "O".
   */
  getRole(): PlayerMark {
    return this.role;
  }

  /**
   * @brief Creates the room when hosting, then connects and performs the handshake.
   */
  async connect(): Promise<void> {
    const slug = roomSlugFromCode(this.options.roomCode);

    // Only the creator registers the room. A joiner that silently created the
    // room would turn a typo in the code into a room that nobody else can see.
    if (this.options.asHost && this.options.createRoomImpl !== undefined) {
      let created: { ok: boolean; code?: string };
      try {
        created = await this.options.createRoomImpl(this.options.apiBase, { slug });
      } catch {
        created = { ok: false, code: "NETWORK" };
      }

      // PROCEED on success and on ROOM_EXISTS (the code is taken but usable);
      // anything else means the room does not exist, so joining would only earn
      // a fatal 4403 and leave the player looking at a locked board.
      if (!created.ok && created.code !== "ROOM_EXISTS") {
        this.options.onConnectedChange(false);
        this.options.onPeerCount(0);
        this.options.onStatusText(createFailureText(this.options.roomCode, created.code));
        return;
      }
    }

    if (this.isClosed) return;

    const sock = new ChatSocket({
      url: roomSocketUrl(this.options.wsUrl, slug),
      ...(this.options.socketFactory === undefined ? {} : { factory: this.options.socketFactory }),
    });
    this.socket = sock;

    sock.onState((state: SocketState) => {
      this.options.onConnectedChange(state === "open");
      if (state === "open") {
        // Authenticate the socket first; `welcome` is what releases the handshake.
        sock.send({ t: "join", nick: this.options.identity.nick, color: this.options.identity.color });
      } else if (state === "connecting" || state === "reconnecting") {
        this.options.onStatusText(`Đang kết nối phòng [${this.options.roomCode}]...`);
      } else if (state === "closed") {
        this.options.onPeerCount(0);
        this.options.onStatusText(`Đã rời phòng [${this.options.roomCode}]`);
      }
    });

    sock.onFrame((frame) => {
      switch (frame.t) {
        case "welcome":
          // `welcome` proves the join was accepted, so the handshake can go out.
          this.announcePeer(frame.online);
          this.sendHello();
          this.options.onPeerCount(frame.online);
          this.options.onStatusText(
            frame.online >= 2
              ? "Đối thủ đã có trong phòng!"
              : `Mã phòng: ${this.options.roomCode} - Chia sẻ mã để bạn bè vào chơi!`,
          );
          break;

        case "presence":
          this.options.onPeerCount(frame.online);
          // Whoever arrived first said hello to an empty room, so the frame was
          // lost. Re-announce when the peer shows up or the roles never settle.
          if (this.announcePeer(frame.online)) this.sendHello();
          break;

        case "game":
          this.handlePayload(frame.data);
          break;

        case "error":
          if (frame.code === "ROOM_NOT_FOUND" || frame.code === "BAD_PASS") {
            this.options.onStatusText(
              frame.code === "ROOM_NOT_FOUND"
                ? `Không tìm thấy phòng [${this.options.roomCode}]. Kiểm tra lại mã.`
                : "Phòng này có mật khẩu, không vào được.",
            );
          }
          break;
      }
    });

    sock.connect();
  }

  /**
   * @brief Sends the opening handshake, carrying the role this client now plays.
   * @return True when the frame reached the socket.
   */
  sendHello(): boolean {
    return this.send({
      k: "hello",
      clientId: this.options.clientId,
      role: this.role,
      nick: this.options.identity.nick,
    });
  }

  /**
   * @brief Records whether a peer is present and answers whether this is the
   * first observation of that state, which is when the handshake must repeat.
   * @param online Number of sockets in the room, including ours.
   * @return True exactly once per peer arrival.
   */
  private announcePeer(online: number): boolean {
    const peerPresent = online >= 2;
    if (!peerPresent) {
      this.announcedPeer = false;
      return false;
    }
    if (this.announcedPeer) return false;
    this.announcedPeer = true;
    return true;
  }

  /**
   * @brief Sends one game message to the other peers in the room.
   * @param message Message to relay.
   * @return True when the frame reached the socket.
   */
  send(message: GameMessage): boolean {
    if (this.socket === null) return false;
    return this.socket.send({ t: "game", data: encodeGameMessage(message) });
  }

  /**
   * @brief Closes the WebSocket session.
   */
  close(): void {
    this.isClosed = true;
    if (this.socket !== null) {
      this.socket.close("session closed");
      this.socket = null;
    }
    this.options.onConnectedChange(false);
  }

  /**
   * @brief Decodes and dispatches one `game` frame payload.
   * @param data Raw payload relayed by the worker.
   */
  private handlePayload(data: string): void {
    const message = decodeGameMessage(data);
    if (message === null) return;

    switch (message.k) {
      case "hello":
        this.options.onHello(message);
        break;
      case "state":
        this.options.onState(message);
        break;
      case "move":
        this.options.onMove(message);
        break;
      case "rematch":
        this.options.onRematch(message.starter);
        break;
      case "resync":
        this.options.onResyncRequest();
        break;
    }
  }
}
