// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GameCoordinator } from "../src/game/coordinator";
import type { BoardState, GameOutcome, GameScore, PlayerMark } from "../src/game/tictactoe";

describe("GameCoordinator", () => {
  it("initializes local game and updates state", () => {
    let lastBoard: BoardState | null = null;
    let lastTurn: PlayerMark | null = null;
    let lastStatus = "";

    const coordinator = new GameCoordinator({
      wsUrl: "wss://fake",
      apiBase: "https://fake",
      getIdentity: () => ({ nick: "Alice", color: "blue" }),
      callbacks: {
        onUpdate: (board, turn) => {
          lastBoard = board;
          lastTurn = turn;
        },
        onStatus: (t) => {
          lastStatus = t;
        },
        onRoomBadge: () => {},
      },
    });

    coordinator.startLocalGame();
    expect(lastTurn).toBe("X");
    expect(lastStatus).toBe("Lượt người chơi X");

    coordinator.handleCellClick(0);
    expect(lastBoard?.[0]).toBe("X");
    expect(lastTurn).toBe("O");

    coordinator.handleCellClick(4);
    expect(lastBoard?.[4]).toBe("O");
    expect(lastTurn).toBe("X");

    coordinator.rematch();
    expect(lastBoard?.[0]).toBeNull();
  });
});
