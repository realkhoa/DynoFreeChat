/**
 * @file garden-rules.ts
 * @brief Pure ASCII Garden action rules, shared by the Durable Object and tests.
 * @details The Durable Object owns storage and authentication; this module owns
 * the economy. Keeping the rules pure lets the tests advance the clock freely,
 * so harvest and event behaviour are covered without waiting minutes.
 */

import {
  ACTIONS_PER_MINUTE,
  FERTILIZER_CUT_RATIO,
  FERTILIZER_PRICE,
  PLOT_COUNT,
  STARTING_COINS,
  STARTING_PLOTS,
  STARTING_SEEDS,
  WATER_CUT_RATIO,
  createRng,
  cropSellPrice,
  eventAt,
  growTimeFor,
  hash32,
  rollEffect,
  seedById,
  unlockCost,
  type CropStack,
  type GardenAction,
  type GardenErrorCode,
  type GardenSnapshot,
  type PlotState,
  type SeasonSnapshot,
  type SeedId,
} from "@dyno/shared/garden";

/** Mutable bag used by the rules; the wire type stays readonly. */
export interface LedgerBag {
  /** Unplanted seeds by id. */
  seeds: Partial<Record<SeedId, number>>;
  /** Harvested crops. */
  crops: CropStack[];
}

/** Mutable counters used by the rules. */
export interface LedgerStats {
  /** Crops planted. */
  planted: number;
  /** Crops harvested. */
  harvested: number;
  /** Coins earned by selling. */
  earned: number;
}

/** Everything the rules need to know about one garden. */
export interface GardenLedger {
  /** Stable player id; also the Durable Object name. */
  readonly playerId: string;
  /** Display name, changeable without touching the garden. */
  nick: string;
  /** Avatar colour. */
  color: string;
  /** Public share code. */
  code: string;
  /** SHA-256 of the current write token. */
  tokenHash: string;
  /** SHA-256 of the recovery key. */
  recoveryHash: string;
  /** Spendable coins. */
  coins: number;
  /** Contiguous unlocked plots. */
  unlocked: number;
  /** One entry per plot, `null` for empty soil. */
  plots: (PlotState | null)[];
  /** Seeds and harvested crops, mutable while a rule runs. */
  bag: LedgerBag;
  /** Lifetime counters, mutable while a rule runs. */
  stats: LedgerStats;
  /** Revision bumped on every successful write. */
  rev: number;
  /** Creation time, server clock. */
  createdAt: number;
  /** Last successful write, server clock. */
  updatedAt: number;
  /** Last time the owner opened or changed the garden. */
  lastSeen: number;
  /** Restock timestamp the current stock snapshot belongs to. */
  shopRestockAt: number;
  /** Remaining shop stock by seed for the current restock. */
  shopStock: Partial<Record<SeedId, number>>;
  /** Start of the current action-rate window. */
  actionWindow: number;
  /** Actions applied in the current window. */
  actionCount: number;
}

/** Inputs for a brand-new garden. */
export interface CreateLedgerInput {
  /** Stable player id. */
  readonly playerId: string;
  /** Display name at registration. */
  readonly nick: string;
  /** Avatar colour at registration. */
  readonly color: string;
  /** Public share code. */
  readonly code: string;
  /** SHA-256 of the write token. */
  readonly tokenHash: string;
  /** SHA-256 of the recovery key. */
  readonly recoveryHash: string;
  /** Server time of registration. */
  readonly now: number;
}

/** Outcome of applying one action. */
export type RuleResult =
  | { readonly ok: true; readonly ledger: GardenLedger; readonly changed: boolean }
  | { readonly ok: false; readonly code: GardenErrorCode };

/**
 * @brief Builds the starting garden.
 * @param input Registration data.
 */
export function createLedger(input: CreateLedgerInput): GardenLedger {
  return {
    playerId: input.playerId,
    nick: input.nick,
    color: input.color,
    code: input.code,
    tokenHash: input.tokenHash,
    recoveryHash: input.recoveryHash,
    coins: STARTING_COINS,
    unlocked: STARTING_PLOTS,
    plots: emptyPlots(),
    bag: { seeds: { carrot: STARTING_SEEDS }, crops: [] },
    stats: { planted: 0, harvested: 0, earned: 0 },
    rev: 1,
    createdAt: input.now,
    updatedAt: input.now,
    lastSeen: input.now,
    shopRestockAt: 0,
    shopStock: {},
    actionWindow: 0,
    actionCount: 0,
  };
}

/** @brief Creates the empty plot vector. */
export function emptyPlots(): (PlotState | null)[] {
  return new Array<PlotState | null>(PLOT_COUNT).fill(null);
}

/**
 * @brief Projects the stored ledger onto the wire snapshot.
 * @param ledger Stored garden.
 */
export function ledgerSnapshot(ledger: GardenLedger): GardenSnapshot {
  return {
    version: 1,
    playerId: ledger.playerId,
    nick: ledger.nick,
    color: ledger.color,
    code: ledger.code,
    coins: ledger.coins,
    unlocked: ledger.unlocked,
    plots: ledger.plots.map((plot) => (plot === null ? null : { ...plot })),
    bag: {
      seeds: { ...ledger.bag.seeds },
      crops: ledger.bag.crops.map((stack) => ({ ...stack })),
    },
    stats: { ...ledger.stats },
    rev: ledger.rev,
    updatedAt: ledger.updatedAt,
  };
}

/**
 * @brief Applies one validated action.
 * @param ledger Current garden; never mutated.
 * @param action Parsed action from the wire.
 * @param season Season snapshot used to price and time the action.
 * @param now Server-clock action time.
 * @param rng Deterministic source for the planting effect roll.
 * @return The next ledger, an unchanged ledger, or an error code.
 */
export function applyGardenAction(
  ledger: GardenLedger,
  action: GardenAction,
  season: SeasonSnapshot,
  now: number,
  rng: () => number = createRng(hash32(`${ledger.playerId}:${now}:${ledger.rev}`)),
): RuleResult {
  if (now - ledger.actionWindow > 60_000) {
    ledger = { ...ledger, actionWindow: now, actionCount: 0 };
  }
  if (ledger.actionCount >= ACTIONS_PER_MINUTE) return { ok: false, code: "RATE_LIMITED" };
  ledger = { ...ledger, actionCount: ledger.actionCount + 1 };

  switch (action.kind) {
    case "plant":
      return plant(ledger, action.slot, action.seed, now, rng);
    case "harvest":
      return harvest(ledger, action.slot, now);
    case "water":
      return water(ledger, action.slot, now);
    case "fertilize":
      return fertilize(ledger, action.slot, now);
    case "uproot":
      return uproot(ledger, action.slot, now);
    case "unlock":
      return unlock(ledger, action.slot, now);
    case "buySeed":
      return buySeed(ledger, action.seed, action.qty, season, now);
    case "sellCrop":
      return sellCrop(ledger, action.seed, action.effect, action.qty, season, now);
    case "sellAll":
      return sellAll(ledger, season, now);
    default:
      return { ok: false, code: "BAD_REQUEST" };
  }
}

/** @brief Plants one bagged seed. */
function plant(
  ledger: GardenLedger,
  slot: number,
  seedId: SeedId,
  now: number,
  rng: () => number,
): RuleResult {
  if (slot >= ledger.unlocked) return { ok: false, code: "PLOT_LOCKED" };
  if (ledger.plots[slot] !== null) return { ok: false, code: "PLOT_OCCUPIED" };
  const seed = seedById(seedId);
  if (seed === undefined) return { ok: false, code: "NO_SEED" };
  const owned = ledger.bag.seeds[seed.id] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SEED" };

  const next = clone(ledger);
  next.bag.seeds[seed.id] = owned - 1;
  const event = eventAt(now);
  next.plots[slot] = {
    slot,
    seed: seed.id,
    plantedAt: now,
    readyAt: now + growTimeFor(seed, event),
    effect: rollEffect(event, rng),
    watered: false,
    fertilized: false,
  };
  next.stats.planted += 1;
  return changed(next, now);
}

/** @brief Harvests one ripe crop into the bag. */
function harvest(ledger: GardenLedger, slot: number, now: number): RuleResult {
  const plot = ledger.plots[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (now < plot.readyAt) return { ok: false, code: "NOT_READY" };

  const next = clone(ledger);
  next.plots[slot] = null;
  addCrop(next.bag.crops, plot.seed, plot.effect, 1);
  next.stats.harvested += 1;
  return changed(next, now);
}

/** @brief Waters one growing crop: shortens growth and adds the wet effect. */
function water(ledger: GardenLedger, slot: number, now: number): RuleResult {
  const plot = ledger.plots[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (now >= plot.readyAt) return { ok: false, code: "NOT_READY" };
  if (plot.watered) return { ok: false, code: "ALREADY_WATERED" };

  const next = clone(ledger);
  const remaining = plot.readyAt - now;
  next.plots[slot] = {
    ...plot,
    readyAt: Math.max(now + 1_000, plot.readyAt - Math.round(remaining * WATER_CUT_RATIO)),
    watered: true,
    effect: plot.effect ?? "wet",
  };
  return changed(next, now);
}

/** @brief Fertilizes one growing crop for coins. */
function fertilize(ledger: GardenLedger, slot: number, now: number): RuleResult {
  const plot = ledger.plots[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (now >= plot.readyAt) return { ok: false, code: "NOT_READY" };
  if (plot.fertilized) return { ok: false, code: "ALREADY_FERTILIZED" };
  if (ledger.coins < FERTILIZER_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  const remaining = plot.readyAt - now;
  next.coins -= FERTILIZER_PRICE;
  next.plots[slot] = {
    ...plot,
    readyAt: Math.max(now + 1_000, plot.readyAt - Math.round(remaining * FERTILIZER_CUT_RATIO)),
    fertilized: true,
  };
  return changed(next, now);
}

/** @brief Removes one crop without a refund. */
function uproot(ledger: GardenLedger, slot: number, now: number): RuleResult {
  if (ledger.plots[slot] === null) return { ok: false, code: "PLOT_EMPTY" };
  const next = clone(ledger);
  next.plots[slot] = null;
  return changed(next, now);
}

/** @brief Buys the next locked plot. */
function unlock(ledger: GardenLedger, slot: number, now: number): RuleResult {
  if (slot < ledger.unlocked) return { ok: false, code: "BAD_REQUEST" };
  if (slot !== ledger.unlocked) return { ok: false, code: "PLOT_LOCKED" };
  const cost = unlockCost(slot);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= cost;
  next.unlocked += 1;
  return changed(next, now);
}

/** @brief Buys seeds from the current shop rotation. */
function buySeed(
  ledger: GardenLedger,
  seedId: SeedId,
  qty: number,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const seed = seedById(seedId);
  if (seed === undefined) return { ok: false, code: "BAD_REQUEST" };
  const offer = season.shop.offers.find((entry) => entry.seed === seed.id);
  if (offer === undefined) return { ok: false, code: "SHOP_SOLD_OUT" };

  const next = clone(ledger);
  if (next.shopRestockAt !== season.shop.restockAt) {
    next.shopRestockAt = season.shop.restockAt;
    next.shopStock = {};
  }
  const stock = next.shopStock[seed.id] ?? offer.stock;
  if (stock < qty) return { ok: false, code: "SHOP_SOLD_OUT" };

  const total = offer.price * qty;
  if (next.coins < total) return { ok: false, code: "NOT_ENOUGH_COINS" };

  next.coins -= total;
  next.shopStock[seed.id] = stock - qty;
  next.bag.seeds[seed.id] = (next.bag.seeds[seed.id] ?? 0) + qty;
  return changed(next, now);
}

/** @brief Sells one or more harvested crops at the season price. */
function sellCrop(
  ledger: GardenLedger,
  seedId: SeedId,
  effect: CropStack["effect"],
  qty: number,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const stack = ledger.bag.crops.find((entry) => entry.seed === seedId && entry.effect === effect);
  if (stack === undefined || stack.qty < qty) return { ok: false, code: "NO_CROP" };

  const next = clone(ledger);
  const total = cropSellPrice(stack, season) * qty;
  next.coins += total;
  next.stats.earned += total;
  removeCrop(next.bag.crops, seedId, effect ?? null, qty);
  return changed(next, now);
}

/** @brief Sells every harvested crop. */
function sellAll(ledger: GardenLedger, season: SeasonSnapshot, now: number): RuleResult {
  if (ledger.bag.crops.length === 0) return { ok: false, code: "NOTHING_TO_SELL" };
  const next = clone(ledger);
  let total = 0;
  for (const stack of next.bag.crops) total += cropSellPrice(stack, season) * stack.qty;
  if (total <= 0) return { ok: false, code: "NOTHING_TO_SELL" };
  next.coins += total;
  next.stats.earned += total;
  next.bag.crops = [];
  return changed(next, now);
}

/** @brief Marks one successful mutation and stamps the revision. */
function changed(ledger: GardenLedger, now: number): RuleResult {
  ledger.rev += 1;
  ledger.updatedAt = now;
  ledger.lastSeen = now;
  return { ok: true, ledger, changed: true };
}

/** @brief Deep-copies the mutable parts of one ledger. */
function clone(ledger: GardenLedger): GardenLedger {
  return {
    ...ledger,
    plots: ledger.plots.map((plot) => (plot === null ? null : { ...plot })),
    bag: {
      seeds: { ...ledger.bag.seeds },
      crops: ledger.bag.crops.map((stack) => ({ ...stack })),
    },
    stats: { ...ledger.stats },
    shopStock: { ...ledger.shopStock },
  };
}

/** @brief Adds one crop unit to a mutable bag. */
function addCrop(crops: CropStack[], seed: SeedId, effect: CropStack["effect"], qty: number): void {
  const stack = crops.find((entry) => entry.seed === seed && entry.effect === effect);
  if (stack === undefined) {
    crops.push({ seed, effect, qty });
    return;
  }
  crops[crops.indexOf(stack)] = { seed, effect, qty: stack.qty + qty };
}

/** @brief Removes crop units from a mutable bag, dropping empty stacks. */
function removeCrop(crops: CropStack[], seed: SeedId, effect: CropStack["effect"], qty: number): void {
  const index = crops.findIndex((entry) => entry.seed === seed && entry.effect === effect);
  if (index < 0) return;
  const stack = crops[index];
  if (stack === undefined) return;
  const left = stack.qty - qty;
  if (left <= 0) crops.splice(index, 1);
  else crops[index] = { seed, effect, qty: left };
}
