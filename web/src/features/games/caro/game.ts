/**
 * @file caro/game.ts
 * @brief Vietnamese Caro (Gomoku) on a 15x15 board, against the AI or online.
 * @details The file holds the pure engine (board, win detection, heuristic move
 * scorer) and the vanilla DOM view. All mutable view state lives in the
 * {@link createCaroGame} closure so the stage can remount the module to restart.
 * When an online bridge is supplied the AI is replaced by the opponent: local
 * clicks are relayed and the opponent's moves are applied through the bridge.
 */

import type { GameContext, GameMount } from "../mount";
import type { OnlineBridge } from "../online/bridge";

/** @brief Board edge length: Caro is played on 15x15 here. */
export const CARO_SIZE = 15;

/** @brief Marks on the board: the player is X, the AI is O. */
export type CaroMark = "X" | "O";

/** @brief Row-major 15x15 board; null marks an empty cell. */
export type CaroBoard = readonly (CaroMark | null)[];

/** @brief How many marks in a line win the game. */
export const WIN_LENGTH = 5;

/** Score of a line that already wins; also used as the immediate-win sentinel. */
const WIN_SCORE = 10_000_000;

/** Four scanning directions: horizontal, vertical and both diagonals. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** @brief A completed five-in-a-row and the cells that form it. */
export interface CaroWin {
  /** Mark that owns the line. */
  mark: CaroMark;
  /** Board indices of the winning cells, used for the highlight. */
  line: readonly number[];
}

/**
 * @brief Reads one cell, tolerating out-of-range indices.
 * @param board Board to read.
 * @param index Row-major index.
 * @return The mark or null when empty / out of range.
 */
function at(board: CaroBoard, index: number): CaroMark | null {
  return board[index] ?? null;
}

/**
 * @brief Tests whether a row/column pair is inside the board.
 * @param row Row index (0 = top row).
 * @param col Column index (0 = left column).
 * @return True when both are in range.
 */
function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < CARO_SIZE && col >= 0 && col < CARO_SIZE;
}

/**
 * @brief Reads a cell by row and column.
 * @param board Board to read.
 * @param row Row index.
 * @param col Column index.
 * @return The mark, or null when empty or off the board.
 */
function cellAt(board: CaroBoard, row: number, col: number): CaroMark | null {
  return inBounds(row, col) ? at(board, row * CARO_SIZE + col) : null;
}

/**
 * @brief Human readable square name, e.g. H8.
 * @param index Row-major board index.
 * @return Uppercase file letter plus 1-based rank counted from the bottom.
 */
export function caroSquareName(index: number): string {
  const row = Math.floor(index / CARO_SIZE);
  const col = index % CARO_SIZE;
  return `${String.fromCharCode(65 + col)}${CARO_SIZE - row}`;
}

/**
 * @brief Creates an empty 15x15 board.
 * @return 225 null cells in row-major order.
 */
export function createCaroBoard(): CaroBoard {
  return Array<CaroMark | null>(CARO_SIZE * CARO_SIZE).fill(null);
}

/**
 * @brief Finds a five-in-a-row anywhere on the board.
 * @param board Board to scan.
 * @return The winner and its line, or null when nobody has five in a row.
 */
export function findCaroWin(board: CaroBoard): CaroWin | null {
  for (let row = 0; row < CARO_SIZE; row++) {
    for (let col = 0; col < CARO_SIZE; col++) {
      const mark = cellAt(board, row, col);
      if (mark === null) continue;

      for (const [dr, dc] of DIRECTIONS) {
        // Only start at the first cell of a run so the highlight covers it.
        if (cellAt(board, row - dr, col - dc) === mark) continue;

        const line: number[] = [];
        let r = row;
        let c = col;
        while (line.length < WIN_LENGTH && cellAt(board, r, c) === mark) {
          line.push(r * CARO_SIZE + c);
          r += dr;
          c += dc;
        }
        if (line.length === WIN_LENGTH) return { mark, line };
      }
    }
  }
  return null;
}

/**
 * @brief Tests whether every cell is occupied.
 * @param board Board to inspect.
 * @return True when no empty cell is left.
 */
export function isCaroFull(board: CaroBoard): boolean {
  for (let i = 0; i < CARO_SIZE * CARO_SIZE; i++) {
    if (at(board, i) === null) return false;
  }
  return true;
}

/**
 * @brief Scores one run length with its number of open ends.
 * @param run Consecutive marks including the hypothetical stone.
 * @param openEnds How many ends of the run are still empty (0..2).
 * @return Heuristic value; a completed five dominates every other shape.
 */
function runScore(run: number, openEnds: number): number {
  if (run >= WIN_LENGTH) return WIN_SCORE;
  if (run === 4) return openEnds === 2 ? 1_000_000 : openEnds === 1 ? 120_000 : 0;
  if (run === 3) return openEnds === 2 ? 20_000 : openEnds === 1 ? 2_000 : 0;
  if (run === 2) return openEnds === 2 ? 600 : openEnds === 1 ? 80 : 0;
  return openEnds === 2 ? 20 : 4;
}

/**
 * @brief Scores one cell as if `mark` were placed there, summed over the four
 * directions. The run is extended through the candidate cell, then the open
 * ends decide the pattern value.
 * @param board Current board.
 * @param row Row of the candidate cell.
 * @param col Column of the candidate cell.
 * @param mark Mark the candidate would receive.
 * @return Heuristic score for this direction set.
 */
function cellScore(board: CaroBoard, row: number, col: number, mark: CaroMark): number {
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let run = 1;
    let openEnds = 0;
    for (const sign of [1, -1] as const) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (cellAt(board, r, c) === mark) {
        run++;
        r += dr * sign;
        c += dc * sign;
      }
      if (inBounds(r, c) && cellAt(board, r, c) === null) openEnds++;
    }
    total += runScore(run, openEnds);
  }
  return total;
}

/**
 * @brief Tests whether a cell has a stone within `radius` so the AI only
 * considers plausible moves instead of the whole board.
 * @param board Current board.
 * @param row Row of the candidate cell.
 * @param col Column of the candidate cell.
 * @return True when a neighbouring stone exists.
 */
function hasNeighbour(board: CaroBoard, row: number, col: number): boolean {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (cellAt(board, row + dr, col + dc) !== null) return true;
    }
  }
  return false;
}

/**
 * @brief Picks the AI move: immediate win, immediate block, then the best
 * pattern score with a mild centre preference. Fully deterministic.
 * @param board Current board.
 * @param ai Mark the AI plays.
 * @return Board index to play, or -1 when the board is full.
 */
export function chooseAiMove(board: CaroBoard, ai: CaroMark): number {
  const foe: CaroMark = ai === "X" ? "O" : "X";
  const centre = Math.floor(CARO_SIZE / 2) * CARO_SIZE + Math.floor(CARO_SIZE / 2);
  let winMove = -1;
  let blockMove = -1;
  let bestMove = -1;
  let bestScore = -Infinity;

  for (let row = 0; row < CARO_SIZE; row++) {
    for (let col = 0; col < CARO_SIZE; col++) {
      const index = row * CARO_SIZE + col;
      if (at(board, index) !== null) continue;
      if (!hasNeighbour(board, row, col)) continue;

      const attack = cellScore(board, row, col, ai);
      if (attack >= WIN_SCORE && winMove < 0) {
        winMove = index;
        continue;
      }
      const block = cellScore(board, row, col, foe);
      if (block >= WIN_SCORE && blockMove < 0) blockMove = index;

      const centreBonus = (CARO_SIZE - 1 - Math.abs(row - 7) - Math.abs(col - 7)) * 12;
      const score = attack + block * 0.92 + centreBonus;
      if (score > bestScore) {
        bestScore = score;
        bestMove = index;
      }
    }
  }

  if (winMove >= 0) return winMove;
  if (blockMove >= 0) return blockMove;
  if (bestMove >= 0) return bestMove;
  if (at(board, centre) === null) return centre;

  for (let i = 0; i < CARO_SIZE * CARO_SIZE; i++) {
    if (at(board, i) === null) return i;
  }
  return -1;
}

/**
 * @brief Builds the Caro game module (engine state + DOM view).
 * @return A mountable game whose state is entirely closure-private.
 */
export function createCaroGame(): GameMount {
  let board: (CaroMark | null)[] = [...createCaroBoard()];
  let history: number[] = [];
  let cells: HTMLButtonElement[] = [];
  let statusEl: HTMLElement | null = null;
  let movesEl: HTMLElement | null = null;
  let turn: CaroMark = "X";
  let lastMove = -1;
  let win: CaroWin | null = null;
  let draw = false;
  let timer: number | null = null;
  let online: OnlineBridge | null = null;
  let peerLeft = false;
  let unsubscribeMove: (() => void) | null = null;
  let unsubscribePeer: (() => void) | null = null;

  /** @brief Mark the local player uses in an online match. */
  function localMark(): CaroMark {
    return online !== null && online.seat === 2 ? "O" : "X";
  }

  /** @brief Cancels the pending AI move timer. */
  function clearTimer(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  /**
   * @brief Creates a small shared-style button.
   * @param label Button caption.
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
   * @brief Creates one small HUD label.
   * @param text Initial text.
   * @return The span element.
   */
  function hudLabel(text: string): HTMLElement {
    const el = document.createElement("span");
    el.textContent = text;
    return el;
  }

  /**
   * @brief Accessible label for one cell.
   * @param index Board index.
   * @return Description including coordinates and content.
   */
  function cellLabel(index: number): string {
    const mark = at(board, index);
    const state = mark === null ? "empty" : mark;
    const suffix = index === lastMove ? ", last move" : "";
    return `${caroSquareName(index)}, ${state}${suffix}`;
  }

  /** @brief Status line derived from the current state. */
  function statusText(): string {
    const mine = localMark();
    if (win !== null) {
      if (online !== null) {
        return win.mark === mine
          ? `Five in a row at ${caroSquareName(win.line[0] ?? 0)} — you win.`
          : `Opponent wins with five in a row at ${caroSquareName(win.line[0] ?? 0)}.`;
      }
      return win.mark === "X"
        ? `Five in a row for X at ${caroSquareName(win.line[0] ?? 0)} — you win.`
        : `AI wins with five in a row at ${caroSquareName(win.line[0] ?? 0)}.`;
    }
    if (draw) return "Board full — draw. Press Restart to play again.";
    if (online !== null) {
      if (peerLeft) return "Opponent left the match.";
      if (turn === mine) return `Your turn — you are ${mine}.`;
      return `Opponent's turn — you are ${mine}.`;
    }
    if (turn === "O") return `You played ${caroSquareName(lastMove)}. AI thinking…`;
    if (history.length === 0) return "You are X. Click any cell to open the game.";
    return `AI played ${caroSquareName(lastMove)}. Your turn — you are X.`;
  }

  /** @brief Repaints every cell, the HUD and the status line. */
  function render(): void {
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell === undefined) continue;
      const mark = at(board, i);
      cell.textContent = mark ?? "";
      cell.className = "stage-cell";
      if (mark !== null) cell.classList.add(mark === "X" ? "is-primary" : "is-warn");
      // The winning line and the most recent stone both use the shared highlight.
      if ((win !== null && win.line.includes(i)) || i === lastMove) cell.classList.add("is-good");
      cell.setAttribute("aria-label", cellLabel(i));
    }
    if (movesEl !== null) movesEl.textContent = `moves: ${history.length}`;
    if (statusEl !== null) statusEl.textContent = statusText();
  }

  /**
   * @brief Records one move, updating win/draw state.
   * @param index Board index.
   * @param mark Mark to place.
   */
  function place(index: number, mark: CaroMark): void {
    board[index] = mark;
    history.push(index);
    lastMove = index;
    win = findCaroWin(board);
    if (win === null && isCaroFull(board)) draw = true;
  }

  /** @brief Plays the AI turn on a short timer so the UI can repaint first. */
  function aiTurn(): void {
    timer = null;
    if (win !== null || draw) return;
    const index = chooseAiMove(board, "O");
    if (index < 0) {
      draw = true;
      render();
      return;
    }
    place(index, "O");
    turn = "X";
    render();
  }

  /**
   * @brief Handles a player click on one cell.
   * @param index Board index.
   */
  function playAt(index: number): void {
    if (win !== null || draw || peerLeft) return;
    const mine = localMark();
    if (turn !== mine) return;
    if (at(board, index) !== null) return;

    place(index, mine);
    turn = mine === "X" ? "O" : "X";
    render();
    if (win !== null) return;

    if (online !== null) {
      online.sendMove({ index });
      return;
    }
    clearTimer();
    timer = window.setTimeout(aiTurn, 140);
  }

  /** @brief Restores the board from the move history. */
  function rebuild(): void {
    board = [...createCaroBoard()];
    for (let i = 0; i < history.length; i++) {
      const index = history[i];
      if (index !== undefined) board[index] = i % 2 === 0 ? "X" : "O";
    }
    win = findCaroWin(board);
    draw = win === null && isCaroFull(board);
    turn = history.length % 2 === 0 ? "X" : "O";
    const tail = history[history.length - 1];
    lastMove = tail ?? -1;
  }

  /** @brief Removes the last move pair (or the lone player move) and repaints. */
  function undo(): void {
    if (online !== null) return;
    clearTimer();
    if (history.length === 0) {
      render();
      return;
    }
    history = history.slice(0, history.length - (history.length % 2 === 1 ? 1 : 2));
    rebuild();
    render();
  }

  /** @brief Resets the game to an empty board. */
  function restart(): void {
    if (online !== null) return;
    clearTimer();
    board = [...createCaroBoard()];
    history = [];
    turn = "X";
    lastMove = -1;
    win = null;
    draw = false;
    render();
  }

  /**
   * @brief Mounts the game, replacing any previous content of the host.
   * @param target Host element owned by the game stage.
   * @param context Optional mount context; an online bridge switches to PvP.
   */
  function mount(target: HTMLElement, context?: GameContext): void {
    clearTimer();
    unsubscribeMove?.();
    unsubscribePeer?.();
    unsubscribeMove = null;
    unsubscribePeer = null;
    online = context?.online ?? null;
    peerLeft = false;
    board = [...createCaroBoard()];
    history = [];
    turn = "X";
    lastMove = -1;
    win = null;
    draw = false;
    target.replaceChildren();

    if (online !== null) {
      const bridge = online;
      const foe: CaroMark = bridge.seat === 1 ? "O" : "X";
      unsubscribeMove = bridge.onMove((payload) => {
        if (win !== null || draw) return;
        const index = (payload as { index?: unknown } | null)?.index;
        if (typeof index !== "number" || !Number.isInteger(index)) return;
        if (index < 0 || index >= CARO_SIZE * CARO_SIZE) return;
        if (turn !== foe || at(board, index) !== null) return;
        place(index, foe);
        turn = foe === "X" ? "O" : "X";
        render();
      });
      unsubscribePeer = bridge.onPeerLeft(() => {
        peerLeft = true;
        render();
      });
    }

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    const undoBtn = button("Undo", undo);
    const restartBtn = button("Restart", restart);
    undoBtn.disabled = online !== null;
    restartBtn.disabled = online !== null;
    const hint = hudLabel(
      online === null
        ? `15x15 · win with ${WIN_LENGTH} in a row`
        : `online · ${online.peerNick ?? "opponent"} · you are ${localMark()}`,
    );
    hint.className = "stage-empty";
    bar.append(restartBtn, undoBtn, hint);

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    const youEl = hudLabel(`you: ${localMark()}`);
    const aiEl = hudLabel(online === null ? "ai: O" : `opponent: ${localMark() === "X" ? "O" : "X"}`);
    movesEl = hudLabel("moves: 0");
    hud.append(youEl, aiEl, movesEl);

    const grid = document.createElement("div");
    grid.className = "stage-board";
    grid.style.gridTemplateColumns = `repeat(${CARO_SIZE}, 44px)`;

    cells = [];
    for (let row = 0; row < CARO_SIZE; row++) {
      for (let col = 0; col < CARO_SIZE; col++) {
        const index = row * CARO_SIZE + col;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "stage-cell";
        cell.setAttribute("aria-label", `${caroSquareName(index)}, empty`);
        cell.addEventListener("click", () => playAt(index));
        cells.push(cell);
        grid.append(cell);
      }
    }

    statusEl = document.createElement("div");
    statusEl.className = "stage-status";
    target.append(bar, hud, grid, statusEl);
    render();
  }

  /** @brief Releases the timer, bridge subscriptions and DOM references. */
  function unmount(): void {
    clearTimer();
    unsubscribeMove?.();
    unsubscribePeer?.();
    unsubscribeMove = null;
    unsubscribePeer = null;
    online = null;
    peerLeft = false;
    cells = [];
    statusEl = null;
    movesEl = null;
  }

  return { mount, unmount };
}
