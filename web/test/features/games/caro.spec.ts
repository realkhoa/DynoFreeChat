// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  CARO_SIZE,
  caroSquareName,
  chooseAiMove,
  createCaroBoard,
  createCaroGame,
  findCaroWin,
  isCaroFull,
  type CaroBoard,
  type CaroMark,
} from "@/features/games/caro/game";

/** Builds a board from a sparse list of stones. */
function boardWith(stones: readonly (readonly [number, number, CaroMark])[]): CaroBoard {
  const board = [...createCaroBoard()];
  for (const [row, col, mark] of stones) board[row * CARO_SIZE + col] = mark;
  return board;
}

/** Counts occupied cells with one mark. */
function count(board: CaroBoard, mark: CaroMark): number {
  return board.filter((cell) => cell === mark).length;
}

describe("caro engine", () => {
  it("creates a 15x15 board with 225 empty cells", () => {
    const board = createCaroBoard();
    expect(board).toHaveLength(225);
    expect(count(board, "X")).toBe(0);
    expect(isCaroFull(board)).toBe(false);
  });

  it("detects a horizontal five", () => {
    const board = boardWith([3, 4, 5, 6, 7].map((col) => [7, col, "X"] as const));
    const win = findCaroWin(board);
    expect(win?.mark).toBe("X");
    expect(win?.line).toHaveLength(5);
    expect(win?.line).toEqual([108, 109, 110, 111, 112]);
  });

  it("detects a vertical five", () => {
    const board = boardWith([2, 3, 4, 5, 6].map((row) => [row, 4, "O"] as const));
    const win = findCaroWin(board);
    expect(win?.mark).toBe("O");
    expect(win?.line).toHaveLength(5);
  });

  it("detects both diagonal directions", () => {
    const down = boardWith([2, 3, 4, 5, 6].map((step) => [step, step, "X"] as const));
    expect(findCaroWin(down)?.mark).toBe("X");

    const up = boardWith([2, 3, 4, 5, 6].map((step) => [step, 14 - step, "O"] as const));
    expect(findCaroWin(up)?.mark).toBe("O");
    expect(findCaroWin(up)?.line).toHaveLength(5);
  });

  it("does not award a win for four in a row", () => {
    const board = boardWith([3, 4, 5, 6].map((col) => [7, col, "X"] as const));
    expect(findCaroWin(board)).toBeNull();
  });

  it("reports a full board", () => {
    const board = [...createCaroBoard()];
    // A 1/2 weighted pattern never produces five in a row on any axis.
    for (let i = 0; i < board.length; i++) {
      const row = Math.floor(i / CARO_SIZE);
      const col = i % CARO_SIZE;
      board[i] = (row + 2 * col) % 4 < 2 ? "X" : "O";
    }
    expect(isCaroFull(board)).toBe(true);
    expect(findCaroWin(board)).toBeNull();
  });

  it("names squares from the bottom rank", () => {
    expect(caroSquareName(0)).toBe("A15");
    expect(caroSquareName(112)).toBe("H8");
    expect(caroSquareName(224)).toBe("O1");
  });

  it("takes an immediate five instead of blocking", () => {
    const board = boardWith([
      [5, 4, "O"],
      [5, 5, "O"],
      [5, 6, "O"],
      [5, 7, "O"],
      [9, 4, "X"],
      [9, 5, "X"],
      [9, 6, "X"],
      [9, 7, "X"],
    ]);
    const move = chooseAiMove(board, "O");
    const row = Math.floor(move / CARO_SIZE);
    const col = move % CARO_SIZE;
    expect(row).toBe(5);
    expect([3, 8]).toContain(col);
  });

  it("blocks an opponent five when it has none of its own", () => {
    const board = boardWith([3, 4, 5, 6].map((col) => [7, col, "X"] as const));
    const move = chooseAiMove(board, "O");
    expect(Math.floor(move / CARO_SIZE)).toBe(7);
    expect([2, 7]).toContain(move % CARO_SIZE);

    const after = [...board];
    after[move] = "O";
    expect(findCaroWin(after)?.mark).not.toBe("X");
  });

  it("never picks an occupied cell", () => {
    const board = boardWith([
      [7, 7, "X"],
      [7, 8, "O"],
      [6, 7, "X"],
      [8, 8, "O"],
    ]);
    const move = chooseAiMove(board, "O");
    expect(board[move]).toBeNull();
    expect(move).toBeGreaterThanOrEqual(0);
  });

  it("opens on the centre of an empty board", () => {
    expect(chooseAiMove(createCaroBoard(), "X")).toBe(112);
    expect(chooseAiMove(createCaroBoard(), "O")).toBe(112);
  });

  it("is deterministic and answers inside the 200 ms budget", () => {
    const board = boardWith([
      [7, 7, "X"],
      [6, 8, "O"],
      [8, 6, "X"],
      [5, 9, "O"],
    ]);
    const started = performance.now();
    const first = chooseAiMove(board, "O");
    const elapsed = performance.now() - started;
    expect(chooseAiMove(board, "O")).toBe(first);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("caro view", () => {
  it("mounts a playable board, plays a cell and unmounts cleanly", () => {
    const host = document.createElement("div");
    const game = createCaroGame();
    game.mount(host);

    expect(host.children.length).toBeGreaterThan(0);
    const cells = host.querySelectorAll<HTMLButtonElement>(".stage-cell");
    expect(cells).toHaveLength(225);
    expect(cells[0]?.tagName).toBe("BUTTON");
    expect(cells[0]?.getAttribute("aria-label")).toContain("A15");

    const status = host.querySelector(".stage-status");
    const before = status?.textContent ?? "";
    expect(before).toContain("You are X");

    cells[112]?.click();
    expect(cells[112]?.textContent).toBe("X");
    const after = host.querySelector(".stage-status")?.textContent ?? "";
    expect(after).not.toBe(before);
    expect(after).toContain("AI thinking");

    expect(() => game.unmount()).not.toThrow();
  });

  it("lets the AI answer and undoes a full move pair", () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      const game = createCaroGame();
      game.mount(host);
      const cells = host.querySelectorAll<HTMLButtonElement>(".stage-cell");

      cells[112]?.click();
      vi.advanceTimersByTime(200);
      expect(host.querySelectorAll(".stage-cell.is-warn")).toHaveLength(1);
      expect(host.querySelector(".stage-hud")?.textContent).toContain("moves: 2");

      const undo = [...host.querySelectorAll<HTMLButtonElement>(".stage-btn")].find(
        (btn) => btn.textContent === "Undo",
      );
      undo?.click();
      expect(host.querySelectorAll(".stage-cell.is-primary")).toHaveLength(0);
      expect(host.querySelectorAll(".stage-cell.is-warn")).toHaveLength(0);
      expect(host.querySelector(".stage-status")?.textContent).toContain("You are X");

      game.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
