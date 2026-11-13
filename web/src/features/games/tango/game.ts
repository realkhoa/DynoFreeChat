/**
 * @file tango/game.ts
 * @brief Tango: a 6x6 sun/moon grid with line, relation and given constraints.
 * @details The engine derives a full solution from a seeded RNG, builds the givens
 * and relation markers from it, and validates player grids. The view renders the
 * markers between cells by interleaving marker slots into the CSS grid.
 */

import type { GameMount } from "../mount";

/** @brief Edge length of every Tango board. */
export const TANGO_SIZE = 6;

/** @brief Suns (and moons) required in every row and every column. */
export const TANGO_LINE_TARGET = 3;

/** @brief Smallest number of pre-filled cells a generated puzzle keeps. */
export const TANGO_MIN_GIVENS = 8;

/** @brief Largest number of pre-filled cells a generated puzzle keeps. */
export const TANGO_MAX_GIVENS = 10;

/** @brief Smallest number of relation markers a generated puzzle keeps. */
export const TANGO_MIN_RELATIONS = 6;

/** @brief Largest number of relation markers a generated puzzle keeps. */
export const TANGO_MAX_RELATIONS = 8;

/** @brief One filled grid value. */
export type TangoValue = "sun" | "moon";

/** @brief One grid cell; `null` is empty. */
export type TangoCell = TangoValue | null;

/** @brief Direction a relation marker points from its anchor cell. */
export type TangoDirection = "horizontal" | "vertical";

/** @brief Relation between two adjacent cells: same value or different values. */
export type TangoRelationKind = "same" | "different";

/** @brief Marker between an anchor cell and its right or lower neighbour. */
export interface TangoRelation {
  readonly row: number;
  readonly column: number;
  readonly direction: TangoDirection;
  /** `same` renders `==`, `different` renders `!=`. */
  readonly kind: TangoRelationKind;
}

/** @brief A generated puzzle: full solution, givens and relation markers. */
export interface TangoPuzzle {
  /** Seed the puzzle was generated from; also used as the puzzle number. */
  readonly seed: number;
  /** Complete valid solution, row-major. */
  readonly solution: readonly TangoValue[];
  /** Pre-filled cells; `null` where the player fills. */
  readonly givens: readonly TangoCell[];
  /** Relation markers derived from the solution. */
  readonly relations: readonly TangoRelation[];
}

/** @brief Why a grid is not a valid solution. */
export type TangoViolationKind = "triple" | "balance" | "relation" | "given";

/** @brief One rule violation and the cells that break it. */
export interface TangoViolation {
  readonly kind: TangoViolationKind;
  readonly cells: readonly number[];
}

/** @brief Seeded random source returning values in `[0, 1)`. */
export type Rng = () => number;

/** Known-good grid used if a pathological seed dead-ends the search. */
const FALLBACK_SOLUTION: readonly TangoValue[] = ["SSMMSM", "SMSMMS", "MSMSSM", "MMSSMS", "SMSMSM", "MSMSMS"]
  .join("")
  .split("")
  .map((letter) => (letter === "S" ? "sun" : "moon"));

/** Glyph rendered for each value. */
const GLYPHS: Record<TangoValue, string> = { sun: "☀", moon: "☾" };

/** @brief mulberry32: small, fast, deterministic PRNG for puzzle generation. */
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

/** @brief Row-major index of one grid cell. */
export function tangoIndex(row: number, column: number): number {
  return row * TANGO_SIZE + column;
}

/** @brief Cycles a cell empty → sun → moon → empty. */
export function cycleTangoValue(value: TangoCell): TangoCell {
  if (value === null) return "sun";
  return value === "sun" ? "moon" : null;
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

/** @brief Generates a complete grid that satisfies every Tango constraint. */
export function generateTangoSolution(rng: Rng): TangoValue[] {
  const cells = new Array<TangoCell>(TANGO_SIZE * TANGO_SIZE).fill(null);
  const rowSuns = new Array<number>(TANGO_SIZE).fill(0);
  const rowMoons = new Array<number>(TANGO_SIZE).fill(0);
  const columnSuns = new Array<number>(TANGO_SIZE).fill(0);
  const columnMoons = new Array<number>(TANGO_SIZE).fill(0);
  let budget = 250000;

  const fits = (index: number, value: TangoValue): boolean => {
    const row = Math.floor(index / TANGO_SIZE);
    const column = index % TANGO_SIZE;
    const suns = value === "sun" ? rowSuns : rowMoons;
    const columns = value === "sun" ? columnSuns : columnMoons;
    if ((suns[row] ?? 0) >= TANGO_LINE_TARGET) return false;
    if ((columns[column] ?? 0) >= TANGO_LINE_TARGET) return false;
    if (column >= 2 && cells[index - 1] === value && cells[index - 2] === value) return false;
    if (row >= 2 && cells[index - TANGO_SIZE] === value && cells[index - 2 * TANGO_SIZE] === value) {
      return false;
    }
    return true;
  };

  const write = (index: number, value: TangoValue, delta: 1 | -1): void => {
    cells[index] = delta === 1 ? value : null;
    const row = Math.floor(index / TANGO_SIZE);
    const column = index % TANGO_SIZE;
    const sun = value === "sun" ? 1 : 0;
    rowSuns[row] = (rowSuns[row] ?? 0) + delta * sun;
    rowMoons[row] = (rowMoons[row] ?? 0) + delta * (1 - sun);
    columnSuns[column] = (columnSuns[column] ?? 0) + delta * sun;
    columnMoons[column] = (columnMoons[column] ?? 0) + delta * (1 - sun);
  };

  const search = (index: number): boolean => {
    if (index === cells.length) return true;
    if (budget <= 0) return false;
    budget -= 1;
    const row = Math.floor(index / TANGO_SIZE);
    const column = index % TANGO_SIZE;
    const order: readonly TangoValue[] = rng() < 0.5 ? ["sun", "moon"] : ["moon", "sun"];
    for (const value of order) {
      if (!fits(index, value)) continue;
      const suns = (rowSuns[row] ?? 0) + (value === "sun" ? 1 : 0);
      if (column === TANGO_SIZE - 1 && suns !== TANGO_LINE_TARGET) continue;
      write(index, value, 1);
      if (search(index + 1)) return true;
      write(index, value, -1);
    }
    return false;
  };

  if (!search(0)) return [...FALLBACK_SOLUTION];
  return cells.filter((cell): cell is TangoValue => cell !== null);
}

/** @brief Builds a puzzle deterministically from a seed. */
export function createTangoPuzzle(seed: number): TangoPuzzle {
  const rng = mulberry32(seed);
  const solution = generateTangoSolution(rng);
  const givens = new Array<TangoCell>(TANGO_SIZE * TANGO_SIZE).fill(null);

  const givenCount = TANGO_MIN_GIVENS + Math.floor(rng() * (TANGO_MAX_GIVENS - TANGO_MIN_GIVENS + 1));
  const order = shuffle(
    Array.from({ length: TANGO_SIZE * TANGO_SIZE }, (_, index) => index),
    rng,
  );
  for (const index of order.slice(0, givenCount)) givens[index] = solution[index] ?? null;

  const candidates: TangoRelation[] = [];
  for (let index = 0; index < TANGO_SIZE * TANGO_SIZE; index += 1) {
    const row = Math.floor(index / TANGO_SIZE);
    const column = index % TANGO_SIZE;
    const value = solution[index];
    if (value === undefined) continue;
    const right = column + 1 < TANGO_SIZE ? solution[index + 1] : undefined;
    if (right !== undefined) {
      candidates.push({
        row,
        column,
        direction: "horizontal",
        kind: right === value ? "same" : "different",
      });
    }
    const below = row + 1 < TANGO_SIZE ? solution[index + TANGO_SIZE] : undefined;
    if (below !== undefined) {
      candidates.push({ row, column, direction: "vertical", kind: below === value ? "same" : "different" });
    }
  }

  const count = TANGO_MIN_RELATIONS + Math.floor(rng() * (TANGO_MAX_RELATIONS - TANGO_MIN_RELATIONS + 1));
  const relations = shuffle(candidates, rng).slice(0, count);
  relations.sort((left, right) => {
    const byCell = tangoIndex(left.row, left.column) - tangoIndex(right.row, right.column);
    if (byCell !== 0) return byCell;
    if (left.direction === right.direction) return 0;
    return left.direction < right.direction ? -1 : 1;
  });

  return { seed, solution, givens, relations };
}

/** Reports one balance violation when a line holds more than three of a value. */
function balanceViolation(cells: readonly TangoCell[], indexes: readonly number[]): TangoViolation | null {
  const sunCells: number[] = [];
  const moonCells: number[] = [];
  for (const index of indexes) {
    if (cells[index] === "sun") sunCells.push(index);
    else if (cells[index] === "moon") moonCells.push(index);
  }
  if (sunCells.length > TANGO_LINE_TARGET) return { kind: "balance", cells: sunCells };
  if (moonCells.length > TANGO_LINE_TARGET) return { kind: "balance", cells: moonCells };
  return null;
}

/** @brief Validates a player grid against the Tango rules. */
export function findTangoViolations(
  grid: readonly TangoCell[],
  relations: readonly TangoRelation[] = [],
  givens: readonly TangoCell[] = [],
): TangoViolation[] {
  const violations: TangoViolation[] = [];
  const at = (index: number): TangoCell => grid[index] ?? null;
  const triple = (first: number, second: number, third: number): void => {
    const value = at(first);
    if (value !== null && value === at(second) && value === at(third)) {
      violations.push({ kind: "triple", cells: [first, second, third] });
    }
  };

  for (let row = 0; row < TANGO_SIZE; row += 1) {
    for (let column = 0; column + 2 < TANGO_SIZE; column += 1) {
      const first = row * TANGO_SIZE + column;
      triple(first, first + 1, first + 2);
    }
  }
  for (let column = 0; column < TANGO_SIZE; column += 1) {
    for (let row = 0; row + 2 < TANGO_SIZE; row += 1) {
      const first = row * TANGO_SIZE + column;
      triple(first, first + TANGO_SIZE, first + 2 * TANGO_SIZE);
    }
  }

  for (const vertical of [false, true]) {
    for (let line = 0; line < TANGO_SIZE; line += 1) {
      const indexes = Array.from({ length: TANGO_SIZE }, (_, offset) =>
        vertical ? offset * TANGO_SIZE + line : line * TANGO_SIZE + offset,
      );
      const violation = balanceViolation(grid, indexes);
      if (violation !== null) violations.push(violation);
    }
  }

  for (const relation of relations) {
    const anchor = tangoIndex(relation.row, relation.column);
    const neighbour = relation.direction === "horizontal" ? anchor + 1 : anchor + TANGO_SIZE;
    const left = at(anchor);
    const right = at(neighbour);
    if (left === null || right === null) continue;
    if ((relation.kind === "same") !== (left === right)) {
      violations.push({ kind: "relation", cells: [anchor, neighbour] });
    }
  }

  for (let index = 0; index < TANGO_SIZE * TANGO_SIZE; index += 1) {
    const expected = givens[index] ?? null;
    const actual = at(index);
    if (expected !== null && actual !== null && expected !== actual) {
      violations.push({ kind: "given", cells: [index] });
    }
  }

  return violations;
}

/** @brief Win check: every cell filled, no violations, every line exactly balanced. */
export function isTangoSolved(
  grid: readonly TangoCell[],
  relations: readonly TangoRelation[] = [],
  givens: readonly TangoCell[] = [],
): boolean {
  if (grid.length !== TANGO_SIZE * TANGO_SIZE) return false;
  for (let index = 0; index < grid.length; index += 1) {
    if ((grid[index] ?? null) === null) return false;
  }
  if (findTangoViolations(grid, relations, givens).length > 0) return false;

  const sunsIn = (indexes: readonly number[]): number =>
    indexes.filter((index) => grid[index] === "sun").length;
  for (let line = 0; line < TANGO_SIZE; line += 1) {
    const row = Array.from({ length: TANGO_SIZE }, (_, offset) => line * TANGO_SIZE + offset);
    const column = Array.from({ length: TANGO_SIZE }, (_, offset) => offset * TANGO_SIZE + line);
    if (sunsIn(row) !== TANGO_LINE_TARGET || sunsIn(column) !== TANGO_LINE_TARGET) return false;
  }
  return true;
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

/** @brief Creates the Tango game module, with all state inside the closure. */
export function createTangoGame(): GameMount {
  let seed = 1;
  let puzzle: TangoPuzzle | null = null;
  let grid: TangoCell[] = [];
  let selected: number | null = null;
  let cleanups: Array<() => void> = [];
  let boardElement: HTMLElement | null = null;
  let hudElement: HTMLElement | null = null;
  let statusElement: HTMLElement | null = null;
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

  /** Builds the 11x11 slot grid: cells on even coordinates, markers in between. */
  function buildBoard(): void {
    if (boardElement === null || puzzle === null) return;
    boardElement.style.gridTemplateColumns = `repeat(${TANGO_SIZE * 2 - 1}, 44px)`;
    boardElement.replaceChildren();
    cellButtons = [];

    const markers = new Map<string, TangoRelationKind>();
    for (const relation of puzzle.relations) {
      markers.set(`${relation.row}:${relation.column}:${relation.direction}`, relation.kind);
    }

    const slots = TANGO_SIZE * 2 - 1;
    for (let slot = 0; slot < slots * slots; slot += 1) {
      const slotRow = Math.floor(slot / slots);
      const slotColumn = slot % slots;
      const evenRow = slotRow % 2 === 0;
      const evenColumn = slotColumn % 2 === 0;
      if (evenRow && evenColumn) {
        const index = tangoIndex(slotRow / 2, slotColumn / 2);
        const cell = makeButton("stage-cell");
        cell.dataset.cell = String(index);
        cell.setAttribute("aria-label", `Cell ${index + 1}`);
        cellButtons[index] = cell;
        boardElement.append(cell);
        continue;
      }
      const key = evenRow
        ? `${slotRow / 2}:${(slotColumn - 1) / 2}:horizontal`
        : evenColumn
          ? `${(slotRow - 1) / 2}:${slotColumn / 2}:vertical`
          : "";
      const kind = markers.get(key);
      const label = kind === "same" ? "==" : kind === "different" ? "!=" : "";
      const marker = makeElement("span", "stage-cell is-muted", label);
      marker.setAttribute("aria-hidden", "true");
      boardElement.append(marker);
    }
  }

  /** Repaints cells, HUD and status from the current grid. */
  function paint(): void {
    if (puzzle === null || hudElement === null || statusElement === null) return;
    const violations = findTangoViolations(grid, puzzle.relations, puzzle.givens);
    const flagged = new Set<number>();
    for (const violation of violations) for (const index of violation.cells) flagged.add(index);
    const solved = isTangoSolved(grid, puzzle.relations, puzzle.givens);

    for (let index = 0; index < cellButtons.length; index += 1) {
      const node = cellButtons[index];
      if (node === undefined) continue;
      const value = grid[index] ?? null;
      const given = (puzzle.givens[index] ?? null) !== null;
      const classes = ["stage-cell"];
      if (flagged.has(index)) classes.push("is-warn");
      else if (given) classes.push("is-dim");
      else if (selected === index) classes.push("is-primary");
      node.className = classes.join(" ");
      node.textContent = value === null ? "" : GLYPHS[value];
      const row = Math.floor(index / TANGO_SIZE) + 1;
      const column = (index % TANGO_SIZE) + 1;
      const description = value === null ? "empty" : value;
      node.setAttribute(
        "aria-label",
        `Row ${row}, column ${column}: ${description}${given ? ", given" : ""}`,
      );
    }

    const suns = grid.filter((cell) => cell === "sun").length;
    const moons = grid.filter((cell) => cell === "moon").length;
    const givens = puzzle.givens.filter((cell) => cell !== null).length;
    hudElement.textContent = `puzzle #${puzzle.seed} · suns ${suns} · moons ${moons} · givens ${givens}`;

    if (solved) statusElement.textContent = "Solved — every line has 3 suns and 3 moons.";
    else if (violations.length > 0) statusElement.textContent = `${violations.length} rule violations.`;
    else statusElement.textContent = "Click cycles sun → moon → empty; keys 1, 2 and 0 do the same.";
  }

  /** Selects a cell, writes it when it is not a given, then repaints. */
  function applyCell(index: number, value: TangoCell): void {
    selected = index;
    if (puzzle !== null && index >= 0 && index < grid.length && (puzzle.givens[index] ?? null) === null) {
      grid[index] = value;
    }
    paint();
  }

  /** Click delegation on the board. */
  function handleBoardClick(event: Event): void {
    const index = cellIndexFromEvent(event);
    if (index === null) return;
    applyCell(index, cycleTangoValue(grid[index] ?? null));
  }

  /** Keyboard: 1 sun, 2 moon, 0/Backspace clear, on the selected or focused cell. */
  function handleKeydown(event: KeyboardEvent): void {
    if (puzzle === null) return;
    const target = event.target;
    const raw =
      target instanceof HTMLElement ? target.closest<HTMLElement>("[data-cell]")?.dataset.cell : undefined;
    if (raw !== undefined) selected = Number.parseInt(raw, 10);
    if (selected === null) return;

    const key = event.key;
    const value =
      key === "1"
        ? "sun"
        : key === "2"
          ? "moon"
          : key === "0" || key === "Backspace" || key === "Delete"
            ? null
            : undefined;
    if (value === undefined) return;
    event.preventDefault();
    applyCell(selected, value);
  }

  /** Loads the next seeded puzzle and rebuilds the board. */
  function newPuzzle(): void {
    seed += 1;
    puzzle = createTangoPuzzle(seed);
    grid = [...puzzle.givens];
    selected = null;
    buildBoard();
    paint();
  }

  /** Builds toolbar, board, HUD and status inside the host. */
  function buildUi(host: HTMLElement): void {
    const bar = makeElement("div", "stage-bar");
    const next = makeButton("stage-btn", "New puzzle");
    next.dataset.action = "new";
    listen(next, "click", newPuzzle);
    bar.append(next, makeElement("span", "", "== same"), makeElement("span", "", "!= different"));

    boardElement = makeElement("div", "stage-board");
    boardElement.setAttribute("role", "grid");
    boardElement.setAttribute("aria-label", "Tango board");
    listen(boardElement, "click", handleBoardClick);

    hudElement = makeElement("span", "stage-hud");
    statusElement = makeElement("div", "stage-status");
    host.append(bar, hudElement, boardElement, statusElement);
    listen(host, "keydown", handleKeydown);
  }

  return {
    mount(host: HTMLElement): void {
      detach();
      host.replaceChildren();
      seed = 1;
      puzzle = createTangoPuzzle(seed);
      grid = [...puzzle.givens];
      selected = null;
      buildUi(host);
      buildBoard();
      paint();
    },

    unmount(): void {
      detach();
      boardElement = null;
      hudElement = null;
      statusElement = null;
      cellButtons = [];
    },
  };
}
