/**
 * @file battleship/game.ts
 * @brief 10x10 Battleship against a hunt/target AI.
 * @details The module keeps a pure fleet/shot engine ({@link placeFleet},
 * {@link fire}, {@link aiNextShot}) next to the vanilla DOM view. Mutable view
 * state lives in the {@link createBattleshipGame} closure.
 */

import type { GameMount } from "../mount";

/** @brief Board edge length. */
export const BATTLESHIP_SIZE = 10;

/** @brief One board cell, 0-based from the top-left. */
export interface Coord {
  /** Row index, 0 = top. */
  row: number;
  /** Column index, 0 = left. */
  col: number;
}

/** @brief A placed ship. */
export interface Ship {
  /** Display name, e.g. "Carrier". */
  name: string;
  /** Number of cells the ship occupies. */
  length: number;
  /** Occupied cells in order. */
  cells: Coord[];
}

/** @brief Shot marks: empty string means never fired at. */
export type ShotMark = "" | "miss" | "hit" | "sunk";

/** @brief Fleet plus the shots already fired at it. */
export interface BoardState {
  /** Ships on this board (empty for a board that is still being deployed). */
  ships: Ship[];
  /** Row-major shot marks, 100 entries. */
  shots: ShotMark[];
}

/** @brief Outcome of one shot. */
export interface FireResult {
  /** Board after the shot; the input board is never mutated. */
  state: BoardState;
  /** What the shot did. */
  result: "miss" | "hit" | "sunk";
  /** Ship that was sunk by this shot, when the shot finished one. */
  sunkShip: Ship | null;
  /** True when every ship on the board is sunk. */
  won: boolean;
}

/** @brief Ship name and length, in deployment order. */
export const FLEET_SPEC: readonly { name: string; length: number }[] = [
  { name: "Carrier", length: 5 },
  { name: "Battleship", length: 4 },
  { name: "Cruiser", length: 3 },
  { name: "Submarine", length: 3 },
  { name: "Destroyer", length: 2 },
];

/** @brief Ship orientation on the grid. */
export type Orientation = "h" | "v";

/**
 * @brief Converts a row-major index into a coordinate.
 * @param index Index 0..99.
 * @return The coordinate.
 */
export function coordOf(index: number): Coord {
  return { row: Math.floor(index / BATTLESHIP_SIZE), col: index % BATTLESHIP_SIZE };
}

/**
 * @brief Converts a coordinate into a row-major index.
 * @param coord Board coordinate.
 * @return Index 0..99.
 */
export function indexOf(coord: Coord): number {
  return coord.row * BATTLESHIP_SIZE + coord.col;
}

/**
 * @brief Tests whether a coordinate is on the board.
 * @param coord Board coordinate.
 * @return True when row and column are inside 0..9.
 */
export function inBounds(coord: Coord): boolean {
  return coord.row >= 0 && coord.row < BATTLESHIP_SIZE && coord.col >= 0 && coord.col < BATTLESHIP_SIZE;
}

/**
 * @brief Human readable coordinate, e.g. C7 (columns A-J, rows 1-10).
 * @param coord Board coordinate.
 * @return Column letter plus 1-based row.
 */
export function coordName(coord: Coord): string {
  return `${String.fromCharCode(65 + coord.col)}${coord.row + 1}`;
}

/**
 * @brief Lists the cells a ship would occupy.
 * @param start Top-left cell of the ship.
 * @param length Ship length.
 * @param orientation Horizontal (rightwards) or vertical (downwards).
 * @return The cells, or null when the ship would leave the board.
 */
export function shipCells(start: Coord, length: number, orientation: Orientation): Coord[] | null {
  const cells: Coord[] = [];
  for (let i = 0; i < length; i++) {
    const cell =
      orientation === "h" ? { row: start.row, col: start.col + i } : { row: start.row + i, col: start.col };
    if (!inBounds(cell)) return null;
    cells.push(cell);
  }
  return cells;
}

/**
 * @brief Creates an empty board with no ships and no shots.
 * @return A fresh board state.
 */
export function createBoard(): BoardState {
  return { ships: [], shots: Array<ShotMark>(BATTLESHIP_SIZE * BATTLESHIP_SIZE).fill("") };
}

/**
 * @brief Tests whether two cell lists share a cell.
 * @param left First list.
 * @param right Second list.
 * @return True on any overlap.
 */
function overlaps(left: readonly Coord[], right: readonly Coord[]): boolean {
  return left.some((a) => right.some((b) => a.row === b.row && a.col === b.col));
}

/**
 * @brief Tests whether a candidate cell list collides with a fleet.
 * @param ships Ships already placed.
 * @param cells Candidate cells.
 * @return True when the candidate overlaps a ship.
 */
export function fleetOverlaps(ships: readonly Ship[], cells: readonly Coord[]): boolean {
  return ships.some((ship) => overlaps(ship.cells, cells));
}

/**
 * @brief Builds the ship record for a valid placement.
 * @param spec Name and length.
 * @param cells Occupied cells.
 * @return The ship.
 */
function makeShip(spec: { name: string; length: number }, cells: Coord[]): Ship {
  return { name: spec.name, length: spec.length, cells };
}

/**
 * @brief Places one ship at random, retrying a bounded number of times.
 * @param ships Ships already placed.
 * @param spec Ship name and length.
 * @param rng Seeded random source in [0, 1).
 * @return The ship, or null when no free placement was found.
 */
function randomPlacement(
  ships: readonly Ship[],
  spec: { name: string; length: number },
  rng: () => number,
): Ship | null {
  for (let attempt = 0; attempt < 150; attempt++) {
    const orientation: Orientation = rng() < 0.5 ? "h" : "v";
    const start: Coord = {
      row: Math.floor(rng() * BATTLESHIP_SIZE),
      col: Math.floor(rng() * BATTLESHIP_SIZE),
    };
    const cells = shipCells(start, spec.length, orientation);
    if (cells === null || fleetOverlaps(ships, cells)) continue;
    return makeShip(spec, cells);
  }
  return null;
}

/**
 * @brief Deterministic fallback used when the random search stalls.
 * @return A valid fleet found by scanning rows, columns and both orientations.
 */
function greedyFleet(): Ship[] {
  const ships: Ship[] = [];
  for (const spec of FLEET_SPEC) {
    let placed: Ship | null = null;
    for (let row = 0; row < BATTLESHIP_SIZE && placed === null; row++) {
      for (let col = 0; col < BATTLESHIP_SIZE && placed === null; col++) {
        for (const orientation of ["h", "v"] as const) {
          const cells = shipCells({ row, col }, spec.length, orientation);
          if (cells === null || fleetOverlaps(ships, cells)) continue;
          placed = makeShip(spec, cells);
          break;
        }
      }
    }
    if (placed === null) break;
    ships.push(placed);
  }
  return ships;
}

/**
 * @brief Places the whole fleet (5,4,3,3,2) with valid, non-overlapping cells.
 * @param rng Seeded random source in [0, 1).
 * @return Ships in {@link FLEET_SPEC} order.
 */
export function placeFleet(rng: () => number): Ship[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const ships: Ship[] = [];
    let complete = true;
    for (const spec of FLEET_SPEC) {
      const ship = randomPlacement(ships, spec, rng);
      if (ship === null) {
        complete = false;
        break;
      }
      ships.push(ship);
    }
    if (complete) return ships;
  }
  return greedyFleet();
}

/**
 * @brief Tests whether every cell of one ship has been hit.
 * @param state Board the ship belongs to.
 * @param ship Ship to inspect.
 * @return True when all of its cells are hit or sunk.
 */
export function isShipSunk(state: BoardState, ship: Ship): boolean {
  return ship.cells.every((cell) => {
    const mark = state.shots[indexOf(cell)] ?? "";
    return mark === "hit" || mark === "sunk";
  });
}

/**
 * @brief Tests whether the whole fleet is sunk.
 * @param state Board to inspect.
 * @return True when the board holds a fleet and every ship is sunk.
 */
export function allSunk(state: BoardState): boolean {
  return state.ships.length > 0 && state.ships.every((ship) => isShipSunk(state, ship));
}

/**
 * @brief Fires at one cell. Repeated shots at the same cell return the existing
 * mark and leave the board untouched.
 * @param state Board being fired at.
 * @param coord Target cell.
 * @return New board, the result, the sunk ship (if any) and the win flag.
 */
export function fire(state: BoardState, coord: Coord): FireResult {
  const index = indexOf(coord);
  const existing = state.shots[index] ?? "";
  if (existing !== "") {
    return { state, result: existing, sunkShip: null, won: allSunk(state) };
  }

  const shots = [...state.shots];
  const ship = state.ships.find((candidate) => overlaps(candidate.cells, [coord])) ?? null;
  if (ship === null) {
    shots[index] = "miss";
    return { state: { ships: state.ships, shots }, result: "miss", sunkShip: null, won: false };
  }

  shots[index] = "hit";
  const next: BoardState = { ships: state.ships, shots };
  const sunk = isShipSunk(next, ship);
  if (sunk) {
    for (const cell of ship.cells) shots[indexOf(cell)] = "sunk";
  }
  return {
    state: next,
    result: sunk ? "sunk" : "hit",
    sunkShip: sunk ? ship : null,
    won: allSunk(next),
  };
}

/**
 * @brief Chooses the AI shot: extend a line of hits, otherwise hit an
 * orthogonal neighbour of a hit, otherwise fire a random parity cell.
 * @param state The AI's knowledge of the player board (its own shot marks).
 * @param rng Seeded random source in [0, 1), used only for the hunt phase.
 * @return Target coordinate; always an unshot, in-bounds cell.
 */
export function aiNextShot(state: BoardState, rng: () => number): Coord {
  const markAt = (coord: Coord): ShotMark => (inBounds(coord) ? (state.shots[indexOf(coord)] ?? "") : "miss");

  const hits: Coord[] = [];
  for (let i = 0; i < state.shots.length; i++) {
    if (state.shots[i] === "hit") hits.push(coordOf(i));
  }

  for (const hit of hits) {
    for (const [dr, dc] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const next = { row: hit.row + dr, col: hit.col + dc };
      const beyond = { row: hit.row + dr * 2, col: hit.col + dc * 2 };
      if (markAt(next) === "hit" && markAt(beyond) === "") return beyond;
    }
  }

  for (const hit of hits) {
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const candidate = { row: hit.row + dr, col: hit.col + dc };
      if (markAt(candidate) === "") return candidate;
    }
  }

  const free: number[] = [];
  const parity: number[] = [];
  for (let i = 0; i < state.shots.length; i++) {
    if ((state.shots[i] ?? "") !== "") continue;
    free.push(i);
    const coord = coordOf(i);
    if ((coord.row + coord.col) % 2 === 0) parity.push(i);
  }

  const pool = parity.length > 0 ? parity : free;
  if (pool.length === 0) return { row: 0, col: 0 };
  const raw = Math.floor(rng() * pool.length);
  const index = pool[Math.min(pool.length - 1, Math.max(0, raw))] ?? free[0] ?? 0;
  return coordOf(index);
}

/**
 * @brief Deterministic mulberry32 generator so AI shots are reproducible.
 * @param seed Any 32-bit seed.
 * @return A function producing floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deployment phase, live battle, or finished game. */
type Phase = "place" | "battle" | "over";

/** DOM references rebuilt by {@link createBattleshipGame} on every mount. */
interface Refs {
  hud: HTMLElement;
  board: HTMLElement;
  status: HTMLElement;
  rotate: HTMLButtonElement;
  random: HTMLButtonElement;
}

/** Rotates the seed of the next game so consecutive games differ. */
let seedCursor = 0x1a2b3c4d;

/**
 * @brief Creates the Battleship game module.
 * @return Mountable game with closure-private state.
 */
export function createBattleshipGame(): GameMount {
  let rng: () => number = mulberry32(seedCursor);
  let playerBoard: BoardState = createBoard();
  let enemyBoard: BoardState = createBoard();
  let placement: Ship[] = [];
  let orientation: Orientation = "h";
  let phase: Phase = "place";
  let turn: "player" | "ai" = "player";
  let message = "";
  let timer: number | null = null;
  let refs: Refs | null = null;

  /** @brief Cancels the pending AI shot timer. */
  function clearTimer(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  /**
   * @brief Wraps ships into a board with empty shot marks.
   * @param ships Ships for the board.
   * @return A fresh board state.
   */
  function boardWith(ships: Ship[]): BoardState {
    return { ships, shots: Array<ShotMark>(BATTLESHIP_SIZE * BATTLESHIP_SIZE).fill("") };
  }

  /**
   * @brief Creates a toolbar button.
   * @param label Caption.
   * @param onClick Click handler.
   * @return The button element.
   */
  function button(label: string, onClick: () => void): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "stage-btn";
    el.textContent = label;
    el.addEventListener("click", onClick);
    return el;
  }

  /**
   * @brief Creates a small HUD label.
   * @param text Initial text.
   * @return The span element.
   */
  function label(text: string): HTMLElement {
    const el = document.createElement("span");
    el.textContent = text;
    return el;
  }

  /**
   * @brief Creates a status-styled caption element.
   * @param text Caption text.
   * @return The caption element.
   */
  function caption(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "stage-status";
    el.textContent = text;
    return el;
  }

  /** @brief Starts a fresh game with a new random enemy fleet. */
  function reset(): void {
    clearTimer();
    seedCursor = (seedCursor + 0x9e3779b9) >>> 0;
    rng = mulberry32(seedCursor);
    playerBoard = boardWith([]);
    enemyBoard = boardWith(placeFleet(rng));
    placement = [];
    orientation = "h";
    phase = "place";
    turn = "player";
    message = "Deploy your fleet: click a start cell, or press Random placement.";
  }

  /**
   * @brief Handles a click on the deployment grid.
   * @param coord Start cell of the ship being placed.
   */
  function placeAt(coord: Coord): void {
    if (phase !== "place") return;
    const spec = FLEET_SPEC[placement.length];
    if (spec === undefined) return;

    const cells = shipCells(coord, spec.length, orientation);
    if (cells === null) {
      message = `${spec.name} does not fit there — it would leave the board.`;
      render();
      return;
    }
    if (fleetOverlaps(placement, cells)) {
      message = `${spec.name} would overlap another ship.`;
      render();
      return;
    }

    placement = [...placement, makeShip(spec, cells)];
    playerBoard = boardWith(placement);
    const nextSpec = FLEET_SPEC[placement.length];
    if (nextSpec === undefined) {
      phase = "battle";
      message = "Fleet ready. Click enemy waters to fire.";
    } else {
      message = `${spec.name} placed. Next: ${nextSpec.name} (${nextSpec.length} cells).`;
    }
    render();
  }

  /** @brief Replaces the placed fleet with a random valid one and starts. */
  function randomise(): void {
    if (phase !== "place") return;
    placement = placeFleet(rng);
    playerBoard = boardWith(placement);
    phase = "battle";
    turn = "player";
    message = "Fleet deployed at random. Click enemy waters to fire.";
    render();
  }

  /** @brief Flips the placement orientation. */
  function rotate(): void {
    if (phase !== "place") return;
    orientation = orientation === "h" ? "v" : "h";
    message = `Orientation: ${orientation === "h" ? "horizontal" : "vertical"}.`;
    render();
  }

  /** @brief Takes one player shot at the enemy board. */
  function aiTurn(): void {
    timer = null;
    if (phase !== "battle") return;
    const coord = aiNextShot(playerBoard, rng);
    const result = fire(playerBoard, coord);
    playerBoard = result.state;

    if (result.won) {
      phase = "over";
      message = `The AI destroyed your fleet — last hit at ${coordName(coord)}.`;
      render();
      return;
    }
    const detail =
      result.result === "sunk"
        ? `your ${result.sunkShip?.name ?? "ship"} sunk`
        : result.result === "hit"
          ? "hit"
          : "miss";
    message = `AI fired at ${coordName(coord)}: ${detail}.`;
    turn = "player";
    render();
  }

  /**
   * @brief Handles a player shot on the enemy grid.
   * @param coord Target cell.
   */
  function shoot(coord: Coord): void {
    if (phase !== "battle" || turn !== "player") return;
    if ((enemyBoard.shots[indexOf(coord)] ?? "") !== "") return;

    const result = fire(enemyBoard, coord);
    enemyBoard = result.state;
    if (result.won) {
      phase = "over";
      message = `You sank the enemy fleet — last hit at ${coordName(coord)}. You win.`;
      render();
      return;
    }
    message =
      result.result === "sunk"
        ? `${coordName(coord)}: enemy ${result.sunkShip?.name ?? "ship"} sunk!`
        : `${coordName(coord)}: ${result.result}.`;
    turn = "ai";
    render();
    clearTimer();
    timer = window.setTimeout(aiTurn, 220);
  }

  /**
   * @brief Builds one 10x10 grid.
   * @param side Whose board is rendered.
   * @return The grid element.
   */
  function buildGrid(side: "player" | "enemy"): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "stage-board";
    grid.style.gridTemplateColumns = `repeat(${BATTLESHIP_SIZE}, 44px)`;

    const board = side === "player" ? playerBoard : enemyBoard;
    for (let row = 0; row < BATTLESHIP_SIZE; row++) {
      for (let col = 0; col < BATTLESHIP_SIZE; col++) {
        const coord = { row, col };
        const index = indexOf(coord);
        const mark = board.shots[index] ?? "";
        const occupied = board.ships.some((ship) => overlaps(ship.cells, [coord]));

        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "stage-cell";

        if (mark === "miss") {
          cell.textContent = "·";
          cell.classList.add("is-dim");
        } else if (mark === "hit") {
          cell.textContent = "×";
          cell.classList.add("is-warn");
        } else if (mark === "sunk") {
          cell.textContent = "▣";
          cell.classList.add("is-good");
        } else if (side === "player" && occupied) {
          cell.textContent = "■";
          cell.classList.add("is-primary");
        }

        const owner = side === "player" ? "Your waters" : "Enemy waters";
        const state = mark === "" ? (side === "player" && occupied ? "ship" : "unknown") : mark;
        cell.setAttribute("aria-label", `${owner} ${coordName(coord)}, ${state}`);

        if (side === "enemy") cell.addEventListener("click", () => shoot(coord));
        else cell.addEventListener("click", () => placeAt(coord));
        grid.append(cell);
      }
    }
    return grid;
  }

  /** @brief Repaints the toolbar state, HUD, boards and status line. */
  function render(): void {
    const view = refs;
    if (view === null) return;

    const enemySunk = enemyBoard.ships.filter((ship) => isShipSunk(enemyBoard, ship)).length;
    const ownSunk = playerBoard.ships.filter((ship) => isShipSunk(playerBoard, ship)).length;
    view.hud.replaceChildren(
      label(`phase: ${phase === "place" ? "deploy" : phase === "battle" ? "battle" : "over"}`),
      label(`fleet: ${placement.length}/${FLEET_SPEC.length}`),
      label(`enemy sunk: ${enemySunk}/${enemyBoard.ships.length}`),
      label(`own sunk: ${ownSunk}/${playerBoard.ships.length}`),
      label(`turn: ${turn}`),
    );
    view.rotate.disabled = phase !== "place";
    view.random.disabled = phase !== "place";

    view.board.replaceChildren();
    if (phase === "place") {
      const next = FLEET_SPEC[placement.length];
      const column = document.createElement("div");
      column.className = "stage-rows";
      column.append(
        caption(
          next === undefined
            ? "Deploy your fleet"
            : `Place ${next.name} (${next.length} cells) — ${orientation === "h" ? "horizontal" : "vertical"}`,
        ),
        buildGrid("player"),
      );
      view.board.append(column);
    } else {
      const rowWrap = document.createElement("div");
      rowWrap.className = "stage-row";
      const enemyColumn = document.createElement("div");
      enemyColumn.className = "stage-rows";
      enemyColumn.append(caption("Enemy waters"), buildGrid("enemy"));
      const ownColumn = document.createElement("div");
      ownColumn.className = "stage-rows";
      ownColumn.append(caption("Your fleet"), buildGrid("player"));
      rowWrap.append(enemyColumn, ownColumn);
      view.board.append(rowWrap);
    }
    view.status.textContent = message;
  }

  /**
   * @brief Mounts the game, resetting any previous state.
   * @param host Host element owned by the game stage.
   */
  function mount(host: HTMLElement): void {
    clearTimer();
    reset();
    host.replaceChildren();

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    const restart = button("Restart", () => {
      reset();
      render();
    });
    const rotateBtn = button("Rotate", rotate);
    const randomBtn = button("Random placement", randomise);
    const hint = label("sink 5 ships · 10x10");
    hint.className = "stage-empty";
    bar.append(restart, rotateBtn, randomBtn, hint);

    const hud = document.createElement("div");
    hud.className = "stage-hud";

    const board = document.createElement("div");
    const status = document.createElement("div");
    status.className = "stage-status";

    refs = { hud, board, status, rotate: rotateBtn, random: randomBtn };
    host.append(bar, hud, status, board);
    render();
  }

  /** @brief Releases the timer and drops DOM references. */
  function unmount(): void {
    clearTimer();
    refs = null;
  }

  return { mount, unmount };
}
