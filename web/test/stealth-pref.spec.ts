import { describe, expect, it } from "vitest";
import { DEFAULT_STEALTH_PREF, loadStealthPref, saveStealthPref } from "../src/game/stealth-pref";

describe("stealth-pref", () => {
  it("returns default preferences when storage is null or empty", () => {
    expect(loadStealthPref(null)).toEqual(DEFAULT_STEALTH_PREF);

    const map = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
      removeItem: (k: string) => map.delete(k),
    } as unknown as Storage;

    expect(loadStealthPref(mockStorage)).toEqual(DEFAULT_STEALTH_PREF);
  });

  it("persists and reads custom stealth preferences", () => {
    const map = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
      removeItem: (k: string) => map.delete(k),
    } as unknown as Storage;

    saveStealthPref(mockStorage, { stealth: false, codeMode: false, opacity: 0.8 });
    const loaded = loadStealthPref(mockStorage);

    expect(loaded.stealth).toBe(false);
    expect(loaded.codeMode).toBe(false);
    expect(loaded.opacity).toBe(0.8);
  });

  it("handles corrupted storage gracefully", () => {
    const mockStorage = {
      getItem: () => "invalid json{{{",
      setItem: () => {},
    } as unknown as Storage;

    expect(loadStealthPref(mockStorage)).toEqual(DEFAULT_STEALTH_PREF);
  });
});
