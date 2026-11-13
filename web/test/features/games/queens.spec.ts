// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createQueensBoard,
  createQueensGame,
  findQueensConflicts,
  isQueensSolved,
  queenCount,
  setQueensCell,
  toggleBlocked,
  toggleQueen,
  type QueensBoard,
} from "@/features/games/queens/game";

/** Builds a board from queen and blocked indexes. */
function boardWith(size: number, queens: number[], blocked: number[] = []): QueensBoard {
  let board = createQueensBoard(size);
  for (const index of queens) board = setQueensCell(board, index, "queen");
  for (const index of blocked) board = setQueensCell(board, index, "blocked");
  return board;
}

describe("queens engine", () => {
  it("creates empty boards for every supported size", () => {
    for (const size of [4, 8]) {
      const board = createQueensBoard(size);
      expect(board.size).toBe(size);
      expect(board.cells).toHaveLength(size * size);
      expect(board.cells.every((cell) => cell === "empty")).toBe(true);
    }
    expect(createQueensBoard(3).size).toBe(4);
    expect(createQueensBoard(99).size).toBe(8);
  });

  it("toggles queens and blocked marks without mutating the source", () => {
    const empty = createQueensBoard(4);
    const queen = toggleQueen(empty, 5);
    expect(queen.cells[5]).toBe("queen");
    expect(empty.cells[5]).toBe("empty");
    expect(queenCount(queen)).toBe(1);

    const blocked = toggleBlocked(queen, 5);
    expect(blocked.cells[5]).toBe("blocked");
    expect(queenCount(blocked)).toBe(0);
    expect(toggleBlocked(blocked, 5).cells[5]).toBe("empty");
    expect(toggleQueen(queen, 5).cells[5]).toBe("empty");
  });

  it("flags queens that share a row", () => {
    const board = boardWith(4, [0, 3]);
    expect(findQueensConflicts(board)).toEqual([0, 3]);
    expect(isQueensSolved(board)).toBe(false);
  });

  it("flags queens that share a column", () => {
    expect(findQueensConflicts(boardWith(4, [0, 4]))).toEqual([0, 4]);
  });

  it("flags queens that share a diagonal at any distance", () => {
    expect(findQueensConflicts(boardWith(4, [0, 5]))).toEqual([0, 5]);
    expect(findQueensConflicts(boardWith(4, [0, 10]))).toEqual([0, 10]);
    expect(findQueensConflicts(boardWith(4, [1, 6]))).toEqual([1, 6]);
  });

  it("keeps peaceful queens unflagged", () => {
    expect(findQueensConflicts(boardWith(4, [0, 7]))).toEqual([]);
    expect(findQueensConflicts(boardWith(8, [0, 12, 23, 29, 34, 46, 49, 59]))).toEqual([]);
  });

  it("solves a 4x4 board with one queen per row and column", () => {
    const board = boardWith(4, [1, 7, 8, 14]);
    expect(findQueensConflicts(board)).toEqual([]);
    expect(queenCount(board)).toBe(4);
    expect(isQueensSolved(board)).toBe(true);
  });

  it("solves an 8x8 board", () => {
    const board = boardWith(8, [0, 12, 23, 29, 34, 46, 49, 59]);
    expect(queenCount(board)).toBe(8);
    expect(isQueensSolved(board)).toBe(true);
  });

  it("is not solved while a queen is missing or a column repeats", () => {
    expect(isQueensSolved(boardWith(4, [1, 7]))).toBe(false);
    expect(isQueensSolved(boardWith(4, [1, 5, 8, 14]))).toBe(false);
  });

  it("ignores blocked marks when detecting conflicts", () => {
    const board = boardWith(4, [0], [5, 10, 15]);
    expect(findQueensConflicts(board)).toEqual([]);
    expect(isQueensSolved(board)).toBe(false);
  });
});

describe("queens view", () => {
  it("mounts, toggles a queen, marks a blocked cell, resizes and unmounts", () => {
    const host = document.createElement("div");
    const game = createQueensGame();
    game.mount(host);
    expect(host.children.length).toBeGreaterThan(0);

    const cell = host.querySelector<HTMLButtonElement>('[data-cell="0"]');
    expect(cell).not.toBeNull();
    cell?.click();
    expect(cell?.className).toContain("is-primary");
    expect(cell?.textContent).toBe("♛");

    cell?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(cell?.className).toContain("is-muted");

    host.querySelector<HTMLButtonElement>('[data-action="undo"]')?.click();
    expect(cell?.textContent).toBe("♛");

    host.querySelector<HTMLButtonElement>('[data-size="4"]')?.click();
    expect(host.querySelectorAll("[data-cell]")).toHaveLength(16);

    game.unmount();
    expect(() => game.unmount()).not.toThrow();
  });
});
