/**
 * @file garden-rules.spec.ts
 * @brief Economy rules for ASCII Garden, exercised with a controlled clock.
 * @details Harvesting normally takes minutes; the pure rule set lets the tests
 * jump the clock instead of waiting, which keeps the suite fast and deterministic.
 */

import { describe, expect, it } from "vitest";
import {
  ACTIONS_PER_MINUTE,
  BREED_CYCLES,
  EPOCH_MS,
  EFFECTS,
  EVENT_WAVE_MS,
  FARM_CYCLE_MS,
  SPECIAL_PATCH_PRICE,
  SPECIAL_PLOT_PRICE,
  cropSellPrice,
  eventsAt,
  nextTabPrice,
  resolvedCropEffects,
  resolvedTreeEffects,
  rollEffectsFor,
  seasonAt as seasonFor,
  sprayById,
  sprayBoostFor,
  type GardenAction,
} from "@dyno/shared/garden";
import {
  applyGardenAction,
  createLedger,
  ledgerSnapshot,
  settleFarm,
  settleMachines,
  settleTools,
  type GardenLedger,
  settleSpecialReset,
  settleAttachments,
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

  it("awards skill XP for manual but not automatic harvests", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000;
    ledger.bag.seeds = { carrot: 3 };
    const planted = run(ledger, { kind: "plant", slot: 0, seed: "carrot" });
    if (!planted.ok) throw new Error("plant failed");
    const plot = planted.ledger.plots[0];
    if (plot === null || plot === undefined) throw new Error("plot missing");

    const manual = run(planted.ledger, { kind: "harvest", slot: 0, tree: false }, plot.readyAt);
    if (!manual.ok) throw new Error("manual harvest failed");
    const manualXp = manual.ledger.skills.farming.xp;
    expect(manual.ledger.skills.farming.level).toBe(0);
    expect(manualXp).toBeGreaterThan(100);

    const replanted = run(manual.ledger, { kind: "plant", slot: 0, seed: "carrot" });
    if (!replanted.ok) throw new Error("replant failed");
    const nextPlot = replanted.ledger.plots[0];
    if (nextPlot === null || nextPlot === undefined) throw new Error("plot missing");
    const auto = run(
      replanted.ledger,
      { kind: "harvest", slot: 0, tree: false, auto: true },
      nextPlot.readyAt,
    );
    if (!auto.ok) throw new Error("auto harvest failed");
    expect(auto.ledger.skills.farming).toEqual({ level: 0, xp: manualXp + 1 });
  });

  it("plants a bagged seed and rolls the effect deterministically", () => {
    const planted = run(makeLedger(), { kind: "plant", slot: 0, seed: "carrot" }, NOW, 0.01);
    expect(planted.ok).toBe(true);
    if (!planted.ok) return;
    expect(planted.ledger.bag.seeds.carrot).toBe(2);
    const plot = planted.ledger.plots[0];
    expect(plot).not.toBeNull();
    // Compare against the same deterministic roll the rule uses.
    expect(plot?.effects).toEqual(rollEffectsFor(eventsAt(NOW), () => 0.01));
    expect(plot?.readyAt).toBeGreaterThan(NOW);
    expect(planted.ledger.stats.planted).toBe(1);
    expect(planted.ledger.rev).toBe(makeLedger().rev + 1);
  });

  it("bulk plants one seed into every free plot", () => {
    const ledger = makeLedger();
    ledger.bag.seeds.carrot = 5;
    const planted = run(ledger, { kind: "plantAll", seed: "carrot" });
    expect(planted.ok).toBe(true);
    if (!planted.ok) return;
    expect(planted.ledger.bag.seeds.carrot).toBe(0);
    expect(planted.ledger.plots.filter((plot) => plot !== null)).toHaveLength(5);
    expect(planted.ledger.rev).toBe(ledger.rev + 1);
  });

  it("bulk uproots by crop and by value", () => {
    const ledger = makeLedger();
    ledger.plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    ledger.plots[1] = { ...ledger.plots[0]!, slot: 1, seed: "tomato" };
    const bySeed = run(ledger, { kind: "uprootBulk", seed: "carrot" });
    expect(bySeed.ok).toBe(true);
    if (!bySeed.ok) return;
    expect(bySeed.ledger.plots[0]).toBeNull();
    expect(bySeed.ledger.plots[1]?.seed).toBe("tomato");

    const byValue = run(bySeed.ledger, { kind: "uprootBulk", priceBelow: 999_999_999 });
    expect(byValue.ok).toBe(true);
    if (!byValue.ok) return;
    expect(byValue.ledger.plots[1]).toBeNull();
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
    const stack = picked.ledger.bag.crops[0];
    expect(stack).toMatchObject({
      item: "apple",
      effects: resolvedTreeEffects(tree, tree.readyAt),
      qty: 1,
    });
    expect(stack?.star ?? 1).toBeGreaterThanOrEqual(1);
    expect(stack?.star ?? 1).toBeLessThanOrEqual(5);
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
    expect(harvested.ledger.bag.crops[0]).toMatchObject({ item: "carrot", effects: [], qty: 1 });
    expect((harvested.ledger.bag.crops[0]?.star ?? 1) >= 1).toBe(true);
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
    expect(first.ledger.bag.crops[0]).toMatchObject({
      item: "tomato",
      effects: resolvedCropEffects(plot, plot.readyAt),
      qty: 1,
    });

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

  it("sprays boost the next mutation roll without granting one", () => {
    const tomato = makeLedger();
    tomato.bag.seeds.tomato = 1;
    tomato.coins = 100_000;
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
    // Spraying alone never adds a mutation.
    expect(sprayed.ledger.plots[0]?.effects).toEqual(planted.ledger.plots[0]?.effects);

    const picked = run(sprayed.ledger, { kind: "harvest", slot: 0, tree: false }, plot.readyAt, 0.1);
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.ledger.plots[0]?.effects).toEqual(
      rollEffectsFor(eventsAt(plot.readyAt), () => 0.1, {}, sprayBoostFor({ id: "snowSpray", left: 2 })),
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

  it("keeps an egg, hatches a chick and refuses a full coop", () => {
    const ledger = makeLedger();
    ledger.coins = 20_000_000;
    const built = run(ledger, { kind: "buildBuilding", building: "coop" });
    if (!built.ok) throw new Error("coop failed");
    const bought = run(built.ledger, { kind: "buyAnimal", building: "coop", slot: 0, animal: "chicken" });
    if (!bought.ok) throw new Error("buy failed");

    const stocked: GardenLedger = {
      ...bought.ledger,
      bag: { ...bought.ledger.bag, products: [{ product: "egg", star: 1, qty: 2 }] },
    };
    const bred = run(stocked, { kind: "breedAnimal", building: "coop", slot: 0 });
    if (!bred.ok) throw new Error("breed failed");
    expect(bred.ledger.animals.coop[0]?.incubatingUntil).toBe(NOW + BREED_CYCLES * FARM_CYCLE_MS);
    expect(bred.ledger.bag.products?.[0]?.qty).toBe(1);

    // One egg at a time per animal.
    expect(run(bred.ledger, { kind: "breedAnimal", building: "coop", slot: 0 }).ok).toBe(false);

    const hatched = settleFarm(bred.ledger, NOW + BREED_CYCLES * FARM_CYCLE_MS);
    expect(hatched.animals.coop.filter((entry) => entry !== null)).toHaveLength(2);
    expect(hatched.animals.coop[0]?.incubatingUntil ?? 0).toBe(0);

    // Only the coop hatches eggs.
    const onBarn = run(bred.ledger, { kind: "breedAnimal", building: "barn", slot: 0 });
    expect(onBarn.ok).toBe(false);
    if (!onBarn.ok) expect(onBarn.code).toBe("NOT_BREEDABLE");

    // A full coop cannot start another hatch, whatever the bag holds.
    const full: GardenLedger = {
      ...hatched,
      animals: {
        ...hatched.animals,
        coop: hatched.animals.coop.map(() => ({
          kind: "chicken" as const,
          bornAt: NOW,
          pats: 0,
          lastProduceAt: NOW,
        })),
      },
    };
    const denied = run(full, { kind: "breedAnimal", building: "coop", slot: 0 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("NO_FREE_SLOT");
  });

  it("births barn animals into free slots over time", () => {
    const ledger = makeLedger();
    ledger.coins = 100_000_000;
    const built = run(ledger, { kind: "buildBuilding", building: "barn" });
    if (!built.ok) throw new Error("barn failed");
    const bought = run(built.ledger, { kind: "buyAnimal", building: "barn", slot: 0, animal: "cow" });
    if (!bought.ok) throw new Error("buy failed");

    const later = settleFarm(bought.ledger, NOW + 100 * FARM_CYCLE_MS);
    const herd = later.animals.barn.filter((entry) => entry !== null);
    expect(herd.length).toBeGreaterThan(1);
    expect(herd.every((entry) => entry?.kind === "cow")).toBe(true);
  });

  it("grows an empty pond every ten cycles", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    const built = run(ledger, { kind: "buildBuilding", building: "pond" });
    if (!built.ok) throw new Error("pond failed");
    const later = settleFarm(built.ledger, NOW + 10 * FARM_CYCLE_MS);
    expect(later.pondGrowth).toBe(10);
    const capped = settleFarm(later, NOW + 200 * FARM_CYCLE_MS);
    expect(capped.pondGrowth).toBe(100);
  });

  it("builds a pond, grows it and sells its stock for meat", () => {
    const ledger = makeLedger();
    ledger.coins = 50_000_000;
    const built = run(ledger, { kind: "buildBuilding", building: "pond" });
    if (!built.ok) throw new Error("pond failed");
    expect(built.ledger.buildings.pond).toBe(1);
    expect(built.ledger.coins).toBe(44_000_000);

    const fish = run(built.ledger, { kind: "buyAnimal", building: "pond", slot: 0, animal: "fish" });
    if (!fish.ok) throw new Error("fish failed");
    const snail = run(fish.ledger, { kind: "buyAnimal", building: "pond", slot: 1, animal: "snail" });
    if (!snail.ok) throw new Error("snail failed");

    const later = settleFarm(snail.ledger, NOW + 20 * FARM_CYCLE_MS);
    expect(later.pondGrowth).toBe(20);
    const products = later.bag.products ?? [];
    expect(products.some((stack) => stack.product === "roe")).toBe(true);
    expect(products.some((stack) => stack.product === "snailMeat")).toBe(true);

    const before = later.coins;
    const meat = run(later, { kind: "sellAnimal", building: "pond", slot: 0 }, NOW + 20 * FARM_CYCLE_MS);
    if (!meat.ok) throw new Error("sell failed");
    expect(meat.ledger.animals.pond[0]).toBeNull();
    expect(meat.ledger.coins).toBeGreaterThan(before);
  });

  it("sells premium plots sequentially and grows brainrot crops at x2", () => {
    const ledger = makeLedger();
    ledger.coins = 100_000_000_000;

    expect(run(ledger, { kind: "plantSpecial", slot: 0, seed: "carrot" }).ok).toBe(false);
    const first = run(ledger, { kind: "buySpecialPlot" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ledger.specialOwned).toBe(1);
    expect(first.ledger.coins).toBe(ledger.coins - 1_000_000_000);

    const planted = run(first.ledger, { kind: "plantSpecial", slot: 0, seed: "carrot" });
    expect(planted.ok).toBe(true);
    if (!planted.ok) return;
    const plot = planted.ledger.specialPlots[0];
    if (plot === null || plot === undefined) throw new Error("special crop missing");
    expect(plot.effects).toContain("brainrot");
    // Twice as fast as a normal carrot.
    const normal = run(makeLedger(), { kind: "plant", slot: 0, seed: "carrot" });
    if (!normal.ok) throw new Error("normal plant failed");
    expect(plot.readyAt - NOW).toBeLessThan((normal.ledger.plots[0]?.readyAt ?? 0) - NOW);

    const harvested = run(planted.ledger, { kind: "harvestSpecial", slot: 0 }, plot.readyAt);
    expect(harvested.ok).toBe(true);
    if (!harvested.ok) return;
    const stack = harvested.ledger.bag.crops.find((entry) => entry.item === "carrot");
    expect(stack?.effects).toContain("brainrot");
    expect(stack?.star).toBe(5);
    expect(harvested.ledger.specialPlots[0]).toBeNull();

    // The next plot costs twice the first one.
    const second = run(harvested.ledger, { kind: "buySpecialPlot" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.ledger.specialOwned).toBe(2);
    expect(second.ledger.coins).toBe(harvested.ledger.coins - 2_000_000_000);
  });

  it("only keeps positive weather mutations on premium crops", () => {
    const ledger = makeLedger();
    ledger.specialOwned = 1;
    ledger.specialPlots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW - 6 * 60 * 60_000,
      readyAt: NOW - 1_000,
      effects: ["brainrot"],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    const harvested = run(ledger, { kind: "harvestSpecial", slot: 0 }, NOW);
    expect(harvested.ok).toBe(true);
    if (!harvested.ok) return;
    const stack = harvested.ledger.bag.crops[0];
    expect(stack?.effects).toContain("brainrot");
    const weather = (stack?.effects ?? []).filter((id) => id !== "brainrot");
    expect(weather.length).toBeGreaterThan(0);
    for (const id of weather) {
      const effect = EFFECTS.find((entry) => entry.id === id);
      expect(effect?.multiplier ?? 0).toBeGreaterThan(1);
    }
  });

  it("migrates premium crops to normal soil once and wipes ownership", () => {
    const ledger = makeLedger();
    ledger.specialVersion = 0;
    ledger.specialOwned = 1;
    ledger.specialPlots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: ["brainrot"],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    const reset = settleSpecialReset(ledger, NOW);
    expect(reset.specialOwned).toBe(0);
    expect(reset.specialPlots.every((plot) => plot === null)).toBe(true);
    expect(reset.plots[0]?.seed).toBe("carrot");
  });

  it("mounts passive machines and the sprinkler waters crops", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    ledger.plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    const mounted = run(ledger, { kind: "attachMachine", slot: "garden", id: "sprinkler" });
    expect(mounted.ok).toBe(true);
    if (!mounted.ok) return;
    expect(mounted.ledger.attachments.garden).toBe("sprinkler");
    expect(mounted.ledger.coins).toBe(ledger.coins - 3_000_000);

    const watered = settleAttachments(mounted.ledger, NOW + FARM_CYCLE_MS);
    expect(watered.plots[0]?.watered).toBe(true);

    const removed = run(mounted.ledger, { kind: "detachMachine", slot: "garden" });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.ledger.attachments.garden).toBeUndefined();
  });

  it("juices crops with the new machine", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    ledger.bag.crops = [{ item: "apple", effects: [], qty: 1 }];
    const built = run(ledger, { kind: "buildWarehouse" });
    if (!built.ok) throw new Error("warehouse failed");
    const machine = run(built.ledger, { kind: "buildMachine", machine: "juicer" });
    if (!machine.ok) throw new Error("juicer failed");
    const crafted = run(machine.ledger, { kind: "craftMachine", machine: "juicer", item: "apple" });
    expect(crafted.ok).toBe(true);
    if (!crafted.ok) return;
    expect(crafted.ledger.bag.products?.some((stack) => stack.product === "juice")).toBe(true);
  });

  it("fertilizes the whole garden and bills per plant without bag stock", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000;
    const crop = (slot: number, readyAt: number) => ({
      slot,
      seed: "carrot" as const,
      plantedAt: NOW,
      readyAt,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    });
    ledger.plots[0] = crop(0, NOW + 10 * 60_000);
    ledger.plots[1] = crop(1, NOW + 10 * 60_000);
    // Already fed and ripe plants are skipped.
    ledger.plots[2] = { ...crop(2, NOW + 10 * 60_000), fertilized: true };
    ledger.plots[3] = crop(3, NOW - 1_000);
    ledger.trees[0] = {
      slot: 0,
      tree: "apple",
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };

    const result = run(ledger, { kind: "fertilizeAll", supply: "speedGrow" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.bag.supplies.speedGrow ?? 0).toBe(0);
    expect(result.ledger.coins).toBe(1_000 - 3 * 60);
    expect(result.ledger.stats.spent).toBe(3 * 60);
    expect(result.ledger.plots[0]?.fertilized).toBe(true);
    expect(result.ledger.plots[1]?.fertilized).toBe(true);
    expect(result.ledger.plots[2]?.fertilizer).toBeNull();
    expect(result.ledger.plots[3]?.fertilized).toBe(false);
    expect(result.ledger.trees[0]?.fertilized).toBe(true);
    // The speedGrow multiplier shortens the remaining growth.
    expect(result.ledger.plots[0]?.readyAt).toBeLessThan(NOW + 10 * 60_000);
  });

  it("stops the bulk bill at the wallet and refuses an empty target list", () => {
    const ledger = makeLedger();
    ledger.coins = 130;
    const crop = (slot: number) => ({
      slot,
      seed: "carrot" as const,
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    });
    ledger.plots[0] = crop(0);
    ledger.plots[1] = crop(1);
    ledger.plots[2] = crop(2);

    const partial = run(ledger, { kind: "fertilizeAll", supply: "speedGrow" });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.ledger.coins).toBe(10);
    expect(partial.ledger.plots.filter((plot) => plot?.fertilized === true)).toHaveLength(2);

    const empty = run(makeLedger(), { kind: "sprayAll", supply: "goldenSpray" });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe("NOTHING_TO_DO");

    const broke = run({ ...ledger, coins: 0 }, { kind: "fertilizeAll", supply: "speedGrow" });
    expect(broke.ok).toBe(false);
    if (!broke.ok) expect(broke.code).toBe("NOT_ENOUGH_COINS");
  });

  it("sprays every uncharged plant at once and bills per plant", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000_000;
    const crop = (slot: number, spray: { id: "frostSpray"; left: number } | null) => ({
      slot,
      seed: "carrot" as const,
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray,
      pest: false,
      protectedUntil: 0,
    });
    ledger.plots[0] = crop(0, null);
    ledger.plots[1] = crop(1, { id: "frostSpray", left: 1 });
    ledger.trees[0] = {
      slot: 0,
      tree: "apple",
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };

    const result = run(ledger, { kind: "sprayAll", supply: "goldenSpray" }, NOW, 0.05);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.bag.supplies.goldenSpray ?? 0).toBe(0);
    expect(result.ledger.coins).toBe(1_000_000 - 2 * 25_000);
    expect(result.ledger.plots[0]?.spray?.id).toBe("goldenSpray");
    expect(result.ledger.plots[1]?.spray?.id).toBe("frostSpray");
    expect(result.ledger.trees[0]?.spray?.id).toBe("goldenSpray");
    // Charging a spray never adds a mutation by itself.
    expect(result.ledger.plots[0]?.effects).toEqual([]);
    expect(result.ledger.trees[0]?.effects).toEqual([]);
  });

  it("tracks shop stock per restock and refuses sold-out buys", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000_000;
    const base = seasonFor(NOW);
    const carrot = base.shop.offers.find((offer) => offer.seed === "carrot");
    if (carrot === undefined) throw new Error("no carrot offer");
    const season = {
      ...base,
      shop: {
        ...base.shop,
        offers: [{ ...carrot, stock: 2 }, ...base.shop.offers.filter((offer) => offer.seed !== "carrot")],
      },
    };

    const first = applyGardenAction(
      ledger,
      { kind: "buySeed", seed: "carrot", qty: 1 },
      season,
      NOW,
      () => 0.5,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ledger.shopStock.carrot).toBe(1);
    const second = applyGardenAction(
      first.ledger,
      { kind: "buySeed", seed: "carrot", qty: 1 },
      season,
      NOW,
      () => 0.5,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.ledger.shopStock.carrot).toBe(0);
    const third = applyGardenAction(
      second.ledger,
      { kind: "buySeed", seed: "carrot", qty: 1 },
      season,
      NOW,
      () => 0.5,
    );
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("SHOP_SOLD_OUT");

    // The next restock replenishes the shelf.
    const nextSeason = { ...season, shop: { ...season.shop, restockAt: season.shop.restockAt + 1 } };
    const restocked = applyGardenAction(
      second.ledger,
      { kind: "buySeed", seed: "carrot", qty: 1 },
      nextSeason,
      NOW,
      () => 0.5,
    );
    expect(restocked.ok).toBe(true);
  });

  it("reclaims a seed with a reclaimer", () => {
    const ledger = makeLedger();
    ledger.plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };

    const denied = run(ledger, { kind: "reclaimSeed", slot: 0 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("NO_TOOL");

    ledger.bag.tools = { reclaimer: 1 };
    const reclaimed = run(ledger, { kind: "reclaimSeed", slot: 0 });
    expect(reclaimed.ok).toBe(true);
    if (!reclaimed.ok) return;
    expect(reclaimed.ledger.plots[0]).toBeNull();
    expect(reclaimed.ledger.bag.seeds.carrot).toBe(4);
    expect(reclaimed.ledger.bag.tools.reclaimer ?? 0).toBe(0);

    // A pinned plant keeps its seed.
    const pinned: GardenLedger = {
      ...ledger,
      plots: [{ ...ledger.plots[0]!, favorite: true }, ...ledger.plots.slice(1)],
      bag: { ...ledger.bag, tools: { reclaimer: 1 } },
    };
    const refused = run(pinned, { kind: "reclaimSeed", slot: 0 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("FAVORITE_LOCKED");
  });

  it("moves a crop and a tree with a shovel", () => {
    const ledger = makeLedger();
    ledger.bag.tools = { shovel: 2 };
    const crop = {
      slot: 0,
      seed: "carrot" as const,
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    ledger.plots[0] = crop;

    const moved = run(ledger, { kind: "movePlant", from: 0, to: 5, tree: false });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.ledger.plots[0]).toBeNull();
    expect(moved.ledger.plots[5]?.seed).toBe("carrot");
    expect(moved.ledger.plots[5]?.slot).toBe(5);
    expect(moved.ledger.plots[5]?.readyAt).toBe(crop.readyAt);
    expect(moved.ledger.bag.tools.shovel).toBe(1);

    // The destination must be empty.
    moved.ledger.plots[6] = { ...crop, slot: 6 };
    const blocked = run(moved.ledger, { kind: "movePlant", from: 5, to: 6, tree: false });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("PLOT_OCCUPIED");

    moved.ledger.trees[0] = {
      slot: 0,
      tree: "apple",
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    const movedTree = run(moved.ledger, { kind: "movePlant", from: 0, to: 1, tree: true });
    expect(movedTree.ok).toBe(true);
    if (!movedTree.ok) return;
    expect(movedTree.ledger.trees[1]?.tree).toBe("apple");
    expect(movedTree.ledger.trees[0]).toBeNull();
    expect(movedTree.ledger.bag.tools.shovel).toBe(0);

    const noTool = run(movedTree.ledger, { kind: "movePlant", from: 1, to: 2, tree: true });
    expect(noTool.ok).toBe(false);
    if (!noTool.ok) expect(noTool.code).toBe("NO_TOOL");
  });

  it("pins a plant so nothing harvests, uproots, moves or reclaims it", () => {
    const ledger = makeLedger();
    ledger.bag.tools = { favoriteLock: 1, shovel: 1, reclaimer: 1 };
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

    const pinned = run(ledger, { kind: "toggleFavorite", slot: 0, tree: false });
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    expect(pinned.ledger.plots[0]?.favorite).toBe(true);
    expect(pinned.ledger.bag.tools.favoriteLock ?? 0).toBe(0);

    for (const action of [
      { kind: "harvest", slot: 0, tree: false },
      { kind: "uproot", slot: 0, tree: false },
      { kind: "movePlant", from: 0, to: 1, tree: false },
      { kind: "reclaimSeed", slot: 0 },
    ] as GardenAction[]) {
      const refused = run(pinned.ledger, action);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe("FAVORITE_LOCKED");
    }
    // Bulk harvest skips the pinned plant instead of failing on it.
    expect(run(pinned.ledger, { kind: "harvestAll" }).ok).toBe(false);

    // Unpinning is free; pinning again needs another lock.
    const unpinned = run(pinned.ledger, { kind: "toggleFavorite", slot: 0, tree: false });
    expect(unpinned.ok).toBe(true);
    if (!unpinned.ok) return;
    expect(unpinned.ledger.plots[0]?.favorite).toBe(false);
    const noLock = run(unpinned.ledger, { kind: "toggleFavorite", slot: 0, tree: false });
    expect(noLock.ok).toBe(false);
    if (!noLock.ok) expect(noLock.code).toBe("NO_TOOL");
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

    // One tomato crop becomes five seeds at level 1.
    machine.ledger.bag.crops = [{ item: "tomato", effects: [], qty: 2 }];
    const seeds = run(machine.ledger, { kind: "craftMachine", machine: "seedMaker", item: "tomato" });
    expect(seeds.ok).toBe(true);
    if (!seeds.ok) return;
    expect(seeds.ledger.bag.seeds.tomato).toBe(5);
    expect(seeds.ledger.bag.crops[0]?.qty).toBe(1);

    const mayo = run(seeds.ledger, { kind: "buildMachine", machine: "mayoMaker" });
    expect(mayo.ok).toBe(true);
    if (!mayo.ok) return;
    mayo.ledger.bag.products = [{ product: "egg", star: 2, qty: 1 }];
    const crafted = run(mayo.ledger, { kind: "craftMachine", machine: "mayoMaker" });
    expect(crafted.ok).toBe(true);
    if (!crafted.ok) return;
    expect(crafted.ledger.bag.products).toEqual([{ product: "mayo", star: 2, qty: 2 }]);
  });

  it("stacks copies of the same mutation on one fruit", () => {
    const ledger = makeLedger();
    ledger.plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW - 5 * 60_000,
      readyAt: NOW - 1_000,
      effects: ["diamond", "diamond"],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    const harvested = run(ledger, { kind: "harvest", slot: 0, tree: false });
    expect(harvested.ok).toBe(true);
    if (!harvested.ok) return;
    const stack = harvested.ledger.bag.crops[0];
    expect(stack?.effects.filter((id) => id === "diamond")).toHaveLength(2);
    if (stack === undefined) return;
    const doubled = cropSellPrice({ item: "carrot", effects: stack.effects, qty: 1 }, seasonFor(NOW));
    const single = cropSellPrice({ item: "carrot", effects: ["diamond"], qty: 1 }, seasonFor(NOW));
    expect(doubled).toBeGreaterThan(single * 8);
  });

  it("queues machine batches and processes them in order", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    ledger.bag.crops = [{ item: "apple", effects: [], qty: 2 }];
    const built = run(ledger, { kind: "buildWarehouse" });
    if (!built.ok) throw new Error("warehouse failed");
    const keg = run(built.ledger, { kind: "buildMachine", machine: "keg" });
    if (!keg.ok) throw new Error("keg failed");

    const first = run(keg.ledger, { kind: "queueMachine", machine: "keg", item: "apple" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ledger.machines.keg?.queue).toHaveLength(1);
    expect(first.ledger.bag.crops[0]?.qty).toBe(1);

    const second = run(first.ledger, { kind: "queueMachine", machine: "keg", item: "apple" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.ledger.bag.crops).toHaveLength(0);
    expect(second.ledger.machines.keg?.queue).toHaveLength(2);

    const started = settleMachines(second.ledger, NOW);
    expect(started.machines.keg?.job?.item).toBe("apple");
    expect(started.machines.keg?.queue).toHaveLength(1);

    const afterFirst = settleMachines(started, NOW + 4 * FARM_CYCLE_MS);
    const afterSecond = settleMachines(afterFirst, NOW + 8 * FARM_CYCLE_MS);
    expect(afterSecond.bag.products?.filter((stack) => stack.product === "wine")).toHaveLength(1);
    expect(afterSecond.bag.products?.find((stack) => stack.product === "wine")?.qty).toBe(4);
  });

  it("refunds queued machine batches when the queue is cleared", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    ledger.bag.crops = [{ item: "apple", effects: [], qty: 2 }];
    const built = run(ledger, { kind: "buildWarehouse" });
    if (!built.ok) throw new Error("warehouse failed");
    const keg = run(built.ledger, { kind: "buildMachine", machine: "keg" });
    if (!keg.ok) throw new Error("keg failed");
    const first = run(keg.ledger, { kind: "queueMachine", machine: "keg", item: "apple" });
    if (!first.ok) throw new Error("queue failed");
    const second = run(first.ledger, { kind: "queueMachine", machine: "keg", item: "apple" });
    if (!second.ok) throw new Error("queue failed");
    const cleared = run(second.ledger, { kind: "clearMachineQueue", machine: "keg" });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.ledger.machines.keg?.queue).toHaveLength(0);
    expect(cleared.ledger.bag.crops[0]?.qty).toBe(2);
  });

  it("boosts machine output and speed with levels", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    ledger.bag.crops = [{ item: "tomato", effects: [], qty: 1 }];
    const built = run(ledger, { kind: "buildWarehouse" });
    if (!built.ok) throw new Error("warehouse failed");
    const machine = run(built.ledger, { kind: "buildMachine", machine: "seedMaker" });
    if (!machine.ok) throw new Error("machine failed");
    machine.ledger.machines.seedMaker = { level: 3, lastCraftAt: 0 };
    const crafted = run(machine.ledger, { kind: "craftMachine", machine: "seedMaker", item: "tomato" });
    expect(crafted.ok).toBe(true);
    if (!crafted.ok) return;
    expect(crafted.ledger.bag.seeds.tomato).toBe(9);
  });

  it("dries crops and fruit with a price-graded star", () => {
    const ledger = makeLedger();
    ledger.coins = 30_000_000;
    const built = run(ledger, { kind: "buildWarehouse" });
    if (!built.ok) throw new Error("warehouse failed");
    const dryer = run(built.ledger, { kind: "buildMachine", machine: "dryer" });
    if (!dryer.ok) throw new Error("dryer failed");
    dryer.ledger.bag.crops = [
      { item: "carrot", effects: [], qty: 1 },
      { item: "apple", effects: [], qty: 1 },
    ];

    const dried = run(dryer.ledger, { kind: "craftMachine", machine: "dryer", item: "carrot" });
    expect(dried.ok).toBe(true);
    if (!dried.ok) return;
    expect(dried.ledger.bag.products).toEqual([{ product: "dried", star: 1, qty: 2 }]);

    // The dryer runs on a three-cycle cooldown.
    const early = run(dried.ledger, { kind: "craftMachine", machine: "dryer", item: "apple" });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe("MACHINE_COOLDOWN");

    const fruit = run(
      dried.ledger,
      { kind: "craftMachine", machine: "dryer", item: "apple" },
      NOW + 3 * FARM_CYCLE_MS,
    );
    expect(fruit.ok).toBe(true);
    if (!fruit.ok) return;
    expect(fruit.ledger.bag.products?.find((stack) => stack.star === 4)).toMatchObject({
      product: "dried",
      qty: 2,
    });

    // The seed maker still refuses fruit.
    const seedMaker = run(fruit.ledger, { kind: "buildMachine", machine: "seedMaker" });
    if (!seedMaker.ok) throw new Error("seed maker failed");
    const refused = run(seedMaker.ledger, {
      kind: "craftMachine",
      machine: "seedMaker",
      item: "apple",
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("NO_INPUT");
  });

  it("brews a keg job without leaving the input in the bag", () => {
    const ledger = makeLedger();
    ledger.coins = 30_000_000;
    const built = run(ledger, { kind: "buildWarehouse" });
    if (!built.ok) throw new Error("warehouse failed");
    const keg = run(built.ledger, { kind: "buildMachine", machine: "keg" });
    if (!keg.ok) throw new Error("keg failed");
    keg.ledger.bag.crops = [
      { item: "apple", effects: [], qty: 1 },
      { item: "carrot", effects: [], qty: 1 },
    ];

    const scheduled = run(keg.ledger, { kind: "craftMachine", machine: "keg", item: "apple" });
    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) return;
    // The apple left the bag, so the market cannot sell it while it brews.
    expect(scheduled.ledger.bag.crops).toEqual([{ item: "carrot", effects: [], qty: 1 }]);
    expect(scheduled.ledger.machines.keg?.job).toMatchObject({
      item: "apple",
      startedAt: NOW,
      readyAt: NOW + 4 * FARM_CYCLE_MS,
    });

    const early = run(scheduled.ledger, { kind: "collectMachine", machine: "keg" });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe("NOT_READY");

    const settled = settleMachines(scheduled.ledger, NOW + 4 * FARM_CYCLE_MS);
    expect(settled.machines.keg?.job).toBeUndefined();
    expect(settled.bag.products).toEqual([{ product: "wine", star: 4, qty: 2 }]);

    // Once idle again the keg accepts the next fruit.
    const next = run(
      settled,
      { kind: "craftMachine", machine: "keg", item: "carrot" },
      NOW + 4 * FARM_CYCLE_MS,
    );
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ledger.machines.keg?.job?.item).toBe("carrot");
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

    // Still covered: a second spray is refused and costs nothing.
    const covered = run(again.ledger, { kind: "sprayPest", slot: 0, tree: false });
    expect(covered.ok).toBe(false);
    if (!covered.ok) expect(covered.code).toBe("ALREADY_PROTECTED");
  });

  it("re-sprays only the plants whose pesticide cover lapsed", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000;
    const crop = (slot: number, protectedUntil: number) => ({
      slot,
      seed: "carrot" as const,
      plantedAt: NOW,
      readyAt: NOW + 10 * 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil,
    });
    ledger.plots[0] = crop(0, NOW + 60_000);
    ledger.plots[1] = crop(1, 0);
    ledger.plots[2] = crop(2, 0);

    const sprayed = run(ledger, { kind: "sprayPestAll" });
    expect(sprayed.ok).toBe(true);
    if (!sprayed.ok) return;
    // Only the two unprotected plants are charged.
    expect(sprayed.ledger.coins).toBe(10_000 - 2 * 100);
    expect(sprayed.ledger.plots[0]?.protectedUntil).toBe(NOW + 60_000);
    expect(sprayed.ledger.plots[1]?.protectedUntil).toBe(NOW + 24 * 60 * 60_000);

    // With full cover there is nothing left to spray.
    const again = run(sprayed.ledger, { kind: "sprayPestAll" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("NOTHING_TO_DO");
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
