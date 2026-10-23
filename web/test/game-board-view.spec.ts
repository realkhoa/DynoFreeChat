// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { GameBoardView } from "../src/ui/game-board-view";
import type { BoardState } from "../src/game/tictactoe";

describe("GameBoardView", () => {
  let root: HTMLElement;
  let clickedIndex: number | null = null;
  let view: GameBoardView;

  beforeEach(() => {
    clickedIndex = null;
    root = document.createElement("div");
    root.innerHTML = `
      <div id="game-room-code-badge"></div>
      <div id="game-code-room-badge"></div>
      <div id="game-status-banner"></div>
      <div id="game-code-status-line"></div>
      <div id="game-score-x">0</div>
      <div id="game-score-o">0</div>
      <div id="game-score-draws">0</div>
      <div id="game-code-score-line"></div>
      <div id="game-turn-indicator"></div>
      <div id="game-grid">
        ${Array.from({ length: 9 }, (_, i) => `<button id="game-cell-${i}" class="game-cell" data-cell="${i}"></button>`).join("")}
      </div>
    `;
    view = new GameBoardView(root, (idx) => {
      clickedIndex = idx;
    });
  });

  it("updates badge and status with C# code formatting", () => {
    view.setRoomBadge("Room 1234");
    view.setStatus("Ready to play");

    expect(root.querySelector("#game-room-code-badge")?.textContent).toBe("// Session: Room 1234");
    expect(root.querySelector("#game-status-banner")?.textContent).toBe("// [MatrixEngine] Ready to play");

    view.setCodeMode(false);
    view.setRoomBadge("Room 1234");
    view.setStatus("Ready to play");

    expect(root.querySelector("#game-room-code-badge")?.textContent).toBe("Room 1234");
    expect(root.querySelector("#game-status-banner")?.textContent).toBe("Ready to play");
  });

  it("handles cell clicks", () => {
    const cells = root.querySelectorAll<HTMLButtonElement>(".game-cell");
    cells[4]?.click();
    expect(clickedIndex).toBe(4);
  });

  it("renders board state and winning highlights correctly", () => {
    const board: BoardState = ["X", "O", "X", null, "X", null, null, null, "X"];
    view.update(
      board,
      "O",
      "O",
      { winner: "X", line: [0, 4, 8] },
      { x: 3, o: 1, draws: 0 },
      "online",
    );

    const cells = root.querySelectorAll<HTMLButtonElement>(".game-cell");
    expect(cells[0]?.textContent).toBe("X");
    expect(cells[0]?.classList.contains("cell-win")).toBe(true);
    expect(cells[1]?.textContent).toBe("O");
    expect(cells[1]?.classList.contains("cell-o")).toBe(true);
    expect(cells[3]?.textContent).toBe("·"); // Code mode empty cell dot
    expect(cells[0]?.disabled).toBe(true);
    expect(cells[3]?.disabled).toBe(true); // Game over disables all

    expect(root.querySelector("#game-score-x")?.textContent).toBe("3");
    expect(root.querySelector("#game-score-o")?.textContent).toBe("1");
    expect(root.querySelector("#game-code-score-line")?.textContent).toContain("Assert.True(X): 3");

    // Standard mode empty cell
    view.setCodeMode(false);
    expect(cells[3]?.textContent).toBe("");
  });

  it("keeps the board locked while the peer is missing", () => {
    const board: BoardState = [null, null, null, null, null, null, null, null, null];
    const scores = { x: 0, o: 0, draws: 0 };

    view.update(board, "X", "X", { winner: null }, scores, "online", false);
    const cells = root.querySelectorAll<HTMLButtonElement>(".game-cell");
    expect(cells[4]?.disabled).toBe(true);

    view.update(board, "X", "X", { winner: null }, scores, "online", true);
    expect(cells[4]?.disabled).toBe(false);
  });

  it("skips repainting cells whose state did not change", () => {
    const board: BoardState = [null, null, null, null, null, null, null, null, null];
    const scores = { x: 0, o: 0, draws: 0 };
    view.update(board, "X", null, { winner: null }, scores, "local", true);

    // Tampering with the DOM surfaces only if the next render rewrites the cell.
    const target = root.querySelector<HTMLButtonElement>(".game-cell");
    if (target === null) throw new Error("missing cell");
    target.textContent = "tampered";
    view.update(board, "X", null, { winner: null }, scores, "local", true);
    expect(target.textContent).toBe("tampered");

    const next: BoardState = ["X", null, null, null, null, null, null, null, null];
    view.update(next, "O", null, { winner: null }, scores, "local", true);
    expect(target.textContent).toBe("X");
  });
});
