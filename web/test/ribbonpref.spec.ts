// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIBBON_VISIBLE,
  applyRibbonVisible,
  loadRibbonVisible,
  saveRibbonVisible,
  updateRibbonToggleButton,
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

  it("updates toggle button state when visible", () => {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    icon.className = "menubar-ribbon-icon";
    const label = document.createElement("span");
    label.className = "menubar-ribbon-label";
    button.append(icon, label);

    updateRibbonToggleButton(button, true);

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.title).toBe("Ẩn ribbon (Ctrl+F1)");
    expect(button.classList.contains("is-off")).toBe(false);
    expect(icon.textContent).toBe("⌃");
    expect(label.textContent).toBe("Ribbon");
  });

  it("updates toggle button state when hidden", () => {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    icon.className = "menubar-ribbon-icon";
    const label = document.createElement("span");
    label.className = "menubar-ribbon-label";
    button.append(icon, label);

    updateRibbonToggleButton(button, false);

    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.title).toBe("Hiện ribbon (Ctrl+F1)");
    expect(button.classList.contains("is-off")).toBe(true);
    expect(icon.textContent).toBe("⌵");
    expect(label.textContent).toBe("Hiện Ribbon");
  });
});
