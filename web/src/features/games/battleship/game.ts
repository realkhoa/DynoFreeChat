/**
 * @file battleship/game.ts
 * @brief 10x10 Battleship against a hunt/target AI.
 * @details The module keeps a pure fleet/shot engine ({@link placeFleet},
 * {@link fire}, {@link aiNextShot}) next to the vanilla DOM view. Mutable view
 * state lives in the {@link createBattleshipGame} closure. When an online bridge
 * is supplied the hunt/target AI is switched off: both sides exchange their
 * fleet cells, then alternate shots, and every result is recomputed locally.
 */

import type { GameContext, GameMount } from "../mount";
import type { OnlineBridge } from "../online/bridge";

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

/** Number of cells the standard fleet occupies, i.e. the fleet payload length. */
const FLEET_CELLS = FLEET_SPEC.reduce((total, spec) => total + spec.length, 0);

/**
 * @brief Narrows an untrusted payload to a plain object.
 * @param value Value received from the bridge.
 * @return The object, or null for primitives and null.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * @brief Tests whether a value is a usable board index.
 * @param value Candidate value.
 * @return True for integers inside 0..99.
 */
function isBoardIndex(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < BATTLESHIP_SIZE * BATTLESHIP_SIZE
  );
}

/**
 * @brief Rebuilds the fleet an opponent described by its occupied cells only.
 * @details The wire format sends cells, not ships, so the module splits them back
 * into the standard 5,4,3,3,2 shapes with a bounded deterministic search. Every
 * covered cell is used exactly once, which is what the hit/sunk and win checks
 * need; the exact grouping only affects the sunk-ship captions.
 * @param cells Occupied board indices, already validated for range and uniqueness.
 * @return Ships in a valid partition, or null when no partition exists.
 */
function splitFleet(cells: readonly number[]): Ship[] | null {
  const remaining = new Set<number>(cells);
  const available = [...FLEET_SPEC];
  const placed: Ship[] = [];

  /**
   * @brief Finds the lowest still-unclaimed cell.
   * @details The lowest index of a straight ship is always its top or left end,
   * so anchoring there keeps the search complete.
   * @return Board index, or -1 when nothing is left.
   */
  const anchor = (): number => {
    for (let index = 0; index < BATTLESHIP_SIZE * BATTLESHIP_SIZE; index++) {
      if (remaining.has(index)) return index;
    }
    return -1;
  };

  /** @brief Backtracking exact cover over the remaining cells. */
  const solve = (): boolean => {
    if (remaining.size === 0) return true;
    const start = anchor();
    if (start < 0) return false;
    for (let slot = 0; slot < available.length; slot++) {
      const spec = available[slot];
      if (spec === undefined) continue;
      for (const orientation of ["h", "v"] as const) {
        const candidate = shipCells(coordOf(start), spec.length, orientation);
        if (candidate === null) continue;
        const indices = candidate.map(indexOf);
        if (!indices.every((index) => remaining.has(index))) continue;
        for (const index of indices) remaining.delete(index);
        available.splice(slot, 1);
        placed.push(makeShip(spec, candidate));
        if (solve()) return true;
        placed.pop();
        available.splice(slot, 0, spec);
        for (const index of indices) remaining.add(index);
      }
    }
    return false;
  };

  return solve() ? placed : null;
}

/**
 * @brief Decodes the cell list of a relayed fleet payload.
 * @param record Untrusted payload object.
 * @return Unique, in-range indices, or null when the payload is malformed.
 */
function decodeFleetCells(record: Record<string, unknown>): number[] | null {
  const raw = record.cells;
  if (!Array.isArray(raw)) return null;
  const list: readonly unknown[] = raw;
  if (list.length !== FLEET_CELLS) return null;
  const cells: number[] = [];
  for (const entry of list) {
    if (!isBoardIndex(entry)) return null;
    if (cells.includes(entry)) return null;
    cells.push(entry);
  }
  return cells;
}

/** DOM references rebuilt by {@link createBattleshipGame} on every mount. */
interface Refs {
  hud: HTMLElement;
  board: HTMLElement;
  status: HTMLElement;
  rotate: HTMLButtonElement;
  random: HTMLButtonElement;
  /** Ready button; null against the AI where the fleet starts the battle. */
  ready: HTMLButtonElement | null;
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
  let online: OnlineBridge | null = null;
  let peerLeft = false;
  /** True once the local fleet was sent and may no longer be edited. */
  let localReady = false;
  /** Opponent fleet rebuilt from the relayed cell list, once it arrives. */
  let remoteFleet: Ship[] | null = null;
  let unsubscribeMove: (() => void) | null = null;
  let unsubscribePeer: (() => void) | null = null;
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
    // Online the opponent fleet arrives over the bridge, so nothing is hidden here.
    enemyBoard = online === null ? boardWith(placeFleet(rng)) : boardWith([]);
    placement = [];
    orientation = "h";
    phase = "place";
    turn = "player";
    message =
      online === null
        ? "Deploy your fleet: click a start cell, or press Random placement."
        : "Deploy your fleet, then press Ready to share it with the opponent.";
  }

  /**
   * @brief Whose turn the HUD should name.
   * @return "you" / "opponent" online, "player" / "ai" locally.
   */
  function turnText(): string {
    if (online === null) return turn;
    return turn === "player" ? "you" : "opponent";
  }

  /**
   * @brief Status line for the shooting phase.
   * @return Local-perspective turn text.
   */
  function turnStatus(): string {
    return turn === "player"
      ? "Both fleets ready — your turn. Fire at enemy waters."
      : "Both fleets ready — waiting for the opponent's shot.";
  }

  /**
   * @brief Tests whether the local fleet is complete.
   * @return True when every ship of {@link FLEET_SPEC} is placed.
   */
  function fleetComplete(): boolean {
    return placement.length === FLEET_SPEC.length;
  }

  /**
   * @brief Enters the shooting phase once both fleets are known.
   * @return Nothing; leaves the placement phase untouched until then.
   */
  function startBattle(): void {
    if (phase !== "place" || !localReady || remoteFleet === null) return;
    phase = "battle";
    // Seat 1 fires first, so seat 2 waits for the opening shot.
    turn = online !== null && online.seat === 2 ? "ai" : "player";
    message = turnStatus();
  }

  /** @brief Sends the local fleet and waits for the opponent's. */
  function ready(): void {
    const bridge = online;
    if (bridge === null || phase !== "place" || localReady) return;
    if (!fleetComplete()) {
      message = "Deploy the whole fleet before pressing Ready.";
      render();
      return;
    }
    localReady = true;
    bridge.sendMove({ kind: "fleet", cells: placement.flatMap((ship) => ship.cells.map(indexOf)) });
    if (remoteFleet === null) message = "Fleet sent — waiting for the opponent's fleet…";
    startBattle();
    render();
  }

  /**
   * @brief Handles the opponent's fleet payload.
   * @param record Untrusted payload object.
   */
  function receiveFleet(record: Record<string, unknown>): void {
    if (remoteFleet !== null || phase !== "place") return;
    const cells = decodeFleetCells(record);
    if (cells === null) return;
    const ships = splitFleet(cells);
    if (ships === null) return;
    remoteFleet = ships;
    enemyBoard = boardWith(ships);
    if (localReady) startBattle();
    else message = "Opponent fleet received — deploy yours, then press Ready.";
    render();
  }

  /**
   * @brief Handles one opponent shot against the local fleet.
   * @param record Untrusted payload object.
   */
  function receiveShot(record: Record<string, unknown>): void {
    if (phase !== "battle" || turn !== "ai" || peerLeft) return;
    const index = record.index;
    if (!isBoardIndex(index)) return;
    if ((playerBoard.shots[index] ?? "") !== "") return;

    const coord = coordOf(index);
    const result = fire(playerBoard, coord);
    playerBoard = result.state;
    if (result.won) {
      phase = "over";
      message = `Opponent sank your fleet — last hit at ${coordName(coord)}. Opponent wins.`;
    } else {
      const detail =
        result.result === "sunk" ? `your ${result.sunkShip?.name ?? "ship"} sunk` : result.result;
      message = `Opponent fired at ${coordName(coord)}: ${detail}.`;
      turn = "player";
    }
    render();
  }

  /**
   * @brief Dispatches one payload received from the opponent.
   * @param payload Untrusted payload from the bridge.
   */
  function handleRemote(payload: unknown): void {
    if (online === null || peerLeft) return;
    const record = asRecord(payload);
    if (record === null) return;
    if (record.kind === "fleet") {
      receiveFleet(record);
      return;
    }
    if (record.kind === "shot") receiveShot(record);
  }

  /**
   * @brief Handles a click on the deployment grid.
   * @param coord Start cell of the ship being placed.
   */
  function placeAt(coord: Coord): void {
    if (phase !== "place" || localReady) return;
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
      if (online === null) {
        phase = "battle";
        message = "Fleet ready. Click enemy waters to fire.";
      } else {
        message = "Fleet ready. Press Ready to send it to the opponent.";
      }
    } else {
      message = `${spec.name} placed. Next: ${nextSpec.name} (${nextSpec.length} cells).`;
    }
    render();
  }

  /** @brief Replaces the placed fleet with a random valid one and starts. */
  function randomise(): void {
    if (phase !== "place" || localReady) return;
    placement = placeFleet(rng);
    playerBoard = boardWith(placement);
    if (online === null) {
      phase = "battle";
      turn = "player";
      message = "Fleet deployed at random. Click enemy waters to fire.";
    } else {
      message = "Fleet deployed at random. Press Ready to send it to the opponent.";
    }
    render();
  }

  /** @brief Flips the placement orientation. */
  function rotate(): void {
    if (phase !== "place" || localReady) return;
    orientation = orientation === "h" ? "v" : "h";
    message = `Orientation: ${orientation === "h" ? "horizontal" : "vertical"}.`;
    render();
  }

  /** @brief Takes one AI shot at the player board; never runs during a match. */
  function aiTurn(): void {
    timer = null;
    if (online !== null || phase !== "battle") return;
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
   * @brief Builds the local-perspective caption for one shot.
   * @param coord Target cell.
   * @param result Outcome from the engine.
   * @return Caption text.
   */
  function localShotCaption(coord: Coord, result: FireResult): string {
    return result.result === "sunk"
      ? `${coordName(coord)}: enemy ${result.sunkShip?.name ?? "ship"} sunk!`
      : `${coordName(coord)}: ${result.result}.`;
  }

  /**
   * @brief Handles a player shot on the enemy grid.
   * @param coord Target cell.
   */
  function shoot(coord: Coord): void {
    if (online !== null) {
      shootOnline(coord);
      return;
    }
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
    message = localShotCaption(coord, result);
    turn = "ai";
    render();
    clearTimer();
    timer = window.setTimeout(aiTurn, 220);
  }

  /**
   * @brief Handles a local shot in an online match, applying and relaying it.
   * @param coord Target cell on the opponent board.
   */
  function shootOnline(coord: Coord): void {
    const bridge = online;
    if (bridge === null || phase !== "battle" || turn !== "player" || peerLeft) return;
    const index = indexOf(coord);
    if ((enemyBoard.shots[index] ?? "") !== "") return;

    const result = fire(enemyBoard, coord);
    enemyBoard = result.state;
    if (result.won) {
      phase = "over";
      message = `You sank the enemy fleet — last hit at ${coordName(coord)}. You win.`;
    } else {
      message = localShotCaption(coord, result);
      turn = "ai";
    }
    // The winning shot still goes out so the opponent learns the result.
    bridge.sendMove({ kind: "shot", index });
    render();
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
    // Before the opponent's fleet arrives the standard fleet size is the only count we know.
    const enemyTotal = online !== null && remoteFleet === null ? FLEET_SPEC.length : enemyBoard.ships.length;
    view.hud.replaceChildren(
      label(`phase: ${phase === "place" ? "deploy" : phase === "battle" ? "battle" : "over"}`),
      label(`fleet: ${placement.length}/${FLEET_SPEC.length}`),
      label(`enemy sunk: ${enemySunk}/${enemyTotal}`),
      label(`own sunk: ${ownSunk}/${playerBoard.ships.length}`),
      label(`turn: ${turnText()}`),
    );
    view.rotate.disabled = phase !== "place" || localReady;
    view.random.disabled = phase !== "place" || localReady;
    if (view.ready !== null) view.ready.disabled = phase !== "place" || localReady;

    view.board.replaceChildren();
    if (phase === "place") {
      const next = FLEET_SPEC[placement.length];
      const column = document.createElement("div");
      column.className = "stage-rows";
      column.append(
        caption(
          localReady
            ? "Fleet sent — waiting for the opponent's fleet…"
            : next === undefined
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
   * @param context Optional mount context; an online bridge switches to PvP.
   */
  function mount(host: HTMLElement, context?: GameContext): void {
    clearTimer();
    unsubscribeMove?.();
    unsubscribePeer?.();
    unsubscribeMove = null;
    unsubscribePeer = null;
    online = context?.online ?? null;
    peerLeft = false;
    localReady = false;
    remoteFleet = null;
    reset();
    host.replaceChildren();

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    const restart = button("Restart", () => {
      if (online !== null) return;
      reset();
      render();
    });
    restart.disabled = online !== null;
    const rotateBtn = button("Rotate", rotate);
    const randomBtn = button("Random placement", randomise);
    const readyBtn = online === null ? null : button("Ready", ready);
    const hint = label(
      online === null
        ? "sink 5 ships · 10x10"
        : `online · ${online.peerNick ?? "opponent"} · you are seat ${online.seat}`,
    );
    hint.className = "stage-empty";
    bar.append(restart, rotateBtn, randomBtn);
    if (readyBtn !== null) bar.append(readyBtn);
    bar.append(hint);

    const hud = document.createElement("div");
    hud.className = "stage-hud";

    const board = document.createElement("div");
    const status = document.createElement("div");
    status.className = "stage-status";

    refs = { hud, board, status, rotate: rotateBtn, random: randomBtn, ready: readyBtn };
    host.append(bar, hud, status, board);

    if (online !== null) {
      const bridge = online;
      unsubscribeMove = bridge.onMove((payload) => handleRemote(payload));
      unsubscribePeer = bridge.onPeerLeft(() => {
        peerLeft = true;
        message = "Opponent left the match.";
        render();
      });
    }
    render();
  }

  /** @brief Releases the timer, the bridge subscriptions and DOM references. */
  function unmount(): void {
    clearTimer();
    unsubscribeMove?.();
    unsubscribePeer?.();
    unsubscribeMove = null;
    unsubscribePeer = null;
    online = null;
    peerLeft = false;
    localReady = false;
    remoteFleet = null;
    refs = null;
  }

  return { mount, unmount };
}
