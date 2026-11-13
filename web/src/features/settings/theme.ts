export type Theme = "dark" | "light";

export const DEFAULT_THEME: Theme = "dark";
const STORAGE_KEY = "dyno.theme";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

/** Reads the saved theme, falling back to dark. */
export function loadTheme(storage: Storage | null): Theme {
  if (storage === null) return DEFAULT_THEME;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return isTheme(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(storage: Storage | null, theme: Theme): Theme {
  if (storage !== null) {
    try {
      storage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private mode: the theme simply does not persist.
    }
  }
  return theme;
}

export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** Applies the theme to the document root (`data-theme` drives the tokens). */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  root.setAttribute("data-theme", theme);
}
