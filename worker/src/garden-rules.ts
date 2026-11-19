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
  SPECIAL_PATCHES,
  SPECIAL_PATCH_PRICE,
  SPECIAL_PLOTS_PER_PATCH,
  SPECIAL_PLOT_PRICE,
  SPECIAL_SLOTS,
  WATER_ALL_COST,
  SELL_TAX_RATE,
  SOIL_START,
  ACHIEVEMENTS,
  COMPOST_RATIO,
  FUTURE_FEE_RATE,
  FUTURE_LOCK_MS,
  GREENHOUSE_PRICES,
  INSURANCE_DURATION_MS,
  INSURANCE_PAYOUT,
  INSURANCE_PRICE,
  PET_PRICES,
  SPLICE_MAX_BONUS,
  WHEEL_PITY,
  WHEEL_PRICE,
  EGG_PRICE,
  EFFECTS,
  STAFF_QUIT_UNPAID,
  STAFF_SLOTS,
  staffGainXp,
  staffHireCost,
  staffMarketAt,
  staffWorkInterval,
  STAFF_XP_PER_TASK,
  type StaffRole,
  type StaffState,
  PET_MAX_LEVEL,
  DEFAULT_SKILLS,
  addSkillXp,
  artisaningOutputBonus,
  farmingGrowFactor,
  farmingSellBonus,
  ranchingSellBonus,
  ranchingUpkeepFactor,
  type SkillId,
  type SkillState,
  contractOffers,
  equippedPetEffect,
  merchantOffers,
  petById,
  rollPet,
  basePriceOf,
  FERTILIZERS,
  SPRAYS,
  SEEDS,
  dayIndexAt,
  weekKeyAt,
  seasonAt,
  SOIL_STEP,
  soilGrowthFactor,
  soilRenovateCost,
  PEST_CHANCE_PER_CYCLE,
  PEST_GROWTH_PENALTY,
  PEST_PROTECTION_MS,
  PEST_SPRAY_COST,
  ANIMALS,
  BARN_BIRTH_CHANCE,
  BREED_CYCLES,
  BUILDING_IDS,
  POND_GROWTH_CYCLES,
  POND_GROWTH_MAX,
  POND_GROWTH_STEP,
  animalById,
  animalIntervalMs,
  animalIsIncubating,
  animalMeatPrice,
  animalQuality,
  breedEggProduct,
  needsFertilizer,
  needsSpray,
  pondGrowthFactor,
  buildingById,
  buildingSlots,
  buildingUpgradeCost,
  MACHINE_MAX_LEVEL,
  MACHINE_PRICE,
  WAREHOUSE_PRICE,
  converterOutput,
  driedStarForSell,
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
  sprayBoostFor,
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
  type FutureLock,
  type PetId,
  type MachineDefinition,
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
  /** Fish pond growth in percent. */
  pondGrowth: number;
  /** Last automatic-tool settlement. */
  toolsSettledAt: number;
  /** Last pest strike roll. */
  pestSettledAt: number;
  /** Fertility percent per crop cell. */
  soil: number[];
  /** Owned special patches (premium plots that never auto-sell). */
  specialPatches: number;
  /** Unlocked plots per special patch. */
  specialUnlocked: number[];
  /** Premium plots outside the normal crop grid. */
  specialPlots: (PlotState | null)[];
  /** Last crop planted on each cell, for rotation. */
  lastCrop: (SeedId | null)[];
  /** Greenhouse level. */
  greenhouse: number;
  /** Pet level (legacy, ignored by the gacha pets). */
  pet: number;
  /** Owned pet copies by id. */
  pets: Partial<Record<PetId, number>>;
  /** Equipped pet. */
  equippedPet: PetId | null;
  /** Last hatched pet id. */
  lastHatch: string;
  /** Egg counters. */
  eggCount: number;
  eggPity: number;
  /** Skill progress. */
  skills: Record<SkillId, SkillState>;
  /** Hired staff. */
  staff: StaffState[];
  /** Candidate ids already hired (prevents rehire after firing). */
  staffClaims: string[];
  /** Insurance expiry. */
  insuranceUntil: number;
  /** Genetics bonus in percentage points. */
  spliceBonus: number;
  /** Daily streak state. */
  streak: number;
  lastStreakDay: number;
  /** Claimed achievements. */
  achievements: string[];
  /** Collection keys. */
  collection: string[];
  /** Wheel counters. */
  wheelSpins: number;
  wheelPity: number;
  wheelLast: string;
  /** Locked sale prices. */
  futures: FutureLock[];
  contractClaims: string[];
  merchantClaims: string[];
  /** Weekly tournament bucket. */
  weekKey: number;
  weekEarned: number;
  weekHarvested: number;
  lastEarned: number;
  lastHarvested: number;
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
    buildings: { coop: 0, barn: 0, pond: 0 },
    animals: { coop: [], barn: [], pond: [] },
    farmSettledAt: input.now,
    pondGrowth: 0,
    toolsSettledAt: input.now,
    pestSettledAt: input.now,
    soil: new Array<number>(totalCrops(STARTING_TABS)).fill(SOIL_START),
    specialPatches: 0,
    specialUnlocked: new Array<number>(SPECIAL_PATCHES).fill(0),
    specialPlots: new Array<PlotState | null>(SPECIAL_SLOTS).fill(null),
    lastCrop: new Array<SeedId | null>(totalCrops(STARTING_TABS)).fill(null),
    greenhouse: 0,
    pet: 0,
    pets: {},
    equippedPet: null,
    lastHatch: "",
    eggCount: 0,
    eggPity: 0,
    skills: { ...DEFAULT_SKILLS },
    staff: [],
    staffClaims: [],
    insuranceUntil: 0,
    spliceBonus: 0,
    streak: 0,
    // A new garden starts counted for today; the first reward lands tomorrow.
    lastStreakDay: dayIndexAt(input.now),
    achievements: [],
    collection: [],
    wheelSpins: 0,
    wheelPity: 0,
    wheelLast: "",
    futures: [],
    contractClaims: [],
    merchantClaims: [],
    weekKey: weekKeyAt(input.now),
    weekEarned: 0,
    weekHarvested: 0,
    lastEarned: 0,
    lastHarvested: 0,
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
/** @brief Public extras projection for snapshots and visits. */
export function extrasSnapshot(ledger: GardenLedger): GardenSnapshot["extras"] {
  return {
    streak: ledger.streak,
    lastStreakDay: ledger.lastStreakDay,
    achievements: [...ledger.achievements],
    collection: [...ledger.collection],
    greenhouse: ledger.greenhouse,
    pet: ledger.pet,
    insuranceUntil: ledger.insuranceUntil,
    spliceBonus: ledger.spliceBonus,
    wheelSpins: ledger.wheelSpins,
    wheelPity: ledger.wheelPity,
    wheelLast: ledger.wheelLast,
    futures: ledger.futures.map((future) => ({ ...future })),
    contractClaims: [...ledger.contractClaims],
    merchantClaims: [...ledger.merchantClaims],
    weekKey: ledger.weekKey,
    weekEarned: ledger.weekEarned,
    weekHarvested: ledger.weekHarvested,
    pets: { ...ledger.pets },
    equippedPet: ledger.equippedPet,
    lastHatch: ledger.lastHatch,
    staff: ledger.staff.map((worker) => ({ ...worker, traits: [...worker.traits] })),
  };
}

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
      pond: (ledger.animals.pond ?? []).map((animal) => (animal === null ? null : { ...animal })),
    },
    farmSettledAt: ledger.farmSettledAt,
    pondGrowth: ledger.pondGrowth ?? 0,
    soil: [...ledger.soil],
    specialPatches: ledger.specialPatches ?? 0,
    specialUnlocked: [...(ledger.specialUnlocked ?? [])],
    specialPlots: (ledger.specialPlots ?? []).map((plot) => (plot === null ? null : { ...plot })),
    extras: extrasSnapshot(ledger),
    skills: {
      farming: { ...ledger.skills.farming },
      ranching: { ...ledger.skills.ranching },
      artisaning: { ...ledger.skills.artisaning },
    },
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
        ? harvestTree(ledger, action.slot, now, rng, action.auto === true)
        : harvest(ledger, action.slot, now, rng, action.auto === true);
    case "water":
      return action.tree ? waterTree(ledger, action.slot, now) : water(ledger, action.slot, now);
    case "fertilize":
      return fertilize(ledger, action.slot, action.supply, now, action.tree);
    case "spray":
      return spray(ledger, action.slot, action.supply, now, action.tree, rng);
    case "uproot":
      return action.tree ? uprootTree(ledger, action.slot, now) : uproot(ledger, action.slot, now);
    case "reclaimSeed":
      return reclaimSeed(ledger, action.slot, now);
    case "movePlant":
      return movePlant(ledger, action.from, action.to, action.tree, now);
    case "toggleFavorite":
      return toggleFavorite(ledger, action.slot, action.tree, now);
    case "buyTab":
      return buyTab(ledger, now);
    case "buyPatch":
      return buyPatch(ledger, action.tab, now);
    case "buySpecialPatch":
      return buySpecialPatch(ledger, action.patch, now);
    case "buySpecialPlot":
      return buySpecialPlot(ledger, action.patch, now);
    case "plantSpecial":
      return withSpecial(ledger, plant, action.slot, action.seed, now, rng);
    case "harvestSpecial":
      return withSpecial(ledger, harvest, action.slot, now, rng);
    case "waterSpecial":
      return withSpecial(ledger, water, action.slot, now);
    case "uprootSpecial":
      return withSpecial(ledger, uproot, action.slot, now);
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
    case "breedAnimal":
      return breedAnimal(ledger, action.building, action.slot, now);
    case "sellAnimal":
      return sellAnimal(ledger, action.building, action.slot, now);
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
    case "fertilizeAll":
      return fertilizeAll(ledger, action.supply, season, now);
    case "sprayAll":
      return sprayAll(ledger, action.supply, season, now, rng);
    case "renovateSoil":
      return renovateSoil(ledger, now);
    case "fulfillContract":
      return fulfillContract(ledger, action.id, season, now);
    case "buyMerchant":
      return buyMerchant(ledger, action.id, now);
    case "buyInsurance":
      return buyInsurance(ledger, now);
    case "lockFuture":
      return lockFuture(ledger, action.item, action.qty, season, now);
    case "spliceCrops":
      return spliceCrops(ledger, action.item, now);
    case "compostCrops":
      return compostCrops(ledger, now);
    case "buyGreenhouse":
      return buyGreenhouse(ledger, now);
    case "hatchEgg":
      return hatchEgg(ledger, now);
    case "equipPet":
      return equipPet(ledger, action.pet, now);
    case "hireStaff":
      return hireStaff(ledger, action.id, now);
    case "fireStaff":
      return fireStaff(ledger, action.index, now);
    case "setStaffRole":
      return setStaffRole(ledger, action.index, action.role, now);
    case "spinWheel":
      return spinWheel(ledger, now);
    case "buildMachine":
      return buildMachine(ledger, action.machine, now);
    case "upgradeMachine":
      return upgradeMachine(ledger, action.machine, now);
    case "craftMachine":
      return craftMachine(ledger, action.machine, action.item, now);
    case "collectMachine":
      return collectMachine(ledger, action.machine, now);
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

/** @brief Whether one special plot is owned and unlocked. */
function specialSlotOpen(ledger: GardenLedger, slot: number): boolean {
  if (slot < 0 || slot >= SPECIAL_SLOTS) return false;
  const patch = Math.floor(slot / SPECIAL_PLOTS_PER_PATCH);
  const local = slot % SPECIAL_PLOTS_PER_PATCH;
  if (patch >= (ledger.specialPatches ?? 0)) return false;
  return local < (ledger.specialUnlocked?.[patch] ?? 0);
}

/** @brief Opens the next special patch (ten billion coins, in order). */
function buySpecialPatch(ledger: GardenLedger, patch: number, now: number): RuleResult {
  if (patch !== (ledger.specialPatches ?? 0)) return { ok: false, code: "PLOT_LOCKED" };
  if (patch >= SPECIAL_PATCHES) return { ok: false, code: "MAX_PATCHES" };
  if (ledger.coins < SPECIAL_PATCH_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= SPECIAL_PATCH_PRICE;
  next.stats.spent += SPECIAL_PATCH_PRICE;
  next.specialPatches = patch + 1;
  if (next.specialUnlocked[patch] === undefined) next.specialUnlocked[patch] = 0;
  return changed(next, now);
}

/** @brief Opens one plot inside an owned special patch (a billion coins). */
function buySpecialPlot(ledger: GardenLedger, patch: number, now: number): RuleResult {
  if (patch < 0 || patch >= (ledger.specialPatches ?? 0)) return { ok: false, code: "PLOT_LOCKED" };
  const unlocked = ledger.specialUnlocked?.[patch] ?? 0;
  if (unlocked >= SPECIAL_PLOTS_PER_PATCH) return { ok: false, code: "MAX_PATCHES" };
  if (ledger.coins < SPECIAL_PLOT_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= SPECIAL_PLOT_PRICE;
  next.stats.spent += SPECIAL_PLOT_PRICE;
  next.specialUnlocked[patch] = unlocked + 1;
  return changed(next, now);
}

/**
 * @brief Runs a normal crop rule against the special plot vector.
 * @details The normal board and the special board share the crop rules; this
 * projects the ledger so `plots` temporarily points at the special vector,
 * then folds the result back (soil and tab state stay untouched).
 */
function withSpecial<T extends readonly unknown[]>(
  ledger: GardenLedger,
  rule: (projected: GardenLedger, slot: number, ...rest: T) => RuleResult,
  slot: number,
  ...rest: T
): RuleResult {
  if (!specialSlotOpen(ledger, slot)) return { ok: false, code: "PLOT_LOCKED" };
  const projected: GardenLedger = {
    ...ledger,
    tabs: 1,
    unlockedPatches: [SPECIAL_PLOTS_PER_PATCH],
    plots: ledger.specialPlots,
    soil: new Array<number>(SPECIAL_SLOTS).fill(SOIL_START),
  };
  const result = rule(projected, slot, ...rest);
  if (!result.ok) return result;
  return {
    ...result,
    ledger: {
      ...result.ledger,
      plots: ledger.plots,
      soil: ledger.soil,
      tabs: ledger.tabs,
      unlockedPatches: ledger.unlockedPatches,
      specialPlots: result.ledger.plots,
    },
  };
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
    readyAt:
      now + Math.round(growTimeForEvents(seed, events) * soilGrowthFactor(ledger.soil[slot] ?? SOIL_START)),
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
function harvest(
  ledger: GardenLedger,
  slot: number,
  now: number,
  rng: () => number,
  auto = false,
): RuleResult {
  const plot = ledger.plots[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (plot.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
  if (now < plot.readyAt) return { ok: false, code: "NOT_READY" };

  const next = clone(ledger);
  const harvestedEffects = resolvedCropEffects(plot, now);
  addCrop(next.bag.crops, plot.seed, harvestedEffects, 1, plot.pest);
  if (rng() < petEffect(ledger, "extraHarvest")) {
    addCrop(next.bag.crops, plot.seed, harvestedEffects, 1, plot.pest);
    next.weekHarvested += 1;
  }
  for (const effect of harvestedEffects) collect(next, `effect:${effect}`);
  next.stats.harvested += 1;
  grantXp(
    next,
    "farming",
    auto ? 1 : 100 + Math.round((seedById(plot.seed)?.sell ?? 0) * 3) + harvestedEffects.length * 25,
  );
  // One planting cycle always costs some fertility, even for reharvest plants.
  const fertility = Math.max(0, (next.soil[slot] ?? SOIL_START) - SOIL_STEP);
  next.soil[slot] = fertility;

  const seed = seedById(plot.seed);
  if (seed !== undefined && seed.regrow) {
    const events = eventsAt(now);
    const petMutation = petEffect(ledger, "mutation");
    const mutationBonus: Partial<Record<EffectId, number>> = {};
    if (petMutation > 0) {
      for (const effect of EFFECTS)
        if (effect.natural) mutationBonus[effect.id] = (mutationBonus[effect.id] ?? 0) + petMutation;
    }
    next.plots[slot] = {
      slot,
      seed: plot.seed,
      plantedAt: now,
      readyAt:
        now + Math.round(growTimeForEvents(seed, events, plot.fertilizer) * soilGrowthFactor(fertility)),
      effects: rollEffectsFor(events, rng, mutationBonus, sprayBoostFor(plot.spray)),
      pest: false,
      protectedUntil: plot.protectedUntil,
      favorite: plot.favorite,
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
function harvestTree(
  ledger: GardenLedger,
  slot: number,
  now: number,
  rng: () => number,
  auto = false,
): RuleResult {
  const tree = ledger.trees[slot] ?? null;
  if (tree === null) return { ok: false, code: "PLOT_EMPTY" };
  if (tree.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
  if (now < tree.readyAt) return { ok: false, code: "NOT_READY" };
  const definition = treeById(tree.tree);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };

  const next = clone(ledger);
  addCrop(next.bag.crops, tree.tree, resolvedTreeEffects(tree, now), 1, tree.pest);
  next.stats.harvested += 1;
  const events = eventsAt(now);
  next.trees[slot] = {
    slot,
    tree: tree.tree,
    plantedAt: now,
    readyAt: now + growTimeForEvents(definition, events, tree.fertilizer),
    effects: rollEffectsFor(events, rng, {}, sprayBoostFor(tree.spray)),
    pest: false,
    protectedUntil: tree.protectedUntil,
    favorite: tree.favorite,
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

  // A spray only raises the base mutation chance while it lasts: it never
  // grants a mutation by itself.
  const next = clone(ledger);
  next.bag.supplies[supply] = owned - 1;
  const updated = {
    ...plant,
    spray: { id: supply, left: definition.harvests },
  };
  if (tree) next.trees[slot] = updated as (typeof next.trees)[number];
  else next.plots[slot] = updated as (typeof next.plots)[number];
  return changed(next, now);
}

/** @brief Market price of one supply unit for a pay-after-use bulk charge. */
function bulkSupplyUnit(season: SeasonSnapshot, supply: SupplyId, base: number): number {
  return Math.max(0, season.buyPrices?.[supply] ?? base);
}

/**
 * @brief Fertilizes every growing, dry plant at once, billed per plant.
 * @param ledger Garden before the action.
 * @param supply Fertilizer picked by the player.
 * @param season Season snapshot holding the market price of that supply.
 * @param now Server clock.
 * @details No bag stock is needed: the player pays the market price per plant
 * after the fact, and only as many plants as the wallet covers are treated.
 */
function fertilizeAll(
  ledger: GardenLedger,
  supply: FertilizerId,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const definition = fertilizerById(supply);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  const unit = bulkSupplyUnit(season, supply, definition.price);

  const targets: Array<{ tree: boolean; slot: number }> = [];
  ledger.plots.forEach((plot, slot) => {
    if (plot !== null && needsFertilizer(plot, now)) targets.push({ tree: false, slot });
  });
  ledger.trees.forEach((tree, slot) => {
    if (tree !== null && needsFertilizer(tree, now)) targets.push({ tree: true, slot });
  });
  if (targets.length === 0) return { ok: false, code: "NOTHING_TO_DO" };
  const affordable = unit <= 0 ? targets.length : Math.min(targets.length, Math.floor(ledger.coins / unit));
  if (affordable <= 0) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  let cost = 0;
  for (const target of targets.slice(0, affordable)) {
    if (target.tree) {
      const tree = next.trees[target.slot];
      if (tree === null || tree === undefined) continue;
      const remaining = Math.max(0, tree.readyAt - now);
      next.trees[target.slot] = {
        ...tree,
        readyAt:
          now >= tree.readyAt
            ? tree.readyAt
            : now + Math.max(1_000, Math.round(remaining * definition.growMultiplier)),
        fertilized: true,
        fertilizer: { id: supply, left: definition.harvests },
      };
    } else {
      const plot = next.plots[target.slot];
      if (plot === null || plot === undefined) continue;
      const remaining = Math.max(0, plot.readyAt - now);
      next.plots[target.slot] = {
        ...plot,
        readyAt:
          now >= plot.readyAt
            ? plot.readyAt
            : now + Math.max(1_000, Math.round(remaining * definition.growMultiplier)),
        fertilized: true,
        fertilizer: { id: supply, left: definition.harvests },
      };
    }
    cost += unit;
  }
  next.coins -= cost;
  next.stats.spent += cost;
  return changed(next, now);
}

/**
 * @brief Sprays every plant that has no charge yet, billed per plant.
 * @details Same pay-after-use deal as {@link fertilizeAll}: one pick, one bill,
 * and each plant rolls its own mutation chances immediately.
 */
function sprayAll(
  ledger: GardenLedger,
  supply: SprayId,
  season: SeasonSnapshot,
  now: number,
  rng: () => number,
): RuleResult {
  const definition = sprayById(supply);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  const unit = bulkSupplyUnit(season, supply, definition.price);

  const targets: Array<{ tree: boolean; slot: number }> = [];
  ledger.plots.forEach((plot, slot) => {
    if (plot !== null && needsSpray(plot)) targets.push({ tree: false, slot });
  });
  ledger.trees.forEach((tree, slot) => {
    if (tree !== null && needsSpray(tree)) targets.push({ tree: true, slot });
  });
  if (targets.length === 0) return { ok: false, code: "NOTHING_TO_DO" };
  const affordable = unit <= 0 ? targets.length : Math.min(targets.length, Math.floor(ledger.coins / unit));
  if (affordable <= 0) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  let cost = 0;
  for (const target of targets.slice(0, affordable)) {
    const plant = target.tree ? next.trees[target.slot] : next.plots[target.slot];
    if (plant === null || plant === undefined) continue;
    const updated = {
      ...plant,
      spray: { id: supply, left: definition.harvests },
    };
    if (target.tree) next.trees[target.slot] = updated as (typeof next.trees)[number];
    else next.plots[target.slot] = updated as (typeof next.plots)[number];
    cost += unit;
  }
  next.coins -= cost;
  next.stats.spent += cost;
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
  const plot = ledger.plots[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (plot.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
  const next = clone(ledger);
  next.plots[slot] = null;
  return changed(next, now);
}

/** @brief Removes one tree without a refund. */
function uprootTree(ledger: GardenLedger, slot: number, now: number): RuleResult {
  const tree = ledger.trees[slot] ?? null;
  if (tree === null) return { ok: false, code: "PLOT_EMPTY" };
  if (tree.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
  const next = clone(ledger);
  next.trees[slot] = null;
  return changed(next, now);
}

/** @brief Spends one hand tool from the bag, or reports that none is left. */
function spendTool(ledger: GardenLedger, tool: ToolId): boolean {
  return (ledger.bag.tools?.[tool] ?? 0) > 0;
}

/** @brief Pops the planted seed back into the bag, spending a reclaimer. */
function reclaimSeed(ledger: GardenLedger, slot: number, now: number): RuleResult {
  const plot = ledger.plots[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (plot.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
  if (!spendTool(ledger, "reclaimer")) return { ok: false, code: "NO_TOOL" };

  const next = clone(ledger);
  next.bag.tools = { ...(next.bag.tools ?? {}) };
  next.bag.tools.reclaimer = (next.bag.tools.reclaimer ?? 0) - 1;
  next.bag.seeds[plot.seed] = (next.bag.seeds[plot.seed] ?? 0) + 1;
  next.plots[slot] = null;
  grantXp(next, "farming", 20);
  return changed(next, now);
}

/** @brief Relocates one plant, keeping its growth and charges, for a shovel. */
function movePlant(ledger: GardenLedger, from: number, to: number, tree: boolean, now: number): RuleResult {
  if (from === to) return { ok: false, code: "BAD_REQUEST" };
  if (!spendTool(ledger, "shovel")) return { ok: false, code: "NO_TOOL" };

  if (tree) {
    const plant = ledger.trees[from] ?? null;
    if (plant === null) return { ok: false, code: "PLOT_EMPTY" };
    if (plant.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
    if (to < 0 || to >= ledger.trees.length) return { ok: false, code: "PLOT_LOCKED" };
    if ((ledger.trees[to] ?? null) !== null) return { ok: false, code: "PLOT_OCCUPIED" };

    const next = clone(ledger);
    next.bag.tools = { ...(next.bag.tools ?? {}) };
    next.bag.tools.shovel = (next.bag.tools.shovel ?? 0) - 1;
    next.trees[to] = { ...plant, slot: to };
    next.trees[from] = null;
    return changed(next, now);
  }

  const plant = ledger.plots[from] ?? null;
  if (plant === null) return { ok: false, code: "PLOT_EMPTY" };
  if (plant.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
  if (to < 0 || to >= ledger.plots.length || !isCropPatchOpen(ledger, to)) {
    return { ok: false, code: "PLOT_LOCKED" };
  }
  if ((ledger.plots[to] ?? null) !== null) return { ok: false, code: "PLOT_OCCUPIED" };

  const next = clone(ledger);
  next.bag.tools = { ...(next.bag.tools ?? {}) };
  next.bag.tools.shovel = (next.bag.tools.shovel ?? 0) - 1;
  next.plots[to] = { ...plant, slot: to };
  next.plots[from] = null;
  return changed(next, now);
}

/**
 * @brief Pins or unpins one plant.
 * @details Pinning spends a favorite lock; unpinning is always free. A pinned
 * plant survives uproot, harvest, bulk harvest, shovels and reclaimers.
 */
function toggleFavorite(ledger: GardenLedger, slot: number, tree: boolean, now: number): RuleResult {
  const plant = tree ? (ledger.trees[slot] ?? null) : (ledger.plots[slot] ?? null);
  if (plant === null) return { ok: false, code: "PLOT_EMPTY" };

  const next = clone(ledger);
  if (plant.favorite === true) {
    const updated = { ...plant, favorite: false };
    if (tree) next.trees[slot] = updated as (typeof next.trees)[number];
    else next.plots[slot] = updated as (typeof next.plots)[number];
    return changed(next, now);
  }
  if (!spendTool(ledger, "favoriteLock")) return { ok: false, code: "NO_TOOL" };
  next.bag.tools = { ...(next.bag.tools ?? {}) };
  next.bag.tools.favoriteLock = (next.bag.tools.favoriteLock ?? 0) - 1;
  const updated = { ...plant, favorite: true };
  if (tree) next.trees[slot] = updated as (typeof next.trees)[number];
  else next.plots[slot] = updated as (typeof next.plots)[number];
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
        if (entry !== null && entry.favorite !== true && now >= entry.readyAt) crops.push(slot);
      }
    }
  }
  const trees: number[] = [];
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const entry = ledger.trees[slot] ?? null;
    if (entry !== null && entry.favorite !== true && now >= entry.readyAt) trees.push(slot);
  }
  const count = crops.length + trees.length;
  if (count === 0) return { ok: false, code: "NOTHING_TO_DO" };
  const cost = count * HARVEST_ALL_COST;
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  let current = ledger;
  for (const slot of crops) {
    const result = harvest(current, slot, now, rng, true);
    if (result.ok) current = result.ledger;
  }
  for (const slot of trees) {
    const result = harvestTree(current, slot, now, rng, true);
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
  collect(next, `tool:${tool}`);
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
  const anyAnimal = BUILDING_IDS.some((id) => next.animals[id].some((entry) => entry !== null));
  if (!anyAnimal) next.farmSettledAt = now;
  return changed(next, now);
}

/** @brief Pets one animal: quality grows with attention. */
function patAnimal(ledger: GardenLedger, building: BuildingId, slot: number, now: number): RuleResult {
  const animal = ledger.animals[building]?.[slot] ?? null;
  if (animal === null) return { ok: false, code: "SLOT_EMPTY" };
  const next = clone(ledger);
  next.animals[building][slot] = { ...animal, pats: animal.pats + 1 };
  grantXp(next, "ranching", 15);
  return changed(next, now);
}

/** @brief Keeps one egg warm so it hatches into a free coop slot. */
function breedAnimal(ledger: GardenLedger, building: BuildingId, slot: number, now: number): RuleResult {
  if (building !== "coop") return { ok: false, code: "NOT_BREEDABLE" };
  const animal = ledger.animals.coop?.[slot] ?? null;
  if (animal === null) return { ok: false, code: "SLOT_EMPTY" };
  if (animalIsIncubating(animal, now)) return { ok: false, code: "ALREADY_BREEDING" };
  const egg = breedEggProduct(animal.kind);
  if (egg === null) return { ok: false, code: "NOT_BREEDABLE" };
  const slots = buildingSlots("coop", ledger.buildings.coop);
  if (!ledger.animals.coop.slice(0, slots).some((entry) => entry === null)) {
    return { ok: false, code: "NO_FREE_SLOT" };
  }
  const stack = (ledger.bag.products ?? [])
    .filter((entry) => entry.product === egg && entry.qty > 0)
    .sort((left, right) => left.star - right.star)[0];
  if (stack === undefined) return { ok: false, code: "NO_EGG" };

  const next = clone(ledger);
  const products = next.bag.products ?? [];
  const index = products.findIndex((entry) => entry.product === egg && entry.star === stack.star);
  const current = products[index];
  if (current === undefined) return { ok: false, code: "NO_EGG" };
  if (current.qty <= 1) products.splice(index, 1);
  else products[index] = { ...current, qty: current.qty - 1 };

  next.animals.coop[slot] = {
    ...animal,
    incubatingUntil: now + BREED_CYCLES * FARM_CYCLE_MS,
  };
  grantXp(next, "ranching", 25);
  return changed(next, now);
}

/** @brief Sells one animal for meat; never a profit on land, a pond payoff. */
function sellAnimal(ledger: GardenLedger, building: BuildingId, slot: number, now: number): RuleResult {
  const animal = ledger.animals[building]?.[slot] ?? null;
  if (animal === null) return { ok: false, code: "SLOT_EMPTY" };
  if (animalIsIncubating(animal, now)) return { ok: false, code: "ALREADY_BREEDING" };
  const gross = animalMeatPrice(animal.kind, animalQuality(animal, now), ledger.pondGrowth ?? 0);
  const tax = Math.round(gross * SELL_TAX_RATE);

  const next = clone(ledger);
  next.coins += gross - tax;
  next.stats.earned += gross;
  next.stats.tax += tax;
  next.animals[building][slot] = null;
  grantXp(next, "ranching", 30 + Math.round(gross / 100));
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
  const crafted = ["mayo", "cheese", "pickles", "oil", "fabric"].includes(product);
  const bonus = crafted
    ? artisaningOutputBonus(ledger.skills.artisaning.level)
    : ranchingSellBonus(ledger.skills.ranching.level);
  const pond = product === "roe" || product === "snailMeat" ? pondGrowthFactor(ledger.pondGrowth ?? 0) : 1;
  const gross = Math.round(
    productPrice(stack, season) * qty * (1 + petEffect(ledger, "sell")) * (1 + bonus) * pond,
  );
  const tax = Math.round(gross * SELL_TAX_RATE);

  const next = clone(ledger);
  next.coins += gross - tax;
  next.stats.earned += gross;
  next.stats.tax += tax;
  grantXp(next, crafted ? "artisaning" : "ranching", 50 + Math.round(gross / 10));
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
  for (const stack of products) {
    const crafted = ["mayo", "cheese", "pickles", "oil", "fabric"].includes(stack.product);
    const bonus = crafted
      ? artisaningOutputBonus(ledger.skills.artisaning.level)
      : ranchingSellBonus(ledger.skills.ranching.level);
    const pond =
      stack.product === "roe" || stack.product === "snailMeat" ? pondGrowthFactor(ledger.pondGrowth ?? 0) : 1;
    total += Math.round(
      productPrice(stack, season) * stack.qty * (1 + petEffect(ledger, "sell")) * (1 + bonus) * pond,
    );
  }
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
  const animals = BUILDING_IDS.flatMap((building) => ledger.animals[building] ?? []).filter(
    (animal): animal is AnimalState => animal !== null,
  );
  const elapsed = now - ledger.farmSettledAt;
  if (elapsed < FARM_CYCLE_MS) return ledger;

  const cycles = Math.min(100, Math.floor(elapsed / FARM_CYCLE_MS));
  if (cycles <= 0) return ledger;
  const pondSteps = ledger.buildings.pond > 0 ? Math.floor(cycles / POND_GROWTH_CYCLES) : 0;
  // An idle farm with no pond has nothing to settle.
  if (animals.length === 0 && pondSteps <= 0) return ledger;
  const next = clone(ledger);
  const startedAt = ledger.farmSettledAt;
  next.farmSettledAt = startedAt + cycles * FARM_CYCLE_MS;

  // The pond grows one step per ten settled cycles, capped at one hundred.
  if (pondSteps > 0) {
    next.pondGrowth = Math.min(POND_GROWTH_MAX, (next.pondGrowth ?? 0) + pondSteps * POND_GROWTH_STEP);
  }

  let upkeep = 0;
  for (const animal of animals) upkeep += (animalById(animal.kind)?.upkeep ?? 0) * cycles;
  upkeep = Math.round(upkeep * ranchingUpkeepFactor(ledger.skills.ranching.level));
  const paid = Math.min(next.coins, upkeep);
  next.coins -= paid;
  next.stats.spent += paid;
  if (paid < upkeep) return next;

  const collections: Array<{ building: BuildingId; slot: number; animal: AnimalState }> = [];
  for (const building of BUILDING_IDS) {
    (next.animals[building] ?? []).forEach((animal, slot) => {
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
    collect(next, `product:${definition.product}`);
    if (star >= 5) collect(next, "star:5");
    next.animals[entry.building][entry.slot] = {
      ...entry.animal,
      lastProduceAt: entry.animal.lastProduceAt + produced * interval,
    };
  }

  // Barn: while a slot is free, every cycle rolls a small chance of one more
  // head; the newborn already matches a species living in the barn.
  if (next.buildings.barn > 0) {
    const herd = next.animals.barn.filter((animal) => animal !== null);
    if (herd.length > 0) {
      const kinds = [...new Set(herd.map((animal) => animal.kind))];
      const cycleStart = Math.floor(startedAt / FARM_CYCLE_MS);
      for (let step = 0; step < cycles; step += 1) {
        const free = next.animals.barn.findIndex((animal) => animal === null);
        if (free < 0) break;
        const rng = createRng(hash32(`birth:${ledger.playerId}:${cycleStart + step}:${free}`));
        if (rng() >= BARN_BIRTH_CHANCE) continue;
        const bornAt = startedAt + (step + 1) * FARM_CYCLE_MS;
        const kind = kinds[Math.floor(rng() * kinds.length)] ?? "cow";
        next.animals.barn[free] = { kind, bornAt, pats: 0, lastProduceAt: bornAt };
      }
    }
  }

  // Coop: a kept egg hatches into a free slot; with the coop full it keeps
  // waiting and hatches as soon as a slot opens.
  for (const building of BUILDING_IDS) {
    const list = next.animals[building] ?? [];
    for (let slot = 0; slot < list.length; slot += 1) {
      const animal = list[slot] ?? null;
      if (animal === null) continue;
      const until = animal.incubatingUntil ?? 0;
      if (until === 0 || now < until) continue;
      const free = list.findIndex((entry) => entry === null);
      if (free < 0) continue;
      list[free] = { kind: animal.kind, bornAt: now, pats: 0, lastProduceAt: now };
      list[slot] = { ...animal, incubatingUntil: 0 };
      grantXp(next, "ranching", 40);
    }
  }

  return next;
}

/** @brief Equipped-pet effect shortcut. */
function petEffect(
  ledger: GardenLedger,
  key: "pestShield" | "mutation" | "grow" | "sell" | "extraHarvest",
): number {
  return equippedPetEffect(
    { pets: ledger.pets, equippedPet: ledger.equippedPet, lastHatch: ledger.lastHatch },
    key,
  );
}

/** @brief Adds skill experience in place. */
function grantXp(ledger: GardenLedger, skill: SkillId, amount: number): void {
  ledger.skills[skill] = addSkillXp(ledger.skills[skill], amount);
}

/** @brief Adds a collection key once. */
function collect(ledger: GardenLedger, key: string): void {
  if (!ledger.collection.includes(key)) ledger.collection.push(key);
}

/** @brief Delivers one NPC contract from the rotated board. */
function fulfillContract(ledger: GardenLedger, id: string, season: SeasonSnapshot, now: number): RuleResult {
  const offer = contractOffers(ledger.playerId, now).find((entry) => entry.id === id);
  if (offer === undefined) return { ok: false, code: "NO_CONTRACT" };
  if (ledger.contractClaims.includes(offer.id)) return { ok: false, code: "ALREADY_CLAIMED" };

  let available = 0;
  for (const stack of ledger.bag.products) {
    if (stack.product === offer.product && stack.star >= offer.star) available += stack.qty;
  }
  if (available < offer.qty) return { ok: false, code: "NO_PRODUCT" };

  const next = clone(ledger);
  let left = offer.qty;
  next.bag.products = next.bag.products
    .map((stack) => {
      if (left <= 0 || stack.product !== offer.product || stack.star < offer.star) return stack;
      const take = Math.min(left, stack.qty);
      left -= take;
      collect(next, `product:${stack.product}`);
      return { ...stack, qty: stack.qty - take };
    })
    .filter((stack) => stack.qty > 0);
  next.coins += offer.reward;
  next.stats.earned += offer.reward;
  next.weekEarned += offer.reward;
  next.contractClaims.push(offer.id);
  return changed(next, now);
}

/** @brief Buys one traveling-merchant offer. */
function buyMerchant(ledger: GardenLedger, id: string, now: number): RuleResult {
  const offer = merchantOffers(ledger.playerId, now).find((entry) => entry.id === id);
  if (offer === undefined) return { ok: false, code: "MERCHANT_GONE" };
  if (ledger.merchantClaims.includes(offer.id)) return { ok: false, code: "ALREADY_CLAIMED" };
  if (ledger.coins < offer.price) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= offer.price;
  next.stats.spent += offer.price;
  if (offer.kind === "seed") {
    next.bag.seeds[offer.item as SeedId] = (next.bag.seeds[offer.item as SeedId] ?? 0) + offer.stock;
    collect(next, `seed:${offer.item}`);
  } else {
    next.bag.tools[offer.item as ToolId] = (next.bag.tools[offer.item as ToolId] ?? 0) + offer.stock;
    collect(next, `tool:${offer.item}`);
  }
  next.merchantClaims.push(offer.id);
  return changed(next, now);
}

/** @brief Buys one day of crop insurance. */
function buyInsurance(ledger: GardenLedger, now: number): RuleResult {
  if (now < ledger.insuranceUntil) return { ok: false, code: "ALREADY_CLAIMED" };
  if (ledger.coins < INSURANCE_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= INSURANCE_PRICE;
  next.stats.spent += INSURANCE_PRICE;
  next.insuranceUntil = now + INSURANCE_DURATION_MS;
  return changed(next, now);
}

/** @brief Locks the current market price for qty units of one item. */
function lockFuture(
  ledger: GardenLedger,
  item: ItemId,
  qty: number,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const price = basePriceOf(item, season);
  if (price <= 0) return { ok: false, code: "BAD_REQUEST" };
  const fee = Math.max(1, Math.round(price * qty * FUTURE_FEE_RATE));
  if (ledger.coins < fee) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= fee;
  next.stats.spent += fee;
  next.futures = next.futures.filter((future) => future.expiresAt > now);
  next.futures.push({ item, price, qty, expiresAt: now + FUTURE_LOCK_MS });
  return changed(next, now);
}

/** @brief Splices two crops into genetics progress. */
function spliceCrops(ledger: GardenLedger, item: ItemId, now: number): RuleResult {
  const total = ledger.bag.crops
    .filter((stack) => stack.item === item)
    .reduce((sum, stack) => sum + stack.qty, 0);
  if (total < 2) return { ok: false, code: "NO_CROP" };
  if (ledger.spliceBonus >= SPLICE_MAX_BONUS) return { ok: false, code: "MAX_LEVEL" };

  const next = clone(ledger);
  let left = 2;
  next.bag.crops = next.bag.crops
    .map((stack) => {
      if (left <= 0 || stack.item !== item) return stack;
      const take = Math.min(left, stack.qty);
      left -= take;
      return { ...stack, qty: stack.qty - take };
    })
    .filter((stack) => stack.qty > 0);
  next.spliceBonus += 1;
  return changed(next, now);
}

/** @brief Composts infested crops into fertilizer. */
function compostCrops(ledger: GardenLedger, now: number): RuleResult {
  const bad = ledger.bag.crops.filter((stack) => stack.pest === true);
  const total = bad.reduce((sum, stack) => sum + stack.qty, 0);
  if (total < COMPOST_RATIO) return { ok: false, code: "NOTHING_TO_DO" };
  const fertilizer = Math.floor(total / COMPOST_RATIO);
  const next = clone(ledger);
  next.bag.crops = next.bag.crops.filter((stack) => stack.pest !== true);
  next.bag.supplies.compost = (next.bag.supplies.compost ?? 0) + fertilizer;
  return changed(next, now);
}

/** @brief Builds or upgrades the greenhouse. */
function buyGreenhouse(ledger: GardenLedger, now: number): RuleResult {
  const level = ledger.greenhouse;
  if (level >= GREENHOUSE_PRICES.length) return { ok: false, code: "MAX_LEVEL" };
  const cost = GREENHOUSE_PRICES[level] ?? 0;
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= cost;
  next.stats.spent += cost;
  next.greenhouse = level + 1;
  return changed(next, now);
}

/** @brief Hatches one gacha egg; pets are never sold directly. */
function hatchEgg(ledger: GardenLedger, now: number): RuleResult {
  if (ledger.coins < EGG_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= EGG_PRICE;
  next.stats.spent += EGG_PRICE;
  const rng = createRng(hash32(`egg:${ledger.playerId}:${ledger.eggCount}`));
  const rolled = rollPet(rng, ledger.eggPity);
  next.pets[rolled.pet.id] = Math.min(PET_MAX_LEVEL * 3, (next.pets[rolled.pet.id] ?? 0) + 1);
  if (next.equippedPet === null) next.equippedPet = rolled.pet.id;
  next.lastHatch = rolled.pet.id;
  next.eggCount += 1;
  next.eggPity = rolled.pity;
  collect(next, `pet:${rolled.pet.id}`);
  return changed(next, now);
}

/** @brief Equips one owned pet. */
function equipPet(ledger: GardenLedger, pet: PetId, now: number): RuleResult {
  const owned = ledger.pets[pet] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_PET" };
  const next = clone(ledger);
  next.equippedPet = pet;
  return changed(next, now);
}

/** @brief Spins the lucky wheel; one rare seed every twenty spins guaranteed. */
function spinWheel(ledger: GardenLedger, now: number): RuleResult {
  if (ledger.coins < WHEEL_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= WHEEL_PRICE;
  const spin = next.wheelSpins;
  const rng = createRng(hash32(`wheel:${ledger.playerId}:${spin}`));
  const pity = next.wheelPity + 1 >= WHEEL_PITY;
  const roll = rng();
  let prizeKey = "coins:5000";
  if (pity || roll < 0.1) {
    const rare = SEEDS.filter((seed) => seed.rare === true);
    const seed = rare[Math.floor(rng() * Math.max(1, rare.length))];
    if (seed !== undefined) {
      next.bag.seeds[seed.id] = (next.bag.seeds[seed.id] ?? 0) + 1;
      collect(next, `seed:${seed.id}`);
      prizeKey = `seed:${seed.id}`;
    }
    next.wheelPity = 0;
  } else if (roll < 0.3) {
    const seed = SEEDS[Math.floor(rng() * SEEDS.length)];
    if (seed !== undefined) next.bag.seeds[seed.id] = (next.bag.seeds[seed.id] ?? 0) + 3;
    prizeKey = `seeds3:${seed?.id ?? "carrot"}`;
    next.wheelPity += 1;
  } else if (roll < 0.5) {
    const supply = [...FERTILIZERS, ...SPRAYS][Math.floor(rng() * (FERTILIZERS.length + SPRAYS.length))];
    if (supply !== undefined) next.bag.supplies[supply.id] = (next.bag.supplies[supply.id] ?? 0) + 5;
    prizeKey = `supply:${supply?.id ?? "compost"}`;
    next.wheelPity += 1;
  } else if (roll < 0.75) {
    next.coins += 20_000;
    prizeKey = "coins:20000";
    next.wheelPity += 1;
  } else {
    next.coins += 5_000;
    prizeKey = "coins:5000";
    next.wheelPity += 1;
  }
  next.wheelSpins = spin + 1;
  next.wheelLast = prizeKey;
  return changed(next, now);
}

/** @brief Hires one labour-market candidate. */
function hireStaff(ledger: GardenLedger, id: string, now: number): RuleResult {
  const candidate = staffMarketAt(ledger.playerId, now).find((entry) => entry.id === id);
  if (candidate === undefined) return { ok: false, code: "NO_CANDIDATE" };
  if (ledger.staffClaims.includes(candidate.id)) return { ok: false, code: "NO_CANDIDATE" };
  if (ledger.staff.length >= STAFF_SLOTS) return { ok: false, code: "STAFF_FULL" };
  const cost = staffHireCost(candidate);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= cost;
  next.stats.spent += cost;
  next.staff.push({
    id: candidate.id,
    name: candidate.name,
    speed: candidate.speed,
    skill: candidate.skill,
    wage: candidate.wage,
    traits: [...candidate.traits],
    jobs: candidate.jobs,
    role: "gardener",
    level: 1,
    xp: 0,
    lastWorkAt: now,
    lastPaidAt: now,
    unpaid: 0,
  });
  next.staffClaims.push(candidate.id);
  return changed(next, now);
}

/** @brief Fires a worker. */
function fireStaff(ledger: GardenLedger, index: number, now: number): RuleResult {
  if (ledger.staff[index] === undefined) return { ok: false, code: "BAD_REQUEST" };
  const next = clone(ledger);
  next.staff.splice(index, 1);
  return changed(next, now);
}

/** @brief Changes a worker's role. */
function setStaffRole(ledger: GardenLedger, index: number, role: StaffRole, now: number): RuleResult {
  if (ledger.staff[index] === undefined) return { ok: false, code: "BAD_REQUEST" };
  const next = clone(ledger);
  next.staff[index] = { ...next.staff[index]!, role };
  return changed(next, now);
}

/** @brief Harvests one ripe crop or fruit for a worker. */
function staffHarvest(ledger: GardenLedger, now: number, rng: () => number): GardenLedger | null {
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    const plot = ledger.plots[slot] ?? null;
    if (plot === null || plot.favorite === true || now < plot.readyAt) continue;
    const result = applyGardenAction(
      ledger,
      { kind: "harvest", slot, tree: false, auto: true },
      seasonAt(now),
      now,
      rng,
    );
    if (result.ok) return result.ledger;
  }
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const tree = ledger.trees[slot] ?? null;
    if (tree === null || tree.favorite === true || now < tree.readyAt) continue;
    const result = applyGardenAction(
      ledger,
      { kind: "harvest", slot, tree: true, auto: true },
      seasonAt(now),
      now,
      rng,
    );
    if (result.ok) return result.ledger;
  }
  return null;
}

/** @brief Pats the least-petted animal for a worker. */
function staffPatAnimal(ledger: GardenLedger, now: number): GardenLedger | null {
  let best: { building: BuildingId; slot: number; pats: number } | null = null;
  for (const building of BUILDING_IDS) {
    const animals = ledger.animals[building] ?? [];
    for (let slot = 0; slot < animals.length; slot += 1) {
      const animal = animals[slot];
      if (animal === null || animal === undefined) continue;
      if (best === null || animal.pats < best.pats) best = { building, slot, pats: animal.pats };
    }
  }
  if (best === null) return null;
  const result = patAnimal(ledger, best.building, best.slot, now);
  return result.ok ? result.ledger : null;
}

/** @brief Loads one idle warehouse machine for a worker. */
function staffMachine(ledger: GardenLedger, now: number): GardenLedger | null {
  for (const [rawId, machine] of Object.entries(ledger.machines)) {
    if (machine === undefined) continue;
    const id = rawId as MachineId;
    const definition = machineById(id);
    if (definition === undefined) continue;
    if (machine.job !== undefined && now < machine.job.readyAt) continue;
    if (definition.queued !== true && now - machine.lastCraftAt < definition.cooldownCycles * FARM_CYCLE_MS) {
      continue;
    }

    let item: ItemId | undefined;
    if (definition.input.kind === "product") {
      const inputProduct = definition.input.product;
      if (!ledger.bag.products.some((stack) => stack.product === inputProduct && stack.qty > 0)) continue;
    } else {
      const allowed = definition.input.seeds;
      const stack = ledger.bag.crops.find((entry) => {
        const seed = seedById(entry.item);
        const fruit = treeById(entry.item);
        if (seed === undefined && (definition.allProduce !== true || fruit === undefined)) return false;
        if (allowed !== undefined && (seed === undefined || !allowed.includes(seed.id))) return false;
        return entry.qty > 0;
      });
      if (stack === undefined) continue;
      item = stack.item;
    }

    const result = craftMachine(ledger, id, item, now);
    if (result.ok) return result.ledger;
  }
  return null;
}

/** @brief Plants an owned seed in the first free crop cell for a worker. */
function staffPlant(ledger: GardenLedger, now: number, rng: () => number): GardenLedger | null {
  const seed = SEEDS.find((entry) => (ledger.bag.seeds[entry.id] ?? 0) > 0);
  if (seed === undefined) return null;
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    if ((ledger.plots[slot] ?? null) !== null) continue;
    const tab = Math.floor(slot / CROPS_PER_TAB);
    const local = slot % CROPS_PER_TAB;
    const patch = Math.floor(local / PLOTS_PER_PATCH);
    if ((ledger.unlockedPatches[tab] ?? 0) <= patch) continue;
    const result = applyGardenAction(ledger, { kind: "plant", slot, seed: seed.id }, seasonAt(now), now, rng);
    return result.ok ? result.ledger : null;
  }
  return null;
}

/** @brief Waters one growing, unwatered plant for a worker. */
function staffWater(ledger: GardenLedger, now: number, rng: () => number): GardenLedger | null {
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    const plot = ledger.plots[slot] ?? null;
    if (plot === null || plot.watered || now >= plot.readyAt) continue;
    const result = applyGardenAction(ledger, { kind: "water", slot, tree: false }, seasonAt(now), now, rng);
    if (result.ok) return result.ledger;
  }
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const tree = ledger.trees[slot] ?? null;
    if (tree === null || tree.watered || now >= tree.readyAt) continue;
    const result = applyGardenAction(ledger, { kind: "water", slot, tree: true }, seasonAt(now), now, rng);
    if (result.ok) return result.ledger;
  }
  return null;
}

/**
 * @brief Settles staff wages and slow automated work.
 * @details Workers act at most once per settlement, so they never outpace the
 * player; negative traits can skip, slow, break or skim the job.
 */
export function settleStaff(ledger: GardenLedger, now: number): GardenLedger {
  let current = ledger;
  for (let index = 0; index < current.staff.length; index += 1) {
    let worker = current.staff[index];
    if (worker === undefined) continue;

    // Wages for elapsed cycles, capped so an offline garden stays bounded.
    const cycles = Math.min(20, Math.floor((now - worker.lastPaidAt) / FARM_CYCLE_MS));
    if (cycles > 0) {
      const total = worker.wage * cycles;
      if (current.coins >= total) {
        const paid = clone(current);
        paid.coins -= total;
        paid.stats.spent += total;
        paid.staff[index] = {
          ...worker,
          lastPaidAt: worker.lastPaidAt + cycles * FARM_CYCLE_MS,
          unpaid: 0,
        };
        current = paid;
      } else {
        const broke = clone(current);
        broke.coins = 0;
        const unpaid = worker.unpaid + 1;
        broke.staff[index] = { ...worker, lastPaidAt: now, unpaid };
        if (unpaid >= STAFF_QUIT_UNPAID) broke.staff.splice(index, 1);
        current = broke;
        if (unpaid >= STAFF_QUIT_UNPAID) index -= 1;
        continue;
      }
      worker = current.staff[index];
      if (worker === undefined) continue;
    }

    if (now - worker.lastWorkAt < staffWorkInterval(worker) * FARM_CYCLE_MS) continue;

    // One pass over every kind of chore: water, plant, pat animals, feed a
    // machine. Better-paid hands repeat each chore up to `jobs` times.
    let worked: GardenLedger = current;
    let tasks = 0;
    let seedCounter = 0;
    const jobs = Math.max(1, Math.min(3, worker.jobs));
    const attempt = (chore: (base: GardenLedger, rng: () => number) => GardenLedger | null): void => {
      for (let repeat = 0; repeat < jobs; repeat += 1) {
        const rng = createRng(hash32(`staffwork:${worker.id}:${worker.lastWorkAt}:${now}:${seedCounter}`));
        seedCounter += 1;
        if (worker.traits.includes("lazy") && rng() < 0.2) continue;
        const next = chore(worked, rng);
        if (next === null) break;
        worked = next;
        tasks += 1;
      }
    };
    attempt((base, rng) => staffHarvest(base, now, rng));
    attempt((base, rng) => staffWater(base, now, rng));
    attempt((base, rng) => staffPlant(base, now, rng));
    attempt((base) => staffPatAnimal(base, now));
    attempt((base) => staffMachine(base, now));

    const after = clone(worked);
    const currentWorker = after.staff[index];
    if (currentWorker === undefined) continue;
    const grown = staffGainXp(currentWorker.level, currentWorker.xp + tasks * STAFF_XP_PER_TASK);
    after.staff[index] = { ...currentWorker, lastWorkAt: now, level: grown.level, xp: grown.xp };
    if (tasks > 0 && worker.traits.includes("greedy")) {
      const greed = createRng(hash32(`staffgreed:${worker.id}:${worker.lastWorkAt}:${now}`));
      if (greed() < 0.05) after.coins = Math.max(0, after.coins - 200);
    }
    current = after;
  }
  return current;
}

/**
 * @brief Settles daily streak, achievements and the weekly tournament bucket.
 * @param ledger Garden before settlement.
 * @param now Server clock.
 */
export function settleExtras(ledger: GardenLedger, now: number): GardenLedger {
  let changedAny = false;
  const next = clone(ledger);

  // Weekly bucket tracks only progress made this week.
  const week = weekKeyAt(now);
  if (next.weekKey !== week) {
    next.weekKey = week;
    next.weekEarned = 0;
    next.weekHarvested = 0;
    next.lastEarned = next.stats.earned;
    next.lastHarvested = next.stats.harvested;
    changedAny = true;
  }
  if (next.stats.earned > next.lastEarned) {
    next.weekEarned += next.stats.earned - next.lastEarned;
    next.lastEarned = next.stats.earned;
    changedAny = true;
  }
  if (next.stats.harvested > next.lastHarvested) {
    next.weekHarvested += next.stats.harvested - next.lastHarvested;
    next.lastHarvested = next.stats.harvested;
    changedAny = true;
  }

  // Daily streak: one reward per day, resets gently after a gap.
  const day = dayIndexAt(now);
  if (next.lastStreakDay < day) {
    next.streak = next.lastStreakDay === day - 1 ? next.streak + 1 : 1;
    next.lastStreakDay = day;
    next.coins += Math.min(7, next.streak) * 500;
    changedAny = true;
  }

  // Achievements evaluated from lifetime stats and the collection.
  for (const achievement of ACHIEVEMENTS) {
    if (next.achievements.includes(achievement.id)) continue;
    const earned =
      achievement.id === "firstMillion"
        ? next.stats.earned >= 1_000_000
        : achievement.id === "hundredHarvests"
          ? next.stats.harvested >= 100
          : achievement.id === "fiveStars"
            ? next.collection.includes("star:5")
            : achievement.id === "allTabs"
              ? next.tabs >= MAX_TABS
              : next.collection.length >= 30;
    if (!earned) continue;
    next.achievements.push(achievement.id);
    next.coins += achievement.coins;
    if (achievement.seed !== undefined) {
      next.bag.seeds[achievement.seed] = (next.bag.seeds[achievement.seed] ?? 0) + (achievement.seedQty ?? 1);
    }
    changedAny = true;
  }

  return changedAny ? next : ledger;
}

/** @brief Sprays pesticide on one plant: cures pests and protects one day. */
function sprayPest(ledger: GardenLedger, slot: number, tree: boolean, now: number): RuleResult {
  const plant = tree ? (ledger.trees[slot] ?? null) : (ledger.plots[slot] ?? null);
  if (plant === null) return { ok: false, code: "PLOT_EMPTY" };
  // A still-protected plant never needs another charge.
  if (plant.protectedUntil > now) return { ok: false, code: "ALREADY_PROTECTED" };
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
  // Only plants whose protection lapsed are charged again.
  const crops: number[] = [];
  for (let tab = 0; tab < ledger.tabs; tab += 1) {
    const open = ledger.unlockedPatches[tab] ?? 1;
    for (let patch = 0; patch < open; patch += 1) {
      for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
        const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
        const entry = ledger.plots[slot] ?? null;
        if (entry !== null && entry.protectedUntil <= now) crops.push(slot);
      }
    }
  }
  const trees: number[] = [];
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const entry = ledger.trees[slot] ?? null;
    if (entry !== null && entry.protectedUntil <= now) trees.push(slot);
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
          const shield =
            (1 - 0.12 * ledger.greenhouse) * (1 - (ledger.pet * 0.15 + petEffect(ledger, "pestShield")));
          if (rng() >= PEST_CHANCE_PER_CYCLE * shield) continue;
          if (now < ledger.insuranceUntil) next.coins += INSURANCE_PAYOUT;
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

/** @brief Restores every crop cell to full fertility in one go. */
function renovateSoil(ledger: GardenLedger, now: number): RuleResult {
  let cost = 0;
  for (const fertility of ledger.soil) cost += soilRenovateCost(fertility);
  if (cost <= 0) return { ok: false, code: "NOTHING_TO_RENOVATE" };
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= cost;
  next.stats.spent += cost;
  next.soil = next.soil.map(() => SOIL_START);
  return changed(next, now);
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
/** @brief Input item a machine accepts, with its base sale price. */
function machineInput(
  definition: MachineDefinition,
  item: ItemId | undefined,
): { key: ItemId; sell: number } | null {
  const seed = item === undefined ? undefined : seedById(item);
  const fruit = item === undefined ? undefined : treeById(item);
  if (definition.output.kind === "seeds" && seed === undefined) return null;
  if (definition.allProduce === true) {
    if (seed === undefined && fruit === undefined) return null;
  } else if (seed === undefined) {
    return null;
  }
  const allowed = definition.input.kind === "seedCrop" ? definition.input.seeds : undefined;
  if (allowed !== undefined && (seed === undefined || !allowed.includes(seed.id))) return null;
  const key = seed?.id ?? fruit?.id;
  return key === undefined ? null : { key, sell: seed?.sell ?? fruit?.sell ?? 0 };
}

/**
 * @brief Collects one finished timed job.
 * @return The next ledger, or `null` when the job is missing or still brewing.
 */
function finishMachineJob(ledger: GardenLedger, id: MachineId, now: number): GardenLedger | null {
  const definition = machineById(id);
  const machine = ledger.machines[id];
  const job = machine?.job;
  if (definition === undefined || machine === undefined || job === undefined || now < job.readyAt) {
    return null;
  }
  if (definition.output.kind !== "product") return null;

  const next = clone(ledger);
  const seed = seedById(job.item);
  const fruit = treeById(job.item);
  const sell = seed?.sell ?? fruit?.sell ?? 0;
  const star = definition.gradeByPrice === true ? driedStarForSell(sell) : 1;
  const bonus = artisaningOutputBonus(next.skills.artisaning.level);
  addProduct(
    next.bag.products,
    definition.output.product,
    star,
    Math.max(1, Math.round(converterOutput(machine.level) * (1 + bonus))),
  );
  next.machines[id] = { level: machine.level, lastCraftAt: job.readyAt };
  return next;
}

/** @brief Completes every timed machine job whose clock ran out. */
export function settleMachines(ledger: GardenLedger, now: number): GardenLedger {
  let current = ledger;
  for (const [rawId, machine] of Object.entries(current.machines)) {
    if (machine?.job === undefined) continue;
    const settled = finishMachineJob(current, rawId as MachineId, now);
    if (settled !== null) current = settled;
  }
  return current;
}

/** @brief Collects one finished job by hand, without waiting for settlement. */
function collectMachine(ledger: GardenLedger, id: MachineId, now: number): RuleResult {
  const machine = ledger.machines[id];
  if (machine === undefined) return { ok: false, code: "MACHINE_LOCKED" };
  if (machine.job === undefined) return { ok: false, code: "NOTHING_TO_DO" };
  const settled = finishMachineJob(ledger, id, now);
  if (settled === null) return { ok: false, code: "NOT_READY" };
  grantXp(settled, "artisaning", 120);
  return changed(settled, now);
}

function craftMachine(
  ledger: GardenLedger,
  id: MachineId,
  item: ItemId | undefined,
  now: number,
): RuleResult {
  const definition = machineById(id);
  const machine = ledger.machines[id];
  if (definition === undefined || machine === undefined) return { ok: false, code: "MACHINE_LOCKED" };
  // Timed machines gate on their job; instant ones on the craft clock.
  if (definition.queued !== true && now - machine.lastCraftAt < definition.cooldownCycles * FARM_CYCLE_MS) {
    return { ok: false, code: "MACHINE_COOLDOWN" };
  }

  // Timed machines hold the input in their job until the brew is done.
  if (definition.queued === true) {
    let base = ledger;
    if (machine.job !== undefined) {
      if (now < machine.job.readyAt) return { ok: false, code: "MACHINE_COOLDOWN" };
      const settled = finishMachineJob(base, id, now);
      if (settled === null) return { ok: false, code: "MACHINE_COOLDOWN" };
      base = settled;
    }
    const input = machineInput(definition, item);
    if (input === null) return { ok: false, code: "NO_INPUT" };
    const next = clone(base);
    const stack = next.bag.crops.find((entry) => entry.item === input.key);
    if (stack === undefined || stack.qty < 1) return { ok: false, code: "NO_INPUT" };
    next.bag.crops = next.bag.crops
      .map((entry) => (entry === stack ? { ...entry, qty: entry.qty - 1 } : entry))
      .filter((entry) => entry.qty > 0);
    next.machines[id] = {
      ...machine,
      lastCraftAt: now,
      job: { item: input.key, startedAt: now, readyAt: now + definition.cooldownCycles * FARM_CYCLE_MS },
    };
    grantXp(next, "artisaning", 100);
    return changed(next, now);
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
      const bonus = artisaningOutputBonus(next.skills.artisaning.level);
      addProduct(
        next.bag.products,
        definition.output.product,
        star,
        Math.max(1, Math.round(converterOutput(machine.level) * (1 + bonus))),
      );
    }
  } else {
    const input = machineInput(definition, item);
    if (input === null) return { ok: false, code: "NO_INPUT" };
    const stack = next.bag.crops.find((entry) => entry.item === input.key);
    if (stack === undefined || stack.qty < 1) return { ok: false, code: "NO_INPUT" };
    next.bag.crops = next.bag.crops
      .map((entry) => (entry === stack ? { ...entry, qty: entry.qty - 1 } : entry))
      .filter((entry) => entry.qty > 0);
    const bonus = artisaningOutputBonus(next.skills.artisaning.level);
    if (definition.output.kind === "seeds") {
      const seed = seedById(input.key);
      if (seed === undefined) return { ok: false, code: "NO_INPUT" };
      next.bag.seeds[seed.id] =
        (next.bag.seeds[seed.id] ?? 0) +
        Math.max(1, Math.round(seedMakerOutput(machine.level) * (1 + bonus)));
    } else {
      const star = definition.gradeByPrice === true ? driedStarForSell(input.sell) : 1;
      addProduct(
        next.bag.products,
        definition.output.product,
        star,
        Math.max(1, Math.round(converterOutput(machine.level) * (1 + bonus))),
      );
    }
  }
  next.machines[id] = { ...machine, lastCraftAt: now };
  grantXp(next, "artisaning", 200);
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
  for (let index = 0; index < CROPS_PER_TAB; index += 1) {
    next.plots.push(null);
    next.soil.push(SOIL_START);
    next.lastCrop.push(null);
  }
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
  // A locked future guarantees its price for the covered units.
  const marketPrice = Math.round(
    cropSellPrice(stack, season) *
      (1 + petEffect(ledger, "sell")) *
      (1 + farmingSellBonus(ledger.skills.farming.level)),
  );
  const future = ledger.futures.find(
    (entry) => entry.item === item && entry.expiresAt > now && entry.qty > 0,
  );
  const unit = future !== undefined ? Math.max(marketPrice, future.price) : marketPrice;
  const gross = unit * qty;
  const tax = Math.round(gross * SELL_TAX_RATE);
  next.coins += gross - tax;
  next.stats.earned += gross;
  next.stats.tax += tax;
  if (future !== undefined) {
    const left = future.qty - qty;
    next.futures = next.futures
      .map((entry) => (entry === future ? { ...entry, qty: left } : entry))
      .filter((entry) => entry.qty > 0);
  }
  removeCrop(next.bag.crops, item, effects, pest, qty);
  return changed(next, now);
}

/** @brief Sells every harvested stack. */
function sellAll(ledger: GardenLedger, season: SeasonSnapshot, now: number): RuleResult {
  if (ledger.bag.crops.length === 0) return { ok: false, code: "NOTHING_TO_SELL" };
  const next = clone(ledger);
  let total = 0;
  for (const stack of next.bag.crops) {
    const base = Math.round(
      cropSellPrice(stack, season) *
        (1 + petEffect(ledger, "sell")) *
        (1 + farmingSellBonus(ledger.skills.farming.level)),
    );
    const future = next.futures.find(
      (entry) => entry.item === stack.item && entry.expiresAt > now && entry.qty > 0,
    );
    const unit = future !== undefined ? Math.max(base, future.price) : base;
    total += unit * stack.qty;
    if (future !== undefined) {
      const left = future.qty - stack.qty;
      next.futures = next.futures
        .map((entry) => (entry === future ? { ...entry, qty: left } : entry))
        .filter((entry) => entry.qty > 0);
    }
  }
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
      pond: (ledger.animals.pond ?? []).map((animal) => (animal === null ? null : { ...animal })),
    },
    farmSettledAt: ledger.farmSettledAt,
    pondGrowth: ledger.pondGrowth ?? 0,
    soil: [...ledger.soil],
    specialPatches: ledger.specialPatches ?? 0,
    specialUnlocked: [...(ledger.specialUnlocked ?? [])],
    specialPlots: (ledger.specialPlots ?? []).map((plot) => (plot === null ? null : { ...plot })),
    skills: {
      farming: { ...ledger.skills.farming },
      ranching: { ...ledger.skills.ranching },
      artisaning: { ...ledger.skills.artisaning },
    },
    lastCrop: [...ledger.lastCrop],
    achievements: [...ledger.achievements],
    collection: [...ledger.collection],
    futures: ledger.futures.map((future) => ({ ...future })),
    contractClaims: [...ledger.contractClaims],
    merchantClaims: [...ledger.merchantClaims],
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
