// @vitest-environment jsdom
/**
 * @file update.spec.ts
 * @brief New-deploy detection from the live index assets.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetRefsFromDocument,
  assetRefsFromHtml,
  checkForUpdate,
  hasNewAssets,
  watchForUpdates,
} from "@/shared/lib/update";

/** Builds a tiny index.html with the given script. */
function indexHtml(script: string): string {
  return `<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head><body><script type="module" src="${script}"></script></body></html>`;
}

/** Fake fetch that always answers with one index page. */
function fakeFetch(html: string): typeof fetch {
  return (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
}

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  const script = document.createElement("script");
  script.type = "module";
  script.src = "/assets/index-OLD.js";
  document.body.append(script);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/app.css";
  document.head.append(link);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("update detection", () => {
  it("reads script and stylesheet assets from an index document", () => {
    expect(assetRefsFromHtml(indexHtml("/assets/index-NEW.js"))).toEqual([
      "/assets/index-NEW.js",
      "/assets/app.css",
    ]);
    expect(assetRefsFromDocument()).toEqual(["/assets/index-OLD.js", "/assets/app.css"]);
  });

  it("detects a new hashed asset and ignores an unchanged page", () => {
    const current = assetRefsFromDocument();
    expect(hasNewAssets(current, assetRefsFromHtml(indexHtml("/assets/index-OLD.js")))).toBe(false);
    expect(hasNewAssets(current, assetRefsFromHtml(indexHtml("/assets/index-NEW.js")))).toBe(true);
    expect(hasNewAssets(current, [])).toBe(false);
  });

  it("compares the running page with the live index", async () => {
    await expect(checkForUpdate(fakeFetch(indexHtml("/assets/index-NEW.js")))).resolves.toBe(true);
    await expect(checkForUpdate(fakeFetch(indexHtml("/assets/index-OLD.js")))).resolves.toBe(false);
  });

  it("treats a failed request as no update", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(checkForUpdate(failing)).resolves.toBe(false);
  });

  it("calls the handler once when a new build appears", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const cleanup = watchForUpdates(onUpdate, {
      intervalMs: 50,
      fetchImpl: fakeFetch(indexHtml("/assets/index-NEW.js")),
    });
    await vi.advanceTimersByTimeAsync(120);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
