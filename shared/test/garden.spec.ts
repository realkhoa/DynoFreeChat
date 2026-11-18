/**
 * @file garden.spec.ts
 * @brief Deterministic season, catalog and wire-parsing rules for ASCII Garden.
 * @details "Consistent seeds and events" is a property of these pure functions,
 * so the tests pin them without a Worker or a browser.
 */

import { describe, expect, it } from "vitest";
import {
  EPOCH_MS,
  EVENTS,
  EVENT_WAVE_MS,
  GARDEN_AUTH_HEADER,
  CROPS_PER_TAB,
  MAX_TABS,
  TAB_BASE_PRICE,
  TAB_PRICE_FACTOR,
  TREES_PER_TAB,
  PLOTS_PER_PATCH,
  RECOVERY_RE,
  SEEDS,
  SHOP_RESTOCK_MS,
  STARTING_COINS,
  STARTING_TABS,
  createRng,
  cropKey,
  cropSellPrice,
  effectById,
  eventAt,
  formatGardenAuth,
  gardenCounts,
  growTimeFor,
  hash32,
  isGardenCode,
  isRecoveryKey,
  parseCropKey,
  parseGardenAction,
  parseGardenAuth,
  plotView,
  rollEffects,
  FERTILIZERS,
  SPRAYS,
  TREES,
  fertilizerById,
  nextTabPrice,
  sprayById,
  supplyById,
  seasonAt,
  seedById,
  totalCrops,
  treeById,
  type PlotState,
} from "../src/garden";

/** Fixed server time used across the deterministic tests. */
const NOW = EPOCH_MS + 12 * EVENT_WAVE_MS + 1_000;

describe("garden catalog", () => {
  it("ships four seeds with unique ids and four art stages each", () => {
    const ids = SEEDS.map((seed) => seed.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "carrot",
      "parsnip",
      "potato",
      "sunflower",
      "lavender",
      "cauliflower",
      "cucumber",
      "tomato",
      "strawberry",
      "corn",
      "hop",
      "blueberry",
      "pumpkin",
      "watermelon",
      "pineapple",
      "pitcher",
    ]);
    for (const seed of SEEDS) {
      expect(seed.art).toHaveLength(4);
      expect(seed.growMs).toBeGreaterThan(0);
      expect(seed.sell).toBeGreaterThan(seed.buy);
    }
  });

  it("ships fertilizers and sprays with their shop data", () => {
    expect(FERTILIZERS).toHaveLength(3);
    expect(SPRAYS).toHaveLength(4);
    expect(fertilizerById("speedGrow")?.growMultiplier).toBeLessThan(1);
    expect(fertilizerById("superGrow")?.harvests).toBe(4);
    expect(sprayById("goldenSpray")?.effectChances.golden).toBe(0.15);
    expect(supplyById("compost")?.price).toBe(25);
    expect(supplyById("unknown")).toBeUndefined();
  });

  it("prices each new tab on the compounding ladder", () => {
    expect(nextTabPrice(1)).toBe(TAB_BASE_PRICE);
    expect(nextTabPrice(2)).toBe(TAB_BASE_PRICE * TAB_PRICE_FACTOR);
    expect(nextTabPrice(3)).toBe(TAB_BASE_PRICE * TAB_PRICE_FACTOR ** 2);
  });

  it("marks reharvest plants apart from root crops", () => {
    expect(seedById("tomato")?.regrow).toBe(true);
    expect(seedById("corn")?.regrow).toBe(true);
    expect(seedById("pumpkin")?.regrow).toBe(true);
    expect(seedById("cucumber")?.regrow).toBe(true);
    expect(seedById("carrot")?.regrow).toBe(false);
    expect(seedById("parsnip")?.regrow).toBe(false);
    expect(seedById("cauliflower")?.regrow).toBe(false);
    expect(seedById("watermelon")?.regrow).toBe(true);
    expect(seedById("pineapple")?.regrow).toBe(true);
    expect(seedById("pitcher")?.regrow).toBe(true);
    expect(seedById("potato")?.regrow).toBe(false);
    expect(seedById("sunflower")?.regrow).toBe(false);
    expect(seedById("lavender")?.regrow).toBe(false);
  });

  it("starts a garden with one tab of nine 3x3 patches", () => {
    expect(STARTING_COINS).toBe(30);
    expect(STARTING_TABS).toBe(1);
    expect(PLOTS_PER_PATCH).toBe(9);
    expect(CROPS_PER_TAB).toBe(81);
    expect(TREES_PER_TAB).toBe(27);
    expect(MAX_TABS).toBe(4);
    expect(totalCrops(STARTING_TABS)).toBe(CROPS_PER_TAB);
  });
});

describe("garden season", () => {
  it("returns identical offers, prices and event for the same instant", () => {
    expect(seasonAt(NOW)).toEqual(seasonAt(NOW));
  });

  it("walks the event list in order", () => {
    const seen = new Set<string>();
    for (let wave = 0; wave < EVENTS.length; wave += 1) {
      const snapshot = seasonAt(EPOCH_MS + wave * EVENT_WAVE_MS + 12);
      seen.add(snapshot.event.id);
      expect(snapshot.event.startedAt).toBe(EPOCH_MS + wave * EVENT_WAVE_MS);
      expect(snapshot.event.endsAt).toBe(EPOCH_MS + (wave + 1) * EVENT_WAVE_MS);
    }
    expect(seen.size).toBe(EVENTS.length);
  });

  it("keeps the same wave across one window and changes at the boundary", () => {
    const start = EPOCH_MS + 3 * EVENT_WAVE_MS;
    expect(seasonAt(start).wave).toBe(3);
    expect(seasonAt(start + EVENT_WAVE_MS - 1).wave).toBe(3);
    expect(seasonAt(start + EVENT_WAVE_MS).wave).toBe(4);
  });

  it("rotates the seed shop on the restock cadence", () => {
    const a = seasonAt(NOW).shop;
    const b = seasonAt(NOW + SHOP_RESTOCK_MS).shop;
    expect(a.offers).toHaveLength(SEEDS.length);
    expect(a.restockAt).toBeGreaterThan(NOW);
    expect(a.offers).not.toEqual(b.offers);
    for (const offer of a.offers) {
      expect(offer.price).toBeGreaterThanOrEqual(1);
      expect(offer.stock).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps exchange prices inside the documented drift band", () => {
    const season = seasonAt(NOW);
    for (const seed of SEEDS) {
      const event = eventAt(NOW);
      const low = seed.sell * 0.85 * event.sellBonus - 1;
      const high = seed.sell * 1.15 * event.sellBonus + 1;
      expect(season.prices[seed.id]).toBeGreaterThanOrEqual(Math.max(1, Math.floor(low)));
      expect(season.prices[seed.id]).toBeLessThanOrEqual(Math.ceil(high));
    }
  });

  it("exposes the next window for the client countdown", () => {
    const season = seasonAt(NOW);
    expect(season.next.startedAt).toBe(season.event.endsAt);
    expect(season.next.endsAt).toBe(season.event.endsAt + EVENT_WAVE_MS);
  });
});

describe("garden growth math", () => {
  it("walks seed, sprout, young, ripe", () => {
    const seed = seedById("carrot");
    expect(seed).toBeDefined();
    if (seed === undefined) return;
    const plot: PlotState = {
      slot: 0,
      seed: "carrot",
      plantedAt: 1_000,
      readyAt: 1_000 + seed.growMs,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
    };
    expect(plotView(plot, 1_000).stage).toBe(0);
    expect(plotView(plot, 1_000).effects).toEqual([]);
    expect(plotView(plot, 1_000 + seed.growMs * 0.4).stage).toBe(1);
    expect(plotView(plot, 1_000 + seed.growMs * 0.8).stage).toBe(2);
    expect(plotView(plot, 1_000 + seed.growMs).ready).toBe(true);
    expect(plotView(plot, 1_000 + seed.growMs).stage).toBe(3);
    expect(plotView(plot, 1_000 + seed.growMs).remainingMs).toBe(0);
  });

  it("speeds up under rain and slows under frost", () => {
    const seed = seedById("tomato");
    if (seed === undefined) throw new Error("catalog");
    const rain = growTimeFor(seed, eventAt(EPOCH_MS + EVENT_WAVE_MS));
    const frost = growTimeFor(seed, eventAt(EPOCH_MS + 3 * EVENT_WAVE_MS));
    expect(rain).toBeLessThan(seed.growMs);
    expect(frost).toBeGreaterThan(seed.growMs);
  });

  it("rolls golden and frozen from the event chances deterministically", () => {
    const goldenHour = eventAt(EPOCH_MS + 2 * EVENT_WAVE_MS);
    const frost = eventAt(EPOCH_MS + 3 * EVENT_WAVE_MS);
    expect(rollEffects(goldenHour, () => 0.01)).toEqual(["golden", "frozen"]);
    expect(rollEffects(goldenHour, () => 0.1)).toEqual(["golden"]);
    expect(rollEffects(frost, () => 0.05)).toEqual(["frozen"]);
    expect(rollEffects(frost, () => 0.5)).toEqual([]);
  });

  it("rolls the new weather effects during their own event", () => {
    const snowfall = eventAt(EPOCH_MS + 5 * EVENT_WAVE_MS + 100);
    expect(snowfall.id).toBe("snowfall");
    expect(rollEffects(snowfall, () => 0.1)).toEqual(["snow"]);

    const coldSnap = eventAt(EPOCH_MS + 6 * EVENT_WAVE_MS + 100);
    expect(rollEffects(coldSnap, () => 0.1)).toEqual(["chill"]);

    const heatwave = eventAt(EPOCH_MS + 7 * EVENT_WAVE_MS + 100);
    expect(rollEffects(heatwave, () => 0.1)).toEqual(["sunray"]);

    const drought = eventAt(EPOCH_MS + 9 * EVENT_WAVE_MS + 100);
    expect(rollEffects(drought, () => 0.1)).toEqual(["cracked"]);

    const wildfire = eventAt(EPOCH_MS + 10 * EVENT_WAVE_MS + 100);
    expect(rollEffects(wildfire, () => 0.05)).toEqual(["onfire"]);

    // A calm sky still leaves most plantings plain.
    expect(rollEffects(eventAt(EPOCH_MS + 100), () => 0.9)).toEqual([]);
  });

  it("keeps every weather effect rollable except water", () => {
    expect(effectById("wet")?.natural).toBe(false);
    for (const id of [
      "golden",
      "frozen",
      "snow",
      "chill",
      "sunray",
      "smoked",
      "cracked",
      "onfire",
    ] as const) {
      expect(effectById(id)?.natural).toBe(true);
    }
    expect(effectById("onfire")?.multiplier).toBe(6);
  });

  it("counts plots and prices crop stacks", () => {
    const season = seasonAt(NOW);
    const plots: Array<PlotState | null> = new Array(totalCrops(1)).fill(null);
    plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: 0,
      readyAt: NOW,
      effects: ["golden"],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
    };
    plots[1] = {
      slot: 1,
      seed: "corn",
      plantedAt: NOW,
      readyAt: NOW + 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
    };
    expect(gardenCounts(plots, [], NOW)).toEqual({ ready: 1, growing: 1, free: 79 });
    expect(cropSellPrice({ item: "carrot", effects: ["golden"], qty: 1 }, season)).toBe(
      season.prices.carrot * 5,
    );
  });
});

describe("garden wire parsing", () => {
  it("ships seven fruit trees and prices their fruit", () => {
    expect(TREES).toHaveLength(7);
    expect(TREES.map((tree) => tree.id)).toEqual([
      "apple",
      "grape",
      "orange",
      "plum",
      "apricot",
      "coconut",
      "elderberry",
    ]);
    expect(treeById("apple")?.sell).toBeGreaterThan(treeById("apple")?.buy ?? 0);
    const season = seasonAt(NOW);
    expect(cropSellPrice({ item: "apple", effects: [], qty: 1 }, season)).toBe(season.fruitPrices.apple);
    expect(cropSellPrice({ item: "apple", effects: ["golden"], qty: 1 }, season)).toBe(
      season.fruitPrices.apple * 5,
    );
  });

  it("parses tree actions and round-trips fruit bag keys", () => {
    expect(parseGardenAction({ kind: "plantTree", slot: 0, tree: "apple" })).toEqual({
      kind: "plantTree",
      slot: 0,
      tree: "apple",
    });
    expect(parseGardenAction({ kind: "harvest", slot: 0, tree: true })).toEqual({
      kind: "harvest",
      slot: 0,
      tree: true,
    });
    expect(parseGardenAction({ kind: "plantTree", slot: 0, tree: "nope" })).toBeNull();
    expect(cropKey("apple", ["wet"])).toBe("apple:wet");
    expect(parseCropKey("apple:wet")).toEqual({ item: "apple", effects: ["wet"] });
    expect(parseCropKey("apple")).toEqual({ item: "apple", effects: [] });
  });

  it("round-trips crop bag keys", () => {
    expect(cropKey("tomato", ["wet"])).toBe("tomato:wet");
    expect(parseCropKey("tomato:wet")).toEqual({ item: "tomato", effects: ["wet"] });
    expect(parseCropKey("corn")).toEqual({ item: "corn", effects: [] });
    expect(parseCropKey("unknown:wet")).toBeNull();
    expect(parseCropKey("tomato:nope")).toBeNull();
  });

  it("round-trips the owner auth header", () => {
    const credentials = {
      playerId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      token: "a".repeat(64),
    };
    const raw = formatGardenAuth(credentials);
    expect(raw.startsWith(`${credentials.playerId}.`)).toBe(true);
    expect(parseGardenAuth(raw)).toEqual(credentials);
    expect(parseGardenAuth(null)).toBeNull();
    expect(parseGardenAuth("not-a-player.token")).toBeNull();
    expect(parseGardenAuth(`${credentials.playerId}.short`)).toBeNull();
    expect(GARDEN_AUTH_HEADER).toBe("x-dyno-garden");
  });

  it("recognises share codes and recovery keys", () => {
    expect(isGardenCode("G7K2QX")).toBe(true);
    expect(isGardenCode("g7k2qx")).toBe(false);
    expect(isGardenCode("G7K2Q")).toBe(false);
    expect(RECOVERY_RE.test("ABCD-EFGH-JKMN")).toBe(true);
    expect(isRecoveryKey("ABCD-EFGH-JKMN")).toBe(true);
    expect(isRecoveryKey("ABCD-EFGH-IJKL")).toBe(false);
  });

  it("validates actions and rejects malformed ones", () => {
    expect(parseGardenAction({ kind: "plant", slot: 0, seed: "carrot" })).toEqual({
      kind: "plant",
      slot: 0,
      seed: "carrot",
    });
    expect(parseGardenAction({ kind: "water", slot: 8 })).toEqual({
      kind: "water",
      slot: 8,
      tree: false,
    });
    expect(parseGardenAction({ kind: "water", slot: 80, tree: true })).toEqual({
      kind: "water",
      slot: 80,
      tree: true,
    });
    expect(parseGardenAction({ kind: "water", slot: 324 })).toBeNull();
    expect(parseGardenAction({ kind: "water", slot: 108, tree: true })).toBeNull();
    expect(parseGardenAction({ kind: "plant", slot: 0, seed: "nope" })).toBeNull();
    expect(parseGardenAction({ kind: "buySeed", seed: "corn", qty: 0 })).toBeNull();
    expect(parseGardenAction({ kind: "sellCrop", item: "corn", effects: ["wet"], qty: 2 })).toEqual({
      kind: "sellCrop",
      item: "corn",
      effects: ["wet"],
      qty: 2,
    });
    expect(parseGardenAction({ kind: "fertilize", slot: 0, tree: false, supply: "speedGrow" })).toEqual({
      kind: "fertilize",
      slot: 0,
      tree: false,
      supply: "speedGrow",
    });
    expect(parseGardenAction({ kind: "spray", slot: 0, tree: true, supply: "snowSpray" })).toEqual({
      kind: "spray",
      slot: 0,
      tree: true,
      supply: "snowSpray",
    });
    expect(parseGardenAction({ kind: "fertilize", slot: 0, tree: false, supply: "nope" })).toBeNull();
    expect(parseGardenAction({ kind: "buySupply", supply: "compost", qty: 2 })).toEqual({
      kind: "buySupply",
      supply: "compost",
      qty: 2,
    });
    expect(parseGardenAction({ kind: "buyTab" })).toEqual({ kind: "buyTab" });
    expect(parseGardenAction({ kind: "sellAll" })).toEqual({ kind: "sellAll" });
    expect(parseGardenAction({ kind: "explode" })).toBeNull();
  });

  it("keeps the hash and rng deterministic", () => {
    expect(hash32("garden")).toBe(hash32("garden"));
    const first = createRng(7);
    const second = createRng(7);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });
});
