/**
 * @file dockpref.ts
 * @brief State management for the chat composer Output dock.
 * @details Manages whether the chat input dock is visible ("open") or hidden ("closed").
 * Always defaults to "open" on page load so the chat composer is never missing.
 */

/**
 * @brief Represents the visual state of the Output dock.
 * - "open": composer input visible.
 * - "closed": temporarily hidden via Ctrl+Alt+O or View -> Output menu.
 */
export type DockState = "open" | "closed";

const STORAGE_KEY = "dyno.dock";
export const DEFAULT_DOCK: DockState = "open";

/**
 * @brief Validates if an unknown value is a valid DockState.
 * @param value Value to check.
 * @return True if value is "open" or "closed".
 */
export function isDockState(value: unknown): value is DockState {
  return value === "open" || value === "closed";
}

/**
 * @brief Initializes the dock state for the session.
 * @details Always defaults to "open" on startup so the input box is readily available.
 * Cleans up any stale persisted collapsed/closed states from previous sessions.
 * @param storage Browser storage or null.
 * @return Always returns "open" on page load.
 */
export function loadDock(storage: Storage | null): DockState {
  if (storage !== null) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Storage access error or private mode: ignore.
    }
  }
  return DEFAULT_DOCK;
}

/**
 * @brief Updates or saves the dock state for the current session.
 * @param storage Browser storage or null.
 * @param state The DockState to apply.
 * @return The state.
 */
export function saveDock(storage: Storage | null, state: DockState): DockState {
  if (storage !== null) {
    try {
      storage.setItem(STORAGE_KEY, state);
    } catch {
      // Private mode: ignore.
    }
  }
  return state;
}

/**
 * @brief Toggles dock state between open and closed.
 * @param state Current dock state.
 * @return Toggled DockState.
 */
export function toggleDock(state: DockState): DockState {
  return state === "open" ? "closed" : "open";
}

/**
 * @brief Closes the dock.
 * @param _state Current dock state.
 * @return Always returns "closed".
 */
export function closeDock(_state: DockState): DockState {
  return "closed";
}

/**
 * @brief Toggles or reveals the dock via shortcut (Ctrl+Alt+O) or View menu.
 * @param state Current dock state.
 * @return Next DockState.
 */
export function revealDock(state: DockState): DockState {
  return state === "open" ? "closed" : "open";
}

/**
 * @brief Applies the dock state data attribute to a root HTMLElement.
 * @param root Target root element.
 * @param state Dock state to set on data-dock attribute.
 * @return void
 */
export function applyDock(root: HTMLElement, state: DockState): void {
  root.setAttribute("data-dock", state);
}
