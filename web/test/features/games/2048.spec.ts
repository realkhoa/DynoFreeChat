// @vitest-environment jsdom
/**
 * @file 2048.spec.ts
 * @brief Engine rules and one DOM smoke test for the 2048 module.
 */

import { describe, expect, it } from "vitest";
import {
  BOARD_SIZE,
  CELL_COUNT,
  canMove,
  create2048Game,
  createRng,
  directionForKey,
  emptyBoard,
  hasWon,
  moveBoard,
  slideRow,
  spawnTile,
  type Board,
} from "@/features/games/2048/game";

/**
 * @brief Flattens row-major rows into a board.
 * @param rows Four rows of four numbers.
 * @return Flat board.
 */
function boardFromRows(rows: number[][]): Board {
  return rows.flat();
}

describe("2048 slideRow", () => {
  it("merges a pair once and compacts the row", () => {
    const slide = slideRow([2, 2, 0, 0]);
    expect(slide.row).toEqual([4, 0, 0, 0]);
    expect(slide.gained).toBe(4);
    expect(slide.moved).toBe(true);
  });

  it("merges two pairs without chaining the results", () => {
    const slide = slideRow([2, 2, 2, 2]);
    expect(slide.row).toEqual([4, 4, 0, 0]);
    expect(slide.gained).toBe(8);
  });

  it("merges equal tiles only once per move", () => {
    const slide = slideRow([4, 4, 8, 8]);
    expect(slide.row).toEqual([8, 16, 0, 0]);
    expect(slide.gained).toBe(24);
  });

  it("never merges a fresh tile twice", () => {
    const slide = slideRow([2, 2, 4, 0]);
    expect(slide.row).toEqual([4, 4, 0, 0]);
    expect(slide.gained).toBe(4);
  });

  it("compacts without merging when neighbours differ", () => {
    const slide = slideRow([0, 0, 2, 4]);
    expect(slide.row).toEqual([2, 4, 0, 0]);
    expect(slide.gained).toBe(0);
    expect(slide.moved).toBe(true);
  });

  it("reports no movement for an already packed row", () => {
    const slide = slideRow([2, 4, 8, 16]);
    expect(slide.row).toEqual([2, 4, 8, 16]);
    expect(slide.moved).toBe(false);
    expect(slide.gained).toBe(0);
  });
});

describe("2048 moveBoard", () => {
  it("slides left and right", () => {
    const board = boardFromRows([
      [2, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(moveBoard(board, "left").board.slice(0, BOARD_SIZE)).toEqual([4, 0, 0, 0]);
    expect(moveBoard(board, "right").board.slice(0, BOARD_SIZE)).toEqual([0, 0, 0, 4]);
  });

  it("slides up and down along the columns", () => {
    const board = boardFromRows([
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [2, 0, 0, 0],
    ]);
    const up = moveBoard(board, "up");
    expect(up.gained).toBe(4);
    expect(up.board[0]).toBe(4);
    expect(up.board[BOARD_SIZE]).toBe(2);

    const down = moveBoard(board, "down");
    expect(down.board[3 * BOARD_SIZE]).toBe(4);
  });

  it("keeps every cell and reports an unchanged packed board", () => {
    const board = boardFromRows([
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2, 4],
      [8, 16, 32, 2048],
    ]);
    const move = moveBoard(board, "left");
    expect(move.moved).toBe(false);
    expect(move.gained).toBe(0);
    expect(move.board).toHaveLength(CELL_COUNT);
  });
});

describe("2048 spawning and termination", () => {
  it("produces the same values for the same seed", () => {
    const first = createRng(42);
    const second = createRng(42);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it("spawns one tile in an empty cell deterministically", () => {
    const board = emptyBoard();
    board[0] = 8;
    const first = spawnTile(board, createRng(7));
    const second = spawnTile(board, createRng(7));
    expect(first.index).toBe(second.index);
    expect(first.value).toBe(second.value);
    expect([2, 4]).toContain(first.value);
    expect(board[first.index]).toBe(0);
    expect(first.board[first.index]).toBe(first.value);
  });

  it("reports no spawn on a full board", () => {
    const full = new Array<number>(CELL_COUNT).fill(2);
    const spawn = spawnTile(full, createRng(3));
    expect(spawn.index).toBe(-1);
    expect(spawn.value).toBe(0);
    expect(spawn.board).toHaveLength(CELL_COUNT);
  });

  it("detects the winning tile", () => {
    const board = emptyBoard();
    expect(hasWon(board)).toBe(false);
    board[5] = 2048;
    expect(hasWon(board)).toBe(true);
  });

  it("stops when a full board has no equal neighbours", () => {
    const stuck = boardFromRows([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ]);
    expect(canMove(stuck)).toBe(false);
    expect(moveBoard(stuck, "left").moved).toBe(false);
    expect(moveBoard(stuck, "up").moved).toBe(false);
    expect(moveBoard(stuck, "right").moved).toBe(false);
    expect(moveBoard(stuck, "down").moved).toBe(false);
  });

  it("continues while a full board still has an equal pair", () => {
    const alive = boardFromRows([
      [2, 2, 4, 8],
      [16, 32, 64, 128],
      [256, 512, 1024, 2],
      [4, 8, 16, 32],
    ]);
    expect(canMove(alive)).toBe(true);
  });

  it("maps arrow keys and ignores unrelated keys", () => {
    expect(directionForKey("ArrowLeft")).toBe("left");
    expect(directionForKey("ArrowRight")).toBe("right");
    expect(directionForKey("ArrowUp")).toBe("up");
    expect(directionForKey("ArrowDown")).toBe("down");
    expect(directionForKey("a")).toBeNull();
  });
});

describe("2048 view", () => {
  it("mounts, reacts to an arrow key and cleans up", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const game = create2048Game();

    expect(() => game.mount(host)).not.toThrow();
    expect(host.children.length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".stage-cell")).toHaveLength(CELL_COUNT);

    // The opening spawn is random, so any one direction can be blocked. With two
    // tiles on the board at least one of the four directions must rearrange them.
    const read = (): string =>
      Array.from(host.querySelectorAll(".stage-cell"))
        .map((cell) => cell.textContent)
        .join("|");
    const before = read();
    let changed = false;
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
      host.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      changed = read() !== before;
      if (changed) break;
    }
    expect(changed).toBe(true);

    expect(() => game.unmount()).not.toThrow();
    expect(host.children).toHaveLength(0);
    document.body.removeChild(host);
  });
});
