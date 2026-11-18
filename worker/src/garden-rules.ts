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
  CROPS_PER_TAB,
  MAX_TABS,
  PLOTS_PER_PATCH,
  STARTING_COINS,
  STARTING_TABS,
  STARTING_SEEDS,
  TREES_PER_TAB,
  WATER_ALL_COST,
  WATER_CUT_RATIO,
  HARVEST_ALL_COST,
  createRng,
  cropSellPrice,
  eventsAt,
  growTimeForEvents,
  rollEffectsFor,
  hash32,
  nextPatchPrice,
  nextTabPrice,
  canonicalEffects,
  rollEffects,
  resolvedCropEffects,
  resolvedTreeEffects,
  seedById,
  fertilizerById,
  sprayById,
  totalCrops,
  totalTrees,
  treeById,
  type ActiveFertilizer,
  type ActiveSpray,
  type CropStack,
  type EffectId,
  type FertilizerId,
  type SprayId,
  type GardenAction,
  type GardenErrorCode,
  type GardenSnapshot,
  type ItemId,
  type SupplyId,
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
  /** Owned fertilizers and sprays. */
  supplies: Partial<Record<SupplyId, number>>;
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
  /** Bought tabs. */
  tabs: number;
  /** Open crop patches per tab (1..9). */
  unlockedPatches: number[];
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
    tabs: STARTING_TABS,
    unlockedPatches: new Array<number>(STARTING_TABS).fill(1),
    plots: emptyCrops(STARTING_TABS),
    trees: emptyTrees(STARTING_TABS),
    bag: { seeds: { carrot: STARTING_SEEDS }, crops: [], supplies: {} },
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
 * @brief Creates the empty crop vector for the owned tabs.
 * @param tabs Owned tab count.
 */
export function emptyCrops(tabs: number): (PlotState | null)[] {
  return new Array<PlotState | null>(totalCrops(tabs)).fill(null);
}

/**
 * @brief Creates the empty fruit vector for the owned tabs.
 * @param tabs Owned tab count.
 */
export function emptyTrees(tabs: number): (TreeState | null)[] {
  return new Array<TreeState | null>(totalTrees(tabs)).fill(null);
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
    tabs: ledger.tabs,
    unlockedPatches: [...ledger.unlockedPatches],
    plots: ledger.plots.map((plot) => (plot === null ? null : { ...plot })),
    trees: ledger.trees.map((tree) => (tree === null ? null : { ...tree })),
    bag: {
      seeds: { ...ledger.bag.seeds },
      crops: ledger.bag.crops.map((stack) => ({ ...stack })),
      supplies: { ...ledger.bag.supplies },
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
      return fertilize(ledger, action.slot, action.supply, now, action.tree);
    case "spray":
      return spray(ledger, action.slot, action.supply, now, action.tree, rng);
    case "uproot":
      return action.tree ? uprootTree(ledger, action.slot, now) : uproot(ledger, action.slot, now);
    case "buyTab":
      return buyTab(ledger, now);
    case "buyPatch":
      return buyPatch(ledger, action.tab, now);
    case "waterAll":
      return waterAll(ledger, now);
    case "harvestAll":
      return harvestAll(ledger, now, rng);
    case "buySeed":
      return buySeed(ledger, action.seed, action.qty, season, now);
    case "buySupply":
      return buySupply(ledger, action.supply, action.qty, season, now);
    case "sellCrop":
      return sellCrop(ledger, action.item, action.effects, action.qty, season, now);
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
  if (!isCropPatchOpen(ledger, slot)) return { ok: false, code: "PLOT_LOCKED" };
  if (ledger.plots[slot] !== null) return { ok: false, code: "PLOT_OCCUPIED" };
  const seed = seedById(seedId);
  if (seed === undefined) return { ok: false, code: "NO_SEED" };
  const owned = ledger.bag.seeds[seed.id] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SEED" };

  const next = clone(ledger);
  next.bag.seeds[seed.id] = owned - 1;
  const events = eventsAt(now);
  next.plots[slot] = {
    slot,
    seed: seed.id,
    plantedAt: now,
    readyAt: now + growTimeForEvents(seed, events),
    effects: rollEffectsFor(events, rng),
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
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
  const events = eventsAt(now);
  next.trees[slot] = {
    slot,
    tree: tree.id,
    plantedAt: now,
    readyAt: now + growTimeForEvents(tree, events),
    effects: rollEffectsFor(events, rng),
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
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
  addCrop(next.bag.crops, plot.seed, resolvedCropEffects(plot, now), 1);
  next.stats.harvested += 1;

  const seed = seedById(plot.seed);
  if (seed !== undefined && seed.regrow) {
    const events = eventsAt(now);
    const sprayBonus = plot.spray === null ? {} : (sprayById(plot.spray.id)?.effectChances ?? {});
    next.plots[slot] = {
      slot,
      seed: plot.seed,
      plantedAt: now,
      readyAt: now + growTimeForEvents(seed, events, plot.fertilizer),
      effects: rollEffectsFor(events, rng, sprayBonus),
      watered: false,
      fertilized: false,
      harvests: plot.harvests + 1,
      fertilizer: tickFertilizer(plot.fertilizer),
      spray: tickSpray(plot.spray),
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
  addCrop(next.bag.crops, tree.tree, resolvedTreeEffects(tree, now), 1);
  next.stats.harvested += 1;
  const events = eventsAt(now);
  const sprayBonus = tree.spray === null ? {} : (sprayById(tree.spray.id)?.effectChances ?? {});
  next.trees[slot] = {
    slot,
    tree: tree.tree,
    plantedAt: now,
    readyAt: now + growTimeForEvents(definition, events, tree.fertilizer),
    effects: rollEffectsFor(events, rng, sprayBonus),
    watered: false,
    fertilized: false,
    harvests: tree.harvests + 1,
    fertilizer: tickFertilizer(tree.fertilizer),
    spray: tickSpray(tree.spray),
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
    effects: canonicalEffects([...plot.effects, "wet"]),
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
    effects: canonicalEffects([...tree.effects, "wet"]),
  };
  return changed(next, now);
}

/**
 * @brief Applies one fertilizer from the bag to a growing crop or tree.
 * @details The active fertilizer shortens the current growth immediately and
 * keeps boosting the next `harvests - 1` cycles before it wears off.
 */
function fertilize(
  ledger: GardenLedger,
  slot: number,
  supply: FertilizerId,
  now: number,
  tree: boolean,
): RuleResult {
  const definition = fertilizerById(supply);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  const plant = tree ? (ledger.trees[slot] ?? null) : (ledger.plots[slot] ?? null);
  if (plant === null) return { ok: false, code: "PLOT_EMPTY" };
  const owned = ledger.bag.supplies[supply] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SUPPLY" };

  const next = clone(ledger);
  next.bag.supplies[supply] = owned - 1;
  const remaining = Math.max(0, plant.readyAt - now);
  const readyAt =
    now >= plant.readyAt
      ? plant.readyAt
      : now + Math.max(1_000, Math.round(remaining * definition.growMultiplier));
  const updated = {
    ...plant,
    readyAt,
    fertilized: true,
    fertilizer: { id: supply, left: definition.harvests },
  };
  if (tree) next.trees[slot] = updated as (typeof next.trees)[number];
  else next.plots[slot] = updated as (typeof next.plots)[number];
  return changed(next, now);
}

/** @brief Applies one spray: the next rolls carry its mutation bonus. */
function spray(
  ledger: GardenLedger,
  slot: number,
  supply: SprayId,
  now: number,
  tree: boolean,
  rng: () => number,
): RuleResult {
  const definition = sprayById(supply);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  const plant = tree ? (ledger.trees[slot] ?? null) : (ledger.plots[slot] ?? null);
  if (plant === null) return { ok: false, code: "PLOT_EMPTY" };
  const owned = ledger.bag.supplies[supply] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SUPPLY" };

  // A spray immediately rolls its mutation chances onto the growing fruit, so
  // the player sees the effect now, while the charge still boosts regrowth rolls.
  const added: EffectId[] = [];
  for (const [id, chance] of Object.entries(definition.effectChances)) {
    if (typeof chance === "number" && chance > 0 && rng() < chance) added.push(id as EffectId);
  }
  const next = clone(ledger);
  next.bag.supplies[supply] = owned - 1;
  const updated = {
    ...plant,
    effects: canonicalEffects([...plant.effects, ...added]),
    spray: { id: supply, left: definition.harvests },
  };
  if (tree) next.trees[slot] = updated as (typeof next.trees)[number];
  else next.plots[slot] = updated as (typeof next.plots)[number];
  return changed(next, now);
}

/** @brief Buys fertilizers or sprays at their fixed price. */
function buySupply(
  ledger: GardenLedger,
  supply: SupplyId,
  qty: number,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const definition = fertilizerById(supply) ?? sprayById(supply);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  const total = (season.buyPrices?.[supply] ?? definition.price) * qty;
  if (ledger.coins < total) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= total;
  next.bag.supplies[supply] = (next.bag.supplies[supply] ?? 0) + qty;
  return changed(next, now);
}

/** @brief Ages one fertilizer by one harvest cycle. */
function tickFertilizer(active: ActiveFertilizer | null): ActiveFertilizer | null {
  if (active === null) return null;
  return active.left <= 1 ? null : { id: active.id, left: active.left - 1 };
}

/** @brief Ages one spray by one harvest cycle. */
function tickSpray(active: ActiveSpray | null): ActiveSpray | null {
  if (active === null) return null;
  return active.left <= 1 ? null : { id: active.id, left: active.left - 1 };
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

/** @brief Waters every growing, not-yet-watered plant for 5c each. */
function waterAll(ledger: GardenLedger, now: number): RuleResult {
  const crops: number[] = [];
  for (let tab = 0; tab < ledger.tabs; tab += 1) {
    const open = ledger.unlockedPatches[tab] ?? 1;
    for (let patch = 0; patch < open; patch += 1) {
      for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
        const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
        const entry = ledger.plots[slot] ?? null;
        if (entry !== null && now < entry.readyAt && !entry.watered) crops.push(slot);
      }
    }
  }
  const trees: number[] = [];
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const entry = ledger.trees[slot] ?? null;
    if (entry !== null && now < entry.readyAt && !entry.watered) trees.push(slot);
  }
  const count = crops.length + trees.length;
  if (count === 0) return { ok: false, code: "NOTHING_TO_DO" };
  const cost = count * WATER_ALL_COST;
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  let current = ledger;
  for (const slot of crops) {
    const result = water(current, slot, now);
    if (result.ok) current = result.ledger;
  }
  for (const slot of trees) {
    const result = waterTree(current, slot, now);
    if (result.ok) current = result.ledger;
  }
  const next = clone(current);
  next.coins -= cost;
  return changed(next, now);
}

/** @brief Harvests every ready plant for 20c each. */
function harvestAll(ledger: GardenLedger, now: number, rng: () => number): RuleResult {
  const crops: number[] = [];
  for (let tab = 0; tab < ledger.tabs; tab += 1) {
    const open = ledger.unlockedPatches[tab] ?? 1;
    for (let patch = 0; patch < open; patch += 1) {
      for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
        const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
        const entry = ledger.plots[slot] ?? null;
        if (entry !== null && now >= entry.readyAt) crops.push(slot);
      }
    }
  }
  const trees: number[] = [];
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const entry = ledger.trees[slot] ?? null;
    if (entry !== null && now >= entry.readyAt) trees.push(slot);
  }
  const count = crops.length + trees.length;
  if (count === 0) return { ok: false, code: "NOTHING_TO_DO" };
  const cost = count * HARVEST_ALL_COST;
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  let current = ledger;
  for (const slot of crops) {
    const result = harvest(current, slot, now, rng);
    if (result.ok) current = result.ledger;
  }
  for (const slot of trees) {
    const result = harvestTree(current, slot, now, rng);
    if (result.ok) current = result.ledger;
  }
  const next = clone(current);
  next.coins -= cost;
  return changed(next, now);
}

/** @brief Buys the next tab at the compounding ladder price. */
function buyTab(ledger: GardenLedger, now: number): RuleResult {
  if (ledger.tabs >= MAX_TABS) return { ok: false, code: "MAX_TABS" };
  const cost = nextTabPrice(ledger.tabs);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= cost;
  next.tabs += 1;
  next.unlockedPatches.push(1);
  for (let index = 0; index < CROPS_PER_TAB; index += 1) next.plots.push(null);
  for (let index = 0; index < TREES_PER_TAB; index += 1) next.trees.push(null);
  return changed(next, now);
}

/** @brief Buys the next crop patch inside one tab. */
function buyPatch(ledger: GardenLedger, tab: number, now: number): RuleResult {
  if (tab < 0 || tab >= ledger.tabs) return { ok: false, code: "BAD_REQUEST" };
  const open = ledger.unlockedPatches[tab] ?? 1;
  if (open >= PLOTS_PER_PATCH) return { ok: false, code: "MAX_PATCHES" };
  const cost = nextPatchPrice(open);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= cost;
  next.unlockedPatches[tab] = open + 1;
  return changed(next, now);
}

/** @brief Whether one crop slot belongs to an open 3x3 patch. */
function isCropPatchOpen(ledger: GardenLedger, slot: number): boolean {
  const tab = Math.floor(slot / CROPS_PER_TAB);
  const local = slot % CROPS_PER_TAB;
  const patch = Math.floor(local / PLOTS_PER_PATCH);
  return (ledger.unlockedPatches[tab] ?? 0) > patch;
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

  // Market pressure can raise the seed price above the rotation offer.
  const unit = season.buyPrices?.[seed.id] ?? offer.price;
  const total = unit * qty;
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
  effects: readonly EffectId[],
  qty: number,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const stack = ledger.bag.crops.find((entry) => entry.item === item && sameEffects(entry.effects, effects));
  if (stack === undefined || stack.qty < qty) return { ok: false, code: "NO_CROP" };

  const next = clone(ledger);
  const total = cropSellPrice(stack, season) * qty;
  next.coins += total;
  next.stats.earned += total;
  removeCrop(next.bag.crops, item, effects, qty);
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
      supplies: { ...ledger.bag.supplies },
    },
    stats: { ...ledger.stats },
    shopStock: { ...ledger.shopStock },
  };
}

/** @brief Whether two effect lists are the same mutation set. */
function sameEffects(left: readonly EffectId[], right: readonly EffectId[]): boolean {
  const a = canonicalEffects(left).join(":");
  const b = canonicalEffects(right).join(":");
  return a === b;
}

/** @brief Adds one produce unit to a mutable bag. */
function addCrop(crops: CropStack[], item: ItemId, effects: readonly EffectId[], qty: number): void {
  const canonical = canonicalEffects(effects);
  const stack = crops.find((entry) => entry.item === item && sameEffects(entry.effects, canonical));
  if (stack === undefined) {
    crops.push({ item, effects: canonical, qty });
    return;
  }
  crops[crops.indexOf(stack)] = { item, effects: canonical, qty: stack.qty + qty };
}

/** @brief Removes produce units from a mutable bag, dropping empty stacks. */
function removeCrop(crops: CropStack[], item: ItemId, effects: readonly EffectId[], qty: number): void {
  const index = crops.findIndex((entry) => entry.item === item && sameEffects(entry.effects, effects));
  if (index < 0) return;
  const stack = crops[index];
  if (stack === undefined) return;
  const left = stack.qty - qty;
  if (left <= 0) crops.splice(index, 1);
  else crops[index] = { item, effects: canonicalEffects(effects), qty: left };
}
