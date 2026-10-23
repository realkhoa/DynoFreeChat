import { describe, expect, it } from "vitest";
import {
  BASE_LOG_SIZE,
  DEFAULT_ZOOM,
  ZOOM_STEPS,
  isZoom,
  loadZoom,
  saveZoom,
  stepZoom,
  zoomToPixels,
} from "../src/lib/zoom";

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("zoom", () => {
  it("defaults to 100 percent", () => {
    expect(DEFAULT_ZOOM).toBe(100);
    expect(loadZoom(fakeStorage())).toBe(100);
    expect(loadZoom(null)).toBe(100);
  });

  it("reads a saved step", () => {
    expect(loadZoom(fakeStorage({ "dyno.logzoom": "125" }))).toBe(125);
  });

  it("ignores values that are not a step", () => {
    expect(loadZoom(fakeStorage({ "dyno.logzoom": "133" }))).toBe(100);
    expect(loadZoom(fakeStorage({ "dyno.logzoom": "abc" }))).toBe(100);
    expect(isZoom(133)).toBe(false);
    expect(isZoom(110)).toBe(true);
  });

  it("round-trips through storage", () => {
    const storage = fakeStorage();
    saveZoom(storage, 150);
    expect(loadZoom(storage)).toBe(150);
  });

  it("steps through the ladder and clamps at both ends", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(80, -1)).toBe(80);
    expect(stepZoom(150, 1)).toBe(150);
  });

  it("converts a step to a font size", () => {
    expect(zoomToPixels(100)).toBe(BASE_LOG_SIZE);
    expect(zoomToPixels(80)).toBe(10);
    expect(zoomToPixels(150)).toBe(18.8);
    expect(ZOOM_STEPS).toContain(100);
  });
});
