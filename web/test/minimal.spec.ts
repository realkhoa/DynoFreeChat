import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINIMAL,
  applyMinimal,
  loadMinimal,
  minimalFromSearch,
  saveMinimal,
} from "../src/lib/minimal";

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

describe("minimal mode", () => {
  it("is off by default", () => {
    expect(DEFAULT_MINIMAL).toBe(false);
    expect(loadMinimal(fakeStorage())).toBe(false);
    expect(loadMinimal(null)).toBe(false);
  });

  it("remembers being on", () => {
    const storage = fakeStorage();
    saveMinimal(storage, true);

    expect(loadMinimal(storage)).toBe(true);
    expect(storage.getItem("dyno.minimal")).toBe("on");
  });

  it("reads the URL override", () => {
    expect(minimalFromSearch("?minimal=1")).toBe(true);
    expect(minimalFromSearch("?r=chung&minimal=0")).toBe(false);
    expect(minimalFromSearch("?minimal=true")).toBe(true);
    expect(minimalFromSearch("?minimal=off")).toBe(false);
  });

  it("ignores an absent or junk override", () => {
    expect(minimalFromSearch("?r=chung")).toBeUndefined();
    expect(minimalFromSearch("?minimal=maybe")).toBeUndefined();
    expect(minimalFromSearch("")).toBeUndefined();
  });

  it("drives the data attribute", () => {
    const attrs: Record<string, string> = {};
    const root = {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
    } as unknown as HTMLElement;

    applyMinimal(root, true);
    expect(attrs["data-minimal"]).toBe("on");

    applyMinimal(root, false);
    expect(attrs["data-minimal"]).toBe("off");
  });
});
