// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { GameDialog, type GameDialogOptions } from "@/features/collab/document/frame";

interface Harness {
  dialog: HTMLDialogElement;
  panel: HTMLElement;
  gameDialog: GameDialog;
  tabOpen: number;
  tabHide: number;
  tabClose: number;
}

/** The document panel plus the floating frame that can host it. */
function mountDocument(): { dialog: HTMLDialogElement; panel: HTMLElement } {
  document.body.replaceChildren();

  const editor = document.createElement("main");
  editor.id = "editor";
  document.body.append(editor);

  const panel = document.createElement("div");
  panel.id = "game-editor-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div id="game-code-content">
      <div class="code-line comment" id="game-code-status-line">// idle</div>
      <div class="code-line comment" id="game-code-score-line">// scores</div>
      <div class="code-line matrix-row">
        ${[0, 1, 2].map((i) => `<button class="game-cell" id="editor-cell-${i}" data-cell="${i}"></button>`).join(", ")}
      </div>
      <div class="code-line matrix-row">
        ${[3, 4, 5].map((i) => `<button class="game-cell" id="editor-cell-${i}" data-cell="${i}"></button>`).join(", ")}
      </div>
      <div class="code-line matrix-row">
        ${[6, 7, 8].map((i) => `<button class="game-cell" id="editor-cell-${i}" data-cell="${i}"></button>`).join(", ")}
      </div>
    </div>
    <div id="game-code-gutter"></div>
    <span id="game-code-room-badge"></span>
    <span id="game-code-ln"></span>
    <span id="game-code-thread"></span>
    <span id="game-code-session"></span>
    <span id="game-code-state"></span>
    <span id="game-code-diag"></span>
    <input id="game-code-input" />
    <button id="game-code-attach-btn"></button>
    <button id="game-code-new-btn"></button>
    <button id="game-code-local-btn"></button>
    <button id="game-code-ai-btn"></button>
    <button id="game-code-rematch-btn"></button>
    <button id="game-code-copy-btn"></button>
    <button id="game-code-close-btn"></button>
    <button id="game-code-detach-btn"></button>
    <button id="game-dialog-dock-btn"></button>
    <button id="game-code-stealth-btn"></button>
  `;
  editor.append(panel);

  // The dialog markup normally held the lobby; now it only hosts the panel.
  const html = document.createElement("div");
  html.innerHTML = `
    <dialog id="game-dialog">
      <button id="game-dialog-close"></button>
      <div id="game-detach-body"></div>
    </dialog>
  `;
  document.body.append(...Array.from(html.childNodes));
  const dialog = document.querySelector<HTMLDialogElement>("#game-dialog")!;
  // jsdom has no modal stack; a flag is enough to observe attach/detach.
  dialog.showModal = function () {
    this.open = true;
  };
  dialog.close = function () {
    this.open = false;
  };

  return { dialog, panel };
}

function makeGameDialog(extra: Partial<GameDialogOptions> = {}): Harness {
  const { dialog, panel } = mountDocument();
  const state: Harness = {
    dialog,
    panel,
    gameDialog: undefined as unknown as GameDialog,
    tabOpen: 0,
    tabHide: 0,
    tabClose: 0,
  };

  state.gameDialog = new GameDialog({
    dialog,
    editorPanel: panel,
    wsUrl: "wss://fake/ws",
    apiBase: "https://fake",
    getIdentity: () => ({ nick: "DevUser", color: "hsl(200 50% 50%)" }),
    onTabOpen: () => {
      state.tabOpen += 1;
    },
    onTabHide: () => {
      state.tabHide += 1;
    },
    onTabClose: () => {
      state.tabClose += 1;
      state.gameDialog.close();
    },
    ...extra,
  });

  return state;
}

describe("GameDialog", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeGameDialog();
  });

  it("opens the document in the editor tab, not in a modal", () => {
    h.gameDialog.open();
    expect(h.tabOpen).toBe(1);
    expect(h.dialog.open).toBe(false);
    expect(h.panel.parentElement?.id).toBe("editor");
    expect(h.panel.hidden).toBe(false);
  });

  it("starts a local session and writes the literals into the buffer", () => {
    h.gameDialog.open();
    h.gameDialog.startLocalGame();

    const cell0 = h.panel.querySelector<HTMLButtonElement>("#editor-cell-0")!;
    const cell1 = h.panel.querySelector<HTMLButtonElement>("#editor-cell-1")!;
    cell0.click();
    expect(cell0.textContent).toBe("'X'");
    cell1.click();
    expect(cell1.textContent).toBe("'O'");
  });

  it("keeps a live document legible and dims only when idle", () => {
    expect(h.panel.classList.contains("is-stealth")).toBe(true);

    h.gameDialog.startLocalGame();
    expect(h.panel.classList.contains("is-stealth")).toBe(false);

    h.gameDialog.close();
    expect(h.panel.classList.contains("is-stealth")).toBe(true);
  });

  it("detaches the same document into the frame and docks it back", () => {
    h.gameDialog.open();
    h.gameDialog.startLocalGame();

    h.gameDialog.detach();
    expect(h.tabHide).toBe(1);
    expect(h.dialog.open).toBe(true);
    expect(h.panel.parentElement?.id).toBe("game-detach-body");
    // Detaching must not end the session or hide the document.
    expect(h.panel.hidden).toBe(false);
    expect(h.panel.classList.contains("is-stealth")).toBe(false);

    h.gameDialog.dockToTab();
    expect(h.dialog.open).toBe(false);
    expect(h.panel.parentElement?.id).toBe("editor");
    expect(h.tabOpen).toBe(2);
  });

  it("returns the document to the tab when the frame is cancelled", () => {
    h.gameDialog.open();
    h.gameDialog.detach();
    h.dialog.dispatchEvent(new Event("cancel"));
    expect(h.dialog.open).toBe(false);
    expect(h.panel.parentElement?.id).toBe("editor");
  });

  it("tears down once when the host tab handler closes it again", () => {
    h.gameDialog.close();
    expect(h.tabClose).toBe(1);
    expect(h.dialog.open).toBe(false);
  });

  it("releases the session when the document is closed", () => {
    h.gameDialog.open();
    h.gameDialog.startLocalGame();
    h.gameDialog.close();

    expect(h.tabClose).toBe(1);
    expect(h.panel.parentElement?.id).toBe("editor");
    expect(h.panel.hidden).toBe(true);
    expect(h.panel.querySelector<HTMLInputElement>("#game-code-input")?.value).toBe("");
  });
});
