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
  it("starts open by default", () => {
    expect(DEFAULT_DOCK).toBe("open");
    expect(loadDock(fakeStorage())).toBe("open");
    expect(loadDock(null)).toBe("open");
  });

  it("resets stale legacy states on load to ensure chat input is always open", () => {
    const storage = fakeStorage({ "dyno.dock": "collapsed" });
    expect(loadDock(storage)).toBe("open");
    expect(storage.getItem("dyno.dock")).toBeNull();

    storage.setItem("dyno.dock", "closed");
    expect(loadDock(storage)).toBe("open");
    expect(storage.getItem("dyno.dock")).toBeNull();
  });

  it("validates states", () => {
    expect(isDockState("open")).toBe(true);
    expect(isDockState("closed")).toBe(true);
    expect(isDockState("collapsed")).toBe(false);
    expect(isDockState("tiny")).toBe(false);
  });

  it("toggles between open and closed", () => {
    expect(toggleDock("open")).toBe("closed");
    expect(toggleDock("closed")).toBe("open");
  });

  it("closes explicitly", () => {
    expect(closeDock("open")).toBe("closed");
    expect(closeDock("closed")).toBe("closed");
  });

  it("reveals and closes with keyboard shortcut or menu action", () => {
    expect(revealDock("closed")).toBe("open");
    expect(revealDock("open")).toBe("closed");
  });

  it("persists and applies data attribute", () => {
    const storage = fakeStorage();
    saveDock(storage, "closed");
    expect(storage.getItem("dyno.dock")).toBe("closed");

    const attrs: Record<string, string> = {};
    const root = {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
    } as unknown as HTMLElement;

    applyDock(root, "closed");
    expect(attrs["data-dock"]).toBe("closed");
  });
});
