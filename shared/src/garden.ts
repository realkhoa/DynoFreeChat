/**
 * @file garden.ts
 * @brief Wire types and deterministic season rules for ASCII Garden.
 * @details The browser and the Worker both import this module, so the seed
 * shop, the exchange prices and the event rotation are computed by one pure
 * function of the server clock. Two clients at the same instant always see the
 * same offers and the same event, and the Worker validates every action against
 * the same snapshot the player was shown.
 */

/** Wire version for every garden request and response. */
export const GARDEN_PROTOCOL_VERSION = 1;

/** Crop slots in one 3x3 patch. */
export const PLOTS_PER_PATCH = 9;

/** Crop patches shown inside one tab (3x3 patches = 81 crop slots). */
export const CROP_PATCHES_PER_TAB = 9;

/** Fruit patches shown inside one tab (3x3 trees each = 27 tree slots). */
export const FRUIT_PATCHES_PER_TAB = 3;

/** Crop slots one tab offers. */
export const CROPS_PER_TAB = CROP_PATCHES_PER_TAB * PLOTS_PER_PATCH;

/** Fruit tree slots one tab offers. */
export const TREES_PER_TAB = FRUIT_PATCHES_PER_TAB * PLOTS_PER_PATCH;

/** Tabs free when a garden is created. */
export const STARTING_TABS = 1;

/** Hard cap on bought tabs, so the garden stays bounded. */
export const MAX_TABS = 4;

/** Price of the first bought crop patch inside a tab, in coins. */
export const PATCH_BASE_PRICE = 5_000;

/** Each further crop patch costs this multiple of the previous one. */
export const PATCH_PRICE_FACTOR = 2;

/** Absolute crop ceiling; action parsing uses it before the state is known. */
export const MAX_CROPS = CROPS_PER_TAB * MAX_TABS;

/** Absolute tree ceiling; action parsing uses it before the state is known. */
export const MAX_TREES = TREES_PER_TAB * MAX_TABS;

/** Coins a new garden starts with. */
export const STARTING_COINS = 30;

/** Starter seeds so the first minute is play, not shopping. */
export const STARTING_SEEDS = 3;

/** Absolute start of the season schedule; every rotation counts from here. */
export const EPOCH_MS = 1_767_225_600_000;

/** One event wave lasts this long. */
export const EVENT_WAVE_MS = 6 * 60_000;

/** Seed shop stock and prices rotate on this cadence. */
export const SHOP_RESTOCK_MS = 5 * 60_000;

/** Watering shortens the remaining growth by this ratio. */
export const WATER_CUT_RATIO = 0.15;

/** Fertilizer price in coins. */
export const FERTILIZER_PRICE = 3;

/** Fertilizer shortens the remaining growth by this ratio. */
export const FERTILIZER_CUT_RATIO = 0.3;

/** A guest watering a friend's crop shortens it by this ratio. */
export const GUEST_WATER_CUT_RATIO = 0.1;

/** Largest single seed purchase. */
export const MAX_BUY_QTY = 10;

/** Actions one garden accepts per minute; protects the DO from a hot loop. */
export const ACTIONS_PER_MINUTE = 120;

/** Registrations one IP may create per window. */
export const REGISTERS_PER_WINDOW = 5;

/** Length of the register window. */
export const REGISTER_WINDOW_MS = 60 * 60_000;

/** Public share code length; codes are uppercase base32. */
export const GARDEN_CODE_LENGTH = 6;

/** Recovery keys are three groups of four uppercase base32 characters. */
export const RECOVERY_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Public share codes are six uppercase base32 characters. */
export const GARDEN_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{6}$/;

/** Header carrying `playerId.token` on owner requests. */
export const GARDEN_AUTH_HEADER = "x-dyno-garden";

/** Player ids are UUIDv4 strings. */
export const PLAYER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Seed ids shipped in this build. */
export type SeedId =
  | "carrot"
  | "parsnip"
  | "cucumber"
  | "tomato"
  | "strawberry"
  | "corn"
  | "hop"
  | "cauliflower"
  | "blueberry"
  | "pumpkin"
  | "potato"
  | "sunflower"
  | "lavender"
  | "watermelon"
  | "pineapple"
  | "pitcher"
  | "mushroom"
  | "rice"
  | "chili"
  | "eggplant"
  | "bamboo"
  | "cacao"
  | "dragonFruit"
  | "ginseng"
  | "moonflower"
  | "frostberry";

/** Fruit tree ids shipped in this build. */
export type TreeId = "apple" | "grape" | "orange" | "plum" | "apricot" | "coconut" | "elderberry";

/** Anything that can sit in the harvest bag: a crop seed or a tree fruit. */
export type ItemId = SeedId | TreeId;

/** Luck effects a crop can carry. */
export type EffectId =
  | "wet"
  | "golden"
  | "frozen"
  | "snow"
  | "chill"
  | "sunray"
  | "smoked"
  | "cracked"
  | "onfire"
  | "aurora"
  | "meteor"
  | "moonlit"
  | "toxic"
  | "plasma"
  | "gilded"
  | "crystal"
  | "rainbow"
  | "shriveled"
  | "pale";

/** Global events that rotate over time. */
export type EventId =
  | "calm"
  | "rain"
  | "goldenHour"
  | "frost"
  | "marketBoom"
  | "snowfall"
  | "coldSnap"
  | "heatwave"
  | "smoke"
  | "drought"
  | "wildfire"
  | "meteorShower"
  | "auroraNight"
  | "moonlight"
  | "toxicRain"
  | "plasmaStorm"
  | "goldenFog"
  | "crystalFrost"
  | "rainbowSky"
  | "blightWind";

/** One plantable seed and its economy. */
export interface SeedDefinition {
  /** Stable id used by saves, offers and the art. */
  readonly id: SeedId;
  /** Growth time in milliseconds before the season modifier. */
  readonly growMs: number;
  /** Base shop price. */
  readonly buy: number;
  /** Base exchange price for a plain crop. */
  readonly sell: number;
  /** Whether the plant stays after a harvest and regrows its fruit. */
  readonly regrow: boolean;
  /** Rare event seed: only sold when a restock roll hits. */
  readonly rare?: boolean;
  /** Extra sell multiplier while one of these events runs. */
  readonly eventBonus?: { readonly events: readonly EventId[]; readonly multiplier: number };
  /** Glyphs for the four stages: seed, sprout, young, ripe. */
  readonly art: readonly [string, string, string, string];
}

/** Catalog order is the shop order. */
export const SEEDS: readonly SeedDefinition[] = [
  // Single harvest: one pull, higher margin, replant to continue.
  { id: "carrot", growMs: 3 * 60_000, buy: 5, sell: 9, art: [".", "v", "Y", "^"], regrow: false },
  { id: "parsnip", growMs: 6 * 60_000, buy: 14, sell: 30, art: [".", "v", "Y", "p"], regrow: false },
  { id: "potato", growMs: 7 * 60_000, buy: 16, sell: 36, art: [".", "v", "Y", "t"], regrow: false },
  { id: "sunflower", growMs: 14 * 60_000, buy: 55, sell: 130, art: [".", "v", "Y", "X"], regrow: false },
  { id: "lavender", growMs: 16 * 60_000, buy: 70, sell: 160, art: [".", "v", "Y", "l"], regrow: false },
  { id: "cauliflower", growMs: 20 * 60_000, buy: 90, sell: 220, art: [".", "v", "Y", "f"], regrow: false },
  // Multi harvest: the plant stays, so each fruit pays less than a one-shot crop
  // of the same tier; the cheap seed lets a new fruit start after the first pick.
  { id: "cucumber", growMs: 10 * 60_000, buy: 20, sell: 30, art: [".", "v", "Y", "c"], regrow: true },
  { id: "tomato", growMs: 8 * 60_000, buy: 14, sell: 28, art: [".", "v", "Y", "o"], regrow: true },
  { id: "strawberry", growMs: 12 * 60_000, buy: 40, sell: 60, art: [".", "v", "Y", "s"], regrow: true },
  { id: "corn", growMs: 15 * 60_000, buy: 30, sell: 70, art: [".", "v", "Y", "u"], regrow: true },
  { id: "hop", growMs: 18 * 60_000, buy: 50, sell: 90, art: [".", "v", "Y", "h"], regrow: true },
  { id: "blueberry", growMs: 25 * 60_000, buy: 80, sell: 140, art: [".", "v", "Y", "b"], regrow: true },
  { id: "pumpkin", growMs: 30 * 60_000, buy: 70, sell: 150, art: [".", "v", "Y", "@"], regrow: true },
  { id: "watermelon", growMs: 22 * 60_000, buy: 80, sell: 120, art: [".", "v", "Y", "w"], regrow: true },
  { id: "pineapple", growMs: 28 * 60_000, buy: 100, sell: 160, art: [".", "v", "Y", "i"], regrow: true },
  { id: "pitcher", growMs: 35 * 60_000, buy: 120, sell: 200, art: [".", "v", "Y", "&"], regrow: true },
  // Late-game expansion: one-shot crops pay a higher margin, multi-harvest ones
  // keep paying but sell less per cycle.
  { id: "mushroom", growMs: 5 * 60_000, buy: 35, sell: 75, art: [".", "v", "Y", "m"], regrow: false },
  { id: "rice", growMs: 8 * 60_000, buy: 25, sell: 55, art: [".", "v", "Y", "r"], regrow: false },
  { id: "chili", growMs: 14 * 60_000, buy: 35, sell: 65, art: [".", "v", "Y", "j"], regrow: true },
  { id: "eggplant", growMs: 18 * 60_000, buy: 75, sell: 175, art: [".", "v", "Y", "e"], regrow: false },
  { id: "bamboo", growMs: 22 * 60_000, buy: 90, sell: 150, art: [".", "v", "Y", "t"], regrow: true },
  { id: "cacao", growMs: 24 * 60_000, buy: 140, sell: 330, art: [".", "v", "Y", "k"], regrow: false },
  { id: "dragonFruit", growMs: 32 * 60_000, buy: 180, sell: 300, art: [".", "v", "Y", "D"], regrow: true },
  { id: "ginseng", growMs: 40 * 60_000, buy: 300, sell: 800, art: [".", "v", "Y", "g"], regrow: false },
  // Event seeds: only 1% of restocks carry them; their price spikes with weather.
  {
    id: "moonflower",
    growMs: 26 * 60_000,
    buy: 200,
    sell: 260,
    art: [".", "v", "Y", "M"],
    regrow: true,
    rare: true,
    eventBonus: { events: ["goldenHour"], multiplier: 3 },
  },
  {
    id: "frostberry",
    growMs: 24 * 60_000,
    buy: 220,
    sell: 300,
    art: [".", "v", "Y", "B"],
    regrow: false,
    rare: true,
    eventBonus: { events: ["frost", "snowfall"], multiplier: 2 },
  },
];

/** Chance an event seed shows up in a restock. */
export const EVENT_SEED_CHANCE = 0.01;

/** Multiplier-aware fertilizer ids. */
export type FertilizerId = "compost" | "speedGrow" | "superGrow";

/** Mutation-boosting spray ids. */
export type SprayId = "goldenSpray" | "frostSpray" | "snowSpray" | "stormSpray";

/** Anything the player can buy in the supplies shop. */
export type SupplyId = FertilizerId | SprayId;

/** One fertilizer: shortens growth for a number of harvests. */
export interface FertilizerDefinition {
  /** Stable id. */
  readonly id: FertilizerId;
  /** Growth-time multiplier while active; `< 1` grows faster. */
  readonly growMultiplier: number;
  /** Harvest cycles the boost survives. */
  readonly harvests: number;
  /** Shop price. */
  readonly price: number;
}

/** One spray: raises mutation chances for a number of harvests. */
export interface SprayDefinition {
  /** Stable id. */
  readonly id: SprayId;
  /** Extra effect chances added on every roll while active. */
  readonly effectChances: Readonly<Partial<Record<EffectId, number>>>;
  /** Harvest cycles the boost survives. */
  readonly harvests: number;
  /** Shop price. */
  readonly price: number;
}

/** Fertilizer catalog. */
export const FERTILIZERS: readonly FertilizerDefinition[] = [
  { id: "compost", growMultiplier: 0.75, harvests: 2, price: 25 },
  { id: "speedGrow", growMultiplier: 0.6, harvests: 3, price: 60 },
  { id: "superGrow", growMultiplier: 0.45, harvests: 4, price: 140 },
];

/** Spray catalog. */
export const SPRAYS: readonly SprayDefinition[] = [
  { id: "goldenSpray", effectChances: { golden: 0.15 }, harvests: 2, price: 80 },
  { id: "frostSpray", effectChances: { frozen: 0.15 }, harvests: 2, price: 80 },
  { id: "snowSpray", effectChances: { snow: 0.15 }, harvests: 2, price: 80 },
  {
    id: "stormSpray",
    effectChances: { snow: 0.05, chill: 0.05, sunray: 0.05, smoked: 0.05, cracked: 0.05, onfire: 0.05 },
    harvests: 3,
    price: 150,
  },
];

/** One active fertilizer on a planted slot. */
export interface ActiveFertilizer {
  /** Which fertilizer. */
  readonly id: FertilizerId;
  /** Harvest cycles left. */
  readonly left: number;
}

/** One active spray on a planted slot. */
export interface ActiveSpray {
  /** Which spray. */
  readonly id: SprayId;
  /** Harvest cycles left. */
  readonly left: number;
}

/** One plantable fruit tree and its economy. */
export interface TreeDefinition {
  /** Stable id used by saves and the fruit exchange. */
  readonly id: TreeId;
  /** Growth time in milliseconds before the season modifier. */
  readonly growMs: number;
  /** Sapling price, paid on planting. */
  readonly buy: number;
  /** Base exchange price for one plain fruit. */
  readonly sell: number;
  /** Glyphs for the four stages: sapling, sprout, young, fruiting. */
  readonly art: readonly [string, string, string, string];
}

/** Fruit trees share the 3x3 layout with crops and regrow every fruit. */
export const TREES: readonly TreeDefinition[] = [
  { id: "apple", growMs: 25 * 60_000, buy: 150, sell: 260, art: [".", "v", "Y", "a"] },
  { id: "grape", growMs: 20 * 60_000, buy: 120, sell: 180, art: [".", "v", "Y", "g"] },
  { id: "orange", growMs: 30 * 60_000, buy: 220, sell: 350, art: [".", "v", "Y", "O"] },
  { id: "plum", growMs: 35 * 60_000, buy: 280, sell: 420, art: [".", "v", "Y", "m"] },
  { id: "apricot", growMs: 40 * 60_000, buy: 320, sell: 500, art: [".", "v", "Y", "A"] },
  { id: "coconut", growMs: 45 * 60_000, buy: 400, sell: 620, art: [".", "v", "Y", "C"] },
  { id: "elderberry", growMs: 50 * 60_000, buy: 480, sell: 760, art: [".", "v", "Y", "e"] },
];

/** One luck effect and how it changes a crop's value. */
export interface EffectDefinition {
  /** Stable id stored on the plot or bag stack. */
  readonly id: EffectId;
  /** One-character ASCII mark drawn next to the crop. */
  readonly mark: string;
  /** Multiplier applied to the seed's sell price. */
  readonly multiplier: number;
  /** Whether weather can roll this effect at planting; wet comes from watering. */
  readonly natural: boolean;
}

/** Effect catalog; order is also the weather roll priority. */
export const EFFECTS: readonly EffectDefinition[] = [
  { id: "wet", mark: "~", multiplier: 2, natural: false },
  { id: "golden", mark: "$", multiplier: 5, natural: true },
  { id: "frozen", mark: "*", multiplier: 3, natural: true },
  { id: "snow", mark: "+", multiplier: 2.5, natural: true },
  { id: "chill", mark: ",", multiplier: 3.5, natural: true },
  { id: "sunray", mark: "'", multiplier: 3, natural: true },
  { id: "smoked", mark: "%", multiplier: 4, natural: true },
  { id: "cracked", mark: "/", multiplier: 4.5, natural: true },
  { id: "onfire", mark: "!", multiplier: 6, natural: true },
  { id: "aurora", mark: "&", multiplier: 3.2, natural: true },
  { id: "meteor", mark: "^", multiplier: 5.5, natural: true },
  { id: "moonlit", mark: "o", multiplier: 3.8, natural: true },
  { id: "toxic", mark: "x", multiplier: 4.2, natural: true },
  { id: "plasma", mark: "@", multiplier: 7, natural: true },
  { id: "gilded", mark: "G", multiplier: 4.8, natural: true },
  { id: "crystal", mark: "C", multiplier: 3.6, natural: true },
  { id: "rainbow", mark: "R", multiplier: 6.5, natural: true },
  // Bad mutations: cheap, not dangerous, but they can ruin an otherwise good pick.
  { id: "shriveled", mark: "-", multiplier: 0.5, natural: true },
  { id: "pale", mark: ".", multiplier: 0.7, natural: true },
];

/** Effects every planting can roll even under a calm sky. */
export const BASE_EFFECT_CHANCES: Readonly<Partial<Record<EffectId, number>>> = {
  golden: 0.03,
  frozen: 0.02,
  moonlit: 0.015,
  pale: 0.02,
  shriveled: 0.015,
};

/** One global event and its modifiers. */
export interface EventDefinition {
  /** Stable id shown and localized by the client. */
  readonly id: EventId;
  /** Growth time multiplier applied when planting; `> 1` grows faster. */
  readonly growScale: number;
  /** Extra planting chances for the weather effects this event brings. */
  readonly effectChances: Readonly<Partial<Record<EffectId, number>>>;
  /** Exchange price multiplier applied when selling. */
  readonly sellBonus: number;
}

/** How many weather events run at once, and how often each count happens. */
const EVENT_COUNT_WEIGHTS: readonly { count: number; weight: number }[] = [
  { count: 0, weight: 20 },
  { count: 1, weight: 55 },
  { count: 2, weight: 20 },
  { count: 3, weight: 5 },
];

/** Event catalog; the rotation walks this list in order. */
export const EVENTS: readonly EventDefinition[] = [
  { id: "calm", growScale: 1, sellBonus: 1, effectChances: {} },
  { id: "rain", growScale: 1.25, sellBonus: 1, effectChances: {} },
  { id: "goldenHour", growScale: 1, sellBonus: 1, effectChances: { golden: 0.12 } },
  { id: "frost", growScale: 0.9, sellBonus: 1, effectChances: { frozen: 0.1 } },
  { id: "marketBoom", growScale: 1, sellBonus: 1.2, effectChances: {} },
  { id: "snowfall", growScale: 0.9, sellBonus: 1, effectChances: { snow: 0.15 } },
  { id: "coldSnap", growScale: 0.85, sellBonus: 1, effectChances: { chill: 0.15 } },
  { id: "heatwave", growScale: 1.1, sellBonus: 1, effectChances: { sunray: 0.15 } },
  { id: "smoke", growScale: 1, sellBonus: 1, effectChances: { smoked: 0.12 } },
  { id: "drought", growScale: 0.8, sellBonus: 1, effectChances: { cracked: 0.12 } },
  { id: "wildfire", growScale: 0.95, sellBonus: 1.15, effectChances: { onfire: 0.08 } },
  { id: "meteorShower", growScale: 0.95, sellBonus: 1.2, effectChances: { meteor: 0.1 } },
  { id: "auroraNight", growScale: 1.05, sellBonus: 1.1, effectChances: { aurora: 0.12 } },
  { id: "moonlight", growScale: 1.05, sellBonus: 1, effectChances: { moonlit: 0.15 } },
  { id: "toxicRain", growScale: 1, sellBonus: 1.05, effectChances: { toxic: 0.1 } },
  { id: "plasmaStorm", growScale: 0.9, sellBonus: 1.25, effectChances: { plasma: 0.04 } },
  { id: "goldenFog", growScale: 1, sellBonus: 1.1, effectChances: { gilded: 0.12 } },
  { id: "crystalFrost", growScale: 0.95, sellBonus: 1.1, effectChances: { crystal: 0.12 } },
  { id: "rainbowSky", growScale: 1.1, sellBonus: 1.15, effectChances: { rainbow: 0.05 } },
  { id: "blightWind", growScale: 0.9, sellBonus: 0.9, effectChances: { shriveled: 0.15, pale: 0.1 } },
];

/** Length of one animal upkeep/production cycle: six minutes. */
export const FARM_CYCLE_MS = 6 * 60_000;

/** The two animal buildings. */
export type BuildingId = "coop" | "barn";

/** Animals a building can host. */
export type AnimalId = "chicken" | "duck" | "cow" | "goat" | "sheep";

/** Products animals produce. */
export type ProductId =
  "egg" | "duckEgg" | "milk" | "goatMilk" | "wool" | "mayo" | "cheese" | "pickles" | "oil" | "fabric";

/** One animal definition. */
export interface AnimalDefinition {
  /** Stable id. */
  readonly id: AnimalId;
  /** Which building hosts it. */
  readonly building: BuildingId;
  /** Coins charged every cycle while it lives. */
  readonly upkeep: number;
  /** Cycles between two products. */
  readonly intervalCycles: number;
  /** Product id it yields. */
  readonly product: ProductId;
  /** Purchase price, in coins. */
  readonly buy: number;
}

/** One product definition. */
export interface ProductDefinition {
  /** Stable id. */
  readonly id: ProductId;
  /** Base sell price for a one-star item. */
  readonly base: number;
}

/** One building definition. */
export interface BuildingDefinition {
  /** Stable id. */
  readonly id: BuildingId;
  /** Price of the first level. */
  readonly price: number;
  /** Price of every upgrade step. */
  readonly upgrade: number;
  /** Slots per level; index 0 is level 1. */
  readonly slots: readonly number[];
  /** Animals this building accepts. */
  readonly animals: readonly AnimalId[];
}

/** Buildings and their ladders: three upgrades, up to twelve slots. */
export const BUILDINGS: readonly BuildingDefinition[] = [
  { id: "coop", price: 3_000_000, upgrade: 3_000_000, slots: [4, 6, 9, 12], animals: ["chicken", "duck"] },
  {
    id: "barn",
    price: 4_000_000,
    upgrade: 4_000_000,
    slots: [4, 6, 9, 12],
    animals: ["cow", "goat", "sheep"],
  },
];

/** Animal catalog with upkeep, production cadence and shop prices. */
export const ANIMALS: readonly AnimalDefinition[] = [
  { id: "chicken", building: "coop", upkeep: 40, intervalCycles: 2, product: "egg", buy: 5_000 },
  { id: "duck", building: "coop", upkeep: 40, intervalCycles: 3, product: "duckEgg", buy: 8_000 },
  { id: "cow", building: "barn", upkeep: 100, intervalCycles: 1, product: "milk", buy: 20_000 },
  { id: "goat", building: "barn", upkeep: 100, intervalCycles: 3, product: "goatMilk", buy: 25_000 },
  { id: "sheep", building: "barn", upkeep: 100, intervalCycles: 7, product: "wool", buy: 40_000 },
];

/** Product base prices; every quality star doubles the value. */
export const PRODUCTS: readonly ProductDefinition[] = [
  { id: "egg", base: 160 },
  { id: "duckEgg", base: 180 },
  { id: "milk", base: 120 },
  { id: "goatMilk", base: 400 },
  { id: "wool", base: 1_000 },
  // Warehouse outputs: value already includes the recipe multiplier.
  { id: "mayo", base: 1_600 },
  { id: "cheese", base: 12_000 },
  { id: "pickles", base: 300 },
  { id: "oil", base: 2_600 },
  { id: "fabric", base: 100_000 },
];

/** Warehouse machine ids. */
export type MachineId = "seedMaker" | "mayoMaker" | "cheesePress" | "pickleJar" | "oilPress" | "loom";

/** One machine recipe. */
export interface MachineDefinition {
  /** Stable id. */
  readonly id: MachineId;
  /** What it consumes. */
  readonly input:
    | { readonly kind: "seedCrop"; readonly seeds?: readonly SeedId[] }
    | { readonly kind: "product"; readonly product: ProductId };
  /** What it produces. */
  readonly output: { readonly kind: "seeds" } | { readonly kind: "product"; readonly product: ProductId };
  /** Output multiplier, purely informative for labels. */
  readonly multiplier: number;
  /** Cycles between two crafts. */
  readonly cooldownCycles: number;
}

/** Price of the warehouse itself. */
export const WAREHOUSE_PRICE = 5_000_000;

/** Price of one machine and of every upgrade step. */
export const MACHINE_PRICE = 5_000_000;

/** Maximum machine level. */
export const MACHINE_MAX_LEVEL = 3;

/** Warehouse machine catalog. */
export const MACHINES: readonly MachineDefinition[] = [
  {
    id: "seedMaker",
    input: { kind: "seedCrop" },
    output: { kind: "seeds" },
    multiplier: 3,
    cooldownCycles: 2,
  },
  {
    id: "mayoMaker",
    input: { kind: "product", product: "egg" },
    output: { kind: "product", product: "mayo" },
    multiplier: 10,
    cooldownCycles: 2,
  },
  {
    id: "cheesePress",
    input: { kind: "product", product: "milk" },
    output: { kind: "product", product: "cheese" },
    multiplier: 100,
    cooldownCycles: 2,
  },
  {
    id: "pickleJar",
    input: { kind: "seedCrop", seeds: ["cucumber"] },
    output: { kind: "product", product: "pickles" },
    multiplier: 10,
    cooldownCycles: 2,
  },
  {
    id: "oilPress",
    input: { kind: "seedCrop", seeds: ["sunflower"] },
    output: { kind: "product", product: "oil" },
    multiplier: 20,
    cooldownCycles: 2,
  },
  {
    id: "loom",
    input: { kind: "product", product: "wool" },
    output: { kind: "product", product: "fabric" },
    multiplier: 100,
    cooldownCycles: 2,
  },
];

/** @brief Machine definition by id. */
export function machineById(id: string): MachineDefinition | undefined {
  return MACHINES.find((machine) => machine.id === id);
}

/** One built machine on the wire. */
export interface MachineState {
  /** Machine level, `1..3`. */
  readonly level: number;
  /** Server time of the last craft. */
  readonly lastCraftAt: number;
}

/** @brief Seeds a seed maker returns for one crop at a level. */
export function seedMakerOutput(level: number): number {
  return 2 + Math.max(1, Math.min(MACHINE_MAX_LEVEL, level));
}

/** @brief Products a converter returns for one input at a level. */
export function converterOutput(level: number): number {
  return Math.max(1, Math.min(MACHINE_MAX_LEVEL, level));
}

/** @brief Requirements of one machine craft. */
export function machineCraftCost(machine: MachineDefinition): number {
  return MACHINE_PRICE;
}

/** Rare tools sold in the market. */
export type ToolId = "autoWater";

/** One rare tool definition. */
export interface ToolDefinition {
  /** Stable id. */
  readonly id: ToolId;
  /** Fixed price, in coins. */
  readonly price: number;
}

/** Rare tool catalog. */
export const TOOLS: readonly ToolDefinition[] = [{ id: "autoWater", price: 1_000_000 }];

/** Chance a rare tool appears in one shop restock (`< 20%`). */
export const TOOL_STOCK_CHANCE = 0.15;

/** @brief Tool definition by id. */
export function toolById(id: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

/** One rare-tool offer in the rotation. */
export interface ShopToolOffer {
  /** Tool id. */
  readonly tool: ToolId;
  /** Price when in stock. */
  readonly price: number;
  /** Units available this restock; absent tools do not appear. */
  readonly stock: number;
}

/** @brief Building definition by id. */
export function buildingById(id: string): BuildingDefinition | undefined {
  return BUILDINGS.find((building) => building.id === id);
}

/** @brief Animal definition by id. */
export function animalById(id: string): AnimalDefinition | undefined {
  return ANIMALS.find((animal) => animal.id === id);
}

/** @brief Product definition by id. */
export function productById(id: string): ProductDefinition | undefined {
  return PRODUCTS.find((product) => product.id === id);
}

/** @brief Open slots at one building level (0 means not built). */
export function buildingSlots(building: BuildingId, level: number): number {
  const definition = buildingById(building);
  if (definition === undefined || level <= 0) return 0;
  return definition.slots[Math.min(level, definition.slots.length) - 1] ?? 0;
}

/** @brief Highest building level. */
export function maxBuildingLevel(building: BuildingId): number {
  return buildingById(building)?.slots.length ?? 0;
}

/** @brief Price of the next upgrade step. */
export function buildingUpgradeCost(building: BuildingId): number {
  return buildingById(building)?.upgrade ?? 0;
}

/** @brief One animal living in a building slot. */
export interface AnimalState {
  /** Species. */
  readonly kind: AnimalId;
  /** Server time the animal was bought. */
  readonly bornAt: number;
  /** How many times it was petted. */
  readonly pats: number;
  /** Server time of the last produced item. */
  readonly lastProduceAt: number;
}

/** One stack of animal products in the bag. */
export interface ProductStack {
  /** Product id. */
  readonly product: ProductId;
  /** Quality stars, `1..5`. */
  readonly star: number;
  /** Units owned. */
  readonly qty: number;
}

/** @brief Miliseconds between two products of one animal. */
export function animalIntervalMs(animal: AnimalId): number {
  const definition = animalById(animal);
  return Math.max(1, definition?.intervalCycles ?? 1) * FARM_CYCLE_MS;
}

/**
 * @brief Quality stars of an animal.
 * @param animal Living animal.
 * @param now Server clock.
 * @details One star at birth; each completed day of age (24 cycles) adds one
 * star and every six pats add one, capped at five.
 */
export function animalQuality(animal: AnimalState, now: number): number {
  const ageCycles = Math.max(0, Math.floor((now - animal.bornAt) / FARM_CYCLE_MS));
  const stars = 1 + Math.floor(ageCycles / 24) + Math.floor(animal.pats / 6);
  return Math.min(5, Math.max(1, stars));
}

/** @brief Sell value of one product stack, after quality and event bonus. */
export function productPrice(stack: ProductStack, season: SeasonSnapshot): number {
  const definition = productById(stack.product);
  if (definition === undefined) return 0;
  const quality = 2 ** Math.max(0, Math.min(5, stack.star) - 1);
  const bonus = combinedSellBonus(
    season.events.length > 0 ? eventsAt(season.event.startedAt) : eventsAt(season.event.startedAt),
  );
  return Math.max(1, Math.round(definition.base * quality * bonus));
}

/** One occupied plot on the wire. */
export interface PlotState {
  /** Absolute plot index, `0..MAX_PLOTS-1`. */
  readonly slot: number;
  /** Seed planted here. */
  readonly seed: SeedId;
  /** Wall-clock planting time, server clock. */
  readonly plantedAt: number;
  /** Wall-clock time the crop becomes harvestable. */
  readonly readyAt: number;
  /** Mutations carried by the current fruit; may hold several at once. */
  readonly effects: readonly EffectId[];
  /** Whether pests are damaging this crop right now. */
  readonly pest: boolean;
  /** Pesticide protection expiry; pests cannot strike before it. */
  readonly protectedUntil: number;
  /** Whether the owner already watered this planting. */
  readonly watered: boolean;
  /** Whether the owner already fertilized this planting. */
  readonly fertilized: boolean;
  /** Fruits already harvested from this plant; `0` for single-harvest crops. */
  readonly harvests: number;
  /** Active fertilizer, or `null`. */
  readonly fertilizer: ActiveFertilizer | null;
  /** Active spray, or `null`. */
  readonly spray: ActiveSpray | null;
}

/** One planted fruit tree. */
export interface TreeState {
  /** Absolute tree slot, `0..MAX_PLOTS-1`. */
  readonly slot: number;
  /** Tree species planted here. */
  readonly tree: TreeId;
  /** Wall-clock planting time, server clock. */
  readonly plantedAt: number;
  /** Wall-clock time the fruit becomes harvestable. */
  readonly readyAt: number;
  /** Mutations carried by the current fruit; may hold several at once. */
  readonly effects: readonly EffectId[];
  /** Whether pests are damaging this tree right now. */
  readonly pest: boolean;
  /** Pesticide protection expiry; pests cannot strike before it. */
  readonly protectedUntil: number;
  /** Whether the owner already watered this cycle. */
  readonly watered: boolean;
  /** Whether the owner already fertilized this cycle. */
  readonly fertilized: boolean;
  /** Fruits already picked from this tree. */
  readonly harvests: number;
  /** Active fertilizer, or `null`. */
  readonly fertilizer: ActiveFertilizer | null;
  /** Active spray, or `null`. */
  readonly spray: ActiveSpray | null;
}

/** One stack of harvested produce in the bag. */
export interface CropStack {
  /** Item of the harvested stack: a seed's crop or a tree's fruit. */
  readonly item: ItemId;
  /** Mutations the stack carried when harvested. */
  readonly effects: readonly EffectId[];
  /** Harvested from a pest-damaged plant; sells for half. */
  readonly pest?: boolean;
  /** Units in the stack. */
  readonly qty: number;
}

/** Seeds and crops the player owns. */
export interface BagState {
  /** Unplanted seeds by id; missing ids are zero. */
  readonly seeds: Readonly<Partial<Record<SeedId, number>>>;
  /** Harvested crops ready to sell. */
  readonly crops: readonly CropStack[];
  /** Owned fertilizers and sprays; missing ids are zero. */
  readonly supplies: Readonly<Partial<Record<SupplyId, number>>>;
  /** Animal products waiting to be sold; absent on old saves. */
  readonly products?: readonly ProductStack[];
  /** Rare tools owned; absent on old saves. */
  readonly tools?: Readonly<Partial<Record<ToolId, number>>>;
}

/** Lifetime counters used by the HUD and the leaderboard. */
export interface GardenStats {
  /** Crops planted since the garden was created. */
  readonly planted: number;
  /** Crops harvested since the garden was created. */
  readonly harvested: number;
  /** Coins earned by selling since the garden was created. */
  readonly earned: number;
  /** Coins spent on seeds, saplings, land and services. */
  readonly spent: number;
  /** Coins paid as sale tax. */
  readonly tax: number;
}

/** Warehouse and its machines. */
export interface WarehouseState {
  /** 0 when not built, 1 when built. */
  readonly level: number;
  /** Built machines by id. */
  readonly machines: Readonly<Partial<Record<MachineId, MachineState>>>;
}

/* ===================================================================== *
 *  Extras: weather forecast, rotation, greenhouse, pets, insurance,
 *  contracts, merchant, futures, genetics, compost, achievements,
 *  streak, collection, lucky wheel and weekly tournament.
 * ===================================================================== */

/** Milliseconds in one day. */
export const DAY_MS = 24 * 60 * 60_000;

/** Contract board rotation. */
export const CONTRACT_WINDOW_MS = 2 * 60 * 60_000;

/** Traveling merchant rotation. */
export const MERCHANT_WINDOW_MS = 4 * 60 * 60_000;

/** Weekly tournament window. */
export const WEEK_MS = 7 * DAY_MS;

/** Insurance price and payout per infested plant. */
export const INSURANCE_PRICE = 2_500;
export const INSURANCE_DURATION_MS = DAY_MS;
export const INSURANCE_PAYOUT = 150;

/** Greenhouse levels: prices and pest-chance reduction per level. */
export const GREENHOUSE_PRICES: readonly number[] = [2_000_000, 4_000_000, 8_000_000];

/** Pet levels: prices and extra pest-chance reduction per level. */
export const PET_PRICES: readonly number[] = [100_000, 300_000, 800_000];

/** Genetics: maximum splice bonus in percentage points. */
export const SPLICE_MAX_BONUS = 20;

/** Compost: harvested crops needed per fertilizer. */
export const COMPOST_RATIO = 2;

/** Lucky wheel price and pity spins. */
export const WHEEL_PRICE = 10_000;
export const WHEEL_PITY = 20;

/** Futures: fee rate and lock length. */
export const FUTURE_FEE_RATE = 0.05;
export const FUTURE_LOCK_MS = 2 * 60 * 60_000;

/* ------------------------------------------------------------------ pets */

/** Pet ids (gacha only, never sold directly). */
export type PetId =
  | "dog"
  | "cat"
  | "bunny"
  | "fox"
  | "duck"
  | "chicken"
  | "owl"
  | "deer"
  | "goldenRetriever"
  | "panda"
  | "dragon"
  | "phoenix";

/** Pet rarity tiers. */
export type PetRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** One pet definition; every effect value is per owned level. */
export interface PetDefinition {
  /** Stable id. */
  readonly id: PetId;
  /** Rarity tier. */
  readonly rarity: PetRarity;
  /** Lower pest chance per level. */
  readonly pestShield?: number;
  /** Extra mutation chance per level. */
  readonly mutation?: number;
  /** Faster growth per level. */
  readonly grow?: number;
  /** Higher sale value per level. */
  readonly sell?: number;
  /** Chance for one extra fruit per level. */
  readonly extraHarvest?: number;
}

/** Egg price, level cap and pity threshold. */
export const EGG_PRICE = 1_000_000;
export const PET_MAX_LEVEL = 5;
export const EGG_PITY = 10;

/** Pet catalog with Grow-a-Garden style rarity and perks. */
export const PETS: readonly PetDefinition[] = [
  { id: "dog", rarity: "common", pestShield: 0.06 },
  { id: "cat", rarity: "common", pestShield: 0.05, extraHarvest: 0.02 },
  { id: "bunny", rarity: "common", grow: 0.04 },
  { id: "fox", rarity: "uncommon", mutation: 0.01 },
  { id: "duck", rarity: "uncommon", pestShield: 0.04, grow: 0.02 },
  { id: "chicken", rarity: "uncommon", extraHarvest: 0.05 },
  { id: "owl", rarity: "rare", mutation: 0.02 },
  { id: "deer", rarity: "rare", grow: 0.06 },
  { id: "goldenRetriever", rarity: "epic", sell: 0.05, mutation: 0.01 },
  { id: "panda", rarity: "epic", sell: 0.04, extraHarvest: 0.03 },
  { id: "dragon", rarity: "legendary", grow: 0.1, mutation: 0.02 },
  { id: "phoenix", rarity: "legendary", sell: 0.1, extraHarvest: 0.05 },
];

/** Egg odds per rarity. */
export const PET_RARITY_ODDS: Readonly<Record<PetRarity, number>> = {
  common: 0.6,
  uncommon: 0.25,
  rare: 0.1,
  epic: 0.04,
  legendary: 0.01,
};

/** @brief Pet definition by id. */
export function petById(id: string): PetDefinition | undefined {
  return PETS.find((pet) => pet.id === id);
}

/** @brief Pets of one rarity. */
export function petsOfRarity(rarity: PetRarity): PetDefinition[] {
  return PETS.filter((pet) => pet.rarity === rarity);
}

/** Owned pets and the equipped one. */
export interface PetCollection {
  /** Copies owned per pet id; level equals copies (capped at five). */
  readonly pets: Readonly<Partial<Record<PetId, number>>>;
  /** Pet currently active. */
  readonly equippedPet: PetId | null;
  /** Last pet hatched, for the client toast. */
  readonly lastHatch: string;
}

/** @brief Effective effect value of the equipped pet. */
export function equippedPetEffect(
  collection: PetCollection,
  key: "pestShield" | "mutation" | "grow" | "sell" | "extraHarvest",
): number {
  const id = collection.equippedPet;
  if (id === null) return 0;
  const definition = petById(id);
  if (definition === undefined) return 0;
  const level = Math.min(PET_MAX_LEVEL, collection.pets[id] ?? 0);
  return (definition[key] ?? 0) * level;
}

/** @brief Rolls one egg.
 * @param rng Deterministic source.
 * @param pity Eggs since the last epic+ hatch.
 * @details Pity forces an epic-or-better pet on the tenth egg.
 */
export function rollPet(
  rng: () => number,
  pity: number,
): { pet: PetDefinition; pity: number; rare: boolean } {
  const force = pity + 1 >= EGG_PITY;
  const roll = rng();
  let rarity: PetRarity = "common";
  if (force) {
    rarity = rng() < 0.2 ? "legendary" : "epic";
  } else {
    let cursor = 0;
    const order: PetRarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
    for (const tier of order) {
      cursor += PET_RARITY_ODDS[tier];
      if (roll < cursor) {
        rarity = tier;
        break;
      }
    }
  }
  const pool = petsOfRarity(rarity);
  const pet = pool[Math.floor(rng() * Math.max(1, pool.length))] ?? PETS[0];
  const rare = rarity === "epic" || rarity === "legendary";
  return { pet: pet ?? PETS[0]!, pity: rare ? 0 : pity + 1, rare };
}

/* ------------------------------------------------------------------ staff */

/** Staff job roles. */
export type StaffRole = "gardener" | "waterer";

/** Staff personality traits. */
export type StaffTrait = "lazy" | "slow" | "clumsy" | "greedy" | "diligent" | "greenThumb";

/** One staff candidate on the labour market. */
export interface StaffDefinition {
  /** Id within the current market window. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Work speed, 1..5 (higher is faster). */
  readonly speed: number;
  /** Skill, 1..5 (higher means fewer clumsy mistakes). */
  readonly skill: number;
  /** Coins paid every cycle. */
  readonly wage: number;
  /** Personality traits. */
  readonly traits: readonly StaffTrait[];
}

/** One hired worker. */
export interface StaffState {
  /** Candidate id. */
  readonly id: string;
  readonly name: string;
  readonly speed: number;
  readonly skill: number;
  readonly wage: number;
  readonly traits: readonly StaffTrait[];
  /** Current job. */
  readonly role: StaffRole;
  /** Last time this worker performed a job. */
  readonly lastWorkAt: number;
  /** Last time wages were settled. */
  readonly lastPaidAt: number;
  /** Consecutive unpaid settles; three and the worker quits. */
  readonly unpaid: number;
}

/** Labour market rotation and slot rules. */
export const STAFF_MARKET_MS = 4 * 60 * 60_000;
export const STAFF_SLOTS = 1;
export const STAFF_QUIT_UNPAID = 3;

/** Names used by the deterministic labour market. */
export const STAFF_NAMES: readonly string[] = [
  "Minh",
  "Lan",
  "Hùng",
  "Trang",
  "Dũng",
  "Hoa",
  "Tuấn",
  "Mai",
  "Phúc",
  "Linh",
  "Sơn",
  "Thảo",
];

/** @brief Current labour market window. */
export function staffWindowAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / STAFF_MARKET_MS);
}

/** @brief Deterministic labour market for one player (three candidates). */
export function staffMarketAt(playerId: string, now: number): StaffDefinition[] {
  const window = staffWindowAt(now);
  const rng = createRng(hash32(`staff:${playerId}:${window}`));
  const badTraits: StaffTrait[] = ["lazy", "slow", "clumsy", "greedy"];
  const goodTraits: StaffTrait[] = ["diligent", "greenThumb"];
  const candidates: StaffDefinition[] = [];
  for (let index = 0; index < 3; index += 1) {
    const name = STAFF_NAMES[Math.floor(rng() * STAFF_NAMES.length)] ?? "Minh";
    const speed = 1 + Math.floor(rng() * 5);
    const skill = 1 + Math.floor(rng() * 5);
    const wage = 400 + speed * 80 + skill * 80;
    const traits: StaffTrait[] = [];
    for (let pick = 0; pick < 2; pick += 1) {
      const trait = badTraits[Math.floor(rng() * badTraits.length)];
      if (trait !== undefined && !traits.includes(trait)) traits.push(trait);
    }
    if (rng() < 0.3) {
      const good = goodTraits[Math.floor(rng() * goodTraits.length)];
      if (good !== undefined) traits.push(good);
    }
    candidates.push({ id: `s${window}-${index}`, name, speed, skill, wage, traits });
  }
  return candidates;
}

/** @brief One-off hiring fee for a candidate. */
export function staffHireCost(candidate: StaffDefinition): number {
  return 50_000 + candidate.speed * 10_000 + candidate.skill * 15_000;
}

/** One NPC produce contract. */
export interface ContractOffer {
  /** Stable id within the rotation window. */
  readonly id: string;
  /** Required product. */
  readonly product: ProductId;
  /** Required quality stars. */
  readonly star: number;
  /** Required units. */
  readonly qty: number;
  /** Coin reward. */
  readonly reward: number;
  /** Server time the board rotates. */
  readonly endsAt: number;
}

/** One traveling-merchant offer. */
export interface MerchantOffer {
  /** Stable id within the rotation window. */
  readonly id: string;
  /** Either a seed or a rare tool. */
  readonly kind: "seed" | "tool";
  /** Seed/tool id. */
  readonly item: SeedId | ToolId;
  /** Units available. */
  readonly stock: number;
  /** Price per unit. */
  readonly price: number;
  /** Server time the merchant leaves. */
  readonly endsAt: number;
}

/** One locked sale price. */
export interface FutureLock {
  /** Crop/fruit id. */
  readonly item: ItemId;
  /** Guaranteed unit price. */
  readonly price: number;
  /** Units still locked. */
  readonly qty: number;
  /** Expiry. */
  readonly expiresAt: number;
}

/** One achievement definition. */
export interface AchievementDefinition {
  /** Stable id. */
  readonly id: string;
  /** Coin reward. */
  readonly coins: number;
  /** Optional seed reward. */
  readonly seed?: SeedId;
  /** Optional seed quantity. */
  readonly seedQty?: number;
}

/** Achievements tracked from the lifetime stats. */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: "firstMillion", coins: 50_000 },
  { id: "hundredHarvests", coins: 20_000, seed: "pumpkin", seedQty: 2 },
  { id: "fiveStars", coins: 30_000 },
  { id: "allTabs", coins: 100_000, seed: "ginseng", seedQty: 1 },
  { id: "collector", coins: 60_000 },
];

/** One wheel prize. */
export interface WheelPrize {
  /** Prize label used by the client. */
  readonly kind: "coins" | "seed" | "supply" | "tool";
  /** Amount/id payload. */
  readonly value: string | number;
}

/** Extras state carried by every snapshot. */
export interface ExtrasSnapshot {
  /** Consecutive daily logins. */
  readonly streak: number;
  /** Last day index counted. */
  readonly lastStreakDay: number;
  /** Claimed achievement ids. */
  readonly achievements: readonly string[];
  /** Discovered collection keys, e.g. `seed:carrot`, `effect:golden`. */
  readonly collection: readonly string[];
  /** Greenhouse level, 0..3. */
  readonly greenhouse: number;
  /** Pet level (legacy field, unused by the gacha system). */
  readonly pet: number;
  /** Owned pets by id (level = copies). */
  readonly pets: Readonly<Partial<Record<PetId, number>>>;
  /** Currently equipped pet. */
  readonly equippedPet: PetId | null;
  /** Last hatched pet id. */
  readonly lastHatch: string;
  /** Insurance expiry. */
  readonly insuranceUntil: number;
  /** Society genetics bonus in percentage points. */
  readonly spliceBonus: number;
  /** Wheel spins so far and spins without a rare prize. */
  readonly wheelSpins: number;
  readonly wheelPity: number;
  /** Last wheel prize key, for the client toast. */
  readonly wheelLast: string;
  /** Active sale-price locks. */
  readonly futures: readonly FutureLock[];
  /** Claimed contract ids for the current board. */
  readonly contractClaims: readonly string[];
  /** Claimed merchant ids for the current rotation. */
  readonly merchantClaims: readonly string[];
  /** Current weekly tournament bucket and its stats. */
  readonly weekKey: number;
  readonly weekEarned: number;
  readonly weekHarvested: number;
  /** Hired staff and their slots. */
  readonly staff: readonly StaffState[];
}

/** @brief Day index since epoch. */
export function dayIndexAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / DAY_MS);
}

/** @brief Current contract rotation window. */
export function contractWindowAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / CONTRACT_WINDOW_MS);
}

/** @brief Current merchant rotation window. */
export function merchantWindowAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / MERCHANT_WINDOW_MS);
}

/** @brief Current weekly tournament key. */
export function weekKeyAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / WEEK_MS);
}

/** @brief Deterministic NPC contract board for one player. */
export function contractOffers(playerId: string, now: number): ContractOffer[] {
  const window = contractWindowAt(now);
  const rng = createRng(hash32(`contracts:${playerId}:${window}`));
  const products = PRODUCTS.filter((product) => product.base > 0);
  const offers: ContractOffer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const product = products[Math.floor(rng() * products.length)];
    if (product === undefined) continue;
    const star = 1 + Math.floor(rng() * 3);
    const qty = 3 + Math.floor(rng() * 10);
    const reward = Math.round(product.base * 2 ** (star - 1) * qty * 1.5);
    offers.push({
      id: `c${window}-${index}`,
      product: product.id,
      star,
      qty,
      reward,
      endsAt: EPOCH_MS + (window + 1) * CONTRACT_WINDOW_MS,
    });
  }
  return offers;
}

/** @brief Deterministic traveling merchant for one player. */
export function merchantOffers(playerId: string, now: number): MerchantOffer[] {
  const window = merchantWindowAt(now);
  const rng = createRng(hash32(`merchant:${playerId}:${window}`));
  const pool = SEEDS.filter((seed) => seed.rare === true);
  const offers: MerchantOffer[] = [];
  const seed = pool[Math.floor(rng() * Math.max(1, pool.length))];
  if (seed !== undefined) {
    offers.push({
      id: `m${window}-seed`,
      kind: "seed",
      item: seed.id,
      stock: 1,
      price: seed.buy * 4,
      endsAt: EPOCH_MS + (window + 1) * MERCHANT_WINDOW_MS,
    });
  }
  const tool = TOOLS[Math.floor(rng() * TOOLS.length)];
  if (tool !== undefined) {
    offers.push({
      id: `m${window}-tool`,
      kind: "tool",
      item: tool.id,
      stock: 1,
      price: tool.price * 2,
      endsAt: EPOCH_MS + (window + 1) * MERCHANT_WINDOW_MS,
    });
  }
  return offers;
}

/** @brief Next event windows for the toolbar forecast. */
export function forecastEvents(now: number, waves = 3): EventSnapshot[][] {
  const wave = Math.floor((now - EPOCH_MS) / EVENT_WAVE_MS);
  const out: EventSnapshot[][] = [];
  for (let step = 0; step < waves; step += 1) {
    const start = EPOCH_MS + (wave + 1 + step) * EVENT_WAVE_MS;
    out.push(
      eventsAt(start).map((event) => ({
        id: event.id,
        startedAt: start,
        endsAt: start + EVENT_WAVE_MS,
      })),
    );
  }
  return out;
}

/** Full owner snapshot; every response carries one. */
export interface GardenSnapshot {
  /** Wire protocol version. */
  readonly version: typeof GARDEN_PROTOCOL_VERSION;
  /** Stable player id; never derived from the nickname. */
  readonly playerId: string;
  /** Current display name, changeable at any time. */
  readonly nick: string;
  /** Avatar colour. */
  readonly color: string;
  /** Public share code, e.g. `G7K2QX`. */
  readonly code: string;
  /** Spendable coins. */
  readonly coins: number;
  /** Bought tabs, `STARTING_TABS..MAX_TABS`. */
  readonly tabs: number;
  /** Open crop patches per tab (1..9), in tab order. */
  readonly unlockedPatches: readonly number[];
  /** Crop slots for the owned tabs, `tabs * CROPS_PER_TAB` entries. */
  readonly plots: readonly (PlotState | null)[];
  /** Fruit tree slots for the owned tabs, `tabs * TREES_PER_TAB` entries. */
  readonly trees: readonly (TreeState | null)[];
  /** Seeds and harvested crops. */
  readonly bag: BagState;
  /** Building levels: 0 means not built. */
  readonly buildings: Readonly<Record<BuildingId, number>>;
  /** Animals per building slot. */
  readonly animals: Readonly<Record<BuildingId, readonly (AnimalState | null)[]>>;
  /** Last time farm upkeep and production were settled. */
  readonly farmSettledAt: number;
  /** Warehouse and built machines. */
  readonly warehouse: WarehouseState;
  /** Fertility percent per crop cell, index = absolute slot. */
  readonly soil: readonly number[];
  /** All extra systems: streak, achievements, wheel, contracts, etc. */
  readonly extras: ExtrasSnapshot;
  /** Lifetime counters. */
  readonly stats: GardenStats;
  /** Revision bumped on every write; actions echo it to reject stale tabs. */
  readonly rev: number;
  /** Server time of the last write. */
  readonly updatedAt: number;
}

/** Public read-only view of someone else's garden. */
export interface VisitSnapshot {
  /** Current display name. */
  readonly nick: string;
  /** Avatar colour. */
  readonly color: string;
  /** Public share code. */
  readonly code: string;
  /** Spendable coins. */
  readonly coins: number;
  /** Bought tabs. */
  readonly tabs: number;
  /** Open crop patches per tab (1..9). */
  readonly unlockedPatches: readonly number[];
  /** Crop slots. */
  readonly plots: readonly (PlotState | null)[];
  /** Fruit tree slots. */
  readonly trees: readonly (TreeState | null)[];
  /** Seeds and harvested crops. */
  readonly bag: BagState;
  /** Building levels: 0 means not built. */
  readonly buildings: Readonly<Record<BuildingId, number>>;
  /** Animals per building slot. */
  readonly animals: Readonly<Record<BuildingId, readonly (AnimalState | null)[]>>;
  /** Warehouse and its machines. */
  readonly warehouse: WarehouseState;
  /** Fertility percent per crop cell. */
  readonly soil: readonly number[];
  /** Extra systems snapshot. */
  readonly extras: ExtrasSnapshot;
  /** Lifetime counters. */
  readonly stats: GardenStats;
  /** Server time of the last write. */
  readonly updatedAt: number;
  /** Server time of the last time the owner opened or changed the garden. */
  readonly lastSeen: number;
  /** Whether the owner touched the garden recently. */
  readonly online: boolean;
  /** Recent helpers, most recent first. */
  readonly visitors: readonly VisitorSummary[];
}

/** One player who helped a garden. */
export interface VisitorSummary {
  /** Stable visitor id. */
  readonly playerId: string;
  /** Display name at visit time. */
  readonly nick: string;
  /** Avatar colour at visit time. */
  readonly color: string;
  /** Server time of the last visit. */
  readonly visitedAt: number;
  /** Crops this visitor watered. */
  readonly waters: number;
  /** Cheers this visitor left. */
  readonly cheers: number;
}

/** One event window. */
export interface EventSnapshot {
  /** Event id. */
  readonly id: EventId;
  /** Server time the window opened. */
  readonly startedAt: number;
  /** Server time the window closes. */
  readonly endsAt: number;
}

/** One row of the seed shop. */
export interface ShopOffer {
  /** Seed on sale. */
  readonly seed: SeedId;
  /** Current asking price. */
  readonly price: number;
  /** Units available to this player this rotation. */
  readonly stock: number;
}

/** Soil fertility of a fresh cell, in percent. */
export const SOIL_START = 100;

/** Fertility lost by one planting cycle, in percent. */
export const SOIL_STEP = 5;

/** Renovation price for one 5% step of one cell, in coins. */
export const SOIL_RENOVATE_STEP_COST = 10;

/** @brief Growth time multiplier from soil fertility. */
export function soilGrowthFactor(fertility: number): number {
  const clamped = Math.max(0, Math.min(100, fertility));
  // 100% soil grows at normal speed, 0% takes twice as long.
  return 2 - clamped / 100;
}

/** @brief Renovation price to bring one cell back to 100%. */
export function soilRenovateCost(fertility: number): number {
  const missing = Math.max(0, Math.min(100, 100 - Math.floor(fertility)));
  return Math.ceil(missing / SOIL_STEP) * SOIL_RENOVATE_STEP_COST;
}

/** Sell value multiplier while a plant is infested. */
export const PEST_VALUE_MULTIPLIER = 0.5;

/** Coins charged to spray one plant with pesticide. */
export const PEST_SPRAY_COST = 100;

/** Protection after one pesticide spray: one day. */
export const PEST_PROTECTION_MS = 24 * 60 * 60_000;

/** Growth slowdown applied when pests strike (remaining time x this). */
export const PEST_GROWTH_PENALTY = 1.5;

/** Chance per cycle that an unprotected plant catches pests. */
export const PEST_CHANCE_PER_CYCLE = 0.04;

/** Flat tax rate on every sale income. */
export const SELL_TAX_RATE = 0.1;

/** Coins charged per plant watered by the bulk "water all" action. */
export const WATER_ALL_COST = 5;

/** Coins charged per ready plant harvested by "harvest all". */
export const HARVEST_ALL_COST = 20;

/** Market cycle length: prices retune every six minutes. */
export const MARKET_CYCLE_MS = 6 * 60_000;

/** Units sold in a cycle that the market treats as "normal" demand. */
export const MARKET_SOLD_TARGET = 8;

/** Below this many units sold, the sell price stays unchanged. */
export const MARKET_LOW_VOLUME = 3;

/** Consecutive empty cycles before an unsold item starts gaining value. */
export const MARKET_EMPTY_CYCLES = 2;

/** Sell-price step when 10..25 units are sold. */
export const MARKET_SELL_LIGHT_STEP = 0.95;

/** Sell-price step when more than 25 units are sold. */
export const MARKET_SELL_HEAVY_STEP = 0.75;

/** Sell-price step once an item has been unsold for more than two cycles. */
export const MARKET_SELL_RISE_STEP = 1.2;

/** Purchase-price step when a seed/supply is bought in volume. */
export const MARKET_BUY_RISE_STEP = 1.1;

/** Purchase-price decay toward the base when buying slows down. */
export const MARKET_BUY_DECAY = 0.9;

/** Ceiling for purchase prices: at most 3x the base. */
export const MARKET_BUY_MAX = 3;

/** Floor for a crashed price: the base can lose at most 70%. */
export const MARKET_MIN_MULTIPLIER = 0.3;

/** Ceiling for a starved price: the base can gain at most 500%. */
export const MARKET_MAX_MULTIPLIER = 6;

/** One item row of the live market board. */
export interface MarketQuoteItem {
  /** Seed or tree id. */
  readonly item: ItemId;
  /** Season base price before market pressure. */
  readonly base: number;
  /** Current pressure multiplier. */
  readonly multiplier: number;
  /** Previous cycle multiplier, for the trend arrow. */
  readonly previous: number;
  /** Effective price, i.e. base times multiplier. */
  readonly price: number;
  /** Units sold in the running cycle. */
  readonly sold: number;
}

/** One buyable row (seed or supply) of the live market board. */
export interface MarketOfferItem {
  /** Seed or supply id. */
  readonly item: SeedId | SupplyId;
  /** Whether this row is a seed or a supply. */
  readonly kind: "seed" | "supply";
  /** Base purchase price before market pressure. */
  readonly base: number;
  /** Current purchase multiplier, never below 1. */
  readonly multiplier: number;
  /** Previous cycle multiplier, for the trend arrow. */
  readonly previous: number;
  /** Effective purchase price. */
  readonly price: number;
  /** Units bought in the running cycle. */
  readonly bought: number;
}

/** Global market pressure snapshot. */
export interface MarketSnapshot {
  /** Running market cycle index. */
  readonly cycle: number;
  /** Server time the cycle rolls over. */
  readonly nextCycleAt: number;
  /** Normal demand used by the pressure formula. */
  readonly soldTarget: number;
  /** One row per sellable item. */
  readonly items: readonly MarketQuoteItem[];
  /** Purchase rows for seeds and supplies. */
  readonly offers: readonly MarketOfferItem[];
}

/** @brief Market cycle index for one server time. */
export function marketCycleAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / MARKET_CYCLE_MS);
}

/** @brief Server time the current market cycle ends. */
export function marketCycleEndsAt(now: number): number {
  return EPOCH_MS + (marketCycleAt(now) + 1) * MARKET_CYCLE_MS;
}

/**
 * @brief Next sell-side state from one cycle of sales.
 * @param previous Current multiplier (clamped 0.3..6).
 * @param emptyCycles Consecutive cycles with no sales so far.
 * @param sold Units sold during the cycle.
 * @details Any supply pushes the price down (light under 8, heavy over 8);
 * under three units it stays put. Only the third empty cycle in a row starts
 * raising it, 20% per cycle.
 */
export function nextSellState(
  previous: number,
  emptyCycles: number,
  sold: number,
): { multiplier: number; emptyCycles: number } {
  const clamp = (value: number): number =>
    Math.min(MARKET_MAX_MULTIPLIER, Math.max(MARKET_MIN_MULTIPLIER, value));
  if (sold <= 0) {
    const nextEmpty = emptyCycles + 1;
    const multiplier = nextEmpty > MARKET_EMPTY_CYCLES ? clamp(previous * MARKET_SELL_RISE_STEP) : previous;
    return { multiplier, emptyCycles: nextEmpty };
  }
  const step =
    sold > MARKET_SOLD_TARGET
      ? MARKET_SELL_HEAVY_STEP
      : sold >= MARKET_LOW_VOLUME
        ? MARKET_SELL_LIGHT_STEP
        : 1;
  return { multiplier: clamp(previous * step), emptyCycles: 0 };
}

/**
 * @brief Next purchase multiplier from one cycle of buys.
 * @param previous Current multiplier (1..3).
 * @param bought Units bought during the cycle.
 * @details High demand raises the price 10%; quiet demand decays it 10% back
 * toward the base. It never falls below the base price.
 */
export function nextBuyMultiplier(previous: number, bought: number): number {
  if (bought > MARKET_SOLD_TARGET) {
    return Math.min(MARKET_BUY_MAX, previous * MARKET_BUY_RISE_STEP);
  }
  if (bought >= MARKET_LOW_VOLUME) return previous;
  return Math.max(1, 1 + (previous - 1) * MARKET_BUY_DECAY);
}

/** @brief Every buyable seed/supply with its base purchase price. */
export function marketBuyBaseItems(
  season?: SeasonSnapshot,
): Array<{ item: SeedId | SupplyId; kind: "seed" | "supply"; base: number }> {
  const rows: Array<{ item: SeedId | SupplyId; kind: "seed" | "supply"; base: number }> = [];
  for (const seed of SEEDS) {
    // The rotation discount is part of the base; market pressure stacks on it.
    const offer = season?.shop.offers.find((entry) => entry.seed === seed.id);
    rows.push({ item: seed.id, kind: "seed", base: offer?.price ?? seed.buy });
  }
  for (const supply of [...FERTILIZERS, ...SPRAYS]) {
    rows.push({ item: supply.id, kind: "supply", base: supply.price });
  }
  return rows;
}

/** @brief Applies purchase pressure to a season snapshot. */
export function applyBuyMarket(
  season: SeasonSnapshot,
  multipliers: Readonly<Partial<Record<string, number>>>,
): SeasonSnapshot {
  const buyPrices: Record<string, number> = {};
  for (const row of marketBuyBaseItems(season)) {
    const pressure = multipliers[row.item] ?? 1;
    buyPrices[row.item] = Math.max(1, Math.round(row.base * pressure));
  }
  return { ...season, buyPrices };
}

/** @brief Base exchange price of one item before market pressure. */
export function basePriceOf(item: ItemId, season: SeasonSnapshot): number {
  const seed = seedById(item);
  if (seed !== undefined) return season.prices[seed.id] ?? 0;
  const tree = treeById(item);
  return tree === undefined ? 0 : (season.fruitPrices[tree.id] ?? 0);
}

/** @brief Every sellable item with its season base price. */
export function marketBaseItems(season: SeasonSnapshot): Array<{ item: ItemId; base: number }> {
  const rows: Array<{ item: ItemId; base: number }> = [];
  for (const seed of SEEDS) rows.push({ item: seed.id, base: season.prices[seed.id] ?? 0 });
  for (const tree of TREES) rows.push({ item: tree.id, base: season.fruitPrices[tree.id] ?? 0 });
  return rows;
}

/**
 * @brief Applies market multipliers to one season snapshot.
 * @param season Base season prices.
 * @param multipliers Pressure per item; missing items stay at base price.
 */
export function applyMarket(
  season: SeasonSnapshot,
  multipliers: Readonly<Partial<Record<ItemId, number>>>,
): SeasonSnapshot {
  const prices = { ...season.prices };
  for (const seed of SEEDS) {
    const pressure = multipliers[seed.id];
    if (pressure !== undefined) prices[seed.id] = Math.max(1, Math.round((prices[seed.id] ?? 0) * pressure));
  }
  const fruitPrices = { ...season.fruitPrices };
  for (const tree of TREES) {
    const pressure = multipliers[tree.id];
    if (pressure !== undefined) {
      fruitPrices[tree.id] = Math.max(1, Math.round((fruitPrices[tree.id] ?? 0) * pressure));
    }
  }
  return { ...season, prices, fruitPrices };
}

/** Everything that changes with the server clock. */
export interface SeasonSnapshot {
  /** Rotation index of the current event wave. */
  readonly wave: number;
  /** Current event window (primary event for labels). */
  readonly event: EventSnapshot;
  /** Every weather event running right now; empty on a calm wave. */
  readonly events: readonly EventSnapshot[];
  /** Every weather event that will run in the next window. */
  readonly nextEvents: readonly EventSnapshot[];
  /** Event sets for the next few windows, for the forecast panel. */
  readonly forecast: readonly (readonly EventSnapshot[])[];
  /** Event window after this one, for the countdown. */
  readonly next: EventSnapshot;
  /** Seed shop offers and when they rotate. */
  readonly shop: {
    /** Server time of the next restock. */
    readonly restockAt: number;
    /** One offer per seed. */
    readonly offers: readonly ShopOffer[];
    /** Rare tools that happen to be in stock this restock. */
    readonly tools: readonly ShopToolOffer[];
  };
  /** Exchange price per seed for a plain crop. */
  readonly prices: Readonly<Record<SeedId, number>>;
  /** Exchange price per tree for one plain fruit. */
  readonly fruitPrices: Readonly<Record<TreeId, number>>;
  /** Market-adjusted purchase prices for seeds and supplies, when known. */
  readonly buyPrices?: Readonly<Record<string, number>>;
}

/** One leaderboard row. */
export interface LeaderboardEntry {
  /** Public share code; also the visit key. */
  readonly code: string;
  /** Current display name. */
  readonly nick: string;
  /** Avatar colour. */
  readonly color: string;
  /** Coins earned by selling. */
  readonly earned: number;
  /** Coins spent on seeds, land and services. */
  readonly spent?: number;
  /** Coins currently in the wallet. */
  readonly coins?: number;
  /** Crops harvested. */
  readonly harvested: number;
  /** Server time of the last update. */
  readonly updatedAt: number;
}

/** Actions the owner can apply to their garden. */
export type GardenAction =
  | { readonly kind: "plant"; readonly slot: number; readonly seed: SeedId }
  | { readonly kind: "plantTree"; readonly slot: number; readonly tree: TreeId }
  | { readonly kind: "harvest"; readonly slot: number; readonly tree: boolean }
  | { readonly kind: "water"; readonly slot: number; readonly tree: boolean }
  | {
      readonly kind: "fertilize";
      readonly slot: number;
      readonly tree: boolean;
      readonly supply: FertilizerId;
    }
  | { readonly kind: "spray"; readonly slot: number; readonly tree: boolean; readonly supply: SprayId }
  | { readonly kind: "uproot"; readonly slot: number; readonly tree: boolean }
  | { readonly kind: "buyTab" }
  | { readonly kind: "buyPatch"; readonly tab: number }
  | { readonly kind: "waterAll" }
  | { readonly kind: "harvestAll" }
  | { readonly kind: "buildBuilding"; readonly building: BuildingId }
  | { readonly kind: "upgradeBuilding"; readonly building: BuildingId }
  | {
      readonly kind: "buyAnimal";
      readonly building: BuildingId;
      readonly slot: number;
      readonly animal: AnimalId;
    }
  | { readonly kind: "patAnimal"; readonly building: BuildingId; readonly slot: number }
  | { readonly kind: "sellProduct"; readonly product: ProductId; readonly star: number; readonly qty: number }
  | { readonly kind: "sellAllProducts" }
  | { readonly kind: "buyTool"; readonly tool: ToolId; readonly qty: number }
  | { readonly kind: "buildWarehouse" }
  | { readonly kind: "renovateSoil" }
  | { readonly kind: "fulfillContract"; readonly id: string }
  | { readonly kind: "buyMerchant"; readonly id: string }
  | { readonly kind: "buyInsurance" }
  | { readonly kind: "lockFuture"; readonly item: ItemId; readonly qty: number }
  | { readonly kind: "spliceCrops"; readonly item: ItemId }
  | { readonly kind: "compostCrops" }
  | { readonly kind: "buyGreenhouse" }
  | { readonly kind: "hatchEgg" }
  | { readonly kind: "hireStaff"; readonly id: string }
  | { readonly kind: "fireStaff"; readonly index: number }
  | { readonly kind: "setStaffRole"; readonly index: number; readonly role: StaffRole }
  | { readonly kind: "equipPet"; readonly pet: PetId }
  | { readonly kind: "spinWheel" }
  | {
      readonly kind: "sellCrop";
      readonly item: ItemId;
      readonly effects: readonly EffectId[];
      readonly pest?: boolean;
      readonly qty: number;
    }
  | { readonly kind: "sprayPest"; readonly slot: number; readonly tree: boolean }
  | { readonly kind: "sprayPestAll" }
  | { readonly kind: "buildMachine"; readonly machine: MachineId }
  | { readonly kind: "upgradeMachine"; readonly machine: MachineId }
  | {
      readonly kind: "craftMachine";
      readonly machine: MachineId;
      readonly item?: ItemId;
    }
  | { readonly kind: "buySeed"; readonly seed: SeedId; readonly qty: number }
  | { readonly kind: "buySupply"; readonly supply: SupplyId; readonly qty: number }
  | { readonly kind: "sellAll" };

/** Error codes; the client localizes them, the server never sends prose. */
export type GardenErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NO_GARDEN"
  | "STALE_REV"
  | "RATE_LIMITED"
  | "TRY_LATER"
  | "BAD_CODE"
  | "BAD_RECOVERY"
  | "CODE_EXISTS"
  | "NOT_ENOUGH_COINS"
  | "PLOT_LOCKED"
  | "PLOT_OCCUPIED"
  | "PLOT_EMPTY"
  | "NOT_READY"
  | "ALREADY_WATERED"
  | "ALREADY_FERTILIZED"
  | "NO_SEED"
  | "NO_SUPPLY"
  | "SHOP_SOLD_OUT"
  | "NO_CROP"
  | "NOTHING_TO_SELL"
  | "MAX_TABS"
  | "MAX_PATCHES"
  | "NOTHING_TO_DO"
  | "BUILDING_LOCKED"
  | "MAX_LEVEL"
  | "SLOT_OUT_OF_RANGE"
  | "SLOT_OCCUPIED"
  | "SLOT_EMPTY"
  | "NO_PRODUCT"
  | "TOOL_SOLD_OUT"
  | "WAREHOUSE_LOCKED"
  | "MACHINE_LOCKED"
  | "MACHINE_MAX"
  | "MACHINE_COOLDOWN"
  | "NO_INPUT"
  | "NOTHING_TO_RENOVATE"
  | "NO_CONTRACT"
  | "MERCHANT_GONE"
  | "ALREADY_CLAIMED"
  | "NO_PET"
  | "STAFF_FULL"
  | "NO_CANDIDATE"
  | "CANNOT_VISIT_SELF";

/** Successful response to a garden action. */
export interface GardenActResponse {
  /** Updated owner snapshot. */
  readonly state: GardenSnapshot;
  /** Season the action was validated against, already market-adjusted. */
  readonly season: SeasonSnapshot;
  /** Server clock when the action was applied. */
  readonly serverNow: number;
  /** Global market board at write time. */
  readonly market?: MarketSnapshot;
  /** Units of each item this action sold into the market. */
  readonly sold?: Readonly<Record<string, number>>;
  /** Units of each seed/supply this action bought from the market. */
  readonly bought?: Readonly<Record<string, number>>;
}

/** Successful response to a state read. */
export interface GardenStateResponse {
  /** Owner snapshot. */
  readonly state: GardenSnapshot;
  /** Current season snapshot, already market-adjusted. */
  readonly season: SeasonSnapshot;
  /** Server clock. */
  readonly serverNow: number;
  /** Global market board; the chart tab reads this. */
  readonly market?: MarketSnapshot;
}

/** Credentials the browser keeps in `localStorage`. */
export interface GardenCredentials {
  /** Stable player id. */
  readonly playerId: string;
  /** Write token; rotated by a restore. */
  readonly token: string;
}

/** @brief Looks one seed up by id. */
export function seedById(id: string): SeedDefinition | undefined {
  return SEEDS.find((seed) => seed.id === id);
}

/** @brief Looks one fruit tree up by id. */
export function treeById(id: string): TreeDefinition | undefined {
  return TREES.find((tree) => tree.id === id);
}

/**
 * @brief Looks one bag item up in either catalog.
 * @param id Seed or tree id.
 * @return The seed or tree definition, or `undefined` when unknown.
 */
export function itemById(id: string): SeedDefinition | TreeDefinition | undefined {
  return seedById(id) ?? treeById(id);
}

/** @brief Looks one fertilizer up by id. */
export function fertilizerById(id: string): FertilizerDefinition | undefined {
  return FERTILIZERS.find((entry) => entry.id === id);
}

/** @brief Looks one spray up by id. */
export function sprayById(id: string): SprayDefinition | undefined {
  return SPRAYS.find((entry) => entry.id === id);
}

/** @brief Looks one supply up in either catalog. */
export function supplyById(id: string): FertilizerDefinition | SprayDefinition | undefined {
  return fertilizerById(id) ?? sprayById(id);
}

/** @brief Whether a supply id is a fertilizer. */
export function isFertilizer(id: string): id is FertilizerId {
  return fertilizerById(id) !== undefined;
}

/** @brief Whether a supply id is a spray. */
export function isSpray(id: string): id is SprayId {
  return sprayById(id) !== undefined;
}

/** @brief Looks one effect up by id. */
export function effectById(id: string): EffectDefinition | undefined {
  return EFFECTS.find((effect) => effect.id === id);
}

/**
 * @brief Picks the strongest mutation for compact display.
 * @param effects Mutations on one fruit; order is ignored.
 * @details Ties keep the catalog order, so the cell never flickers between two
 * equal multipliers.
 */
export function strongestEffect(effects: readonly EffectId[]): EffectDefinition | null {
  let best: EffectDefinition | null = null;
  for (const effect of EFFECTS) {
    if (!effects.includes(effect.id)) continue;
    if (best === null || effect.multiplier > best.multiplier) best = effect;
  }
  return best;
}

/**
 * @brief Combined value multiplier of a mutation set.
 * @param effects Mutations on one fruit.
 */
export function effectsMultiplier(effects: readonly EffectId[]): number {
  return effects.reduce((total, id) => total * (effectById(id)?.multiplier ?? 1), 1);
}

/** @brief Looks one event up by id. */
export function eventById(id: string): EventDefinition | undefined {
  return EVENTS.find((event) => event.id === id);
}

/** @brief Crop slots owned with `tabs` bought tabs. */
export function totalCrops(tabs: number): number {
  return tabs * CROPS_PER_TAB;
}

/** @brief Fruit tree slots owned with `tabs` bought tabs. */
export function totalTrees(tabs: number): number {
  return tabs * TREES_PER_TAB;
}

/**
 * @brief Price of the next crop patch inside a tab.
 * @param unlockedPatches Patches already open in that tab (1..9).
 * @details Base x 2^bought: 5,000 -> 10,000 -> 20,000 -> 40,000 ...
 */
export function nextPatchPrice(unlockedPatches: number): number {
  // The free starting patch is not bought, so `unlockedPatches - 1` is exactly
  // the number of patches already purchased in this tab.
  return PATCH_BASE_PRICE * PATCH_PRICE_FACTOR ** Math.max(0, unlockedPatches - 1);
}

/**
 * @brief Price of the next tab.
 * @param _tabsOwned Tabs already owned; kept so callers stay unchanged.
 * @details A tab is priced as its last (ninth) crop patch: that patch is bought
 * once eight are open, so it costs 5,000 * 2^7 = 640,000 coins and every tab
 * expansion uses the same price.
 */
export function nextTabPrice(_tabsOwned: number): number {
  return nextPatchPrice(CROP_PATCHES_PER_TAB - 1);
}

/** @brief Wraps a number into `0..modulus-1` for clock math around the epoch. */
export function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** @brief Encodes credentials for the auth header. */
export function formatGardenAuth(credentials: GardenCredentials): string {
  return `${credentials.playerId}.${credentials.token}`;
}

/**
 * @brief Parses the owner auth header.
 * @param raw Header value, or `null`.
 * @return Credentials, or `null` when malformed.
 */
export function parseGardenAuth(raw: string | null): GardenCredentials | null {
  if (raw === null) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const playerId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  if (!PLAYER_ID_RE.test(playerId)) return null;
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return { playerId, token };
}

/** @brief Whether a value is a valid public garden code. */
export function isGardenCode(value: unknown): value is string {
  return typeof value === "string" && GARDEN_CODE_RE.test(value);
}

/** @brief Whether a value is a valid recovery key. */
export function isRecoveryKey(value: unknown): value is string {
  return typeof value === "string" && RECOVERY_RE.test(value);
}

/** @brief Canonical effect order for bag keys and comparisons. */
export function canonicalEffects(effects: readonly EffectId[]): EffectId[] {
  const unique = new Set(effects);
  return EFFECTS.filter((effect) => unique.has(effect.id)).map((effect) => effect.id);
}

/** @brief Builds the bag key for one produce stack. */
export function cropKey(item: ItemId, effects: readonly EffectId[]): string {
  const canonical = canonicalEffects(effects);
  return canonical.length === 0 ? item : `${item}:${canonical.join(":")}`;
}

/**
 * @brief Parses one bag key back into a stack identity.
 * @return The item and its mutation list, or `null` when malformed.
 */
export function parseCropKey(key: string): { item: ItemId; effects: EffectId[] } | null {
  const [itemPart, ...effectParts] = key.split(":");
  const item = itemPart === undefined ? undefined : itemById(itemPart);
  if (item === undefined) return null;
  const effects: EffectId[] = [];
  for (const part of effectParts) {
    const effect = effectById(part);
    if (effect === undefined) return null;
    effects.push(effect.id);
  }
  return { item: item.id as ItemId, effects: canonicalEffects(effects) };
}

/**
 * @brief Validates one untrusted action from the wire.
 * @return The action, or `null` when malformed.
 */
export function parseGardenAction(raw: unknown): GardenAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const kind = value.kind;

  if (kind === "plant") {
    const slot = readSlot(value.slot, MAX_CROPS);
    const seed = typeof value.seed === "string" ? seedById(value.seed) : undefined;
    if (slot === null || seed === undefined) return null;
    return { kind, slot, seed: seed.id };
  }
  if (kind === "plantTree") {
    const slot = readSlot(value.slot, MAX_TREES);
    const tree = typeof value.tree === "string" ? treeById(value.tree) : undefined;
    if (slot === null || tree === undefined) return null;
    return { kind, slot, tree: tree.id };
  }
  if (kind === "harvest" || kind === "water" || kind === "uproot") {
    const isTree = value.tree === true;
    const slot = readSlot(value.slot, isTree ? MAX_TREES : MAX_CROPS);
    if (slot === null) return null;
    return { kind, slot, tree: isTree };
  }
  if (kind === "fertilize") {
    const isTree = value.tree === true;
    const slot = readSlot(value.slot, isTree ? MAX_TREES : MAX_CROPS);
    const supply = typeof value.supply === "string" ? fertilizerById(value.supply) : undefined;
    if (slot === null || supply === undefined) return null;
    return { kind, slot, tree: isTree, supply: supply.id };
  }
  if (kind === "spray") {
    const isTree = value.tree === true;
    const slot = readSlot(value.slot, isTree ? MAX_TREES : MAX_CROPS);
    const supply = typeof value.supply === "string" ? sprayById(value.supply) : undefined;
    if (slot === null || supply === undefined) return null;
    return { kind, slot, tree: isTree, supply: supply.id };
  }
  if (kind === "buySupply") {
    const supply = typeof value.supply === "string" ? supplyById(value.supply) : undefined;
    const qty = value.qty;
    if (supply === undefined) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_BUY_QTY) return null;
    return { kind, supply: supply.id as SupplyId, qty };
  }
  if (kind === "buySeed") {
    const seed = typeof value.seed === "string" ? seedById(value.seed) : undefined;
    const qty = value.qty;
    if (
      seed === undefined ||
      typeof qty !== "number" ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > MAX_BUY_QTY
    ) {
      return null;
    }
    return { kind, seed: seed.id, qty };
  }
  if (kind === "sellCrop") {
    const item = typeof value.item === "string" ? itemById(value.item) : undefined;
    const qty = value.qty;
    if (item === undefined) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    const rawEffects = Array.isArray(value.effects) ? value.effects : [];
    const effects: EffectId[] = [];
    for (const rawEffect of rawEffects) {
      if (typeof rawEffect !== "string") return null;
      const effect = effectById(rawEffect);
      if (effect === undefined) return null;
      effects.push(effect.id);
    }
    return {
      kind,
      item: item.id as ItemId,
      effects: canonicalEffects(effects),
      pest: value.pest === true,
      qty,
    };
  }
  if (kind === "buyTab") return { kind };
  if (kind === "buildWarehouse") return { kind };
  if (kind === "renovateSoil") return { kind };
  if (kind === "fulfillContract" || kind === "buyMerchant") {
    const id = typeof value.id === "string" ? value.id : "";
    return id.length === 0 || id.length > 40 ? null : { kind, id };
  }
  if (kind === "buyInsurance") return { kind };
  if (kind === "compostCrops") return { kind };
  if (kind === "buyGreenhouse" || kind === "hatchEgg") return { kind };
  if (kind === "hireStaff") {
    const id = typeof value.id === "string" ? value.id : "";
    return id.length === 0 || id.length > 40 ? null : { kind, id };
  }
  if (kind === "fireStaff") {
    const index = value.index;
    return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < STAFF_SLOTS
      ? { kind, index }
      : null;
  }
  if (kind === "setStaffRole") {
    const index = value.index;
    const role = value.role === "waterer" ? "waterer" : value.role === "gardener" ? "gardener" : undefined;
    if (role === undefined) return null;
    return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < STAFF_SLOTS
      ? { kind, index, role }
      : null;
  }
  if (kind === "equipPet") {
    const pet = typeof value.pet === "string" ? petById(value.pet) : undefined;
    return pet === undefined ? null : { kind, pet: pet.id };
  }
  if (kind === "spinWheel") return { kind };
  if (kind === "lockFuture") {
    const item = typeof value.item === "string" ? itemById(value.item) : undefined;
    const qty = value.qty;
    if (item === undefined) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    return { kind, item: item.id as ItemId, qty };
  }
  if (kind === "spliceCrops") {
    const item = typeof value.item === "string" ? itemById(value.item) : undefined;
    return item === undefined ? null : { kind, item: item.id as ItemId };
  }
  if (kind === "sprayPestAll") return { kind };
  if (kind === "sprayPest") {
    const isTree = value.tree === true;
    const slot = readSlot(value.slot, isTree ? MAX_TREES : MAX_CROPS);
    return slot === null ? null : { kind, slot, tree: isTree };
  }
  if (kind === "buildMachine" || kind === "upgradeMachine") {
    const machine = typeof value.machine === "string" ? machineById(value.machine) : undefined;
    return machine === undefined ? null : { kind, machine: machine.id };
  }
  if (kind === "craftMachine") {
    const machine = typeof value.machine === "string" ? machineById(value.machine) : undefined;
    if (machine === undefined) return null;
    if (value.item === undefined) return { kind, machine: machine.id };
    const item = typeof value.item === "string" ? itemById(value.item) : undefined;
    if (item === undefined) return null;
    return { kind, machine: machine.id, item: item.id as ItemId };
  }
  if (kind === "waterAll" || kind === "harvestAll") return { kind };
  if (kind === "sellAllProducts") return { kind };
  if (kind === "buyTool") {
    const tool = typeof value.tool === "string" ? toolById(value.tool) : undefined;
    const qty = value.qty;
    if (tool === undefined) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 10) return null;
    return { kind, tool: tool.id, qty };
  }
  if (kind === "buildBuilding" || kind === "upgradeBuilding") {
    const building = typeof value.building === "string" ? buildingById(value.building) : undefined;
    return building === undefined ? null : { kind, building: building.id };
  }
  if (kind === "buyAnimal") {
    const building = typeof value.building === "string" ? buildingById(value.building) : undefined;
    const animal = typeof value.animal === "string" ? animalById(value.animal) : undefined;
    const slot = value.slot;
    if (building === undefined || animal === undefined || animal.building !== building.id) return null;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= 12) return null;
    return { kind, building: building.id, slot, animal: animal.id };
  }
  if (kind === "patAnimal") {
    const building = typeof value.building === "string" ? buildingById(value.building) : undefined;
    const slot = value.slot;
    if (building === undefined) return null;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= 12) return null;
    return { kind, building: building.id, slot };
  }
  if (kind === "sellProduct") {
    const product = typeof value.product === "string" ? productById(value.product) : undefined;
    const star = value.star;
    const qty = value.qty;
    if (product === undefined) return null;
    if (typeof star !== "number" || !Number.isInteger(star) || star < 1 || star > 5) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    return { kind, product: product.id, star, qty };
  }
  if (kind === "buyPatch") {
    const tab = value.tab;
    if (typeof tab !== "number" || !Number.isInteger(tab) || tab < 0 || tab >= MAX_TABS) return null;
    return { kind, tab };
  }
  if (kind === "sellAll") return { kind };
  return null;
}

/** @brief Reads a plot slot, or `null` when out of range. */
function readSlot(raw: unknown, limit: number): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw >= limit) return null;
  return raw;
}

/**
 * @brief Builds a deterministic 32-bit hash for a label.
 * @param text Label to hash.
 */
export function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * @brief Builds a deterministic mulberry32 generator.
 * @param seed Integer seed; equal seeds produce equal sequences.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @brief Computes the immutable season snapshot for one server time.
 * @param now Server-clock epoch milliseconds.
 * @details Pure and deterministic: the Worker and every browser produce the
 * same event, offers and prices for the same instant, which is what keeps
 * "consistent seeds and events" true without a shared mutable database row.
 */
export function seasonAt(now: number): SeasonSnapshot {
  const wave = Math.floor((now - EPOCH_MS) / EVENT_WAVE_MS);
  const nextWave = wave + 1;
  const waveStart = EPOCH_MS + wave * EVENT_WAVE_MS;
  const nextStart = EPOCH_MS + nextWave * EVENT_WAVE_MS;
  const currentEvents = eventsAt(waveStart);
  const nextEvents = eventsAt(nextStart);
  const current = currentEvents[0] ?? CALM_EVENT;
  const next = nextEvents[0] ?? CALM_EVENT;

  const restockWave = Math.floor((now - EPOCH_MS) / SHOP_RESTOCK_MS);
  const restockAt = EPOCH_MS + (restockWave + 1) * SHOP_RESTOCK_MS;
  const shopRng = createRng(hash32(`garden:shop:${restockWave}`));
  const toolRng = createRng(hash32(`garden:tools:${restockWave}`));
  const tools: ShopToolOffer[] = [];
  for (const tool of TOOLS) {
    // Rare stock: a restock carries the tool less than twenty percent of the time.
    if (toolRng() < TOOL_STOCK_CHANCE) {
      tools.push({ tool: tool.id, price: tool.price, stock: 1 });
    }
  }

  const eventSeedRng = createRng(hash32(`garden:eventSeeds:${restockWave}`));
  const offers: ShopOffer[] = SEEDS.filter((seed) => seed.rare !== true).map((seed) => {
    const price = Math.max(1, Math.round(seed.buy * (0.85 + shopRng() * 0.3)));
    const stock = 2 + Math.floor(shopRng() * 9);
    return { seed: seed.id, price, stock };
  });
  for (const seed of SEEDS) {
    if (seed.rare !== true) continue;
    if (eventSeedRng() < EVENT_SEED_CHANCE) {
      offers.push({ seed: seed.id, price: seed.buy, stock: 1 });
    }
  }

  const priceRng = createRng(hash32(`garden:price:${restockWave}`));
  const prices = {} as Record<SeedId, number>;
  for (const seed of SEEDS) {
    prices[seed.id] = Math.max(
      1,
      Math.round(seed.sell * (0.85 + priceRng() * 0.3) * combinedSellBonus(currentEvents)),
    );
  }
  const fruitPrices = {} as Record<TreeId, number>;
  for (const tree of TREES) {
    fruitPrices[tree.id] = Math.max(
      1,
      Math.round(tree.sell * (0.85 + priceRng() * 0.3) * combinedSellBonus(currentEvents)),
    );
  }

  return {
    wave,
    event: { id: current.id, startedAt: waveStart, endsAt: waveStart + EVENT_WAVE_MS },
    events: currentEvents.map((event) => ({
      id: event.id,
      startedAt: waveStart,
      endsAt: waveStart + EVENT_WAVE_MS,
    })),
    nextEvents: nextEvents.map((event) => ({
      id: event.id,
      startedAt: nextStart,
      endsAt: nextStart + EVENT_WAVE_MS,
    })),
    forecast: forecastEvents(waveStart, 3),
    next: { id: next.id, startedAt: nextStart, endsAt: nextStart + EVENT_WAVE_MS },
    shop: { restockAt, offers, tools },
    prices,
    fruitPrices,
  };
}

/** @brief Current event definition for a server time. */
export function eventAt(now: number): EventDefinition {
  return eventsAt(now)[0] ?? CALM_EVENT;
}

/** Fallback event used when a wave rolls no weather. */
const CALM_EVENT: EventDefinition = { id: "calm", growScale: 1, sellBonus: 1, effectChances: {} };

/**
 * @brief Weather events active at one instant.
 * @param now Server time.
 * @details Each six-minute wave rolls how many events run at once (one event is
 * the most likely outcome, two and three are rarer) and then picks that many
 * different events deterministically, so every client and the server agree.
 * The result is in catalog order and may be empty (a calm wave).
 */
export function eventsAt(now: number): EventDefinition[] {
  const wave = Math.floor((now - EPOCH_MS) / EVENT_WAVE_MS);
  const rng = createRng(hash32(`garden:events:${wave}`));
  const total = EVENT_COUNT_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  let count = 0;
  for (const entry of EVENT_COUNT_WEIGHTS) {
    roll -= entry.weight;
    if (roll < 0) {
      count = entry.count;
      break;
    }
  }
  if (count === 0) return [];
  const pool = EVENTS.filter((event) => event.id !== "calm");
  const picked = new Set<EventId>();
  while (picked.size < Math.min(count, pool.length)) {
    const candidate = pool[Math.floor(rng() * pool.length)];
    if (candidate !== undefined) picked.add(candidate.id);
  }
  return EVENTS.filter((event) => picked.has(event.id));
}

/** @brief Combined growth speed of every active event. */
export function combinedGrowScale(events: readonly EventDefinition[]): number {
  const product = events.reduce((scale, event) => scale * event.growScale, 1);
  return Math.min(2.5, Math.max(0.4, product));
}

/** @brief Combined sell bonus of every active event. */
export function combinedSellBonus(events: readonly EventDefinition[]): number {
  const product = events.reduce((bonus, event) => bonus * event.sellBonus, 1);
  return Math.min(3, Math.max(0.5, product));
}

/** @brief Rolls the mutation chances of every active event. */
export function rollEffectsFor(
  events: readonly EventDefinition[],
  rng: () => number,
  bonus: Readonly<Partial<Record<EffectId, number>>> = {},
): EffectId[] {
  const rolled = new Set<EffectId>();
  for (const event of events) {
    for (const id of rollEffects(event, rng, bonus)) rolled.add(id);
  }
  return canonicalEffects([...rolled]);
}

/** @brief Growth time under several simultaneous events. */
export function growTimeForEvents(
  plant: { readonly growMs: number },
  events: readonly EventDefinition[],
  fertilizer: ActiveFertilizer | null = null,
): number {
  const multiplier = fertilizer === null ? 1 : (fertilizerById(fertilizer.id)?.growMultiplier ?? 1);
  return Math.max(5_000, Math.round((plant.growMs / combinedGrowScale(events)) * multiplier));
}

/** @brief Growth time for one planting under one event. */
export function growTimeFor(
  plant: { readonly growMs: number },
  event: EventDefinition,
  fertilizer: ActiveFertilizer | null = null,
): number {
  const multiplier = fertilizer === null ? 1 : (fertilizerById(fertilizer.id)?.growMultiplier ?? 1);
  return Math.max(5_000, Math.round((plant.growMs / event.growScale) * multiplier));
}

/**
 * @brief Rolls the planting effect under one event.
 * @param event Event active at planting.
 * @param rng Deterministic random source.
 */
export function rollEffects(
  event: EventDefinition,
  rng: () => number,
  bonus: Readonly<Partial<Record<EffectId, number>>> = {},
): EffectId[] {
  const rolled: EffectId[] = [];
  // One independent roll per weather mutation, in catalog order, so a fruit can
  // carry several mutations at once and the sequence stays deterministic.
  for (const effect of EFFECTS) {
    if (!effect.natural) continue;
    const chance =
      (BASE_EFFECT_CHANCES[effect.id] ?? 0) + (event.effectChances[effect.id] ?? 0) + (bonus[effect.id] ?? 0);
    if (chance <= 0) continue;
    if (rng() < chance) rolled.push(effect.id);
  }
  return rolled;
}

/**
 * @brief Effects the weather adds while a plant grows.
 * @param kindId Seed or tree id; part of the deterministic roll.
 * @param slot Slot index inside its grid; part of the deterministic roll.
 * @param plantedAt Growth start.
 * @param until Growth end (ready time, or now when still growing).
 * @details Every event wave between the plant time and the growth end rolls its
 * own chances independently, and every rolled mutation stacks on the fruit, so
 * one plant can collect every weather effect if it lives long enough.
 */
export function weatherEffects(kindId: string, slot: number, plantedAt: number, until: number): EffectId[] {
  const end = Math.max(plantedAt, until);
  const first = Math.floor((plantedAt - EPOCH_MS) / EVENT_WAVE_MS) + 1;
  const last = Math.floor((end - EPOCH_MS) / EVENT_WAVE_MS);
  const effects = new Set<EffectId>();
  for (let wave = first; wave <= last && wave - first < 200; wave += 1) {
    const events = eventsAt(EPOCH_MS + wave * EVENT_WAVE_MS);
    const rng = createRng(hash32(`${kindId}:${slot}:${wave}`));
    for (const id of rollEffectsFor(events, rng)) effects.add(id);
  }
  return canonicalEffects([...effects]);
}

/** @brief All mutations on a crop: manual ones plus accumulated weather. */
export function resolvedCropEffects(plot: PlotState, until: number): EffectId[] {
  return canonicalEffects([
    ...plot.effects,
    ...weatherEffects(plot.seed, plot.slot, plot.plantedAt, Math.min(until, plot.readyAt)),
  ]);
}

/** @brief All mutations on a fruit tree: manual ones plus accumulated weather. */
export function resolvedTreeEffects(tree: TreeState, until: number): EffectId[] {
  return canonicalEffects([
    ...tree.effects,
    ...weatherEffects(tree.tree, tree.slot, tree.plantedAt, Math.min(until, tree.readyAt)),
  ]);
}

/** Live view of one plot for rendering. */
export interface PlotView {
  /** Seed planted here. */
  readonly seed: SeedDefinition;
  /** Mutations on the crop, possibly several. */
  readonly effects: readonly EffectDefinition[];
  /** Whether the crop can be harvested now. */
  readonly ready: boolean;
  /** Art index: 0 seed, 1 sprout, 2 young, 3 ripe. */
  readonly stage: number;
  /** Milliseconds until ripe; `0` once ready. */
  readonly remainingMs: number;
  /** Growth progress in `0..1`. */
  readonly progress: number;
}

/**
 * @brief Reads the live stage of one crop.
 * @param plot Occupied plot.
 * @param now Clock to measure against, same clock the server used.
 */
export function plotView(plot: PlotState, now: number): PlotView {
  const seed = seedById(plot.seed);
  if (seed === undefined) throw new Error(`Unknown seed: ${plot.seed}`);
  const total = Math.max(1, plot.readyAt - plot.plantedAt);
  const elapsed = Math.max(0, now - plot.plantedAt);
  const ready = now >= plot.readyAt;
  const progress = Math.min(1, elapsed / total);
  const stage = ready ? 3 : Math.min(2, Math.floor(progress * 3));
  return {
    seed,
    effects: resolvedCropEffects(plot, now)
      .map((id) => effectById(id))
      .filter((effect): effect is EffectDefinition => effect !== undefined),
    ready,
    stage,
    remainingMs: Math.max(0, plot.readyAt - now),
    progress,
  };
}

/** Plot counters for the HUD. */
export interface GardenCounts {
  /** Ripe crops. */
  readonly ready: number;
  /** Growing crops. */
  readonly growing: number;
  /** Empty plots. */
  readonly free: number;
}

/**
 * @brief Counts ripe, growing and free slots across crops and fruit trees.
 * @param plots Crop plot states.
 * @param trees Tree states.
 * @param now Clock to measure against.
 */
export function gardenCounts(
  plots: readonly (PlotState | null)[],
  trees: readonly (TreeState | null)[],
  now: number,
): GardenCounts {
  let ready = 0;
  let growing = 0;
  let free = 0;
  for (const plot of plots) {
    if (plot === null) {
      free += 1;
      continue;
    }
    if (now >= plot.readyAt) ready += 1;
    else growing += 1;
  }
  for (const tree of trees) {
    if (tree === null) {
      free += 1;
      continue;
    }
    if (now >= tree.readyAt) ready += 1;
    else growing += 1;
  }
  return { ready, growing, free };
}

/** @brief Sell price of one produce stack under a season snapshot. */
export function cropSellPrice(stack: CropStack, season: SeasonSnapshot): number {
  const multiplier = effectsMultiplier(stack.effects);
  const seed = seedById(stack.item);
  const tree = seed === undefined ? treeById(stack.item) : undefined;
  const base =
    seed === undefined
      ? tree === undefined
        ? 0
        : (season.fruitPrices[tree.id as TreeId] ?? 0)
      : (season.prices[seed.id] ?? 0);
  // Event seeds are worth a lot more while their weather runs.
  const active = new Set(season.events.map((event) => event.id));
  const bonus =
    seed?.eventBonus !== undefined && seed.eventBonus.events.some((id) => active.has(id))
      ? seed.eventBonus.multiplier
      : 1;
  const pest = stack.pest === true ? PEST_VALUE_MULTIPLIER : 1;
  return Math.round(base * multiplier * bonus * pest);
}

/** @brief Total value of every crop in a bag. */
export function bagValue(bag: BagState, season: SeasonSnapshot): number {
  return bag.crops.reduce((total, stack) => total + cropSellPrice(stack, season) * stack.qty, 0);
}
