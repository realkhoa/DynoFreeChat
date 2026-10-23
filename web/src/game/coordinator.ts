/**
 * @file coordinator.ts
 * @brief Coordinates Tic-Tac-Toe state, turn progression, AI moves, and network synchronization.
 */

import {
  computeBestMove,
  createEmptyBoard,
  evaluateBoard,
  otherMark,
  type BoardState,
  type GameMode,
  type GameOutcome,
  type GameScore,
  type PlayerMark,
} from "./tictactoe";
import type { GameSnapshot, MoveMessage } from "./protocol";
import { OnlineGameSession } from "./session";
import type { Identity } from "../lib/identity";

/**
 * @brief Callbacks emitted by GameCoordinator to decouple state from UI rendering.
 */
export interface GameCoordinatorCallbacks {
  /** Emitted whenever board, turn, or scores change */
  onUpdate: (
    board: BoardState,
    turn: PlayerMark,
    myRole: PlayerMark | null,
    outcome: GameOutcome,
    scores: GameScore,
    mode: GameMode,
    /** False while the local player must not act (waiting for a peer, game over) */
    canPlay: boolean,
  ) => void;
  /** Emitted when status text message changes */
  onStatus: (text: string) => void;
  /** Emitted when room/session badge label changes */
  onRoomBadge: (badge: string) => void;
}

/**
 * @brief Options for configuring a GameCoordinator instance.
 */
export interface GameCoordinatorOptions {
  /** WebSocket server base URL */
  wsUrl: string;
  /** API base URL */
  apiBase: string;
  /** Identity getter for online sessions */
  getIdentity: () => Identity;
  /** Optional custom room creation implementation */
  createRoomImpl?: (apiBase: string, body: { slug: string; pass?: string }) => Promise<{ ok: boolean; code?: string }>;
  /** Optional deterministic client id, mainly for tests */
  clientId?: string;
  /** Optional WebSocket factory, mainly for tests */
  socketFactory?: (url: string) => WebSocket;
  /** UI dispatch callbacks */
  callbacks: GameCoordinatorCallbacks;
}

/**
 * @brief Pure coordinator managing gameplay state, AI decisions, and real-time multiplayer.
 */
export class GameCoordinator {
  private mode: GameMode = "local";
  private board: BoardState = createEmptyBoard();
  private turn: PlayerMark = "X";
  private starter: PlayerMark = "X";
  private myRole: PlayerMark | null = null;
  private scores: GameScore = { x: 0, o: 0, draws: 0 };
  private roomCode = "";
  private session: OnlineGameSession | null = null;
  private isConnected = false;
  private peerOnline = 0;
  /** Moves applied in the current round; a peer uses it to detect a gap. */
  private seq = 0;
  private outcome: GameOutcome = { winner: null };
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly clientId: string;

  constructor(private readonly options: GameCoordinatorOptions) {
    this.clientId = options.clientId ?? Math.random().toString(36).slice(2, 10);
  }

  /**
   * @brief Resets state and prepares an AI single-player game.
   */
  startAiGame(): void {
    this.activate("ai", "X", "AI Eval Bot", "Lượt của bạn (X) - Hãy chọn một ô!");
  }

  /**
   * @brief Resets state and prepares a 2-player local pass-and-play game.
   */
  startLocalGame(): void {
    this.activate("local", null, "Local Dual-Thread", "Lượt người chơi X");
  }

  /**
   * @brief Starts or connects to a real-time multiplayer room.
   * @param code 4-character room code.
   * @param asHost True if creating room, false if joining.
   */
  async startOnlineGame(code: string, asHost: boolean): Promise<void> {
    this.roomCode = code.trim().toUpperCase();
    const role: PlayerMark = asHost ? "X" : "O";
    const badge = `${this.roomCode} (${role})`;
    const status = asHost ? `Mã [${this.roomCode}]. Đang chờ đối thủ...` : `Đang kết nối [${this.roomCode}]...`;
    this.activate("online", role, badge, status);

    const session = new OnlineGameSession({
      roomCode: this.roomCode,
      asHost,
      wsUrl: this.options.wsUrl,
      apiBase: this.options.apiBase,
      identity: this.options.getIdentity(),
      createRoomImpl: this.options.createRoomImpl,
      role,
      clientId: this.clientId,
      ...(this.options.socketFactory === undefined ? {} : { socketFactory: this.options.socketFactory }),
      onStatusText: (t) => this.options.callbacks.onStatus(t),
      onConnectedChange: (c) => {
        this.isConnected = c;
        if (!c) this.peerOnline = 0;
        this.sync();
      },
      onPeerCount: (online) => this.handlePeerCount(online),
      onHello: (message) => this.handleHello(message.clientId, message.role, message.nick),
      onState: (snapshot) => this.handleRemoteState(snapshot),
      onMove: (message) => this.handleRemoteMove(message),
      onRematch: (starter) => this.handleRemoteRematch(starter),
      onResyncRequest: () => this.sendState(),
    });

    this.session = session;
    await session.connect();
  }

  /**
   * @brief Handles a cell selection by the local player.
   * @param index Cell index 0 to 8.
   */
  handleCellClick(index: number): void {
    if (this.outcome.winner !== null) return;
    if (this.board[index] !== null) return;

    if (this.mode === "online") {
      if (!this.canPlayOnline()) return;
      const role = this.myRole;
      if (role === null || this.turn !== role) return;
      if (!this.commitMove(index, role)) return;
      const message: MoveMessage = { k: "move", cell: index, player: role, seq: this.seq };
      this.session?.send(message);
      return;
    }

    if (this.mode === "ai") {
      // The local player is always X here, and only X moves by hand: a second
      // click while the AI is thinking must not place another mark.
      if (this.turn !== "X") return;
      if (!this.commitMove(index, "X")) return;
      if (this.outcome.winner !== null) return;
      this.scheduleAiMove();
      return;
    }

    this.commitMove(index, this.turn);
  }

  /**
   * @brief Resets current game board for a rematch, alternating who starts.
   */
  rematch(): void {
    this.cancelAiMove();
    const nextStarter = otherMark(this.starter);
    this.resetBoard(nextStarter);

    if (this.mode === "online") {
      this.sync();
      if (!this.canPlayOnline()) {
        this.options.callbacks.onStatus(`Ván mới! Đang chờ đối thủ...`);
        return;
      }
      this.session?.send({ k: "rematch", starter: nextStarter });
      this.options.callbacks.onStatus(`Ván mới bắt đầu! Lượt của ${this.turn}`);
      return;
    }

    this.sync();
    this.options.callbacks.onStatus(`Ván mới bắt đầu! Lượt của ${this.turn}`);
    if (this.mode === "ai" && this.turn === "O") this.scheduleAiMove();
  }

  /**
   * @brief Copies room code and invite link to clipboard.
   * @return Formatted invite string.
   */
  async copyInviteInfo(): Promise<string> {
    const inviteUrl = `${window.location.origin}${window.location.pathname}#ttt=${this.roomCode}`;
    const text = `Chơi TicTacToe cùng tôi trên DynoFreeChat! Mã phòng: ${this.roomCode}\nLink tham gia: ${inviteUrl}`;
    try {
      await navigator.clipboard.writeText(text);
      this.options.callbacks.onStatus(`Đã copy mã [${this.roomCode}] và link vào clipboard!`);
    } catch {
      this.options.callbacks.onStatus(`Mã phòng: ${this.roomCode}`);
    }
    return text;
  }

  /**
   * @brief Disconnects active WebSocket session and cleans up resources.
   */
  cleanup(): void {
    this.cancelAiMove();
    this.session?.close();
    this.session = null;
    this.isConnected = false;
    this.peerOnline = 0;
  }

  /**
   * @brief Returns the active room code.
   * @return 4-character room code.
   */
  getRoomCode(): string {
    return this.roomCode;
  }

  private activate(mode: GameMode, role: PlayerMark | null, badge: string, status: string): void {
    this.cleanup();
    this.mode = mode;
    this.myRole = role;
    this.scores = { x: 0, o: 0, draws: 0 };
    this.resetBoard("X");
    this.options.callbacks.onRoomBadge(badge);
    this.options.callbacks.onStatus(status);
    this.sync();
  }

  /**
   * @brief True when the local player may act in an online game.
   * @return False while disconnected, alone in the room, or without a role.
   */
  private canPlayOnline(): boolean {
    return this.isConnected && this.peerOnline >= 2 && this.myRole !== null;
  }

  private handlePeerCount(online: number): void {
    const hadPeer = this.peerOnline >= 2;
    this.peerOnline = online;
    if (this.mode !== "online") return;

    if (online >= 2 && !hadPeer) this.options.callbacks.onStatus("Đối thủ đã vào phòng!");
    else if (online < 2) this.options.callbacks.onStatus(`Mã [${this.roomCode}]. Đang chờ đối thủ...`);
    this.sync();
  }

  /**
   * @brief Handles the peer's opening handshake: settle roles, then hand over state.
   * @param peerClientId Peer's stable client id.
   * @param peerRole Role the peer claims.
   * @param peerNick Peer's nickname.
   */
  private handleHello(peerClientId: string, peerRole: PlayerMark, peerNick: string): void {
    if (this.mode !== "online" || this.myRole === null) return;

    // Both sides may pick the same role (two people typing the same code). The
    // smaller client id keeps X; because both sides compare the same two values,
    // exactly one of them switches and the room converges after one round trip.
    if (peerRole === this.myRole) {
      const keepX = this.clientId < peerClientId;
      const resolved: PlayerMark = keepX ? "X" : "O";
      if (resolved !== this.myRole) {
        this.myRole = resolved;
        this.session?.setRole(resolved);
        this.options.callbacks.onRoomBadge(`${this.roomCode} (${resolved})`);
        this.options.callbacks.onStatus(`Bạn là ${resolved} (${peerNick} là ${otherMark(resolved)}).`);
        this.sync();
      }
    }

    if (this.myRole === "X") this.sendState();
  }

  private sendState(): void {
    if (this.mode !== "online" || this.myRole !== "X") return;
    const snapshot: GameSnapshot & { k: "state" } = {
      k: "state",
      board: [...this.board] as BoardState,
      turn: this.turn,
      scores: { ...this.scores },
      starter: this.starter,
      seq: this.seq,
    };
    this.session?.send(snapshot);
  }

  /**
   * @brief Adopts the host's authoritative snapshot.
   * @param snapshot Board, turn, scores, starter and move count.
   */
  private handleRemoteState(snapshot: GameSnapshot): void {
    // Only X is authoritative; an O peer never dictates state.
    if (this.mode !== "online" || this.myRole === "X") return;

    this.cancelAiMove();
    this.board = [...snapshot.board] as BoardState;
    this.turn = snapshot.turn;
    this.starter = snapshot.starter;
    this.scores = { ...snapshot.scores };
    this.seq = snapshot.seq;
    this.outcome = evaluateBoard(this.board);
    this.sync();
    this.reportTurnStatus();
  }

  private handleRemoteMove(message: MoveMessage): void {
    if (this.mode !== "online" || this.myRole === null) return;
    if (message.player === this.myRole) return;
    if (this.outcome.winner !== null) return;

    if (message.seq <= this.seq) return;
    if (message.seq !== this.seq + 1) {
      this.requestResync();
      return;
    }
    if (message.player !== this.turn) {
      this.requestResync();
      return;
    }
    if (!this.commitMove(message.cell, message.player)) this.requestResync();
  }

  private handleRemoteRematch(starter: PlayerMark): void {
    if (this.mode !== "online") return;
    this.cancelAiMove();
    this.resetBoard(starter);
    this.sync();
    this.options.callbacks.onStatus(`Ván mới bắt đầu! Lượt của ${this.turn}`);
  }

  /**
   * @brief Recovers from a desync: the host resends state, the peer asks for it.
   */
  private requestResync(): void {
    if (this.myRole === "X") this.sendState();
    else this.session?.send({ k: "resync" });
  }

  private resetBoard(starter: PlayerMark = "X"): void {
    this.board = createEmptyBoard();
    this.starter = starter;
    this.turn = starter;
    this.outcome = { winner: null };
    this.seq = 0;
  }

  /**
   * @brief Applies a move after validating turn ownership and the target cell.
   * @param index Cell index 0 to 8.
   * @param mark Mark being placed.
   * @return True when the move was applied.
   */
  private commitMove(index: number, mark: PlayerMark): boolean {
    if (!Number.isInteger(index) || index < 0 || index > 8) return false;
    if (this.board[index] !== null) return false;
    if (this.outcome.winner !== null) return false;
    if (this.turn !== mark) return false;

    this.board[index] = mark;
    this.seq += 1;
    this.outcome = evaluateBoard(this.board);
    this.turn = otherMark(mark);
    this.checkOutcome();
    this.sync();
    return true;
  }

  private scheduleAiMove(): void {
    this.cancelAiMove();
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      if (this.mode !== "ai") return;
      if (this.outcome.winner !== null) return;
      if (this.turn !== "O") return;
      const aiMove = computeBestMove(this.board, "O");
      if (aiMove >= 0) this.commitMove(aiMove, "O");
    }, 120);
  }

  private cancelAiMove(): void {
    if (this.aiTimer === null) return;
    clearTimeout(this.aiTimer);
    this.aiTimer = null;
  }

  private checkOutcome(): void {
    const winner = this.outcome.winner;
    if (winner === "X" || winner === "O") {
      if (winner === "X") this.scores.x += 1;
      else this.scores.o += 1;
      this.options.callbacks.onStatus(`🎉 Người chơi ${winner} chiến thắng!`);
      return;
    }
    if (winner === "draw") {
      this.scores.draws += 1;
      this.options.callbacks.onStatus("Trận đấu Hoà!");
      return;
    }
    this.reportTurnStatus();
  }

  private reportTurnStatus(): void {
    if (this.outcome.winner !== null) return;
    const message =
      this.mode === "online"
        ? this.turn === this.myRole
          ? `Lượt của bạn (${this.myRole})!`
          : `Đang chờ đối phương (${this.turn})...`
        : `Lượt người chơi ${this.turn}`;
    this.options.callbacks.onStatus(message);
  }

  private sync(): void {
    this.options.callbacks.onUpdate(
      this.board,
      this.turn,
      this.myRole,
      this.outcome,
      this.scores,
      this.mode,
      this.mode !== "online" || this.canPlayOnline(),
    );
  }
}
