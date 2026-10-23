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
 * @brief Owns the WebSocket for one online game and translates frames into game messages.
 */
export class OnlineGameSession {
  private socket: ChatSocket | null = null;
  private readonly options: OnlineGameSessionOptions;
  private isClosed = false;
  private role: PlayerMark;

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
      try {
        await this.options.createRoomImpl(this.options.apiBase, { slug });
      } catch {
        // The socket join below reports the real reason.
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
          this.options.onPeerCount(frame.online);
          this.send({ k: "hello", clientId: this.options.clientId, role: this.role, nick: this.options.identity.nick });
          this.options.onStatusText(
            frame.online >= 2
              ? "Đối thủ đã có trong phòng!"
              : `Mã phòng: ${this.options.roomCode} - Chia sẻ mã để bạn bè vào chơi!`,
          );
          break;

        case "presence":
          this.options.onPeerCount(frame.online);
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
