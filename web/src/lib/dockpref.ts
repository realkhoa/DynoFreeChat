/**
 * State of the Output dock at the bottom: the chat composer.
 *
 *   open      → input row + tab strip
 *   collapsed → tab strip only
 *   closed    → nothing, restorable from View → Output (Ctrl+Alt+O)
 */
export type DockState = "open" | "collapsed" | "closed";

const STORAGE_KEY = "dyno.dock";
export const DEFAULT_DOCK: DockState = "open";

export function isDockState(value: unknown): value is DockState {
  return value === "open" || value === "collapsed" || value === "closed";
}

export function loadDock(storage: Storage | null): DockState {
  if (storage === null) return DEFAULT_DOCK;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return isDockState(raw) ? raw : DEFAULT_DOCK;
  } catch {
    return DEFAULT_DOCK;
  }
}

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

/** Closing hides everything; collapsing keeps the tab strip as a handle. */
export function toggleDock(state: DockState): DockState {
  return state === "open" ? "collapsed" : "open";
}

export function closeDock(state: DockState): DockState {
  return state === "closed" ? "closed" : "closed";
}

/** Ctrl+Alt+O: bring the dock back if it is gone, otherwise collapse it. */
export function revealDock(state: DockState): DockState {
  return state === "closed" ? "open" : state === "open" ? "collapsed" : "open";
}

export function applyDock(root: HTMLElement, state: DockState): void {
  root.setAttribute("data-dock", state);
}
