/**
 * @file dockpref.ts
 * @brief State management and persistence for the chat composer Output dock.
 * @details Manages whether the dock is visible ("open") or hidden ("closed"/"collapsed").
 */

/**
 * @brief Represents the visual state of the Output dock.
 * - "open": composer input visible.
 * - "collapsed": collapsed/hidden.
 * - "closed": fully hidden, restorable via shortcut or View -> Output menu.
 */
export type DockState = "open" | "collapsed" | "closed";

const STORAGE_KEY = "dyno.dock";
export const DEFAULT_DOCK: DockState = "open";

/**
 * @brief Validates if an unknown value is a valid DockState.
 * @param value Value to check.
 * @return True if value is "open", "collapsed", or "closed".
 */
export function isDockState(value: unknown): value is DockState {
  return value === "open" || value === "collapsed" || value === "closed";
}

/**
 * @brief Loads the saved dock state from localStorage.
 * @param storage Browser storage or null.
 * @return The loaded DockState, or DEFAULT_DOCK ("open") on error/missing.
 */
export function loadDock(storage: Storage | null): DockState {
  if (storage === null) return DEFAULT_DOCK;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return isDockState(raw) ? raw : DEFAULT_DOCK;
  } catch {
    return DEFAULT_DOCK;
  }
}

/**
 * @brief Saves the current dock state to localStorage.
 * @param storage Browser storage or null.
 * @param state The DockState to save.
 * @return The saved DockState.
 */
export function saveDock(storage: Storage | null, state: DockState): DockState {
  if (storage !== null) {
    try {
      storage.setItem(STORAGE_KEY, state);
    } catch {
      // Private mode: the state simply does not persist.
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
 * @brief Closes the dock completely.
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
