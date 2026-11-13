// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { GameBoardView } from "@/features/collab/document/view";
import type { BoardState } from "@/features/collab/engine/tictactoe";

const SCORES = { x: 0, o: 0, draws: 0 };

/** Minimal copy of the document the view expects. */
function mountDocument(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <span id="game-code-room-badge"></span>
    <div id="game-code-content">
      <div class="code-line comment">// header</div>
      <div class="code-line comment" id="game-code-status-line">// idle</div>
      <div class="code-line comment" id="game-code-score-line">// scores</div>
      <div class="code-line">{</div>
      <div class="code-line matrix-row">
        ${[0, 1, 2].map((i) => `<button class="game-cell" id="editor-cell-${i}" data-cell="${i}"></button>`).join(", ")}
      </div>
      <div class="code-line matrix-row">
        ${[3, 4, 5].map((i) => `<button class="game-cell" id="editor-cell-${i}" data-cell="${i}"></button>`).join(", ")}
      </div>
      <div class="code-line matrix-row">
        ${[6, 7, 8].map((i) => `<button class="game-cell" id="editor-cell-${i}" data-cell="${i}"></button>`).join(", ")}
      </div>
      <div class="code-line">};</div>
    </div>
    <div id="game-code-gutter"></div>
    <span id="game-code-ln"></span>
    <span id="game-code-thread"></span>
    <span id="game-code-session"></span>
    <span id="game-code-state"></span>
    <span id="game-code-diag"></span>
  `;
  return root;
}

describe("GameBoardView", () => {
  let root: HTMLElement;
  let clickedIndex: number | null = null;
  let view: GameBoardView;

  const cells = (): NodeListOf<HTMLButtonElement> => root.querySelectorAll<HTMLButtonElement>(".game-cell");

  beforeEach(() => {
    clickedIndex = null;
    root = mountDocument();
    view = new GameBoardView(root, (idx) => {
      clickedIndex = idx;
    });
  });

  it("numbers the gutter from the rendered code lines", () => {
    const gutter = root.querySelectorAll("#game-code-gutter span");
    const lines = root.querySelectorAll("#game-code-content .code-line");
    expect(gutter).toHaveLength(lines.length);
    expect(gutter[0]?.textContent).toBe("01");
    expect(gutter[gutter.length - 1]?.textContent).toBe(String(lines.length).padStart(2, "0"));
  });

  it("renders slots as char literals inside the initializer", () => {
    view.update(
      ["X", null, "O", null, null, null, null, null, null],
      "O",
      null,
      { winner: null },
      SCORES,
      "local",
    );

    expect(cells()[0]?.textContent).toBe("'X'");
    expect(cells()[1]?.textContent).toBe("'\u00b7'");
    expect(cells()[2]?.textContent).toBe("'O'");
    expect(cells()[0]?.classList.contains("cell-x")).toBe(true);
    expect(cells()[2]?.classList.contains("cell-o")).toBe(true);
    expect(cells()[1]?.classList.contains("cell-empty")).toBe(true);
  });

  it("writes the session id into the toolbar and status bar", () => {
    view.setRoomBadge("9B2X (X)");
    expect(root.querySelector("#game-code-room-badge")?.textContent).toBe("// session: 9B2X (thread x)");
    expect(root.querySelector("#game-code-session")?.textContent).toBe("session 9B2X");

    // Local modes report a plain label, not a session id.
    view.setRoomBadge("local");
    expect(root.querySelector("#game-code-room-badge")?.textContent).toBe("// session: local");

    view.setSession("");
    expect(root.querySelector("#game-code-room-badge")?.textContent).toBe("// session: (none)");
  });

  it("reports state through comments and the status bar", () => {
    view.setStatus("thread X active - dispatch pointer");
    expect(root.querySelector("#game-code-status-line")?.textContent).toBe(
      "// thread X active - dispatch pointer",
    );

    view.setActive(true);
    view.update(
      ["X", "O", "X", null, "X", null, null, null, "X"],
      "O",
      "O",
      { winner: "X", line: [0, 4, 8] },
      { x: 3, o: 1, draws: 0 },
      "online",
    );

    expect(root.querySelector("#game-code-score-line")?.textContent).toContain("Trace.Assert(x: 3)");
    expect(root.querySelector("#game-code-thread")?.textContent).toBe("thread O");
    expect(root.querySelector("#game-code-state")?.textContent).toBe("Assertion passed");
    expect(root.querySelector("#game-code-diag")?.textContent).toBe("0 errors, 1 assert");
    expect(cells()[0]?.classList.contains("cell-win")).toBe(true);
  });

  it("shows a caret readout that follows the document line", () => {
    const readout = (): string => root.querySelector("#game-code-ln")?.textContent ?? "";
    expect(readout()).toMatch(/^Ln \d+, Col \d+$/);

    cells()[4]?.dispatchEvent(new MouseEvent("mouseenter"));
    // Row 1 is the sixth document line in this fixture.
    expect(readout()).toBe("Ln 6, Col 24");
  });

  it("handles slot clicks", () => {
    cells()[4]?.click();
    expect(clickedIndex).toBe(4);
  });

  it("locks the buffer until the peer is present", () => {
    const empty: BoardState = [null, null, null, null, null, null, null, null, null];
    view.update(empty, "X", "X", { winner: null }, SCORES, "online", false);
    expect(cells()[4]?.disabled).toBe(true);

    view.update(empty, "X", "X", { winner: null }, SCORES, "online", true);
    expect(cells()[4]?.disabled).toBe(false);
  });

  it("skips repainting slots whose state did not change", () => {
    const empty: BoardState = [null, null, null, null, null, null, null, null, null];
    view.update(empty, "X", null, { winner: null }, SCORES, "local", true);

    const target = cells()[0];
    if (target == null) throw new Error("missing cell");
    target.textContent = "tampered";
    view.update(empty, "X", null, { winner: null }, SCORES, "local", true);
    expect(target.textContent).toBe("tampered");

    view.update(
      ["X", null, null, null, null, null, null, null, null],
      "O",
      null,
      { winner: null },
      SCORES,
      "local",
      true,
    );
    expect(target.textContent).toBe("'X'");
  });
});
