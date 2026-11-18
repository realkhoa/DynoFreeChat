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
  FARM_CYCLE_MS,
  eventsAt,
  nextTabPrice,
  resolvedCropEffects,
  resolvedTreeEffects,
  rollEffectsFor,
  seasonAt as seasonFor,
  sprayById,
  type GardenAction,
} from "@dyno/shared/garden";
import {
  applyGardenAction,
  createLedger,
  ledgerSnapshot,
  settleFarm,
  settleTools,
  type GardenLedger,
} from "../src/garden-rules";

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
  season = seasonFor(at),
): ReturnType<typeof applyGardenAction> {
  return applyGardenAction(ledger, action, season, at, () => roll);
}

describe("garden ledger rules", () => {
  it("starts with coins, seeds and four open plots", () => {
    const ledger = makeLedger();
    expect(ledger.coins).toBe(30);
    expect(ledger.tabs).toBe(1);
    expect(ledger.bag.seeds.carrot).toBe(3);
    expect(ledger.plots.filter((plot) => plot === null)).toHaveLength(81);
    expect(ledger.trees.filter((tree) => tree === null)).toHaveLength(27);
    expect(ledgerSnapshot(ledger).code).toBe("ABCDEF");
  });

  it("plants a bagged seed and rolls the effect deterministically", () => {
    const planted = run(makeLedger(), { kind: "plant", slot: 0, seed: "carrot" }, NOW, 0.01);
    expect(planted.ok).toBe(true);
    if (!planted.ok) return;
    expect(planted.ledger.bag.seeds.carrot).toBe(2);
    const plot = planted.ledger.plots[0];
    expect(plot).not.toBeNull();
    expect(plot?.effects).toEqual(["golden", "frozen"]);
    expect(plot?.readyAt).toBeGreaterThan(NOW);
    expect(planted.ledger.stats.planted).toBe(1);
    expect(planted.ledger.rev).toBe(makeLedger().rev + 1);
  });

  it("refuses plots beyond the bought tab, occupied plots and empty bags", () => {
    expect(run(makeLedger(), { kind: "plant", slot: 81, seed: "carrot" })).toMatchObject({
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
    expect(picked.ledger.bag.crops).toEqual([
      { item: "apple", effects: resolvedTreeEffects(tree, tree.readyAt), qty: 1 },
    ]);
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
    expect(harvested.ledger.bag.crops).toEqual([{ item: "carrot", effects: [], qty: 1 }]);
    expect(harvested.ledger.stats.harvested).toBe(1);
  });

  it("keeps reharvest plants after picking and regrows the fruit", () => {
    const tomato = makeLedger();
    tomato.bag.seeds.tomato = 1;
    const planted = run(tomato, { kind: "plant", slot: 0, seed: "tomato" }, NOW, 0.9);
    if (!planted.ok) throw new Error("plant failed");
    const plot = planted.ledger.plots[0];
    if (plot === null || plot === undefined) throw new Error("plot empty");

    const first = run(planted.ledger, { kind: "harvest", slot: 0, tree: false }, plot.readyAt, 0.1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ledger.plots[0]).not.toBeNull();
    expect(first.ledger.plots[0]?.harvests).toBe(1);
    expect(first.ledger.plots[0]?.readyAt).toBeGreaterThan(plot.readyAt);
    expect(first.ledger.plots[0]?.effects).toEqual(rollEffectsFor(eventsAt(plot.readyAt), () => 0.1));
    expect(first.ledger.bag.crops).toEqual([
      { item: "tomato", effects: resolvedCropEffects(plot, plot.readyAt), qty: 1 },
    ]);

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
    expect(next?.effects).toEqual(["wet"]);
    expect(next?.readyAt).toBeLessThan(plot.readyAt);
    expect(run(watered.ledger, { kind: "water", slot: 0, tree: false })).toMatchObject({
      ok: false,
      code: "ALREADY_WATERED",
    });
  });

  it("buys fertilizer and applies it across several harvest cycles", () => {
    const corn = makeLedger();
    corn.bag.seeds.corn = 1;
    corn.coins = 500;
    const bought = run(corn, { kind: "buySupply", supply: "compost", qty: 1 });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.ledger.bag.supplies.compost).toBe(1);
    expect(bought.ledger.coins).toBe(475);

    const planted = run(bought.ledger, { kind: "plant", slot: 0, seed: "corn" }, NOW, 0.9);
    if (!planted.ok) throw new Error("plant failed");
    const plot = planted.ledger.plots[0];
    if (plot === null || plot === undefined) throw new Error("plot empty");

    const fed = run(planted.ledger, { kind: "fertilize", slot: 0, tree: false, supply: "compost" });
    expect(fed.ok).toBe(true);
    if (!fed.ok) return;
    expect(fed.ledger.bag.supplies.compost).toBe(0);
    expect(fed.ledger.plots[0]?.fertilizer).toEqual({ id: "compost", left: 2 });
    expect(fed.ledger.plots[0]?.readyAt).toBeLessThan(plot.readyAt);
    expect(run(fed.ledger, { kind: "fertilize", slot: 0, tree: false, supply: "compost" })).toMatchObject({
      ok: false,
      code: "NO_SUPPLY",
    });
  });

  it("sprays raise the next mutation roll and wear off", () => {
    const tomato = makeLedger();
    tomato.bag.seeds.tomato = 1;
    tomato.coins = 500;
    const bought = run(tomato, { kind: "buySupply", supply: "snowSpray", qty: 1 });
    if (!bought.ok) throw new Error("buy failed");
    const planted = run(bought.ledger, { kind: "plant", slot: 0, seed: "tomato" }, NOW, 0.9);
    if (!planted.ok) throw new Error("plant failed");
    const plot = planted.ledger.plots[0];
    if (plot === null || plot === undefined) throw new Error("plot empty");

    const sprayed = run(planted.ledger, { kind: "spray", slot: 0, tree: false, supply: "snowSpray" });
    expect(sprayed.ok).toBe(true);
    if (!sprayed.ok) return;
    expect(sprayed.ledger.plots[0]?.spray).toEqual({ id: "snowSpray", left: 2 });
    expect(sprayed.ledger.bag.supplies.snowSpray).toBe(0);

    const picked = run(sprayed.ledger, { kind: "harvest", slot: 0, tree: false }, plot.readyAt, 0.1);
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.ledger.plots[0]?.effects).toEqual(
      rollEffectsFor(eventsAt(plot.readyAt), () => 0.1, sprayById("snowSpray")?.effectChances ?? {}),
    );
    expect(picked.ledger.plots[0]?.spray).toEqual({ id: "snowSpray", left: 1 });
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

  it("waters every growing plant for 5c each", () => {
    const ledger = makeLedger();
    ledger.coins = 100;
    ledger.plots[0] = {
      slot: 0,
      seed: "tomato",
      plantedAt: NOW,
      readyAt: NOW + 8 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    ledger.plots[1] = { ...ledger.plots[0], slot: 1 };
    const result = run(ledger, { kind: "waterAll" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.coins).toBe(90);
    expect(result.ledger.plots[0]?.watered).toBe(true);
    expect(result.ledger.plots[1]?.watered).toBe(true);

    const again = run(result.ledger, { kind: "waterAll" });
    expect(again).toMatchObject({ ok: false, code: "NOTHING_TO_DO" });
  });

  it("harvests every ripe plant for 20c each", () => {
    const ledger = makeLedger();
    ledger.coins = 100;
    ledger.plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW - 5 * 60_000,
      readyAt: NOW - 1_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    ledger.plots[1] = { ...ledger.plots[0], slot: 1, seed: "parsnip" };
    const result = run(ledger, { kind: "harvestAll" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.coins).toBe(60);
    expect(result.ledger.bag.crops).toHaveLength(2);
    expect(result.ledger.plots[0]).toBeNull();
    expect(result.ledger.plots[1]).toBeNull();
  });

  it("builds a coop, buys animals, settles upkeep and collects products", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    const built = run(ledger, { kind: "buildBuilding", building: "coop" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.ledger.buildings.coop).toBe(1);
    expect(built.ledger.coins).toBe(7_000_000);

    const upgraded = run(built.ledger, { kind: "upgradeBuilding", building: "coop" });
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    expect(upgraded.ledger.animals.coop).toHaveLength(6);
    expect(upgraded.ledger.coins).toBe(4_000_000);

    const bought = run(upgraded.ledger, { kind: "buyAnimal", building: "coop", slot: 0, animal: "chicken" });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.ledger.animals.coop[0]?.kind).toBe("chicken");

    // Three cycles later: upkeep of 120 and one egg (every two cycles).
    const later = settleFarm(bought.ledger, NOW + 3 * FARM_CYCLE_MS);
    expect(later.coins).toBe(bought.ledger.coins - 120);
    expect(later.bag.products?.length).toBe(1);
    expect(later.bag.products?.[0]?.product).toBe("egg");
    expect(later.bag.products?.[0]?.qty).toBe(1);

    const sold = run(later, { kind: "sellAllProducts" }, NOW + 3 * FARM_CYCLE_MS);
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.ledger.coins).toBeGreaterThan(later.coins);
    expect(sold.ledger.bag.products).toHaveLength(0);
  });

  it("buys a rare watering machine and it waters ten percent per cycle", () => {
    const base = seasonFor(NOW);
    const season = {
      ...base,
      shop: { ...base.shop, tools: [{ tool: "autoWater" as const, price: 1_000_000, stock: 1 }] },
    };
    const ledger = makeLedger();
    ledger.coins = 2_000_000;
    const bought = run(ledger, { kind: "buyTool", tool: "autoWater", qty: 1 }, NOW, 0.9, season);
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.ledger.bag.tools.autoWater).toBe(1);
    expect(bought.ledger.coins).toBe(1_000_000);

    // Ten growing, unwatered tomatoes: the machine waters exactly one.
    const farmed = bought.ledger;
    for (let slot = 0; slot < 10; slot += 1) {
      farmed.plots[slot] = {
        slot,
        seed: "tomato",
        plantedAt: NOW,
        readyAt: NOW + 8 * 60_000,
        effects: [],
        watered: false,
        fertilized: false,
        harvests: 0,
        fertilizer: null,
        spray: null,
        pest: false,
        protectedUntil: 0,
      };
    }
    farmed.toolsSettledAt = NOW;
    const later = settleTools(farmed, NOW + FARM_CYCLE_MS);
    const watered = later.plots.filter((plot) => plot?.watered === true).length;
    expect(watered).toBe(1);
  });

  it("builds a warehouse, machines and crafts produce", () => {
    const ledger = makeLedger();
    ledger.coins = 30_000_000;
    const built = run(ledger, { kind: "buildWarehouse" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.ledger.warehouse).toBe(1);

    const machine = run(built.ledger, { kind: "buildMachine", machine: "seedMaker" });
    expect(machine.ok).toBe(true);
    if (!machine.ok) return;
    expect(machine.ledger.machines.seedMaker?.level).toBe(1);

    // One tomato crop becomes three seeds at level 1.
    machine.ledger.bag.crops = [{ item: "tomato", effects: [], qty: 2 }];
    const seeds = run(machine.ledger, { kind: "craftMachine", machine: "seedMaker", item: "tomato" });
    expect(seeds.ok).toBe(true);
    if (!seeds.ok) return;
    expect(seeds.ledger.bag.seeds.tomato).toBe(3);
    expect(seeds.ledger.bag.crops[0]?.qty).toBe(1);

    const mayo = run(seeds.ledger, { kind: "buildMachine", machine: "mayoMaker" });
    expect(mayo.ok).toBe(true);
    if (!mayo.ok) return;
    mayo.ledger.bag.products = [{ product: "egg", star: 2, qty: 1 }];
    const crafted = run(mayo.ledger, { kind: "craftMachine", machine: "mayoMaker" });
    expect(crafted.ok).toBe(true);
    if (!crafted.ok) return;
    expect(crafted.ledger.bag.products).toEqual([{ product: "mayo", star: 2, qty: 1 }]);
  });

  it("sprays pesticide and harvests infested produce at half value", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000;
    ledger.plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW - 5 * 60_000,
      readyAt: NOW - 1_000,
      effects: [],
      pest: true,
      protectedUntil: 0,
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
    };
    const harvested = run(ledger, { kind: "harvest", slot: 0, tree: false });
    expect(harvested.ok).toBe(true);
    if (!harvested.ok) return;
    expect(harvested.ledger.bag.crops[0]?.pest).toBe(true);

    const again = run(ledger, { kind: "sprayPest", slot: 0, tree: false });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.ledger.coins).toBe(9_900);
    expect(again.ledger.plots[0]?.pest).toBe(false);
    expect(again.ledger.plots[0]?.protectedUntil).toBe(NOW + 24 * 60 * 60_000);
  });

  it("slows growth on poor soil, drains it per harvest and renovates all cells", () => {
    const ledger = makeLedger();
    ledger.soil[0] = 50;
    const poor = run(ledger, { kind: "plant", slot: 0, seed: "carrot" });
    expect(poor.ok).toBe(true);
    if (!poor.ok) return;
    const poorPlot = poor.ledger.plots[0];
    if (poorPlot === null || poorPlot === undefined) throw new Error("plot missing");
    const rich = run(ledger, { kind: "plant", slot: 1, seed: "carrot" });
    if (!rich.ok) return;
    const richPlot = rich.ledger.plots[1];
    if (richPlot === null || richPlot === undefined) throw new Error("plot missing");
    expect(poorPlot.readyAt - NOW).toBeGreaterThan(richPlot.readyAt - NOW);

    const harvested = run(poor.ledger, { kind: "harvest", slot: 0, tree: false }, poorPlot.readyAt);
    expect(harvested.ok).toBe(true);
    if (!harvested.ok) return;
    expect(harvested.ledger.soil[0]).toBe(45);

    const richLedger = makeLedger();
    richLedger.coins = 1_000;
    richLedger.soil[0] = 50;
    const renovated = run(richLedger, { kind: "renovateSoil" });
    expect(renovated.ok).toBe(true);
    if (!renovated.ok) return;
    expect(renovated.ledger.coins).toBe(900);
    expect(renovated.ledger.soil.every((value) => value === 100)).toBe(true);
  });

  it("buys the next tab at the compounding price", () => {
    const tabCost = nextTabPrice(1);
    const ledger = makeLedger();
    ledger.coins = 1_500_000;
    const first = run(ledger, { kind: "buyTab" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ledger.tabs).toBe(2);
    expect(first.ledger.plots).toHaveLength(162);
    expect(first.ledger.trees).toHaveLength(54);
    expect(first.ledger.coins).toBe(1_500_000 - tabCost);

    const second = run(first.ledger, { kind: "buyTab" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.ledger.tabs).toBe(3);
    expect(second.ledger.plots).toHaveLength(243);
    expect(second.ledger.coins).toBe(1_500_000 - tabCost * 2);

    const broke = makeLedger();
    broke.coins = tabCost - 1;
    expect(run(broke, { kind: "buyTab" })).toMatchObject({ ok: false, code: "NOT_ENOUGH_COINS" });
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
      { item: "carrot", effects: ["golden"], qty: 2 },
      { item: "corn", effects: [], qty: 1 },
    ];
    const season = seasonFor(NOW);
    const expected = season.prices.carrot * 5 * 2 + season.prices.corn;
    const tax = Math.round(expected * 0.1);
    const sold = run(ledger, { kind: "sellAll" });
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.ledger.coins).toBe(ledger.coins + expected - tax);
    expect(sold.ledger.stats.earned).toBe(expected);
    expect(sold.ledger.stats.tax).toBe(tax);
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
