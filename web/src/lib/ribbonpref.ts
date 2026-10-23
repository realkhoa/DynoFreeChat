/** Whether the ribbon is shown. Applies on the next paint, like `Ctrl+F1` in VS. */
const STORAGE_KEY = "dyno.ribbon";

export const DEFAULT_RIBBON_VISIBLE = true;

export function loadRibbonVisible(storage: Storage | null): boolean {
  if (storage === null) return DEFAULT_RIBBON_VISIBLE;
  try {
    return storage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return DEFAULT_RIBBON_VISIBLE;
  }
}

export function saveRibbonVisible(storage: Storage | null, visible: boolean): boolean {
  if (storage !== null) {
    try {
      storage.setItem(STORAGE_KEY, visible ? "on" : "off");
    } catch {
      // Private mode: the choice simply does not persist.
    }
  }
  return visible;
}

/** Drives the `data-ribbon` attribute the layout reads. */
export function applyRibbonVisible(root: HTMLElement, visible: boolean): void {
  root.setAttribute("data-ribbon", visible ? "on" : "off");
}
