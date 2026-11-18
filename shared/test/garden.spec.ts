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
  PLOT_COUNT,
  RECOVERY_RE,
  SEEDS,
  SHOP_RESTOCK_MS,
  STARTING_COINS,
  STARTING_PLOTS,
  createRng,
  cropKey,
  cropSellPrice,
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
  rollEffect,
  seasonAt,
  seedById,
  unlockCost,
  type PlotState,
} from "../src/garden";

/** Fixed server time used across the deterministic tests. */
const NOW = EPOCH_MS + 12 * EVENT_WAVE_MS + 1_000;

describe("garden catalog", () => {
  it("ships four seeds with unique ids and four art stages each", () => {
    const ids = SEEDS.map((seed) => seed.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["carrot", "tomato", "corn", "pumpkin"]);
    for (const seed of SEEDS) {
      expect(seed.art).toHaveLength(4);
      expect(seed.growMs).toBeGreaterThan(0);
      expect(seed.sell).toBeGreaterThan(seed.buy);
    }
  });

  it("keeps the unlock ladder monotonic", () => {
    for (let slot = STARTING_PLOTS; slot < PLOT_COUNT; slot += 1) {
      expect(unlockCost(slot)).toBeGreaterThan(unlockCost(slot - 1));
    }
  });

  it("starts a garden with the documented defaults", () => {
    expect(STARTING_COINS).toBe(30);
    expect(STARTING_PLOTS).toBe(4);
    expect(PLOT_COUNT).toBe(9);
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
      effect: null,
      watered: false,
      fertilized: false,
    };
    expect(plotView(plot, 1_000).stage).toBe(0);
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
    expect(rollEffect(goldenHour, () => 0.01)).toBe("golden");
    expect(rollEffect(goldenHour, () => 0.1)).toBe("golden");
    expect(rollEffect(frost, () => 0.05)).toBe("frozen");
    expect(rollEffect(frost, () => 0.5)).toBeNull();
  });

  it("counts plots and prices crop stacks", () => {
    const season = seasonAt(NOW);
    const plots: Array<PlotState | null> = new Array(PLOT_COUNT).fill(null);
    plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: 0,
      readyAt: NOW,
      effect: "golden",
      watered: false,
      fertilized: false,
    };
    plots[1] = {
      slot: 1,
      seed: "corn",
      plantedAt: NOW,
      readyAt: NOW + 60_000,
      effect: null,
      watered: false,
      fertilized: false,
    };
    expect(gardenCounts(plots, 4, NOW)).toEqual({ ready: 1, growing: 1, free: 2, locked: 5 });
    expect(cropSellPrice({ seed: "carrot", effect: "golden", qty: 1 }, season)).toBe(
      season.prices.carrot * 5,
    );
  });
});

describe("garden wire parsing", () => {
  it("round-trips crop bag keys", () => {
    expect(cropKey("tomato", "wet")).toBe("tomato:wet");
    expect(parseCropKey("tomato:wet")).toEqual({ seed: "tomato", effect: "wet" });
    expect(parseCropKey("corn")).toEqual({ seed: "corn", effect: null });
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
    expect(parseGardenAction({ kind: "water", slot: 8 })).toEqual({ kind: "water", slot: 8 });
    expect(parseGardenAction({ kind: "water", slot: 9 })).toBeNull();
    expect(parseGardenAction({ kind: "plant", slot: 0, seed: "nope" })).toBeNull();
    expect(parseGardenAction({ kind: "buySeed", seed: "corn", qty: 0 })).toBeNull();
    expect(parseGardenAction({ kind: "sellCrop", seed: "corn", effect: "wet", qty: 2 })).toEqual({
      kind: "sellCrop",
      seed: "corn",
      effect: "wet",
      qty: 2,
    });
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
