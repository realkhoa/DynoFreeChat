/**
 * @file registry.spec.ts
 * @brief Guards the game registry contract so adding games stays mechanical.
 */

import { describe, expect, it } from "vitest";
import { GAMES, findGame } from "@/features/games/registry";

describe("game registry", () => {
  it("ships at least one game", () => {
    expect(GAMES.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps ids, class names and document titles unique", () => {
    const ids = GAMES.map((game) => game.id);
    const classes = GAMES.map((game) => game.className);
    const titles = GAMES.map((game) => game.documentTitle);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(classes).size).toBe(classes.length);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gives every game a display name, a class and a document title", () => {
    for (const game of GAMES) {
      expect(game.id).toMatch(/^[a-z0-9]+$/);
      expect(game.name.length).toBeGreaterThan(0);
      expect(game.className).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      expect(game.documentTitle).toMatch(/^[A-Za-z0-9]+\.cs$/);
      expect(game.summary.length).toBeGreaterThan(0);
      expect(game.hotkey).toMatch(/^F\d{1,2}$/);
    }
  });

  it("names the tic-tac-toe game after itself, not after an internal codename", () => {
    const game = findGame("tictactoe");
    expect(game?.name).toBe("Tic-Tac-Toe");
    expect(game?.className).toBe("TicTacToe");
    expect(game?.documentTitle).toBe("TicTacToe.cs");
  });

  it("returns undefined for an unknown id", () => {
    expect(findGame("does-not-exist")).toBeUndefined();
  });
});
