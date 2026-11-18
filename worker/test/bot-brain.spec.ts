/**
 * @file bot-brain.spec.ts
 * @brief Bot heuristics: uprooting losing crops and honouring the carrot focus.
 */

import { describe, expect, it } from "vitest";
import { EPOCH_MS, EVENT_WAVE_MS, seasonAt, type PlotState, type SeedId } from "@dyno/shared/garden";
import { createLedger } from "../src/garden-rules";
import { planBotActions } from "../src/bot-brain";

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
    plantedAt: NOW - 10_000,
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
    ledger.plots[0] = weakPlot(0, "carrot");
    const actions = planBotActions(ledger, seasonAt(NOW), NOW, () => 0.5);
    expect(actions.some((action) => action.kind === "uproot" && action.slot === 0)).toBe(true);
    // It either replants an owned seed or buys a better one for the freed slot.
    expect(actions.some((action) => action.kind === "plant" || action.kind === "buySeed")).toBe(true);
  });

  it("the carrot bot uproots other crops to plant carrots", () => {
    const ledger = makeLedger();
    ledger.coins = 50_000;
    ledger.bag.seeds = { carrot: 3 };
    ledger.plots[0] = weakPlot(0, "tomato");
    const actions = planBotActions(ledger, seasonAt(NOW), NOW, () => 0.5, 12, "carrot");
    expect(actions.some((action) => action.kind === "uproot" && action.slot === 0)).toBe(true);
    expect(actions.some((action) => action.kind === "plant" && action.seed === "carrot")).toBe(true);
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
