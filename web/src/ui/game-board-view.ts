/**
 * @file game-board-view.ts
 * @brief Renders the collab session inside the DiagnosticMatrix.cs document.
 * @details The buffer is data in a C# file, not a game board: each slot renders as a
 * char literal inside the array initializer, state is reported through comments and
 * the editor status bar, and the gutter is generated from the rendered lines so the
 * file never looks stitched together.
 */

import type { BoardState, GameMode, GameOutcome, GameScore, PlayerMark } from "../game/tictactoe";

/** Glyph painted inside a slot literal when the slot is empty. */
const EMPTY_GLYPH = "\u00b7";

/**
 * @brief Last painted state of one slot, so unchanged slots cost no DOM writes.
 */
interface CellPaint {
  mark: PlayerMark | null;
  win: boolean;
  disabled: boolean;
}

/**
 * @brief Renders the collab buffer and status chrome of the code document.
 */
export class GameBoardView {
  private readonly statusElements: HTMLElement[] = [];
  private readonly badgeElements: HTMLElement[] = [];
  private readonly scoreLines: HTMLElement[] = [];
  private readonly cellGroups: HTMLButtonElement[][] = Array.from({ length: 9 }, () => []);
  private readonly cellLines: number[] = Array.from({ length: 9 }, () => 0);
  private readonly painted: (CellPaint | null)[] = Array.from({ length: 9 }, () => null);

  private readonly threadEl: HTMLElement | null;
  private readonly sessionEl: HTMLElement | null;
  private readonly stateEl: HTMLElement | null;
  private readonly diagEl: HTMLElement | null;
  private readonly lnEl: HTMLElement | null;
  private readonly gutterEl: HTMLElement | null;
  private readonly contentEl: HTMLElement | null;

  private board: BoardState = [null, null, null, null, null, null, null, null, null];
  private turn: PlayerMark = "X";
  private role: PlayerMark | null = null;
  private outcome: GameOutcome = { winner: null };
  private scores: GameScore = { x: 0, o: 0, draws: 0 };
  private mode: GameMode = "local";
  private canPlay = true;
  private sessionCode = "";
  private active = false;

  /**
   * @brief Queries the document elements and binds slot clicks.
   * @param root The document to query (the whole page, so a detached copy works too).
   * @param onCellClick Callback invoked when a buffer slot is activated.
   */
  constructor(root: HTMLElement, onCellClick: (index: number) => void) {
    const q = <T extends HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
    const qAll = <T extends HTMLElement>(sel: string): T[] => Array.from(root.querySelectorAll<T>(sel));

    this.statusElements = qAll("#game-code-status-line");
    this.badgeElements = qAll("#game-code-room-badge");
    this.scoreLines = qAll("#game-code-score-line");
    this.threadEl = q("#game-code-thread");
    this.sessionEl = q("#game-code-session");
    this.stateEl = q("#game-code-state");
    this.diagEl = q("#game-code-diag");
    this.lnEl = q("#game-code-ln");
    this.gutterEl = q("#game-code-gutter");
    this.contentEl = q("#game-code-content");

    for (let i = 0; i < 9; i++) {
      for (const cell of qAll<HTMLButtonElement>(`#editor-cell-${i}, [data-cell="${i}"]`)) {
        cell.addEventListener("click", () => onCellClick(i));
        cell.addEventListener("mouseenter", () => this.reportCursor(i));
        cell.addEventListener("focus", () => this.reportCursor(i));
        this.cellGroups[i]?.push(cell);
      }
    }

    this.paintGutter();
    this.reportCursor(0);
  }

  /**
   * @brief Sets whether a session is running, which keeps the document legible.
   * @param active True while a collab session is attached.
   */
  setActive(active: boolean): void {
    this.active = active;
    this.paintStatusBar();
  }

  /**
   * @brief Sets the session id shown in the toolbar and status bar.
   * @param code Room code, or empty when no session is attached.
   */
  setSession(code: string): void {
    this.sessionCode = code;
    const badge = code.length > 0 ? `// session: ${code}` : "// session: (none)";
    for (const el of this.badgeElements) el.textContent = badge;
    if (this.sessionEl !== null) {
      this.sessionEl.textContent = code.length > 0 ? `session ${code}` : "session -";
    }
  }

  /**
   * @brief Sets the status comment text.
   * @param text Message to display.
   */
  setStatus(text: string): void {
    const body = text.startsWith("//") ? text : `// ${text}`;
    for (const el of this.statusElements) el.textContent = body;
  }

  /**
   * @brief Sets the session badge from the runner's label.
   * @details Online sessions report `<code> (<role>)`; local modes report a plain
   * label such as `local` or `simulation`. Only the first token is the session id.
   * @param text Badge label.
   */
  setRoomBadge(text: string): void {
    const label = text.split(/[\s(]/)[0] ?? "";
    this.setSession(/^[A-Z0-9]{4,6}$/.test(label) ? label : label.toLowerCase());
  }

  /**
   * @brief Re-renders the buffer literals, the assertion comment and the status bar.
   * @param board Current 9-slot buffer.
   * @param turn Player expected to dispatch next.
   * @param myRole Role of the local player or null.
   * @param outcome Current assertion outcome.
   * @param scores Win/draw counters.
   * @param mode Current play mode.
   * @param canPlay False while the local player must not act.
   */
  update(
    board: BoardState,
    turn: PlayerMark,
    myRole: PlayerMark | null,
    outcome: GameOutcome,
    scores: GameScore,
    mode: GameMode,
    canPlay = true,
  ): void {
    this.board = board;
    this.turn = turn;
    this.role = myRole;
    this.outcome = outcome;
    this.scores = scores;
    this.mode = mode;
    this.canPlay = canPlay;

    const isMyTurn = mode !== "online" || turn === myRole;
    const isGameOver = outcome.winner !== null;

    for (let i = 0; i < 9; i++) {
      const mark: PlayerMark | null = board[i] ?? null;
      const disabled = mark !== null || isGameOver || !canPlay || !isMyTurn;
      const win = outcome.line?.includes(i) === true;
      const group = this.cellGroups[i];
      if (group === undefined) continue;

      const previous = this.painted[i];
      if (
        previous !== null &&
        previous !== undefined &&
        previous.mark === mark &&
        previous.win === win &&
        previous.disabled === disabled
      ) {
        continue;
      }

      for (const cell of group) this.paintCell(cell, i, mark, win, disabled);
      this.painted[i] = { mark, win, disabled };
    }

    const scoreText = `// Trace.Assert(x: ${scores.x}) | Trace.Assert(draw: ${scores.draws}) | Trace.Assert(o: ${scores.o})`;
    for (const el of this.scoreLines) el.textContent = scoreText;

    this.paintStatusBar();
  }

  /**
   * @brief Writes the literal and state classes of one buffer slot.
   * @param cell Slot button.
   * @param index Slot index 0..8.
   * @param mark Current mark.
   * @param win True when the slot belongs to the matched pattern.
   * @param disabled True when the slot cannot be written.
   */
  private paintCell(
    cell: HTMLButtonElement,
    index: number,
    mark: PlayerMark | null,
    win: boolean,
    disabled: boolean,
  ): void {
    // Rendered as a char literal so the row reads like `{ '·', 'X', '·' },`.
    cell.textContent = `'${mark ?? EMPTY_GLYPH}'`;
    cell.classList.toggle("cell-x", mark === "X");
    cell.classList.toggle("cell-o", mark === "O");
    cell.classList.toggle("cell-empty", mark === null);
    cell.classList.toggle("cell-win", win);
    cell.disabled = disabled;
    cell.setAttribute("aria-label", `buffer slot ${index}${mark === null ? "" : ` = ${mark}`}`);
  }

  /**
   * @brief Derives the gutter numbers from the rendered code lines.
   * @details The gutter must mirror the document or the disguise falls apart at a
   * glance, so it is generated instead of hand-maintained.
   */
  private paintGutter(): void {
    if (this.gutterEl === null || this.contentEl === null) return;
    const lines = Array.from(this.contentEl.querySelectorAll(".code-line"));

    const fragment = document.createDocumentFragment();
    for (let index = 1; index <= lines.length; index++) {
      const span = document.createElement("span");
      span.textContent = String(index).padStart(2, "0");
      fragment.append(span);
    }
    this.gutterEl.replaceChildren(fragment);

    // Remember which document line each slot sits on, for the Ln/Col readout.
    for (let i = 0; i < 9; i++) {
      const cell = this.cellGroups[i]?.[0];
      if (cell === undefined) continue;
      const line = lines.findIndex((candidate) => candidate.contains(cell));
      this.cellLines[i] = line + 1;
    }
  }

  /**
   * @brief Moves the status bar caret readout to the hovered slot.
   * @param index Slot index 0..8.
   */
  private reportCursor(index: number): void {
    if (this.lnEl === null) return;
    const line = this.cellLines[index] ?? 0;
    const column = 20 + (index % 3) * 4;
    this.lnEl.textContent = `Ln ${line > 0 ? line : 1}, Col ${column}`;
  }

  /**
   * @brief Repaints the status bar fields that depend on session state.
   */
  private paintStatusBar(): void {
    const winner = this.outcome.winner;
    if (this.threadEl !== null) {
      this.threadEl.textContent = this.active ? `thread ${this.turn}` : "thread -";
    }
    if (this.stateEl !== null) {
      this.stateEl.textContent = !this.active
        ? "Ready"
        : winner !== null
          ? "Assertion passed"
          : "Running";
    }
    if (this.diagEl !== null) {
      this.diagEl.textContent = winner !== null && winner !== "draw" ? "0 errors, 1 assert" : "0 errors";
    }
    if (this.sessionEl !== null) {
      this.sessionEl.textContent = this.sessionCode.length > 0 ? `session ${this.sessionCode}` : "session -";
    }
  }
}
