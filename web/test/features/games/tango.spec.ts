// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createTangoGame,
  createTangoPuzzle,
  findTangoViolations,
  isTangoSolved,
  TANGO_MAX_GIVENS,
  TANGO_MAX_RELATIONS,
  TANGO_MIN_GIVENS,
  TANGO_MIN_RELATIONS,
  TANGO_SIZE,
  type TangoCell,
  type TangoRelation,
  type TangoValue,
} from "@/features/games/tango/game";

/** Empty 6x6 grid. */
function blankGrid(): TangoCell[] {
  return new Array<TangoCell>(TANGO_SIZE * TANGO_SIZE).fill(null);
}

/** Grid with the first cells of one row overwritten. */
function withRow(values: readonly TangoCell[]): TangoCell[] {
  const grid = blankGrid();
  values.forEach((value, column) => {
    grid[column] = value;
  });
  return grid;
}

/** Asserts a solution satisfies every line rule. */
function expectValidSolution(solution: readonly TangoValue[]): void {
  expect(solution).toHaveLength(TANGO_SIZE * TANGO_SIZE);
  for (let line = 0; line < TANGO_SIZE; line += 1) {
    const row = solution.slice(line * TANGO_SIZE, line * TANGO_SIZE + TANGO_SIZE);
    const column: TangoValue[] = [];
    for (let rowIndex = 0; rowIndex < TANGO_SIZE; rowIndex += 1) {
      const value = solution[rowIndex * TANGO_SIZE + line];
      if (value !== undefined) column.push(value);
    }
    for (const values of [row, column]) {
      expect(values.filter((value) => value === "sun")).toHaveLength(3);
      expect(values.filter((value) => value === "moon")).toHaveLength(3);
      for (let start = 0; start + 3 <= values.length; start += 1) {
        const window = values.slice(start, start + 3);
        expect(new Set(window).size).toBeGreaterThan(1);
      }
    }
  }
}

describe("tango engine", () => {
  it("reports a horizontal triple", () => {
    const violations = findTangoViolations(withRow(["sun", "sun", "sun", null, null, null]));
    expect(violations.some((violation) => violation.kind === "triple")).toBe(true);
    expect(violations.find((violation) => violation.kind === "triple")?.cells).toEqual([0, 1, 2]);
  });

  it("reports a vertical triple", () => {
    const grid = blankGrid();
    grid[0] = "moon";
    grid[TANGO_SIZE] = "moon";
    grid[TANGO_SIZE * 2] = "moon";
    const violations = findTangoViolations(grid);
    expect(violations.some((violation) => violation.kind === "triple")).toBe(true);
  });

  it("reports a line holding more than three suns", () => {
    const grid = withRow(["sun", "sun", "moon", "sun", "sun", null]);
    const violations = findTangoViolations(grid);
    const balance = violations.find((violation) => violation.kind === "balance");
    expect(balance?.cells).toEqual([0, 1, 3, 4]);
  });

  it("reports relation markers that the grid contradicts", () => {
    const same: TangoRelation = { row: 0, column: 0, direction: "horizontal", kind: "same" };
    const different: TangoRelation = { row: 0, column: 0, direction: "horizontal", kind: "different" };

    const grid = blankGrid();
    grid[0] = "sun";
    grid[1] = "moon";
    expect(findTangoViolations(grid, [same]).map((violation) => violation.kind)).toEqual(["relation"]);

    const equal = blankGrid();
    equal[0] = "sun";
    equal[1] = "sun";
    expect(findTangoViolations(equal, [different]).map((violation) => violation.kind)).toEqual(["relation"]);
    expect(findTangoViolations(equal, [same])).toEqual([]);
  });

  it("does not report unfinished lines or relations", () => {
    expect(findTangoViolations(blankGrid())).toEqual([]);
    const relation: TangoRelation = { row: 0, column: 0, direction: "vertical", kind: "same" };
    expect(findTangoViolations(blankGrid(), [relation])).toEqual([]);
  });

  it("reports a given cell the player overwrote", () => {
    const puzzle = createTangoPuzzle(9);
    const givenIndex = puzzle.givens.findIndex((cell) => cell !== null);
    expect(givenIndex).toBeGreaterThanOrEqual(0);
    const grid = [...puzzle.solution];
    const given = puzzle.givens[givenIndex];
    grid[givenIndex] = given === "sun" ? "moon" : "sun";
    expect(findTangoViolations(grid, puzzle.relations, puzzle.givens).some((v) => v.kind === "given")).toBe(
      true,
    );
    expect(isTangoSolved(grid, puzzle.relations, puzzle.givens)).toBe(false);
  });

  it("accepts only complete grids as solved", () => {
    const puzzle = createTangoPuzzle(17);
    expect(isTangoSolved(puzzle.solution, puzzle.relations, puzzle.givens)).toBe(true);
    expect(isTangoSolved(blankGrid(), puzzle.relations, puzzle.givens)).toBe(false);
    const partial: TangoCell[] = [...puzzle.solution];
    partial[0] = null;
    expect(isTangoSolved(partial, puzzle.relations, puzzle.givens)).toBe(false);
  });
});

describe("tango generator", () => {
  it("always produces a solution that satisfies every constraint", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const puzzle = createTangoPuzzle(seed);
      expectValidSolution(puzzle.solution);
      expect(isTangoSolved(puzzle.solution, puzzle.relations, puzzle.givens)).toBe(true);
    }
  });

  it("keeps 8-10 givens and 6-8 relation markers that match the solution", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const puzzle = createTangoPuzzle(seed);
      const givens = puzzle.givens.filter((cell) => cell !== null);
      expect(givens.length).toBeGreaterThanOrEqual(TANGO_MIN_GIVENS);
      expect(givens.length).toBeLessThanOrEqual(TANGO_MAX_GIVENS);
      expect(puzzle.relations.length).toBeGreaterThanOrEqual(TANGO_MIN_RELATIONS);
      expect(puzzle.relations.length).toBeLessThanOrEqual(TANGO_MAX_RELATIONS);

      for (const relation of puzzle.relations) {
        const anchor = relation.row * TANGO_SIZE + relation.column;
        const neighbour = relation.direction === "horizontal" ? anchor + 1 : anchor + TANGO_SIZE;
        const same = puzzle.solution[anchor] === puzzle.solution[neighbour];
        expect(same).toBe(relation.kind === "same");
      }
      for (let index = 0; index < puzzle.givens.length; index += 1) {
        const given = puzzle.givens[index];
        if (given !== null) expect(given).toBe(puzzle.solution[index]);
      }
    }
  });

  it("is deterministic for a seed", () => {
    expect(createTangoPuzzle(42)).toEqual(createTangoPuzzle(42));
    expect(createTangoPuzzle(42)).not.toEqual(createTangoPuzzle(43));
  });
});

describe("tango view", () => {
  it("cycles cells, supports 1/2/0 keys, keeps givens and unmounts", () => {
    const host = document.createElement("div");
    const game = createTangoGame();
    game.mount(host);
    expect(host.children.length).toBeGreaterThan(0);
    expect(host.querySelectorAll("[data-cell]")).toHaveLength(TANGO_SIZE * TANGO_SIZE);

    const cells = [...host.querySelectorAll<HTMLButtonElement>("[data-cell]")];
    const empty = cells.find((cell) => !cell.classList.contains("is-dim"));
    expect(empty).toBeDefined();
    empty?.click();
    expect(empty?.textContent).toBe("☀");
    empty?.click();
    expect(empty?.textContent).toBe("☾");
    empty?.click();
    expect(empty?.textContent).toBe("");

    host.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    expect(empty?.textContent).toBe("☀");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));
    expect(empty?.textContent).toBe("");

    const given = host.querySelector<HTMLButtonElement>("[data-cell].is-dim");
    const givenText = given?.textContent;
    given?.click();
    expect(given?.textContent).toBe(givenText);

    host.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    expect(host.querySelectorAll("[data-cell]")).toHaveLength(TANGO_SIZE * TANGO_SIZE);

    game.unmount();
    expect(() => game.unmount()).not.toThrow();
  });
});
