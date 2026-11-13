/**
 * @file settings-view.ts
 * @brief Settings document: theme, workspace, audio, zoom and profile, in a tab.
 */

import type { Theme } from "@/features/settings/theme";

/** DOM elements owned by the settings document. */
export interface SettingsViewElements {
  /** Button toggling Dark/Light theme. */
  toggleTheme: HTMLButtonElement;
  /** Button toggling Minimal IDE mode. */
  toggleMinimal: HTMLButtonElement;
  /** Button toggling the Solution Explorer. */
  toggleSidebar: HTMLButtonElement;
  /** Button toggling the Output dock. */
  toggleDock: HTMLButtonElement;
  /** Button toggling WebAudio sound. */
  toggleSound: HTMLButtonElement;
  /** Button requesting notification permission. */
  toggleNotify: HTMLButtonElement;
  /** Button zooming the log in. */
  zoomIn: HTMLButtonElement;
  /** Button zooming the log out. */
  zoomOut: HTMLButtonElement;
  /** Text showing the current zoom percentage. */
  zoomLabel: HTMLElement;
  /** Inline nickname field. */
  nickInput: HTMLInputElement;
  /** Saves the nickname typed above. */
  nickSave: HTMLButtonElement;
  /** Text showing the saved nickname. */
  nickDesc: HTMLElement;
}

/** Current settings values rendered by the view. */
export interface SettingsState {
  /** Active theme. */
  theme: Theme;
  /** Whether sound is enabled. */
  soundEnabled: boolean;
  /** Saved nickname. */
  nick: string;
  /** Zoom percentage, e.g. 100. */
  zoomPercent: number;
}

/** Callbacks for user actions inside the settings document. */
export interface SettingsViewHandlers {
  onToggleTheme: () => void;
  onToggleMinimal: () => void;
  onToggleSidebar: () => void;
  onToggleDock: () => void;
  onToggleSound: () => void;
  onToggleNotify: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /**
   * Applies a new nickname.
   * @param nick Trimmed value typed by the user.
   */
  onChangeNick: (nick: string) => void;
}

/**
 * @brief Renders and updates the settings document.
 */
export class SettingsView {
  /**
   * @brief Wires every control once.
   * @param root The settings panel element.
   * @param elements Child elements.
   * @param handlers Action callbacks.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly elements: SettingsViewElements,
    private readonly handlers: SettingsViewHandlers,
  ) {
    elements.toggleTheme.addEventListener("click", () => handlers.onToggleTheme());
    elements.toggleMinimal.addEventListener("click", () => handlers.onToggleMinimal());
    elements.toggleSidebar.addEventListener("click", () => handlers.onToggleSidebar());
    elements.toggleDock.addEventListener("click", () => handlers.onToggleDock());
    elements.toggleSound.addEventListener("click", () => handlers.onToggleSound());
    elements.toggleNotify.addEventListener("click", () => handlers.onToggleNotify());
    elements.zoomIn.addEventListener("click", () => handlers.onZoomIn());
    elements.zoomOut.addEventListener("click", () => handlers.onZoomOut());

    const saveNick = (): void => {
      const nick = elements.nickInput.value.trim();
      if (nick.length === 0) return;
      handlers.onChangeNick(nick);
    };
    elements.nickSave.addEventListener("click", saveNick);
    elements.nickInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      saveNick();
    });
  }

  /**
   * @brief Updates the labels and control text from the current state.
   * @param state Current settings values.
   */
  update(state: SettingsState): void {
    this.elements.nickDesc.textContent = `Nickname hiện tại: ${state.nick}`;
    this.elements.nickInput.value = state.nick;
    this.elements.zoomLabel.textContent = `Cỡ log hiện tại: ${state.zoomPercent}%`;
    this.elements.toggleTheme.textContent = state.theme === "dark" ? "Chuyển sang Light" : "Chuyển sang Dark";
    this.elements.toggleSound.textContent = state.soundEnabled ? "Tắt âm thanh" : "Bật âm thanh";
  }

  /**
   * @brief Puts the caret in the nickname field, for the profile shortcut.
   */
  focusNick(): void {
    this.elements.nickInput.focus();
    this.elements.nickInput.select();
  }

  /**
   * @brief The settings panel element.
   * @return Root element.
   */
  get element(): HTMLElement {
    return this.root;
  }
}
