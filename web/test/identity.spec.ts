import { describe, expect, it } from "vitest";
import { loadIdentity, randomIdentity, saveIdentity, saveNick } from "../src/lib/identity";

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

describe("identity", () => {
  it("generates a guest nick with a colour", () => {
    const identity = randomIdentity(() => 0.5);
    expect(identity.nick).toMatch(/^guest-[0-9a-z]{4}$/);
    expect(identity.color).toMatch(/^hsl\(\d{1,3} 65% 62%\)$/);
  });

  it("persists the first generated identity", () => {
    const storage = fakeStorage();
    const first = loadIdentity(storage, () => 0.42);
    const second = loadIdentity(storage, () => 0.99);
    expect(second).toEqual(first);
  });

  it("survives corrupt storage", () => {
    const storage = fakeStorage();
    storage.setItem("dyno.identity", "{not json");
    expect(loadIdentity(storage, () => 0.5).nick).toMatch(/^guest-/);
  });

  it("works without storage at all", () => {
    const identity = loadIdentity(null, () => 0.5);
    expect(identity.nick).toMatch(/^guest-/);
  });

  it("trims a new nick but keeps the colour", () => {
    const storage = fakeStorage();
    const current = saveIdentity(storage, { nick: "guest-aaaa", color: "hsl(200 60% 60%)" });
    const updated = saveNick(storage, current, "  khoan  ");
    expect(updated.nick).toBe("khoan");
    expect(updated.color).toBe("hsl(200 60% 60%)");
  });

  it("ignores an empty nick", () => {
    const storage = fakeStorage();
    const current = { nick: "guest-aaaa", color: "hsl(200 60% 60%)" };
    expect(saveNick(storage, current, "   ")).toEqual(current);
  });
});
