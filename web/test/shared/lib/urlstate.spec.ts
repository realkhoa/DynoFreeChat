// @vitest-environment jsdom
/**
 * @file urlstate.spec.ts
 * @brief Query-state helpers used to survive a page reload.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { clearOwnedParams, readList, readParam, writeParams } from "@/shared/lib/urlstate";

/** Resets the address to a bare page. */
function resetUrl(): void {
  window.history.replaceState(null, "", "/index.html");
}

beforeEach(resetUrl);

describe("urlstate", () => {
  it("writes and reads one parameter without reloading", () => {
    writeParams({ docs: "rooms,games" });
    expect(readParam("docs")).toBe("rooms,games");
    expect(window.location.search).toContain("docs=rooms%2Cgames");
  });

  it("removes a parameter when the value is null", () => {
    writeParams({ doc: "settings" });
    writeParams({ doc: null });
    expect(readParam("doc")).toBeNull();
  });

  it("preserves unrelated parameters and the hash", () => {
    window.history.replaceState(null, "", "/index.html?r=general&minimal=1#garden=ABCDEF");
    writeParams({ docs: "games" });
    expect(readParam("r")).toBe("general");
    expect(readParam("minimal")).toBe("1");
    expect(window.location.hash).toBe("#garden=ABCDEF");
    expect(readParam("docs")).toBe("games");
  });

  it("reads lists and drops empty entries", () => {
    writeParams({ docs: "rooms, games,," });
    expect(readList("docs")).toEqual(["rooms", "games"]);
    expect(readList("missing")).toEqual([]);
  });

  it("clears only the keys this module owns", () => {
    writeParams({ docs: "a", doc: "a", game: "2048", gtab: "garden", gpage: "1" });
    clearOwnedParams();
    expect(readParam("docs")).toBeNull();
    expect(readParam("game")).toBeNull();
    expect(readParam("gpage")).toBeNull();
  });
});
