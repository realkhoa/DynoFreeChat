// @vitest-environment jsdom
/**
 * @file i18n.spec.ts
 * @brief Locale preference, dictionary lookup and duration formatting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACHIEVEMENTS,
  ANIMALS,
  DAILY_QUESTS,
  EFFECTS,
  EVENTS,
  FERTILIZERS,
  MACHINES,
  PET_RARITY_ODDS,
  PETS,
  PRODUCTS,
  SEEDS,
  SPRAYS,
  TOOLS,
  TREES,
} from "@dyno/shared/garden";
import { DICTIONARIES } from "@/shared/i18n/dictionary";
import {
  detectLocale,
  formatCompact,
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
    expect(t("tabs.garden")).toBe("vườn");
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

  it("shortens long amounts with m, b and t", () => {
    expect(formatCompact(999_999)).toBe(formatNumber(999_999));
    expect(formatCompact(3_000_000)).toBe("3m");
    expect(formatCompact(12_345_678)).toBe("12.3m");
    expect(formatCompact(1_500_000_000)).toBe("1.5b");
    expect(formatCompact(2_225_901_652_616)).toBe("2.23t");
    expect(formatCompact(-2_000_000)).toBe("-2m");
    expect(formatCompact(2_500_000_000_000_000)).toBe("2.5q");
    expect(formatCompact(1_200_000_000_000_000_000)).toBe("1.2Q");
    expect(formatCompact(3e21)).toBe("3sx");
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

/** Walks every .ts file under a directory. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("dictionary completeness", () => {
  const vi = DICTIONARIES.vi as Record<string, string>;
  const en = DICTIONARIES.en as Record<string, string>;

  it("keeps both locales in sync with non-empty strings", () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(vi)) {
      expect(value.trim(), `vi ${key}`).not.toBe("");
      expect(en[key]?.trim(), `en ${key}`).not.toBe("");
    }
  });

  it("translates every catalog id", () => {
    const keys: string[] = [];
    for (const seed of SEEDS) keys.push(`seeds.${seed.id}`, `seeds.${seed.id}.short`);
    for (const tree of TREES) keys.push(`trees.${tree.id}`, `trees.${tree.id}.short`);
    for (const effect of EFFECTS) keys.push(`effects.${effect.id}`);
    for (const event of EVENTS) keys.push(`events.${event.id}`, `events.${event.id}.desc`);
    for (const supply of [...FERTILIZERS, ...SPRAYS]) keys.push(`supplies.${supply.id}`);
    for (const tool of TOOLS) keys.push(`tools.${tool.id}`);
    for (const animal of ANIMALS) keys.push(`animals.${animal.id}`);
    for (const product of PRODUCTS) keys.push(`products.${product.id}`);
    for (const machine of MACHINES) keys.push(`machines.${machine.id}`);
    for (const pet of PETS) keys.push(`pets.${pet.id}`);
    for (const rarity of Object.keys(PET_RARITY_ODDS)) keys.push(`petRarity.${rarity}`);
    for (const achievement of ACHIEVEMENTS) keys.push(`achievements.${achievement.id}`);
    for (const quest of DAILY_QUESTS) keys.push(`quests.${quest.id}`);
    for (const skill of ["farming", "ranching", "artisaning"]) {
      keys.push(`skills.${skill}`, `skills.${skill}.desc`);
    }
    for (const trait of ["lazy", "slow", "clumsy", "greedy", "diligent", "greenThumb"]) {
      keys.push(`staffTrait.${trait}`);
    }
    for (const role of ["gardener", "waterer"]) keys.push(`staffRole.${role}`);
    for (const tab of [
      "garden",
      "market",
      "event",
      "chart",
      "bots",
      "rank",
      "farm",
      "warehouse",
      "extras",
      "levels",
    ]) {
      keys.push(`tabs.${tab}`);
    }
    for (const phase of ["day", "dusk", "night", "dawn"]) keys.push(`phase.${phase}`);

    for (const key of keys) {
      expect(vi[key], `vi ${key}`).toBeTruthy();
      expect(en[key], `en ${key}`).toBeTruthy();
    }
  });

  it("translates every literal t() key used by the web app", () => {
    const source = sourceFiles(resolve(process.cwd(), "src")).filter(
      (path) => !path.endsWith("dictionary.ts"),
    );
    const keys = new Set<string>();
    for (const path of source) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/\bt\(\s*["'`]([^"'`$]+)["'`]/g)) {
        if (match[1] !== undefined) keys.add(match[1]);
      }
    }
    for (const key of keys) {
      expect(vi[key], `vi ${key}`).toBeTruthy();
      expect(en[key], `en ${key}`).toBeTruthy();
    }
  });

  it("translates every garden error code", () => {
    const path = resolve(process.cwd(), "../shared/src/garden.ts");
    const text = readFileSync(path, "utf8");
    const block = text.match(/export type GardenErrorCode =([\s\S]*?);/);
    expect(block).not.toBeNull();
    const codes = [...(block?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(vi[`errors.${code}`], `vi errors.${code}`).toBeTruthy();
      expect(en[`errors.${code}`], `en errors.${code}`).toBeTruthy();
    }
  });
});
