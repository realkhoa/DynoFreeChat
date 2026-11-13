/**
 * @file sudoku/game.ts
 * @brief Sudoku: seeded generator, uniqueness-checked digger, solver, view and factory.
 * @details The solver is a bitmask backtracker with a most-constrained-cell
 * heuristic, so the same code powers "solve this grid" and the uniqueness counter
 * used while removing clues. No engine function touches `Math.random`.
 */
import type { GameMount } from "../mount";
/** @brief Edge length of a Sudoku grid. */
export const SUDOKU_SIZE = 9;
/** @brief Number of cells in a Sudoku grid. */
export const SUDOKU_CELLS = 81;
/** @brief Supported puzzle difficulties. */
export type SudokuDifficulty = "easy" | "normal" | "hard";
/** @brief Number of clues each difficulty keeps. */
export const SUDOKU_GIVENS: Readonly<Record<SudokuDifficulty, number>> = { easy: 40, normal: 32, hard: 26 };
/** @brief A generated puzzle: clues and the reference solution. */
export interface SudokuPuzzle {
  readonly difficulty: SudokuDifficulty;
  /** 81 row-major clues, `0` for a blank. */
  readonly givens: readonly number[];
  /** 81 row-major solution digits, 1 to 9. */
  readonly solution: readonly number[];
}
/** @brief Seeded random source returning values in `[0, 1)`. */
export type Rng = () => number;
/** Bits 1 through 9. */
const ALL_DIGITS = 0x3fe;
/** Difficulty buttons, in display order. */
const DIFFICULTIES: readonly SudokuDifficulty[] = ["easy", "normal", "hard"];
/**
 * @brief mulberry32: small, fast, deterministic PRNG for puzzle generation.
 * @param seed Any 32-bit integer.
 * @return Function yielding values in `[0, 1)`.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
/** Bit for one digit, 1 to 9. */
function digitBit(value: number): number {
  return 1 << value;
}
/** Number of set bits in a digit mask. */
function countBits(mask: number): number {
  let bits = mask;
  let total = 0;
  while (bits !== 0) {
    bits &= bits - 1;
    total += 1;
  }
  return total;
}
/** Box index of a row/column pair. */
function boxOf(row: number, column: number): number {
  return Math.floor(row / 3) * 3 + Math.floor(column / 3);
}
/** Shuffles a copy of the input with the supplied RNG. */
function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const left = copy[index];
    const right = copy[swap];
    if (left === undefined || right === undefined) continue;
    copy[index] = right;
    copy[swap] = left;
  }
  return copy;
}
/** Builds solver state, or `null` when the clues already contradict each other. */
function buildState(
  grid: readonly number[],
): { board: number[]; rows: number[]; columns: number[]; boxes: number[] } | null {
  if (grid.length !== SUDOKU_CELLS) return null;
  const board = new Array<number>(SUDOKU_CELLS).fill(0);
  const rows = new Array<number>(SUDOKU_SIZE).fill(0);
  const columns = new Array<number>(SUDOKU_SIZE).fill(0);
  const boxes = new Array<number>(SUDOKU_SIZE).fill(0);
  for (let index = 0; index < SUDOKU_CELLS; index += 1) {
    const value = grid[index] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > SUDOKU_SIZE) return null;
    if (value === 0) continue;
    const row = Math.floor(index / SUDOKU_SIZE);
    const column = index % SUDOKU_SIZE;
    const box = boxOf(row, column);
    const bit = digitBit(value);
    if (((rows[row] ?? 0) | (columns[column] ?? 0) | (boxes[box] ?? 0)) & bit) return null;
    board[index] = value;
    rows[row] = (rows[row] ?? 0) | bit;
    columns[column] = (columns[column] ?? 0) | bit;
    boxes[box] = (boxes[box] ?? 0) | bit;
  }
  return { board, rows, columns, boxes };
}
/** Enumerates up to `limit` solutions, calling `visit` with a fresh copy of each. */
function enumerateSolutions(
  grid: readonly number[],
  limit: number,
  visit: (solution: readonly number[]) => void,
): number {
  const state = buildState(grid);
  if (state === null) return 0;
  const { board, rows, columns, boxes } = state;
  let found = 0;
  const search = (): void => {
    if (found >= limit) return;
    let bestIndex = -1;
    let bestMask = 0;
    let bestCount = SUDOKU_SIZE + 1;
    for (let index = 0; index < SUDOKU_CELLS; index += 1) {
      if ((board[index] ?? 0) !== 0) continue;
      const used = (rows[Math.floor(index / SUDOKU_SIZE)] ?? 0) | (columns[index % SUDOKU_SIZE] ?? 0);
      const mask =
        ALL_DIGITS & ~(used | (boxes[boxOf(Math.floor(index / SUDOKU_SIZE), index % SUDOKU_SIZE)] ?? 0));
      const options = countBits(mask);
      if (options === 0) return;
      if (options < bestCount) {
        bestCount = options;
        bestIndex = index;
        bestMask = mask;
        if (options === 1) break;
      }
    }
    if (bestIndex === -1) {
      found += 1;
      visit([...board]);
      return;
    }
    const row = Math.floor(bestIndex / SUDOKU_SIZE);
    const column = bestIndex % SUDOKU_SIZE;
    const box = boxOf(row, column);
    let mask = bestMask;
    while (mask !== 0 && found < limit) {
      const bit = mask & -mask;
      mask ^= bit;
      const value = 31 - Math.clz32(bit);
      board[bestIndex] = value;
      rows[row] = (rows[row] ?? 0) | bit;
      columns[column] = (columns[column] ?? 0) | bit;
      boxes[box] = (boxes[box] ?? 0) | bit;
      search();
      board[bestIndex] = 0;
      rows[row] = (rows[row] ?? 0) & ~bit;
      columns[column] = (columns[column] ?? 0) & ~bit;
      boxes[box] = (boxes[box] ?? 0) & ~bit;
    }
  };
  search();
  return found;
}
/** @brief Solves a grid, returning the first solution or `null`. */
export function solveSudoku(grid: readonly number[]): number[] | null {
  const holder: { solution: number[] | null } = { solution: null };
  enumerateSolutions(grid, 1, (solution) => {
    holder.solution = [...solution];
  });
  return holder.solution;
}
/** @brief Counts solutions, stopping at `cap`; a cap of 2 proves uniqueness. */
export function countSudokuSolutions(grid: readonly number[], cap = 2): number {
  if (cap <= 0) return 0;
  return enumerateSolutions(grid, cap, () => undefined);
}
/** @brief Generates a complete valid grid from a seeded RNG. */
export function generateSudokuSolution(rng: Rng): number[] {
  const board = new Array<number>(SUDOKU_CELLS).fill(0);
  const rows = new Array<number>(SUDOKU_SIZE).fill(0);
  const columns = new Array<number>(SUDOKU_SIZE).fill(0);
  const boxes = new Array<number>(SUDOKU_SIZE).fill(0);
  const fill = (index: number): boolean => {
    if (index === SUDOKU_CELLS) return true;
    const row = Math.floor(index / SUDOKU_SIZE);
    const column = index % SUDOKU_SIZE;
    const box = boxOf(row, column);
    const used = (rows[row] ?? 0) | (columns[column] ?? 0) | (boxes[box] ?? 0);
    const candidates: number[] = [];
    for (let value = 1; value <= SUDOKU_SIZE; value += 1) {
      if ((used & digitBit(value)) === 0) candidates.push(value);
    }
    shuffle(candidates, rng);
    for (const value of candidates) {
      const bit = digitBit(value);
      board[index] = value;
      rows[row] = (rows[row] ?? 0) | bit;
      columns[column] = (columns[column] ?? 0) | bit;
      boxes[box] = (boxes[box] ?? 0) | bit;
      if (fill(index + 1)) return true;
      board[index] = 0;
      rows[row] = (rows[row] ?? 0) & ~bit;
      columns[column] = (columns[column] ?? 0) & ~bit;
      boxes[box] = (boxes[box] ?? 0) & ~bit;
    }
    return false;
  };
  if (!fill(0)) throw new Error("sudoku: failed to generate a complete grid");
  return board;
}
/** Counts non-zero clues. */
function countGivens(grid: readonly number[]): number {
  return grid.filter((value) => value !== 0).length;
}
/** Removes clues one at a time, keeping the puzzle uniquely solvable. */
function digSolution(solution: readonly number[], target: number, rng: Rng): number[] {
  const puzzle = [...solution];
  let remaining = countGivens(puzzle);
  const order = shuffle(
    Array.from({ length: SUDOKU_CELLS }, (_, index) => index),
    rng,
  );
  for (const index of order) {
    if (remaining <= target) break;
    const current = puzzle[index] ?? 0;
    if (current === 0) continue;
    puzzle[index] = 0;
    if (countSudokuSolutions(puzzle, 2) !== 1) puzzle[index] = current;
    else remaining -= 1;
  }
  return puzzle;
}
/** @brief Builds a puzzle deterministically from a seeded RNG and difficulty. */
export function generateSudokuPuzzle(rng: Rng, difficulty: SudokuDifficulty): SudokuPuzzle {
  const solution = generateSudokuSolution(rng);
  const target = SUDOKU_GIVENS[difficulty];
  let best = [...solution];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = digSolution(solution, target, rng);
    if (countGivens(candidate) < countGivens(best)) best = candidate;
    if (countGivens(best) <= target) break;
  }
  return { difficulty, givens: best, solution };
}
/** @brief Finds cells whose digit repeats inside its row, column or box. */
export function findSudokuConflicts(grid: readonly number[]): number[] {
  if (grid.length !== SUDOKU_CELLS) return [];
  const conflicts = new Set<number>();
  for (let index = 0; index < SUDOKU_CELLS; index += 1) {
    const value = grid[index] ?? 0;
    if (value === 0) continue;
    const row = Math.floor(index / SUDOKU_SIZE);
    const column = index % SUDOKU_SIZE;
    const startRow = Math.floor(row / 3) * 3;
    const startColumn = Math.floor(column / 3) * 3;
    for (let offset = 0; offset < SUDOKU_SIZE; offset += 1) {
      const peers = [
        row * SUDOKU_SIZE + offset,
        offset * SUDOKU_SIZE + column,
        (startRow + Math.floor(offset / 3)) * SUDOKU_SIZE + startColumn + (offset % 3),
      ];
      for (const peer of peers) {
        if (peer === index || (grid[peer] ?? 0) !== value) continue;
        conflicts.add(index);
        conflicts.add(peer);
      }
    }
  }
  return [...conflicts].sort((left, right) => left - right);
}
/** @brief Win check: every cell holds 1-9 and no digit repeats in a unit. */
export function isSudokuSolved(grid: readonly number[]): boolean {
  if (grid.length !== SUDOKU_CELLS) return false;
  for (let index = 0; index < SUDOKU_CELLS; index += 1) {
    const value = grid[index] ?? 0;
    if (value < 1 || value > SUDOKU_SIZE) return false;
  }
  return findSudokuConflicts(grid).length === 0;
}
/** Creates an element with a class and optional text. */
function makeElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
/** Creates a button so the board stays keyboard reachable. */
function makeButton(className: string, text = ""): HTMLButtonElement {
  const button = makeElement("button", className, text);
  button.type = "button";
  return button;
}
/** Resolves the row-major cell index from a delegated event, if any. */
function cellIndexFromEvent(event: Event): number | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return null;
  const raw = target.closest<HTMLElement>("[data-cell]")?.dataset.cell;
  if (raw === undefined) return null;
  const index = Number.parseInt(raw, 10);
  return Number.isNaN(index) ? null : index;
}
/**
 * @brief Creates the Sudoku game module.
 * @details All state lives in this closure, so the stage restarts by creating a
 * new instance. `mount` rebuilds from scratch and is safe to call twice.
 * @return A mountable Sudoku game.
 */
export function createSudokuGame(): GameMount {
  let difficulty: SudokuDifficulty = "normal";
  let seed = 1;
  let puzzle: SudokuPuzzle | null = null;
  let grid: number[] = new Array<number>(SUDOKU_CELLS).fill(0);
  let selected = 40;
  let hintsLeft = 3;
  let hinted = new Set<number>();
  let cleanups: Array<() => void> = [];
  let boardElement: HTMLElement | null = null;
  let hudElement: HTMLElement | null = null;
  let statusElement: HTMLElement | null = null;
  let hintButton: HTMLButtonElement | null = null;
  let difficultyButtons: HTMLButtonElement[] = [];
  let cellButtons: Array<HTMLButtonElement | undefined> = [];
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
  /** Whether the cell was part of the generated puzzle. */
  function isGiven(index: number): boolean {
    return puzzle !== null && (puzzle.givens[index] ?? 0) !== 0;
  }
  /** Builds the 81 clickable cells for the current puzzle. */
  function buildBoard(): void {
    if (boardElement === null) return;
    boardElement.style.gridTemplateColumns = `repeat(${SUDOKU_SIZE}, 44px)`;
    boardElement.replaceChildren();
    cellButtons = [];
    for (let index = 0; index < SUDOKU_CELLS; index += 1) {
      const cell = makeButton("stage-cell");
      cell.dataset.cell = String(index);
      cell.setAttribute("aria-label", `Cell ${index + 1}: empty`);
      cellButtons[index] = cell;
      boardElement.append(cell);
    }
  }
  /** Repaints cells, HUD and status from the current grid. */
  function paint(): void {
    if (puzzle === null || hudElement === null || statusElement === null) return;
    const conflicts = new Set(findSudokuConflicts(grid));
    const solved = isSudokuSolved(grid);
    for (let index = 0; index < cellButtons.length; index += 1) {
      const node = cellButtons[index];
      if (node === undefined) continue;
      const value = grid[index] ?? 0;
      const given = isGiven(index);
      const classes = ["stage-cell"];
      if (conflicts.has(index)) classes.push("is-warn");
      else if (given) classes.push("is-dim");
      else if (hinted.has(index)) classes.push("is-good");
      else if (selected === index) classes.push("is-primary");
      node.className = classes.join(" ");
      node.textContent = value === 0 ? "" : String(value);
      const row = Math.floor(index / SUDOKU_SIZE) + 1;
      const column = (index % SUDOKU_SIZE) + 1;
      const description = value === 0 ? "empty" : String(value);
      node.setAttribute(
        "aria-label",
        `Row ${row}, column ${column}: ${description}${given ? ", given" : ""}`,
      );
    }
    let filled = 0;
    for (const value of grid) if (value !== 0) filled += 1;
    const givens = puzzle.givens.filter((value) => value !== 0).length;
    hudElement.textContent = `${difficulty} · givens ${givens} · remaining ${SUDOKU_CELLS - filled} · hints ${hintsLeft}`;
    if (hintButton !== null) {
      hintButton.textContent = `Hint (${hintsLeft})`;
      hintButton.disabled = hintsLeft === 0 || solved;
    }
    for (const button of difficultyButtons) {
      button.classList.toggle("is-active", button.dataset.difficulty === difficulty);
    }
    if (solved) statusElement.textContent = "Solved — every row, column and box holds 1-9.";
    else if (conflicts.size > 0) statusElement.textContent = `${conflicts.size} cells conflict.`;
    else
      statusElement.textContent = `${SUDOKU_CELLS - filled} cells left · arrows move, 1-9 fills, Backspace clears.`;
  }
  /** Writes one player digit (0 clears), ignoring givens. */
  function writeValue(index: number, value: number): void {
    if (puzzle === null || index < 0 || index >= SUDOKU_CELLS || isGiven(index)) return;
    if ((grid[index] ?? 0) === value) return;
    grid[index] = value;
    hinted.delete(index);
    paint();
  }
  /** Moves the selection by one cell and focuses it. */
  function moveSelection(rowDelta: number, columnDelta: number): void {
    const row = Math.floor(selected / SUDOKU_SIZE) + rowDelta;
    const column = (selected % SUDOKU_SIZE) + columnDelta;
    if (row < 0 || row >= SUDOKU_SIZE || column < 0 || column >= SUDOKU_SIZE) return;
    selected = row * SUDOKU_SIZE + column;
    paint();
    cellButtons[selected]?.focus();
  }
  /** Reveals one solution cell, limited to three hints per puzzle. */
  function revealHint(): void {
    if (puzzle === null || hintsLeft <= 0) return;
    const target = grid.findIndex((value) => value === 0);
    const value = target === -1 ? undefined : puzzle.solution[target];
    if (value === undefined) return;
    grid[target] = value;
    hinted.add(target);
    hintsLeft -= 1;
    selected = target;
    paint();
  }
  /** Selects a cell with the mouse. */
  function handleBoardClick(event: Event): void {
    const index = cellIndexFromEvent(event);
    if (index === null) return;
    selected = index;
    paint();
  }
  /** Keyboard: digits fill, Backspace clears, arrows move the selection. */
  function handleKeydown(event: KeyboardEvent): void {
    if (puzzle === null) return;
    const key = event.key;
    if (/^[1-9]$/.test(key)) {
      event.preventDefault();
      writeValue(selected, Number.parseInt(key, 10));
      return;
    }
    if (key === "0" || key === "Backspace" || key === "Delete") {
      event.preventDefault();
      writeValue(selected, 0);
      return;
    }
    const moves: Readonly<Record<string, readonly [number, number]>> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[key];
    if (move === undefined) return;
    event.preventDefault();
    moveSelection(move[0], move[1]);
  }
  /** Loads the puzzle for `seed`, resetting player state. */
  function loadPuzzle(nextSeed: number): void {
    seed = nextSeed;
    puzzle = generateSudokuPuzzle(mulberry32(seed), difficulty);
    grid = [...puzzle.givens];
    hinted = new Set<number>();
    hintsLeft = 3;
    selected = 40;
    buildBoard();
    paint();
  }
  /** Switches difficulty, keeping the same solution. */
  function setDifficulty(next: SudokuDifficulty): void {
    if (difficulty === next) return;
    difficulty = next;
    loadPuzzle(seed);
  }
  /** Builds toolbar, board, number pad, HUD and status inside the host. */
  function buildUi(host: HTMLElement): void {
    const bar = makeElement("div", "stage-bar");
    bar.append(makeElement("span", "", "difficulty"));
    difficultyButtons = [];
    for (const level of DIFFICULTIES) {
      const button = makeButton("stage-btn", level);
      button.dataset.difficulty = level;
      listen(button, "click", () => setDifficulty(level));
      difficultyButtons.push(button);
      bar.append(button);
    }
    const next = makeButton("stage-btn", "New puzzle");
    next.dataset.action = "new";
    listen(next, "click", () => loadPuzzle(seed + 1));
    hintButton = makeButton("stage-btn", "Hint (3)");
    hintButton.dataset.action = "hint";
    listen(hintButton, "click", revealHint);
    bar.append(next, hintButton);
    boardElement = makeElement("div", "stage-board");
    boardElement.setAttribute("role", "grid");
    boardElement.setAttribute("aria-label", "Sudoku board");
    listen(boardElement, "click", handleBoardClick);
    const pad = makeElement("div", "stage-rows");
    const padRow = makeElement("div", "stage-row");
    for (let digit = 1; digit <= SUDOKU_SIZE; digit += 1) {
      const button = makeButton("stage-cell", String(digit));
      button.dataset.digit = String(digit);
      button.setAttribute("aria-label", `Fill ${digit}`);
      listen(button, "click", () => writeValue(selected, digit));
      padRow.append(button);
    }
    const clearButton = makeButton("stage-btn", "Clear");
    clearButton.dataset.action = "clear";
    listen(clearButton, "click", () => writeValue(selected, 0));
    padRow.append(clearButton);
    pad.append(padRow);
    statusElement = makeElement("div", "stage-status");
    host.append(bar, hudElement ?? makeElement("span", "stage-hud"), boardElement, pad, statusElement);
    listen(host, "keydown", handleKeydown);
  }
  return {
    mount(host: HTMLElement): void {
      detach();
      host.replaceChildren();
      difficulty = "normal";
      seed = 1;
      hintsLeft = 3;
      hinted = new Set<number>();
      hudElement = makeElement("span", "stage-hud");
      buildUi(host);
      loadPuzzle(seed);
    },
    unmount(): void {
      detach();
      boardElement = null;
      hudElement = null;
      statusElement = null;
      hintButton = null;
      difficultyButtons = [];
      cellButtons = [];
    },
  };
}
