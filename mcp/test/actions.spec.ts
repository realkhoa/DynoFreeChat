/**
 * @file actions.spec.ts
 * @brief Catalog integrity for the MCP action surface.
 */

import { describe, expect, it } from "vitest";
import { ACTION_DOCS, ACTION_KINDS, isKnownAction } from "../src/actions.js";

describe("action catalog", () => {
  it("keeps kinds unique and documented exactly once", () => {
    expect(new Set(ACTION_KINDS).size).toBe(ACTION_KINDS.length);
    expect(ACTION_DOCS).toHaveLength(ACTION_KINDS.length);
    const documented = ACTION_DOCS.map((entry) => entry.kind).sort();
    expect(documented).toEqual([...ACTION_KINDS].sort());
  });

  it("recognises every documented kind and rejects typos", () => {
    for (const kind of ACTION_KINDS) expect(isKnownAction(kind)).toBe(true);
    expect(isKnownAction("waterAll")).toBe(true);
    expect(isKnownAction("waterEverthing")).toBe(false);
    expect(isKnownAction("")).toBe(false);
  });

  it("documents the freshly added features", () => {
    for (const kind of ["quickPlan", "harvestMushroom", "plantMushroom", "setStaffRole", "uprootBulk"]) {
      expect(isKnownAction(kind)).toBe(true);
    }
  });
});
