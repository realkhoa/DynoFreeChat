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
  CROP_PATCHES_PER_TAB,
  CROPS_PER_TAB,
  MAX_TABS,
  TREES_PER_TAB,
  PLOTS_PER_PATCH,
  RECOVERY_RE,
  SEEDS,
  SHOP_RESTOCK_MS,
  TOOLS,
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
  MARKET_BUY_MAX,
  MARKET_MAX_MULTIPLIER,
  MARKET_MIN_MULTIPLIER,
  applyBuyMarket,
  applyMarket,
  marketBaseItems,
  marketBuyBaseItems,
  marketCycleAt,
  marketCycleEndsAt,
  nextBuyMultiplier,
  nextPatchPrice,
  combinedGrowScale,
  ANIMALS,
  BUILDINGS,
  FARM_CYCLE_MS,
  animalQuality,
  buildingSlots,
  eventsAt,
  nextSellState,
  productPrice,
  nextTabPrice,
  rollEffectsFor,
  resolvedCropEffects,
  weatherEffects,
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
    // A tab costs the last (ninth) 3x3 patch: 5,000 * 2^7 = 640,000.
    expect(nextTabPrice(1)).toBe(640_000);
    expect(nextTabPrice(2)).toBe(640_000);
    expect(nextTabPrice(1)).toBe(nextPatchPrice(CROP_PATCHES_PER_TAB - 1));
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

describe("weather effect stacking", () => {
  it("adds one roll per weather wave during growth and is deterministic", () => {
    const plantedAt = EPOCH_MS + EVENT_WAVE_MS + 1_000;
    const until = plantedAt + EVENT_WAVE_MS * 3;
    const first = weatherEffects("tomato", 5, plantedAt, until);
    const second = weatherEffects("tomato", 5, plantedAt, until);
    expect(first).toEqual(second);
    for (const id of first) expect(effectById(id)).toBeDefined();
    expect(new Set(first).size).toBe(first.length);
  });

  it("lets a crop accumulate weather on top of manual effects", () => {
    const plantedAt = EPOCH_MS + EVENT_WAVE_MS + 1_000;
    const readyAt = plantedAt + EVENT_WAVE_MS * 4;
    const plot = {
      slot: 0,
      seed: "tomato" as const,
      plantedAt,
      readyAt,
      effects: ["wet" as const],
      watered: true,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
    };
    const resolved = resolvedCropEffects(plot, readyAt + 10_000);
    expect(resolved).toContain("wet");
    for (const id of weatherEffects("tomato", 0, plantedAt, readyAt)) {
      expect(resolved).toContain(id);
    }
  });
});

describe("farm buildings", () => {
  it("has a four-to-twelve slot ladder for both buildings", () => {
    for (const building of BUILDINGS) {
      expect(building.slots[0]).toBe(4);
      expect(building.slots.at(-1)).toBe(12);
      expect(building.slots).toHaveLength(4);
      expect(buildingUpgradeCostForTest(building.id)).toBe(building.upgrade);
    }
    expect(buildingSlots("coop", 0)).toBe(0);
    expect(buildingSlots("coop", 1)).toBe(4);
    expect(buildingSlots("coop", 4)).toBe(12);
  });

  it("raises animal quality with age and pats, and doubles product value", () => {
    const animal = { kind: "chicken" as const, bornAt: EPOCH_MS, pats: 0, lastProduceAt: EPOCH_MS };
    expect(animalQuality(animal, EPOCH_MS)).toBe(1);
    const aged = { ...animal, pats: 12 };
    expect(animalQuality(aged, EPOCH_MS + 24 * FARM_CYCLE_MS)).toBe(4);
    const season = seasonAt(EPOCH_MS);
    const one = productPrice({ product: "egg", star: 1, qty: 1 }, season);
    const three = productPrice({ product: "egg", star: 3, qty: 1 }, season);
    expect(three).toBeGreaterThan(one);
    expect(ANIMALS.some((entry) => entry.product === "wool" && entry.intervalCycles === 7)).toBe(true);
  });
});

// Small local helper so the test does not import another symbol by mistake.
function buildingUpgradeCostForTest(id: "coop" | "barn"): number {
  return BUILDINGS.find((building) => building.id === id)?.upgrade ?? 0;
}

describe("rare tools", () => {
  it("appears in fewer than twenty percent of restocks", () => {
    const restock = Math.floor((EPOCH_MS - EPOCH_MS) / SHOP_RESTOCK_MS);
    let withTool = 0;
    const samples = 300;
    for (let index = 0; index < samples; index += 1) {
      const at = EPOCH_MS + (restock + index) * SHOP_RESTOCK_MS + 1_000;
      if (seasonAt(at).shop.tools.length > 0) withTool += 1;
    }
    expect(withTool / samples).toBeLessThan(0.25);
    expect(TOOLS[0]?.price).toBe(1_000_000);
  });
});

describe("market pressure", () => {
  it("keeps light supply unchanged and cuts heavier supply", () => {
    expect(nextSellState(1, 0, 2)).toEqual({ multiplier: 1, emptyCycles: 0 });
    expect(nextSellState(1, 0, 5).multiplier).toBeCloseTo(0.95);
    expect(nextSellState(1, 0, 20).multiplier).toBeCloseTo(0.75);
  });

  it("raises sell prices only after two empty cycles in a row", () => {
    const first = nextSellState(1, 0, 0);
    expect(first).toEqual({ multiplier: 1, emptyCycles: 1 });
    const second = nextSellState(first.multiplier, first.emptyCycles, 0);
    expect(second).toEqual({ multiplier: 1, emptyCycles: 2 });
    const third = nextSellState(second.multiplier, second.emptyCycles, 0);
    expect(third.multiplier).toBeCloseTo(1.2);
    expect(third.emptyCycles).toBe(3);
  });

  it("clamps sell multipliers between -70% and +500%", () => {
    expect(nextSellState(0.31, 3, 40).multiplier).toBe(MARKET_MIN_MULTIPLIER);
    expect(nextSellState(5.9, 3, 0).multiplier).toBe(MARKET_MAX_MULTIPLIER);
  });

  it("raises buy prices on volume and decays quietly back to base", () => {
    expect(nextBuyMultiplier(1, 20)).toBeCloseTo(1.1);
    expect(nextBuyMultiplier(1.1, 20)).toBeCloseTo(1.21);
    expect(nextBuyMultiplier(1, 2)).toBe(1);
    expect(nextBuyMultiplier(2, 2)).toBeCloseTo(1.9);
    expect(nextBuyMultiplier(3, 20)).toBe(MARKET_BUY_MAX);
  });

  it("applies sell and buy pressure to a season", () => {
    const season = seasonAt(EPOCH_MS);
    const pressured = applyMarket(season, { carrot: 2, apple: 0.5 });
    expect(pressured.prices.carrot).toBe(Math.max(1, Math.round((season.prices.carrot ?? 0) * 2)));
    expect(pressured.fruitPrices.apple).toBe(Math.max(1, Math.round((season.fruitPrices.apple ?? 0) * 0.5)));
    expect(pressured.prices.tomato).toBe(season.prices.tomato);

    const bases = marketBuyBaseItems(pressured);
    const carrotBase = bases.find((row) => row.item === "carrot")?.base ?? 0;
    const compostBase = bases.find((row) => row.item === "compost")?.base ?? 0;
    const buying = applyBuyMarket(pressured, { carrot: 1.5, compost: 2 });
    expect(buying.buyPrices?.carrot).toBe(Math.round(carrotBase * 1.5));
    expect(buying.buyPrices?.compost).toBe(Math.round(compostBase * 2));
  });

  it("lists every sellable and buyable item with a base price", () => {
    expect(marketBaseItems(seasonAt(EPOCH_MS))).toHaveLength(SEEDS.length + TREES.length);
    expect(marketBuyBaseItems(seasonAt(EPOCH_MS))).toHaveLength(SEEDS.length + 7);
  });

  it("uses six-minute aligned cycles", () => {
    expect(marketCycleEndsAt(EPOCH_MS)).toBe(EPOCH_MS + 6 * 60_000);
    expect(marketCycleAt(EPOCH_MS + 6 * 60_000)).toBe(marketCycleAt(EPOCH_MS) + 1);
  });
});

describe("garden season", () => {
  it("returns identical offers, prices and event for the same instant", () => {
    expect(seasonAt(NOW)).toEqual(seasonAt(NOW));
  });

  it("rolls one to three simultaneous events, one being the most common", () => {
    const counts = new Map<number, number>();
    for (let wave = 0; wave < 120; wave += 1) {
      const at = EPOCH_MS + wave * EVENT_WAVE_MS + 12;
      const events = eventsAt(at);
      expect(events).toEqual(eventsAt(at));
      expect(events.length).toBeLessThanOrEqual(3);
      expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
      for (const event of events) expect(event.id).not.toBe("calm");
      const order = EVENTS.map((event) => event.id);
      const indices = events.map((event) => order.indexOf(event.id));
      expect([...indices].sort((a, b) => a - b)).toEqual(indices);
      counts.set(events.length, (counts.get(events.length) ?? 0) + 1);
    }
    expect(counts.get(1) ?? 0).toBeGreaterThan(counts.get(0) ?? 0);
    expect(counts.get(1) ?? 0).toBeGreaterThan(counts.get(2) ?? 0);
  });

  it("exposes the whole active event set on the season", () => {
    const waveStart = EPOCH_MS + 5 * EVENT_WAVE_MS;
    const snapshot = seasonAt(waveStart + 12);
    expect(snapshot.events).toHaveLength(eventsAt(waveStart).length);
    expect(snapshot.event.id).toBe(snapshot.events[0]?.id ?? "calm");
    expect(snapshot.event.startedAt).toBe(waveStart);
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
    const rain = EVENTS.find((event) => event.id === "rain");
    const frost = EVENTS.find((event) => event.id === "frost");
    if (rain === undefined || frost === undefined) throw new Error("catalog");
    expect(growTimeFor(seed, rain)).toBeLessThan(seed.growMs);
    expect(growTimeFor(seed, frost)).toBeGreaterThan(seed.growMs);
    expect(combinedGrowScale([rain, frost])).toBeCloseTo(rain.growScale * frost.growScale, 6);
  });

  it("rolls golden and frozen from the event chances deterministically", () => {
    const goldenHour = EVENTS.find((event) => event.id === "goldenHour");
    const frost = EVENTS.find((event) => event.id === "frost");
    if (goldenHour === undefined || frost === undefined) throw new Error("catalog");
    expect(rollEffects(goldenHour, () => 0.01)).toEqual(["golden", "frozen"]);
    expect(rollEffects(goldenHour, () => 0.1)).toEqual(["golden"]);
    expect(rollEffects(frost, () => 0.05)).toEqual(["frozen"]);
    expect(rollEffects(frost, () => 0.5)).toEqual([]);
  });

  it("rolls the new weather effects during their own event", () => {
    const byId = (id: string): (typeof EVENTS)[number] => {
      const event = EVENTS.find((entry) => entry.id === id);
      if (event === undefined) throw new Error(`catalog ${id}`);
      return event;
    };
    expect(rollEffects(byId("snowfall"), () => 0.1)).toEqual(["snow"]);
    expect(rollEffects(byId("coldSnap"), () => 0.1)).toEqual(["chill"]);
    expect(rollEffects(byId("heatwave"), () => 0.1)).toEqual(["sunray"]);
    expect(rollEffects(byId("drought"), () => 0.1)).toEqual(["cracked"]);
    expect(rollEffects(byId("wildfire"), () => 0.05)).toEqual(["onfire"]);

    // Several events can roll their effects in one go.
    expect(rollEffectsFor([byId("snowfall"), byId("coldSnap")], () => 0.1)).toEqual(["snow", "chill"]);
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
