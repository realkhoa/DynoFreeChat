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
  SPECIAL_GROW_SCALE,
  SPECIAL_MUTATION,
  SPECIAL_QUALITY_STARS,
  SPECIAL_RESET_VERSION,
  specialPlotCost,
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
  wheelCost,
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
  dayPhaseAt,
  wheelDayAt,
  weekKeyAt,
  seasonAt,
  SOIL_STEP,
  soilGrowthFactor,
  soilRenovateCost,
  PEST_CHANCE_PER_CYCLE,
  DISEASE_CHANCE_PER_CYCLE,
  DISEASE_SPREAD_CHANCE,
  DISEASE_DEATH_CYCLES,
  FIRE_CHANCE_PER_CYCLE,
  CROW_CHANCE_PER_CYCLE,
  PLOT_REPAIR_COST,
  TREE_DISEASE_DEATH_CYCLES,
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
  machineCycles,
  driedStarForSell,
  machineById,
  seedMakerOutput,
  seedMakerChance,
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
  effectById,
  dailyQuestsFor,
  prestigeSellBonus,
  prestigeMutationBonus,
  wealthBadLuck,
  prestigeTierForSeed,
  PRESTIGE_SHOP,
  PRESTIGE_COIN_VALUE,
  FINAL_SHOP,
  FINAL_SHOP_PRESTIGE,
  prestigeGrowScale,
  prestigeRequirement,
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
  attachmentById,
  type AttachmentId,
  type SaleRecord,
  type AttachmentSlot,
  type FutureLock,
  type PetId,
  type MachineDefinition,
  type MachineId,
  type MachineJob,
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
  /** Recent sale log, newest last. */
  sales: SaleRecord[];
  /** Prestige level already pushed to the leaderboard hub. */
  publishedPrestige: number;
  /** Building levels (0 = not built). */
  buildings: Record<BuildingId, number>;
  /** Animals per building slot. */
  animals: Record<BuildingId, (AnimalState | null)[]>;
  /** Last farm upkeep/production settlement. */
  farmSettledAt: number;
  /** Fish pond growth in percent. */
  pondGrowth: number;
  attachments: Partial<Record<AttachmentSlot, AttachmentId>>;
  attachmentSettledAt: number;
  /** Last automatic-tool settlement. */
  toolsSettledAt: number;
  /** Last pest strike roll. */
  pestSettledAt: number;
  diseaseSettledAt: number;
  /** Last fire/crow settlement. */
  hazardSettledAt: number;
  /** Burnt crop cells that must be repurchased. */
  damagedPlots: boolean[];
  /** Fertility percent per crop cell. */
  soil: number[];
  /** Sequentially bought premium plots. */
  specialOwned: number;
  /** Premium-garden reset migration version. */
  specialVersion: number;
  /** Owned special patches (legacy). */
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
  /** Day index the daily wheel counters belong to. */
  wheelDay: number;
  /** Permanent prestige level, each adding 5% sale value. */
  prestige: number;
  /** Prestige coins earned per 1000b lifetime earnings. */
  prestigeCoins: number;
  /** Earnings progress toward the next prestige coin. */
  prestigeProgress: number;
  /** Local day index of the daily quest board. */
  questDay: number;
  /** Progress per active quest id. */
  questProgress: Record<string, number>;
  /** Claimed quest ids for the current day. */
  questClaims: string[];
  /** Local day index the last asset tax was charged for. */
  taxDay: number;
  /** Coins taken by the last asset tax. */
  taxLast: number;
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
  /** Remaining shop stock by seed or tool id for the current restock. */
  shopStock: Partial<Record<string, number>>;
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
    sales: [],
    publishedPrestige: 0,
    buildings: { coop: 0, barn: 0, pond: 0 },
    animals: { coop: [], barn: [], pond: [] },
    farmSettledAt: input.now,
    pondGrowth: 0,
    attachments: {},
    attachmentSettledAt: input.now,
    toolsSettledAt: input.now,
    pestSettledAt: input.now,
    diseaseSettledAt: input.now,
    hazardSettledAt: input.now,
    damagedPlots: new Array<boolean>(totalCrops(STARTING_TABS)).fill(false),
    soil: new Array<number>(totalCrops(STARTING_TABS)).fill(SOIL_START),
    specialOwned: 0,
    specialVersion: SPECIAL_RESET_VERSION,
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
    wheelDay: wheelDayAt(input.now),
    prestige: 0,
    prestigeCoins: 0,
    prestigeProgress: 0,
    questDay: wheelDayAt(input.now),
    questProgress: {},
    questClaims: [],
    taxDay: wheelDayAt(input.now),
    taxLast: 0,
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
    prestige: ledger.prestige,
    prestigeCoins: ledger.prestigeCoins ?? 0,
    prestigeProgress: ledger.prestigeProgress ?? 0,
    quests: dailyQuestsFor(ledger.playerId, ledger.questDay).map((quest) => ({
      id: quest.id,
      kind: quest.kind,
      target: quest.target,
      progress: Math.min(quest.target, ledger.questProgress[quest.id] ?? 0),
      reward: quest.reward,
      claimed: ledger.questClaims.includes(quest.id),
    })),
    taxLast: ledger.taxLast,
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
    damagedPlots: [...(ledger.damagedPlots ?? [])],
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
    attachments: { ...(ledger.attachments ?? {}) },
    shopStock: { ...ledger.shopStock },
    soil: [...ledger.soil],
    specialOwned: ledger.specialOwned ?? 0,
    specialVersion: ledger.specialVersion ?? 0,
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
    sales: (ledger.sales ?? []).map((entry) => ({ ...entry })),
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
    case "plantAll":
      return plantAll(ledger, action.seed, now, rng);
    case "uprootBulk":
      return uprootBulk(ledger, action, season, now);
    case "claimQuest":
      return claimQuest(ledger, action.id, now);
    case "prestige":
      return prestige(ledger, season, now);
    case "buyPrestigeSeed":
      return buyPrestigeSeed(ledger, action.seed, now);
    case "buyFinalSeed":
      return buyFinalSeed(ledger, action.seed, now);
    case "repairPlot":
      return repairPlot(ledger, action.slot, now);
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
      return buySpecialPlot(ledger, now);
    case "buySpecialPlot":
      return buySpecialPlot(ledger, now);
    case "plantSpecial": {
      const result = withSpecial(ledger, plant, action.slot, action.seed, now, rng);
      if (!result.ok) return result;
      return { ok: true, ledger: specializePlot(result.ledger, action.slot, now, true), changed: true };
    }
    case "harvestSpecial": {
      const result = withSpecial(ledger, harvest, action.slot, now, rng, false, true);
      if (!result.ok) return result;
      let next = specializePlot(result.ledger, action.slot, now, true);
      next = clone(next);
      next.bag.crops = next.bag.crops.map((stack) =>
        stack.effects.includes(SPECIAL_MUTATION) ? { ...stack, star: SPECIAL_QUALITY_STARS } : stack,
      );
      return { ok: true, ledger: next, changed: true };
    }
    case "waterSpecial":
      return withSpecial(ledger, water, action.slot, now);
    case "fertilizeSpecial":
      return withSpecial(ledger, fertilize, action.slot, action.supply, now, false);
    case "spraySpecial":
      return withSpecial(ledger, spray, action.slot, action.supply, now, false, rng);
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
      return sellProduct(ledger, action.product, action.star, action.effects ?? [], action.qty, season, now);
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
    case "queueMachine":
      return queueMachine(ledger, action.machine, action.item, action.qty ?? 1, now);
    case "setMachineLimit":
      return setMachineLimit(ledger, action.machine, action.limit, now);
    case "clearMachineQueue":
      return clearMachineQueue(ledger, action.machine, now);
    case "attachMachine":
      return attachMachine(ledger, action.slot, action.id, now);
    case "detachMachine":
      return detachMachine(ledger, action.slot, now);
    case "collectMachine":
      return collectMachine(ledger, action.machine, now);
    case "harvestAll":
      return harvestAll(ledger, now, rng);
    case "buySeed":
      return buySeed(ledger, action.seed, action.qty, season, now);
    case "buySupply":
      return buySupply(ledger, action.supply, action.qty, season, now);
    case "sellCrop":
      return sellCrop(
        ledger,
        action.item,
        action.effects,
        action.star ?? 1,
        action.qty,
        action.pest === true,
        season,
        now,
      );
    case "sellAll":
      return sellAll(ledger, season, now);
    default:
      return { ok: false, code: "BAD_REQUEST" };
  }
}

/** @brief Whether one special plot is owned and unlocked. */
function specialSlotOpen(ledger: GardenLedger, slot: number): boolean {
  if (slot < 0 || slot >= SPECIAL_SLOTS) return false;
  return slot < Math.min(SPECIAL_SLOTS, ledger.specialOwned ?? 0);
}

/** @brief Legacy patch purchase now buys the next sequential premium plot. */
function buySpecialPatch(ledger: GardenLedger, _patch: number, now: number): RuleResult {
  return buySpecialPlot(ledger, now);
}

/** @brief Buys the next premium plot; each one doubles the previous price. */
function buySpecialPlot(ledger: GardenLedger, now: number): RuleResult {
  const owned = Math.min(SPECIAL_SLOTS, ledger.specialOwned ?? 0);
  if (owned >= SPECIAL_SLOTS) return { ok: false, code: "MAX_PATCHES" };
  const cost = specialPlotCost(owned);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= cost;
  next.stats.spent += cost;
  next.specialOwned = owned + 1;
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

/**
 * @brief One-time wipe of every premium garden.
 * @details Crops growing on premium soil are moved to the first free normal
 * plots and players must buy premium plots again from scratch.
 */
export function settleSpecialReset(ledger: GardenLedger, now: number): GardenLedger {
  if ((ledger.specialVersion ?? 0) >= SPECIAL_RESET_VERSION) return ledger;
  const next = clone(ledger);
  next.plots = [...next.plots];
  for (const plot of next.specialPlots ?? []) {
    if (plot === null) continue;
    const free = next.plots.findIndex((entry) => entry === null);
    if (free >= 0) {
      next.plots[free] = { ...plot, slot: free };
    } else {
      // Normal soil is full: keep the crop as a harvested premium stack so
      // the reset never destroys value.
      addCrop(
        next.bag.crops,
        plot.seed,
        canonicalEffects([...plot.effects, SPECIAL_MUTATION]),
        1,
        plot.pest,
        SPECIAL_QUALITY_STARS,
      );
    }
  }
  next.specialPlots = new Array<PlotState | null>(SPECIAL_SLOTS).fill(null);
  next.specialOwned = 0;
  next.specialPatches = 0;
  next.specialUnlocked = new Array<number>(SPECIAL_PATCHES).fill(0);
  next.specialVersion = SPECIAL_RESET_VERSION;
  next.rev += 1;
  next.updatedAt = now;
  next.lastSeen = now;
  return next;
}

/** @brief Adds the premium mutation to one plot and halves its remaining time. */
function specializePlot(ledger: GardenLedger, slot: number, now: number, halve: boolean): GardenLedger {
  const next = clone(ledger);
  const plot = next.specialPlots?.[slot] ?? null;
  if (plot === null) return next;
  next.specialPlots[slot] = {
    ...plot,
    effects: canonicalEffects([...plot.effects, SPECIAL_MUTATION]),
    readyAt: halve
      ? now + Math.max(5_000, Math.round((plot.readyAt - now) * SPECIAL_GROW_SCALE))
      : plot.readyAt,
  };
  return next;
}

/** @brief Sows one owned seed into every free, open plot. */
function plantAll(ledger: GardenLedger, seedId: SeedId, now: number, rng: () => number): RuleResult {
  const seed = seedById(seedId);
  if (seed === undefined) return { ok: false, code: "NO_SEED" };
  if (prestigeTierForSeed(seed.id) > ledger.prestige) {
    return { ok: false, code: "PRESTIGE_LOCKED" };
  }
  if (ledger.damagedPlots?.every((damaged) => damaged === true) === true) {
    return { ok: false, code: "PLOT_DAMAGED" };
  }
  let owned = ledger.bag.seeds[seed.id] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SEED" };

  let current = ledger;
  let planted = 0;
  for (let slot = 0; slot < ledger.plots.length && owned > 0; slot += 1) {
    if ((ledger.plots[slot] ?? null) !== null) continue;
    if (!isCropPatchOpen(ledger, slot)) continue;
    const result = plant(current, slot, seed.id, now, rng);
    if (!result.ok) continue;
    current = result.ledger;
    owned -= 1;
    planted += 1;
  }
  if (planted === 0) return { ok: false, code: "NOTHING_TO_DO" };
  current.rev = ledger.rev + 1;
  current.updatedAt = now;
  current.lastSeen = now;
  return { ok: true, ledger: current, changed: true };
}

/** @brief Uproots every crop matching a seed, value or profit filter. */
function uprootBulk(
  ledger: GardenLedger,
  filter: { seed?: SeedId; tree?: TreeId; priceBelow?: number; profit?: "loss" | "win" },
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  if (
    filter.seed === undefined &&
    filter.tree === undefined &&
    filter.priceBelow === undefined &&
    filter.profit === undefined
  ) {
    return { ok: false, code: "BAD_REQUEST" };
  }
  const next = clone(ledger);
  let removed = 0;
  const matchesValue = (value: number, cost: number): boolean => {
    if (filter.priceBelow !== undefined && value >= filter.priceBelow) return false;
    if (filter.profit !== undefined) {
      const winning = value > cost;
      if (filter.profit === "win" ? !winning : winning) return false;
    }
    return true;
  };

  if (filter.tree === undefined) {
    for (let slot = 0; slot < next.plots.length; slot += 1) {
      const plot = next.plots[slot] ?? null;
      if (plot === null || plot.favorite === true) continue;
      if (filter.seed !== undefined && plot.seed !== filter.seed) continue;
      const value = cropSellPrice(
        { item: plot.seed, effects: resolvedCropEffects(plot, now), pest: plot.pest, star: 1, qty: 1 },
        season,
      );
      if (!matchesValue(value, seedById(plot.seed)?.buy ?? 0)) continue;
      next.plots[slot] = null;
      removed += 1;
    }
  }

  if (filter.seed === undefined) {
    for (let slot = 0; slot < next.trees.length; slot += 1) {
      const tree = next.trees[slot] ?? null;
      if (tree === null || tree.favorite === true) continue;
      if (filter.tree !== undefined && tree.tree !== filter.tree) continue;
      const value = cropSellPrice(
        { item: tree.tree, effects: resolvedTreeEffects(tree, now), pest: tree.pest, star: 1, qty: 1 },
        season,
      );
      if (!matchesValue(value, treeById(tree.tree)?.buy ?? 0)) continue;
      next.trees[slot] = null;
      removed += 1;
    }
  }

  if (removed === 0) return { ok: false, code: "NOTHING_TO_DO" };
  return changed(next, now);
}

/** @brief Adds the prestige mutation-rate bonus to every natural mutation roll. */
function prestigeMutationChances(level: number): Partial<Record<EffectId, number>> {
  const bonus = prestigeMutationBonus(level);
  if (bonus <= 0) return {};
  const out: Partial<Record<EffectId, number>> = {};
  for (const effect of EFFECTS) {
    if (effect.natural) out[effect.id] = bonus;
  }
  return out;
}

/** @brief Full mutation chance bonus: prestige plus the wealth bad-luck tax. */
function mutationChances(ledger: GardenLedger): Partial<Record<EffectId, number>> {
  const out = prestigeMutationChances(ledger.prestige);
  const bad = wealthBadLuck(ledger.coins);
  if (bad > 0) {
    for (const effect of EFFECTS) {
      if (effect.multiplier < 1) out[effect.id] = (out[effect.id] ?? 0) + bad;
    }
  }
  return out;
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
  if (ledger.damagedPlots?.[slot] === true) return { ok: false, code: "PLOT_DAMAGED" };
  const seed = seedById(seedId);
  if (seed === undefined) return { ok: false, code: "NO_SEED" };
  if (prestigeTierForSeed(seed.id) > ledger.prestige) {
    return { ok: false, code: "PRESTIGE_LOCKED" };
  }
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
      now +
      Math.round(
        growTimeForEvents(
          seed,
          events,
          null,
          dayPhaseAt(now).phase.growScale * prestigeGrowScale(ledger.prestige),
        ) * soilGrowthFactor(ledger.soil[slot] ?? SOIL_START),
      ),
    effects: rollEffectsFor(events, rng, mutationChances(ledger)),
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
    readyAt:
      now +
      growTimeForEvents(
        tree,
        events,
        null,
        dayPhaseAt(now).phase.growScale * prestigeGrowScale(ledger.prestige),
      ),
    effects: rollEffectsFor(events, rng, mutationChances(ledger)),
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
/**
 * @brief Rolls the quality star of one harvested crop.
 * @details Farming level, fertilizer, spray, soil fertility and pests all
 * nudge a deterministic roll; each extra star doubles the stack's value.
 */
function rollCropQuality(
  ledger: GardenLedger,
  key: string,
  fertilized: boolean,
  sprayed: boolean,
  pest: boolean,
  soil: number,
  now: number,
): number {
  const bonus =
    ledger.skills.farming.level * 0.02 +
    (fertilized ? 0.1 : 0) +
    (sprayed ? 0.06 : 0) +
    (Math.max(0, Math.min(100, soil)) / 100) * 0.05 +
    (pest ? -0.25 : 0);
  const score = createRng(hash32(`quality:${ledger.playerId}:${key}:${now}`))() + bonus;
  if (score >= 0.93) return 5;
  if (score >= 0.8) return 4;
  if (score >= 0.6) return 3;
  if (score >= 0.35) return 2;
  return 1;
}

function harvest(
  ledger: GardenLedger,
  slot: number,
  now: number,
  rng: () => number,
  auto = false,
  goodOnly = false,
): RuleResult {
  const plot = ledger.plots[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (plot.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
  if (now < plot.readyAt) return { ok: false, code: "NOT_READY" };

  const next = clone(ledger);
  const harvestedEffects = resolvedCropEffects(plot, now, goodOnly);
  const star = rollCropQuality(
    ledger,
    `crop:${slot}`,
    plot.fertilizer !== null,
    plot.spray !== null,
    plot.pest,
    ledger.soil[slot] ?? SOIL_START,
    now,
  );
  addCrop(next.bag.crops, plot.seed, harvestedEffects, 1, plot.pest, star);
  if (rng() < petEffect(ledger, "extraHarvest")) {
    addCrop(next.bag.crops, plot.seed, harvestedEffects, 1, plot.pest, star);
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
    for (const [id, bonus] of Object.entries(mutationChances(ledger))) {
      if (bonus !== undefined) mutationBonus[id as EffectId] = (mutationBonus[id as EffectId] ?? 0) + bonus;
    }
    next.plots[slot] = {
      slot,
      seed: plot.seed,
      plantedAt: now,
      readyAt:
        now +
        Math.round(
          growTimeForEvents(
            seed,
            events,
            plot.fertilizer,
            dayPhaseAt(now).phase.growScale * prestigeGrowScale(ledger.prestige),
          ) * soilGrowthFactor(fertility),
        ),
      effects: rollEffectsFor(events, rng, mutationBonus, sprayBoostFor(plot.spray)).filter(
        (id) => !goodOnly || (effectById(id)?.multiplier ?? 1) > 1,
      ),
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
  const star = rollCropQuality(
    ledger,
    `tree:${slot}`,
    tree.fertilizer !== null,
    tree.spray !== null,
    tree.pest,
    SOIL_START,
    now,
  );
  addCrop(next.bag.crops, tree.tree, resolvedTreeEffects(tree, now), 1, tree.pest, star);
  next.stats.harvested += 1;
  const events = eventsAt(now);
  next.trees[slot] = {
    slot,
    tree: tree.tree,
    plantedAt: now,
    readyAt:
      now +
      growTimeForEvents(
        definition,
        events,
        tree.fertilizer,
        dayPhaseAt(now).phase.growScale * prestigeGrowScale(ledger.prestige),
      ),
    effects: rollEffectsFor(events, rng, prestigeMutationChances(ledger.prestige), sprayBoostFor(tree.spray)),
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
  if (offer === undefined) return { ok: false, code: "TOOL_SOLD_OUT" };

  const next = clone(ledger);
  if (next.shopRestockAt !== season.shop.restockAt) {
    next.shopRestockAt = season.shop.restockAt;
    next.shopStock = {};
  }
  const stock = next.shopStock[tool] ?? offer.stock;
  if (stock < qty) return { ok: false, code: "TOOL_SOLD_OUT" };
  const total = offer.price * qty;
  if (next.coins < total) return { ok: false, code: "NOT_ENOUGH_COINS" };

  next.coins -= total;
  next.stats.spent += total;
  next.shopStock[tool] = stock - qty;
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
function addProduct(
  products: ProductStack[],
  product: ProductId,
  star: number,
  qty: number,
  effects: readonly EffectId[] = [],
): void {
  const canonical = canonicalEffects(effects);
  const index = products.findIndex(
    (stack) =>
      stack.product === product && stack.star === star && sameEffects(stack.effects ?? [], canonical),
  );
  if (index < 0) {
    products.push({
      product,
      star,
      ...(canonical.length === 0 ? {} : { effects: canonical }),
      qty,
    });
    return;
  }
  const stack = products[index];
  if (stack === undefined) return;
  products[index] = {
    product,
    star,
    ...(canonical.length === 0 ? {} : { effects: canonical }),
    qty: stack.qty + qty,
  };
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
  const pats = animal.pats + 1;
  const effects = canonicalEffects(animal.effects ?? []);
  // Petting is the mutation path for livestock. Each type can stack up to
  // MAX_EFFECT_STACK copies, so one animal can carry several mutations.
  const rng = createRng(hash32(`animalmut:${ledger.playerId}:${building}:${slot}:${pats}`));
  if (rng() < 0.08) {
    const pool = EFFECTS.filter((effect) => effect.natural);
    const picked = pool[Math.floor(rng() * pool.length)];
    if (picked !== undefined) effects.push(picked.id);
  }
  next.animals[building][slot] = {
    ...animal,
    pats,
    ...(effects.length === 0 ? {} : { effects: canonicalEffects(effects) }),
  };
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
  recordSale(next, { kind: "animal", item: animal.kind, qty: 1, gross, net: gross - tax }, now);
  grantXp(next, "ranching", 30 + Math.round(gross / 100));
  return changed(next, now);
}

/** @brief Sells one product stack at its quality and event price. */
function sellProduct(
  ledger: GardenLedger,
  product: ProductId,
  star: number,
  effects: readonly EffectId[],
  qty: number,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const products = ledger.bag.products ?? [];
  const stack = products.find(
    (entry) => entry.product === product && entry.star === star && sameEffects(entry.effects ?? [], effects),
  );
  if (stack === undefined || stack.qty < qty) return { ok: false, code: "NO_PRODUCT" };
  const crafted = ["mayo", "cheese", "pickles", "oil", "fabric", "goatCheese", "duckMayo", "caviar"].includes(
    product,
  );
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
  recordSale(next, { kind: "product", item: product, qty, star, effects, gross, net: gross - tax }, now);
  grantXp(next, crafted ? "artisaning" : "ranching", 50 + Math.round(gross / 10));
  next.bag.products = (next.bag.products ?? [])
    .map((entry) =>
      entry.product === product && entry.star === star && sameEffects(entry.effects ?? [], effects)
        ? { ...entry, qty: entry.qty - qty }
        : entry,
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
    const crafted = [
      "mayo",
      "cheese",
      "pickles",
      "oil",
      "fabric",
      "goatCheese",
      "duckMayo",
      "caviar",
    ].includes(stack.product);
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
  for (const stack of products) {
    const unit = productPrice(stack, season);
    recordSale(
      next,
      {
        kind: "product",
        item: stack.product,
        qty: stack.qty,
        star: stack.star,
        effects: stack.effects ?? [],
        gross: unit * stack.qty,
        net: Math.round(unit * stack.qty * (1 - SELL_TAX_RATE)),
      },
      now,
    );
  }
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
/** @brief Mounts a passive machine on the garden or a building. */
function attachMachine(
  ledger: GardenLedger,
  slot: AttachmentSlot,
  id: AttachmentId,
  now: number,
): RuleResult {
  const definition = attachmentById(id);
  if (definition === undefined || definition.slot !== slot) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.coins < definition.price) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= definition.price;
  next.stats.spent += definition.price;
  next.attachments = { ...next.attachments, [slot]: id };
  return changed(next, now);
}

/** @brief Removes a mounted machine; there is no refund. */
function detachMachine(ledger: GardenLedger, slot: AttachmentSlot, now: number): RuleResult {
  if (ledger.attachments?.[slot] === undefined) return { ok: false, code: "NOTHING_TO_DO" };
  const next = clone(ledger);
  next.attachments = { ...next.attachments };
  delete next.attachments[slot];
  return changed(next, now);
}

/** @brief Waters a few crops per cycle while the sprinkler is mounted. */
export function settleAttachments(ledger: GardenLedger, now: number): GardenLedger {
  if (ledger.attachments?.garden !== "sprinkler") return ledger;
  const elapsed = now - (ledger.attachmentSettledAt ?? now);
  const cycles = Math.min(20, Math.floor(elapsed / FARM_CYCLE_MS));
  if (cycles <= 0) return ledger;
  const next = clone(ledger);
  next.attachmentSettledAt = (ledger.attachmentSettledAt ?? now) + cycles * FARM_CYCLE_MS;
  let watered = 0;
  const budget = cycles * 5;
  for (let slot = 0; slot < next.plots.length && watered < budget; slot += 1) {
    const plot = next.plots[slot] ?? null;
    if (plot === null || plot.watered || now >= plot.readyAt) continue;
    const remaining = plot.readyAt - now;
    next.plots[slot] = {
      ...plot,
      readyAt: Math.max(now + 1_000, plot.readyAt - Math.round(remaining * WATER_CUT_RATIO)),
      watered: true,
      effects: canonicalEffects([...plot.effects, "wet"]),
    };
    watered += 1;
  }
  if (watered === 0) return ledger;
  next.rev += 1;
  next.updatedAt = now;
  next.lastSeen = now;
  return next;
}

export function settleFarm(ledger: GardenLedger, now: number): GardenLedger {
  const animals = BUILDING_IDS.flatMap((building) => ledger.animals[building] ?? []).filter(
    (animal): animal is AnimalState => animal !== null,
  );
  const elapsed = now - ledger.farmSettledAt;
  if (elapsed < FARM_CYCLE_MS) return ledger;

  const cycles = Math.min(100, Math.floor(elapsed / FARM_CYCLE_MS));
  if (cycles <= 0) return ledger;
  const pondSteps =
    ledger.buildings.pond > 0
      ? Math.floor(cycles / POND_GROWTH_CYCLES) * (ledger.attachments?.pond === "aerator" ? 2 : 1)
      : 0;
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
    const heated = entry.building !== "pond" && ledger.attachments?.[entry.building] === "heater";
    const interval = Math.round(animalIntervalMs(entry.animal.kind) * (heated ? 0.8 : 1));
    const produced = Math.min(50, Math.floor((now - entry.animal.lastProduceAt) / interval));
    if (produced <= 0) continue;
    const star = animalQuality(entry.animal, now);
    addProduct((next.bag.products ??= []), definition.product, star, produced, entry.animal.effects ?? []);
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
  recordSale(
    next,
    {
      kind: "contract",
      item: offer.product,
      qty: offer.qty,
      star: offer.star,
      gross: offer.reward,
      net: offer.reward,
    },
    now,
  );
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

/**
 * @brief Advances the active daily quests from one successful action.
 * @details Deltas are read from the ledger snapshot, so bulk actions count
 * every affected plot instead of just one click.
 */
export function advanceQuests(
  before: GardenLedger,
  after: GardenLedger,
  action: GardenAction,
  now: number,
): GardenLedger {
  const day = wheelDayAt(now);
  const next = clone(after);
  if (next.questDay !== day) {
    next.questDay = day;
    next.questProgress = {};
    next.questClaims = [];
  }
  const watered = (ledger: GardenLedger): number =>
    ledger.plots.filter((plot) => plot !== null && plot.watered).length +
    ledger.trees.filter((tree) => tree !== null && tree.watered).length;
  const deltas: Record<string, number> = {
    water: Math.max(0, watered(after) - watered(before)),
    plant: Math.max(0, after.stats.planted - before.stats.planted),
    harvest: Math.max(0, after.stats.harvested - before.stats.harvested),
    earn: Math.max(0, after.stats.earned - before.stats.earned),
    pat: action.kind === "patAnimal" ? 1 : 0,
    craft: action.kind === "craftMachine" ? 1 : 0,
  };
  for (const quest of dailyQuestsFor(next.playerId, day)) {
    const gained = deltas[quest.kind] ?? 0;
    if (gained <= 0 || next.questClaims.includes(quest.id)) continue;
    next.questProgress[quest.id] = Math.min(quest.target, (next.questProgress[quest.id] ?? 0) + gained);
  }
  return next;
}

/** @brief Claims one completed daily quest. */
function claimQuest(ledger: GardenLedger, id: string, now: number): RuleResult {
  const day = wheelDayAt(now);
  const next = clone(ledger);
  if (next.questDay !== day) {
    next.questDay = day;
    next.questProgress = {};
    next.questClaims = [];
  }
  const quest = dailyQuestsFor(next.playerId, day).find((entry) => entry.id === id);
  if (quest === undefined) return { ok: false, code: "NO_CONTRACT" };
  if (next.questClaims.includes(id)) return { ok: false, code: "ALREADY_CLAIMED" };
  if ((next.questProgress[id] ?? 0) < quest.target) return { ok: false, code: "BAD_REQUEST" };
  next.coins += quest.reward;
  next.questClaims.push(id);
  return changed(next, now);
}

/** @brief Value of coins plus living crops and animals, for prestige coins. */
function liquidationValue(ledger: GardenLedger, season: SeasonSnapshot, now: number): number {
  let total = ledger.coins;
  for (const plot of ledger.plots) {
    if (plot === null) continue;
    total += cropSellPrice(
      { item: plot.seed, effects: resolvedCropEffects(plot, now), pest: plot.pest, star: 1, qty: 1 },
      season,
    );
  }
  for (const tree of ledger.trees) {
    if (tree === null) continue;
    total += cropSellPrice(
      { item: tree.tree, effects: resolvedTreeEffects(tree, now), pest: tree.pest, star: 1, qty: 1 },
      season,
    );
  }
  for (const plot of ledger.specialPlots ?? []) {
    if (plot === null) continue;
    total += cropSellPrice(
      {
        item: plot.seed,
        effects: resolvedCropEffects(plot, now, true),
        pest: plot.pest,
        star: 5,
        qty: 1,
      },
      season,
    );
  }
  for (const building of BUILDING_IDS) {
    for (const animal of ledger.animals[building] ?? []) {
      if (animal === null) continue;
      total += animalMeatPrice(animal.kind, animalQuality(animal, now), ledger.pondGrowth ?? 0);
    }
  }
  return total;
}

/** @brief Resets crops and animals for permanent prestige bonuses. */
function prestige(ledger: GardenLedger, season: SeasonSnapshot, now: number): RuleResult {
  if (ledger.stats.earned < prestigeRequirement(ledger.prestige)) {
    return { ok: false, code: "BAD_REQUEST" };
  }
  const next = clone(ledger);
  // Prestige converts wallet + living garden value into prestige coins.
  const earned = Math.floor(liquidationValue(ledger, season, now) / PRESTIGE_COIN_VALUE);
  next.coins = 0;
  next.prestigeCoins = (next.prestigeCoins ?? 0) + earned;
  next.prestigeProgress = 0;
  // Only living things reset; machines, buildings, land, coins and staff stay.
  next.plots = next.plots.map(() => null);
  next.trees = next.trees.map(() => null);
  next.specialPlots = next.specialPlots.map(() => null);
  next.animals = {
    coop: next.animals.coop.map(() => null),
    barn: next.animals.barn.map(() => null),
    pond: (next.animals.pond ?? []).map(() => null),
  };
  next.bag = { ...next.bag, seeds: {}, crops: [] };
  next.stats = { ...next.stats, planted: 0, harvested: 0, earned: 0 };
  next.prestige = ledger.prestige + 1;
  next.questDay = wheelDayAt(now);
  return changed(next, now);
}

/** @brief Repurchases a crop cell burnt by fire. */
function repairPlot(ledger: GardenLedger, slot: number, now: number): RuleResult {
  if (ledger.damagedPlots?.[slot] !== true) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.coins < PLOT_REPAIR_COST) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= PLOT_REPAIR_COST;
  next.stats.spent += PLOT_REPAIR_COST;
  next.damagedPlots[slot] = false;
  next.soil[slot] = SOIL_START;
  collect(next, `repair:${slot}`);
  return changed(next, now);
}

/** @brief Buys one final-shop plant with prestige coins. */
function buyFinalSeed(ledger: GardenLedger, seed: SeedId, now: number): RuleResult {
  const offer = FINAL_SHOP.find((entry) => entry.seed === seed);
  if (offer === undefined) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.prestige < FINAL_SHOP_PRESTIGE) return { ok: false, code: "PRESTIGE_LOCKED" };
  if ((ledger.prestigeCoins ?? 0) < offer.coins) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.prestigeCoins -= offer.coins;
  next.bag.seeds[seed] = (next.bag.seeds[seed] ?? 0) + 1;
  collect(next, `seed:${seed}`);
  return changed(next, now);
}

/** @brief Buys one seed from the prestige shop. */
function buyPrestigeSeed(ledger: GardenLedger, seed: SeedId, now: number): RuleResult {
  const offer = PRESTIGE_SHOP.find((entry) => entry.seed === seed);
  if (offer === undefined) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.prestige < offer.tier) return { ok: false, code: "BAD_REQUEST" };
  if (ledger.coins < offer.price) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= offer.price;
  next.stats.spent += offer.price;
  next.bag.seeds[seed] = (next.bag.seeds[seed] ?? 0) + 1;
  collect(next, `seed:${seed}`);
  return changed(next, now);
}

/** @brief Spins the lucky wheel; one rare seed every twenty spins guaranteed. */
function spinWheel(ledger: GardenLedger, now: number): RuleResult {
  const day = wheelDayAt(now);
  const spin = ledger.wheelDay === day ? ledger.wheelSpins : 0;
  const cost = wheelCost(spin);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= cost;
  next.wheelDay = day;
  const rng = createRng(hash32(`wheel:${ledger.playerId}:${day}:${spin}`));
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
/** @brief Current value of the garden's permanent assets. */
export function assetValue(ledger: GardenLedger): number {
  let value = ledger.tabs * 10_000_000;
  for (const level of Object.values(ledger.buildings)) value += (level ?? 0) * 50_000_000;
  for (const machine of Object.values(ledger.machines)) value += (machine?.level ?? 0) * 20_000_000;
  value += ledger.staff.length * 2_000_000;
  const animals =
    ledger.animals.coop.length + ledger.animals.barn.length + (ledger.animals.pond?.length ?? 0);
  value += animals * 1_000_000;
  return value;
}

/**
 * @brief Daily property/wealth tax.
 * @details A small cut of asset value plus 0.25% of coins above one billion,
 * so idle trillion-coin wallets actually drain while new gardens pay almost
 * nothing.
 */
export function dailyAssetTax(ledger: GardenLedger): number {
  const assets = assetValue(ledger) * 0.001;
  const wealth = Math.max(0, ledger.coins - 1_000_000_000) * 0.0025;
  return Math.max(0, Math.floor(assets + wealth));
}

export function settleExtras(ledger: GardenLedger, now: number): GardenLedger {
  let changedAny = false;
  const next = clone(ledger);

  // The wheel counter resets at midnight: fresh spins, fresh doubling.
  const today = wheelDayAt(now);
  if (next.wheelDay !== today) {
    next.wheelDay = today;
    next.wheelSpins = 0;
    next.wheelPity = 0;
    changedAny = true;
  }
  // Daily quest board rotates with the local day.
  if (next.questDay !== today) {
    next.questDay = today;
    next.questProgress = {};
    next.questClaims = [];
    changedAny = true;
  }

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

  // Property tax is charged once per local day, after streak/achievement
  // rewards land, from the final wallet.
  if (next.taxDay !== today) {
    const tax = dailyAssetTax(next);
    next.coins = Math.max(0, next.coins - tax);
    next.stats = { ...next.stats, spent: next.stats.spent + tax };
    next.taxDay = today;
    next.taxLast = tax;
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
/** @brief Rolls fires and crows per farm cycle unless protected. */
export function settleHazards(ledger: GardenLedger, now: number): GardenLedger {
  const elapsed = now - (ledger.hazardSettledAt ?? now);
  if (elapsed < FARM_CYCLE_MS) return ledger;
  const cycles = Math.min(20, Math.floor(elapsed / FARM_CYCLE_MS));
  if (cycles <= 0) return ledger;
  const next = clone(ledger);
  next.hazardSettledAt = (ledger.hazardSettledAt ?? now) + cycles * FARM_CYCLE_MS;
  if (!Array.isArray(next.damagedPlots)) next.damagedPlots = [];
  while (next.damagedPlots.length < next.plots.length) next.damagedPlots.push(false);

  for (let step = 0; step < cycles; step += 1) {
    const cycle = Math.floor((ledger.hazardSettledAt ?? now) / FARM_CYCLE_MS) + step;

    if (ledger.attachments?.fire !== "fireSystem") {
      const rng = createRng(hash32(`fire:${ledger.playerId}:${cycle}`));
      if (rng() < FIRE_CHANCE_PER_CYCLE) {
        const candidates: number[] = [];
        next.plots.forEach((plot, slot) => {
          if (plot !== null && next.damagedPlots?.[slot] !== true) candidates.push(slot);
        });
        if (candidates.length > 0) {
          const pick = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
          if (pick !== undefined) {
            next.plots[pick] = null;
            next.damagedPlots[pick] = true;
            next.soil[pick] = 0;
          }
        }
      }
    }

    if (ledger.attachments?.garden !== "scarecrow") {
      const rng = createRng(hash32(`crow:${ledger.playerId}:${cycle}`));
      if (rng() < CROW_CHANCE_PER_CYCLE) {
        const crops: number[] = [];
        next.plots.forEach((plot, slot) => {
          if (plot !== null && next.damagedPlots?.[slot] !== true) crops.push(slot);
        });
        const trees: number[] = [];
        next.trees.forEach((tree, slot) => {
          if (tree !== null) trees.push(slot);
        });
        const total = crops.length + trees.length;
        if (total > 0) {
          const pick = Math.min(total - 1, Math.floor(rng() * total));
          if (pick < crops.length) {
            const slot = crops[pick];
            if (slot !== undefined) next.plots[slot] = null;
          } else {
            const slot = trees[pick - crops.length];
            if (slot !== undefined) next.trees[slot] = null;
          }
        }
      }
    }
  }
  return next;
}

export function settleDisease(ledger: GardenLedger, now: number): GardenLedger {
  const elapsed = now - ledger.diseaseSettledAt;
  if (elapsed < FARM_CYCLE_MS) return ledger;
  const cycles = Math.min(20, Math.floor(elapsed / FARM_CYCLE_MS));
  if (cycles <= 0) return ledger;
  const next = clone(ledger);
  next.diseaseSettledAt = ledger.diseaseSettledAt + cycles * FARM_CYCLE_MS;

  const isCropNeighbour = (left: number, right: number): boolean => {
    if (Math.floor(left / PLOTS_PER_PATCH) !== Math.floor(right / PLOTS_PER_PATCH)) return false;
    const l = left % PLOTS_PER_PATCH;
    const r = right % PLOTS_PER_PATCH;
    const lr = Math.floor(l / 3);
    const lc = l % 3;
    const rr = Math.floor(r / 3);
    const rc = r % 3;
    return Math.abs(lr - rr) <= 1 && Math.abs(lc - rc) <= 1 && l !== r;
  };

  for (let step = 0; step < cycles; step += 1) {
    const cycle = Math.floor(ledger.diseaseSettledAt / FARM_CYCLE_MS) + step;
    const time = ledger.diseaseSettledAt + step * FARM_CYCLE_MS;

    // Sick plants that were left alone die and free their slot.
    for (let slot = 0; slot < next.plots.length; slot += 1) {
      const plot = next.plots[slot] ?? null;
      if (plot === null || plot.diseasedAt === undefined) continue;
      if (time - plot.diseasedAt < DISEASE_DEATH_CYCLES * FARM_CYCLE_MS) continue;
      next.plots[slot] = null;
    }
    for (let slot = 0; slot < next.trees.length; slot += 1) {
      const tree = next.trees[slot] ?? null;
      if (tree === null || tree.diseasedAt === undefined) continue;
      if (time - tree.diseasedAt < TREE_DISEASE_DEATH_CYCLES * FARM_CYCLE_MS) continue;
      next.trees[slot] = null;
    }

    // A small chance for a fresh infection, then spread to same-type neighbours.
    for (let slot = 0; slot < next.plots.length; slot += 1) {
      const plot = next.plots[slot] ?? null;
      if (plot === null) continue;
      if (plot.diseasedAt !== undefined) {
        for (let other = 0; other < next.plots.length; other += 1) {
          if (other === slot) continue;
          const neighbour = next.plots[other] ?? null;
          if (neighbour === null || neighbour.diseasedAt !== undefined) continue;
          if (neighbour.seed !== plot.seed || !isCropNeighbour(slot, other)) continue;
          const rng = createRng(hash32(`spread:${ledger.playerId}:c${slot}:${other}:${cycle}`));
          if (rng() < DISEASE_SPREAD_CHANCE) next.plots[other] = { ...neighbour, diseasedAt: time };
        }
        continue;
      }
      const rng = createRng(hash32(`disease:${ledger.playerId}:c${slot}:${cycle}`));
      if (rng() < DISEASE_CHANCE_PER_CYCLE) next.plots[slot] = { ...plot, diseasedAt: time };
    }

    for (let slot = 0; slot < next.trees.length; slot += 1) {
      const tree = next.trees[slot] ?? null;
      if (tree === null) continue;
      if (tree.diseasedAt !== undefined) {
        for (let other = 0; other < next.trees.length; other += 1) {
          if (other === slot) continue;
          const neighbour = next.trees[other] ?? null;
          if (neighbour === null || neighbour.diseasedAt !== undefined) continue;
          if (neighbour.tree !== tree.tree) continue;
          if (!isCropNeighbour(slot, other)) continue;
          const rng = createRng(hash32(`spread:${ledger.playerId}:t${slot}:${other}:${cycle}`));
          if (rng() < DISEASE_SPREAD_CHANCE) next.trees[other] = { ...neighbour, diseasedAt: time };
        }
        continue;
      }
      const rng = createRng(hash32(`disease:${ledger.playerId}:t${slot}:${cycle}`));
      if (rng() < DISEASE_CHANCE_PER_CYCLE) next.trees[slot] = { ...tree, diseasedAt: time };
    }
  }
  return next;
}

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
            (1 - 0.12 * ledger.greenhouse) *
            (1 - (ledger.pet * 0.15 + petEffect(ledger, "pestShield"))) *
            (ledger.attachments?.garden === "scarecrow" ? 0.5 : 1);
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
      if (rng() >= PEST_CHANCE_PER_CYCLE * (ledger.attachments?.garden === "scarecrow" ? 0.5 : 1)) continue;
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

/** One input already removed from the bag and held by a machine. */
interface MachineHold {
  key: ItemId | ProductId;
  star?: number;
  sell?: number;
  effects?: readonly EffectId[];
  output?: ProductId;
}

/** @brief All product recipes for a converter, including its default one. */
function productRecipes(definition: MachineDefinition): Array<{ input: ProductId; output: ProductId }> {
  const list: Array<{ input: ProductId; output: ProductId }> = [];
  if (definition.input.kind === "product" && definition.output.kind === "product") {
    list.push({ input: definition.input.product, output: definition.output.product });
  }
  for (const recipe of definition.recipes ?? []) {
    list.push({ input: recipe.input, output: recipe.output });
  }
  return list;
}

/** @brief Output product for one machine input, following extra recipes. */
function recipeOutputFor(definition: MachineDefinition, key: ItemId | ProductId): ProductId | undefined {
  const recipe = productRecipes(definition).find((entry) => entry.input === key);
  if (recipe !== undefined) return recipe.output;
  return definition.output.kind === "product" ? definition.output.product : undefined;
}

/** @brief Removes one input from the bag for a machine. */
function takeMachineInput(
  next: GardenLedger,
  definition: MachineDefinition,
  item: ItemId | ProductId | undefined,
): MachineHold | null {
  const recipes = productRecipes(definition);
  if (recipes.length > 0) {
    const available = recipes.filter((recipe) =>
      next.bag.products.some((entry) => entry.product === recipe.input && entry.qty > 0),
    );
    const chosen = item === undefined ? available[0] : available.find((recipe) => recipe.input === item);
    if (chosen === undefined) return null;
    const stack = next.bag.products.find((entry) => entry.product === chosen.input && entry.qty > 0);
    if (stack === undefined) return null;
    next.bag.products = next.bag.products
      .map((entry) =>
        entry.product === stack.product && entry.star === stack.star
          ? { ...entry, qty: entry.qty - 1 }
          : entry,
      )
      .filter((entry) => entry.qty > 0);
    return {
      key: stack.product as unknown as ItemId,
      star: stack.star,
      effects: stack.effects ?? [],
      output: chosen.output,
    };
  }
  if (definition.input.kind === "product") {
    const inputProduct = definition.input.product;
    const stack = next.bag.products.find((entry) => entry.product === inputProduct && entry.qty > 0);
    if (stack === undefined) return null;
    next.bag.products = next.bag.products
      .map((entry) =>
        entry.product === stack.product && entry.star === stack.star
          ? { ...entry, qty: entry.qty - 1 }
          : entry,
      )
      .filter((entry) => entry.qty > 0);
    // Product ids ride the same string field; only the star is used on output.
    return {
      key: stack.product as unknown as ItemId,
      star: stack.star,
      effects: stack.effects ?? [],
      output: recipeOutputFor(definition, stack.product as unknown as ItemId),
    };
  }
  const input = machineInput(definition, item as ItemId | undefined);
  if (input === null) return null;
  const stack = next.bag.crops.find((entry) => entry.item === input.key);
  if (stack === undefined || stack.qty < 1) return null;
  next.bag.crops = next.bag.crops
    .map((entry) => (entry === stack ? { ...entry, qty: entry.qty - 1 } : entry))
    .filter((entry) => entry.qty > 0);
  return { key: input.key, sell: input.sell, effects: stack.effects ?? [] };
}

/** @brief Produces one machine output from a held input. */
function produceMachineOutput(
  next: GardenLedger,
  definition: MachineDefinition,
  hold: MachineHold,
  level: number,
  roll: () => number,
): number {
  const bonus = artisaningOutputBonus(next.skills.artisaning.level);
  const outputProduct = hold.output ?? recipeOutputFor(definition, hold.key);
  if (outputProduct !== undefined) {
    const star =
      definition.input.kind === "product"
        ? (hold.star ?? 1)
        : definition.gradeByPrice === true
          ? driedStarForSell(hold.sell ?? 0)
          : 1;
    const qty = Math.max(1, Math.round(converterOutput(level) * (1 + bonus)));
    addProduct(next.bag.products, outputProduct, star, qty, hold.effects ?? []);
    return qty;
  }
  const seed = seedById(hold.key as ItemId);
  if (seed === undefined) return 0;
  if (roll() >= seedMakerChance(next.prestige)) return 0;
  const qty = Math.max(1, Math.round(seedMakerOutput(level) * (1 + bonus)));
  next.bag.seeds[seed.id] = (next.bag.seeds[seed.id] ?? 0) + qty;
  return qty;
}

/** @brief Starts a timed job or produces instantly from a held input. */
function startMachineCraft(
  next: GardenLedger,
  id: MachineId,
  definition: MachineDefinition,
  hold: MachineHold,
  now: number,
): GardenLedger {
  const machine = next.machines[id];
  if (machine === undefined) return next;
  if (definition.queued === true) {
    const cycles = machineCycles(machine.level, definition.cooldownCycles) * FARM_CYCLE_MS;
    next.machines[id] = {
      ...machine,
      lastCraftAt: now,
      job: {
        item: hold.key,
        ...(hold.star === undefined ? {} : { star: hold.star }),
        ...(hold.sell === undefined ? {} : { sell: hold.sell }),
        ...(hold.effects === undefined ? {} : { effects: hold.effects }),
        startedAt: now,
        readyAt: now + cycles,
      },
    };
    grantXp(next, "artisaning", 100);
  } else {
    const produced = produceMachineOutput(
      next,
      definition,
      hold,
      machine.level,
      createRng(hash32(`machine:${next.playerId}:${id}:${now}:${hold.key}`)),
    );
    next.machines[id] = {
      ...machine,
      lastCraftAt: now,
      made: (machine.made ?? 0) + produced,
    };
    grantXp(next, "artisaning", 200);
  }
  return next;
}

/**
 * @brief Collects one finished timed job.
 * @return The next ledger, or `null` when the job is missing or still brewing.
 */
function finishMachineJob(ledger: GardenLedger, id: MachineId, now: number): GardenLedger | null {
  const definition = machineById(id);
  const machine = ledger.machines[id];
  const job = machine?.job;
  if (definition === undefined || machine === undefined || job === undefined) return null;
  if (now < job.readyAt) return null;
  const next = clone(ledger);
  const produced = produceMachineOutput(
    next,
    definition,
    {
      key: job.item,
      ...(job.star === undefined ? {} : { star: job.star }),
      ...(job.sell === undefined ? {} : { sell: job.sell }),
      ...(job.effects === undefined ? {} : { effects: job.effects }),
    },
    machine.level,
    createRng(hash32(`machine:${next.playerId}:${id}:${now}:${job.item}`)),
  );
  next.machines[id] = { ...machine, job: undefined, made: (machine.made ?? 0) + produced };
  grantXp(next, "artisaning", 120);
  return next;
}

/** @brief Settles finished jobs and pulls the next entry from every queue. */
export function settleMachines(ledger: GardenLedger, now: number): GardenLedger {
  let current = ledger;
  for (const rawId of Object.keys(current.machines)) {
    const id = rawId as MachineId;
    for (let guard = 0; guard < 100; guard += 1) {
      const definition = machineById(id);
      const machine = current.machines[id];
      if (definition === undefined || machine === undefined) break;
      if (machine.job !== undefined && now >= machine.job.readyAt) {
        const settled = finishMachineJob(current, id, now);
        if (settled === null) break;
        current = settled;
        continue;
      }
      if (machine.job !== undefined) break;
      const queue = machine.queue ?? [];
      if (queue.length === 0) break;
      if (machine.limit !== undefined && (machine.made ?? 0) >= machine.limit) break;
      const cycles = machineCycles(machine.level, definition.cooldownCycles) * FARM_CYCLE_MS;
      if (definition.queued !== true && now - machine.lastCraftAt < cycles) break;
      const [hold, ...rest] = queue;
      if (hold === undefined) break;
      const next = clone(current);
      next.machines[id] = { ...machine, queue: rest };
      current = startMachineCraft(
        next,
        id,
        definition,
        {
          key: hold.item,
          ...(hold.star === undefined ? {} : { star: hold.star }),
          ...(hold.sell === undefined ? {} : { sell: hold.sell }),
          ...(hold.effects === undefined ? {} : { effects: hold.effects }),
        },
        now,
      );
    }
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
  return changed(settleMachines(settled, now), now);
}

/** @brief Refunds every queued batch back into the bag. */
function clearMachineQueue(ledger: GardenLedger, id: MachineId, now: number): RuleResult {
  const definition = machineById(id);
  const machine = ledger.machines[id];
  if (definition === undefined || machine === undefined) return { ok: false, code: "MACHINE_LOCKED" };
  const queue = machine.queue ?? [];
  if (queue.length === 0) return { ok: false, code: "NOTHING_TO_DO" };
  const next = clone(ledger);
  next.bag.products ??= [];
  for (const hold of queue) {
    if (definition.input.kind === "product") {
      addProduct(next.bag.products, hold.item as ProductId, hold.star ?? 1, 1, hold.effects ?? []);
    } else {
      addCrop(next.bag.crops, hold.item as ItemId, [], 1, false, 1);
    }
  }
  next.machines[id] = { ...machine, queue: [] };
  return changed(next, now);
}

/** @brief Crafts one batch immediately, or queues a batch for later. */
function craftMachine(
  ledger: GardenLedger,
  id: MachineId,
  item: ItemId | ProductId | undefined,
  now: number,
): RuleResult {
  const definition = machineById(id);
  const machine = ledger.machines[id];
  if (definition === undefined || machine === undefined) return { ok: false, code: "MACHINE_LOCKED" };
  let base = ledger;
  if (definition.queued === true && machine.job !== undefined) {
    if (now < machine.job.readyAt) return { ok: false, code: "MACHINE_COOLDOWN" };
    const settled = finishMachineJob(base, id, now);
    if (settled === null) return { ok: false, code: "MACHINE_COOLDOWN" };
    base = settled;
  }
  const current = base.machines[id];
  if (current === undefined) return { ok: false, code: "MACHINE_LOCKED" };
  if (
    definition.queued !== true &&
    now - current.lastCraftAt < machineCycles(current.level, definition.cooldownCycles) * FARM_CYCLE_MS
  ) {
    return { ok: false, code: "MACHINE_COOLDOWN" };
  }
  const next = clone(base);
  const hold = takeMachineInput(next, definition, item);
  if (hold === null) return { ok: false, code: "NO_INPUT" };
  return changed(startMachineCraft(next, id, definition, hold, now), now);
}

/** @brief Queues one batch; its input is held until the machine reaches it. */
function queueMachine(
  ledger: GardenLedger,
  id: MachineId,
  item: ItemId | ProductId | undefined,
  qty: number,
  now: number,
): RuleResult {
  const definition = machineById(id);
  const machine = ledger.machines[id];
  if (definition === undefined || machine === undefined) return { ok: false, code: "MACHINE_LOCKED" };
  const wanted = Math.max(1, Math.min(999, Math.floor(qty)));
  const next = clone(ledger);
  const jobs: MachineJob[] = [];
  for (let index = 0; index < wanted; index += 1) {
    const hold = takeMachineInput(next, definition, item);
    if (hold === null) break;
    jobs.push({
      item: hold.key,
      ...(hold.star === undefined ? {} : { star: hold.star }),
      ...(hold.sell === undefined ? {} : { sell: hold.sell }),
      ...(hold.effects === undefined ? {} : { effects: hold.effects }),
      startedAt: 0,
      readyAt: 0,
    });
  }
  if (jobs.length === 0) return { ok: false, code: "NO_INPUT" };
  next.machines[id] = {
    ...machine,
    queue: [...(machine.queue ?? []), ...jobs],
  };
  return changed(next, now);
}

/** @brief Sets or clears the produced-units limit for one machine. */
function setMachineLimit(
  ledger: GardenLedger,
  id: MachineId,
  limit: number | undefined,
  now: number,
): RuleResult {
  const machine = ledger.machines[id];
  if (machine === undefined) return { ok: false, code: "MACHINE_LOCKED" };
  const next = clone(ledger);
  if (limit === undefined) {
    const { limit: _limit, made: _made, ...rest } = machine;
    next.machines[id] = { ...rest };
  } else {
    next.machines[id] = { ...machine, limit, made: 0 };
  }
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
  star: number,
  qty: number,
  pest: boolean,
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  const stack = ledger.bag.crops.find(
    (entry) =>
      entry.item === item &&
      sameEffects(entry.effects, effects) &&
      (entry.star ?? 1) === star &&
      (entry.pest === true) === pest,
  );
  if (stack === undefined || stack.qty < qty) return { ok: false, code: "NO_CROP" };

  const next = clone(ledger);
  // A locked future guarantees its price for the covered units.
  const marketPrice = Math.round(
    cropSellPrice(stack, season) *
      (1 + petEffect(ledger, "sell")) *
      (1 + farmingSellBonus(ledger.skills.farming.level)) *
      prestigeSellBonus(ledger.prestige),
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
  removeCrop(next.bag.crops, item, effects, pest, star, qty);
  recordSale(next, { kind: "crop", item, qty, star, effects, gross, net: gross - tax }, now);
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
        (1 + farmingSellBonus(ledger.skills.farming.level)) *
        prestigeSellBonus(ledger.prestige),
    );
    const future = next.futures.find(
      (entry) => entry.item === stack.item && entry.expiresAt > now && entry.qty > 0,
    );
    const unit = future !== undefined ? Math.max(base, future.price) : base;
    total += unit * stack.qty;
    recordSale(
      next,
      {
        kind: "crop",
        item: stack.item,
        qty: stack.qty,
        star: stack.star ?? 1,
        effects: stack.effects,
        gross: unit * stack.qty,
        net: Math.round(unit * stack.qty * (1 - SELL_TAX_RATE)),
      },
      now,
    );
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

/** @brief Appends one sale to the capped trace log. */
function recordSale(ledger: GardenLedger, entry: Omit<SaleRecord, "ts">, now: number): void {
  ledger.sales = [...(ledger.sales ?? []), { ...entry, ts: now }].slice(-50);
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
    attachments: { ...(ledger.attachments ?? {}) },
    soil: [...ledger.soil],
    specialOwned: Math.min(SPECIAL_SLOTS, ledger.specialOwned ?? 0),
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
    sales: (ledger.sales ?? []).map((entry) => ({ ...entry })),
    shopStock: { ...ledger.shopStock },
    questProgress: { ...ledger.questProgress },
    questClaims: [...ledger.questClaims],
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
  star = 1,
): void {
  const canonical = canonicalEffects(effects);
  const quality = Math.max(1, Math.min(5, Math.floor(star)));
  const stack = crops.find(
    (entry) =>
      entry.item === item &&
      sameEffects(entry.effects, canonical) &&
      (entry.pest === true) === pest &&
      (entry.star ?? 1) === quality,
  );
  if (stack === undefined) {
    crops.push({
      item,
      effects: canonical,
      ...(pest ? { pest: true } : {}),
      ...(quality > 1 ? { star: quality } : {}),
      qty,
    });
    return;
  }
  crops[crops.indexOf(stack)] = {
    item,
    effects: canonical,
    ...(pest ? { pest: true } : {}),
    ...(quality > 1 ? { star: quality } : {}),
    qty: stack.qty + qty,
  };
}

/** @brief Removes produce units from a mutable bag, dropping empty stacks. */
function removeCrop(
  crops: CropStack[],
  item: ItemId,
  effects: readonly EffectId[],
  pest: boolean,
  star: number,
  qty: number,
): void {
  const index = crops.findIndex(
    (entry) =>
      entry.item === item &&
      sameEffects(entry.effects, effects) &&
      (entry.star ?? 1) === star &&
      (entry.pest === true) === pest,
  );
  if (index < 0) return;
  const stack = crops[index];
  if (stack === undefined) return;
  const left = stack.qty - qty;
  if (left <= 0) crops.splice(index, 1);
  else
    crops[index] = { item, effects: canonicalEffects(effects), ...(pest ? { pest: true } : {}), qty: left };
}
