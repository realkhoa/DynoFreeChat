/**
 * @file garden-rules.spec.ts
 * @brief Economy rules for ASCII Garden, exercised with a controlled clock.
 * @details Harvesting normally takes minutes; the pure rule set lets the tests
 * jump the clock instead of waiting, which keeps the suite fast and deterministic.
 */

import { describe, expect, it } from "vitest";
import {
  ACTIONS_PER_MINUTE,
  EPOCH_MS,
  EVENT_WAVE_MS,
  seasonAt as seasonFor,
  type GardenAction,
} from "@dyno/shared/garden";
import { applyGardenAction, createLedger, ledgerSnapshot, type GardenLedger } from "../src/garden-rules";

/** Server time inside the golden-hour wave, so growth is unmodified by rain. */
const NOW = EPOCH_MS + 2 * EVENT_WAVE_MS + 1_000;

/** Builds a fresh ledger at {@link NOW}. */
function makeLedger(): GardenLedger {
  return createLedger({
    playerId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    nick: "gardener",
    color: "hsl(200 60% 60%)",
    code: "ABCDEF",
    tokenHash: "0".repeat(64),
    recoveryHash: "1".repeat(64),
    now: NOW,
  });
}

/** Applies one action at `at`, defaulting to {@link NOW}. */
function run(
  ledger: GardenLedger,
  action: GardenAction,
  at = NOW,
  roll = 0.9,
): ReturnType<typeof applyGardenAction> {
  return applyGardenAction(ledger, action, seasonFor(at), at, () => roll);
}

describe("garden ledger rules", () => {
  it("starts with coins, seeds and four open plots", () => {
    const ledger = makeLedger();
    expect(ledger.coins).toBe(30);
    expect(ledger.patches).toBe(1);
    expect(ledger.bag.seeds.carrot).toBe(3);
    expect(ledger.plots.filter((plot) => plot === null)).toHaveLength(9);
    expect(ledgerSnapshot(ledger).code).toBe("ABCDEF");
  });

  it("plants a bagged seed and rolls the effect deterministically", () => {
    const planted = run(makeLedger(), { kind: "plant", slot: 0, seed: "carrot" }, NOW, 0.01);
    expect(planted.ok).toBe(true);
    if (!planted.ok) return;
    expect(planted.ledger.bag.seeds.carrot).toBe(2);
    const plot = planted.ledger.plots[0];
    expect(plot).not.toBeNull();
    expect(plot?.effect).toBe("golden");
    expect(plot?.readyAt).toBeGreaterThan(NOW);
    expect(planted.ledger.stats.planted).toBe(1);
    expect(planted.ledger.rev).toBe(makeLedger().rev + 1);
  });

  it("refuses plots beyond the bought patches, occupied plots and empty bags", () => {
    expect(run(makeLedger(), { kind: "plant", slot: 9, seed: "carrot" })).toMatchObject({
      ok: false,
      code: "PLOT_LOCKED",
    });
    const empty = makeLedger();
    empty.bag.seeds.carrot = 0;
    expect(run(empty, { kind: "plant", slot: 0, seed: "carrot" })).toMatchObject({
      ok: false,
      code: "NO_SEED",
    });
    const first = run(makeLedger(), { kind: "plant", slot: 0, seed: "carrot" });
    if (!first.ok) throw new Error("plant failed");
    expect(run(first.ledger, { kind: "plant", slot: 0, seed: "carrot" })).toMatchObject({
      ok: false,
      code: "PLOT_OCCUPIED",
    });
  });

  it("plants a fruit tree for coins and picks only its fruit", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000;
    const planted = run(ledger, { kind: "plantTree", slot: 0, tree: "apple" }, NOW, 0.9);
    expect(planted.ok).toBe(true);
    if (!planted.ok) return;
    expect(planted.ledger.coins).toBe(850);
    expect(planted.ledger.trees[0]?.tree).toBe("apple");
    expect(planted.ledger.plots[0]).toBeNull();

    const tree = planted.ledger.trees[0];
    if (tree === null || tree === undefined) throw new Error("tree missing");
    const picked = run(planted.ledger, { kind: "harvest", slot: 0, tree: true }, tree.readyAt, 0.9);
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.ledger.trees[0]?.harvests).toBe(1);
    expect(picked.ledger.trees[0]?.readyAt).toBeGreaterThan(tree.readyAt);
    expect(picked.ledger.bag.crops).toEqual([{ item: "apple", effect: null, qty: 1 }]);
  });

  it("refuses a tree it cannot afford and an occupied tree slot", () => {
    const broke = makeLedger();
    expect(run(broke, { kind: "plantTree", slot: 0, tree: "elderberry" })).toMatchObject({
      ok: false,
      code: "NOT_ENOUGH_COINS",
    });
    const rich = makeLedger();
    rich.coins = 1_000;
    const first = run(rich, { kind: "plantTree", slot: 0, tree: "apple" });
    if (!first.ok) throw new Error("plant failed");
    expect(run(first.ledger, { kind: "plantTree", slot: 0, tree: "apple" })).toMatchObject({
      ok: false,
      code: "PLOT_OCCUPIED",
    });
  });

  it("harvests only when ripe and moves the crop into the bag", () => {
    const planted = run(makeLedger(), { kind: "plant", slot: 0, seed: "carrot" }, NOW, 0.9);
    if (!planted.ok) throw new Error("plant failed");
    const plot = planted.ledger.plots[0];
    if (plot === null || plot === undefined) throw new Error("plot empty");

    expect(run(planted.ledger, { kind: "harvest", slot: 0, tree: false }, NOW + 1_000)).toMatchObject({
      ok: false,
      code: "NOT_READY",
    });

    const harvested = run(planted.ledger, { kind: "harvest", slot: 0, tree: false }, plot.readyAt);
    expect(harvested.ok).toBe(true);
    if (!harvested.ok) return;
    expect(harvested.ledger.plots[0]).toBeNull();
    expect(harvested.ledger.bag.crops).toEqual([{ item: "carrot", effect: null, qty: 1 }]);
    expect(harvested.ledger.stats.harvested).toBe(1);
  });

  it("keeps reharvest plants after picking and regrows the fruit", () => {
    const tomato = makeLedger();
    tomato.bag.seeds.tomato = 1;
    const planted = run(tomato, { kind: "plant", slot: 0, seed: "tomato" }, NOW, 0.9);
    if (!planted.ok) throw new Error("plant failed");
    const plot = planted.ledger.plots[0];
    if (plot === null || plot === undefined) throw new Error("plot empty");

    const first = run(planted.ledger, { kind: "harvest", slot: 0, tree: false }, plot.readyAt, 0.01);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ledger.plots[0]).not.toBeNull();
    expect(first.ledger.plots[0]?.harvests).toBe(1);
    expect(first.ledger.plots[0]?.readyAt).toBeGreaterThan(plot.readyAt);
    expect(first.ledger.plots[0]?.effect).toBe("golden");
    expect(first.ledger.bag.crops).toEqual([{ item: "tomato", effect: null, qty: 1 }]);

    expect(run(first.ledger, { kind: "harvest", slot: 0, tree: false })).toMatchObject({
      ok: false,
      code: "NOT_READY",
    });
  });

  it("pulls root crops and leaves empty soil", () => {
    const planted = run(makeLedger(), { kind: "plant", slot: 0, seed: "carrot" }, NOW, 0.9);
    if (!planted.ok) throw new Error("plant failed");
    const plot = planted.ledger.plots[0];
    if (plot === null || plot === undefined) throw new Error("plot empty");
    const harvested = run(planted.ledger, { kind: "harvest", slot: 0, tree: false }, plot.readyAt);
    expect(harvested.ok).toBe(true);
    if (!harvested.ok) return;
    expect(harvested.ledger.plots[0]).toBeNull();
  });

  it("waters once: shortens growth and adds the wet effect", () => {
    const tomato = makeLedger();
    tomato.bag.seeds.tomato = 1;
    const planted = run(tomato, { kind: "plant", slot: 0, seed: "tomato" }, NOW, 0.9);
    if (!planted.ok) throw new Error("plant failed");
    const plot = planted.ledger.plots[0];
    if (plot === null || plot === undefined) throw new Error("plot empty");

    const watered = run(planted.ledger, { kind: "water", slot: 0, tree: false });
    expect(watered.ok).toBe(true);
    if (!watered.ok) return;
    const next = watered.ledger.plots[0];
    expect(next?.watered).toBe(true);
    expect(next?.effect).toBe("wet");
    expect(next?.readyAt).toBeLessThan(plot.readyAt);
    expect(run(watered.ledger, { kind: "water", slot: 0, tree: false })).toMatchObject({
      ok: false,
      code: "ALREADY_WATERED",
    });
  });

  it("fertilizes for coins, once", () => {
    const corn = makeLedger();
    corn.bag.seeds.corn = 1;
    const planted = run(corn, { kind: "plant", slot: 0, seed: "corn" }, NOW, 0.9);
    if (!planted.ok) throw new Error("plant failed");
    const plot = planted.ledger.plots[0];
    if (plot === null || plot === undefined) throw new Error("plot empty");

    const fed = run(planted.ledger, { kind: "fertilize", slot: 0, tree: false });
    expect(fed.ok).toBe(true);
    if (!fed.ok) return;
    expect(fed.ledger.coins).toBe(planted.ledger.coins - 3);
    expect(fed.ledger.plots[0]?.fertilized).toBe(true);
    expect(fed.ledger.plots[0]?.readyAt).toBeLessThan(plot.readyAt);
    expect(run(fed.ledger, { kind: "fertilize", slot: 0, tree: false })).toMatchObject({
      ok: false,
      code: "ALREADY_FERTILIZED",
    });
  });

  it("uproots without a refund", () => {
    const planted = run(makeLedger(), { kind: "plant", slot: 1, seed: "carrot" });
    if (!planted.ok) throw new Error("plant failed");
    const uprooted = run(planted.ledger, { kind: "uproot", slot: 1, tree: false });
    expect(uprooted.ok).toBe(true);
    if (!uprooted.ok) return;
    expect(uprooted.ledger.plots[1]).toBeNull();
    expect(uprooted.ledger.coins).toBe(planted.ledger.coins);
  });

  it("buys the next 3x3 patch at the compounding price", () => {
    const ledger = makeLedger();
    ledger.coins = 20_000;
    const first = run(ledger, { kind: "buyPatch" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ledger.patches).toBe(2);
    expect(first.ledger.plots).toHaveLength(18);
    expect(first.ledger.coins).toBe(17_000);

    const second = run(first.ledger, { kind: "buyPatch" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.ledger.patches).toBe(3);
    expect(second.ledger.plots).toHaveLength(27);
    expect(second.ledger.coins).toBe(8_000);

    const broke = makeLedger();
    broke.coins = 2_999;
    expect(run(broke, { kind: "buyPatch" })).toMatchObject({ ok: false, code: "NOT_ENOUGH_COINS" });
  });

  it("buys seeds at the rotating price and respects stock", () => {
    const ledger = makeLedger();
    const season = seasonFor(NOW);
    const carrot = season.shop.offers.find((offer) => offer.seed === "carrot");
    if (carrot === undefined) throw new Error("offer");
    const bought = run(ledger, { kind: "buySeed", seed: "carrot", qty: 2 });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.ledger.coins).toBe(ledger.coins - carrot.price * 2);
    expect(bought.ledger.bag.seeds.carrot).toBe(5);
    expect(bought.ledger.shopStock.carrot).toBe(carrot.stock - 2);

    const broke = makeLedger();
    broke.coins = 0;
    expect(run(broke, { kind: "buySeed", seed: "carrot", qty: 1 })).toMatchObject({
      ok: false,
      code: "NOT_ENOUGH_COINS",
    });

    const soldOut = makeLedger();
    soldOut.shopRestockAt = season.shop.restockAt;
    soldOut.shopStock = { carrot: 0 };
    expect(run(soldOut, { kind: "buySeed", seed: "carrot", qty: 1 })).toMatchObject({
      ok: false,
      code: "SHOP_SOLD_OUT",
    });
  });

  it("sells crop stacks with the effect multiplier", () => {
    const ledger = makeLedger();
    ledger.bag.crops = [
      { item: "carrot", effect: "golden", qty: 2 },
      { item: "corn", effect: null, qty: 1 },
    ];
    const season = seasonFor(NOW);
    const expected = season.prices.carrot * 5 * 2 + season.prices.corn;
    const sold = run(ledger, { kind: "sellAll" });
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.ledger.coins).toBe(ledger.coins + expected);
    expect(sold.ledger.stats.earned).toBe(expected);
    expect(sold.ledger.bag.crops).toEqual([]);

    expect(run(sold.ledger, { kind: "sellAll" })).toMatchObject({ ok: false, code: "NOTHING_TO_SELL" });
  });

  it("rejects a rate-limited action without touching the garden", () => {
    const ledger = makeLedger();
    ledger.actionWindow = NOW;
    ledger.actionCount = ACTIONS_PER_MINUTE;
    expect(run(ledger, { kind: "sellAll" })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("bumps the revision on every successful mutation", () => {
    const ledger = makeLedger();
    const planted = run(ledger, { kind: "plant", slot: 0, seed: "carrot" });
    if (!planted.ok) throw new Error("plant failed");
    expect(planted.ledger.rev).toBe(ledger.rev + 1);
    expect(planted.ledger.updatedAt).toBe(NOW);
  });
});
