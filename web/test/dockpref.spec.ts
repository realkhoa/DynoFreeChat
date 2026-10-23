import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCK,
  applyDock,
  closeDock,
  isDockState,
  loadDock,
  revealDock,
  saveDock,
  toggleDock,
} from "../src/lib/dockpref";

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

describe("dock state", () => {
  it("starts open", () => {
    expect(DEFAULT_DOCK).toBe("open");
    expect(loadDock(fakeStorage())).toBe("open");
    expect(loadDock(null)).toBe("open");
  });

  it("remembers every state", () => {
    const storage = fakeStorage();
    saveDock(storage, "collapsed");
    expect(loadDock(storage)).toBe("collapsed");

    saveDock(storage, "closed");
    expect(loadDock(storage)).toBe("closed");
  });

  it("ignores junk", () => {
    expect(loadDock(fakeStorage({ "dyno.dock": "tiny" }))).toBe("open");
    expect(isDockState("tiny")).toBe(false);
    expect(isDockState("closed")).toBe(true);
  });

  it("toggles between open and collapsed", () => {
    expect(toggleDock("open")).toBe("collapsed");
    expect(toggleDock("collapsed")).toBe("open");
  });

  it("closes from any state", () => {
    expect(closeDock("open")).toBe("closed");
    expect(closeDock("collapsed")).toBe("closed");
  });

  it("reveals and collapses with the keyboard shortcut", () => {
    expect(revealDock("closed")).toBe("open");
    expect(revealDock("collapsed")).toBe("open");
    expect(revealDock("open")).toBe("collapsed");
  });

  it("drives the data attribute", () => {
    const attrs: Record<string, string> = {};
    const root = {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
    } as unknown as HTMLElement;

    applyDock(root, "collapsed");
    expect(attrs["data-dock"]).toBe("collapsed");
  });
});
