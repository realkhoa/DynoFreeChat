/**
 * @file game.ts
 * @brief 2048: pure slide/merge engine plus a keyboard driven board view.
 * @details Every rule lives in a side-effect free function so the tests exercise
 * the engine without a DOM. The view keeps all mutable state inside the factory
 * closure, so restarting is a fresh {@link create2048Game} call from the stage.
 */

import type { GameMount } from "../mount";

/** Board side length. */
export const BOARD_SIZE = 4;

/** Tile value that wins the run. */
export const WINNING_TILE = 2048;

/** Number of cells on one board. */
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/** Deterministic pseudo random source returning numbers in `[0, 1)`. */
export type Rng = () => number;

/** Row-major board; `0` marks an empty cell. */
export type Board = number[];

/** Direction a move slides the tiles towards. */
export type Direction = "left" | "right" | "up" | "down";

/** Outcome of sliding one row towards index 0. */
export interface SlideResult {
  /** Row after sliding, same length as the input. */
  row: number[];
  /** Points earned by the merges of this row. */
  gained: number;
  /** Whether any tile changed position or value. */
  moved: boolean;
}

/** Outcome of a whole board move. */
export interface MoveResult {
  /** Board after the move. */
  board: Board;
  /** Points earned by all merges. */
  gained: number;
  /** Whether the move changed the board. */
  moved: boolean;
}

/** Outcome of spawning one random tile. */
export interface SpawnResult {
  /** Board after the spawn. */
  board: Board;
  /** Spawned cell index, or `-1` when the board was full. */
  index: number;
  /** Spawned value, or `0` when nothing spawned. */
  value: number;
}

/**
 * @brief Builds a deterministic mulberry32 generator.
 * @param seed Integer seed; equal seeds produce equal sequences.
 * @return Generator yielding numbers in `[0, 1)`.
 */
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

/**
 * @brief Creates a board with every cell empty.
 * @return Fresh board of {@link CELL_COUNT} zeroes.
 */
export function emptyBoard(): Board {
  return new Array<number>(CELL_COUNT).fill(0);
}

/**
 * @brief Slides one row towards index 0 and merges equal neighbours once.
 * @param row Source row, read left to right.
 * @return The compacted row, the points earned and whether anything moved.
 * @details A tile produced by a merge never merges again in the same move, which
 * is what makes `[2, 2, 2, 2]` become `[4, 4, 0, 0]` and not `[8, 0, 0, 0]`.
 */
export function slideRow(row: readonly number[]): SlideResult {
  const compact = row.filter((value) => value !== 0);
  const merged: number[] = [];
  let gained = 0;

  for (let index = 0; index < compact.length; index += 1) {
    const value = compact[index] ?? 0;
    const next = compact[index + 1];
    if (next !== undefined && next === value) {
      const combined = value * 2;
      merged.push(combined);
      gained += combined;
      index += 1;
    } else {
      merged.push(value);
    }
  }

  while (merged.length < row.length) merged.push(0);
  const moved = merged.some((value, index) => value !== (row[index] ?? 0));
  return { row: merged, gained, moved };
}

/**
 * @brief Applies one move to the whole board.
 * @param board Source board.
 * @param direction Direction the tiles slide towards.
 * @return The new board, the points earned and whether the move changed anything.
 */
export function moveBoard(board: readonly number[], direction: Direction): MoveResult {
  const next = emptyBoard();
  let gained = 0;
  let moved = false;

  for (let line = 0; line < BOARD_SIZE; line += 1) {
    const indexes = lineIndexes(line, direction);
    const values = indexes.map((index) => board[index] ?? 0);
    const slide = slideRow(values);
    gained += slide.gained;
    moved = moved || slide.moved;
    indexes.forEach((index, offset) => {
      next[index] = slide.row[offset] ?? 0;
    });
  }

  return { board: next, gained, moved };
}

/**
 * @brief Spawns a single 2 or 4 tile in a random empty cell.
 * @param board Source board.
 * @param rng Random source; a seeded {@link createRng} makes this deterministic.
 * @return The new board plus the spawned index and value.
 */
export function spawnTile(board: readonly number[], rng: Rng): SpawnResult {
  const empty: number[] = [];
  board.forEach((value, index) => {
    if (value === 0) empty.push(index);
  });
  if (empty.length === 0) return { board: [...board], index: -1, value: 0 };

  const pick = Math.min(empty.length - 1, Math.floor(rng() * empty.length));
  const index = empty[pick] ?? -1;
  const value = rng() < 0.9 ? 2 : 4;
  const next = [...board];
  if (index >= 0) next[index] = value;
  return { board: next, index, value };
}

/**
 * @brief Reports whether any direction would still change the board.
 * @param board Board to inspect.
 * @return `true` while an empty cell or an equal neighbour pair exists.
 */
export function canMove(board: readonly number[]): boolean {
  if (board.some((value) => value === 0)) return true;

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const value = board[y * BOARD_SIZE + x] ?? 0;
      if (x + 1 < BOARD_SIZE && value === (board[y * BOARD_SIZE + x + 1] ?? -1)) return true;
      if (y + 1 < BOARD_SIZE && value === (board[(y + 1) * BOARD_SIZE + x] ?? -1)) return true;
    }
  }

  return false;
}

/**
 * @brief Reports whether the winning tile is on the board.
 * @param board Board to inspect.
 * @return `true` once a tile of at least {@link WINNING_TILE} exists.
 */
export function hasWon(board: readonly number[]): boolean {
  return board.some((value) => value >= WINNING_TILE);
}

/**
 * @brief Lists the cell indexes of one line in slide order.
 * @param line Row index for horizontal moves, column index for vertical moves.
 * @param direction Move direction.
 * @return Indexes from the far edge towards the near edge.
 */
function lineIndexes(line: number, direction: Direction): number[] {
  const indexes: number[] = [];
  for (let offset = 0; offset < BOARD_SIZE; offset += 1) {
    if (direction === "left") indexes.push(line * BOARD_SIZE + offset);
    else if (direction === "right") indexes.push(line * BOARD_SIZE + (BOARD_SIZE - 1 - offset));
    else if (direction === "up") indexes.push(offset * BOARD_SIZE + line);
    else indexes.push((BOARD_SIZE - 1 - offset) * BOARD_SIZE + line);
  }
  return indexes;
}

/** One teardown callback registered while the view is mounted. */
type Cleanup = () => void;

/**
 * @brief Picks the inline colours for one tile value.
 * @param value Tile value, `0` for an empty cell.
 * @return Background and text colour, applied inline because tile values are data.
 */
function tilePalette(value: number): { background: string; color: string } {
  if (value === 0) return { background: "transparent", color: "transparent" };
  if (value >= WINNING_TILE) return { background: "#2f6f63", color: "#ffffff" };
  if (value >= 128) return { background: "#5a4a24", color: "#f0d58c" };
  if (value >= 16) return { background: "#3b3b3b", color: "#e6e6e6" };
  if (value >= 4) return { background: "#33332f", color: "#dcdcaa" };
  return { background: "#2a2a2a", color: "#d4d4d4" };
}

/**
 * @brief Builds the 2048 game module.
 * @return A mount whose state is fully released by `unmount`.
 */
export function create2048Game(): GameMount {
  let host: HTMLElement | null = null;
  let cleanups: Cleanup[] = [];
  let cells: HTMLButtonElement[] = [];
  let scoreLine: HTMLElement | null = null;
  let bestLine: HTMLElement | null = null;
  let statusLine: HTMLElement | null = null;

  let board: Board = emptyBoard();
  let score = 0;
  let best = 0;
  let won = false;
  let over = false;
  let message = "";
  let rng: Rng = createRng(1);

  /**
   * @brief Registers a listener that {@link unmount} removes again.
   * @param target Element to listen on.
   * @param type Event type.
   * @param handler Event handler.
   */
  function listen(target: HTMLElement, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  }

  /** @brief Resets the run and paints it. */
  function reset(): void {
    rng = createRng(Date.now() >>> 0);
    board = emptyBoard();
    score = 0;
    won = false;
    over = false;
    message = "Use the arrow keys to merge tiles.";
    board = spawnTile(board, rng).board;
    board = spawnTile(board, rng).board;
    render();
  }

  /**
   * @brief Applies one move, spawns a tile and repaints.
   * @param direction Direction to play.
   */
  function play(direction: Direction): void {
    if (over) return;

    const result = moveBoard(board, direction);
    if (!result.moved) return;

    board = result.board;
    score += result.gained;
    best = Math.max(best, score);
    board = spawnTile(board, rng).board;

    if (!won && hasWon(board)) {
      won = true;
      message = `You reached ${WINNING_TILE}! Keep going for a higher score.`;
    } else if (won) {
      message = `You reached ${WINNING_TILE}! Keep going for a higher score.`;
    } else {
      message = "Use the arrow keys to merge tiles.";
    }

    if (!canMove(board)) {
      over = true;
      message = `No moves left — final score ${score}.`;
    }

    render();
  }

  /** @brief Paints the HUD, the status line and every tile. */
  function render(): void {
    if (scoreLine !== null) scoreLine.textContent = `Score ${score}`;
    if (bestLine !== null) bestLine.textContent = `Best ${best}`;
    if (statusLine !== null) statusLine.textContent = message;

    board.forEach((value, index) => {
      const cell = cells[index];
      if (cell === undefined) return;

      const palette = tilePalette(value);
      const row = Math.floor(index / BOARD_SIZE) + 1;
      const column = (index % BOARD_SIZE) + 1;
      cell.textContent = value === 0 ? "" : String(value);
      cell.className = value === 0 ? "stage-cell is-muted" : "stage-cell";
      cell.style.background = palette.background;
      cell.style.color = palette.color;
      cell.setAttribute(
        "aria-label",
        value === 0
          ? `Empty cell row ${row} column ${column}`
          : `Tile ${value} at row ${row} column ${column}`,
      );
    });
  }

  /**
   * @brief Builds the tile grid.
   * @return Grid element with one button per cell.
   */
  function buildBoard(): HTMLDivElement {
    const grid = document.createElement("div");
    grid.className = "stage-board";
    grid.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 68px)`;
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", "2048 board");

    const fragment = document.createDocumentFragment();
    cells = [];
    for (let index = 0; index < CELL_COUNT; index += 1) {
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

  /**
   * @brief Handles arrow keys on the host.
   * @param event Keydown event.
   */
  function onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const direction = directionForKey(event.key);
    if (direction === null) return;
    event.preventDefault();
    play(direction);
  }

  /**
   * @brief Mounts the view into a host.
   * @param target Empty container owned by the stage.
   */
  function mount(target: HTMLElement): void {
    unmount();
    host = target;
    target.replaceChildren();

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    const restart = document.createElement("button");
    restart.type = "button";
    restart.className = "stage-btn";
    restart.textContent = "New game";
    listen(restart, "click", () => reset());
    bar.append(restart);

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    scoreLine = document.createElement("span");
    bestLine = document.createElement("span");
    hud.append(scoreLine, bestLine);

    statusLine = document.createElement("p");
    statusLine.className = "stage-status";
    statusLine.setAttribute("aria-live", "polite");

    const board = buildBoard();
    // Clicking a tile hands the keyboard back to the board so arrows keep playing.
    listen(board, "click", () => target.focus());

    target.append(bar, hud, board, statusLine);
    target.tabIndex = 0;
    target.setAttribute("aria-label", "2048 game");
    listen(target, "keydown", onKeyDown);
    target.focus();
    reset();
  }

  /** @brief Releases listeners and the rendered DOM. */
  function unmount(): void {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    if (host !== null) {
      host.replaceChildren();
      host.removeAttribute("tabindex");
      host.removeAttribute("aria-label");
    }
    host = null;
    cells = [];
    scoreLine = null;
    bestLine = null;
    statusLine = null;
  }

  return { mount, unmount };
}

/**
 * @brief Maps a keyboard key to a 2048 direction.
 * @param key Value of `KeyboardEvent.key`.
 * @return The direction, or `null` for unrelated keys.
 */
export function directionForKey(key: string): Direction | null {
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  return null;
}
