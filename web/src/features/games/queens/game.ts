/**
 * @file queens/game.ts
 * @brief N-Queens placement puzzle: pure engine, DOM board and game factory.
 * @details The board is immutable, so undo is a stack of snapshots and every rule
 * check is a pure function tests can call without a DOM. A blocked mark is a
 * player aid only: it never satisfies a row, column or diagonal.
 */

import type { GameMount } from "../mount";

/** @brief Smallest board the size picker offers. */
export const QUEENS_MIN_SIZE = 4;

/** @brief Largest board the size picker offers. */
export const QUEENS_MAX_SIZE = 8;

/** @brief One square of a Queens board. */
export type QueensCell = "empty" | "queen" | "blocked";

/** @brief Immutable Queens board; `cells` is row-major. */
export interface QueensBoard {
  /** Side length, 4 to 8. */
  readonly size: number;
  /** Row-major cells. */
  readonly cells: readonly QueensCell[];
}

/**
 * @brief Creates an empty board, clamping the side to {@link QUEENS_MIN_SIZE}–{@link QUEENS_MAX_SIZE}.
 * @param size Requested side length.
 * @return Fresh board.
 */
export function createQueensBoard(size: number): QueensBoard {
  const side = Math.min(QUEENS_MAX_SIZE, Math.max(QUEENS_MIN_SIZE, Math.trunc(size)));
  return { size: side, cells: new Array<QueensCell>(side * side).fill("empty") };
}

/**
 * @brief Replaces one cell without mutating the source board.
 * @param board Source board.
 * @param index Row-major cell index.
 * @param cell New cell value.
 * @return The new board, or the source board when the index is out of range.
 */
export function setQueensCell(board: QueensBoard, index: number, cell: QueensCell): QueensBoard {
  if (index < 0 || index >= board.cells.length) return board;
  const cells = [...board.cells];
  cells[index] = cell;
  return { size: board.size, cells };
}

/**
 * @brief Toggles a queen: an empty or blocked cell becomes a queen, a queen becomes empty.
 * @param board Source board.
 * @param index Row-major cell index.
 * @return The new board.
 */
export function toggleQueen(board: QueensBoard, index: number): QueensBoard {
  const current = board.cells[index] ?? "empty";
  return setQueensCell(board, index, current === "queen" ? "empty" : "queen");
}

/**
 * @brief Toggles the blocked mark; marking a queen replaces it with the mark.
 * @param board Source board.
 * @param index Row-major cell index.
 * @return The new board.
 */
export function toggleBlocked(board: QueensBoard, index: number): QueensBoard {
  const current = board.cells[index] ?? "empty";
  return setQueensCell(board, index, current === "blocked" ? "empty" : "blocked");
}

/**
 * @brief Indexes of every placed queen, in row-major order.
 * @param board Source board.
 * @return Queen indexes.
 */
export function queenIndices(board: QueensBoard): number[] {
  const indices: number[] = [];
  for (let index = 0; index < board.cells.length; index += 1) {
    if (board.cells[index] === "queen") indices.push(index);
  }
  return indices;
}

/**
 * @brief Counts placed queens.
 * @param board Source board.
 * @return Number of queens on the board.
 */
export function queenCount(board: QueensBoard): number {
  return queenIndices(board).length;
}

/**
 * @brief Finds every queen that shares a row, column or diagonal with another queen.
 * @details Diagonals are checked across the whole board, which also covers the
 * adjacent-diagonal rule.
 * @param board Source board.
 * @return Sorted, de-duplicated indexes; empty when the placement is peaceful.
 */
export function findQueensConflicts(board: QueensBoard): number[] {
  const queens = queenIndices(board);
  const conflicts = new Set<number>();
  for (let first = 0; first < queens.length; first += 1) {
    const left = queens[first];
    if (left === undefined) continue;
    const leftRow = Math.floor(left / board.size);
    const leftColumn = left % board.size;
    for (let second = first + 1; second < queens.length; second += 1) {
      const right = queens[second];
      if (right === undefined) continue;
      const rightRow = Math.floor(right / board.size);
      const rightColumn = right % board.size;
      const sameRow = leftRow === rightRow;
      const sameColumn = leftColumn === rightColumn;
      const sameDiagonal = Math.abs(leftRow - rightRow) === Math.abs(leftColumn - rightColumn);
      if (!sameRow && !sameColumn && !sameDiagonal) continue;
      conflicts.add(left);
      conflicts.add(right);
    }
  }
  return [...conflicts].sort((a, b) => a - b);
}

/**
 * @brief Win check: exactly one queen per row and column, no two queens attacking.
 * @param board Source board.
 * @return True when the board is solved.
 */
export function isQueensSolved(board: QueensBoard): boolean {
  const queens = queenIndices(board);
  if (queens.length !== board.size) return false;

  const rows = new Set<number>();
  const columns = new Set<number>();
  for (const index of queens) {
    const row = Math.floor(index / board.size);
    const column = index % board.size;
    if (rows.has(row) || columns.has(column)) return false;
    rows.add(row);
    columns.add(column);
  }
  return findQueensConflicts(board).length === 0;
}

/** Reads one cell, tolerating a stale index after a resize. */
function cellAt(board: QueensBoard, index: number): QueensCell {
  return board.cells[index] ?? "empty";
}

/** Human readable cell description used by the aria-label. */
function describeCell(cell: QueensCell, conflict: boolean): string {
  if (cell === "queen") return conflict ? "queen, conflicts" : "queen";
  return cell === "blocked" ? "blocked" : "empty";
}

/** Creates a button with a class and optional text. */
function makeButton(className: string, text = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  return element;
}

/** Creates a span with a class and optional text. */
function makeSpan(className: string, text = ""): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

/** Resolves the row-major cell index from a delegated event, if any. */
function cellIndexFromEvent(event: Event): number | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return null;
  const owner = target.closest<HTMLElement>("[data-cell]");
  const raw = owner?.dataset.cell;
  if (raw === undefined) return null;
  const index = Number.parseInt(raw, 10);
  return Number.isNaN(index) ? null : index;
}

/**
 * @brief Creates the Queens game module.
 * @details The factory owns all mutable state, so the stage restarts the game by
 * creating a new instance. `mount` is idempotent: it tears down the previous
 * listeners and board before rebuilding.
 * @return A mountable Queens game.
 */
export function createQueensGame(): GameMount {
  let size = 6;
  let board = createQueensBoard(size);
  let flagMode = false;
  let history: QueensBoard[] = [];
  let cleanups: Array<() => void> = [];

  let boardElement: HTMLElement | null = null;
  let hudElement: HTMLElement | null = null;
  let statusElement: HTMLElement | null = null;
  let flagButton: HTMLButtonElement | null = null;
  let undoButton: HTMLButtonElement | null = null;
  let sizeButtons: HTMLButtonElement[] = [];
  let cellButtons: HTMLButtonElement[] = [];

  /** Registers a listener and remembers how to remove it. */
  function listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    const wrapped = handler as EventListener;
    target.addEventListener(type, wrapped);
    cleanups.push(() => target.removeEventListener(type, wrapped));
  }

  /** Removes every listener registered by the current mount. */
  function detach(): void {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
  }

  /** Pushes the current board onto the undo stack. */
  function snapshot(): void {
    history.push(board);
    if (history.length > 120) history.shift();
  }

  /** Applies a board change through the undo stack. */
  function apply(next: QueensBoard): void {
    snapshot();
    board = next;
    paint();
  }

  /** Rebuilds the clickable board for the current size. */
  function buildBoard(): void {
    if (boardElement === null) return;
    boardElement.style.gridTemplateColumns = `repeat(${size}, 44px)`;
    boardElement.replaceChildren();
    cellButtons = [];
    for (let index = 0; index < size * size; index += 1) {
      const cell = makeButton("stage-cell");
      cell.dataset.cell = String(index);
      cell.setAttribute("aria-label", `Cell ${index + 1}: empty`);
      cellButtons.push(cell);
      boardElement.append(cell);
    }
  }

  /** Repaints every cell, the HUD and the status line from `board`. */
  function paint(): void {
    if (boardElement === null || hudElement === null || statusElement === null) return;
    const conflicts = new Set(findQueensConflicts(board));
    const queens = queenCount(board);
    const blocked = board.cells.filter((cell) => cell === "blocked").length;
    const solved = isQueensSolved(board);

    for (let index = 0; index < cellButtons.length; index += 1) {
      const node = cellButtons[index];
      if (node === undefined) continue;
      const cell = cellAt(board, index);
      const row = Math.floor(index / board.size) + 1;
      const column = (index % board.size) + 1;
      const conflict = conflicts.has(index);
      const classes = ["stage-cell"];
      if (cell === "queen") classes.push(conflict ? "is-warn" : "is-primary");
      else if (cell === "blocked") classes.push("is-muted");
      node.className = classes.join(" ");
      node.textContent = cell === "queen" ? "Q" : cell === "blocked" ? "x" : "";
      node.setAttribute("aria-label", `Row ${row}, column ${column}: ${describeCell(cell, conflict)}`);
    }

    hudElement.replaceChildren(
      makeStat("queens", `${queens}/${board.size}`),
      makeStat("conflicts", String(conflicts.size)),
      makeStat("blocked", String(blocked)),
      makeStat("mode", flagMode ? "flag" : "queen"),
    );
    if (undoButton !== null) undoButton.disabled = history.length === 0;
    if (flagButton !== null) flagButton.classList.toggle("is-active", flagMode);
    for (const option of sizeButtons) {
      option.classList.toggle("is-active", option.dataset.size === String(board.size));
    }

    if (solved) statusElement.textContent = `Solved — ${board.size} queens, no attacks.`;
    else if (conflicts.size > 0) statusElement.textContent = `${conflicts.size} cells conflict.`;
    else statusElement.textContent = `${queens}/${board.size} queens · right-click marks a blocked cell.`;
  }

  /** HUD entry with a bold value. */
  function makeStat(label: string, value: string): HTMLSpanElement {
    const node = makeSpan("", `${label} `);
    const strong = document.createElement("b");
    strong.textContent = value;
    node.append(strong);
    return node;
  }

  /** Switches the board size and clears the board. */
  function setSize(next: number): void {
    if (next === size) return;
    size = next;
    board = createQueensBoard(size);
    history = [];
    buildBoard();
    paint();
  }

  /** Undoes the last board change. */
  function undo(): void {
    const previous = history.pop();
    if (previous === undefined) return;
    board = previous;
    paint();
  }

  /** Clears queens and marks, keeping the undo history. */
  function clear(): void {
    snapshot();
    board = createQueensBoard(size);
    paint();
  }

  /** Applies a left click: toggle a queen, or a block while flag mode is on. */
  function handleCellClick(event: Event): void {
    const index = cellIndexFromEvent(event);
    if (index === null) return;
    apply(flagMode ? toggleBlocked(board, index) : toggleQueen(board, index));
  }

  /** Applies a right click: always toggles the blocked mark. */
  function handleCellContextMenu(event: Event): void {
    const index = cellIndexFromEvent(event);
    if (index === null) return;
    event.preventDefault();
    apply(toggleBlocked(board, index));
  }

  /** Builds the toolbar, board, HUD and status line inside the host. */
  function buildUi(host: HTMLElement): void {
    const bar = document.createElement("div");
    bar.className = "stage-bar";
    bar.append(makeSpan("", "size"));

    sizeButtons = [];
    for (let option = QUEENS_MIN_SIZE; option <= QUEENS_MAX_SIZE; option += 1) {
      const button = makeButton("stage-btn", String(option));
      button.dataset.size = String(option);
      button.setAttribute("aria-label", `Board size ${option}`);
      listen(button, "click", () => setSize(option));
      sizeButtons.push(button);
      bar.append(button);
    }

    flagButton = makeButton("stage-btn", "Flag");
    flagButton.dataset.action = "flag";
    flagButton.setAttribute("aria-label", "Toggle blocked-cell marking");
    listen(flagButton, "click", () => {
      flagMode = !flagMode;
      paint();
    });

    undoButton = makeButton("stage-btn", "Undo");
    undoButton.dataset.action = "undo";
    listen(undoButton, "click", undo);

    const clearButton = makeButton("stage-btn", "Clear");
    clearButton.dataset.action = "clear";
    listen(clearButton, "click", clear);

    bar.append(flagButton, undoButton, clearButton);

    boardElement = document.createElement("div");
    boardElement.className = "stage-board";
    boardElement.setAttribute("role", "grid");
    boardElement.setAttribute("aria-label", "Queens board");

    statusElement = document.createElement("div");
    statusElement.className = "stage-status";

    listen(boardElement, "click", handleCellClick);
    listen(boardElement, "contextmenu", handleCellContextMenu);

    host.append(bar, hudElement ?? makeSpan("stage-hud"), boardElement, statusElement);
  }

  return {
    mount(host: HTMLElement): void {
      detach();
      host.replaceChildren();
      size = 6;
      flagMode = false;
      history = [];
      board = createQueensBoard(size);
      hudElement = makeSpan("stage-hud");
      buildUi(host);
      buildBoard();
      paint();
    },

    unmount(): void {
      detach();
      boardElement = null;
      hudElement = null;
      statusElement = null;
      flagButton = null;
      undoButton = null;
      sizeButtons = [];
      cellButtons = [];
    },
  };
}
