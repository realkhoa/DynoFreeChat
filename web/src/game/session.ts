/**
 * @file session.ts
 * @brief Manages online WebSocket multiplayer synchronization for Tic-Tac-Toe games.
 */

import {
  deserializeTttMessage,
  roomSlugFromCode,
  serializeTttMessage,
  type BoardState,
  type GameScore,
  type PlayerMark,
  type TttProtocolMessage,
} from "./tictactoe";
import { ChatSocket, type SocketState } from "../net/socket";
import { roomSocketUrl } from "../env";
import type { Identity } from "../lib/identity";

/**
 * @brief Configuration handlers and dependencies for an online multiplayer game session.
 */
export interface OnlineGameSessionOptions {
  /** Room code (e.g. "9B2X") */
  roomCode: string;
  /** True if creator, false if joiner */
  asHost: boolean;
  /** WebSocket server base URL */
  wsUrl: string;
  /** REST API base URL */
  apiBase: string;
  /** Current user identity */
  identity: Identity;
  /** Optional function to register room on registry */
  createRoomImpl?: (apiBase: string, body: { slug: string; pass?: string }) => Promise<{ ok: boolean; code?: string }>;
  /** Callback on remote player move */
  onRemoteMove: (cell: number, player: PlayerMark) => void;
  /** Callback on remote player reset/rematch */
  onRemoteReset: (starter: PlayerMark) => void;
  /** Callback on host state sync */
  onRemoteSync: (board: BoardState, turn: PlayerMark, scores: GameScore) => void;
  /** Callback on peer player joined */
  onPeerJoin: (nick: string, role: PlayerMark) => void;
  /** Callback on status/connection text change */
  onStatusText: (text: string) => void;
  /** Callback on connection state change */
  onConnectedChange: (connected: boolean) => void;
}

/**
 * @brief Coordinates real-time online game session synchronization over WebSockets.
 */
export class OnlineGameSession {
  private socket: ChatSocket | null = null;
  private readonly options: OnlineGameSessionOptions;
  private isClosed = false;

  /**
   * @brief Initializes a new OnlineGameSession.
   * @param options Dependency options and callbacks.
   */
  constructor(options: OnlineGameSessionOptions) {
    this.options = options;
  }

  /**
   * @brief Connects to the WebSocket room and registers with the server.
   */
  async connect(): Promise<void> {
    const slug = roomSlugFromCode(this.options.roomCode);

    if (this.options.createRoomImpl !== undefined) {
      try {
        await this.options.createRoomImpl(this.options.apiBase, { slug });
      } catch {
        // Continue to WebSocket connection
      }
    }

    if (this.isClosed) return;

    const wsEndpoint = roomSocketUrl(this.options.wsUrl, slug);
    const sock = new ChatSocket({ url: wsEndpoint });
    this.socket = sock;

    sock.onState((state: SocketState) => {
      const connected = state === "open";
      this.options.onConnectedChange(connected);

      if (state === "open") {
        sock.send({ t: "join", nick: this.options.identity.nick, color: this.options.identity.color });
        this.options.onStatusText(
          this.options.asHost
            ? `Mã phòng: ${this.options.roomCode} - Chia sẻ mã để bạn bè vào chơi!`
            : "Đã kết nối vào phòng!",
        );
      } else if (state === "connecting" || state === "reconnecting") {
        this.options.onStatusText(`Đang kết nối lại phòng [${this.options.roomCode}]...`);
      }
    });

    sock.onFrame((frame) => {
      if (frame.t === "append") {
        const gameMsg = deserializeTttMessage(frame.m.text);
        if (gameMsg !== null) this.handleMessage(gameMsg);
      }
    });

    sock.connect();
  }

  /**
   * @brief Sends a move message to the opponent.
   * @param cell Cell index 0 to 8.
   * @param player Mark of current player ("X" or "O").
   */
  sendMove(cell: number, player: PlayerMark): void {
    if (this.socket === null) return;
    const msg: TttProtocolMessage = { type: "move", cell, player };
    this.socket.send({ t: "msg", cid: `m${cell}`, text: serializeTttMessage(msg) });
  }

  /**
   * @brief Sends a rematch reset message.
   * @param starter Starting player.
   */
  sendReset(starter: PlayerMark): void {
    if (this.socket === null) return;
    const msg: TttProtocolMessage = { type: "reset", starter };
    this.socket.send({ t: "msg", cid: "reset", text: serializeTttMessage(msg) });
  }

  /**
   * @brief Sends current board state sync to joining peers.
   * @param board Current board state.
   * @param turn Current turn.
   * @param scores Current score record.
   */
  sendSync(board: BoardState, turn: PlayerMark, scores: GameScore): void {
    if (this.socket === null) return;
    const msg: TttProtocolMessage = { type: "sync", board, turn, scores };
    this.socket.send({ t: "msg", cid: "sync", text: serializeTttMessage(msg) });
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
   * @brief Processes deserialized game protocol messages.
   * @param msg Parsed protocol message.
   */
  private handleMessage(msg: TttProtocolMessage): void {
    switch (msg.type) {
      case "join":
        this.options.onPeerJoin(msg.nick, msg.role);
        break;
      case "move":
        this.options.onRemoteMove(msg.cell, msg.player);
        break;
      case "reset":
        this.options.onRemoteReset(msg.starter);
        break;
      case "sync":
        this.options.onRemoteSync(msg.board, msg.turn, msg.scores);
        break;
    }
  }
}
