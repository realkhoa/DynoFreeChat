/**
 * @file urlstate.ts
 * @brief URL query state so a browser reload restores the open documents.
 * @details The app is a single page: document tabs, the active document and the
 * garden view live in memory only. Mirroring the important bits into
 * `location.search` (never the hash, which carries deep links) makes a reload
 * land on the same screen without touching browser history.
 */

/** Keys owned by this module; everything else in the query is preserved. */
const OWNED_PREFIX = ["docs", "doc", "game", "gtab", "gview", "grtab", "gstab", "gpage", "garea", "gslot"];

/** @brief Reads one query parameter, or `null`. */
export function readParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** @brief Reads one comma separated list, dropping empty entries. */
export function readList(key: string): string[] {
  const raw = readParam(key);
  if (raw === null) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * @brief Writes several query parameters without reloading the page.
 * @param values Map of key to value; `null` removes the key.
 */
export function writeParams(values: Record<string, string | null>): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value.length === 0) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(null, "", url);
}

/**
 * @brief Clears every key owned by this module, e.g. when leaving all documents.
 */
export function clearOwnedParams(): void {
  const values: Record<string, null> = {};
  for (const key of OWNED_PREFIX) values[key] = null;
  writeParams(values);
}
