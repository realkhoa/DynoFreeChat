// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  countSudokuSolutions,
  createSudokuGame,
  findSudokuConflicts,
  generateSudokuPuzzle,
  isSudokuSolved,
  mulberry32,
  solveSudoku,
  SUDOKU_CELLS,
  SUDOKU_GIVENS,
  type SudokuDifficulty,
} from "@/features/games/sudoku/game";

/** Classic puzzle with exactly one solution. */
const KNOWN_PUZZLE: readonly number[] = [
  5, 3, 0, 0, 7, 0, 0, 0, 0, 6, 0, 0, 1, 9, 5, 0, 0, 0, 0, 9, 8, 0, 0, 0, 0, 6, 0, 8, 0, 0, 0, 6, 0, 0, 0, 3,
  4, 0, 0, 8, 0, 3, 0, 0, 1, 7, 0, 0, 0, 2, 0, 0, 0, 6, 0, 6, 0, 0, 0, 0, 2, 8, 0, 0, 0, 0, 4, 1, 9, 0, 0, 5,
  0, 0, 0, 0, 8, 0, 0, 7, 9,
];

/** Solution of {@link KNOWN_PUZZLE}. */
const KNOWN_SOLUTION: readonly number[] = [
  5, 3, 4, 6, 7, 8, 9, 1, 2, 6, 7, 2, 1, 9, 5, 3, 4, 8, 1, 9, 8, 3, 4, 2, 5, 6, 7, 8, 5, 9, 7, 6, 1, 4, 2, 3,
  4, 2, 6, 8, 5, 3, 7, 9, 1, 7, 1, 3, 9, 2, 4, 8, 5, 6, 9, 6, 1, 5, 3, 7, 2, 8, 4, 2, 8, 7, 4, 1, 9, 6, 3, 5,
  3, 4, 5, 2, 8, 6, 1, 7, 9,
];

/** Counts non-zero clues. */
function countGivens(grid: readonly number[]): number {
  return grid.filter((value) => value !== 0).length;
}

/** Asserts a completed grid is a valid Sudoku solution. */
function expectValidSolution(grid: readonly number[]): void {
  expect(grid).toHaveLength(SUDOKU_CELLS);
  for (let row = 0; row < 9; row += 1) {
    const values = grid.slice(row * 9, row * 9 + 9);
    expect(new Set(values).size).toBe(9);
  }
  for (let column = 0; column < 9; column += 1) {
    const values: number[] = [];
    for (let row = 0; row < 9; row += 1) values.push(grid[row * 9 + column] ?? 0);
    expect(new Set(values).size).toBe(9);
  }
  for (let box = 0; box < 9; box += 1) {
    const values: number[] = [];
    const startRow = Math.floor(box / 3) * 3;
    const startColumn = (box % 3) * 3;
    for (let row = startRow; row < startRow + 3; row += 1) {
      for (let column = startColumn; column < startColumn + 3; column += 1) {
        const value = grid[row * 9 + column];
        if (value !== undefined) values.push(value);
      }
    }
    expect(new Set(values).size).toBe(9);
  }
}

describe("sudoku solver", () => {
  it("solves a known puzzle", () => {
    expect(solveSudoku(KNOWN_PUZZLE)).toEqual(KNOWN_SOLUTION);
  });

  it("counts a unique solution once and an ambiguous grid up to the cap", () => {
    expect(countSudokuSolutions(KNOWN_PUZZLE)).toBe(1);
    const blank = new Array<number>(SUDOKU_CELLS).fill(0);
    expect(countSudokuSolutions(blank, 2)).toBe(2);
  });

  it("refuses a contradictory grid", () => {
    const grid = new Array<number>(SUDOKU_CELLS).fill(0);
    grid[0] = 5;
    grid[1] = 5;
    expect(solveSudoku(grid)).toBeNull();
    expect(countSudokuSolutions(grid)).toBe(0);
  });
});

describe("sudoku validator", () => {
  it("catches a repeated digit in a row, a column and a box", () => {
    const row = new Array<number>(SUDOKU_CELLS).fill(0);
    row[0] = 5;
    row[4] = 5;
    expect(findSudokuConflicts(row)).toEqual([0, 4]);

    const column = new Array<number>(SUDOKU_CELLS).fill(0);
    column[0] = 7;
    column[9] = 7;
    expect(findSudokuConflicts(column)).toEqual([0, 9]);

    const box = new Array<number>(SUDOKU_CELLS).fill(0);
    box[10] = 3;
    box[20] = 3;
    expect(findSudokuConflicts(box)).toEqual([10, 20]);
  });

  it("accepts only a complete valid grid as solved", () => {
    expect(isSudokuSolved(KNOWN_SOLUTION)).toBe(true);
    expect(isSudokuSolved(KNOWN_PUZZLE)).toBe(false);
    const broken = [...KNOWN_SOLUTION];
    broken[0] = broken[1] ?? 0;
    expect(isSudokuSolved(broken)).toBe(false);
    expect(findSudokuConflicts(broken)).toContain(0);
  });
});

describe("sudoku generator", () => {
  const cases: readonly SudokuDifficulty[] = ["easy", "normal", "hard"];

  for (const difficulty of cases) {
    it(`produces a unique ${difficulty} puzzle with ${SUDOKU_GIVENS[difficulty]} givens`, () => {
      const puzzle = generateSudokuPuzzle(mulberry32(2026), difficulty);
      expect(puzzle.givens).toHaveLength(SUDOKU_CELLS);
      expect(countGivens(puzzle.givens)).toBe(SUDOKU_GIVENS[difficulty]);
      expect(countSudokuSolutions(puzzle.givens, 2)).toBe(1);
      expectValidSolution(puzzle.solution);
      expect(solveSudoku(puzzle.givens)).toEqual(puzzle.solution);
      for (let index = 0; index < SUDOKU_CELLS; index += 1) {
        const given = puzzle.givens[index] ?? 0;
        if (given !== 0) expect(given).toBe(puzzle.solution[index]);
      }
    });
  }

  it("is deterministic for a seed", () => {
    const first = generateSudokuPuzzle(mulberry32(77), "normal");
    const second = generateSudokuPuzzle(mulberry32(77), "normal");
    expect(first.givens).toEqual(second.givens);
    expect(first.solution).toEqual(second.solution);
  });

  it("hits the requested clue count across seeds", () => {
    for (const difficulty of cases) {
      for (let seed = 1; seed <= 4; seed += 1) {
        const puzzle = generateSudokuPuzzle(mulberry32(seed), difficulty);
        expect(countGivens(puzzle.givens)).toBe(SUDOKU_GIVENS[difficulty]);
        expect(countSudokuSolutions(puzzle.givens, 2)).toBe(1);
        expectValidSolution(puzzle.solution);
      }
    }
  });
});

describe("sudoku view", () => {
  it("mounts, fills and clears a cell, switches difficulty, uses a hint and unmounts", () => {
    const host = document.createElement("div");
    const game = createSudokuGame();
    game.mount(host);
    expect(host.children.length).toBeGreaterThan(0);
    expect(host.querySelectorAll("[data-cell]")).toHaveLength(SUDOKU_CELLS);

    const cells = [...host.querySelectorAll<HTMLButtonElement>("[data-cell]")];
    const empty = cells.find((cell) => !cell.classList.contains("is-dim") && cell.textContent === "");
    expect(empty).toBeDefined();
    empty?.click();
    expect(empty?.className).toContain("is-primary");

    empty?.dispatchEvent(new KeyboardEvent("keydown", { key: "5", bubbles: true }));
    expect(empty?.textContent).toBe("5");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(empty?.textContent).toBe("");

    host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(host.querySelectorAll("[data-cell]")).toHaveLength(SUDOKU_CELLS);

    host.querySelector<HTMLButtonElement>('[data-difficulty="easy"]')?.click();
    expect(host.querySelectorAll("[data-cell]")).toHaveLength(SUDOKU_CELLS);

    const filledBefore = [...host.querySelectorAll<HTMLButtonElement>("[data-cell]")].filter(
      (cell) => cell.textContent !== "",
    ).length;
    host.querySelector<HTMLButtonElement>('[data-action="hint"]')?.click();
    const filledAfter = [...host.querySelectorAll<HTMLButtonElement>("[data-cell]")].filter(
      (cell) => cell.textContent !== "",
    ).length;
    expect(filledAfter).toBe(filledBefore + 1);

    game.mount(host);
    expect(host.querySelectorAll("[data-cell]")).toHaveLength(SUDOKU_CELLS);

    game.unmount();
    expect(() => game.unmount()).not.toThrow();
  });
});
