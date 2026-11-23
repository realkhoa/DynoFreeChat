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

/** What the other gardens are currently growing, keyed by planted id. */
export type NeighborhoodSurvey = Readonly<Record<string, number>>;

/**
 * @brief Best net coin-per-minute seed the bot can afford right now.
 * @param others Neighbourhood survey: crops other gardens already planted.
 * @details Profit wins, but a seed everybody else is growing is discounted so
 * the bot diversifies instead of flooding one crop.
 */
export function bestBotSeed(
  ledger: GardenLedger,
  season: SeasonSnapshot,
  focus?: SeedId,
  others?: NeighborhoodSurvey,
): { id: SeedId; score: number } | null {
  const otherTotal = Object.values(others ?? {}).reduce((sum, count) => sum + count, 0);
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
    const perMinute = (sell * cycles - cost) / Math.max(1, seed.growMs);
    if (perMinute <= 0) continue;
    const share = otherTotal > 0 ? (others?.[seed.id] ?? 0) / otherTotal : 0;
    const score = perMinute * (1 - Math.min(0.75, share * 1.5));
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
 * @param focus Optional crop the bot only ever plants.
 * @param others Neighbourhood survey of what other gardens are growing.
 * @details Greedy and merciless: dead or loss-making plants are uprooted at
 * once, ripe plants are harvested and sold, then freed slots are replanted with
 * the best profit-per-minute seed that the neighbourhood is not already
 * flooding. Water, land and supplies are bought when clearly profitable.
 */
export function planBotActions(
  ledger: GardenLedger,
  season: SeasonSnapshot,
  now: number,
  rng: () => number,
  limit = BOT_ACTION_LIMIT,
  focus?: SeedId,
  others?: NeighborhoodSurvey,
): GardenAction[] {
  const actions: GardenAction[] = [];
  const push = (action: GardenAction): void => {
    if (actions.length < limit) actions.push(action);
  };

  // 1) Uproot the dead and every certain loss first, without sentiment.
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    const plot = ledger.plots[slot] ?? null;
    if (plot === null) continue;
    if (plot.favorite === true) continue;
    const planted = plot;
    if (planted.dead === true) {
      push({ kind: "uproot", slot, tree: false });
      continue;
    }
    if (now >= planted.readyAt) continue; // harvest handles ripe plants
    if (!cropSlotOpen(ledger, slot)) continue;
    const value = expectedCropValue(planted, season, now);
    const seedCost = seedBuyPrice(planted.seed, season);
    if (value <= seedCost) push({ kind: "uproot", slot, tree: false });
  }
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const tree = ledger.trees[slot] ?? null;
    if (tree === null || tree.favorite === true) continue;
    if (tree.dead === true) push({ kind: "uproot", slot, tree: true });
  }

  // 2) Harvest every ripe plant, most valuable first.
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
  for (const entry of ready.slice(0, Math.max(0, limit - 4))) {
    push({ kind: "harvest", slot: entry.slot, tree: entry.tree, auto: true });
  }

  // 3) Sell everything harvested, then water dry plants (free, prevents deaths).
  if (ledger.bag.crops.length > 0) push({ kind: "sellAll" });
  let watered = 0;
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    if (watered >= 3 || actions.length >= limit) break;
    const plot = ledger.plots[slot] ?? null;
    if (plot === null || plot.dead === true || plot.watered || now >= plot.readyAt) continue;
    push({ kind: "water", slot, tree: false });
    watered += 1;
  }

  // 4) Replant every freed slot with the best neighbourhood-aware seed.
  const best = bestBotSeed(ledger, season, focus, others);
  const uprooted = new Set(
    actions
      .filter((action): action is Extract<GardenAction, { kind: "uproot" }> => action.kind === "uproot")
      .map((action) => action.slot),
  );
  const freeAfterUproot = freeCropSlots(ledger).filter((slot) => !uprooted.has(slot));
  const targets = [...uprooted, ...freeAfterUproot];
  if (best !== null) {
    let owned = ledger.bag.seeds[best.id] ?? 0;
    for (let index = 0; index < targets.length && index < 6 && actions.length < limit; index += 1) {
      const slot = targets[index];
      if (slot === undefined) continue;
      if (owned < 1) {
        const price = seedBuyPrice(best.id, season);
        const offer = season.shop.offers.find((entry) => entry.seed === best.id);
        const stock = Math.max(0, ledger.shopStock[best.id] ?? offer?.stock ?? 0);
        const affordable = price <= 0 ? 6 : Math.floor(ledger.coins / price);
        const qty = Math.max(1, Math.min(6 - index, stock, affordable));
        if (price > 0 && ledger.coins < price) break;
        // Only buy when we are not simply planting the carried bag.
        if (qty < 1) break;
        push({ kind: "buySeed", seed: best.id, qty });
        owned += qty;
        if (owned < 1) break;
      }
      push({ kind: "plant", slot, seed: best.id });
      owned -= 1;
    }
  }

  // 5) A fruit tree when there is spare money; trees keep paying forever.
  const treeSlot = freeTreeSlot(ledger);
  const treeChoices = TREES.filter((tree) => ledger.coins > tree.buy * 3);
  const affordableTree = treeChoices.sort((left, right) => right.sell / right.buy - left.sell / left.buy)[0];
  if (focus === undefined && treeSlot !== null && affordableTree !== undefined && rng() < 0.35) {
    push({ kind: "plantTree", slot: treeSlot, tree: affordableTree.id });
  }

  // 6) Land: open the next 3x3 patch, then a new tab, when coins are comfortable.
  const patch = cheapestPatchTarget(ledger);
  if (patch !== null && ledger.coins > patch.cost * 3) {
    push({ kind: "buyPatch", tab: patch.tab });
  } else if (patch === null && ledger.tabs < MAX_TABS && ledger.coins > nextTabPrice(ledger.tabs) * 2) {
    push({ kind: "buyTab" });
  }

  // 7) Spare coins: buy a cheap supply and use it on a growing plant.
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
