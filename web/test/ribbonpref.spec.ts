import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIBBON_VISIBLE,
  applyRibbonVisible,
  loadRibbonVisible,
  saveRibbonVisible,
} from "../src/lib/ribbonpref";

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

describe("ribbon visibility", () => {
  it("is visible by default", () => {
    expect(DEFAULT_RIBBON_VISIBLE).toBe(true);
    expect(loadRibbonVisible(fakeStorage())).toBe(true);
    expect(loadRibbonVisible(null)).toBe(true);
  });

  it("remembers being hidden", () => {
    const storage = fakeStorage();
    saveRibbonVisible(storage, false);

    expect(loadRibbonVisible(storage)).toBe(false);
    expect(storage.getItem("dyno.ribbon")).toBe("off");
  });

  it("treats junk as visible", () => {
    expect(loadRibbonVisible(fakeStorage({ "dyno.ribbon": "maybe" }))).toBe(true);
  });

  it("drives the data attribute", () => {
    const attrs: Record<string, string> = {};
    const root = {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
    } as unknown as HTMLElement;

    applyRibbonVisible(root, false);
    expect(attrs["data-ribbon"]).toBe("off");

    applyRibbonVisible(root, true);
    expect(attrs["data-ribbon"]).toBe("on");
  });
});
