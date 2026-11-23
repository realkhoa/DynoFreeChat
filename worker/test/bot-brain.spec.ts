/**
 * @file bot-brain.spec.ts
 * @brief Bot heuristics: uprooting losing crops and honouring the carrot focus.
 */

import { describe, expect, it } from "vitest";
import { EPOCH_MS, EVENT_WAVE_MS, SEEDS, seasonAt, type PlotState, type SeedId } from "@dyno/shared/garden";
import { createLedger } from "../src/garden-rules";
import { bestBotSeed, planBotActions } from "../src/bot-brain";

const NOW = EPOCH_MS + 2 * EVENT_WAVE_MS + 1_000;

/** Builds one ledger for the heuristic. */
function makeLedger() {
  return createLedger({
    playerId: "bot-brain",
    nick: "Bot",
    color: "#4ec9b0",
    code: "ABCDEF",
    tokenHash: "a".repeat(64),
    recoveryHash: "b".repeat(64),
    now: NOW,
  });
}

/** One weak, infested, just-planted crop. */
function weakPlot(slot: number, seed: SeedId): PlotState {
  return {
    slot,
    seed,
    // Planted exactly now: no weather wave can roll a mutation onto it.
    plantedAt: NOW,
    readyAt: NOW + 600_000,
    effects: [],
    pest: true,
    protectedUntil: 0,
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
  };
}

describe("bot brain", () => {
  it("uproots a crop that would sell at a loss", () => {
    const ledger = makeLedger();
    ledger.coins = 50_000;
    ledger.bag.seeds = { carrot: 3 };
    // A shriveled, pest-damaged carrot is worth less than its seed even when a
    // market-boom wave lifts prices, so the bot must free the slot.
    ledger.plots[0] = { ...weakPlot(0, "carrot"), effects: ["shriveled"] };
    const actions = planBotActions(ledger, seasonAt(NOW), NOW, () => 0.5);
    expect(actions.some((action) => action.kind === "uproot" && action.slot === 0)).toBe(true);
    // It either replants an owned seed or buys a better one for the freed slot.
    expect(actions.some((action) => action.kind === "plant" || action.kind === "buySeed")).toBe(true);
  });

  it("does not uproot a profitable non-carrot crop", () => {
    const ledger = makeLedger();
    ledger.coins = 50_000;
    ledger.bag.seeds = { carrot: 3 };
    ledger.plots[0] = { ...weakPlot(0, "tomato"), pest: false, plantedAt: NOW - 500 };
    const actions = planBotActions(ledger, seasonAt(NOW), NOW, () => 0.5, 12, "carrot");
    expect(actions.some((action) => action.kind === "uproot")).toBe(false);
  });

  it("does not uproot a profitable but suboptimal crop", () => {
    const ledger = makeLedger();
    ledger.coins = 50_000;
    ledger.bag.seeds = { carrot: 3 };
    ledger.plots[0] = weakPlot(0, "carrot");
    ledger.plots[0] = { ...ledger.plots[0], pest: false };
    const actions = planBotActions(ledger, seasonAt(NOW), NOW, () => 0.5);
    expect(actions.some((action) => action.kind === "uproot")).toBe(false);
  });

  it("uproots a reharvest crop even for a tiny first-pick loss", () => {
    const ledger = makeLedger();
    ledger.coins = 50_000;
    ledger.bag.seeds = { carrot: 3 };
    ledger.plots[0] = weakPlot(0, "cucumber");
    // Force a one-coin loss to prove even a tiny loss triggers the uproot.
    const base = seasonAt(NOW);
    const season = {
      ...base,
      prices: { ...base.prices, cucumber: 1 },
      buyPrices: { ...base.buyPrices, cucumber: 2 },
    };
    const actions = planBotActions(ledger, season, NOW, () => 0.5);
    console.warn(
      "TINY2",
      JSON.stringify(actions),
      "plot",
      JSON.stringify(ledger.plots[0]),
      "cucumber price",
      season.prices.cucumber,
      "buy",
      season.buyPrices?.cucumber,
    );
    expect(actions.some((action) => action.kind === "uproot" && action.slot === 0)).toBe(true);
  });

  it("keeps a healthy crop untouched", () => {
    const ledger = makeLedger();
    ledger.coins = 50_000;
    ledger.bag.seeds = { carrot: 3 };
    ledger.plots[0] = {
      ...weakPlot(0, "carrot"),
      pest: false,
      plantedAt: NOW - 100_000,
      readyAt: NOW + 20_000,
    };
    const actions = planBotActions(ledger, seasonAt(NOW), NOW, () => 0.5);
    expect(actions.some((action) => action.kind === "uproot")).toBe(false);
  });
});

describe("bot brain neighbourhood", () => {
  it("uproots every losing plant without mercy in one tick", () => {
    const ledger = makeLedger();
    ledger.coins = 50_000;
    ledger.bag.seeds = { carrot: 5 };
    for (let slot = 0; slot < 3; slot += 1) {
      ledger.plots[slot] = { ...weakPlot(slot, "carrot"), effects: ["shriveled"] };
    }
    const actions = planBotActions(ledger, seasonAt(NOW), NOW, () => 0.5);
    const uprooted = actions.filter((action) => action.kind === "uproot").map((action) => action.slot);
    expect(uprooted).toEqual([0, 1, 2]);
  });

  it("uproots dead plants too", () => {
    const ledger = makeLedger();
    ledger.coins = 50_000;
    ledger.plots[0] = { ...weakPlot(0, "carrot"), dead: true, watered: true };
    const actions = planBotActions(ledger, seasonAt(NOW), NOW, () => 0.5);
    expect(actions.some((action) => action.kind === "uproot" && action.slot === 0)).toBe(true);
  });

  it("diversifies away from the crop every other garden is growing", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000_000;
    ledger.shopStock = { carrot: 99, potato: 99 };
    const base = seasonAt(NOW);
    const season = {
      ...base,
      prices: { ...base.prices, carrot: 100, potato: 400 },
      buyPrices: { ...(base.buyPrices ?? {}), carrot: 5, potato: 16 },
      shop: {
        ...base.shop,
        offers: [
          { seed: "carrot" as const, price: 5, stock: 99 },
          { seed: "potato" as const, price: 16, stock: 99 },
        ],
      },
    };

    // Alone, the bot prefers the higher profit-per-minute potato.
    const solo = bestBotSeed(ledger, season);
    expect(solo?.id).toBe("potato");
    // Once every neighbour plants potato, it switches to the carrot.
    const crowded = bestBotSeed(ledger, season, undefined, { potato: 900, carrot: 100 });
    expect(crowded?.id).toBe("carrot");
  });
});
