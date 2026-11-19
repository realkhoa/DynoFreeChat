// @vitest-environment jsdom
/**
 * @file i18n.spec.ts
 * @brief Locale preference, dictionary lookup and duration formatting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EFFECTS, EVENTS } from "@dyno/shared/garden";
import {
  detectLocale,
  formatDuration,
  formatNumber,
  getLocale,
  initLocale,
  loadLocale,
  LOCALE_STORAGE_KEY,
  onLocaleChange,
  setLocale,
  t,
  tList,
  translateError,
} from "@/shared/i18n";

/** Minimal in-memory storage. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } as Storage;
}

describe("locale preference", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("vi");
  });

  afterEach(() => {
    setLocale("vi");
  });

  it("detects Vietnamese as the default and English from tags", () => {
    expect(detectLocale(null)).toBe("vi");
    expect(detectLocale("")).toBe("vi");
    expect(detectLocale("vi-VN")).toBe("vi");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("EN")).toBe("en");
  });

  it("loads, saves and reports the active locale", () => {
    const storage = memoryStorage();
    storage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(loadLocale(storage)).toBe("en");
    expect(initLocale(storage)).toBe("en");
    expect(getLocale()).toBe("en");

    setLocale("vi", storage);
    expect(getLocale()).toBe("vi");
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
  });

  it("notifies subscribers and can unsubscribe", () => {
    const seen: string[] = [];
    const stop = onLocaleChange(() => seen.push(getLocale()));
    setLocale("en");
    stop();
    setLocale("vi");
    expect(seen).toEqual(["en"]);
  });

  it("falls back to the browser language when storage is empty", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("vi-VN");
    expect(loadLocale(null)).toBe("vi");
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
    expect(loadLocale(null)).toBe("en");
    vi.restoreAllMocks();
  });
});

describe("translation", () => {
  beforeEach(() => {
    setLocale("vi");
  });

  afterEach(() => {
    setLocale("vi");
  });

  it("translates Vietnamese by default and switches to English", () => {
    expect(t("tabs.garden")).toBe("garden");
    expect(t("garden.coins")).toBe("coin");
    setLocale("en");
    expect(t("garden.coins")).toBe("coins");
  });

  it("fills placeholders", () => {
    expect(t("garden.plot", { slot: 3 })).toBe("Ô 3");
    setLocale("en");
    expect(t("garden.plot", { slot: 3 })).toBe("Plot 3");
  });

  it("exposes the key itself for unknown entries and splits lists", () => {
    expect(t("no.such.key")).toBe("no.such.key");
    expect(tList("garden.stageValues")).toEqual(["mầm", "non", "sắp chín", "chín"]);
  });

  it("localizes known server errors and tolerates unknown codes", () => {
    expect(translateError("NOT_ENOUGH_COINS")).toBe("Không đủ coin.");
    setLocale("en");
    expect(translateError("NOT_ENOUGH_COINS")).toBe("Not enough coins.");
    expect(translateError("SOMETHING_NEW")).toBe("Something went wrong.");
  });
});

describe("formatting", () => {
  afterEach(() => {
    setLocale("vi");
  });

  it("formats short durations for cells", () => {
    setLocale("vi");
    expect(formatDuration(41_000, "short")).toBe("41s");
    expect(formatDuration(161_000, "short")).toBe("2m41s");
    expect(formatDuration(3_600_000, "short")).toBe("1h");
  });

  it("formats long durations per locale", () => {
    setLocale("vi");
    expect(formatDuration(161_000)).toBe("2 phút 41 giây");
    expect(formatDuration(120_000)).toBe("2 phút");
    expect(formatDuration(3_600_000)).toBe("1 giờ");
    setLocale("en");
    expect(formatDuration(161_000)).toBe("2m 41s");
    expect(formatDuration(120_000)).toBe("2m");
  });

  it("formats numbers for the active locale", () => {
    setLocale("en");
    expect(formatNumber(12345)).toBe("12,345");
    setLocale("vi");
    expect(formatNumber(12345)).toBe("12.345");
  });
});

describe("garden catalog strings", () => {
  it("translates every mutation, mark and weather event", () => {
    for (const locale of ["vi", "en"] as const) {
      setLocale(locale);
      for (const effect of EFFECTS) {
        expect(t(`effects.${effect.id}`)).not.toBe(`effects.${effect.id}`);
      }
      for (const event of EVENTS) {
        expect(t(`events.${event.id}`)).not.toBe(`events.${event.id}`);
        expect(t(`events.${event.id}.desc`)).not.toBe(`events.${event.id}.desc`);
      }
    }
    setLocale("vi");
  });
});
