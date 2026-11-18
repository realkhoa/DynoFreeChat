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
  FARM_CYCLE_MS,
  WATER_ALL_COST,
  SELL_TAX_RATE,
  PEST_CHANCE_PER_CYCLE,
  PEST_GROWTH_PENALTY,
  PEST_PROTECTION_MS,
  PEST_SPRAY_COST,
  ANIMALS,
  animalById,
  animalIntervalMs,
  animalQuality,
  buildingById,
  buildingSlots,
  buildingUpgradeCost,
  MACHINE_MAX_LEVEL,
  MACHINE_PRICE,
  WAREHOUSE_PRICE,
  converterOutput,
  machineById,
  seedMakerOutput,
  seedById,
  maxBuildingLevel,
  productById,
  productPrice,
  toolById,
  type ToolId,
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
  fertilizerById,
  sprayById,
  totalCrops,
  totalTrees,
  treeById,
  type ActiveFertilizer,
  type ActiveSpray,
  type AnimalId,
  type AnimalState,
  type BuildingId,
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
  type ProductId,
  type MachineId,
  type MachineState,
  type ProductStack,
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
  /** Animal products waiting to be sold. */
  products: ProductStack[];
  /** Rare tools owned. */
  tools: Partial<Record<ToolId, number>>;
}

/** Mutable counters used by the rules. */
export interface LedgerStats {
  /** Crops and trees planted. */
  planted: number;
  /** Produce harvested. */
  harvested: number;
  /** Coins earned by selling. */
  earned: number;
  /** Coins spent on seeds, land and services. */
  spent: number;
  /** Coins paid as sale tax. */
  tax: number;
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
  /** Building levels (0 = not built). */
  buildings: Record<BuildingId, number>;
  /** Animals per building slot. */
  animals: Record<BuildingId, (AnimalState | null)[]>;
  /** Last farm upkeep/production settlement. */
  farmSettledAt: number;
  /** Last automatic-tool settlement. */
  toolsSettledAt: number;
  /** Last pest strike roll. */
  pestSettledAt: number;
  /** Warehouse level: 0 not built. */
  warehouse: number;
  /** Built machines. */
  machines: Partial<Record<MachineId, MachineState>>;
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
    bag: { seeds: { carrot: STARTING_SEEDS }, crops: [], supplies: {}, products: [], tools: {} },
    stats: { planted: 0, harvested: 0, earned: 0, spent: 0, tax: 0 },
    buildings: { coop: 0, barn: 0 },
    animals: { coop: [], barn: [] },
    farmSettledAt: input.now,
    toolsSettledAt: input.now,
    pestSettledAt: input.now,
    warehouse: 0,
    machines: {},
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
      products: (ledger.bag.products ?? []).map((stack) => ({ ...stack })),
      tools: { ...ledger.bag.tools },
    },
    buildings: { ...ledger.buildings },
    animals: {
      coop: ledger.animals.coop.map((animal) => (animal === null ? null : { ...animal })),
      barn: ledger.animals.barn.map((animal) => (animal === null ? null : { ...animal })),
    },
    farmSettledAt: ledger.farmSettledAt,
    warehouse: {
      level: ledger.warehouse,
      machines: Object.fromEntries(
        Object.entries(ledger.machines).map(([id, machine]) => [
          id,
          machine === undefined ? undefined : { ...machine },
        ]),
      ) as Partial<Record<MachineId, MachineState>>,
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
    case "buildBuilding":
      return buildBuilding(ledger, action.building, now);
    case "upgradeBuilding":
      return upgradeBuilding(ledger, action.building, now);
    case "buyAnimal":
      return buyAnimal(ledger, action.building, action.slot, action.animal, now);
    case "patAnimal":
      return patAnimal(ledger, action.building, action.slot, now);
    case "sellProduct":
      return sellProduct(ledger, action.product, action.star, action.qty, season, now);
    case "sellAllProducts":
      return sellAllProducts(ledger, season, now);
    case "buyTool":
      return buyTool(ledger, action.tool, action.qty, season, now);
    case "buildWarehouse":
      return buildWarehouse(ledger, now);
    case "sprayPest":
      return sprayPest(ledger, action.slot, action.tree, now);
    case "sprayPestAll":
      return sprayPestAll(ledger, now);
    case "buildMachine":
      return buildMachine(ledger, action.machine, now);
    case "upgradeMachine":
      return upgradeMachine(ledger, action.machine, now);
    case "craftMachine":
      return craftMachine(ledger, action.machine, action.item, now);
    case "harvestAll":
      return harvestAll(ledger, now, rng);
    case "buySeed":
      return buySeed(ledger, action.seed, action.qty, season, now);
    case "buySupply":
      return buySupply(ledger, action.supply, action.qty, season, now);
    case "sellCrop":
      return sellCrop(ledger, action.item, action.effects, action.qty, action.pest === true, season, now);
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
    pest: false,
    protectedUntil: 0,
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
  next.stats.spent += tree.buy;
  const events = eventsAt(now);
  next.trees[slot] = {
    slot,
    tree: tree.id,
    plantedAt: now,
    readyAt: now + growTimeForEvents(tree, events),
    effects: rollEffectsFor(events, rng),
    pest: false,
    protectedUntil: 0,
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
  addCrop(next.bag.crops, plot.seed, resolvedCropEffects(plot, now), 1, plot.pest);
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
      pest: false,
      protectedUntil: plot.protectedUntil,
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
  addCrop(next.bag.crops, tree.tree, resolvedTreeEffects(tree, now), 1, tree.pest);
  next.stats.harvested += 1;
  const events = eventsAt(now);
  const sprayBonus = tree.spray === null ? {} : (sprayById(tree.spray.id)?.effectChances ?? {});
  next.trees[slot] = {
    slot,
    tree: tree.tree,
    plantedAt: now,
    readyAt: now + growTimeForEvents(definition, events, tree.fertilizer),
    effects: rollEffectsFor(events, rng, sprayBonus),
    pest: false,
    protectedUntil: tree.protectedUntil,
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
  next.stats.spent += total;
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
  next.stats.spent += cost;
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
  next.stats.spent += cost;
  return changed(next, now);
}

/** @brief Buys rare tools from a restock that happens to carry them. */
function buyTool(
  ledger: GardenLedger,
  tool: ToolId,
  qty: number,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const definition = toolById(tool);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  const offer = season.shop.tools.find((entry) => entry.tool === tool);
  if (offer === undefined || offer.stock < qty) return { ok: false, code: "TOOL_SOLD_OUT" };
  const total = offer.price * qty;
  if (ledger.coins < total) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= total;
  next.stats.spent += total;
  next.bag.tools[tool] = (next.bag.tools[tool] ?? 0) + qty;
  return changed(next, now);
}

/**
 * @brief Runs owned automatic tools for every elapsed cycle.
 * @param ledger Garden before the tool pass.
 * @param now Server clock.
 * @details The watering machine picks ten percent (at least one) of the plants
 * that are still growing and not watered yet, seeded by player and cycle so the
 * result is stable for every device.
 */
export function settleTools(ledger: GardenLedger, now: number): GardenLedger {
  if ((ledger.bag.tools?.autoWater ?? 0) < 1) return ledger;
  const elapsed = now - ledger.toolsSettledAt;
  if (elapsed < FARM_CYCLE_MS) return ledger;
  const cycles = Math.min(20, Math.floor(elapsed / FARM_CYCLE_MS));
  if (cycles <= 0) return ledger;

  const next = clone(ledger);
  const startCycle = Math.floor(ledger.toolsSettledAt / FARM_CYCLE_MS);
  next.toolsSettledAt = ledger.toolsSettledAt + cycles * FARM_CYCLE_MS;

  for (let step = 0; step < cycles; step += 1) {
    const rng = createRng(hash32(`tool:${ledger.playerId}:${startCycle + step}`));
    const candidates: Array<{ slot: number; tree: boolean }> = [];
    for (let tab = 0; tab < next.tabs; tab += 1) {
      const open = next.unlockedPatches[tab] ?? 1;
      for (let patch = 0; patch < open; patch += 1) {
        for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
          const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
          const entry = next.plots[slot] ?? null;
          if (entry !== null && now < entry.readyAt && !entry.watered) candidates.push({ slot, tree: false });
        }
      }
    }
    for (let slot = 0; slot < next.trees.length; slot += 1) {
      const entry = next.trees[slot] ?? null;
      if (entry !== null && now < entry.readyAt && !entry.watered) candidates.push({ slot, tree: true });
    }
    if (candidates.length === 0) break;

    const count = Math.max(1, Math.min(candidates.length, Math.round(candidates.length * 0.1)));
    for (let index = 0; index < count; index += 1) {
      const pick = candidates.splice(Math.floor(rng() * candidates.length), 1)[0];
      if (pick === undefined) break;
      if (pick.tree) {
        const tree = next.trees[pick.slot] ?? null;
        if (tree === null) continue;
        const remaining = tree.readyAt - now;
        next.trees[pick.slot] = {
          ...tree,
          readyAt: Math.max(now + 1_000, tree.readyAt - Math.round(remaining * WATER_CUT_RATIO)),
          watered: true,
          effects: canonicalEffects([...tree.effects, "wet"]),
        };
      } else {
        const plot = next.plots[pick.slot] ?? null;
        if (plot === null) continue;
        const remaining = plot.readyAt - now;
        next.plots[pick.slot] = {
          ...plot,
          readyAt: Math.max(now + 1_000, plot.readyAt - Math.round(remaining * WATER_CUT_RATIO)),
          watered: true,
          effects: canonicalEffects([...plot.effects, "wet"]),
        };
      }
    }
  }
  return next;
}

/** @brief Empty animal vector for one building. */
function emptyAnimalSlots(count: number): (AnimalState | null)[] {
  return new Array<AnimalState | null>(count).fill(null);
}

/** @brief Adds one product unit to a mutable bag, merging equal star levels. */
function addProduct(products: ProductStack[], product: ProductId, star: number, qty: number): void {
  const index = products.findIndex((stack) => stack.product === product && stack.star === star);
  if (index < 0) {
    products.push({ product, star, qty });
    return;
  }
  const stack = products[index];
  if (stack === undefined) return;
  products[index] = { product, star, qty: stack.qty + qty };
}

/** @brief Builds one animal building at level 1. */
function buildBuilding(ledger: GardenLedger, building: BuildingId, now: number): RuleResult {
  const definition = buildingById(building);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.buildings[building] > 0) return { ok: false, code: "MAX_LEVEL" };
  if (ledger.coins < definition.price) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= definition.price;
  next.stats.spent += definition.price;
  next.buildings[building] = 1;
  next.animals[building] = emptyAnimalSlots(buildingSlots(building, 1));
  next.farmSettledAt = now;
  return changed(next, now);
}

/** @brief Upgrades one building by one level, adding its new slots. */
function upgradeBuilding(ledger: GardenLedger, building: BuildingId, now: number): RuleResult {
  const level = ledger.buildings[building];
  if (level <= 0) return { ok: false, code: "BUILDING_LOCKED" };
  if (level >= maxBuildingLevel(building)) return { ok: false, code: "MAX_LEVEL" };
  const cost = buildingUpgradeCost(building);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= cost;
  next.stats.spent += cost;
  next.buildings[building] = level + 1;
  const slots = buildingSlots(building, level + 1);
  const animals = next.animals[building];
  while (animals.length < slots) animals.push(null);
  return changed(next, now);
}

/** @brief Buys one animal into an empty building slot. */
function buyAnimal(
  ledger: GardenLedger,
  building: BuildingId,
  slot: number,
  animalId: AnimalId,
  now: number,
): RuleResult {
  const definition = animalById(animalId);
  if (definition === undefined || definition.building !== building) {
    return { ok: false, code: "BAD_REQUEST" };
  }
  const level = ledger.buildings[building];
  if (level <= 0) return { ok: false, code: "BUILDING_LOCKED" };
  const slots = buildingSlots(building, level);
  if (slot < 0 || slot >= slots) return { ok: false, code: "SLOT_OUT_OF_RANGE" };
  if ((ledger.animals[building][slot] ?? null) !== null) return { ok: false, code: "SLOT_OCCUPIED" };
  if (ledger.coins < definition.buy) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= definition.buy;
  next.stats.spent += definition.buy;
  next.animals[building][slot] = { kind: animalId, bornAt: now, pats: 0, lastProduceAt: now };
  if (
    next.animals.coop.every((entry) => entry === null) &&
    next.animals.barn.every((entry) => entry === null)
  ) {
    next.farmSettledAt = now;
  }
  return changed(next, now);
}

/** @brief Pets one animal: quality grows with attention. */
function patAnimal(ledger: GardenLedger, building: BuildingId, slot: number, now: number): RuleResult {
  const animal = ledger.animals[building]?.[slot] ?? null;
  if (animal === null) return { ok: false, code: "SLOT_EMPTY" };
  const next = clone(ledger);
  next.animals[building][slot] = { ...animal, pats: animal.pats + 1 };
  return changed(next, now);
}

/** @brief Sells one product stack at its quality and event price. */
function sellProduct(
  ledger: GardenLedger,
  product: ProductId,
  star: number,
  qty: number,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const products = ledger.bag.products ?? [];
  const stack = products.find((entry) => entry.product === product && entry.star === star);
  if (stack === undefined || stack.qty < qty) return { ok: false, code: "NO_PRODUCT" };
  const gross = productPrice(stack, season) * qty;
  const tax = Math.round(gross * SELL_TAX_RATE);

  const next = clone(ledger);
  next.coins += gross - tax;
  next.stats.earned += gross;
  next.stats.tax += tax;
  next.bag.products = (next.bag.products ?? [])
    .map((entry) =>
      entry.product === product && entry.star === star ? { ...entry, qty: entry.qty - qty } : entry,
    )
    .filter((entry) => entry.qty > 0);
  return changed(next, now);
}

/** @brief Sells every animal product in the bag. */
function sellAllProducts(ledger: GardenLedger, season: SeasonSnapshot, now: number): RuleResult {
  const products = ledger.bag.products ?? [];
  if (products.length === 0) return { ok: false, code: "NO_PRODUCT" };
  let total = 0;
  for (const stack of products) total += productPrice(stack, season) * stack.qty;
  if (total <= 0) return { ok: false, code: "NO_PRODUCT" };
  const tax = Math.round(total * SELL_TAX_RATE);

  const next = clone(ledger);
  next.coins += total - tax;
  next.stats.earned += total;
  next.stats.tax += tax;
  next.bag.products = [];
  return changed(next, now);
}

/**
 * @brief Settles animal upkeep and production up to now.
 * @param ledger Garden before settlement.
 * @param now Server clock.
 * @details Every elapsed cycle costs the sum of the animals' upkeep. When the
 * wallet covers it, each animal advances its production timer and drops items
 * at its current quality; when it does not, animals go unfed and produce
 * nothing for those cycles.
 */
export function settleFarm(ledger: GardenLedger, now: number): GardenLedger {
  const animals = [...ledger.animals.coop, ...ledger.animals.barn].filter(
    (animal): animal is AnimalState => animal !== null,
  );
  if (animals.length === 0) return ledger;
  const elapsed = now - ledger.farmSettledAt;
  if (elapsed < FARM_CYCLE_MS) return ledger;

  const cycles = Math.min(100, Math.floor(elapsed / FARM_CYCLE_MS));
  if (cycles <= 0) return ledger;
  const next = clone(ledger);
  next.farmSettledAt = ledger.farmSettledAt + cycles * FARM_CYCLE_MS;

  let upkeep = 0;
  for (const animal of animals) upkeep += (animalById(animal.kind)?.upkeep ?? 0) * cycles;
  const paid = Math.min(next.coins, upkeep);
  next.coins -= paid;
  next.stats.spent += paid;
  if (paid < upkeep) return next;

  const collections: Array<{ building: BuildingId; slot: number; animal: AnimalState }> = [];
  for (const building of ["coop", "barn"] as const) {
    next.animals[building].forEach((animal, slot) => {
      if (animal !== null) collections.push({ building, slot, animal });
    });
  }
  for (const entry of collections) {
    const definition = animalById(entry.animal.kind);
    if (definition === undefined) continue;
    const interval = animalIntervalMs(entry.animal.kind);
    const produced = Math.min(50, Math.floor((now - entry.animal.lastProduceAt) / interval));
    if (produced <= 0) continue;
    const star = animalQuality(entry.animal, now);
    addProduct((next.bag.products ??= []), definition.product, star, produced);
    next.animals[entry.building][entry.slot] = {
      ...entry.animal,
      lastProduceAt: entry.animal.lastProduceAt + produced * interval,
    };
  }
  return next;
}

/** @brief Sprays pesticide on one plant: cures pests and protects one day. */
function sprayPest(ledger: GardenLedger, slot: number, tree: boolean, now: number): RuleResult {
  const plant = tree ? (ledger.trees[slot] ?? null) : (ledger.plots[slot] ?? null);
  if (plant === null) return { ok: false, code: "PLOT_EMPTY" };
  if (ledger.coins < PEST_SPRAY_COST) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= PEST_SPRAY_COST;
  next.stats.spent += PEST_SPRAY_COST;
  const updated = { ...plant, pest: false, protectedUntil: now + PEST_PROTECTION_MS };
  if (tree) next.trees[slot] = updated as (typeof next.trees)[number];
  else next.plots[slot] = updated as (typeof next.plots)[number];
  return changed(next, now);
}

/** @brief Sprays every planted crop and tree at once, 100 coins each. */
function sprayPestAll(ledger: GardenLedger, now: number): RuleResult {
  const crops: number[] = [];
  for (let tab = 0; tab < ledger.tabs; tab += 1) {
    const open = ledger.unlockedPatches[tab] ?? 1;
    for (let patch = 0; patch < open; patch += 1) {
      for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
        const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
        if ((ledger.plots[slot] ?? null) !== null) crops.push(slot);
      }
    }
  }
  const trees: number[] = [];
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    if ((ledger.trees[slot] ?? null) !== null) trees.push(slot);
  }
  const count = crops.length + trees.length;
  if (count === 0) return { ok: false, code: "NOTHING_TO_DO" };
  const cost = count * PEST_SPRAY_COST;
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= cost;
  next.stats.spent += cost;
  for (const slot of crops) {
    const plot = next.plots[slot];
    if (plot !== null && plot !== undefined) {
      next.plots[slot] = { ...plot, pest: false, protectedUntil: now + PEST_PROTECTION_MS };
    }
  }
  for (const slot of trees) {
    const tree = next.trees[slot];
    if (tree !== null && tree !== undefined) {
      next.trees[slot] = { ...tree, pest: false, protectedUntil: now + PEST_PROTECTION_MS };
    }
  }
  return changed(next, now);
}

/**
 * @brief Rolls pest strikes for every elapsed cycle.
 * @param ledger Garden before the roll.
 * @param now Server clock.
 * @details Unprotected plants have a small seeded chance each cycle to catch
 * pests: value halves and the remaining growth time is stretched 50%.
 */
export function settlePest(ledger: GardenLedger, now: number): GardenLedger {
  const elapsed = now - ledger.pestSettledAt;
  if (elapsed < FARM_CYCLE_MS) return ledger;
  const cycles = Math.min(20, Math.floor(elapsed / FARM_CYCLE_MS));
  if (cycles <= 0) return ledger;

  const next = clone(ledger);
  const startCycle = Math.floor(ledger.pestSettledAt / FARM_CYCLE_MS);
  next.pestSettledAt = ledger.pestSettledAt + cycles * FARM_CYCLE_MS;

  for (let step = 0; step < cycles; step += 1) {
    const cycle = startCycle + step;
    for (let tab = 0; tab < next.tabs; tab += 1) {
      const open = next.unlockedPatches[tab] ?? 1;
      for (let patch = 0; patch < open; patch += 1) {
        for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
          const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
          const plant = next.plots[slot] ?? null;
          if (plant === null || plant.pest || plant.protectedUntil > now) continue;
          const rng = createRng(hash32(`pest:${ledger.playerId}:c${slot}:${cycle}`));
          if (rng() >= PEST_CHANCE_PER_CYCLE) continue;
          const remaining = Math.max(0, plant.readyAt - now);
          next.plots[slot] = {
            ...plant,
            pest: true,
            readyAt: plant.readyAt + Math.round(remaining * (PEST_GROWTH_PENALTY - 1)),
          };
        }
      }
    }
    for (let slot = 0; slot < next.trees.length; slot += 1) {
      const tree = next.trees[slot] ?? null;
      if (tree === null || tree.pest || tree.protectedUntil > now) continue;
      const rng = createRng(hash32(`pest:${ledger.playerId}:t${slot}:${cycle}`));
      if (rng() >= PEST_CHANCE_PER_CYCLE) continue;
      const remaining = Math.max(0, tree.readyAt - now);
      next.trees[slot] = {
        ...tree,
        pest: true,
        readyAt: tree.readyAt + Math.round(remaining * (PEST_GROWTH_PENALTY - 1)),
      };
    }
  }
  return next;
}

/** @brief Builds the warehouse once. */
function buildWarehouse(ledger: GardenLedger, now: number): RuleResult {
  if (ledger.warehouse > 0) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.coins < WAREHOUSE_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= WAREHOUSE_PRICE;
  next.stats.spent += WAREHOUSE_PRICE;
  next.warehouse = 1;
  return changed(next, now);
}

/** @brief Builds one machine inside a built warehouse. */
function buildMachine(ledger: GardenLedger, id: MachineId, now: number): RuleResult {
  const definition = machineById(id);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.warehouse <= 0) return { ok: false, code: "WAREHOUSE_LOCKED" };
  if (ledger.machines[id] !== undefined) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.coins < MACHINE_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= MACHINE_PRICE;
  next.stats.spent += MACHINE_PRICE;
  next.machines[id] = { level: 1, lastCraftAt: 0 };
  return changed(next, now);
}

/** @brief Upgrades one machine, same price per step, max level three. */
function upgradeMachine(ledger: GardenLedger, id: MachineId, now: number): RuleResult {
  const machine = ledger.machines[id];
  if (machine === undefined) return { ok: false, code: "MACHINE_LOCKED" };
  if (machine.level >= MACHINE_MAX_LEVEL) return { ok: false, code: "MACHINE_MAX" };
  if (ledger.coins < MACHINE_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= MACHINE_PRICE;
  next.stats.spent += MACHINE_PRICE;
  next.machines[id] = { ...machine, level: machine.level + 1 };
  return changed(next, now);
}

/** @brief Consumes one recipe input and returns its output batch. */
function craftMachine(
  ledger: GardenLedger,
  id: MachineId,
  item: ItemId | undefined,
  now: number,
): RuleResult {
  const definition = machineById(id);
  const machine = ledger.machines[id];
  if (definition === undefined || machine === undefined) return { ok: false, code: "MACHINE_LOCKED" };
  if (now - machine.lastCraftAt < definition.cooldownCycles * FARM_CYCLE_MS) {
    return { ok: false, code: "MACHINE_COOLDOWN" };
  }

  const next = clone(ledger);
  if (definition.input.kind === "product") {
    const inputProduct = definition.input.product;
    const stack = next.bag.products.find((entry) => entry.product === inputProduct && entry.qty > 0);
    if (stack === undefined) return { ok: false, code: "NO_INPUT" };
    const star = stack.star;
    next.bag.products = next.bag.products
      .map((entry) =>
        entry.product === stack.product && entry.star === stack.star
          ? { ...entry, qty: entry.qty - 1 }
          : entry,
      )
      .filter((entry) => entry.qty > 0);
    if (definition.output.kind === "product") {
      addProduct(next.bag.products, definition.output.product, star, converterOutput(machine.level));
    }
  } else {
    const seedId = item === undefined ? undefined : seedById(item);
    if (seedId === undefined) return { ok: false, code: "NO_INPUT" };
    const allowed = definition.input.seeds;
    if (allowed !== undefined && !allowed.includes(seedId.id)) return { ok: false, code: "NO_INPUT" };
    const stack = next.bag.crops.find((entry) => entry.item === seedId.id);
    if (stack === undefined || stack.qty < 1) return { ok: false, code: "NO_INPUT" };
    next.bag.crops = next.bag.crops
      .map((entry) => (entry === stack ? { ...entry, qty: entry.qty - 1 } : entry))
      .filter((entry) => entry.qty > 0);
    if (definition.output.kind === "seeds") {
      next.bag.seeds[seedId.id] = (next.bag.seeds[seedId.id] ?? 0) + seedMakerOutput(machine.level);
    } else {
      addProduct(next.bag.products, definition.output.product, 1, converterOutput(machine.level));
    }
  }
  next.machines[id] = { ...machine, lastCraftAt: now };
  return changed(next, now);
}

/** @brief Buys the next tab at the compounding ladder price. */
function buyTab(ledger: GardenLedger, now: number): RuleResult {
  if (ledger.tabs >= MAX_TABS) return { ok: false, code: "MAX_TABS" };
  const cost = nextTabPrice(ledger.tabs);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= cost;
  next.stats.spent += cost;
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
  next.stats.spent += cost;
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
  next.stats.spent += total;
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
  pest: boolean,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const stack = ledger.bag.crops.find((entry) => entry.item === item && sameEffects(entry.effects, effects));
  if (stack === undefined || stack.qty < qty) return { ok: false, code: "NO_CROP" };

  const next = clone(ledger);
  const gross = cropSellPrice(stack, season) * qty;
  const tax = Math.round(gross * SELL_TAX_RATE);
  next.coins += gross - tax;
  next.stats.earned += gross;
  next.stats.tax += tax;
  removeCrop(next.bag.crops, item, effects, pest, qty);
  return changed(next, now);
}

/** @brief Sells every harvested stack. */
function sellAll(ledger: GardenLedger, season: SeasonSnapshot, now: number): RuleResult {
  if (ledger.bag.crops.length === 0) return { ok: false, code: "NOTHING_TO_SELL" };
  const next = clone(ledger);
  let total = 0;
  for (const stack of next.bag.crops) total += cropSellPrice(stack, season) * stack.qty;
  if (total <= 0) return { ok: false, code: "NOTHING_TO_SELL" };
  const tax = Math.round(total * SELL_TAX_RATE);
  next.coins += total - tax;
  next.stats.earned += total;
  next.stats.tax += tax;
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
      products: (ledger.bag.products ?? []).map((stack) => ({ ...stack })),
      tools: { ...ledger.bag.tools },
    },
    buildings: { ...ledger.buildings },
    animals: {
      coop: ledger.animals.coop.map((animal) => (animal === null ? null : { ...animal })),
      barn: ledger.animals.barn.map((animal) => (animal === null ? null : { ...animal })),
    },
    farmSettledAt: ledger.farmSettledAt,
    warehouse: ledger.warehouse,
    machines: Object.fromEntries(
      Object.entries(ledger.machines).map(([id, machine]) => [
        id,
        machine === undefined ? undefined : { ...machine },
      ]),
    ) as Partial<Record<MachineId, MachineState>>,
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
function addCrop(
  crops: CropStack[],
  item: ItemId,
  effects: readonly EffectId[],
  qty: number,
  pest = false,
): void {
  const canonical = canonicalEffects(effects);
  const stack = crops.find(
    (entry) => entry.item === item && sameEffects(entry.effects, canonical) && (entry.pest === true) === pest,
  );
  if (stack === undefined) {
    crops.push({ item, effects: canonical, ...(pest ? { pest: true } : {}), qty });
    return;
  }
  crops[crops.indexOf(stack)] = {
    item,
    effects: canonical,
    ...(pest ? { pest: true } : {}),
    qty: stack.qty + qty,
  };
}

/** @brief Removes produce units from a mutable bag, dropping empty stacks. */
function removeCrop(
  crops: CropStack[],
  item: ItemId,
  effects: readonly EffectId[],
  pest: boolean,
  qty: number,
): void {
  const index = crops.findIndex(
    (entry) => entry.item === item && sameEffects(entry.effects, effects) && (entry.pest === true) === pest,
  );
  if (index < 0) return;
  const stack = crops[index];
  if (stack === undefined) return;
  const left = stack.qty - qty;
  if (left <= 0) crops.splice(index, 1);
  else
    crops[index] = { item, effects: canonicalEffects(effects), ...(pest ? { pest: true } : {}), qty: left };
}
