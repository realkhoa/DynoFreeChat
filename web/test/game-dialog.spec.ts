// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { GameDialog } from "../src/ui/game-dialog";

function createMockDialogHtml(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "modal-dialog modal-dialog--game";
  dialog.id = "game-dialog";
  dialog.innerHTML = `
    <div class="modal-dialog-head">
      <span class="modal-dialog-mark" aria-hidden="true">#</span>
      <h2 class="modal-dialog-title">Tic-Tac-Toe - Visual Studio Live Game</h2>
      <button type="button" class="modal-dialog-close" id="game-dialog-close">×</button>
    </div>
    <div class="modal-dialog-body">
      <div id="game-lobby-view">
        <input type="text" id="game-code-input" />
        <button id="game-join-btn">Join</button>
        <button id="game-create-btn">Create</button>
        <button id="game-ai-btn">AI</button>
        <button id="game-local-btn">Local</button>
      </div>
      <div id="game-board-view" hidden>
        <div id="game-room-code-badge"></div>
        <div id="game-status-banner"></div>
        <div id="game-turn-indicator"></div>
        <span id="game-score-x">0</span>
        <span id="game-score-o">0</span>
        <span id="game-score-draws">0</span>
        <div class="game-grid">
          <button class="game-cell" id="game-cell-0"></button>
          <button class="game-cell" id="game-cell-1"></button>
          <button class="game-cell" id="game-cell-2"></button>
          <button class="game-cell" id="game-cell-3"></button>
          <button class="game-cell" id="game-cell-4"></button>
          <button class="game-cell" id="game-cell-5"></button>
          <button class="game-cell" id="game-cell-6"></button>
          <button class="game-cell" id="game-cell-7"></button>
          <button class="game-cell" id="game-cell-8"></button>
        </div>
        <button id="game-rematch-btn">Rematch</button>
        <button id="game-copy-code-btn">Copy</button>
        <button id="game-exit-btn">Exit</button>
      </div>
    </div>
  `;
  document.body.append(dialog);
  // jsdom doesn't fully implement showModal
  dialog.showModal = function () {
    this.open = true;
  };
  dialog.close = function () {
    this.open = false;
  };
  return dialog;
}

describe("GameDialog component", () => {
  let dialogEl: HTMLDialogElement;
  let gameDialog: GameDialog;

  beforeEach(() => {
    document.body.replaceChildren();
    dialogEl = createMockDialogHtml();
    gameDialog = new GameDialog({
      dialog: dialogEl,
      wsUrl: "wss://fake/ws",
      apiBase: "https://fake",
      getIdentity: () => ({ nick: "DevUser", color: "hsl(200 50% 50%)" }),
    });
  });

  it("initializes with lobby view visible and board view hidden", () => {
    const lobby = dialogEl.querySelector("#game-lobby-view");
    const board = dialogEl.querySelector("#game-board-view");
    expect(lobby?.hasAttribute("hidden")).toBe(false);
    expect(board?.hasAttribute("hidden")).toBe(true);
  });

  it("starts a local 2-player game and alternates turns", () => {
    gameDialog.startLocalGame();

    const lobby = dialogEl.querySelector("#game-lobby-view");
    const board = dialogEl.querySelector("#game-board-view");
    expect(lobby?.hasAttribute("hidden")).toBe(true);
    expect(board?.hasAttribute("hidden")).toBe(false);

    const cell0 = dialogEl.querySelector<HTMLButtonElement>("#game-cell-0")!;
    const cell1 = dialogEl.querySelector<HTMLButtonElement>("#game-cell-1")!;

    cell0.click();
    expect(cell0.textContent).toBe("X");

    cell1.click();
    expect(cell1.textContent).toBe("O");
  });

  it("starts AI game and handles human move", () => {
    gameDialog.startAiGame();

    const cell4 = dialogEl.querySelector<HTMLButtonElement>("#game-cell-4")!;
    cell4.click();
    expect(cell4.textContent).toBe("X");
  });

  it("closes when close button is clicked", () => {
    gameDialog.open();
    expect(dialogEl.open).toBe(true);

    const closeBtn = dialogEl.querySelector<HTMLButtonElement>("#game-dialog-close")!;
    closeBtn.click();
    expect(dialogEl.open).toBe(false);
  });
});
