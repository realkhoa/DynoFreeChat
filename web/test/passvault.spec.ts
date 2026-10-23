import { describe, expect, it } from "vitest";
import { PassVault } from "../src/lib/passvault";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
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

describe("PassVault", () => {
  it("remembers a password per room", () => {
    const vault = new PassVault(fakeStorage());
    vault.remember("team", "hunter2");

    expect(vault.get("team")).toBe("hunter2");
    expect(vault.get("other")).toBeUndefined();
    expect(vault.has("team")).toBe(true);
  });

  it("survives a reload because it reads storage again", () => {
    const storage = fakeStorage();
    new PassVault(storage).remember("team", "hunter2");

    expect(new PassVault(storage).get("team")).toBe("hunter2");
  });

  it("does not remember an open room", () => {
    const vault = new PassVault(fakeStorage());
    vault.remember("chung", "");
    expect(vault.has("chung")).toBe(false);
  });

  it("forgets on demand", () => {
    const vault = new PassVault(fakeStorage());
    vault.remember("team", "hunter2");

    expect(vault.forget("team")).toBe(true);
    expect(vault.has("team")).toBe(false);
    expect(vault.forget("team")).toBe(false);
  });

  it("keeps other rooms when one is forgotten", () => {
    const vault = new PassVault(fakeStorage());
    vault.remember("a", "1");
    vault.remember("b", "2");
    vault.forget("a");

    expect(vault.get("b")).toBe("2");
  });

  it("survives corrupt json", () => {
    const storage = fakeStorage();
    storage.setItem("dyno.passes", "{not json");
    expect(new PassVault(storage).get("team")).toBeUndefined();
  });

  it("works without storage at all", () => {
    const vault = new PassVault(null);
    vault.remember("team", "hunter2");
    expect(vault.get("team")).toBeUndefined();
  });
});
