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
  DAY_MS,
  PLANT_THIRST_MS,
  THIRST_RULE_VERSION,
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
  MUSHROOM_TRAYS,
  mushroomById,
  mushroomGrowMs,
  WATER_ALL_COST,
  SELL_TAX_RATE,
  SOIL_START,
  ACHIEVEMENTS,
  COMPOST_RATIO,
  FUTURE_FEE_RATE,
  FUTURE_LOCK_MS,
  GREENHOUSE_PRICES,
  GREENHOUSE_SLOTS,
  GREENHOUSE_MUTATION,
  greenhouseCapacity,
  BAD_MUTATIONS,
  type AnySeedId,
  type AnyItemId,
  type HybridId,
  type HybridSeed,
  type HybridTier,
  MIN_BREED_PARENTS,
  MAX_BREED_PARENTS,
  MAX_HYBRIDS,
  HYBRID_PREFIX,
  isHybridId,
  hybridBreedCost,
  hybridOdds,
  resolveSeed,
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
  staffWorkIntervalMs,
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
  RELICS,
  MAX_EQUIPPED_RELICS,
  relicById,
  type RelicId,
  type PetExpeditionState,
  PET_SKILL_COOLDOWN_MS,
  plotSynergyAt,
  type StockHolding,
  CONTRACT_CHAIN,
  equippedPetEffect,
  merchantOffers,
  petById,
  rollPet,
  basePriceOf,
  FERTILIZERS,
  SPRAYS,
  SEEDS,
  TREES,
  MUSHROOMS,
  planQuickPlan,
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
  KITCHEN_PRICE,
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
  POND_MAX_SLOTS,
  BASE_FISH_SPECIES,
  pondBasinIndex,
  pondBasinSlot,
  inspectPondBasin,
  generateDeterministicHybridFish,
  isFishKind,
  animalById,
  animalIntervalMs,
  animalIsIncubating,
  animalMeatPrice,
  animalQuality,
  animalGeneYield,
  animalGeneSpeed,
  animalGeneMutation,
  type AnimalGenes,
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
  effectsMultiplier,
  codexReward,
  effectById,
  dailyQuestsFor,
  prestigeSellBonus,
  prestigeMutationBonus,
  prestigeSkillSellBonus,
  prestigeSkillGrowScale,
  prestigeSkillMutationBonus,
  weeklyModifier,
  wealthBadLuck,
  prestigeTierForSeed,
  PRESTIGE_SHOP,
  PRESTIGE_COIN_VALUE,
  FINAL_SHOP,
  FINAL_SHOP_PRESTIGE,
  prestigeGrowScale,
  prestigeRequirement,
  prestigeStarterSeeds,
  eventsAt,
  growTimeForEvents,
  rollEffectsFor,
  hash32,
  nextPatchPrice,
  nextTabPrice,
  canonicalEffects,
  MINE_FLOOR_CELLS,
  generateMineFloor,
  initialMineState,
  mineElevatorCheckpoints,
  PICKAXE_TIERS,
  type PickaxeTier,
  type MineState,
  type MineRockCell,
  rollEffects,
  resolvedCropEffects,
  resolvedTreeEffects,
  fertilizerById,
  sprayById,
  sprayBoostFor,
  totalCrops,
  totalTrees,
  treeById,
  treeLikeById,
  type ActiveFertilizer,
  type ActiveSpray,
  type AnimalId,
  type AnimalState,
  type BuildingId,
  type CropStack,
  type EffectId,
  type EventDefinition,
  type FertilizerId,
  type SprayId,
  type GardenAction,
  type MushroomId,
  type MushroomTrayState,
  type TimelineEvent,
  type CustomRecipe,
  type PrestigeSkillId,
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
  seeds: Partial<Record<AnySeedId, number>>;
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

/** Mutable mine state stored in the ledger. */
export interface LedgerMineState {
  currentFloor: number;
  maxFloor: number;
  pickaxeLevel: number;
  stamina: number;
  maxStamina: number;
  lastStaminaAt: number;
  grid: MineRockCell[];
  assignedStaffSlot: number | null;
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
  /** SHA-256 of the primary write token. */
  tokenHash: string;
  /** Additional SHA-256 token digests issued to linked multi-device sessions. */
  sessionTokenHashes?: string[];
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
  /** Mine floor state, depth, and pickaxe progression. */
  mine?: LedgerMineState;
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
  /** Greenhouse crop plots, capped at {@link GREENHOUSE_SLOTS}. */
  greenhousePlots?: (PlotState | null)[];
  /** Custom hybrid varieties minted in the Nursery. */
  hybrids?: HybridSeed[];
  /** Sequential counter for unique hybrid ids. */
  hybridCounter?: number;
  /** Most recently bred hybrid id. */
  lastHybridId?: HybridId;
  /** Mushroom house trays; absent on old saves. */
  mushroomTrays?: (MushroomTrayState | null)[];
  /** Owned mushroom spawn blocks per species. */
  mushroomSpawn?: Partial<Record<MushroomId, number>>;
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
  /** Version of the thirst rule last applied to this save. */
  thirstVersion?: number;
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
  codexClaimed: string[];
  timeline: TimelineEvent[];
  raidLastAt: number;
  chainStep: number;
  kitchen: boolean;
  recipes: CustomRecipe[];
  recipeCookedAt: Record<string, number>;
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
  prestigeSkills: { merchant: number; farmer: number; artisan: number };
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
  /** Crafted mine relics owned by the player. */
  relics?: RelicId[];
  /** Equipped mine relics (up to MAX_EQUIPPED_RELICS). */
  equippedRelics?: RelicId[];
  /** Active or completed pet expeditions. */
  petExpeditions?: PetExpeditionState[];
  /** Timestamp of the last equipped pet active skill trigger. */
  petSkillAt?: number;
  /** Stock exchange portfolio keyed by ticker symbol. */
  stocks?: Record<string, StockHolding>;
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
    thirstVersion: THIRST_RULE_VERSION,
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
    greenhousePlots: new Array<PlotState | null>(GREENHOUSE_SLOTS).fill(null),
    hybrids: [],
    hybridCounter: 0,
    mushroomTrays: new Array<MushroomTrayState | null>(MUSHROOM_TRAYS).fill(null),
    mushroomSpawn: {},
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
    codexClaimed: [],
    timeline: [],
    raidLastAt: 0,
    chainStep: 0,
    kitchen: false,
    recipes: [],
    recipeCookedAt: {},
    wheelSpins: 0,
    wheelPity: 0,
    wheelLast: "",
    wheelDay: wheelDayAt(input.now),
    prestige: 0,
    prestigeCoins: 0,
    prestigeSkills: { merchant: 0, farmer: 0, artisan: 0 },
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
    mine: initialMineState(input.now) as unknown as LedgerMineState,
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
    chainStep: ledger.chainStep ?? 0,
    kitchen: ledger.kitchen === true,
    recipes: (ledger.recipes ?? []).map((recipe) => ({ ...recipe, inputs: [...recipe.inputs] })),
    recipeCookedAt: { ...(ledger.recipeCookedAt ?? {}) },
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
    prestigeSkills: { ...(ledger.prestigeSkills ?? {}) },
    prestigePoints:
      ledger.prestige - Object.values(ledger.prestigeSkills ?? {}).reduce((sum, points) => sum + points, 0),
    quests: dailyQuestsFor(ledger.playerId, ledger.questDay).map((quest) => ({
      id: quest.id,
      kind: quest.kind,
      target: quest.target,
      progress: Math.min(quest.target, ledger.questProgress[quest.id] ?? 0),
      reward: quest.reward,
      claimed: ledger.questClaims.includes(quest.id),
    })),
    taxLast: ledger.taxLast,
    relics: [...(ledger.relics ?? [])],
    equippedRelics: [...(ledger.equippedRelics ?? [])],
    petExpeditions: (ledger.petExpeditions ?? []).map((entry) => ({ ...entry })),
    petSkillAt: ledger.petSkillAt ?? 0,
    stocks: Object.fromEntries(
      Object.entries(ledger.stocks ?? {}).map(([sym, holding]) => [sym, { ...holding }]),
    ),
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
    collection: [...ledger.collection],
    codexUnclaimed: ledger.collection
      .filter((key) => !ledger.codexClaimed.includes(key))
      .reduce((sum, key) => sum + codexReward(key), 0),
    timeline: (ledger.timeline ?? []).map((entry) => ({ ...entry })),
    chainStep: ledger.chainStep ?? 0,
    recipes: (ledger.recipes ?? []).map((recipe) => ({ ...recipe, inputs: [...recipe.inputs] })),
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
    greenhousePlots: Array.from({ length: GREENHOUSE_SLOTS }, (_unused, index) => {
      const plot = ledger.greenhousePlots?.[index] ?? null;
      return plot === null ? null : { ...plot };
    }),
    hybrids: (ledger.hybrids ?? []).map((hybrid) => ({ ...hybrid, parents: [...hybrid.parents] })),
    ...(ledger.lastHybridId === undefined ? {} : { lastHybridId: ledger.lastHybridId }),
    mushroomTrays: (ledger.mushroomTrays ?? []).map((tray) => (tray === null ? null : { ...tray })),
    mushroomSpawn: { ...(ledger.mushroomSpawn ?? {}) },
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
    mine: ledger.mine
      ? {
          currentFloor: ledger.mine.currentFloor,
          maxFloor: ledger.mine.maxFloor,
          pickaxeLevel: ledger.mine.pickaxeLevel,
          stamina: ledger.mine.stamina,
          maxStamina: ledger.mine.maxStamina,
          lastStaminaAt: ledger.mine.lastStaminaAt,
          grid: ledger.mine.grid.map((cell) => ({ ...cell })),
          assignedStaffSlot: ledger.mine.assignedStaffSlot,
        }
      : undefined,
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
  const isAuto = "auto" in action && action.auto === true;
  if (!isAuto) {
    const windowValid =
      typeof ledger.actionWindow === "number" &&
      Number.isFinite(ledger.actionWindow) &&
      ledger.actionWindow > 0;
    const countValid =
      typeof ledger.actionCount === "number" &&
      Number.isFinite(ledger.actionCount) &&
      ledger.actionCount >= 0;

    if (!windowValid || !countValid || now - ledger.actionWindow > 60_000 || ledger.actionWindow > now) {
      ledger = { ...ledger, actionWindow: now, actionCount: 0 };
    }
    if (ledger.actionCount >= ACTIONS_PER_MINUTE) return { ok: false, code: "RATE_LIMITED" };
    ledger = { ...ledger, actionCount: ledger.actionCount + 1 };
  }

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
    case "claimCodex":
      return claimCodex(ledger, now);
    case "fulfillChain":
      return fulfillChain(ledger, now);
    case "cookRecipe":
      return cookRecipe(ledger, action.id, season, now);
    case "buildKitchen":
      return buildKitchen(ledger, now);
    case "buyPrestigeSkill":
      return buyPrestigeSkill(ledger, action.skill, now);
    case "respecPrestige":
      return respecPrestige(ledger, now);
    case "buyTree":
      return buyTree(ledger, action.tree, action.slot, now);
    case "plantFruitSeed":
      return plantFruitSeed(ledger, action.slot, action.seed, now);
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
    case "plantGreenhouse":
      return plantGreenhouse(ledger, action.slot, action.seed, now, rng);
    case "harvestGreenhouse":
      return harvestGreenhouse(ledger, action.slot, now, rng, action.auto === true);
    case "uprootGreenhouse":
      return uprootGreenhouse(ledger, action.slot, now);
    case "fertilizeGreenhouse":
      return fertilizeGreenhouse(ledger, action.slot, action.supply, now);
    case "plantAllGreenhouse":
      return plantAllGreenhouse(ledger, action.seed, now, rng);
    case "harvestAllGreenhouse":
      return harvestAllGreenhouse(ledger, now, rng);
    case "breedHybrid":
      return breedHybrid(ledger, action.parents, now, rng);
    case "renameHybrid":
      return renameHybrid(ledger, action.id, action.name, now);
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
    case "quickPlan":
      return quickPlan(ledger, season, now, rng);
    case "buySeed":
      return buySeed(ledger, action.seed, action.qty, season, now);
    case "buySupply":
      return buySupply(ledger, action.supply, action.qty, season, now);
    case "buyMushroomSpawn":
      return buyMushroomSpawn(ledger, action.mushroom, action.qty, now);
    case "plantMushroom":
      return plantMushroom(ledger, action.slot, action.mushroom, now);
    case "harvestMushroom":
      return harvestMushroom(ledger, action.slot, now, rng);
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
    case "mineHit":
      return mineHit(ledger, action.slot, now, rng);
    case "mineDescend":
      return mineDescend(ledger, now, rng);
    case "mineElevator":
      return mineElevator(ledger, action.targetFloor, now, rng);
    case "upgradePickaxe":
      return upgradePickaxe(ledger, now);
    case "mineEat":
      return mineEat(ledger, action.item, now);
    case "assignMiner":
      return assignMiner(ledger, action.staffSlot, now);
    case "craftRelic":
      return craftRelic(ledger, action.relic, now);
    case "equipRelic":
      return equipRelic(ledger, action.relic, now);
    case "usePetSkill":
      return usePetSkill(ledger, now);
    case "startPetExpedition":
      return startPetExpedition(ledger, action.pet, action.durationMin, now);
    case "claimPetExpedition":
      return claimPetExpedition(ledger, action.id, now, rng);
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
    damagedPlots: [],
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
      damagedPlots: ledger.damagedPlots,
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
  const readyAt = halve
    ? now + Math.max(5_000, Math.round((plot.readyAt - now) * SPECIAL_GROW_SCALE))
    : plot.readyAt;
  next.specialPlots[slot] = {
    ...plot,
    effects: canonicalEffects([...plot.effects, SPECIAL_MUTATION]),
    readyAt,
    // Watering restarts growth from this effective duration, so premium speed
    // survives the first watering instead of falling back to the base seed.
    growMs: halve ? Math.max(5_000, readyAt - now) : (plot.growMs ?? readyAt - plot.plantedAt),
  };
  return next;
}

/** @brief Sows one owned seed into every free, open plot. */
function plantAll(ledger: GardenLedger, seedId: AnySeedId, now: number, rng: () => number): RuleResult {
  const seed = resolveSeed(seedId, ledger.hybrids);
  if (seed === undefined) return { ok: false, code: "NO_SEED" };
  if (!isHybridId(seedId) && prestigeTierForSeed(seed.id) > ledger.prestige) {
    return { ok: false, code: "PRESTIGE_LOCKED" };
  }
  if (seed.category === "fruit") return { ok: false, code: "WRONG_AREA" };
  if (ledger.damagedPlots?.every((damaged) => damaged === true) === true) {
    return { ok: false, code: "PLOT_DAMAGED" };
  }
  let owned = ledger.bag.seeds[seedId] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SEED" };

  let current = ledger;
  let planted = 0;
  for (let slot = 0; slot < ledger.plots.length && owned > 0; slot += 1) {
    if ((ledger.plots[slot] ?? null) !== null) continue;
    if (!isCropPatchOpen(ledger, slot)) continue;
    const result = plant(current, slot, seedId, now, rng);
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
  filter: { seed?: AnySeedId; tree?: TreeId; priceBelow?: number; profit?: "loss" | "win"; dead?: boolean },
  season: SeasonSnapshot,
  now: number,
): RuleResult {
  if (
    filter.seed === undefined &&
    filter.tree === undefined &&
    filter.priceBelow === undefined &&
    filter.profit === undefined &&
    filter.dead === undefined
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
      // Dead plants are always cleared by Quick Uproot: they cannot be saved.
      if (plot.dead !== true) {
        if (filter.dead === true) continue;
        const value = cropSellPrice(
          { item: plot.seed, effects: resolvedCropEffects(plot, now), pest: plot.pest, star: 1, qty: 1 },
          season,
        );
        if (!matchesValue(value, seedById(plot.seed)?.buy ?? 0)) continue;
      }
      next.plots[slot] = null;
      removed += 1;
    }
  }

  if (filter.seed === undefined) {
    for (let slot = 0; slot < next.trees.length; slot += 1) {
      const tree = next.trees[slot] ?? null;
      if (tree === null || tree.favorite === true) continue;
      if (filter.tree !== undefined && tree.tree !== filter.tree) continue;
      // Dead trees are cleared too, whatever the value filter says.
      if (tree.dead !== true) {
        if (filter.dead === true) continue;
        const value = cropSellPrice(
          { item: tree.tree, effects: resolvedTreeEffects(tree, now), pest: tree.pest, star: 1, qty: 1 },
          season,
        );
        if (!matchesValue(value, treeById(tree.tree)?.buy ?? 0)) continue;
      }
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

/** @brief Combined prestige + merchant sell multiplier. */
function sellMultiplier(ledger: GardenLedger, now: number): number {
  const relicScale = (ledger.equippedRelics ?? []).includes("midasSeal") ? 1.2 : 1;
  return (
    prestigeSellBonus(ledger.prestige) *
    prestigeSkillSellBonus(ledger.prestigeSkills) *
    weeklyModifier(now).sellScale *
    relicScale
  );
}

/** @brief Combined prestige + farmer growth-time multiplier. */
function growthScale(ledger: GardenLedger, now: number): number {
  return (
    prestigeGrowScale(ledger.prestige) *
    prestigeSkillGrowScale(ledger.prestigeSkills) *
    weeklyModifier(now).growScale
  );
}

/** @brief Combined prestige + artisan mutation chance. */
function mutationSkillBonus(ledger: GardenLedger): number {
  return prestigeMutationBonus(ledger.prestige) + prestigeSkillMutationBonus(ledger.prestigeSkills);
}

/** @brief Plants one bagged seed. */
function plant(
  ledger: GardenLedger,
  slot: number,
  seedId: AnySeedId,
  now: number,
  rng: () => number,
): RuleResult {
  if (slot >= ledger.plots.length) return { ok: false, code: "PLOT_LOCKED" };
  if (!isCropPatchOpen(ledger, slot)) return { ok: false, code: "PLOT_LOCKED" };
  if (ledger.plots[slot] !== null) return { ok: false, code: "PLOT_OCCUPIED" };
  if (ledger.damagedPlots?.[slot] === true) return { ok: false, code: "PLOT_DAMAGED" };
  const seed = resolveSeed(seedId, ledger.hybrids);
  if (seed === undefined) return { ok: false, code: "NO_SEED" };
  if (!isHybridId(seedId) && prestigeTierForSeed(seed.id) > ledger.prestige) {
    return { ok: false, code: "PRESTIGE_LOCKED" };
  }
  if (seed.category === "fruit") return { ok: false, code: "WRONG_AREA" };
  const owned = ledger.bag.seeds[seedId] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SEED" };

  const hybrid = isHybridId(seedId) ? ledger.hybrids?.find((entry) => entry.id === seedId) : undefined;
  const next = clone(ledger);
  next.bag.seeds[seedId] = owned - 1;
  const events = eventsAt(now);
  const readyAt =
    now +
    Math.round(
      growTimeForEvents(seed, events, null, dayPhaseAt(now).phase.growScale * growthScale(ledger, now)) *
        soilGrowthFactor(ledger.soil[slot] ?? SOIL_START),
    );
  next.plots[slot] = {
    slot,
    seed: seedId,
    plantedAt: now,
    readyAt,
    growMs: readyAt - now,
    effects: hybrid?.bonusEffect !== undefined ? [hybrid.bonusEffect] : [],
    pest: false,
    protectedUntil: 0,
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
  };
  next.stats.planted += 1;
  logTimeline(next, "plant", now, { item: seedId });
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
  const readyAt =
    now + growTimeForEvents(tree, events, null, dayPhaseAt(now).phase.growScale * growthScale(ledger, now));
  next.trees[slot] = {
    slot,
    tree: tree.id,
    plantedAt: now,
    readyAt,
    growMs: readyAt - now,
    effects: [],
    pest: false,
    protectedUntil: 0,
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
  };
  next.stats.planted += 1;
  logTimeline(next, "plant", now, { item: tree.id });
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
  if (plot.dead === true) return { ok: false, code: "PLANT_DEAD" };
  if (now < plot.readyAt) return { ok: false, code: "NOT_READY" };
  if (plot.growMs !== undefined && plot.watered !== true) return { ok: false, code: "NEEDS_WATER" };

  const next = clone(ledger);
  const synergy = plotSynergyAt(ledger.plots, slot, 3, ledger.hybrids);
  const baseEffects = resolvedCropEffects(plot, now, goodOnly);
  const harvestedEffects = canonicalEffects([
    ...baseEffects,
    ...(synergy.ids.includes("companion") ? (["highquality"] as EffectId[]) : []),
    ...(synergy.ids.includes("harmony") ? (["golden"] as EffectId[]) : []),
  ]);
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
  const seed = resolveSeed(plot.seed, ledger.hybrids);
  const hybrid = isHybridId(plot.seed) ? ledger.hybrids?.find((entry) => entry.id === plot.seed) : undefined;
  grantXp(next, "farming", auto ? 1 : 100 + Math.round((seed?.sell ?? 0) * 3) + harvestedEffects.length * 25);
  // One planting cycle always costs some fertility, even for reharvest plants.
  const fertility = Math.max(0, (next.soil[slot] ?? SOIL_START) - SOIL_STEP);
  next.soil[slot] = fertility;

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
    const regrowAt =
      now +
      Math.round(
        growTimeForEvents(
          seed,
          events,
          plot.fertilizer,
          dayPhaseAt(now).phase.growScale * growthScale(ledger, now),
        ) * soilGrowthFactor(fertility),
      );
    next.plots[slot] = {
      slot,
      seed: plot.seed,
      plantedAt: now,
      readyAt: regrowAt,
      growMs: regrowAt - now,
      effects: hybrid?.bonusEffect !== undefined ? [hybrid.bonusEffect] : [],
      mutationBoost: mutationSkillBonus(ledger) + weeklyModifier(now).mutationBonus,
      badLuck: wealthBadLuck(ledger.coins),
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
  if (tree.dead === true) return { ok: false, code: "PLANT_DEAD" };
  if (now < tree.readyAt) return { ok: false, code: "NOT_READY" };
  if (tree.growMs !== undefined && tree.watered !== true) return { ok: false, code: "NEEDS_WATER" };
  const definition = treeLikeById(tree.tree);
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
  const regrowAt =
    now +
    growTimeForEvents(
      definition,
      events,
      tree.fertilizer,
      dayPhaseAt(now).phase.growScale * growthScale(ledger, now),
    );
  next.trees[slot] = {
    slot,
    tree: tree.tree,
    plantedAt: now,
    readyAt: regrowAt,
    growMs: regrowAt - now,
    effects: [],
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

/**
 * @brief Waters one crop: growth only starts now, and the plant stops dying.
 * @details Unwatered plants never grow, so watering restarts the growth clock
 * from the full duration (minus the usual watering speed-up).
 */
function water(ledger: GardenLedger, slot: number, now: number): RuleResult {
  const plot = ledger.plots[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (plot.dead === true) return { ok: false, code: "PLANT_DEAD" };
  if (plot.watered) return { ok: false, code: "ALREADY_WATERED" };

  const next = clone(ledger);
  const growMs = plot.growMs ?? Math.max(1_000, plot.readyAt - plot.plantedAt);
  next.plots[slot] = {
    ...plot,
    readyAt: now + Math.max(1_000, Math.round(growMs * (1 - WATER_CUT_RATIO))),
    watered: true,
    effects: canonicalEffects([...plot.effects, "wet"]),
  };
  return changed(next, now);
}

/** @brief Waters one tree: growth only starts now, and the tree stops dying. */
function waterTree(ledger: GardenLedger, slot: number, now: number): RuleResult {
  const tree = ledger.trees[slot] ?? null;
  if (tree === null) return { ok: false, code: "PLOT_EMPTY" };
  if (tree.dead === true) return { ok: false, code: "PLANT_DEAD" };
  if (tree.watered) return { ok: false, code: "ALREADY_WATERED" };

  const next = clone(ledger);
  const growMs = tree.growMs ?? Math.max(1_000, tree.readyAt - tree.plantedAt);
  next.trees[slot] = {
    ...tree,
    readyAt: now + Math.max(1_000, Math.round(growMs * (1 - WATER_CUT_RATIO))),
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
  if (plant.dead === true) return { ok: false, code: "PLANT_DEAD" };
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
  if (plant.dead === true) return { ok: false, code: "PLANT_DEAD" };
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

/** @brief Buys mushroom spawn blocks at their fixed price. */
function buyMushroomSpawn(ledger: GardenLedger, mushroom: MushroomId, qty: number, now: number): RuleResult {
  const definition = mushroomById(mushroom);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  const total = definition.spawn * qty;
  if (ledger.coins < total) return { ok: false, code: "NOT_ENOUGH_COINS" };

  const next = clone(ledger);
  next.coins -= total;
  next.stats.spent += total;
  next.mushroomSpawn = {
    ...(next.mushroomSpawn ?? {}),
    [mushroom]: (next.mushroomSpawn?.[mushroom] ?? 0) + qty,
  };
  return changed(next, now);
}

/** @brief Plants one spawn block on an empty mushroom tray. */
function plantMushroom(ledger: GardenLedger, slot: number, mushroom: MushroomId, now: number): RuleResult {
  const definition = mushroomById(mushroom);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  if (slot < 0 || slot >= MUSHROOM_TRAYS) return { ok: false, code: "SLOT_OUT_OF_RANGE" };
  const trays = ledger.mushroomTrays ?? [];
  if ((trays[slot] ?? null) !== null) return { ok: false, code: "TRAY_OCCUPIED" };
  const owned = ledger.mushroomSpawn?.[mushroom] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SPAWN" };

  const next = clone(ledger);
  next.mushroomTrays = Array.from({ length: MUSHROOM_TRAYS }, (_unused, index) => {
    if (index === slot) {
      return { slot, mushroom, plantedAt: now, readyAt: now + mushroomGrowMs(definition) };
    }
    return next.mushroomTrays?.[index] ?? null;
  });
  const spawnCounts = { ...(next.mushroomSpawn ?? {}) };
  const left = owned - 1;
  if (left > 0) spawnCounts[mushroom] = left;
  else delete spawnCounts[mushroom];
  next.mushroomSpawn = spawnCounts;
  next.stats.planted += 1;
  grantXp(next, "farming", 20);
  return changed(next, now);
}

/** @brief Harvests one mushroom tray into a mutated product stack. */
function harvestMushroom(ledger: GardenLedger, slot: number, now: number, rng: () => number): RuleResult {
  const tray = ledger.mushroomTrays?.[slot] ?? null;
  if (tray === null) return { ok: false, code: "TRAY_EMPTY" };
  if (now < tray.readyAt) return { ok: false, code: "NOT_READY" };
  const definition = mushroomById(tray.mushroom);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };

  const next = clone(ledger);
  // One planting's worth of natural mutation rolls, boosted by prestige and pets.
  const bonus: Partial<Record<EffectId, number>> = { ...mutationChances(ledger) };
  const petMutation = petEffect(ledger, "mutation");
  if (petMutation > 0) {
    for (const effect of EFFECTS) {
      if (effect.natural) bonus[effect.id] = (bonus[effect.id] ?? 0) + petMutation;
    }
  }
  const calm: EventDefinition = { id: "calm", growScale: 1, sellBonus: 1, effectChances: {} };
  const effects = rollEffects(calm, rng, bonus);
  const star = rollCropQuality(ledger, `mushroom:${slot}`, false, false, false, SOIL_START, now);
  addProduct(next.bag.products, definition.product, star, definition.batch, effects);
  for (const effect of effects) collect(next, `effect:${effect}`);
  next.stats.harvested += definition.batch;
  grantXp(next, "farming", 50 + definition.batch * 2 + effects.length * 25);
  next.mushroomTrays = Array.from({ length: MUSHROOM_TRAYS }, (_unused, index) =>
    index === slot ? null : (next.mushroomTrays?.[index] ?? null),
  );
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
  if (tree.dead === true) return { ok: false, code: "PLANT_DEAD" };
  if (tree.growMs !== undefined && tree.watered !== true) return { ok: false, code: "NEEDS_WATER" };
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
        if (entry !== null && !entry.watered && entry.dead !== true) crops.push(slot);
      }
    }
  }
  const trees: number[] = [];
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const entry = ledger.trees[slot] ?? null;
    if (entry !== null && !entry.watered && entry.dead !== true) trees.push(slot);
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
        if (
          entry !== null &&
          entry.favorite !== true &&
          entry.watered === true &&
          entry.dead !== true &&
          now >= entry.readyAt
        )
          crops.push(slot);
      }
    }
  }
  const trees: number[] = [];
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const entry = ledger.trees[slot] ?? null;
    if (
      entry !== null &&
      entry.favorite !== true &&
      entry.watered === true &&
      entry.dead !== true &&
      now >= entry.readyAt
    )
      trees.push(slot);
  }
  // Bulk harvest also clears ripe mushroom trays: the quick action works across
  // the whole garden, not only the crop board.
  const mushrooms: number[] = [];
  for (let slot = 0; slot < MUSHROOM_TRAYS; slot += 1) {
    const tray = ledger.mushroomTrays?.[slot] ?? null;
    if (tray !== null && now >= tray.readyAt) mushrooms.push(slot);
  }
  const count = crops.length + trees.length + mushrooms.length;
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
  for (const slot of mushrooms) {
    const result = harvestMushroom(current, slot, now, rng);
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
  const cost = buildingUpgradeCost(building, level);
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
  collect(next, `animal:${animalId}`);
  if (definition.building === "pond") {
    collect(next, `fish:${animalId}`);
  }
  const anyAnimal = BUILDING_IDS.some((id) => next.animals[id].some((entry) => entry !== null));
  if (!anyAnimal) next.farmSettledAt = now;
  return changed(next, now);
}

/** @brief Pets one animal: quality grows with attention. */
function patAnimal(ledger: GardenLedger, building: BuildingId, slot: number, now: number): RuleResult {
  const animal = ledger.animals[building]?.[slot] ?? null;
  if (animal === null) return { ok: false, code: "SLOT_EMPTY" };
  if (now - (animal.lastPatAt ?? 0) < FARM_CYCLE_MS) return { ok: false, code: "TRY_LATER" };
  const next = clone(ledger);
  const pats = animal.pats + 1;
  const effects = canonicalEffects(animal.effects ?? []);
  // Petting is the mutation path for livestock. Each type can stack up to
  // MAX_EFFECT_STACK copies, so one animal can carry several mutations.
  const rng = createRng(hash32(`animalmut:${ledger.playerId}:${building}:${slot}:${pats}`));
  if (rng() < 0.08 + animalGeneMutation(animal)) {
    const pool = EFFECTS.filter((effect) => effect.natural);
    const picked = pool[Math.floor(rng() * pool.length)];
    if (picked !== undefined) effects.push(picked.id);
  }
  next.animals[building][slot] = {
    ...animal,
    pats,
    lastPatAt: now,
    ...(effects.length === 0 ? {} : { effects: canonicalEffects(effects) }),
  };
  grantXp(next, "ranching", 15);
  return changed(next, now);
}

/** @brief Keeps one egg warm so it hatches into a free coop slot. Pond fish breed automatically every 10 cycles. */
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
  const gross = Math.round(
    animalMeatPrice(animal.kind, animalQuality(animal, now), ledger.pondGrowth ?? 0, animal.hybridPrice) *
      weeklyModifier(now).sellScale,
  );
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
    productPrice(stack, season) *
      qty *
      (1 + petEffect(ledger, "sell")) *
      (1 + bonus) *
      pond *
      weeklyModifier(now).sellScale,
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

/** @brief First free, unlocked and undamaged crop cell, if any. */
function firstEmptyCropSlot(ledger: GardenLedger): number | null {
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    if ((ledger.plots[slot] ?? null) !== null) continue;
    if (!isCropPatchOpen(ledger, slot)) continue;
    if (ledger.damagedPlots?.[slot] === true) continue;
    return slot;
  }
  return null;
}

/**
 * @brief Quick Plan: buys the best-ROI seeds and fills every empty slot.
 * @details The plan is computed by the shared {@link planQuickPlan} helper, so
 * the client preview and this server run always agree. It fills crop cells,
 * free fruit-tree slots and empty mushroom trays, stopping when coins run out.
 */
function quickPlan(ledger: GardenLedger, season: SeasonSnapshot, now: number, rng: () => number): RuleResult {
  const preview = planQuickPlan({
    coins: ledger.coins,
    prestige: ledger.prestige,
    shopOffers: season.shop.offers,
    emptyCrops: ledger.plots.reduce<number>((count, plot, slot) => {
      if (plot !== null || !isCropPatchOpen(ledger, slot)) return count;
      if (ledger.damagedPlots?.[slot] === true) return count;
      return count + 1;
    }, 0),
    emptyTrees: ledger.trees.filter((tree) => tree === null).length,
    emptyTrays: (ledger.mushroomTrays ?? []).filter((tray) => tray === null).length,
  });

  let current = ledger;
  let planted = 0;

  for (const entry of preview.crops) {
    for (let placed = 0; placed < entry.qty; placed += 1) {
      const slot = firstEmptyCropSlot(current);
      if (slot === null) break;
      const bought = buySeed(current, entry.id as SeedId, 1, season, now);
      if (!bought.ok) break;
      const result = plant(bought.ledger, slot, entry.id as SeedId, now, rng);
      if (!result.ok) break;
      current = result.ledger;
      planted += 1;
    }
  }

  for (const entry of preview.trees) {
    for (let placed = 0; placed < entry.qty; placed += 1) {
      const slot = current.trees.findIndex((tree) => tree === null);
      if (slot < 0) break;
      const result = plantTree(current, slot, entry.id as TreeId, now, rng);
      if (!result.ok) break;
      current = result.ledger;
      planted += 1;
    }
  }

  for (const entry of preview.mushrooms) {
    for (let placed = 0; placed < entry.qty; placed += 1) {
      const slot = (current.mushroomTrays ?? []).findIndex((tray) => tray === null);
      if (slot < 0) break;
      let base = current;
      if ((base.mushroomSpawn?.[entry.id as MushroomId] ?? 0) < 1) {
        const bought = buyMushroomSpawn(base, entry.id as MushroomId, 1, now);
        if (!bought.ok) break;
        base = bought.ledger;
      }
      const result = plantMushroom(base, slot, entry.id as MushroomId, now);
      if (!result.ok) break;
      current = result.ledger;
      planted += 1;
    }
  }

  if (planted === 0) return { ok: false, code: "NOTHING_TO_DO" };
  return changed(current, now);
}
/**
 * @brief Kills plants left unwatered for a full day (24h).
 * @details Dead plants stay in the ground (nothing is lost) so the owner can
 * uproot them; they never grow and can never be harvested.
 */
export function settleThirst(ledger: GardenLedger, now: number): GardenLedger {
  let current = ledger;
  // The first thirst rule killed plants after one in-game day (~20 minutes), far
  // too harsh: on upgrade, revive everything it killed and stretch the window
  // to a full real day.
  if ((ledger.thirstVersion ?? 0) < THIRST_RULE_VERSION) {
    const migrated = clone(ledger);
    migrated.thirstVersion = THIRST_RULE_VERSION;
    migrated.plots = migrated.plots.map((plot) =>
      plot !== null && plot.dead === true ? { ...plot, dead: false, watered: true } : plot,
    );
    migrated.trees = migrated.trees.map((tree) =>
      tree !== null && tree.dead === true ? { ...tree, dead: false, watered: true } : tree,
    );
    current = migrated;
  }
  const thirsty = (entry: {
    plantedAt: number;
    watered: boolean;
    dead?: boolean;
    growMs?: number;
  }): boolean =>
    entry.dead !== true &&
    entry.growMs !== undefined &&
    entry.watered !== true &&
    now - entry.plantedAt >= PLANT_THIRST_MS;
  let changedAny = false;
  const next = clone(current);
  next.plots = next.plots.map((plot) => {
    if (plot === null || !thirsty(plot)) return plot;
    changedAny = true;
    return { ...plot, dead: true };
  });
  next.trees = next.trees.map((tree) => {
    if (tree === null || !thirsty(tree)) return tree;
    changedAny = true;
    return { ...tree, dead: true };
  });
  if (changedAny) return next;
  return current;
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
    const interval = Math.round(
      animalIntervalMs(entry.animal.kind) * (heated ? 0.8 : 1) * animalGeneSpeed(entry.animal),
    );
    const produced = Math.min(50, Math.floor((now - entry.animal.lastProduceAt) / interval));
    if (produced <= 0) continue;
    const star = animalQuality(entry.animal, now);
    addProduct(
      (next.bag.products ??= []),
      definition.product,
      star,
      produced * animalGeneYield(entry.animal),
      entry.animal.effects ?? [],
    );
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
      const rng = createRng(hash32(`genes:${ledger.playerId}:${building}:${slot}:${now}`));
      const gene = (value: number | undefined): number =>
        Math.max(0, Math.min(100, (value ?? 0) + Math.floor(rng() * 12) - 2));
      const genes: AnimalGenes = {
        yield: gene(animal.genes?.yield),
        speed: gene(animal.genes?.speed),
        mutation: gene(animal.genes?.mutation),
      };
      list[free] = { kind: animal.kind, bornAt: now, pats: 0, lastProduceAt: now, genes };
      list[slot] = { ...animal, incubatingUntil: 0 };
      grantXp(next, "ranching", 40);
    }
  }

  // Pond: rolls for reproduction in each 9-slot basin that has at least 2 fish and free slots.
  // Single species in the basin -> purebred spawn. Multiple species -> cross-breeding into AI hybrid.
  if (next.buildings.pond > 0) {
    const totalPondSlots = buildingSlots("pond", next.buildings.pond);
    const basins = Math.max(1, Math.floor(totalPondSlots / POND_MAX_SLOTS));
    const cycleStart = Math.floor(startedAt / FARM_CYCLE_MS);

    for (let step = 0; step < cycles; step += 1) {
      // Fish pond reproduction triggers automatically after every 10 cycles (POND_GROWTH_CYCLES = 10)
      if ((step + 1) % POND_GROWTH_CYCLES !== 0) continue;

      for (let k = 0; k < basins; k += 1) {
        const basin = inspectPondBasin(next.animals.pond ?? [], k);
        if (basin.fish.length < 2 || basin.freeSlots.length === 0) continue;

        const targetSlot = basin.freeSlots[0];
        if (targetSlot === undefined) continue;
        const bornAt = startedAt + (step + 1) * FARM_CYCLE_MS;
        const rng = createRng(hash32(`pond_birth:${ledger.playerId}:${cycleStart + step}:${k}`));

        if (basin.isPurebred) {
          const kind = basin.species[0] ?? "fish";
          next.animals.pond[targetSlot] = {
            kind,
            bornAt,
            pats: 0,
            lastProduceAt: bornAt,
          };
          collect(next, `animal:${kind}`);
          collect(next, `fish:${kind}`);
          logTimeline(next, "purchase", bornAt, { item: kind, qty: 1 });
        } else {
          // Cross-breeding: pick 2 distinct individual fish from the basin
          const fishList = basin.fish;
          const idxA = Math.floor(rng() * fishList.length);
          let idxB = Math.floor(rng() * (fishList.length - 1));
          if (idxB >= idxA) idxB += 1;

          const fishA = fishList[idxA] ?? fishList[0];
          const fishB = fishList[idxB] ?? fishList[1] ?? fishA;

          const seed = hash32(`pond_hybrid:${ledger.playerId}:${bornAt}:${targetSlot}`);
          const hybrid = generateDeterministicHybridFish(
            fishA?.kind ?? "carp",
            fishB?.kind ?? "sturgeon",
            seed,
            fishA,
            fishB,
          );

          next.animals.pond[targetSlot] = {
            ...hybrid.state,
            bornAt,
            lastProduceAt: bornAt,
          };
          collect(next, "animal:hybridFish");
          collect(next, `hybrid:${hybrid.id}`);
          logTimeline(next, "codex", bornAt, { item: hybrid.name, qty: 1 });
        }
      }
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

/** @brief Appends one owner-visible timeline event, capped at 100. */
function logTimeline(
  ledger: GardenLedger,
  kind: TimelineEvent["kind"],
  now: number,
  extra: Omit<TimelineEvent, "ts" | "kind"> = {},
): void {
  ledger.timeline = [...(ledger.timeline ?? []), { ts: now, kind, ...extra }].slice(-100);
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
      ledger.hybrids,
    );
  }
  for (const plot of ledger.greenhousePlots ?? []) {
    if (plot === null) continue;
    total += cropSellPrice(
      {
        item: plot.seed,
        effects: resolvedCropEffects(plot, now, true, true),
        pest: false,
        star: 1,
        qty: 1,
      },
      season,
      ledger.hybrids,
    );
  }
  for (const tree of ledger.trees) {
    if (tree === null) continue;
    total += cropSellPrice(
      { item: tree.tree, effects: resolvedTreeEffects(tree, now), pest: tree.pest, star: 1, qty: 1 },
      season,
      ledger.hybrids,
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
      ledger.hybrids,
    );
  }
  for (const building of BUILDING_IDS) {
    for (const animal of ledger.animals[building] ?? []) {
      if (animal === null) continue;
      total += animalMeatPrice(
        animal.kind,
        animalQuality(animal, now),
        ledger.pondGrowth ?? 0,
        animal.hybridPrice,
      );
    }
  }
  return total;
}

/** @brief Sells every held/queued machine input and clears the machines. */
function liquidateMachineInputs(ledger: GardenLedger, season: SeasonSnapshot): number {
  let total = 0;
  for (const [id, machine] of Object.entries(ledger.machines) as Array<[MachineId, MachineState]>) {
    const jobs: MachineJob[] = [];
    if (machine.job !== undefined) jobs.push(machine.job);
    for (const job of machine.queue ?? []) jobs.push(job);
    if (jobs.length === 0) continue;
    for (const job of jobs) {
      const effects = job.effects ?? [];
      if (productById(job.item) !== undefined) {
        total += productPrice(
          {
            product: job.item as ProductId,
            star: job.star ?? 1,
            qty: 1,
            effects,
          },
          season,
        );
      } else {
        total += cropSellPrice(
          {
            item: job.item as AnyItemId,
            star: job.star ?? 1,
            qty: 1,
            effects,
          },
          season,
          ledger.hybrids,
        );
      }
    }
    ledger.machines[id] = {
      ...machine,
      job: undefined,
      queue: [],
      lastCraftAt: 0,
    };
  }
  return total;
}

/** @brief Resets crops and animals for permanent prestige bonuses. */
function prestige(ledger: GardenLedger, season: SeasonSnapshot, now: number): RuleResult {
  if (ledger.stats.earned < prestigeRequirement(ledger.prestige)) {
    return { ok: false, code: "BAD_REQUEST" };
  }
  const next = clone(ledger);
  // Prestige sells machine inputs automatically, then converts the wallet plus
  // living garden and machine value into prestige coins.
  const machineValue = liquidateMachineInputs(next, season);
  const earned = Math.floor((liquidationValue(ledger, season, now) + machineValue) / PRESTIGE_COIN_VALUE);
  next.coins = 0;
  next.prestigeCoins = (next.prestigeCoins ?? 0) + earned;
  next.prestigeProgress = 0;
  // Only living things reset; machines, buildings, land, coins and staff stay.
  next.plots = next.plots.map(() => null);
  next.trees = next.trees.map(() => null);
  next.specialPlots = next.specialPlots.map(() => null);
  next.greenhousePlots = (next.greenhousePlots ?? []).map(() => null);
  next.animals = {
    coop: next.animals.coop.map(() => null),
    barn: next.animals.barn.map(() => null),
    pond: (next.animals.pond ?? []).map(() => null),
  };
  next.bag = {
    ...next.bag,
    seeds: { ...prestigeStarterSeeds(next.prestige) },
    crops: [],
  };
  next.stats = { ...next.stats, planted: 0, harvested: 0, earned: 0 };
  next.prestige = ledger.prestige + 1;
  next.questDay = wheelDayAt(now);
  logTimeline(next, "prestige", now, { qty: next.prestige });
  return changed(next, now);
}

/** @brief Plants an owned fruit seed in a fruit-tree plot. */
function plantFruitSeed(ledger: GardenLedger, slot: number, seedId: SeedId, now: number): RuleResult {
  if (slot >= ledger.trees.length) return { ok: false, code: "PLOT_LOCKED" };
  if (ledger.trees[slot] !== null) return { ok: false, code: "PLOT_OCCUPIED" };
  const seed = seedById(seedId);
  if (seed === undefined || seed.category !== "fruit") return { ok: false, code: "WRONG_AREA" };
  if ((ledger.bag.seeds[seed.id] ?? 0) < 1) return { ok: false, code: "NO_SEED" };
  if (prestigeTierForSeed(seed.id) > ledger.prestige) return { ok: false, code: "PRESTIGE_LOCKED" };
  const next = clone(ledger);
  next.bag.seeds[seed.id] = (next.bag.seeds[seed.id] ?? 0) - 1;
  const events = eventsAt(now);
  next.trees[slot] = {
    slot,
    tree: seed.id as unknown as TreeId,
    plantedAt: now,
    readyAt:
      now + growTimeForEvents(seed, events, null, dayPhaseAt(now).phase.growScale * growthScale(ledger, now)),
    effects: [],
    pest: false,
    protectedUntil: 0,
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
  };
  next.stats.planted += 1;
  logTimeline(next, "plant", now, { item: seed.id });
  return changed(next, now);
}

/** @brief Buys one sapling into the first free fruit-tree slot. */
function buyTree(
  ledger: GardenLedger,
  treeId: TreeId,
  wantedSlot: number | undefined,
  now: number,
): RuleResult {
  const slot = wantedSlot ?? ledger.trees.findIndex((tree) => tree === null);
  if (slot < 0) return { ok: false, code: "PLOT_LOCKED" };
  return plantTree(ledger, slot, treeId, now, createRng(hash32(`tree:${ledger.playerId}:${treeId}:${now}`)));
}

/** @brief Spends one free prestige point on a skill branch. */
function buyPrestigeSkill(ledger: GardenLedger, skill: PrestigeSkillId, now: number): RuleResult {
  const spent = Object.values(ledger.prestigeSkills).reduce((sum, points) => sum + points, 0);
  if (ledger.prestige - spent < 1) return { ok: false, code: "BAD_REQUEST" };
  const next = clone(ledger);
  next.prestigeSkills[skill] += 1;
  logTimeline(next, "skill", now, { item: skill });
  return changed(next, now);
}

/** @brief Refunds every prestige point for one prestige coin. */
function respecPrestige(ledger: GardenLedger, now: number): RuleResult {
  const spent = Object.values(ledger.prestigeSkills).reduce((sum, points) => sum + points, 0);
  if (spent < 1) return { ok: false, code: "NOTHING_TO_DO" };
  if ((ledger.prestigeCoins ?? 0) < 1) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.prestigeCoins -= 1;
  next.prestigeSkills = { merchant: 0, farmer: 0, artisan: 0 };
  return changed(next, now);
}

/** @brief Builds the warehouse kitchen required for custom recipes. */
function buildKitchen(ledger: GardenLedger, now: number): RuleResult {
  if (ledger.warehouse < 1) return { ok: false, code: "WAREHOUSE_LOCKED" };
  if (ledger.kitchen === true) return { ok: false, code: "ALREADY_CLAIMED" };
  if (ledger.coins < KITCHEN_PRICE) return { ok: false, code: "NOT_ENOUGH_COINS" };
  const next = clone(ledger);
  next.coins -= KITCHEN_PRICE;
  next.stats.spent += KITCHEN_PRICE;
  next.kitchen = true;
  logTimeline(next, "purchase", now, { item: "kitchen", coins: KITCHEN_PRICE });
  return changed(next, now);
}

/** @brief Cooks one learned custom recipe, consuming one of each input. */
function cookRecipe(ledger: GardenLedger, id: string, season: SeasonSnapshot, now: number): RuleResult {
  if (ledger.kitchen !== true) return { ok: false, code: "KITCHEN_LOCKED" };
  const recipe = (ledger.recipes ?? []).find((entry) => entry.id === id);
  if (recipe === undefined) return { ok: false, code: "BAD_REQUEST" };
  if (now - (ledger.recipeCookedAt?.[id] ?? 0) < DAY_MS) return { ok: false, code: "TRY_LATER" };
  const next = clone(ledger);
  let inputValue = 0;
  const inheritedEffects: EffectId[] = [];
  for (const ingredient of recipe.inputs) {
    const crop = next.bag.crops.find((stack) => stack.item === ingredient && stack.qty > 0);
    if (crop !== undefined) {
      inputValue += cropSellPrice(crop, season);
      inheritedEffects.push(...(crop.effects ?? []));
      next.bag.crops = next.bag.crops
        .map((stack) => (stack === crop ? { ...stack, qty: stack.qty - 1 } : stack))
        .filter((stack) => stack.qty > 0);
      continue;
    }
    const product = (next.bag.products ?? []).find((stack) => stack.product === ingredient && stack.qty > 0);
    if (product === undefined) return { ok: false, code: "NO_INPUT" };
    inputValue += productPrice(product, season);
    inheritedEffects.push(...(product.effects ?? []));
    next.bag.products = (next.bag.products ?? [])
      .map((stack) => (stack === product ? { ...stack, qty: stack.qty - 1 } : stack))
      .filter((stack) => stack.qty > 0);
  }
  // The dish is always worth more than its ingredients, and it keeps every
  // mutation from those ingredients via the combined effect multiplier.
  const mutationMultiplier = effectsMultiplier(canonicalEffects(inheritedEffects));
  const basePayout = Math.max(recipe.price, Math.ceil(inputValue * 1.1));
  const payout = Math.max(1, Math.min(5_000_000_000, Math.round(basePayout * mutationMultiplier)));
  next.coins += payout;
  next.stats.earned += payout;
  next.weekEarned += payout;
  next.recipeCookedAt = { ...(next.recipeCookedAt ?? {}), [id]: now };
  logTimeline(next, "craft", now, { item: recipe.output, coins: payout });
  return changed(next, now);
}

/** @brief Delivers the next permanent NPC story contract. */
function fulfillChain(ledger: GardenLedger, now: number): RuleResult {
  const step = CONTRACT_CHAIN[ledger.chainStep ?? 0];
  if (step === undefined) return { ok: false, code: "NOTHING_TO_DO" };
  let available = 0;
  for (const stack of ledger.bag.products ?? []) {
    if (stack.product === step.product && stack.star >= step.star) available += stack.qty;
  }
  if (available < step.qty) return { ok: false, code: "NO_PRODUCT" };
  const next = clone(ledger);
  let left = step.qty;
  next.bag.products = (next.bag.products ?? [])
    .map((stack) => {
      if (left <= 0 || stack.product !== step.product || stack.star < step.star) return stack;
      const take = Math.min(left, stack.qty);
      left -= take;
      return { ...stack, qty: stack.qty - take };
    })
    .filter((stack) => stack.qty > 0);
  next.coins += step.reward;
  next.stats.earned += step.reward;
  next.weekEarned += step.reward;
  next.chainStep = (ledger.chainStep ?? 0) + 1;
  logTimeline(next, "purchase", now, { item: step.id, coins: step.reward });
  return changed(next, now);
}

/** @brief Claims coins for every newly discovered codex entry. */
function claimCodex(ledger: GardenLedger, now: number): RuleResult {
  const fresh = ledger.collection.filter((key) => !ledger.codexClaimed.includes(key));
  if (fresh.length === 0) return { ok: false, code: "NOTHING_TO_DO" };
  const next = clone(ledger);
  let reward = 0;
  for (const key of fresh) {
    reward += codexReward(key);
    next.codexClaimed.push(key);
  }
  next.coins += reward;
  next.stats.earned += reward;
  next.weekEarned += reward;
  logTimeline(next, "codex", now, { qty: fresh.length, coins: reward });
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
    role: "harvest",
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

/** @brief Harvests every ripe crop and fruit for a worker in one run. */
function staffHarvest(ledger: GardenLedger, now: number, rng: () => number): GardenLedger | null {
  let current = ledger;
  let worked = false;
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    const plot = current.plots[slot] ?? null;
    if (plot === null || plot.favorite === true || now < plot.readyAt) continue;
    const result = applyGardenAction(
      current,
      { kind: "harvest", slot, tree: false, auto: true },
      seasonAt(now),
      now,
      rng,
    );
    if (result.ok) {
      current = result.ledger;
      worked = true;
    }
  }
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const tree = current.trees[slot] ?? null;
    if (tree === null || tree.favorite === true || now < tree.readyAt) continue;
    const result = applyGardenAction(
      current,
      { kind: "harvest", slot, tree: true, auto: true },
      seasonAt(now),
      now,
      rng,
    );
    if (result.ok) {
      current = result.ledger;
      worked = true;
    }
  }
  const ghLimit = greenhouseCapacity(current.greenhouse);
  for (let slot = 0; slot < ghLimit; slot += 1) {
    const plot = current.greenhousePlots?.[slot] ?? null;
    if (plot === null || plot.favorite === true || now < plot.readyAt) continue;
    const result = applyGardenAction(
      current,
      { kind: "harvestGreenhouse", slot, auto: true },
      seasonAt(now),
      now,
      rng,
    );
    if (result.ok) {
      current = result.ledger;
      worked = true;
    }
  }
  return worked ? current : null;
}

/** @brief Harvests every ripe mushroom tray for a worker in one run. */
function staffMushroomHarvest(ledger: GardenLedger, now: number, rng: () => number): GardenLedger | null {
  let current = ledger;
  let worked = false;
  for (let slot = 0; slot < MUSHROOM_TRAYS; slot += 1) {
    const tray = current.mushroomTrays?.[slot] ?? null;
    if (tray === null || now < tray.readyAt) continue;
    const definition = mushroomById(tray.mushroom);
    if (definition === undefined) continue;
    const next = clone(current);
    const calm: EventDefinition = { id: "calm", growScale: 1, sellBonus: 1, effectChances: {} };
    const effects = rollEffects(calm, rng, {});
    addProduct(next.bag.products, definition.product, 1, definition.batch, effects);
    for (const effect of effects) collect(next, `effect:${effect}`);
    next.stats.harvested += definition.batch;
    next.mushroomTrays = (next.mushroomTrays ?? []).map((entry, entrySlot) =>
      entrySlot === slot ? null : entry,
    );
    current = next;
    worked = true;
  }
  return worked ? current : null;
}

/** @brief Sells every crop stack priced well above base in one run. */
function staffSaleHunt(ledger: GardenLedger, now: number, _rng: () => number): GardenLedger | null {
  const season = seasonAt(now);
  let current = ledger;
  let worked = false;
  for (let guard = 0; guard < 200; guard += 1) {
    const stack = current.bag.crops.find((entry) => {
      if (entry.qty <= 0) return false;
      const hybrid = isHybridId(entry.item) ? current.hybrids?.find((h) => h.id === entry.item) : undefined;
      const base = hybrid !== undefined ? hybrid.sell : basePriceOf(entry.item as ItemId, season);
      if (base <= 0) return false;
      const unit = cropSellPrice(
        { item: entry.item, effects: entry.effects, pest: entry.pest, star: entry.star ?? 1, qty: 1 },
        season,
        current.hybrids,
      );
      return unit >= base * 1.25;
    });
    if (stack === undefined) break;
    const result = sellCrop(
      current,
      stack.item,
      stack.effects,
      stack.star ?? 1,
      stack.qty,
      stack.pest === true,
      season,
      now,
    );
    if (!result.ok) break;
    current = result.ledger;
    worked = true;
  }
  return worked ? current : null;
}

/** @brief Plants every owned seed into every free crop cell in one run. */
function staffPlant(ledger: GardenLedger, now: number, rng: () => number): GardenLedger | null {
  let current = ledger;
  let worked = false;
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    if ((current.plots[slot] ?? null) !== null) continue;
    if (!isCropPatchOpen(current, slot)) continue;
    if (current.damagedPlots?.[slot] === true) continue;
    const seed = SEEDS.find((entry) => (current.bag.seeds[entry.id] ?? 0) > 0);
    if (seed === undefined) break;
    const result = applyGardenAction(
      current,
      { kind: "plant", slot, seed: seed.id, auto: true },
      seasonAt(now),
      now,
      rng,
    );
    if (!result.ok) continue;
    current = result.ledger;
    worked = true;
  }
  const ghLimit = greenhouseCapacity(current.greenhouse);
  for (let slot = 0; slot < ghLimit; slot += 1) {
    if ((current.greenhousePlots?.[slot] ?? null) !== null) continue;
    const seed = SEEDS.find((entry) => (current.bag.seeds[entry.id] ?? 0) > 0);
    if (seed === undefined) break;
    const result = applyGardenAction(
      current,
      { kind: "plantGreenhouse", slot, seed: seed.id, auto: true },
      seasonAt(now),
      now,
      rng,
    );
    if (!result.ok) continue;
    current = result.ledger;
    worked = true;
  }
  return worked ? current : null;
}

/** @brief Waters every dry plant for a worker in one run. */
function staffWater(ledger: GardenLedger, now: number, rng: () => number): GardenLedger | null {
  let current = ledger;
  let worked = false;
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    const plot = current.plots[slot] ?? null;
    if (plot === null || plot.watered || plot.dead === true) continue;
    const result = applyGardenAction(
      current,
      { kind: "water", slot, tree: false, auto: true },
      seasonAt(now),
      now,
      rng,
    );
    if (result.ok) {
      current = result.ledger;
      worked = true;
    }
  }
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const tree = current.trees[slot] ?? null;
    if (tree === null || tree.watered || tree.dead === true) continue;
    const result = applyGardenAction(
      current,
      { kind: "water", slot, tree: true, auto: true },
      seasonAt(now),
      now,
      rng,
    );
    if (result.ok) {
      current = result.ledger;
      worked = true;
    }
  }
  return worked ? current : null;
}

/**
 * @brief Automates mining chores for an assigned staff member.
 * @details Clears every remaining rock, ore, gem, and chest on the current mine
 * floor in a single turn, collects all drops and chest coins into the ledger,
 * and descends to the next floor whenever a ladder is visible or uncovered.
 * @param ledger Garden before mining action.
 * @param now Current server timestamp.
 * @param _rng Deterministic random generator.
 * @return Updated GardenLedger if work occurred, or null if idle.
 */
function staffMine(ledger: GardenLedger, now: number, _rng: () => number): GardenLedger | null {
  const next = clone(ledger);
  const mine = ensureMineState(next, now);
  next.mine = mine;

  const earthDragon = (next.equippedRelics ?? []).includes("earthDragon");
  const passes = earthDragon ? 2 : 1;
  let worked = false;

  for (let pass = 0; pass < passes; pass += 1) {
    // 1. Mine every intact rock/ore/chest on the current floor in one turn.
    for (let i = 0; i < mine.grid.length; i += 1) {
      const cell = mine.grid[i];
      if (!cell || cell.kind === "empty" || cell.kind === "ladder") continue;

      worked = true;
      if (cell.kind === "chest") {
        const bonusCoins = 1_000 * Math.max(1, Math.floor(mine.currentFloor / 5));
        next.coins += bonusCoins;
        next.stats.earned += bonusCoins;
        addProduct(next.bag.products, "coal", 1, 3);
        collect(next, "product:coal");
      } else if (cell.oreDrop) {
        const baseQty = cell.dropQty ?? 1;
        const qty = earthDragon ? Math.ceil(baseQty * 1.5) : baseQty;
        addProduct(next.bag.products, cell.oreDrop, 1, qty);
        collect(next, `product:${cell.oreDrop}`);
      }

      mine.grid[i] = cell.hasLadder
        ? { kind: "ladder", hp: 0, maxHp: 0 }
        : { kind: "empty", hp: 0, maxHp: 0 };
    }

    // 2. Descend to the next floor if a ladder is already visible or just uncovered.
    const hasLadder = mine.grid.some((c) => c.kind === "ladder");
    if (hasLadder) {
      worked = true;
      const nextFloor = mine.currentFloor + 1;
      mine.currentFloor = nextFloor;
      mine.maxFloor = Math.max(mine.maxFloor, nextFloor);
      const floorSeed = hash32(`${next.playerId}:${nextFloor}:${now}`);
      mine.grid = [...generateMineFloor(nextFloor, floorSeed)];
    } else {
      break;
    }
  }

  return worked ? next : null;
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

    if (now - worker.lastWorkAt < staffWorkIntervalMs(worker)) continue;

    // One finished task per due turn: the wait between turns is decided by the
    // worker's quality, not by a jobs-per-cycle count.
    const rng = createRng(hash32(`staffwork:${worker.id}:${worker.lastWorkAt}:${now}`));
    let worked: GardenLedger = current;
    let tasks = 0;
    const lazy = worker.traits.includes("lazy") && rng() < 0.2;
    if (!lazy) {
      const chore = (base: GardenLedger): GardenLedger | null => {
        switch (worker.role) {
          case "water":
            return staffWater(base, now, rng);
          case "plant":
            return staffPlant(base, now, rng);
          case "harvest":
            return staffHarvest(base, now, rng);
          case "harvestMushroom":
            return staffMushroomHarvest(base, now, rng);
          case "saleHunt":
            return staffSaleHunt(base, now, rng);
          case "mine":
            return staffMine(base, now, rng);
        }
      };
      const next = chore(worked);
      if (next !== null) {
        worked = next;
        tasks = 1;
      }
    }

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

/* ------------------------------------------------------------------ mine */

/**
 * @brief Ensures the mine state exists and regenerates player stamina.
 * @details Every 30 seconds of elapsed time restores +1 stamina point.
 * @param ledger Stored garden ledger.
 * @param now Current server timestamp.
 * @return Deep-cloned or initialized MineState with updated stamina.
 */
function ensureMineState(ledger: GardenLedger, now: number): LedgerMineState {
  const base = ledger.mine ?? initialMineState(now);
  const mine: LedgerMineState = {
    currentFloor: base.currentFloor,
    maxFloor: base.maxFloor,
    pickaxeLevel: base.pickaxeLevel,
    stamina: base.stamina,
    maxStamina: base.maxStamina,
    lastStaminaAt: base.lastStaminaAt,
    grid: base.grid.map((cell) => ({ ...cell })),
    assignedStaffSlot: base.assignedStaffSlot,
  };

  if (mine.stamina < mine.maxStamina && mine.lastStaminaAt > 0) {
    const elapsed = Math.max(0, now - mine.lastStaminaAt);
    const regen = Math.floor(elapsed / 30_000);
    if (regen > 0) {
      mine.stamina = Math.min(mine.maxStamina, mine.stamina + regen);
      mine.lastStaminaAt = mine.stamina >= mine.maxStamina ? now : mine.lastStaminaAt + regen * 30_000;
    }
  } else if (mine.stamina >= mine.maxStamina) {
    mine.lastStaminaAt = now;
  }

  return mine;
}

/**
 * @brief Executes a manual pickaxe strike against a rock cell in the mine.
 * @details Deducts 2 stamina, deals pickaxe damage, and reveals ladders or drops.
 * @param ledger Garden before strike.
 * @param slot Index of the target rock (0..24).
 * @param now Current server timestamp.
 * @param _rng Deterministic random generator.
 * @return RuleResult indicating success or failure.
 */
function mineHit(ledger: GardenLedger, slot: number, now: number, _rng: () => number): RuleResult {
  if (slot < 0 || slot >= MINE_FLOOR_CELLS) return { ok: false, code: "BAD_REQUEST" };

  const next = clone(ledger);
  const mine = ensureMineState(next, now);
  next.mine = mine;

  if (mine.stamina < 2) return { ok: false, code: "NO_STAMINA" };

  const cell = mine.grid[slot];
  if (!cell || cell.kind === "empty" || cell.kind === "ladder") {
    return { ok: false, code: "ROCK_EMPTY" };
  }

  mine.stamina -= 2;
  mine.lastStaminaAt = now;

  const tier = PICKAXE_TIERS[mine.pickaxeLevel] ?? (PICKAXE_TIERS[0] as PickaxeTier);
  const dmg = tier.damage;
  const nextHp = Math.max(0, cell.hp - dmg);

  if (nextHp > 0) {
    mine.grid[slot] = { ...cell, hp: nextHp };
  } else {
    if (cell.kind === "chest") {
      const bonusCoins = 1_000 * Math.max(1, Math.floor(mine.currentFloor / 5));
      next.coins += bonusCoins;
      next.stats.earned += bonusCoins;
      addProduct(next.bag.products, "coal", 1, 3);
      collect(next, "product:coal");
    } else if (cell.oreDrop) {
      addProduct(next.bag.products, cell.oreDrop, 1, cell.dropQty ?? 1);
      collect(next, `product:${cell.oreDrop}`);
    }
    mine.grid[slot] = cell.hasLadder
      ? { kind: "ladder", hp: 0, maxHp: 0 }
      : { kind: "empty", hp: 0, maxHp: 0 };
  }

  return { ok: true, ledger: next, changed: true };
}

/**
 * @brief Descends to the next deeper mine floor via an exposed ladder.
 * @param ledger Garden before descent.
 * @param now Current server timestamp.
 * @param _rng Deterministic random generator.
 * @return RuleResult indicating success or failure.
 */
function mineDescend(ledger: GardenLedger, now: number, _rng: () => number): RuleResult {
  const next = clone(ledger);
  const mine = ensureMineState(next, now);
  next.mine = mine;

  const hasLadder = mine.grid.some((c) => c.kind === "ladder");
  if (!hasLadder) return { ok: false, code: "LADDER_LOCKED" };

  const nextFloor = mine.currentFloor + 1;
  mine.currentFloor = nextFloor;
  mine.maxFloor = Math.max(mine.maxFloor, nextFloor);
  const floorSeed = hash32(`${next.playerId}:${nextFloor}:${now}`);
  mine.grid = [...generateMineFloor(nextFloor, floorSeed)];

  return { ok: true, ledger: next, changed: true };
}

/**
 * @brief Fast-travels to an unlocked checkpoint elevator floor.
 * @param ledger Garden before fast travel.
 * @param targetFloor Selected checkpoint floor depth.
 * @param now Current server timestamp.
 * @param _rng Deterministic random generator.
 * @return RuleResult indicating success or failure.
 */
function mineElevator(
  ledger: GardenLedger,
  targetFloor: number,
  now: number,
  _rng: () => number,
): RuleResult {
  const next = clone(ledger);
  const mine = ensureMineState(next, now);
  next.mine = mine;

  const checkpoints = mineElevatorCheckpoints(mine.maxFloor);
  if (!checkpoints.includes(targetFloor)) return { ok: false, code: "FLOOR_LOCKED" };

  mine.currentFloor = targetFloor;
  const floorSeed = hash32(`${next.playerId}:${targetFloor}:${now}`);
  mine.grid = [...generateMineFloor(targetFloor, floorSeed)];

  return { ok: true, ledger: next, changed: true };
}

/**
 * @brief Upgrades player pickaxe to the next tier using smelted metal bars and coins.
 * @param ledger Garden before upgrade.
 * @param now Current server timestamp.
 * @return RuleResult indicating success or failure.
 */
function upgradePickaxe(ledger: GardenLedger, now: number): RuleResult {
  const next = clone(ledger);
  const mine = ensureMineState(next, now);
  next.mine = mine;

  const currentTier = mine.pickaxeLevel;
  if (currentTier >= PICKAXE_TIERS.length - 1) return { ok: false, code: "MAX_PICKAXE" };

  const nextTier = PICKAXE_TIERS[currentTier + 1];
  if (!nextTier) return { ok: false, code: "MAX_PICKAXE" };

  if (next.coins < nextTier.cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  if (nextTier.barType && nextTier.barCount) {
    let availableBars = 0;
    for (const stack of next.bag.products) {
      if (stack.product === nextTier.barType) availableBars += stack.qty;
    }
    if (availableBars < nextTier.barCount) return { ok: false, code: "NO_BARS" };

    let needed = nextTier.barCount;
    next.bag.products = next.bag.products
      .map((stack) => {
        if (needed <= 0 || stack.product !== nextTier.barType) return stack;
        const take = Math.min(needed, stack.qty);
        needed -= take;
        return { ...stack, qty: stack.qty - take };
      })
      .filter((stack) => stack.qty > 0);
  }

  next.coins -= nextTier.cost;
  next.stats.spent += nextTier.cost;
  mine.pickaxeLevel += 1;

  return { ok: true, ledger: next, changed: true };
}

/**
 * @brief Consumes a food product from the warehouse bag to replenish stamina.
 * @param ledger Garden before consuming.
 * @param item Product identifier consumed.
 * @param now Current server timestamp.
 * @return RuleResult indicating success or failure.
 */
function mineEat(ledger: GardenLedger, item: ProductId, now: number): RuleResult {
  const next = clone(ledger);
  const mine = ensureMineState(next, now);
  next.mine = mine;

  if (mine.stamina >= mine.maxStamina) return { ok: false, code: "NOTHING_TO_DO" };

  const stackIndex = next.bag.products.findIndex((s) => s.product === item && s.qty > 0);
  if (stackIndex < 0) return { ok: false, code: "NO_PRODUCT" };

  const stack = next.bag.products[stackIndex];
  if (!stack) return { ok: false, code: "NO_PRODUCT" };

  if (stack.qty <= 1) {
    next.bag.products.splice(stackIndex, 1);
  } else {
    next.bag.products[stackIndex] = { ...stack, qty: stack.qty - 1 };
  }

  const def = productById(item);
  const restore = Math.max(10, Math.min(50, Math.floor((def?.base ?? 50) / 10)));
  mine.stamina = Math.min(mine.maxStamina, mine.stamina + restore);

  return { ok: true, ledger: next, changed: true };
}

/**
 * @brief Assigns or unassigns a hired staff member to the dedicated mine slot.
 * @param ledger Garden before assignment.
 * @param staffSlot Index of the staff member in ledger.staff, or null to unassign.
 * @param now Current server timestamp.
 * @return RuleResult indicating success or failure.
 */
function assignMiner(ledger: GardenLedger, staffSlot: number | null, now: number): RuleResult {
  const next = clone(ledger);
  const mine = ensureMineState(next, now);
  next.mine = mine;

  if (staffSlot !== null) {
    if (staffSlot < 0 || staffSlot >= next.staff.length) {
      return { ok: false, code: "SLOT_OUT_OF_RANGE" };
    }
    const currentWorker = next.staff[staffSlot];
    if (!currentWorker) return { ok: false, code: "SLOT_OUT_OF_RANGE" };

    next.staff[staffSlot] = { ...currentWorker, role: "mine" };
    mine.assignedStaffSlot = staffSlot;
  } else {
    mine.assignedStaffSlot = null;
  }

  return { ok: true, ledger: next, changed: true };
}

/**
 * @brief Crafts a mine relic from coins and smelted bars/gems.
 * @param ledger Current garden ledger.
 * @param relicId Target relic identifier.
 * @param now Current server timestamp.
 * @return RuleResult with the newly crafted relic added and auto-equipped if space remains.
 */
function craftRelic(ledger: GardenLedger, relicId: RelicId, now: number): RuleResult {
  const def = relicById(relicId);
  if (def === undefined) return { ok: false, code: "BAD_REQUEST" };
  const owned = ledger.relics ?? [];
  if (owned.includes(relicId)) return { ok: false, code: "ALREADY_CLAIMED" };
  if (ledger.coins < def.costCoins) return { ok: false, code: "NOT_ENOUGH_COINS" };

  for (const [productId, needed] of Object.entries(def.materials) as Array<[ProductId, number]>) {
    const have = ledger.bag.products
      .filter((s) => s.product === productId)
      .reduce((sum, s) => sum + s.qty, 0);
    if (have < needed) return { ok: false, code: "NO_BARS" };
  }

  const next = clone(ledger);
  next.coins -= def.costCoins;
  next.stats.spent += def.costCoins;
  for (const [productId, needed] of Object.entries(def.materials) as Array<[ProductId, number]>) {
    let left = needed;
    next.bag.products = next.bag.products
      .map((stack) => {
        if (left <= 0 || stack.product !== productId) return stack;
        const take = Math.min(left, stack.qty);
        left -= take;
        return { ...stack, qty: stack.qty - take };
      })
      .filter((stack) => stack.qty > 0);
  }
  next.relics = [...(next.relics ?? []), relicId];
  const equipped = [...(next.equippedRelics ?? [])];
  if (equipped.length < MAX_EQUIPPED_RELICS && !equipped.includes(relicId)) {
    equipped.push(relicId);
  }
  next.equippedRelics = equipped;
  return changed(next, now);
}

/**
 * @brief Toggles equipping or unequipping an owned mine relic (up to 3 active).
 * @param ledger Current garden ledger.
 * @param relicId Target relic identifier.
 * @param now Current server timestamp.
 * @return RuleResult with updated equippedRelics.
 */
function equipRelic(ledger: GardenLedger, relicId: RelicId, now: number): RuleResult {
  if (!(ledger.relics ?? []).includes(relicId)) return { ok: false, code: "RELIC_LOCKED" };
  const next = clone(ledger);
  const equipped = [...(next.equippedRelics ?? [])];
  const idx = equipped.indexOf(relicId);
  if (idx >= 0) {
    equipped.splice(idx, 1);
  } else {
    if (equipped.length >= MAX_EQUIPPED_RELICS) return { ok: false, code: "MAX_RELICS" };
    equipped.push(relicId);
  }
  next.equippedRelics = equipped;
  return changed(next, now);
}

/**
 * @brief Triggers the active skill of the currently equipped pet (requires Lv >= 2, 30m cooldown).
 * @param ledger Current garden ledger.
 * @param now Current server timestamp.
 * @return RuleResult applying a 10-minute growth surge and pest shield across active crops.
 */
function usePetSkill(ledger: GardenLedger, now: number): RuleResult {
  const petId = ledger.equippedPet;
  if (petId === null) return { ok: false, code: "NO_PET" };
  const level = ledger.pets[petId] ?? 0;
  if (level < 2) return { ok: false, code: "NO_PET" };
  const lastAt = ledger.petSkillAt ?? 0;
  if (now - lastAt < PET_SKILL_COOLDOWN_MS) return { ok: false, code: "SKILL_COOLDOWN" };

  const next = clone(ledger);
  const boostMs = 10 * 60_000;
  const shieldUntil = now + 30 * 60_000;
  next.plots = next.plots.map((plot) =>
    plot === null || plot.dead
      ? plot
      : {
          ...plot,
          readyAt: Math.max(now, plot.readyAt - boostMs),
          protectedUntil: Math.max(plot.protectedUntil, shieldUntil),
          pest: false,
        },
  );
  next.greenhousePlots = (next.greenhousePlots ?? []).map((plot) =>
    plot === null
      ? null
      : {
          ...plot,
          readyAt: Math.max(now, plot.readyAt - boostMs),
        },
  );
  next.petSkillAt = now;
  return changed(next, now);
}

/**
 * @brief Sends an owned, non-equipped pet on a timed expedition for rare loot.
 * @param ledger Current garden ledger.
 * @param petId Pet sent on expedition.
 * @param durationMin Expedition duration in minutes (15 or 30).
 * @param now Current server timestamp.
 * @return RuleResult adding the new PetExpeditionState.
 */
function startPetExpedition(
  ledger: GardenLedger,
  petId: PetId,
  durationMin: 15 | 30,
  now: number,
): RuleResult {
  if ((ledger.pets[petId] ?? 0) < 1) return { ok: false, code: "NO_PET" };
  if (ledger.equippedPet === petId) return { ok: false, code: "PET_BUSY" };
  const active = ledger.petExpeditions ?? [];
  if (active.some((entry) => entry.pet === petId)) return { ok: false, code: "PET_BUSY" };

  const next = clone(ledger);
  const durationMs = durationMin * 60_000;
  const id = `exp:${petId}:${now}`;
  next.petExpeditions = [
    ...active,
    {
      id,
      pet: petId,
      startedAt: now,
      endsAt: now + durationMs,
      durationMin,
    },
  ];
  return changed(next, now);
}

/**
 * @brief Claims rewards from a finished pet expedition.
 * @param ledger Current garden ledger.
 * @param id Expedition identifier.
 * @param now Current server timestamp.
 * @param rng Deterministic random generator.
 * @return RuleResult awarding coins, ores/coal, and rare seeds.
 */
function claimPetExpedition(ledger: GardenLedger, id: string, now: number, rng: () => number): RuleResult {
  const expeditions = ledger.petExpeditions ?? [];
  const exp = expeditions.find((entry) => entry.id === id);
  if (exp === undefined) return { ok: false, code: "BAD_REQUEST" };
  if (now < exp.endsAt) return { ok: false, code: "EXPEDITION_NOT_READY" };

  const next = clone(ledger);
  const petLevel = Math.max(1, next.pets[exp.pet] ?? 1);
  const mult = (exp.durationMin === 30 ? 2 : 1) * (1 + (petLevel - 1) * 0.25);
  const coinReward = Math.round(25_000 * mult);
  next.coins += coinReward;
  next.stats.earned += coinReward;

  const rareSeeds = SEEDS.filter((s) => s.rare === true && s.prestigeOnly !== true);
  if (rareSeeds.length > 0) {
    const picked = rareSeeds[Math.floor(rng() * rareSeeds.length)];
    if (picked !== undefined) {
      next.bag.seeds[picked.id] = (next.bag.seeds[picked.id] ?? 0) + 1;
    }
  }
  const oreQty = Math.max(1, Math.round(2 * mult));
  addProduct(next.bag.products, exp.durationMin === 30 ? "goldOre" : "ironOre", 1, oreQty);
  next.petExpeditions = expeditions.filter((entry) => entry.id !== id);
  return changed(next, now);
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

  // Mine state initialization & stamina passive regeneration.
  if (next.mine) {
    const mine = ensureMineState(next, now);
    if (mine.stamina !== next.mine.stamina || mine.lastStaminaAt !== next.mine.lastStaminaAt) {
      next.mine = mine;
      changedAny = true;
    }
  } else {
    next.mine = initialMineState(now) as unknown as LedgerMineState;
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
  collect(next, `machine:${id}`);
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
  item: AnyItemId | undefined,
  hybrids?: readonly HybridSeed[],
): { key: AnyItemId; sell: number } | null {
  const seed = item === undefined ? undefined : resolveSeed(item, hybrids);
  const fruit = item === undefined ? undefined : treeById(item);
  if (definition.output.kind === "seeds" && seed === undefined) return null;
  if (definition.allProduce === true) {
    if (seed === undefined && fruit === undefined) return null;
  } else if (seed === undefined) {
    return null;
  }
  const key = (seed !== undefined ? item : fruit?.id) as AnyItemId | undefined;
  if (key === undefined) return null;
  const allowed = definition.input.kind === "seedCrop" ? definition.input.seeds : undefined;
  if (allowed !== undefined && !allowed.includes(key as never)) return null;
  return { key, sell: seed?.sell ?? fruit?.sell ?? 0 };
}

/** One input already removed from the bag and held by a machine. */
interface MachineHold {
  key: AnyItemId | ProductId;
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
function recipeOutputFor(definition: MachineDefinition, key: AnyItemId | ProductId): ProductId | undefined {
  const recipe = productRecipes(definition).find((entry) => entry.input === key);
  if (recipe !== undefined) return recipe.output;
  return definition.output.kind === "product" ? definition.output.product : undefined;
}

/** @brief Removes one input from the bag for a machine. */
function takeMachineInput(
  next: GardenLedger,
  definition: MachineDefinition,
  item: AnyItemId | ProductId | undefined,
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
  const candidate =
    item ?? next.bag.crops.find((entry) => machineInput(definition, entry.item, next.hybrids) !== null)?.item;
  const input = machineInput(definition, candidate as AnyItemId | undefined, next.hybrids);
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
  const seed = resolveSeed(hold.key, next.hybrids);
  if (seed === undefined) return 0;
  if (roll() >= seedMakerChance(next.prestige)) return 0;
  const qty = Math.max(1, Math.round(seedMakerOutput(level) * (1 + bonus)));
  const targetId = hold.key as AnySeedId;
  next.bag.seeds[targetId] = (next.bag.seeds[targetId] ?? 0) + qty;
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
    const relicScale = (next.equippedRelics ?? []).includes("crystalCharm") ? 0.75 : 1;
    const cycles = Math.round(
      machineCycles(machine.level, definition.cooldownCycles) * FARM_CYCLE_MS * relicScale,
    );
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
      const relicScale = (current.equippedRelics ?? []).includes("crystalCharm") ? 0.75 : 1;
      const cycles = Math.round(
        machineCycles(machine.level, definition.cooldownCycles) * FARM_CYCLE_MS * relicScale,
      );
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
  item: AnyItemId | ProductId | undefined,
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
  item: AnyItemId | ProductId | undefined,
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
  item: AnyItemId,
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
    cropSellPrice(stack, season, ledger.hybrids) *
      (1 + petEffect(ledger, "sell")) *
      (1 + farmingSellBonus(ledger.skills.farming.level)) *
      sellMultiplier(ledger, now),
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
  recordSale(next, { kind: "crop", item: item as ItemId, qty, star, effects, gross, net: gross - tax }, now);
  return changed(next, now);
}

/** @brief Sells every harvested stack. */
function sellAll(ledger: GardenLedger, season: SeasonSnapshot, now: number): RuleResult {
  if (ledger.bag.crops.length === 0) return { ok: false, code: "NOTHING_TO_SELL" };
  const next = clone(ledger);
  let total = 0;
  for (const stack of next.bag.crops) {
    const base = Math.round(
      cropSellPrice(stack, season, ledger.hybrids) *
        (1 + petEffect(ledger, "sell")) *
        (1 + farmingSellBonus(ledger.skills.farming.level)) *
        sellMultiplier(ledger, now),
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
        item: stack.item as ItemId,
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
  logTimeline(ledger, "sale", now, {
    item: entry.item,
    qty: entry.qty,
    coins: entry.net,
  });
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
    greenhousePlots: Array.from({ length: GREENHOUSE_SLOTS }, (_unused, index) => {
      const plot = ledger.greenhousePlots?.[index] ?? null;
      return plot === null ? null : { ...plot };
    }),
    hybrids: (ledger.hybrids ?? []).map((hybrid) => ({ ...hybrid, parents: [...hybrid.parents] })),
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
    mine: ledger.mine
      ? {
          currentFloor: ledger.mine.currentFloor,
          maxFloor: ledger.mine.maxFloor,
          pickaxeLevel: ledger.mine.pickaxeLevel,
          stamina: ledger.mine.stamina,
          maxStamina: ledger.mine.maxStamina,
          lastStaminaAt: ledger.mine.lastStaminaAt,
          grid: ledger.mine.grid.map((cell) => ({ ...cell })),
          assignedStaffSlot: ledger.mine.assignedStaffSlot,
        }
      : undefined,
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
    relics: [...(ledger.relics ?? [])],
    equippedRelics: [...(ledger.equippedRelics ?? [])],
    petExpeditions: (ledger.petExpeditions ?? []).map((entry) => ({ ...entry })),
    petSkillAt: ledger.petSkillAt ?? 0,
    stocks: Object.fromEntries(
      Object.entries(ledger.stocks ?? {}).map(([sym, holding]) => [sym, { ...holding }]),
    ),
  };
}

/** @brief Whether two effect lists are the same mutation set. */
function sameEffects(left: readonly EffectId[], right: readonly EffectId[]): boolean {
  const a = canonicalEffects(left).join(":");
  const b = canonicalEffects(right).join(":");
  return a === b;
}

/** @brief Checks whether a greenhouse slot index is valid and unlocked by level. */
function greenhouseSlotOpen(ledger: GardenLedger, slot: number): boolean {
  return (
    Number.isInteger(slot) &&
    slot >= 0 &&
    slot < GREENHOUSE_SLOTS &&
    slot < greenhouseCapacity(ledger.greenhouse)
  );
}

/**
 * @brief Plants one seed in an unlocked greenhouse slot (auto-watered, highquality x3, immune).
 * @param ledger Current garden ledger.
 * @param slot Target slot index (`0..GREENHOUSE_SLOTS-1`).
 * @param seedId Seed or custom hybrid seed id.
 * @param now Server-clock timestamp.
 * @param _rng Deterministic RNG source.
 * @return Next ledger on success or validation error.
 */
function plantGreenhouse(
  ledger: GardenLedger,
  slot: number,
  seedId: AnySeedId,
  now: number,
  _rng: () => number,
): RuleResult {
  if (ledger.greenhouse <= 0) return { ok: false, code: "GREENHOUSE_LOCKED" };
  if (!greenhouseSlotOpen(ledger, slot)) return { ok: false, code: "PLOT_LOCKED" };
  if ((ledger.greenhousePlots?.[slot] ?? null) !== null) return { ok: false, code: "PLOT_OCCUPIED" };
  const seed = resolveSeed(seedId, ledger.hybrids);
  if (seed === undefined) return { ok: false, code: "NO_SEED" };
  if (!isHybridId(seedId) && prestigeTierForSeed(seed.id) > ledger.prestige) {
    return { ok: false, code: "PRESTIGE_LOCKED" };
  }
  if (seed.category === "fruit") return { ok: false, code: "WRONG_AREA" };
  const owned = ledger.bag.seeds[seedId] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SEED" };

  const hybrid = isHybridId(seedId) ? ledger.hybrids?.find((entry) => entry.id === seedId) : undefined;
  const next = clone(ledger);
  next.bag.seeds[seedId] = owned - 1;
  const events = eventsAt(now);
  const rawGrowMs = growTimeForEvents(
    seed,
    events,
    null,
    dayPhaseAt(now).phase.growScale * growthScale(ledger, now),
  );
  const wateredGrowMs = Math.max(5_000, Math.round(rawGrowMs * (1 - WATER_CUT_RATIO)));
  const effects: EffectId[] = [GREENHOUSE_MUTATION];
  if (hybrid?.bonusEffect !== undefined) effects.push(hybrid.bonusEffect);
  next.greenhousePlots = Array.from({ length: GREENHOUSE_SLOTS }, (_unused, index) => {
    if (index !== slot) return next.greenhousePlots?.[index] ?? null;
    return {
      slot,
      seed: seedId,
      plantedAt: now,
      readyAt: now + wateredGrowMs,
      growMs: wateredGrowMs,
      effects: canonicalEffects(effects.filter((id) => !BAD_MUTATIONS.has(id))),
      pest: false,
      protectedUntil: Number.MAX_SAFE_INTEGER,
      watered: true,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
    };
  });
  next.stats.planted += 1;
  logTimeline(next, "plant", now, { item: seedId });
  return changed(next, now);
}

/**
 * @brief Harvests one ripe crop from a greenhouse slot, guaranteeing `highquality` x3 value and pest immunity.
 * @param ledger Current garden ledger.
 * @param slot Target greenhouse slot.
 * @param now Server-clock timestamp.
 * @param rng Deterministic RNG source.
 * @param auto Whether invoked by staff or bulk automation.
 * @return Next ledger on success or error.
 */
function harvestGreenhouse(
  ledger: GardenLedger,
  slot: number,
  now: number,
  rng: () => number,
  auto = false,
): RuleResult {
  if (ledger.greenhouse <= 0) return { ok: false, code: "GREENHOUSE_LOCKED" };
  if (!greenhouseSlotOpen(ledger, slot)) return { ok: false, code: "PLOT_LOCKED" };
  const plot = ledger.greenhousePlots?.[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (plot.favorite === true && !auto) return { ok: false, code: "FAVORITE_LOCKED" };
  if (auto && plot.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
  if (now < plot.readyAt) return { ok: false, code: "NOT_READY" };

  const next = clone(ledger);
  const harvestedEffects = resolvedCropEffects(plot, now, true, true);
  const star = rollCropQuality(
    ledger,
    `gh:${slot}`,
    plot.fertilizer !== null,
    plot.spray !== null,
    false,
    SOIL_START,
    now,
  );
  addCrop(next.bag.crops, plot.seed, harvestedEffects, 1, false, star);
  if (rng() < petEffect(ledger, "extraHarvest")) {
    addCrop(next.bag.crops, plot.seed, harvestedEffects, 1, false, star);
    next.weekHarvested += 1;
  }
  for (const effect of harvestedEffects) collect(next, `effect:${effect}`);
  next.stats.harvested += 1;
  const seed = resolveSeed(plot.seed, ledger.hybrids);
  const hybrid = isHybridId(plot.seed) ? ledger.hybrids?.find((entry) => entry.id === plot.seed) : undefined;
  grantXp(next, "farming", auto ? 1 : 100 + Math.round((seed?.sell ?? 0) * 3) + harvestedEffects.length * 25);

  if (seed !== undefined && seed.regrow) {
    const events = eventsAt(now);
    const rawGrowMs = growTimeForEvents(
      seed,
      events,
      plot.fertilizer,
      dayPhaseAt(now).phase.growScale * growthScale(ledger, now),
    );
    const wateredGrowMs = Math.max(5_000, Math.round(rawGrowMs * (1 - WATER_CUT_RATIO)));
    const regrowEffects: EffectId[] = [GREENHOUSE_MUTATION];
    if (hybrid?.bonusEffect !== undefined) regrowEffects.push(hybrid.bonusEffect);
    next.greenhousePlots = (next.greenhousePlots ?? []).map((entry, index) =>
      index === slot
        ? {
            slot,
            seed: plot.seed,
            plantedAt: now,
            readyAt: now + wateredGrowMs,
            growMs: wateredGrowMs,
            effects: canonicalEffects(regrowEffects),
            mutationBoost: mutationSkillBonus(ledger) + weeklyModifier(now).mutationBonus,
            badLuck: 0,
            pest: false,
            protectedUntil: Number.MAX_SAFE_INTEGER,
            favorite: plot.favorite,
            watered: true,
            fertilized: false,
            harvests: plot.harvests + 1,
            fertilizer: tickFertilizer(plot.fertilizer),
            spray: tickSpray(plot.spray),
          }
        : entry,
    );
  } else {
    next.greenhousePlots = (next.greenhousePlots ?? []).map((entry, index) =>
      index === slot ? null : entry,
    );
  }
  return changed(next, now);
}

/** @brief Uproots one plant from a greenhouse plot. */
function uprootGreenhouse(ledger: GardenLedger, slot: number, now: number): RuleResult {
  if (ledger.greenhouse <= 0) return { ok: false, code: "GREENHOUSE_LOCKED" };
  if (!greenhouseSlotOpen(ledger, slot)) return { ok: false, code: "PLOT_LOCKED" };
  const plot = ledger.greenhousePlots?.[slot] ?? null;
  if (plot === null) return { ok: false, code: "PLOT_EMPTY" };
  if (plot.favorite === true) return { ok: false, code: "FAVORITE_LOCKED" };
  const next = clone(ledger);
  next.greenhousePlots = (next.greenhousePlots ?? []).map((entry, index) => (index === slot ? null : entry));
  return changed(next, now);
}

/** @brief Applies one fertilizer to a growing greenhouse plot. */
function fertilizeGreenhouse(
  ledger: GardenLedger,
  slot: number,
  supply: FertilizerId,
  now: number,
): RuleResult {
  if (ledger.greenhouse <= 0) return { ok: false, code: "GREENHOUSE_LOCKED" };
  if (!greenhouseSlotOpen(ledger, slot)) return { ok: false, code: "PLOT_LOCKED" };
  const definition = fertilizerById(supply);
  if (definition === undefined) return { ok: false, code: "BAD_REQUEST" };
  const plant = ledger.greenhousePlots?.[slot] ?? null;
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
  next.greenhousePlots = (next.greenhousePlots ?? []).map((entry, index) =>
    index === slot
      ? {
          ...plant,
          readyAt,
          fertilized: true,
          fertilizer: { id: supply, left: definition.harvests },
        }
      : entry,
  );
  return changed(next, now);
}

/** @brief Plants one seed into all empty unlocked greenhouse slots. */
function plantAllGreenhouse(
  ledger: GardenLedger,
  seedId: AnySeedId,
  now: number,
  rng: () => number,
): RuleResult {
  if (ledger.greenhouse <= 0) return { ok: false, code: "GREENHOUSE_LOCKED" };
  let owned = ledger.bag.seeds[seedId] ?? 0;
  if (owned < 1) return { ok: false, code: "NO_SEED" };
  const limit = greenhouseCapacity(ledger.greenhouse);
  let current = ledger;
  let planted = 0;
  for (let slot = 0; slot < limit && owned > 0; slot += 1) {
    if ((current.greenhousePlots?.[slot] ?? null) !== null) continue;
    const result = plantGreenhouse(current, slot, seedId, now, rng);
    if (!result.ok) break;
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

/** @brief Harvests every ready plot inside the greenhouse. */
function harvestAllGreenhouse(ledger: GardenLedger, now: number, rng: () => number): RuleResult {
  if (ledger.greenhouse <= 0) return { ok: false, code: "GREENHOUSE_LOCKED" };
  const limit = greenhouseCapacity(ledger.greenhouse);
  let current = ledger;
  let harvested = 0;
  for (let slot = 0; slot < limit; slot += 1) {
    const plot = current.greenhousePlots?.[slot] ?? null;
    if (plot === null || plot.favorite === true || now < plot.readyAt) continue;
    const result = harvestGreenhouse(current, slot, now, rng, false);
    if (!result.ok) continue;
    current = result.ledger;
    harvested += 1;
  }
  if (harvested === 0) return { ok: false, code: "NOTHING_TO_DO" };
  current.rev = ledger.rev + 1;
  current.updatedAt = now;
  current.lastSeen = now;
  return { ok: true, ledger: current, changed: true };
}

/** @brief Resolves base sell/grow stats for a Nursery breeding parent (seed, tree, or hybrid). */
function resolveParentStats(
  id: string,
  hybrids?: readonly HybridSeed[],
): { sell: number; growMs: number; regrow: boolean } | null {
  const seed = resolveSeed(id, hybrids);
  if (seed !== undefined) return { sell: seed.sell, growMs: seed.growMs, regrow: seed.regrow };
  const tree = treeById(id);
  if (tree !== undefined) return { sell: tree.sell, growMs: tree.growMs, regrow: true };
  return null;
}

/** @brief Total available units of a parent item across bag crops and seeds. */
function bagItemTotal(ledger: GardenLedger, item: AnyItemId): number {
  const cropCount = ledger.bag.crops
    .filter((entry) => entry.item === item)
    .reduce((sum, entry) => sum + entry.qty, 0);
  const seedCount = ledger.bag.seeds[item as AnySeedId] ?? 0;
  return cropCount + seedCount;
}

/** @brief Deducts one parent unit from bag crops first, falling back to seeds. */
function deductParentItem(next: GardenLedger, item: AnyItemId): boolean {
  const crop = next.bag.crops.find((entry) => entry.item === item && entry.qty > 0);
  if (crop !== undefined) {
    next.bag.crops = next.bag.crops
      .map((entry) => (entry === crop ? { ...entry, qty: entry.qty - 1 } : entry))
      .filter((entry) => entry.qty > 0);
    return true;
  }
  const seedKey = item as AnySeedId;
  const seedQty = next.bag.seeds[seedKey] ?? 0;
  if (seedQty > 0) {
    next.bag.seeds[seedKey] = seedQty - 1;
    return true;
  }
  return false;
}

/**
 * @brief Cross-breeds 2 or more parent plants in the Nursery into a new custom HybridSeed.
 * @param ledger Current garden ledger.
 * @param parents Two to six parent crop/seed/hybrid ids.
 * @param now Server-clock timestamp.
 * @param rng Deterministic RNG source.
 * @return Updated ledger containing the new hybrid and awarded seeds, or validation error.
 */
function breedHybrid(
  ledger: GardenLedger,
  parents: readonly AnyItemId[],
  now: number,
  rng: () => number,
): RuleResult {
  if (parents.length < MIN_BREED_PARENTS || parents.length > MAX_BREED_PARENTS) {
    return { ok: false, code: "NOT_ENOUGH_PARENTS" };
  }
  if ((ledger.hybrids?.length ?? 0) >= MAX_HYBRIDS) {
    return { ok: false, code: "HYBRID_LIMIT" };
  }
  const cost = hybridBreedCost(parents.length);
  if (ledger.coins < cost) return { ok: false, code: "NOT_ENOUGH_COINS" };

  // Verify inventory counts handle repeated parent ids accurately.
  const required = new Map<AnyItemId, number>();
  const resolvedStats: Array<{ sell: number; growMs: number; regrow: boolean }> = [];
  for (const parent of parents) {
    const stats = resolveParentStats(parent, ledger.hybrids);
    if (stats === null) return { ok: false, code: "BAD_REQUEST" };
    resolvedStats.push(stats);
    required.set(parent, (required.get(parent) ?? 0) + 1);
  }
  for (const [parent, need] of required.entries()) {
    if (bagItemTotal(ledger, parent) < need) return { ok: false, code: "NO_CROP" };
  }

  const next = clone(ledger);
  next.coins -= cost;
  next.stats.spent += cost;
  for (const parent of parents) {
    if (!deductParentItem(next, parent)) return { ok: false, code: "NO_CROP" };
  }

  const avgSell = resolvedStats.reduce((sum, entry) => sum + entry.sell, 0) / resolvedStats.length;
  const avgGrow = resolvedStats.reduce((sum, entry) => sum + entry.growMs, 0) / resolvedStats.length;
  const anyRegrow = resolvedStats.some((entry) => entry.regrow);

  const odds = hybridOdds(parents.length, ledger.spliceBonus);
  const roll = rng();
  const counter = (ledger.hybridCounter ?? ledger.hybrids?.length ?? 0) + 1;
  const id = `${HYBRID_PREFIX}${counter}` as HybridId;

  let tier: HybridTier = "normal";
  let sell = Math.max(2, Math.round(avgSell * (1.2 + rng() * 0.4)));
  let growMs = Math.max(12_000, Math.round(avgGrow * 0.95));
  let regrow = anyRegrow && rng() < 0.7;
  let bonusEffect: EffectId | undefined;
  let art: [string, string, string, string] = [".", "v", "Y", "*"];
  let seedAward = 3;
  let defaultName = `Lai #${counter}`;

  if (roll < odds.elite) {
    tier = "elite";
    sell = Math.max(5, Math.round(avgSell * (2.5 + rng() * 1.5)));
    growMs = Math.max(10_000, Math.round(avgGrow * 0.7));
    regrow = anyRegrow || rng() < 0.5;
    const elitePool: readonly EffectId[] = ["golden", "crystal", "rainbow", "cosmic", "diamond"];
    bonusEffect = elitePool[Math.floor(rng() * elitePool.length)] ?? "golden";
    art = [".", "v", "Y", "★"];
    seedAward = 4;
    defaultName = `Siêu Lai #${counter}`;
  } else if (roll < odds.elite + odds.dud) {
    tier = "dud";
    sell = Math.max(1, Math.round(avgSell * (0.3 + rng() * 0.3)));
    growMs = Math.max(15_000, Math.round(avgGrow * 1.4));
    regrow = false;
    art = [".", ",", "x", "?"];
    seedAward = 2;
    defaultName = `Cây Đểu #${counter}`;
  }

  const created: HybridSeed = {
    id,
    name: defaultName,
    parents: [...parents],
    tier,
    growMs,
    sell,
    regrow,
    ...(bonusEffect === undefined ? {} : { bonusEffect }),
    art,
    createdAt: now,
  };
  next.hybrids = [...(next.hybrids ?? []), created];
  next.hybridCounter = counter;
  next.lastHybridId = id;
  next.bag.seeds[id] = (next.bag.seeds[id] ?? 0) + seedAward;
  logTimeline(next, "breed", now, { item: id, qty: seedAward });
  return changed(next, now);
}

/**
 * @brief Renames one player-created Nursery hybrid variety.
 * @param ledger Current garden ledger.
 * @param id Target hybrid id.
 * @param name New display name (1..28 trimmed chars).
 * @param now Server-clock timestamp.
 * @return Next ledger with updated hybrid name or error.
 */
function renameHybrid(ledger: GardenLedger, id: HybridId, name: string, now: number): RuleResult {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 28) return { ok: false, code: "BAD_REQUEST" };
  const list = ledger.hybrids ?? [];
  const index = list.findIndex((entry) => entry.id === id);
  if (index < 0) return { ok: false, code: "BAD_REQUEST" };
  const next = clone(ledger);
  next.hybrids = list.map((entry, i) => (i === index ? { ...entry, name: trimmed } : entry));
  return changed(next, now);
}

/** @brief Adds one produce unit to a mutable bag. */
function addCrop(
  crops: CropStack[],
  item: AnyItemId,
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
  item: AnyItemId,
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
