/**
 * @file extras.spec.ts
 * @brief Contracts, merchant, insurance, wheel, genetics, compost and daily/weekly settling.
 */

import { describe, expect, it } from "vitest";
import {
  EPOCH_MS,
  EVENT_WAVE_MS,
  WHEEL_PITY,
  wheelCost,
  dailyQuestsFor,
  wheelDayAt,
  prestigeRequirement,
  contractOffers,
  merchantOffers,
  seasonAt,
  type GardenAction,
} from "@dyno/shared/garden";
import {
  advanceQuests,
  applyGardenAction,
  createLedger,
  dailyAssetTax,
  settleExtras,
  type GardenLedger,
} from "../src/garden-rules";

const NOW = EPOCH_MS + 5 * EVENT_WAVE_MS + 1_000;

/** Fresh ledger for one test. */
function makeLedger(): GardenLedger {
  return createLedger({
    playerId: "extras-test",
    nick: "Extras",
    color: "#4ec9b0",
    code: "ABCDEF",
    tokenHash: "a".repeat(64),
    recoveryHash: "b".repeat(64),
    now: NOW,
  });
}

/** Applies one action at the fixed clock. */
function run(ledger: GardenLedger, action: GardenAction, at = NOW) {
  return applyGardenAction(ledger, action, seasonAt(at), at, () => 0.5);
}

describe("extras", () => {
  it("sells a contract from the rotated board", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000;
    const offer = contractOffers(ledger.playerId, NOW)[0];
    if (offer === undefined) throw new Error("no contract");
    ledger.bag.products = [{ product: offer.product, star: 5, qty: offer.qty }];
    const result = run(ledger, { kind: "fulfillContract", id: offer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.coins).toBe(1_000 + offer.reward);
    expect(result.ledger.contractClaims).toContain(offer.id);
    expect(result.ledger.bag.products).toHaveLength(0);
  });

  it("buys from the traveling merchant", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    const offer = merchantOffers(ledger.playerId, NOW)[0];
    if (offer === undefined) throw new Error("no merchant");
    const result = run(ledger, { kind: "buyMerchant", id: offer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.merchantClaims).toContain(offer.id);
    expect(result.ledger.coins).toBe(10_000_000 - offer.price);
  });

  it("buys insurance, greenhouse, pet, splice, compost and futures", () => {
    const ledger = makeLedger();
    ledger.coins = 20_000_000;
    const insured = run(ledger, { kind: "buyInsurance" });
    expect(insured.ok).toBe(true);
    if (!insured.ok) return;
    expect(insured.ledger.insuranceUntil).toBeGreaterThan(NOW);

    const greenhouse = run(insured.ledger, { kind: "buyGreenhouse" });
    expect(greenhouse.ok).toBe(true);
    if (!greenhouse.ok) return;
    expect(greenhouse.ledger.greenhouse).toBe(1);

    const eggCoins = greenhouse.ledger.coins;
    const hatched = run(greenhouse.ledger, { kind: "hatchEgg" });
    expect(hatched.ok).toBe(true);
    if (!hatched.ok) return;
    expect(Object.keys(hatched.ledger.pets).length).toBeGreaterThan(0);
    expect(hatched.ledger.equippedPet).not.toBeNull();
    expect(hatched.ledger.coins).toBe(eggCoins - 1_000_000);

    const petId = Object.keys(hatched.ledger.pets)[0];
    expect(run(hatched.ledger, { kind: "equipPet", pet: petId as never }).ok).toBe(true);

    hatched.ledger.bag.crops = [{ item: "carrot", effects: [], qty: 4, pest: true }];
    const spliced = run(hatched.ledger, { kind: "spliceCrops", item: "carrot" });
    expect(spliced.ok).toBe(true);
    if (!spliced.ok) return;
    expect(spliced.ledger.spliceBonus).toBe(1);
    expect(spliced.ledger.bag.crops[0]?.qty).toBe(2);

    const composted = run(spliced.ledger, { kind: "compostCrops" });
    expect(composted.ok).toBe(true);
    if (!composted.ok) return;
    expect(composted.ledger.bag.supplies.compost).toBe(1);
    expect(composted.ledger.bag.crops).toHaveLength(0);

    composted.ledger.bag.crops = [{ item: "carrot", effects: [], qty: 1 }];
    const locked = run(composted.ledger, { kind: "lockFuture", item: "carrot", qty: 1 });
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(locked.ledger.futures).toHaveLength(1);
  });

  it("pays the locked future price even when the market crashes", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000;
    ledger.bag.crops = [{ item: "carrot", effects: [], qty: 1 }];
    const locked = run(ledger, { kind: "lockFuture", item: "carrot", qty: 1 });
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    const lockPrice = locked.ledger.futures[0]?.price ?? 0;
    const base = seasonAt(NOW + 2_000);
    const crashed = { ...base, prices: { ...base.prices, carrot: 1 } };
    const sold = applyGardenAction(
      locked.ledger,
      { kind: "sellCrop", item: "carrot", effects: [], qty: 1 },
      crashed,
      NOW + 2_000,
      () => 0.5,
    );
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    const tax = Math.round(lockPrice * 0.1);
    expect(sold.ledger.coins).toBe(locked.ledger.coins + lockPrice - tax);
  });

  it("never hatches without a million coins", () => {
    const ledger = makeLedger();
    ledger.coins = 999_999;
    expect(run(ledger, { kind: "hatchEgg" })).toMatchObject({ ok: false, code: "NOT_ENOUGH_COINS" });
  });

  it("guarantees a rare wheel prize at pity", () => {
    const ledger = makeLedger();
    ledger.coins = wheelCost(0);
    ledger.wheelPity = WHEEL_PITY - 1;
    const spun = run(ledger, { kind: "spinWheel" });
    expect(spun.ok).toBe(true);
    if (!spun.ok) return;
    expect(spun.ledger.wheelLast.startsWith("seed:")).toBe(true);
    expect(spun.ledger.wheelPity).toBe(0);
  });

  it("doubles the wheel price per daily spin and resets at midnight", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000_000;
    const first = run(ledger, { kind: "spinWheel" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ledger.wheelSpins).toBe(1);
    expect(first.ledger.coins).toBe(1_000_000 - wheelCost(0));
    const second = run(first.ledger, { kind: "spinWheel" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.ledger.wheelSpins).toBe(2);
    expect(second.ledger.coins).toBe(first.ledger.coins - wheelCost(1));

    // Midnight resets the counter (and the doubling) for the new day.
    const tomorrow = NOW + 24 * 60 * 60_000;
    const reset = settleExtras(second.ledger, tomorrow);
    expect(reset.wheelSpins).toBe(0);
    const next = run(reset, { kind: "spinWheel" }, tomorrow);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ledger.coins).toBe(reset.coins - wheelCost(0));
  });

  it("charges the daily asset and wealth tax once per day", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000_000;
    const tax = dailyAssetTax(ledger);
    expect(tax).toBeGreaterThan(0);
    const next = settleExtras(ledger, NOW + 24 * 60 * 60_000);
    expect(next.taxLast).toBeGreaterThan(0);
    expect(next.coins + next.taxLast).toBeGreaterThanOrEqual(ledger.coins);
    expect(next.taxLast).toBeGreaterThanOrEqual(tax);
    const again = settleExtras(next, NOW + 24 * 60 * 60_000 + 1_000);
    expect(again.coins).toBe(next.coins);
  });

  it("tracks daily quests and pays a claim once", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000_000;
    const quests = dailyQuestsFor(ledger.playerId, wheelDayAt(NOW));
    expect(quests).toHaveLength(3);
    const quest = quests[0];
    if (quest === undefined) throw new Error("no quest");

    const before = ledger;
    const after = {
      ...ledger,
      stats: { ...ledger.stats, planted: ledger.stats.planted + 5, harvested: ledger.stats.harvested + 5 },
    };
    const tracked = advanceQuests(before, after, { kind: "plant", slot: 0, seed: "carrot" }, NOW);
    const expected = quest.kind === "plant" ? 5 : quest.kind === "harvest" ? 5 : 0;
    expect(tracked.questProgress[quest.id] ?? 0).toBe(Math.min(quest.target, expected));

    tracked.questProgress[quest.id] = quest.target;
    const claimed = run(tracked, { kind: "claimQuest", id: quest.id });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.ledger.coins).toBe(tracked.coins + quest.reward);
    expect(claimed.ledger.questClaims).toContain(quest.id);
    expect(run(claimed.ledger, { kind: "claimQuest", id: quest.id })).toMatchObject({
      ok: false,
      code: "ALREADY_CLAIMED",
    });
  });

  it("prestiges only after the lifetime earnings requirement", () => {
    const ledger = makeLedger();
    const blocked = run(ledger, { kind: "prestige" });
    expect(blocked.ok).toBe(false);

    ledger.coins = 5_000_000_000;
    ledger.warehouse = 1;
    ledger.machines = { seedMaker: { level: 2, lastCraftAt: 0 } };
    ledger.plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW,
      readyAt: NOW + 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    ledger.animals.coop[0] = { kind: "chicken", bornAt: NOW, pats: 0, lastProduceAt: NOW };
    ledger.stats = { ...ledger.stats, earned: prestigeRequirement(0) };
    const prestiged = run(ledger, { kind: "prestige" });
    expect(prestiged.ok).toBe(true);
    if (!prestiged.ok) return;
    expect(prestiged.ledger.prestige).toBe(1);
    expect(prestiged.ledger.code).toBe(ledger.code);
    // Only living things reset; money, machines and infrastructure stay.
    expect(prestiged.ledger.coins).toBe(5_000_000_000);
    expect(prestiged.ledger.warehouse).toBe(1);
    expect(prestiged.ledger.machines.seedMaker?.level).toBe(2);
    expect(prestiged.ledger.plots.every((plot) => plot === null)).toBe(true);
    expect(prestiged.ledger.animals.coop.every((animal) => animal === null)).toBe(true);
  });

  it("sells tiered prestige seeds including cocomelon", () => {
    const ledger = makeLedger();
    ledger.prestige = 5;
    ledger.coins = 2_000_000_000;

    const locked = run({ ...ledger, prestige: 0 }, { kind: "buyPrestigeSeed", seed: "cocomelon" });
    expect(locked.ok).toBe(false);

    const bought = run(ledger, { kind: "buyPrestigeSeed", seed: "cocomelon" });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.ledger.bag.seeds.cocomelon).toBe(1);
    expect(bought.ledger.coins).toBe(1_000_000_000);

    const tiered = run(
      { ...ledger, prestige: 4, coins: 2_000_000_000 },
      { kind: "buyPrestigeSeed", seed: "cocomelon" },
    );
    expect(tiered.ok).toBe(false);
  });

  it("settles daily streak, weekly bucket and achievements", () => {
    const ledger = makeLedger();
    ledger.stats.earned = 1_000_000;
    ledger.lastEarned = 0;
    ledger.lastStreakDay = Math.floor((NOW - EPOCH_MS) / (24 * 60 * 60_000)) - 1;
    ledger.streak = 1;
    const settled = settleExtras(ledger, NOW);
    expect(settled.streak).toBe(2);
    expect(settled.coins).toBeGreaterThan(ledger.coins);
    expect(settled.weekEarned).toBe(1_000_000);
    expect(settled.achievements).toContain("firstMillion");
  });
});
