/**
 * @file stealth-pref.ts
 * @brief Manages persistence for stealth blur, code disguise mode, and view dock preferences.
 */

/**
 * @brief User stealth configuration options.
 */
export interface StealthPref {
  /** True if idle blur and dimmed opacity is active */
  stealth: boolean;
  /** True if C# syntax code disguise is active */
  codeMode: boolean;
  /** Opacity factor when idle (e.g. 0.35) */
  opacity: number;
}

const STORAGE_KEY = "dyno_ttt_stealth_pref";

/**
 * @brief Default stealth settings (stealth blur and code disguise enabled).
 */
export const DEFAULT_STEALTH_PREF: StealthPref = {
  stealth: true,
  codeMode: true,
  opacity: 0.35,
};

/**
 * @brief Loads the stealth preferences from localStorage.
 * @param storage The localStorage instance or null.
 * @return Stored preferences or default settings.
 */
export function loadStealthPref(storage: Storage | null): StealthPref {
  if (storage === null) return { ...DEFAULT_STEALTH_PREF };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_STEALTH_PREF };
    const parsed = JSON.parse(raw) as Partial<StealthPref>;
    return {
      stealth: typeof parsed.stealth === "boolean" ? parsed.stealth : DEFAULT_STEALTH_PREF.stealth,
      codeMode: typeof parsed.codeMode === "boolean" ? parsed.codeMode : DEFAULT_STEALTH_PREF.codeMode,
      opacity: typeof parsed.opacity === "number" ? parsed.opacity : DEFAULT_STEALTH_PREF.opacity,
    };
  } catch {
    return { ...DEFAULT_STEALTH_PREF };
  }
}

/**
 * @brief Saves stealth preferences to localStorage.
 * @param storage The localStorage instance or null.
 * @param pref The stealth preferences to save.
 */
export function saveStealthPref(storage: Storage | null, pref: StealthPref): void {
  if (storage === null) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Storage quota or permission error ignored
  }
}
