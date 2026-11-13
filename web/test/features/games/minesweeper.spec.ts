// @vitest-environment jsdom
/**
 * @file minesweeper.spec.ts
 * @brief Engine rules and one DOM smoke test for the minesweeper module.
 */

import { describe, expect, it, vi } from "vitest";
import {
  BOARD_SIZE,
  LONG_PRESS_MS,
  MINE_COUNT,
  adjacentMines,
  createField,
  createMinesweeperGame,
  createRng,
  fieldWithMines,
  flagsUsed,
  isLost,
  isWon,
  neighbours,
  placeMines,
  revealCell,
  toggleFlag,
} from "@/features/games/minesweeper/game";

/**
 * @brief Counts the mines on a field.
 * @param field Field to inspect.
 * @return Number of mined cells.
 */
function mineTotal(field: { mines: boolean[] }): number {
  return field.mines.reduce((total, mine) => total + (mine ? 1 : 0), 0);
}

describe("minesweeper placement", () => {
  it("starts with no mines until the first reveal", () => {
    const field = createField(BOARD_SIZE, MINE_COUNT);
    expect(field.size).toBe(9);
    expect(field.mines).toHaveLength(81);
    expect(field.placed).toBe(false);
    expect(mineTotal(field)).toBe(0);
  });

  it("keeps the first click and its neighbourhood free of mines", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const field = createField(BOARD_SIZE, MINE_COUNT);
      const result = revealCell(field, 40, createRng(seed));
      expect(result.hitMine).toBe(false);
      expect(result.field.exploded).toBeNull();
      expect(result.field.mines[40]).toBe(false);
      for (const neighbour of neighbours(BOARD_SIZE, 40)) {
        expect(result.field.mines[neighbour]).toBe(false);
      }
      expect(mineTotal(result.field)).toBe(MINE_COUNT);
    }
  });

  it("keeps a corner first click safe as well", () => {
    const result = revealCell(createField(BOARD_SIZE, MINE_COUNT), 0, createRng(11));
    expect(result.hitMine).toBe(false);
    expect(result.field.mines[0]).toBe(false);
    expect(result.field.mines[1]).toBe(false);
    expect(result.field.mines[9]).toBe(false);
    expect(mineTotal(result.field)).toBe(MINE_COUNT);
  });

  it("places exactly the requested mines", () => {
    const seeded = placeMines(createField(5, 4), 12, createRng(3));
    expect(mineTotal(seeded)).toBe(4);
    expect(seeded.mines[12]).toBe(false);
  });

  it("lists the in-bounds neighbours without the cell itself", () => {
    expect(neighbours(3, 0).sort((a, b) => a - b)).toEqual([1, 3, 4]);
    expect(neighbours(3, 4).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });
});

describe("minesweeper reveal", () => {
  it("flood fills every clear cell and stops at the numbers", () => {
    const field = fieldWithMines(5, [24]);
    const result = revealCell(field, 0);
    expect(result.changed).toBe(true);
    expect(result.hitMine).toBe(false);
    expect(result.field.revealed[24]).toBe(false);
    expect(result.field.revealed.filter(Boolean)).toHaveLength(24);
    expect(adjacentMines(result.field, 18)).toBe(1);
    expect(result.field.revealed[18]).toBe(true);
  });

  it("reveals a numbered cell without expanding through it", () => {
    const field = fieldWithMines(3, [8]);
    const result = revealCell(field, 0);
    expect(result.field.revealed[0]).toBe(true);
    expect(result.field.revealed[4]).toBe(true);
    expect(result.field.revealed[8]).toBe(false);
  });

  it("loses when a mine is revealed", () => {
    const result = revealCell(fieldWithMines(3, [4]), 4);
    expect(result.hitMine).toBe(true);
    expect(result.field.exploded).toBe(4);
    expect(result.field.revealed[4]).toBe(true);
    expect(isLost(result.field)).toBe(true);
    expect(isWon(result.field)).toBe(false);
  });

  it("ignores repeated and flagged reveals", () => {
    const field = fieldWithMines(4, [15]);
    const first = revealCell(field, 0);
    expect(revealCell(first.field, 0).changed).toBe(false);

    const flagged = toggleFlag(field, 1);
    expect(flagged.flagged[1]).toBe(true);
    expect(revealCell(flagged, 1).changed).toBe(false);
    expect(revealCell(flagged, 1).field.revealed[1]).toBe(false);
  });
});

describe("minesweeper flags and win", () => {
  it("toggles a flag on and off without touching revealed cells", () => {
    const field = fieldWithMines(4, [15]);
    const flagged = toggleFlag(field, 0);
    expect(flagged.flagged[0]).toBe(true);
    expect(flagsUsed(flagged)).toBe(1);
    expect(flagged).not.toBe(field);

    const cleared = toggleFlag(flagged, 0);
    expect(cleared.flagged[0]).toBe(false);
    expect(flagsUsed(cleared)).toBe(0);

    const revealed = revealCell(field, 5).field;
    expect(toggleFlag(revealed, 5)).toBe(revealed);
  });

  it("never flags more cells than there are mines", () => {
    const field = fieldWithMines(4, [15]);
    const one = toggleFlag(field, 0);
    expect(flagsUsed(one)).toBe(1);
    expect(toggleFlag(one, 1)).toBe(one);
  });

  it("wins once every safe cell is revealed", () => {
    let field = fieldWithMines(3, [8]);
    for (let index = 0; index < 9; index += 1) {
      if (index === 8) continue;
      field = revealCell(field, index).field;
    }
    expect(isWon(field)).toBe(true);
    expect(isLost(field)).toBe(false);
    expect(field.exploded).toBeNull();
  });
});

describe("minesweeper view", () => {
  it("mounts, flags on long press and releases its timer", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const game = createMinesweeperGame();

    expect(() => game.mount(host)).not.toThrow();
    expect(host.children.length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".stage-cell")).toHaveLength(81);

    const first = host.querySelector<HTMLButtonElement>(".stage-cell");
    if (first === null) throw new Error("expected a cell button");
    first.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(first.textContent).toBe("F");
    expect(vi.getTimerCount()).toBe(0);

    const second = host.querySelectorAll<HTMLButtonElement>(".stage-cell")[1];
    if (second === undefined) throw new Error("expected a second cell");
    second.click();
    expect(host.querySelector(".stage-status")?.textContent ?? "").not.toHaveLength(0);

    expect(() => game.unmount()).not.toThrow();
    expect(host.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    document.body.removeChild(host);
  });
});
