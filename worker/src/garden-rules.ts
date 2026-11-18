/**
 * @file garden-rules.ts
 * @brief Pure ASCII Garden action rules, shared by the Durable Object and tests.
 * @details The Durable Object owns storage and authentication; this module owns
 * the economy. Crops and fruit trees live in two parallel 3x3 grids per patch:
 * crops are pulled or reharvested, trees always regrow their fruit. Keeping the
 * rules pure lets the tests advance the clock freely.
 */

import {
  ACTIONS_PER_MINUTE,
  FERTILIZER_CUT_RATIO,
  FERTILIZER_PRICE,
  MAX_PATCHES,
  PLOTS_PER_PATCH,
  STARTING_COINS,
  STARTING_PATCHES,
  STARTING_SEEDS,
  WATER_CUT_RATIO,
  createRng,
  cropSellPrice,
  eventAt,
  growTimeFor,
  hash32,
  nextPatchPrice,
  rollEffect,
  seedById,
  totalPlots,
  treeById,
  type CropStack,
  type GardenAction,
  type GardenErrorCode,
  type GardenSnapshot,
  type ItemId,
  type PlotState,
  type SeasonSnapshot,
  type SeedId,
  type TreeId,
  type TreeState,
} from "@dyno/shared/garden";

/** Mutable bag used by the rules; the wire type stays readonly. */
export interface LedgerBag {
  /** Unplanted seeds by id. */
  seeds: Partial<Record<SeedId, number>>;
  /** Harvested crops and fruits. */
  crops: CropStack[];
}

/** Mutable counters used by the rules. */
export interface LedgerStats {
  /** Crops and trees planted. */
  planted: number;
  /** Produce harvested. */
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
  /** Bought 3x3 patches. */
  patches: number;
  /** Crop slots, parallel to {@link trees}. */
  plots: (PlotState | null)[];
  /** Fruit tree slots, parallel to {@link plots}. */
  trees: (TreeState | null)[];
  /** Seeds and harvested produce, mutable while a rule runs. */
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
    patches: STARTING_PATCHES,
    plots: emptyPlots(STARTING_PATCHES),
    trees: emptyTrees(STARTING_PATCHES),
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

/**
 * @brief Creates the empty crop vector for the owned patches.
 * @param patches Owned patch count.
 */
export function emptyPlots(patches: number): (PlotState | null)[] {
  return new Array<PlotState | null>(totalPlots(patches)).fill(null);
}

/**
 * @brief Creates the empty tree vector for the owned patches.
 * @param patches Owned patch count.
 */
export function emptyTrees(patches: number): (TreeState | null)[] {
  return new Array<TreeState | null>(totalPlots(patches)).fill(null);
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
    patches: ledger.patches,
    plots: ledger.plots.map((plot) => (plot === null ? null : { ...plot })),
    trees: ledger.trees.map((tree) => (tree === null ? null : { ...tree })),
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
    case "plantTree":
      return plantTree(ledger, action.slot, action.tree, now, rng);
    case "harvest":
      return action.tree
        ? harvestTree(ledger, action.slot, now, rng)
        : harvest(ledger, action.slot, now, rng);
    case "water":
      return action.tree ? waterTree(ledger, action.slot, now) : water(ledger, action.slot, now);
    case "fertilize":
      return action.tree ? fertilizeTree(ledger, action.slot, now) : fertilize(ledger, action.slot, now);
    case "uproot":
      return action.tree ? uprootTree(ledger, action.slot, now) : uproot(ledger, action.slot, now);
    case "buyPatch":
      return buyPatch(ledger, now);
    case "buySeed":
      return buySeed(ledger, action.seed, action.qty, season, now);
    case "sellCrop":
      return sellCrop(ledger, action.item, action.effect, action.qty, season, now);
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
  if (slot >= ledger.plots.length) return { ok: false, code: "PLOT_LOCKED" };
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
    harvests: 0,
  };
  next.stats.planted += 1;
  return changed(next, now);
}

/** @brief Plants one fruit tree sapling, paid from the wallet. */
function plantTree(
  ledger: GardenLedger,
  slot: number,
  treeId: TreeId,
  now: number,
  rng: () => number,
): RuleResult {
  if (slot >= ledger.trees.length) return { ok: false, code: "PLOT_LOCKED" };
  if (ledger.trees[slot] !== null) return { ok: false, code: "PLOT_OCCUPIED" };
  const tree = treeById(treeId);
  if (tree === undefined) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.coins < tree.buy) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= tree.buy;
  const event = eventAt(now);
  next.trees[slot] = {
    slot,
    tree: tree.id,
    plantedAt: now,
    readyAt: now + growTimeFor(tree, event),
    effect: rollEffect(event, rng),
    watered: false,
    fertilized: false,
    harvests: 0,
  };
  next.stats.planted += 1;
  return changed(next, now);
}

/**
 * @brief Harvests one ripe crop into the bag.
 * @details Root crops are pulled and leave empty soil; reharvest plants keep
 * the plant, reset the growth clock and roll a fresh effect for the next fruit.
 */
function harvest(ledger: GardenLedger, slot: number, now: number, rng: () => number): RuleResult {
  const plot = ledger.plots[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (now < plot.readyAt) return { ok: false, code: "NOT_READY" };

  const next = clone(ledger);
  addCrop(next.bag.crops, plot.seed, plot.effect, 1);
  next.stats.harvested += 1;

  const seed = seedById(plot.seed);
  if (seed !== undefined && seed.regrow) {
    const event = eventAt(now);
    next.plots[slot] = {
      slot,
      seed: plot.seed,
      plantedAt: now,
      readyAt: now + growTimeFor(seed, event),
      effect: rollEffect(event, rng),
      watered: false,
      fertilized: false,
      harvests: plot.harvests + 1,
    };
  } else {
    next.plots[slot] = null;
  }
  return changed(next, now);
}

/** @brief Picks one tree fruit; the tree always stays and regrows. */
function harvestTree(ledger: GardenLedger, slot: number, now: number, rng: () => number): RuleResult {
  const tree = ledger.trees[slot] ?? null;
  if (tree === null) return { ok: false, code: "PLOT_EMPTY" };
  if (now < tree.readyAt) return { ok: false, code: "NOT_READY" };
  const definition = treeById(tree.tree);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };

  const next = clone(ledger);
  addCrop(next.bag.crops, tree.tree, tree.effect, 1);
  next.stats.harvested += 1;
  const event = eventAt(now);
  next.trees[slot] = {
    slot,
    tree: tree.tree,
    plantedAt: now,
    readyAt: now + growTimeFor(definition, event),
    effect: rollEffect(event, rng),
    watered: false,
    fertilized: false,
    harvests: tree.harvests + 1,
  };
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

/** @brief Waters one growing tree until its next fruit. */
function waterTree(ledger: GardenLedger, slot: number, now: number): RuleResult {
  const tree = ledger.trees[slot] ?? null;
  if (tree === null) return { ok: false, code: "PLOT_EMPTY" };
  if (now >= tree.readyAt) return { ok: false, code: "NOT_READY" };
  if (tree.watered) return { ok: false, code: "ALREADY_WATERED" };

  const next = clone(ledger);
  const remaining = tree.readyAt - now;
  next.trees[slot] = {
    ...tree,
    readyAt: Math.max(now + 1_000, tree.readyAt - Math.round(remaining * WATER_CUT_RATIO)),
    watered: true,
    effect: tree.effect ?? "wet",
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

/** @brief Fertilizes one growing tree for coins. */
function fertilizeTree(ledger: GardenLedger, slot: number, now: number): RuleResult {
  const tree = ledger.trees[slot] ?? null;
  if (tree === null) return { ok: false, code: "PLOT_EMPTY" };
  if (now >= tree.readyAt) return { ok: false, code: "NOT_READY" };
  if (tree.fertilized) return { ok: false, code: "ALREADY_FERTILIZED" };
  if (ledger.coins < FERTILIZER_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  const remaining = tree.readyAt - now;
  next.coins -= FERTILIZER_PRICE;
  next.trees[slot] = {
    ...tree,
    readyAt: Math.max(now + 1_000, tree.readyAt - Math.round(remaining * FERTILIZER_CUT_RATIO)),
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

/** @brief Removes one tree without a refund. */
function uprootTree(ledger: GardenLedger, slot: number, now: number): RuleResult {
  if (ledger.trees[slot] === null) return { ok: false, code: "PLOT_EMPTY" };
  const next = clone(ledger);
  next.trees[slot] = null;
  return changed(next, now);
}

/** @brief Buys the next 3x3 patch at the compounding ladder price. */
function buyPatch(ledger: GardenLedger, now: number): RuleResult {
  if (ledger.patches >= MAX_PATCHES) return { ok: false, code: "MAX_PATCHES" };
  const cost = nextPatchPrice(ledger.patches);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= cost;
  next.patches += 1;
  for (let index = 0; index < PLOTS_PER_PATCH; index += 1) {
    next.plots.push(null);
    next.trees.push(null);
  }
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

/** @brief Sells one or more harvested stacks at the season price. */
function sellCrop(
  ledger: GardenLedger,
  item: ItemId,
  effect: CropStack["effect"],
  qty: number,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const stack = ledger.bag.crops.find((entry) => entry.item === item && entry.effect === effect);
  if (stack === undefined || stack.qty < qty) return { ok: false, code: "NO_CROP" };

  const next = clone(ledger);
  const total = cropSellPrice(stack, season) * qty;
  next.coins += total;
  next.stats.earned += total;
  removeCrop(next.bag.crops, item, effect ?? null, qty);
  return changed(next, now);
}

/** @brief Sells every harvested stack. */
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
    trees: ledger.trees.map((tree) => (tree === null ? null : { ...tree })),
    bag: {
      seeds: { ...ledger.bag.seeds },
      crops: ledger.bag.crops.map((stack) => ({ ...stack })),
    },
    stats: { ...ledger.stats },
    shopStock: { ...ledger.shopStock },
  };
}

/** @brief Adds one produce unit to a mutable bag. */
function addCrop(crops: CropStack[], item: ItemId, effect: CropStack["effect"], qty: number): void {
  const stack = crops.find((entry) => entry.item === item && entry.effect === effect);
  if (stack === undefined) {
    crops.push({ item, effect, qty });
    return;
  }
  crops[crops.indexOf(stack)] = { item, effect, qty: stack.qty + qty };
}

/** @brief Removes produce units from a mutable bag, dropping empty stacks. */
function removeCrop(crops: CropStack[], item: ItemId, effect: CropStack["effect"], qty: number): void {
  const index = crops.findIndex((entry) => entry.item === item && entry.effect === effect);
  if (index < 0) return;
  const stack = crops[index];
  if (stack === undefined) return;
  const left = stack.qty - qty;
  if (left <= 0) crops.splice(index, 1);
  else crops[index] = { item, effect, qty: left };
}
