/**
 * @file game-dialog.ts
 * @brief Visual Studio styled modal dialog and editor tab component for Tic-Tac-Toe games.
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
  /** Root dialog element */
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
  /** Optional embedded editor panel */
  editorPanel?: HTMLElement | null;
  /** Callback to open game as document tab in tabstrip */
  onTabOpen?: () => void;
  /** Callback to close game document tab */
  onTabClose?: () => void;
}

/**
 * @brief Manages the Visual Studio IDE styled Tic-Tac-Toe modal dialog and editor tab.
 */
export class GameDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly storage: Storage | null;
  private readonly editorPanel: HTMLElement | null;
  private readonly onTabOpen?: () => void;
  private readonly onTabClose?: () => void;

  private readonly coordinator: GameCoordinator;
  private stealthPref: StealthPref;
  /** Guards the tab-close ↔ dialog-close cycle. */
  private closing = false;

  private lobbyView!: HTMLElement;
  private boardViewEl!: HTMLElement;
  private boardView!: GameBoardView;
  private codeInput!: HTMLInputElement;

  /**
   * @brief Initializes the GameDialog and binds event listeners.
   * @param options Dependency options.
   */
  constructor(options: GameDialogOptions) {
    this.dialog = options.dialog;
    this.storage = options.storage ?? null;
    this.editorPanel = options.editorPanel ?? null;
    this.onTabOpen = options.onTabOpen;
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
   * @brief Binds existing DOM elements and click listeners.
   */
  private bindDom(): void {
    this.lobbyView = this.dialog.querySelector<HTMLElement>("#game-lobby-view")!;
    this.boardViewEl = this.dialog.querySelector<HTMLElement>("#game-board-view")!;
    this.codeInput = this.dialog.querySelector<HTMLInputElement>("#game-code-input")!;

    const rootScope = document.body ?? this.dialog;
    this.boardView = new GameBoardView(rootScope, (i) => this.coordinator.handleCellClick(i));

    const on = (sel: string, cb: () => void) => {
      document.querySelectorAll(sel).forEach((el) => el.addEventListener("click", cb));
    };

    const joinCode = () => {
      const code = this.codeInput.value.trim().toUpperCase();
      if (code.length > 0) void this.startOnlineGame(code, false);
    };

    on("#game-dialog-close, #game-code-exit-btn", () => this.close());
    on("#game-exit-btn, #game-code-lobby-btn", () => this.showLobby());
    on("#game-create-btn", () => void this.startOnlineGame(generateRoomCode(), true));
    on("#game-ai-btn, #game-code-ai-btn", () => this.startAiGame());
    on("#game-local-btn, #game-code-local-btn", () => this.startLocalGame());
    on("#game-rematch-btn, #game-code-rematch-btn", () => this.coordinator.rematch());
    on("#game-copy-code-btn, #game-code-copy-btn", () => void this.coordinator.copyInviteInfo());
    on("#game-join-btn", joinCode);

    on("#game-dialog-stealth-btn, #game-code-stealth-btn", () => this.toggleStealth());
    on("#game-dialog-mode-btn, #game-code-mode-btn", () => this.toggleCodeMode());
    on("#game-dialog-dock-btn", () => this.dockToTab());
    on("#game-code-float-btn", () => this.openFloating());

    this.codeInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        joinCode();
      }
    });
  }

  /**
   * @brief Toggles stealth mode (idle blur and dimming).
   */
  toggleStealth(): void {
    this.stealthPref.stealth = !this.stealthPref.stealth;
    saveStealthPref(this.storage, this.stealthPref);
    this.applyStealthDom();
  }

  /**
   * @brief Toggles C# code syntax disguise mode.
   */
  toggleCodeMode(): void {
    this.stealthPref.codeMode = !this.stealthPref.codeMode;
    saveStealthPref(this.storage, this.stealthPref);
    this.applyStealthDom();
  }

  /**
   * @brief Applies active stealth and code styling classes to DOM elements.
   * @details The blur and the dimming are what make the disguise convincing, but a
   * dimmed, blurred board cannot be read or hit. Both are suspended while a round
   * is on screen and return as soon as the lobby is back.
   */
  private applyStealthDom(): void {
    const playing = this.boardViewEl.hidden === false;
    const stealthOff = this.stealthPref.stealth && !playing;
    const targets = [this.dialog, this.editorPanel].filter((el): el is HTMLElement => el !== null);
    for (const el of targets) {
      el.classList.toggle("is-stealth", stealthOff);
      el.classList.toggle("is-stealth--blur", stealthOff);
      el.classList.toggle("game-code-mode", this.stealthPref.codeMode);
      el.style.setProperty("--stealth-opacity", String(this.stealthPref.opacity));
    }
    this.boardView.setCodeMode(this.stealthPref.codeMode);

    const stealthBtns = document.querySelectorAll("#game-dialog-stealth-btn, #game-code-stealth-btn");
    stealthBtns.forEach((b) => b.classList.toggle("is-active", this.stealthPref.stealth));

    const modeBtns = document.querySelectorAll("#game-dialog-mode-btn, #game-code-mode-btn");
    modeBtns.forEach((b) => b.classList.toggle("is-active", this.stealthPref.codeMode));
  }

  /**
   * @brief Docks the game view into the editor document tab.
   */
  dockToTab(): void {
    this.dialog.close();
    this.onTabOpen?.();
  }

  /**
   * @brief Opens the game view as a floating dialog modal.
   * @details Uses {@link close} rather than the host callback directly, so the tab
   * is torn down exactly once and the modal is only raised afterwards.
   */
  openFloating(): void {
    this.close();
    if (!this.dialog.open) this.dialog.showModal();
    this.showLobby();
  }

  /**
   * @brief Opens the Game dialog or tab in lobby or targeted mode.
   * @param mode Optional initial mode.
   * @param code Optional room code for direct join.
   */
  open(mode?: GameMode, code?: string): void {
    if (this.onTabOpen !== undefined) this.onTabOpen();
    else this.dialog.showModal();

    if (code !== undefined && code.length > 0) return void this.startOnlineGame(code.toUpperCase(), false);
    if (mode === "ai") return this.startAiGame();
    if (mode === "online") return void this.startOnlineGame(generateRoomCode(), true);
    this.showLobby();
    this.codeInput.focus();
  }

  /**
   * @brief Closes the dialog or document tab and cleans up network connections.
   * @details `onTabClose` calls back into the host, whose tab-close handler calls
   * this method again. A re-entrant call performs the teardown but does not
   * re-notify, so the cycle terminates after exactly one host notification.
   */
  close(): void {
    const reentrant = this.closing;
    this.coordinator.cleanup();
    this.dialog.close();
    if (reentrant) return;

    this.closing = true;
    try {
      this.onTabClose?.();
    } finally {
      this.closing = false;
    }
  }

  /**
   * @brief Displays the lobby view and resets any active game session.
   */
  private showLobby(): void {
    this.coordinator.cleanup();
    this.lobbyView.hidden = false;
    this.boardViewEl.hidden = true;
    this.codeInput.value = "";
    this.applyStealthDom();
  }

  /**
   * @brief Starts an offline single-player game against the AI.
   */
  startAiGame(): void {
    this.showBoardView();
    this.coordinator.startAiGame();
  }

  /**
   * @brief Starts a 2-player local pass-and-play game on the same device.
   */
  startLocalGame(): void {
    this.showBoardView();
    this.coordinator.startLocalGame();
  }

  /**
   * @brief Starts or joins an online multiplayer game room.
   * @param code The 4-character room code.
   * @param asHost True if creating the room, false if joining existing.
   */
  async startOnlineGame(code: string, asHost: boolean): Promise<void> {
    this.showBoardView();
    await this.coordinator.startOnlineGame(code, asHost);
  }

  private showBoardView(): void {
    this.lobbyView.hidden = true;
    this.boardViewEl.hidden = false;
    this.applyStealthDom();
  }
}
