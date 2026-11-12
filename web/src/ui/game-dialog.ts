/**
 * @file game-dialog.ts
 * @brief Hosts the collab document in the editor tab, and in a floating frame when detached.
 * @details There is one surface: the DiagnosticMatrix.cs panel. It normally lives in the
 * editor area; detaching moves that very element into a modal, so the disguise, the
 * running session and the scroll position all survive the move.
 */

import { generateRoomCode, type GameMode } from "../game/tictactoe";
import { GameCoordinator } from "../game/coordinator";
import { GameBoardView } from "./game-board-view";
import { loadStealthPref, saveStealthPref, type StealthPref } from "../game/stealth-pref";
import type { Identity } from "../lib/identity";

/**
 * @brief Configuration dependencies for creating a GameDialog instance.
 */
export interface GameDialogOptions {
  /** Floating frame element */
  dialog: HTMLDialogElement;
  /** WebSocket server base URL */
  wsUrl: string;
  /** API base URL */
  apiBase: string;
  /** Current user identity (nick, color) */
  getIdentity: () => Identity;
  /** Optional function to create/register room */
  createRoomImpl?: (apiBase: string, body: { slug: string; pass?: string }) => Promise<{ ok: boolean; code?: string }>;
  /** Optional persistence storage */
  storage?: Storage | null;
  /** The document panel that holds the session */
  editorPanel?: HTMLElement | null;
  /** Callback to select the document tab in the tabstrip */
  onTabOpen?: () => void;
  /** Callback to hide the document tab without ending the session */
  onTabHide?: () => void;
  /** Callback to close the document tab and release the session */
  onTabClose?: () => void;
}

/**
 * @brief Manages the collab document, its session and its floating frame.
 */
export class GameDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly storage: Storage | null;
  private readonly panel: HTMLElement | null;
  private readonly onTabOpen?: () => void;
  private readonly onTabHide?: () => void;
  private readonly onTabClose?: () => void;

  private readonly coordinator: GameCoordinator;
  private stealthPref: StealthPref;
  /** Guards the tab-close ↔ dialog-close cycle. */
  private closing = false;
  /** True while the document is hosted by the floating frame. */
  private detached = false;
  /** True while a session is attached, which suspends the idle disguise. */
  private active = false;

  private boardView!: GameBoardView;
  private detachBody!: HTMLElement;
  private sessionInput!: HTMLInputElement;

  /**
   * @brief Initializes the document controller and binds its commands.
   * @param options Dependency options.
   */
  constructor(options: GameDialogOptions) {
    this.dialog = options.dialog;
    this.storage = options.storage ?? null;
    this.panel = options.editorPanel ?? null;
    this.onTabOpen = options.onTabOpen;
    this.onTabHide = options.onTabHide;
    this.onTabClose = options.onTabClose;
    this.stealthPref = loadStealthPref(this.storage);

    this.bindDom();
    this.coordinator = new GameCoordinator({
      wsUrl: options.wsUrl,
      apiBase: options.apiBase,
      getIdentity: options.getIdentity,
      createRoomImpl: options.createRoomImpl,
      callbacks: {
        onUpdate: (board, turn, role, outcome, scores, mode, canPlay) => {
          this.boardView.update(board, turn, role, outcome, scores, mode, canPlay);
        },
        onStatus: (text) => this.boardView.setStatus(text),
        onRoomBadge: (badge) => this.boardView.setRoomBadge(badge),
      },
    });

    this.applyStealthDom();
  }

  /**
   * @brief Binds document elements and the commands painted inside it.
   */
  private bindDom(): void {
    this.detachBody = this.dialog.querySelector<HTMLElement>("#game-detach-body")!;
    this.sessionInput = document.querySelector<HTMLInputElement>("#game-code-input")!;

    this.boardView = new GameBoardView(document.body, (i) => this.coordinator.handleCellClick(i));

    const on = (sel: string, cb: () => void) => {
      document.querySelectorAll(sel).forEach((el) => el.addEventListener("click", cb));
    };

    const attach = () => {
      const code = this.sessionInput.value.trim().toUpperCase();
      if (code.length > 0) void this.startOnlineGame(code, false);
    };

    on("#game-code-attach-btn", attach);
    on("#game-code-new-btn", () => void this.startOnlineGame(generateRoomCode(), true));
    on("#game-code-local-btn", () => this.startLocalGame());
    on("#game-code-ai-btn", () => this.startAiGame());
    on("#game-code-rematch-btn", () => this.coordinator.rematch());
    on("#game-code-copy-btn", () => void this.coordinator.copyInviteInfo());
    on("#game-code-close-btn, #game-dialog-close", () => this.close());
    on("#game-code-detach-btn", () => this.detach());
    on("#game-dialog-dock-btn", () => this.dockToTab());
    on("#game-code-stealth-btn", () => this.toggleStealth());

    this.sessionInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      attach();
    });

    // Escape on the floating frame returns the document to the tab instead of
    // leaving a live session hidden behind a closed modal.
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.dockToTab();
    });
  }

  /**
   * @brief Toggles the idle disguise (dim + blur while no session runs).
   */
  toggleStealth(): void {
    this.stealthPref.stealth = !this.stealthPref.stealth;
    saveStealthPref(this.storage, this.stealthPref);
    this.applyStealthDom();
  }

  /**
   * @brief Applies the idle disguise.
   * @details The file is only dimmed while idle. A running session stays fully
   * legible, and detaching keeps the frame crisp so the document can be played.
   */
  private applyStealthDom(): void {
    const disguise = this.stealthPref.stealth && !this.active && !this.detached;
    for (const el of [this.dialog, this.panel]) {
      if (el === null) continue;
      el.classList.toggle("is-stealth", disguise);
      el.classList.toggle("is-stealth--blur", disguise);
      el.style.setProperty("--stealth-opacity", String(this.stealthPref.opacity));
    }

    const stealthBtn = document.querySelector("#game-code-stealth-btn");
    stealthBtn?.classList.toggle("is-active", this.stealthPref.stealth);
  }

  /**
   * @brief Opens the collab document in the editor tab.
   * @param mode Optional session to start immediately.
   * @param code Optional session id to attach to.
   */
  open(mode?: GameMode, code?: string): void {
    this.dockToTab(false);
    this.onTabOpen?.();
    if (this.panel !== null) this.panel.hidden = false;
    this.applyStealthDom();

    if (code !== undefined && code.length > 0) {
      this.sessionInput.value = code.toUpperCase();
      return void this.startOnlineGame(code.toUpperCase(), false);
    }
    if (mode === "ai") return this.startAiGame();
    if (mode === "online") return void this.startOnlineGame(generateRoomCode(), true);
    this.sessionInput.focus();
  }

  /**
   * @brief Moves the document into the floating frame without ending the session.
   */
  detach(): void {
    if (this.panel === null || this.detached) return;
    this.detached = true;
    this.detachBody.append(this.panel);
    this.panel.hidden = false;
    this.panel.classList.add("is-detached");
    this.onTabHide?.();
    if (!this.dialog.open) this.dialog.showModal();
    this.applyStealthDom();
  }

  /**
   * @brief Returns the document to the editor tab and hides the frame.
   * @param notifyTab Whether to (re)select the document tab.
   */
  dockToTab(notifyTab = true): void {
    if (this.detached) {
      this.detached = false;
      const editor = document.getElementById("editor");
      if (editor !== null && this.panel !== null) editor.append(this.panel);
      if (this.panel !== null) {
        this.panel.hidden = true;
        this.panel.classList.remove("is-detached");
      }
    }
    if (this.dialog.open) this.dialog.close();
    if (notifyTab) this.onTabOpen?.();
    this.applyStealthDom();
  }

  /**
   * @brief Closes the document, releases the session and resets the tab.
   */
  close(): void {
    const reentrant = this.closing;
    this.active = false;
    this.boardView.setActive(false);
    this.coordinator.cleanup();
    this.dockToTab(false);
    if (this.panel !== null) this.panel.hidden = true;
    this.sessionInput.value = "";

    if (reentrant) return;
    this.closing = true;
    try {
      this.onTabClose?.();
    } finally {
      this.closing = false;
    }
  }

  /**
   * @brief Starts an offline single-player simulation.
   */
  startAiGame(): void {
    this.beginSession();
    this.coordinator.startAiGame();
  }

  /**
   * @brief Starts a two-player local session in the same document.
   */
  startLocalGame(): void {
    this.beginSession();
    this.coordinator.startLocalGame();
  }

  /**
   * @brief Attaches to an online collab session.
   * @param code Session id.
   * @param asHost True to create the session.
   */
  async startOnlineGame(code: string, asHost: boolean): Promise<void> {
    this.beginSession();
    this.sessionInput.value = code.toUpperCase();
    await this.coordinator.startOnlineGame(code, asHost);
  }

  /**
   * @brief Marks the document as holding a live session.
   */
  private beginSession(): void {
    this.active = true;
    this.boardView.setActive(true);
    this.applyStealthDom();
  }
}
