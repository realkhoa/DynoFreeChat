/**
 * @file extras.spec.ts
 * @brief Contracts, merchant, insurance, wheel, genetics, compost and daily/weekly settling.
 */

import { describe, expect, it } from "vitest";
import {
  EPOCH_MS,
  EVENT_WAVE_MS,
  WHEEL_PITY,
  WHEEL_PRICE,
  contractOffers,
  merchantOffers,
  seasonAt,
  type GardenAction,
} from "@dyno/shared/garden";
import { applyGardenAction, createLedger, settleExtras, type GardenLedger } from "../src/garden-rules";

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

    const pet = run(greenhouse.ledger, { kind: "buyPet" });
    expect(pet.ok).toBe(true);
    if (!pet.ok) return;
    expect(pet.ledger.pet).toBe(1);

    pet.ledger.bag.crops = [{ item: "carrot", effects: [], qty: 4, pest: true }];
    const spliced = run(pet.ledger, { kind: "spliceCrops", item: "carrot" });
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

  it("guarantees a rare wheel prize at pity", () => {
    const ledger = makeLedger();
    ledger.coins = WHEEL_PRICE;
    ledger.wheelPity = WHEEL_PITY - 1;
    const spun = run(ledger, { kind: "spinWheel" });
    expect(spun.ok).toBe(true);
    if (!spun.ok) return;
    expect(spun.ledger.wheelLast.startsWith("seed:")).toBe(true);
    expect(spun.ledger.wheelPity).toBe(0);
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
