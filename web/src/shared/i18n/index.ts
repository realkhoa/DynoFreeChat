/**
 * @file index.ts
 * @brief Runtime locale layer: preference, dictionary lookup and formatting.
 * @details The app ships Vietnamese by default and English as the alternate
 * locale. Views subscribe with {@link onLocaleChange} and re-render their text;
 * the locale never changes any game data, it only changes presentation.
 */

import { DICTIONARIES, type Dictionary } from "./dictionary";

/** Supported interface locales. */
export type Locale = "vi" | "en";

/** Locales offered by Settings, in display order. */
export const LOCALES: readonly Locale[] = ["vi", "en"];

/** Storage key for the remembered locale. */
export const LOCALE_STORAGE_KEY = "dyno.locale";

/** Formatting width for durations. */
export type DurationStyle = "short" | "long";

let activeLocale: Locale = "vi";
const listeners = new Set<() => void>();

/**
 * @brief Normalizes an arbitrary language tag to a supported locale.
 * @param candidate Value from storage or `navigator.language`.
 */
export function detectLocale(candidate: string | null | undefined): Locale {
  if (typeof candidate !== "string" || candidate.length === 0) return "vi";
  return candidate.trim().toLowerCase().startsWith("en") ? "en" : "vi";
}

/**
 * @brief Reads the remembered locale, falling back to the browser language.
 * @param storage Storage to read, or `null`.
 */
export function loadLocale(storage: Storage | null): Locale {
  if (storage !== null) {
    try {
      const raw = storage.getItem(LOCALE_STORAGE_KEY);
      if (raw !== null) return detectLocale(raw);
    } catch {
      // Blocked storage keeps the browser-language fallback.
    }
  }
  const navigatorLanguage = typeof navigator === "undefined" ? "" : navigator.language;
  return detectLocale(navigatorLanguage);
}

/** @brief Current locale. */
export function getLocale(): Locale {
  return activeLocale;
}

/** @brief Paints the locale on `<html lang>`. */
function applyDocumentLang(): void {
  if (typeof document !== "undefined") document.documentElement.lang = activeLocale;
}

/**
 * @brief Initializes the locale once at boot.
 * @param storage Storage to read, or `null`.
 * @return The active locale.
 */
export function initLocale(storage: Storage | null): Locale {
  activeLocale = loadLocale(storage);
  applyDocumentLang();
  return activeLocale;
}

/**
 * @brief Changes the locale and notifies subscribers.
 * @param next Locale to activate.
 * @param storage Storage to persist into, or `null`.
 */
export function setLocale(next: Locale, storage: Storage | null = null): void {
  if (next === activeLocale) return;
  activeLocale = next;
  if (storage !== null) {
    try {
      storage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Persistence is best effort; the session still switches.
    }
  }
  applyDocumentLang();
  for (const listener of listeners) listener();
}

/**
 * @brief Subscribes to locale changes.
 * @param listener Called after every change.
 * @return Unsubscribe function.
 */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * @brief Translates one key, filling `{name}` placeholders.
 * @param key Dictionary key.
 * @param params Replacement values.
 * @return The localized string; the key itself when the entry is missing.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dictionary: Dictionary = DICTIONARIES[activeLocale];
  let text = dictionary[key] ?? DICTIONARIES.en[key] ?? key;
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/**
 * @brief Formats one pipe separated translation list into an array.
 * @param key Dictionary key holding values separated by `|`.
 */
export function tList(key: string): string[] {
  return t(key).split("|");
}

/**
 * @brief Formats a duration for countdowns and hints.
 * @param ms Milliseconds to format.
 * @param style `short` for cells (`2m41s`), `long` for panels.
 */
export function formatDuration(ms: number, style: DurationStyle = "long"): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (style === "short") {
    if (hours > 0) return `${hours}h${minutes > 0 ? `${minutes}m` : ""}`;
    if (minutes > 0) return `${minutes}m${seconds > 0 ? `${seconds}s` : ""}`;
    return `${Math.max(seconds, 1)}s`;
  }

  if (activeLocale === "vi") {
    if (hours > 0) return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
    if (minutes > 0) return seconds > 0 ? `${minutes} phút ${seconds} giây` : `${minutes} phút`;
    return `${seconds} giây`;
  }
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/**
 * @brief Formats an integer for the active locale.
 * @param value Number to format.
 */
export function formatNumber(value: number): string {
  const localized = Math.round(value).toLocaleString(activeLocale === "vi" ? "vi-VN" : "en-US");
  return localized;
}

/**
 * @brief Formats a long amount with an m/b/t suffix.
 * @details Money scales past a trillion, so grouped digits would run off a
 * phone screen. Values under one million stay grouped; above that the number
 * is shortened to `12.35m`, `1.5b` or `2.23t` with at most two decimals.
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1_000_000) return formatNumber(value);
  // Descending so the first hit is the biggest fitted suffix, well past the
  // trillion mark where idle incomes eventually land.
  const units: readonly [suffix: string, size: number][] = [
    ["no", 1e30],
    ["oc", 1e27],
    ["sp", 1e24],
    ["sx", 1e21],
    ["Q", 1e18],
    ["q", 1e15],
    ["t", 1e12],
    ["b", 1_000_000_000],
    ["m", 1_000_000],
  ];
  for (const [suffix, size] of units) {
    if (abs < size) continue;
    const scaled = value / size;
    const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
    return `${Number(scaled.toFixed(decimals))}${suffix}`;
  }
  return formatNumber(value);
}

/**
 * @brief Localizes a server error code, tolerating unknown codes.
 * @param code Machine readable error code.
 */
export function translateError(code: string): string {
  const key = `errors.${code}`;
  const dictionary = DICTIONARIES[activeLocale];
  const text = dictionary[key] ?? DICTIONARIES.en[key];
  return text ?? t("errors.UNKNOWN");
}
