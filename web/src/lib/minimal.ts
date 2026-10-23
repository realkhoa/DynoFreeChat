/**
 * Minimal mode: only the chat and the composer, for embedding in a WebView
 * inside Visual Studio where a title bar, ribbon and tree would be noise.
 */
const STORAGE_KEY = "dyno.minimal";

export const DEFAULT_MINIMAL = false;

export function loadMinimal(storage: Storage | null): boolean {
  if (storage === null) return DEFAULT_MINIMAL;
  try {
    return storage.getItem(STORAGE_KEY) === "on";
  } catch {
    return DEFAULT_MINIMAL;
  }
}

export function saveMinimal(storage: Storage | null, minimal: boolean): boolean {
  if (storage !== null) {
    try {
      storage.setItem(STORAGE_KEY, minimal ? "on" : "off");
    } catch {
      // Private mode: the choice simply does not persist.
    }
  }
  return minimal;
}

/**
 * `?minimal=1` / `?minimal=0` wins over the stored preference, so a WebView can
 * pin the layout with its URL alone.
 */
export function minimalFromSearch(search: string): boolean | undefined {
  const value = new URLSearchParams(search).get("minimal");
  if (value === null) return undefined;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return undefined;
}

/** Drives the `data-minimal` attribute the layout reads. */
export function applyMinimal(root: HTMLElement, minimal: boolean): void {
  root.setAttribute("data-minimal", minimal ? "on" : "off");
}
