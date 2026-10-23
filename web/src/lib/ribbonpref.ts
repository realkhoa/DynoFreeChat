/**
 * @file ribbonpref.ts
 * @brief Manages ribbon visibility persistence and UI toggle states.
 */

/** Key used to store the ribbon visibility preference in browser storage. */
const STORAGE_KEY = "dyno.ribbon";

/** Default visibility of the ribbon when no preference has been stored. */
export const DEFAULT_RIBBON_VISIBLE = true;

/**
 * @brief Loads the saved ribbon visibility state from storage.
 * @param storage Storage implementation or null if unavailable.
 * @return True if ribbon should be displayed, false otherwise.
 */
export function loadRibbonVisible(storage: Storage | null): boolean {
  if (storage === null) return DEFAULT_RIBBON_VISIBLE;
  try {
    return storage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return DEFAULT_RIBBON_VISIBLE;
  }
}

/**
 * @brief Saves the ribbon visibility state to storage.
 * @param storage Storage implementation or null if unavailable.
 * @param visible Desired ribbon visibility state.
 * @return The saved visibility state.
 */
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

/**
 * @brief Sets the data-ribbon attribute on the root element to drive CSS layout.
 * @param root The root HTML element (usually document.documentElement).
 * @param visible Whether the ribbon is visible.
 */
export function applyRibbonVisible(root: HTMLElement, visible: boolean): void {
  root.setAttribute("data-ribbon", visible ? "on" : "off");
}

/**
 * @brief Updates the DOM state, accessibility attributes, and labels of a ribbon toggle button.
 * @param button The button element that toggles ribbon visibility.
 * @param visible Whether the ribbon is currently visible.
 */
export function updateRibbonToggleButton(button: HTMLElement, visible: boolean): void {
  button.setAttribute("aria-pressed", String(visible));
  button.title = visible ? "Ẩn ribbon (Ctrl+F1)" : "Hiện ribbon (Ctrl+F1)";
  button.classList.toggle("is-off", !visible);

  const icon = button.querySelector(".menubar-ribbon-icon");
  if (icon !== null) {
    icon.textContent = visible ? "⌃" : "⌵";
  }

  const label = button.querySelector(".menubar-ribbon-label");
  if (label !== null) {
    label.textContent = visible ? "Ribbon" : "Hiện Ribbon";
  }
}
