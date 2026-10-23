/**
 * @file coordinator.ts
 * @brief Coordinates Tic-Tac-Toe state, turn progression, AI moves, and network synchronization.
 */

import {
  computeBestMove,
  createEmptyBoard,
  evaluateBoard,
  generateRoomCode,
  type BoardState,
  type GameMode,
  type GameOutcome,
  type GameScore,
  type PlayerMark,
} from "./tictactoe";
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
  private myRole: PlayerMark | null = null;
  private scores: GameScore = { x: 0, o: 0, draws: 0 };
  private roomCode = "";
  private session: OnlineGameSession | null = null;
  private isConnected = false;
  private outcome: GameOutcome = { winner: null };

  constructor(private readonly options: GameCoordinatorOptions) {}

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
    this.roomCode = code.toUpperCase();
    const role: PlayerMark = asHost ? "X" : "O";
    const status = asHost ? `Mã [${this.roomCode}]. Đang chờ đối thủ...` : `Đang kết nối [${this.roomCode}]...`;
    this.activate("online", role, `${this.roomCode} (${role})`, status);

    this.session = new OnlineGameSession({
      roomCode: this.roomCode,
      asHost,
      wsUrl: this.options.wsUrl,
      apiBase: this.options.apiBase,
      identity: this.options.getIdentity(),
      createRoomImpl: this.options.createRoomImpl,
      onConnectedChange: (c) => (this.isConnected = c),
      onStatusText: (t) => this.options.callbacks.onStatus(t),
      onPeerJoin: (nick, r) => this.handlePeerJoin(nick, r),
      onRemoteMove: (cell, player) => this.handleRemoteMove(cell, player),
      onRemoteReset: (starter) => this.handleRemoteReset(starter),
      onRemoteSync: (b, turn, s) => this.handleRemoteSync(b, turn, s),
    });

    await this.session.connect();
  }

  /**
   * @brief Handles a cell selection by the local player.
   * @param index Cell index 0 to 8.
   */
  handleCellClick(index: number): void {
    if (this.outcome.winner !== null || this.board[index] !== null) return;
    if (this.mode === "online") {
      if (!this.isConnected || this.turn !== this.myRole) return;
      this.applyMove(index, this.myRole);
      this.session?.sendMove(index, this.myRole);
      return;
    }
    if (this.mode === "ai") {
      this.applyMove(index, "X");
      if (this.outcome.winner !== null) return;
      setTimeout(() => this.triggerAiMove(), 220);
      return;
    }
    this.applyMove(index, this.turn);
  }

  /**
   * @brief Resets current game board for a rematch.
   */
  rematch(): void {
    const nextStarter: PlayerMark = this.turn === "X" ? "O" : "X";
    this.resetBoard(nextStarter);
    this.sync();
    if (this.mode === "online") this.session?.sendReset(nextStarter);
    this.options.callbacks.onStatus(`Ván mới bắt đầu! Lượt của ${this.turn}`);
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
    this.session?.close();
    this.session = null;
    this.isConnected = false;
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
    this.resetBoard();
    this.options.callbacks.onRoomBadge(badge);
    this.options.callbacks.onStatus(status);
    this.sync();
  }

  private handlePeerJoin(nick: string, role: PlayerMark): void {
    this.options.callbacks.onStatus(`Người chơi ${nick} (${role}) đã vào phòng!`);
    if (this.myRole === "X") this.session?.sendSync(this.board, this.turn, this.scores);
  }

  private handleRemoteMove(cell: number, player: PlayerMark): void {
    if (this.board[cell] === null) this.applyMove(cell, player);
  }

  private handleRemoteReset(starter: PlayerMark): void {
    this.resetBoard(starter);
    this.sync();
    this.options.callbacks.onStatus(`Ván mới bắt đầu! Lượt của ${this.turn}`);
  }

  private handleRemoteSync(board: BoardState, turn: PlayerMark, scores: GameScore): void {
    this.board = board;
    this.turn = turn;
    this.scores = scores;
    this.outcome = evaluateBoard(this.board);
    this.sync();
  }

  private resetBoard(starter: PlayerMark = "X"): void {
    this.board = createEmptyBoard();
    this.turn = starter;
    this.outcome = { winner: null };
  }

  private applyMove(index: number, mark: PlayerMark): void {
    this.board[index] = mark;
    this.outcome = evaluateBoard(this.board);
    this.turn = mark === "X" ? "O" : "X";
    this.checkOutcome();
    this.sync();
  }

  private triggerAiMove(): void {
    if (this.outcome.winner !== null) return;
    const aiMove = computeBestMove(this.board, "O");
    if (aiMove >= 0) this.applyMove(aiMove, "O");
  }

  private checkOutcome(): void {
    if (this.outcome.winner === "X" || this.outcome.winner === "O") {
      const w = this.outcome.winner;
      w === "X" ? this.scores.x++ : this.scores.o++;
      this.options.callbacks.onStatus(`🎉 Người chơi ${w} chiến thắng!`);
    } else if (this.outcome.winner === "draw") {
      this.scores.draws++;
      this.options.callbacks.onStatus("Trận đấu Hoà!");
    } else {
      const msg = this.mode === "online"
        ? (this.turn === this.myRole ? `Lượt của bạn (${this.myRole})!` : `Đang chờ đối phương (${this.turn})...`)
        : `Lượt người chơi ${this.turn}`;
      this.options.callbacks.onStatus(msg);
    }
  }

  private sync(): void {
    this.options.callbacks.onUpdate(
      this.board,
      this.turn,
      this.myRole,
      this.outcome,
      this.scores,
      this.mode,
    );
  }
}
