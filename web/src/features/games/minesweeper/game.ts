/**
 * @file game.ts
 * @brief Minesweeper: first-click-safe placement, flood reveal and flagging.
 * @details The field is plain data and every rule is a pure function, so the tests
 * never need a DOM. Mines are placed on the first reveal only, which is what makes
 * that first click always safe.
 */

import type { GameMount } from "../mount";

/** Board side length used by the module. */
export const BOARD_SIZE = 9;

/** Mines placed on one board. */
export const MINE_COUNT = 10;

/** How long a press must last before it counts as a flag on touch. */
export const LONG_PRESS_MS = 450;

/** Deterministic pseudo random source returning numbers in `[0, 1)`. */
export type Rng = () => number;

/** One board; the arrays are parallel and share the same cell indexes. */
export interface Minefield {
  size: number;
  mineCount: number;
  mines: boolean[];
  revealed: boolean[];
  flagged: boolean[];
  placed: boolean;
  exploded: number | null;
}

/** Outcome of revealing one cell. */
export interface RevealResult {
  field: Minefield;
  changed: boolean;
  hitMine: boolean;
}

/** @brief Builds a deterministic mulberry32 generator for `seed`. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** @brief Creates a board whose mines are placed by the first reveal. */
export function createField(size: number, mineCount: number): Minefield {
  const total = size * size;
  return {
    size,
    mineCount,
    mines: new Array<boolean>(total).fill(false),
    revealed: new Array<boolean>(total).fill(false),
    flagged: new Array<boolean>(total).fill(false),
    placed: false,
    exploded: null,
  };
}

/** @brief Builds a field with its mines already placed, used by tests. */
export function fieldWithMines(size: number, mineIndexes: readonly number[]): Minefield {
  const field = createField(size, mineIndexes.length);
  const mines = field.mines.slice();
  for (const index of mineIndexes) {
    if (index >= 0 && index < mines.length) mines[index] = true;
  }
  return { ...field, mines, placed: true };
}

/** @brief Lists the in-bounds neighbours of a cell, excluding the cell itself. */
export function neighbours(size: number, index: number): number[] {
  const x = index % size;
  const y = Math.floor(index / size);
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      result.push(ny * size + nx);
    }
  }
  return result;
}

/** @brief Counts the mines adjacent to one cell. */
export function adjacentMines(field: Minefield, index: number): number {
  return neighbours(field.size, index).reduce(
    (total, neighbour) => total + (field.mines[neighbour] === true ? 1 : 0),
    0,
  );
}

/**
 * @brief Places the mines so a first click on `safeIndex` cannot hit one.
 * @details The clicked cell and its neighbourhood are excluded, which turns the
 * first click into an opening move instead of an instant loss.
 */
export function placeMines(field: Minefield, safeIndex: number, rng: Rng): Minefield {
  const safe = new Set<number>([safeIndex, ...neighbours(field.size, safeIndex)]);
  const candidates: number[] = [];
  for (let index = 0; index < field.size * field.size; index += 1) {
    if (!safe.has(index)) candidates.push(index);
  }

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(rng() * (index + 1));
    const held = candidates[index];
    const other = candidates[swapWith];
    if (held === undefined || other === undefined) continue;
    candidates[index] = other;
    candidates[swapWith] = held;
  }

  const mines = new Array<boolean>(field.size * field.size).fill(false);
  const take = Math.min(field.mineCount, candidates.length);
  for (let index = 0; index < take; index += 1) {
    const candidate = candidates[index];
    if (candidate !== undefined) mines[candidate] = true;
  }
  return { ...field, mines, placed: true };
}

/** @brief Reveals one cell, flood filling through clear neighbours. */
export function revealCell(field: Minefield, index: number, rng: Rng = Math.random): RevealResult {
  const total = field.size * field.size;
  if (index < 0 || index >= total) return { field, changed: false, hitMine: false };
  if (field.revealed[index] === true || field.flagged[index] === true) {
    return { field, changed: false, hitMine: false };
  }

  const seeded = field.placed ? field : placeMines(field, index, rng);
  const revealed = seeded.revealed.slice();

  if (seeded.mines[index] === true) {
    revealed[index] = true;
    return { field: { ...seeded, revealed, exploded: index }, changed: true, hitMine: true };
  }

  const stack = [index];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    if (revealed[current] === true) continue;
    if (seeded.mines[current] === true) continue;
    if (seeded.flagged[current] === true) continue;
    revealed[current] = true;
    if (adjacentMines(seeded, current) > 0) continue;
    for (const neighbour of neighbours(seeded.size, current)) {
      if (revealed[neighbour] !== true && seeded.flagged[neighbour] !== true) stack.push(neighbour);
    }
  }

  return { field: { ...seeded, revealed }, changed: true, hitMine: false };
}

/** @brief Adds or removes a flag; revealed and lost cells never change. */
export function toggleFlag(field: Minefield, index: number): Minefield {
  const total = field.size * field.size;
  if (index < 0 || index >= total) return field;
  if (field.revealed[index] === true || field.exploded !== null) return field;
  if (field.flagged[index] !== true && flagsUsed(field) >= field.mineCount) return field;

  const flagged = field.flagged.slice();
  flagged[index] = flagged[index] !== true;
  return { ...field, flagged };
}

/** @brief Counts the flags currently placed. */
export function flagsUsed(field: Minefield): number {
  return field.flagged.reduce((total, flagged) => total + (flagged ? 1 : 0), 0);
}

/** @brief Reports whether every safe cell is revealed. */
export function isWon(field: Minefield): boolean {
  return field.mines.every((mine, index) => mine || field.revealed[index] === true);
}

/** @brief Reports whether the run already hit a mine. */
export function isLost(field: Minefield): boolean {
  return field.exploded !== null;
}

/** One teardown callback registered while the view is mounted. */
type Cleanup = () => void;

/** @brief Builds the minesweeper module; `unmount` releases all of its state. */
export function createMinesweeperGame(): GameMount {
  let host: HTMLElement | null = null;
  let cleanups: Cleanup[] = [];
  let cells: HTMLButtonElement[] = [];
  let hudLine: HTMLElement | null = null;
  let statusLine: HTMLElement | null = null;
  let flagButton: HTMLButtonElement | null = null;

  let field: Minefield = createField(BOARD_SIZE, MINE_COUNT);
  let flagMode = false;
  let over = false;
  let message = "";
  let longPressTimer: number | null = null;
  let suppressClick = false;

  /** @brief Registers a listener that `unmount` removes again. */
  function listen(target: HTMLElement, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  }

  /** @brief Builds a styled toolbar button wired to `onClick`. */
  function makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-btn";
    button.textContent = label;
    listen(button, "click", onClick);
    return button;
  }

  /** @brief Cancels a pending long press. */
  function clearLongPress(): void {
    if (longPressTimer === null) return;
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  /** @brief Resets the board and repaints it. */
  function reset(): void {
    clearLongPress();
    field = createField(BOARD_SIZE, MINE_COUNT);
    flagMode = false;
    over = false;
    suppressClick = false;
    message = "Click any cell to start — the first click is always safe.";
    render();
  }

  /** @brief Reads the cell index a DOM event originated from. */
  function cellIndexFrom(event: Event): number | null {
    if (!(event.target instanceof HTMLElement)) return null;
    const cell = event.target.closest(".stage-cell");
    if (!(cell instanceof HTMLElement) || !host?.contains(cell)) return null;
    const raw = cell.dataset.index;
    if (raw === undefined) return null;
    const index = Number.parseInt(raw, 10);
    return Number.isInteger(index) && index >= 0 ? index : null;
  }

  /** @brief Applies one reveal and updates the run state. */
  function reveal(index: number): void {
    const result = revealCell(field, index);
    field = result.field;
    if (result.hitMine) {
      over = true;
      message = "Boom — that was a mine. Restart to try again.";
    } else if (isWon(field)) {
      over = true;
      message = "Cleared! Every safe cell is open.";
    } else {
      message = "Reveal every safe cell. Flag what you suspect.";
    }
    render();
  }

  /** @brief Toggles a flag on one cell and repaints. */
  function flagCell(index: number): void {
    const next = toggleFlag(field, index);
    if (next === field) return;
    field = next;
    message = flagMode
      ? "Flag mode is on — click a cell to mark it."
      : "Reveal every safe cell. Flag what you suspect.";
    render();
  }

  /** @brief Board click: reveal, or flag while flag mode is on. */
  function onClick(event: Event): void {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (over) return;
    const index = cellIndexFrom(event);
    if (index === null) return;
    if (flagMode) flagCell(index);
    else reveal(index);
  }

  /** @brief Right click always flags. */
  function onContextMenu(event: Event): void {
    event.preventDefault();
    if (over) return;
    const index = cellIndexFrom(event);
    if (index === null) return;
    flagCell(index);
  }

  /** @brief Starts the touch long press timer. */
  function onPointerDown(event: Event): void {
    clearLongPress();
    if (over) return;
    const index = cellIndexFrom(event);
    if (index === null) return;
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      suppressClick = true;
      flagCell(index);
    }, LONG_PRESS_MS);
  }

  /** @brief Paints the HUD, the toolbar, the status line and every cell. */
  function render(): void {
    if (hudLine !== null) {
      hudLine.textContent = `Mines ${MINE_COUNT} · Flags ${flagsUsed(field)} · ${flagMode ? "flag" : "reveal"} mode`;
    }
    if (statusLine !== null) statusLine.textContent = message;
    if (flagButton !== null) {
      flagButton.className = flagMode ? "stage-btn is-active" : "stage-btn";
      flagButton.setAttribute("aria-pressed", flagMode ? "true" : "false");
    }
    field.revealed.forEach((revealed, index) => {
      const cell = cells[index];
      if (cell !== undefined) paintCell(cell, index, revealed);
    });
  }

  /** @brief Paints one cell from the current field. */
  function paintCell(cell: HTMLButtonElement, index: number, revealed: boolean): void {
    const mine = field.mines[index] === true;
    const lost = field.exploded !== null;
    const row = Math.floor(index / BOARD_SIZE) + 1;
    const column = (index % BOARD_SIZE) + 1;
    let text = "";
    let className = "stage-cell";
    let label = "hidden";

    if (revealed && mine) {
      text = "*";
      className = "stage-cell is-warn";
      label = "mine";
    } else if (revealed) {
      const count = adjacentMines(field, index);
      text = count === 0 ? "" : String(count);
      label = count === 0 ? "clear" : `${count} adjacent mines`;
      if (count === 1) className = "stage-cell is-primary";
      else if (count === 2) className = "stage-cell is-good";
      else if (count > 2) className = "stage-cell is-warn";
      else className = "stage-cell is-dim";
    } else if (lost && mine) {
      text = "*";
      className = "stage-cell is-warn";
      label = "mine";
    } else if (field.flagged[index] === true) {
      text = "F";
      className = "stage-cell is-primary";
      label = "flagged";
    }

    cell.textContent = text;
    cell.className = className;
    cell.setAttribute("aria-label", `Row ${row} column ${column}: ${label}`);
  }

  /** @brief Builds the cell grid. */
  function buildBoard(): HTMLDivElement {
    const grid = document.createElement("div");
    grid.className = "stage-board";
    grid.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 44px)`;
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", "Minesweeper board");

    const fragment = document.createDocumentFragment();
    cells = [];
    for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "stage-cell";
      cell.dataset.index = String(index);
      fragment.append(cell);
      cells.push(cell);
    }
    grid.append(fragment);
    return grid;
  }

  /** @brief Mounts the game into a host. */
  function mount(target: HTMLElement): void {
    unmount();
    host = target;
    target.replaceChildren();

    flagButton = makeButton("Flag mode", () => {
      flagMode = !flagMode;
      message = flagMode
        ? "Flag mode is on — click a cell to mark it."
        : "Reveal every safe cell. Flag what you suspect.";
      render();
    });

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    bar.append(
      flagButton,
      makeButton("Restart", () => reset()),
    );

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    hudLine = document.createElement("span");
    hud.append(hudLine);

    statusLine = document.createElement("p");
    statusLine.className = "stage-status";
    statusLine.setAttribute("aria-live", "polite");

    const board = buildBoard();
    listen(board, "click", onClick);
    listen(board, "contextmenu", onContextMenu);
    listen(board, "pointerdown", onPointerDown);
    listen(board, "pointerup", () => clearLongPress());
    listen(board, "pointercancel", () => clearLongPress());
    listen(board, "pointerleave", () => clearLongPress());

    target.append(bar, hud, board, statusLine);
    reset();
  }

  /** @brief Releases timers, listeners and the rendered DOM. */
  function unmount(): void {
    clearLongPress();
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    if (host !== null) host.replaceChildren();
    host = null;
    cells = [];
    hudLine = null;
    statusLine = null;
    flagButton = null;
  }

  return { mount, unmount };
}
