/**
 * @file bot-brain.ts
 * @brief The heuristic that drives the ten market-maker bots.
 * @details Bots harvest, sell, replant the most profitable affordable seed,
 * buy land when rich and spend spare coins on fertilizer/spray. Every tick is
 * capped by `limit`, and one action per second of game time is never exceeded,
 * so a bot cannot spam the Durable Object or the market.
 */

import {
  CROPS_PER_TAB,
  HARVEST_ALL_COST,
  MAX_TABS,
  PLOTS_PER_PATCH,
  SEEDS,
  TREES,
  cropSellPrice,
  effectsMultiplier,
  resolvedCropEffects,
  type CropStack,
  type PlotState,
  WATER_ALL_COST,
  seedById,
  treeById,
  type GardenAction,
  type SeasonSnapshot,
  type SeedId,
} from "@dyno/shared/garden";
import { nextPatchPrice, nextTabPrice } from "@dyno/shared/garden";
import type { GardenLedger } from "./garden-rules";

/** Hard cap on actions one bot may take per tick. */
export const BOT_ACTION_LIMIT = 12;

/** @brief Effective purchase price of a seed. */
function seedBuyPrice(seedId: SeedId, season: SeasonSnapshot): number {
  const offer = season.shop.offers.find((entry) => entry.seed === seedId);
  return season.buyPrices?.[seedId] ?? offer?.price ?? seedById(seedId)?.buy ?? 0;
}

/** @brief Best net coin-per-minute seed the bot can afford right now. */
function bestSeed(
  ledger: GardenLedger,
  season: SeasonSnapshot,
  focus?: SeedId,
): { id: SeedId; score: number } | null {
  let best: { id: SeedId; score: number } | null = null;
  for (const seed of SEEDS) {
    if (focus !== undefined && seed.id !== focus) continue;
    const owned = ledger.bag.seeds[seed.id] ?? 0;
    const offer = season.shop.offers.find((entry) => entry.seed === seed.id);
    const stock = ledger.shopStock[seed.id] ?? offer?.stock ?? 0;
    const price = seedBuyPrice(seed.id, season);
    // A seed already in the bag is free to plant; an empty bag needs shop stock
    // and enough coins for the market-adjusted price.
    if (owned < 1 && (stock < 1 || ledger.coins < price)) continue;
    const sell = season.prices[seed.id] ?? seed.sell;
    const cycles = seed.regrow ? 3 : 1;
    const cost = owned > 0 ? 0 : price;
    const score = (sell * cycles - cost) / Math.max(1, seed.growMs);
    if (best === null || score > best.score) best = { id: seed.id, score };
  }
  return best;
}

/** @brief First free crop slot in an open patch, if any. */
function freeCropSlot(ledger: GardenLedger): number | null {
  for (let tab = 0; tab < ledger.tabs; tab += 1) {
    const open = ledger.unlockedPatches[tab] ?? 1;
    for (let patch = 0; patch < open; patch += 1) {
      for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
        const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
        if ((ledger.plots[slot] ?? null) === null) return slot;
      }
    }
  }
  return null;
}

/** @brief Every free crop slot in an open patch. */
function freeCropSlots(ledger: GardenLedger): number[] {
  const slots: number[] = [];
  for (let tab = 0; tab < ledger.tabs; tab += 1) {
    const open = ledger.unlockedPatches[tab] ?? 1;
    for (let patch = 0; patch < open; patch += 1) {
      for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
        const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
        if ((ledger.plots[slot] ?? null) === null) slots.push(slot);
      }
    }
  }
  return slots;
}

/** @brief Whether a crop slot belongs to an open patch. */
function cropSlotOpen(ledger: GardenLedger, slot: number): boolean {
  const tab = Math.floor(slot / CROPS_PER_TAB);
  const local = slot % CROPS_PER_TAB;
  const patch = Math.floor(local / PLOTS_PER_PATCH);
  return (ledger.unlockedPatches[tab] ?? 0) > patch;
}

/** @brief Expected gross value of one growing plant with its mutations. */
function expectedCropValue(plot: PlotState, season: SeasonSnapshot, now: number): number {
  // First-pick value only: a reharvest crop that cannot cover its seed price on
  // the first pick is still a loss, so bots should replace it.
  const effects = resolvedCropEffects(plot, now);
  return cropSellPrice({ item: plot.seed, effects, pest: plot.pest, qty: 1 } as CropStack, season);
}

/** @brief First free fruit slot, if any. */
function freeTreeSlot(ledger: GardenLedger): number | null {
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    if ((ledger.trees[slot] ?? null) === null) return slot;
  }
  return null;
}

/** @brief Cheapest tab that still has a locked crop patch. */
function cheapestPatchTarget(ledger: GardenLedger): { tab: number; cost: number } | null {
  let target: { tab: number; cost: number } | null = null;
  for (let tab = 0; tab < ledger.tabs; tab += 1) {
    const open = ledger.unlockedPatches[tab] ?? 1;
    if (open >= PLOTS_PER_PATCH) continue;
    const cost = nextPatchPrice(open);
    if (target === null || cost < target.cost) target = { tab, cost };
  }
  return target;
}

/**
 * @brief Plans the next bounded batch of bot actions.
 * @param ledger Current bot garden.
 * @param season Market-adjusted season.
 * @param now Server clock.
 * @param rng Random source for variety.
 * @param limit Action cap.
 */
export function planBotActions(
  ledger: GardenLedger,
  season: SeasonSnapshot,
  now: number,
  rng: () => number,
  limit = BOT_ACTION_LIMIT,
  focus?: SeedId,
): GardenAction[] {
  const actions: GardenAction[] = [];
  const push = (action: GardenAction): void => {
    if (actions.length < limit) actions.push(action);
  };

  // Harvest the ripest, most valuable plants first (free, unlike "harvest all").
  const ready: Array<{ slot: number; tree: boolean; value: number }> = [];
  for (let tab = 0; tab < ledger.tabs; tab += 1) {
    const open = ledger.unlockedPatches[tab] ?? 1;
    for (let patch = 0; patch < open; patch += 1) {
      for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
        const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
        const plotState = ledger.plots[slot] ?? null;
        if (plotState !== null && now >= plotState.readyAt) {
          ready.push({ slot, tree: false, value: season.prices[plotState.seed] ?? 0 });
        }
      }
    }
  }
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const tree = ledger.trees[slot] ?? null;
    if (tree !== null && now >= tree.readyAt) {
      ready.push({ slot, tree: true, value: season.fruitPrices[tree.tree] ?? 0 });
    }
  }
  ready.sort((left, right) => right.value - left.value);
  for (const entry of ready.slice(0, Math.max(0, limit - 6))) {
    push({ kind: "harvest", slot: entry.slot, tree: entry.tree, auto: true });
  }

  if (ledger.bag.crops.length > 0) push({ kind: "sellAll" });

  // Uproot crops that would sell at a loss (or that are not the focused crop),
  // freeing their slot for the best replant.
  const best = bestSeed(ledger, season, focus);
  const uprootTargets: number[] = [];
  if (best !== null) {
    for (let slot = 0; slot < ledger.plots.length; slot += 1) {
      if (uprootTargets.length >= 2) break;
      const plot = ledger.plots[slot] ?? null;
      if (plot === null || now >= plot.readyAt) continue;
      if (cropSlotOpen(ledger, slot) === false) continue;
      // Only a genuine loss justifies uprooting: the first fruit of the current
      // plant would sell for less than (or exactly) the seed price. Merely
      // suboptimal crops stay in the ground until harvested.
      const value = expectedCropValue(plot, season, now);
      const seedCost = seedBuyPrice(plot.seed, season);
      if (value > seedCost) continue;
      uprootTargets.push(slot);
      push({ kind: "uproot", slot, tree: false });
    }
  }

  // Replant the best net-positive seed, buying from the shop when the bag is empty.
  const targets = [...uprootTargets, ...freeCropSlots(ledger)];
  let planted = 0;
  while (planted < 4 && planted < targets.length) {
    const slot = targets[planted];
    if (slot === undefined) break;
    const seedId = best?.id ?? null;
    if (seedId === null) break;
    const owned = ledger.bag.seeds[seedId] ?? 0;
    if (owned < 1) {
      const price = seedBuyPrice(seedId, season);
      if (ledger.coins < price) break;
      push({ kind: "buySeed", seed: seedId, qty: 1 });
      break;
    }
    push({ kind: "plant", slot, seed: seedId });
    planted += 1;
  }

  // A fruit tree when there is spare money; trees keep paying forever.
  const treeSlot = freeTreeSlot(ledger);
  const affordableTree = TREES.find((tree) => ledger.coins > tree.buy * 3);
  if (focus === undefined && treeSlot !== null && affordableTree !== undefined && rng() < 0.35) {
    push({ kind: "plantTree", slot: treeSlot, tree: affordableTree.id });
  }

  // Land: open the next 3x3 patch, then a new tab, when coins are comfortable.
  const patch = cheapestPatchTarget(ledger);
  if (patch !== null && ledger.coins > patch.cost * 3) {
    push({ kind: "buyPatch", tab: patch.tab });
  } else if (patch === null && ledger.tabs < MAX_TABS && ledger.coins > nextTabPrice(ledger.tabs) * 2) {
    push({ kind: "buyTab" });
  }

  // Spare coins: buy a cheap supply and use it on a growing plant.
  if (ledger.coins > 250 && rng() < 0.4) {
    const supply = (["compost", "speedGrow"] as const)[Math.floor(rng() * 2)];
    if (supply !== undefined) push({ kind: "buySupply", supply, qty: 1 });
    let target: number | null = null;
    for (let slot = 0; slot < ledger.plots.length; slot += 1) {
      const plot = ledger.plots[slot] ?? null;
      if (plot !== null && now < plot.readyAt) {
        target = slot;
        break;
      }
    }
    if (target !== null) push({ kind: "fertilize", slot: target, supply: "compost", tree: false });
  }

  // Keep the task cheap: water-all only when it is clearly worth the fee.
  const unwatered = ledger.plots.filter(
    (plot) => plot !== null && now < plot.readyAt && !plot.watered,
  ).length;
  if (unwatered >= 4 && ledger.coins > unwatered * WATER_ALL_COST * 5) {
    push({ kind: "waterAll" });
  }
  void HARVEST_ALL_COST;
  return actions;
}
