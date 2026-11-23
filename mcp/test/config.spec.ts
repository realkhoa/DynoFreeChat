/**
 * @file config.spec.ts
 * @brief Environment plumbing for the MCP server.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_API_BASE, isAuthHeader, readConfig } from "../src/config.js";

describe("mcp config", () => {
  it("falls back to the public worker and unauthenticated mode", () => {
    const config = readConfig({});
    expect(config.apiBase).toBe(DEFAULT_API_BASE);
    expect(config.auth).toBeNull();
    expect(config.recovery).toBeNull();
    expect(config.readOnly).toBe(false);
  });

  it("accepts a direct auth header and trims the base URL", () => {
    const config = readConfig({
      DYNO_API_BASE: "http://localhost:8787/",
      DYNO_GARDEN_AUTH: "player.token",
    });
    expect(config.apiBase).toBe("http://localhost:8787");
    expect(config.auth).toBe("player.token");
  });

  it("joins the split player id and token values", () => {
    const config = readConfig({ DYNO_GARDEN_PLAYER_ID: "abc", DYNO_GARDEN_TOKEN: "def" });
    expect(config.auth).toBe("abc.def");
  });

  it("treats blank values as absent and honours read-only", () => {
    const config = readConfig({
      DYNO_GARDEN_AUTH: "   ",
      DYNO_READ_ONLY: "1",
    });
    expect(config.auth).toBeNull();
    expect(config.readOnly).toBe(true);
  });

  it("validates the playerId.token shape", () => {
    expect(isAuthHeader("abc.def")).toBe(true);
    expect(isAuthHeader("abc")).toBe(false);
    expect(isAuthHeader(".def")).toBe(false);
    expect(isAuthHeader("abc.")).toBe(false);
  });
});
