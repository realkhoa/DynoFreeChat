/**
 * @file game-dialog.ts
 * @brief Visual Studio styled modal dialog component for Tic-Tac-Toe multiplayer and AI games.
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
} from "../game/tictactoe";
import { OnlineGameSession } from "../game/session";
import { GameBoardView } from "./game-board-view";
import type { Identity } from "../lib/identity";

/**
 * @brief Configuration dependencies for creating a GameDialog instance.
 */
export interface GameDialogOptions {
  /** Root dialog element */
  dialog: HTMLDialogElement;
  /** WebSocket server base URL */
  wsUrl: string;
  /** API base URL */
  apiBase: string;
  /** Current user identity (nick, color) */
  getIdentity: () => Identity;
  /** Optional function to create/register room */
  createRoomImpl?: (apiBase: string, body: { slug: string; pass?: string }) => Promise<{ ok: boolean; code?: string }>;
}

/**
 * @brief Manages the Visual Studio IDE styled Tic-Tac-Toe modal dialog.
 */
export class GameDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly wsUrl: string;
  private readonly apiBase: string;
  private readonly getIdentity: () => Identity;
  private readonly createRoomImpl?: (apiBase: string, body: { slug: string; pass?: string }) => Promise<{ ok: boolean; code?: string }>;

  private mode: GameMode = "local";
  private board: BoardState = createEmptyBoard();
  private turn: PlayerMark = "X";
  private myRole: PlayerMark | null = null;
  private scores: GameScore = { x: 0, o: 0, draws: 0 };
  private roomCode = "";
  private session: OnlineGameSession | null = null;
  private isConnected = false;
  private outcome: GameOutcome = { winner: null };

  private lobbyView!: HTMLElement;
  private boardViewEl!: HTMLElement;
  private boardView!: GameBoardView;
  private codeInput!: HTMLInputElement;

  /**
   * @brief Initializes the GameDialog and binds event listeners.
   * @param options Dependency options.
   */
  constructor(options: GameDialogOptions) {
    this.dialog = options.dialog;
    this.wsUrl = options.wsUrl;
    this.apiBase = options.apiBase;
    this.getIdentity = options.getIdentity;
    this.createRoomImpl = options.createRoomImpl;
    this.bindDom();
  }

  /**
   * @brief Binds existing DOM elements and click listeners.
   */
  private bindDom(): void {
    this.lobbyView = this.dialog.querySelector<HTMLElement>("#game-lobby-view")!;
    this.boardViewEl = this.dialog.querySelector<HTMLElement>("#game-board-view")!;
    this.codeInput = this.dialog.querySelector<HTMLInputElement>("#game-code-input")!;
    this.boardView = new GameBoardView(this.boardViewEl, (i) => this.handleCellClick(i));

    const on = (id: string, cb: () => void) => this.dialog.querySelector(id)?.addEventListener("click", cb);
    const joinEnteredCode = () => {
      const code = this.codeInput.value.trim().toUpperCase();
      if (code.length > 0) void this.startOnlineGame(code, false);
    };
    on("#game-dialog-close", () => this.close());
    on("#game-exit-btn", () => this.showLobby());
    on("#game-create-btn", () => void this.startOnlineGame(generateRoomCode(), true));
    on("#game-ai-btn", () => this.startAiGame());
    on("#game-local-btn", () => this.startLocalGame());
    on("#game-rematch-btn", () => this.rematch());
    on("#game-copy-code-btn", () => void this.copyInviteInfo());
    on("#game-join-btn", joinEnteredCode);
    this.codeInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        joinEnteredCode();
      }
    });
  }

  /**
   * @brief Opens the Game dialog in lobby or targeted mode.
   * @param mode Optional initial mode.
   * @param code Optional room code for direct join.
   */
  open(mode?: GameMode, code?: string): void {
    this.dialog.showModal();
    if (code !== undefined && code.length > 0) return void this.startOnlineGame(code.toUpperCase(), false);
    if (mode === "ai") return this.startAiGame();
    if (mode === "online") return void this.startOnlineGame(generateRoomCode(), true);
    this.showLobby();
    this.codeInput.focus();
  }

  /**
   * @brief Closes the dialog and cleans up network connections.
   */
  close(): void {
    this.cleanupSession();
    this.dialog.close();
  }

  /**
   * @brief Displays the lobby view and resets any active game session.
   */
  private showLobby(): void {
    this.cleanupSession();
    this.lobbyView.hidden = false;
    this.boardViewEl.hidden = true;
    this.codeInput.value = "";
  }

  /**
   * @brief Prepares state and activates the board UI for an active game session.
   * @param mode Target game mode.
   * @param role Player mark role if any.
   * @param badge Badge text for header.
   * @param status Initial status message.
   */
  private activateGameView(mode: GameMode, role: PlayerMark | null, badge: string, status: string): void {
    this.cleanupSession();
    this.mode = mode;
    this.myRole = role;
    this.scores = { x: 0, o: 0, draws: 0 };
    this.resetBoard();
    this.lobbyView.hidden = true;
    this.boardViewEl.hidden = false;
    this.boardView.setRoomBadge(badge);
    this.boardView.setStatus(status);
    this.syncBoardUi();
  }

  /**
   * @brief Starts an offline single-player game against the AI.
   */
  startAiGame(): void {
    this.activateGameView("ai", "X", "Chế độ: Đấu với máy (AI)", "Lượt của bạn (X) - Hãy chọn một ô!");
  }

  /**
   * @brief Starts a 2-player local pass-and-play game on the same device.
   */
  startLocalGame(): void {
    this.activateGameView("local", null, "Chế độ: 2 người (Cục bộ)", "Lượt người chơi X");
  }

  /**
   * @brief Starts or joins an online multiplayer game room.
   * @param code The 4-character room code.
   * @param asHost True if creating the room, false if joining existing.
   */
  async startOnlineGame(code: string, asHost: boolean): Promise<void> {
    this.roomCode = code.toUpperCase();
    const role: PlayerMark = asHost ? "X" : "O";
    const status = asHost ? `Mã [${this.roomCode}]. Đang chờ đối thủ...` : `Đang kết nối [${this.roomCode}]...`;
    this.activateGameView("online", role, `Phòng: ${this.roomCode} (${role})`, status);

    this.session = new OnlineGameSession({
      roomCode: this.roomCode,
      asHost,
      wsUrl: this.wsUrl,
      apiBase: this.apiBase,
      identity: this.getIdentity(),
      createRoomImpl: this.createRoomImpl,
      onConnectedChange: (c) => (this.isConnected = c),
      onStatusText: (t) => this.boardView.setStatus(t),
      onPeerJoin: (nick, r) => this.handlePeerJoin(nick, r),
      onRemoteMove: (cell, player) => this.handleRemoteMove(cell, player),
      onRemoteReset: (starter) => this.handleRemoteReset(starter),
      onRemoteSync: (board, turn, scores) => this.handleRemoteSync(board, turn, scores),
    });

    await this.session.connect();
  }

  /**
   * @brief Handles a peer player joining the room.
   */
  private handlePeerJoin(nick: string, role: PlayerMark): void {
    this.boardView.setStatus(`Người chơi ${nick} (${role}) đã vào phòng!`);
    if (this.myRole === "X") this.session?.sendSync(this.board, this.turn, this.scores);
  }

  /**
   * @brief Applies a move to the board, updates turn and checks outcomes.
   * @param index Cell index from 0 to 8.
   * @param mark Player mark placing the move.
   */
  private applyMove(index: number, mark: PlayerMark): void {
    this.board[index] = mark;
    this.outcome = evaluateBoard(this.board);
    this.turn = mark === "X" ? "O" : "X";
    this.checkGameOutcome();
    this.syncBoardUi();
  }

  /**
   * @brief Handles a remote player move.
   * @param cell Cell index 0 to 8.
   * @param player Remote player mark.
   */
  private handleRemoteMove(cell: number, player: PlayerMark): void {
    if (this.board[cell] === null) this.applyMove(cell, player);
  }

  /**
   * @brief Handles a remote game reset.
   */
  private handleRemoteReset(starter: PlayerMark): void {
    this.resetBoard(starter);
    this.syncBoardUi();
    this.boardView.setStatus(`Ván mới bắt đầu! Lượt của ${this.turn}`);
  }

  /**
   * @brief Handles a remote game state sync.
   */
  private handleRemoteSync(board: BoardState, turn: PlayerMark, scores: GameScore): void {
    this.board = board;
    this.turn = turn;
    this.scores = scores;
    this.outcome = evaluateBoard(this.board);
    this.syncBoardUi();
  }

  /**
   * @brief Resets the board and sets the starting player.
   * @param starter Starting player.
   */
  private resetBoard(starter: PlayerMark = "X"): void {
    this.board = createEmptyBoard();
    this.turn = starter;
    this.outcome = { winner: null };
  }

  /**
   * @brief Handles a cell click by the user.
   * @param index Cell index 0 to 8.
   */
  private handleCellClick(index: number): void {
    if (this.outcome.winner !== null || this.board[index] !== null) return;
    if (this.mode === "online") {
      if (!this.isConnected || this.turn !== this.myRole) return;
      this.applyMove(index, this.myRole);
      this.session?.sendMove(index, this.myRole);
      return;
    }
    if (this.mode === "ai") {
      this.applyMove(index, "X");
      if (this.outcome.winner === null) setTimeout(() => this.triggerAiMove(), 220);
      return;
    }
    this.applyMove(index, this.turn);
  }

  /**
   * @brief Executes the AI move if the game is still active.
   */
  private triggerAiMove(): void {
    if (this.outcome.winner !== null) return;
    const aiMove = computeBestMove(this.board, "O");
    if (aiMove >= 0) this.applyMove(aiMove, "O");
  }

  /**
   * @brief Checks and scores game outcomes (win or draw).
   */
  private checkGameOutcome(): void {
    if (this.outcome.winner === "X" || this.outcome.winner === "O") {
      const winner = this.outcome.winner;
      winner === "X" ? this.scores.x++ : this.scores.o++;
      this.boardView.setStatus(`🎉 Người chơi ${winner} chiến thắng!`);
    } else if (this.outcome.winner === "draw") {
      this.scores.draws++;
      this.boardView.setStatus("Trận đấu Hoà!");
    } else {
      const msg = this.mode === "online"
        ? (this.turn === this.myRole ? `Lượt của bạn (${this.myRole})!` : `Đang chờ đối phương (${this.turn})...`)
        : `Lượt người chơi ${this.turn}`;
      this.boardView.setStatus(msg);
    }
  }

  /**
   * @brief Initiates a rematch for the current mode.
   */
  private rematch(): void {
    const nextStarter: PlayerMark = this.turn === "X" ? "O" : "X";
    this.resetBoard(nextStarter);
    this.syncBoardUi();
    if (this.mode === "online") this.session?.sendReset(nextStarter);
    this.boardView.setStatus(`Ván mới bắt đầu! Lượt của ${this.turn}`);
  }

  /**
   * @brief Copies the invite link and room code to the clipboard.
   */
  private async copyInviteInfo(): Promise<void> {
    const inviteUrl = `${window.location.origin}${window.location.pathname}#ttt=${this.roomCode}`;
    const textToCopy = `Chơi TicTacToe cùng tôi trên DynoFreeChat! Mã phòng: ${this.roomCode}\nLink tham gia: ${inviteUrl}`;
    try {
      await navigator.clipboard.writeText(textToCopy);
      this.boardView.setStatus(`Đã copy mã [${this.roomCode}] và link vào clipboard!`);
    } catch {
      this.boardView.setStatus(`Mã phòng: ${this.roomCode}`);
    }
  }

  /**
   * @brief Synchronizes board UI view.
   */
  private syncBoardUi(): void {
    this.boardView.update(this.board, this.turn, this.myRole, this.outcome, this.scores, this.mode);
  }

  /**
   * @brief Closes active WebSocket session.
   */
  private cleanupSession(): void {
    this.session?.close();
    this.session = null;
    this.isConnected = false;
  }
}
