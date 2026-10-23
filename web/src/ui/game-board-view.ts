/**
 * @file game-board-view.ts
 * @brief Manages the Visual Studio IDE styled Tic-Tac-Toe grid and scoreboard UI.
 */

import type { BoardState, GameMode, GameOutcome, GameScore, PlayerMark } from "../game/tictactoe";

/**
 * @brief Renders and updates the interactive 3x3 Tic-Tac-Toe board and score cards.
 */
export class GameBoardView {
  private readonly statusBanner: HTMLElement;
  private readonly roomCodeBadge: HTMLElement;
  private readonly turnIndicator: HTMLElement;
  private readonly scoreX: HTMLElement;
  private readonly scoreO: HTMLElement;
  private readonly scoreDraws: HTMLElement;
  private readonly cells: HTMLButtonElement[] = [];

  /**
   * @brief Queries and initializes DOM references within the root container.
   * @param root The parent board view container element.
   * @param onCellClick Callback invoked when a cell is clicked.
   */
  constructor(root: HTMLElement, onCellClick: (index: number) => void) {
    this.statusBanner = root.querySelector<HTMLElement>("#game-status-banner")!;
    this.roomCodeBadge = root.querySelector<HTMLElement>("#game-room-code-badge")!;
    this.turnIndicator = root.querySelector<HTMLElement>("#game-turn-indicator")!;
    this.scoreX = root.querySelector<HTMLElement>("#game-score-x")!;
    this.scoreO = root.querySelector<HTMLElement>("#game-score-o")!;
    this.scoreDraws = root.querySelector<HTMLElement>("#game-score-draws")!;

    for (let i = 0; i < 9; i++) {
      const cell = root.querySelector<HTMLButtonElement>(`#game-cell-${i}`);
      if (cell !== null) {
        cell.addEventListener("click", () => onCellClick(i));
        this.cells.push(cell);
      }
    }
  }

  /**
   * @brief Sets the status banner text.
   * @param text Message to display.
   */
  setStatus(text: string): void {
    this.statusBanner.textContent = text;
  }

  /**
   * @brief Sets the room code badge text.
   * @param text Badge label.
   */
  setRoomBadge(text: string): void {
    this.roomCodeBadge.textContent = text;
  }

  /**
   * @brief Re-renders the board cells, winning highlights, and score counts.
   * @param board Current 9-cell board.
   * @param turn Current player turn ("X" or "O").
   * @param myRole Role of local player or null.
   * @param outcome Current game outcome.
   * @param scores Win/draw scores.
   * @param mode Current play mode.
   */
  update(
    board: BoardState,
    turn: PlayerMark,
    myRole: PlayerMark | null,
    outcome: GameOutcome,
    scores: GameScore,
    mode: GameMode,
  ): void {
    this.scoreX.textContent = String(scores.x);
    this.scoreO.textContent = String(scores.o);
    this.scoreDraws.textContent = String(scores.draws);
    this.turnIndicator.textContent = `Lượt: ${turn}`;

    const isMyTurn = mode !== "online" || turn === myRole;
    const isGameOver = outcome.winner !== null;

    for (let i = 0; i < 9; i++) {
      const cell = this.cells[i];
      if (!cell) continue;
      const val = board[i];
      const disabled = val !== null || isGameOver || !isMyTurn;
      this.updateCell(cell, i, val, outcome.line, disabled);
    }
  }

  /**
   * @brief Updates visual styles and state for a single board cell button.
   * @param cell Button element representing the cell.
   * @param index Cell index from 0 to 8.
   * @param val Value in cell ('X', 'O', or null).
   * @param line Winning line array if available.
   * @param disabled True if interaction is prohibited.
   */
  private updateCell(
    cell: HTMLButtonElement,
    index: number,
    val: PlayerMark | null,
    line: number[] | undefined,
    disabled: boolean,
  ): void {
    cell.textContent = val ?? "";
    cell.classList.remove("cell-x", "cell-o", "cell-win");
    if (val === "X") cell.classList.add("cell-x");
    if (val === "O") cell.classList.add("cell-o");
    if (line?.includes(index)) cell.classList.add("cell-win");
    cell.disabled = disabled;
  }
}
