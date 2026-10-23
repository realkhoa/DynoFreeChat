/**
 * @file game-board-view.ts
 * @brief Manages the Visual Studio IDE styled Tic-Tac-Toe grid and scoreboard UI.
 */

import type { BoardState, GameMode, GameOutcome, GameScore, PlayerMark } from "../game/tictactoe";

/**
 * @brief Last painted state of one cell, so unchanged cells cost no DOM writes.
 */
interface CellPaint {
  mark: PlayerMark | null;
  win: boolean;
  disabled: boolean;
  codeMode: boolean;
}

/**
 * @brief Renders and updates the interactive 3x3 Tic-Tac-Toe board and score cards.
 */
export class GameBoardView {
  private readonly statusElements: HTMLElement[] = [];
  private readonly badgeElements: HTMLElement[] = [];
  private readonly turnElements: HTMLElement[] = [];
  private readonly scoreXElements: HTMLElement[] = [];
  private readonly scoreOElements: HTMLElement[] = [];
  private readonly scoreDrawElements: HTMLElement[] = [];
  private readonly codeScoreLines: HTMLElement[] = [];
  private readonly cellGroups: HTMLButtonElement[][] = Array.from({ length: 9 }, () => []);
  private readonly painted: (CellPaint | null)[] = Array.from({ length: 9 }, () => null);
  private lastCodeMode: boolean | null = null;

  private codeMode = true;
  private currentBoard: BoardState = [null, null, null, null, null, null, null, null, null];
  private currentTurn: PlayerMark = "X";
  private currentRole: PlayerMark | null = null;
  private currentOutcome: GameOutcome = { winner: null };
  private currentScores: GameScore = { x: 0, o: 0, draws: 0 };
  private currentMode: GameMode = "local";
  private currentCanPlay = true;

  /**
   * @brief Queries and initializes DOM references within the root container.
   * @param root The parent container element.
   * @param onCellClick Callback invoked when a cell is clicked.
   */
  constructor(root: HTMLElement, onCellClick: (index: number) => void) {
    const qAll = <T extends HTMLElement>(sel: string): T[] => Array.from(root.querySelectorAll<T>(sel));

    this.statusElements = qAll("#game-status-banner, #game-code-status-line");
    this.badgeElements = qAll("#game-room-code-badge, #game-code-room-badge");
    this.turnElements = qAll("#game-turn-indicator");
    this.scoreXElements = qAll("#game-score-x");
    this.scoreOElements = qAll("#game-score-o");
    this.scoreDrawElements = qAll("#game-score-draws");
    this.codeScoreLines = qAll("#game-code-score-line");

    for (let i = 0; i < 9; i++) {
      const matched = qAll<HTMLButtonElement>(`#game-cell-${i}, #editor-cell-${i}, [data-cell="${i}"]`);
      for (const btn of matched) {
        btn.addEventListener("click", () => onCellClick(i));
        this.cellGroups[i]?.push(btn);
      }
    }
  }

  /**
   * @brief Sets whether C# syntax code disguise format is applied to text and cells.
   * @param enabled True for code disguise, false for standard.
   */
  setCodeMode(enabled: boolean): void {
    this.codeMode = enabled;
    this.render(true);
  }

  /**
   * @brief Sets the status banner text.
   * @param text Message to display.
   */
  setStatus(text: string): void {
    const formatted = this.codeMode && !text.startsWith("//") ? `// [MatrixEngine] ${text}` : text;
    for (const el of this.statusElements) el.textContent = formatted;
  }

  /**
   * @brief Sets the room code badge text.
   * @param text Badge label.
   */
  setRoomBadge(text: string): void {
    const formatted = this.codeMode && !text.startsWith("//") ? `// Session: ${text}` : text;
    for (const el of this.badgeElements) el.textContent = formatted;
  }

  /**
   * @brief Re-renders the board cells, winning highlights, and score counts.
   * @param board Current 9-cell board.
   * @param turn Current player turn ("X" or "O").
   * @param myRole Role of local player or null.
   * @param outcome Current game outcome.
   * @param scores Win/draw scores.
   * @param mode Current play mode.
   * @param canPlay False while the local player must not act (waiting for a peer).
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
    this.currentBoard = board;
    this.currentTurn = turn;
    this.currentRole = myRole;
    this.currentOutcome = outcome;
    this.currentScores = scores;
    this.currentMode = mode;
    this.currentCanPlay = canPlay;
    this.render(false);
  }

  /**
   * @brief Renders the visual board and scoreboard state.
   * @param force True to repaint every cell even when its state is unchanged.
   */
  private render(force: boolean): void {
    for (const el of this.scoreXElements) el.textContent = String(this.currentScores.x);
    for (const el of this.scoreOElements) el.textContent = String(this.currentScores.o);
    for (const el of this.scoreDrawElements) el.textContent = String(this.currentScores.draws);
    for (const el of this.turnElements) el.textContent = `Lượt: ${this.currentTurn}`;

    const scoreCodeText = `// Assert.True(X): ${this.currentScores.x}  |  Draw: ${this.currentScores.draws}  |  Assert.True(O): ${this.currentScores.o}`;
    for (const el of this.codeScoreLines) el.textContent = scoreCodeText;

    const isMyTurn = this.currentMode !== "online" || this.currentTurn === this.currentRole;
    const isGameOver = this.currentOutcome.winner !== null;
    const forceAll = force || this.lastCodeMode !== this.codeMode;
    this.lastCodeMode = this.codeMode;

    for (let i = 0; i < 9; i++) {
      const val: PlayerMark | null = this.currentBoard[i] ?? null;
      const disabled = val !== null || isGameOver || !this.currentCanPlay || !isMyTurn;
      const win = this.currentOutcome.line?.includes(i) === true;
      const group = this.cellGroups[i];
      if (group === undefined || group.length === 0) continue;

      // A repaint of an unchanged cell is wasted work; skip it unless the code
      // mode flipped, which changes every cell's glyph.
      const previous = this.painted[i];
      if (
        !forceAll &&
        previous !== null &&
        previous !== undefined &&
        previous.mark === val &&
        previous.win === win &&
        previous.disabled === disabled &&
        previous.codeMode === this.codeMode
      ) {
        continue;
      }

      for (const cell of group) this.updateCell(cell, i, val, win, disabled);
      this.painted[i] = { mark: val, win, disabled, codeMode: this.codeMode };
    }
  }

  /**
   * @brief Updates visual styles and state for a single board cell button.
   * @param cell Button element representing the cell.
   * @param index Cell index from 0 to 8.
   * @param val Value in cell ('X', 'O', or null).
   * @param win True when this cell is part of the winning line.
   * @param disabled True if interaction is prohibited.
   */
  private updateCell(
    cell: HTMLButtonElement,
    index: number,
    val: PlayerMark | null,
    win: boolean,
    disabled: boolean,
  ): void {
    cell.textContent = val !== null ? val : (this.codeMode ? "·" : "");
    cell.classList.toggle("cell-x", val === "X");
    cell.classList.toggle("cell-o", val === "O");
    cell.classList.toggle("cell-empty", val === null);
    cell.classList.toggle("cell-win", win);
    cell.disabled = disabled;
    cell.setAttribute("aria-label", `Ô ${index}${val === null ? "" : ` ${val}`}`);
  }
}
