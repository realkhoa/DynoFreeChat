import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, applyTheme, isTheme, loadTheme, otherTheme, saveTheme } from "../src/lib/theme";

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

describe("theme", () => {
  it("defaults to dark", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(loadTheme(fakeStorage())).toBe("dark");
    expect(loadTheme(null)).toBe("dark");
  });

  it("reads a saved light theme", () => {
    expect(loadTheme(fakeStorage({ "dyno.theme": "light" }))).toBe("light");
  });

  it("ignores junk values", () => {
    expect(loadTheme(fakeStorage({ "dyno.theme": "neon" }))).toBe("dark");
    expect(isTheme("neon")).toBe(false);
    expect(isTheme("light")).toBe(true);
  });

  it("persists the choice", () => {
    const storage = fakeStorage();
    saveTheme(storage, "light");
    expect(storage.getItem("dyno.theme")).toBe("light");
    expect(loadTheme(storage)).toBe("light");
  });

  it("toggles between the two themes", () => {
    expect(otherTheme("dark")).toBe("light");
    expect(otherTheme("light")).toBe("dark");
  });

  it("applies the theme to the root element", () => {
    const root = fakeStorage() as unknown as HTMLElement;
    const element = { attrs: {} as Record<string, string> } as unknown as HTMLElement;
    element.setAttribute = (name: string, value: string) => {
      (element as unknown as { attrs: Record<string, string> }).attrs[name] = value;
    };
    applyTheme(element, "light");
    expect((element as unknown as { attrs: Record<string, string> }).attrs["data-theme"]).toBe("light");
    void root;
  });
});
