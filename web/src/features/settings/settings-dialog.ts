/**
 * @file settings-dialog.ts
 * @brief Modal dialog presenting unified system settings for DynoFreeChat.
 * @details Replaces dropdown menus with a centered, comprehensive Visual Studio 2022
 *          styled configuration modal covering theme, workspace, audio, and personal profile.
 */

import type { Theme } from "@/features/settings/theme";

/**
 * @brief DOM element references required to instantiate the SettingsDialog.
 */
export interface SettingsDialogElements {
  /** Button toggling Dark/Light theme. */
  toggleTheme: HTMLButtonElement;
  /** Button toggling Minimal IDE mode. */
  toggleMinimal: HTMLButtonElement;
  /** Button toggling Solution Explorer sidebar. */
  toggleSidebar: HTMLButtonElement;
  /** Button toggling Output dock. */
  toggleDock: HTMLButtonElement;
  /** Button toggling WebAudio sound. */
  toggleSound: HTMLButtonElement;
  /** Button triggering Notification permissions. */
  toggleNotify: HTMLButtonElement;
  /** Button zooming font size up. */
  zoomIn: HTMLButtonElement;
  /** Button zooming font size down. */
  zoomOut: HTMLButtonElement;
  /** Text element displaying current zoom percentage. */
  zoomLabel: HTMLElement;
  /** Button opening nickname change dialog. */
  changeNick: HTMLButtonElement;
  /** Text element displaying current user nickname. */
  nickDesc: HTMLElement;
  /** Close button at the bottom of the dialog. */
  closeBtn: HTMLButtonElement;
  /** Close 'X' button in the titlebar. */
  closeX: HTMLButtonElement;
}

/**
 * @brief Current application settings state passed when opening the dialog.
 */
export interface SettingsState {
  /** Active theme: 'dark' or 'light'. */
  theme: Theme;
  /** Whether WebAudio notifications are enabled. */
  soundEnabled: boolean;
  /** Current user nickname. */
  nick: string;
  /** Zoom percentage (e.g. 100). */
  zoomPercent: number;
}

/**
 * @brief Action handler callbacks for user interactions inside the SettingsDialog.
 */
export interface SettingsDialogHandlers {
  /** Callback invoked when theme toggle button is clicked. */
  onToggleTheme: () => void;
  /** Callback invoked when minimal mode toggle button is clicked. */
  onToggleMinimal: () => void;
  /** Callback invoked when sidebar toggle button is clicked. */
  onToggleSidebar: () => void;
  /** Callback invoked when dock toggle button is clicked. */
  onToggleDock: () => void;
  /** Callback invoked when sound toggle button is clicked. */
  onToggleSound: () => void;
  /** Callback invoked when notification button is clicked. */
  onToggleNotify: () => void;
  /** Callback invoked when font zoom in button is clicked. */
  onZoomIn: () => void;
  /** Callback invoked when font zoom out button is clicked. */
  onZoomOut: () => void;
  /** Callback invoked when nickname change button is clicked. */
  onChangeNick: () => void;
}

/**
 * @brief Controls the centered Settings modal dialog in DynoFreeChat.
 */
export class SettingsDialog {
  /**
   * @brief Initializes the SettingsDialog and attaches interaction listeners.
   * @param root The HTML dialog element container.
   * @param elements Child DOM elements for buttons and labels.
   * @param handlers Callbacks for settings action events.
   */
  constructor(
    private readonly root: HTMLDialogElement,
    private readonly elements: SettingsDialogElements,
    private readonly handlers: SettingsDialogHandlers,
  ) {
    this.elements.toggleTheme.addEventListener("click", () => this.handlers.onToggleTheme());
    this.elements.toggleMinimal.addEventListener("click", () => this.handlers.onToggleMinimal());
    this.elements.toggleSidebar.addEventListener("click", () => this.handlers.onToggleSidebar());
    this.elements.toggleDock.addEventListener("click", () => this.handlers.onToggleDock());
    this.elements.toggleSound.addEventListener("click", () => this.handlers.onToggleSound());
    this.elements.toggleNotify.addEventListener("click", () => this.handlers.onToggleNotify());
    this.elements.zoomIn.addEventListener("click", () => this.handlers.onZoomIn());
    this.elements.zoomOut.addEventListener("click", () => this.handlers.onZoomOut());
    this.elements.changeNick.addEventListener("click", () => {
      this.close();
      this.handlers.onChangeNick();
    });

    this.elements.closeBtn.addEventListener("click", () => this.close());
    this.elements.closeX.addEventListener("click", () => this.close());

    this.root.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
  }

  /**
   * @brief Indicates whether the settings dialog is currently open.
   * @return True if dialog is visible; false otherwise.
   */
  get isOpen(): boolean {
    return this.root.open;
  }

  /**
   * @brief Opens the centered settings modal dialog and updates displayed state.
   * @param state Current settings state.
   * @return void
   */
  open(state: SettingsState): void {
    this.update(state);
    if (!this.root.open) {
      this.root.showModal();
    }
  }

  /**
   * @brief Updates the visual state and labels inside the dialog.
   * @param state Current settings state.
   * @return void
   */
  update(state: SettingsState): void {
    this.elements.nickDesc.textContent = `Nickname hiện tại: ${state.nick}`;
    this.elements.zoomLabel.textContent = `Cỡ log hiện tại: ${state.zoomPercent}%`;
    this.elements.toggleTheme.textContent =
      state.theme === "dark" ? "Chuyển sang Light" : "Chuyển sang Dark";
    this.elements.toggleSound.textContent = state.soundEnabled ? "Tắt âm thanh" : "Bật âm thanh";
  }

  /**
   * @brief Closes the settings modal dialog.
   * @return void
   */
  close(): void {
    if (this.root.open) {
      this.root.close();
    }
  }
}
