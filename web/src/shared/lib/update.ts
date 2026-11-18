/**
 * @file update.ts
 * @brief Detects a newly deployed web build without asking the user to reload.
 * @details The page is a static bundle: every deploy changes the hashed asset
 * names in `index.html`. Fetching the live index and comparing its asset names
 * with the ones this document loaded tells us a new build exists, which is
 * cheaper and more reliable than a version endpoint that could be cached.
 */

/** Asset references (scripts and stylesheets) found in one HTML document. */
export function assetRefsFromHtml(html: string): string[] {
  if (typeof DOMParser === "undefined") return [];
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const refs: string[] = [];
  for (const script of parsed.querySelectorAll<HTMLScriptElement>("script[src]")) {
    refs.push(script.getAttribute("src") ?? "");
  }
  for (const link of parsed.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')) {
    refs.push(link.getAttribute("href") ?? "");
  }
  return refs.filter((ref) => ref.length > 0).map(normalizeAssetRef);
}

/** Asset references this document actually loaded. */
export function assetRefsFromDocument(): string[] {
  if (typeof document === "undefined") return [];
  const refs: string[] = [];
  for (const script of document.querySelectorAll<HTMLScriptElement>("script[src]")) {
    refs.push(script.getAttribute("src") ?? "");
  }
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')) {
    refs.push(link.getAttribute("href") ?? "");
  }
  return refs.filter((ref) => ref.length > 0).map(normalizeAssetRef);
}

/** @brief Normalizes one asset reference to its pathname. */
function normalizeAssetRef(ref: string): string {
  try {
    return new URL(ref, "https://local.invalid/").pathname;
  } catch {
    return ref;
  }
}

/**
 * @brief Whether the live HTML points at different assets than this document.
 * @param current Assets of the running document.
 * @param next Assets of the freshly fetched index.
 */
export function hasNewAssets(current: readonly string[], next: readonly string[]): boolean {
  if (next.length === 0) return false;
  const running = new Set(current);
  if (next.some((ref) => !running.has(ref))) return true;
  const live = new Set(next);
  return current.some((ref) => !live.has(ref));
}

/**
 * @brief Fetches the live index and compares its assets with the running page.
 * @param fetchImpl Fetch implementation; tests replace it.
 * @return True when a newer build is deployed.
 */
export async function checkForUpdate(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<boolean> {
  const current = assetRefsFromDocument();
  if (current.length === 0) return false;
  try {
    const response = await fetchImpl(`${import.meta.env.BASE_URL}index.html?ts=${Date.now()}`, {
      cache: "no-store",
      headers: { accept: "text/html" },
    });
    if (!response.ok) return false;
    const html = await response.text();
    return hasNewAssets(current, assetRefsFromHtml(html));
  } catch {
    return false;
  }
}

/** Options for {@link watchForUpdates}. */
export interface UpdateWatchOptions {
  /** Poll interval; defaults to one minute. */
  readonly intervalMs?: number;
  /** Fetch implementation for tests. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * @brief Polls for a new deployment and calls `onUpdate` once.
 * @param onUpdate Called the first time a newer build is detected.
 * @param options Poll interval and fetch seam.
 * @return Cleanup for the timer and listeners.
 */
export function watchForUpdates(onUpdate: () => void, options: UpdateWatchOptions = {}): () => void {
  if (typeof window === "undefined") return () => {};
  let stopped = false;
  let inFlight = false;
  let notified = false;
  const intervalMs = options.intervalMs ?? 60_000;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const check = async (): Promise<void> => {
    if (stopped || inFlight || notified) return;
    inFlight = true;
    const found = await checkForUpdate(fetchImpl);
    inFlight = false;
    if (!stopped && found && !notified) {
      notified = true;
      onUpdate();
    }
  };

  const onVisible = (): void => {
    if (typeof document !== "undefined" && document.hidden) return;
    void check();
  };

  const timer = setInterval(() => void check(), intervalMs);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  void check();

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}
