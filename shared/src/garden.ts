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

/** Special garden: three premium patches of nine plots each. */
export const SPECIAL_PATCHES = 3;
export const SPECIAL_PLOTS_PER_PATCH = 9;
export const SPECIAL_SLOTS = SPECIAL_PATCHES * SPECIAL_PLOTS_PER_PATCH;
/** Legacy patch price; the premium garden now sells plots one by one. */
export const SPECIAL_PATCH_PRICE = 10_000_000_000;
/** Price of the first premium plot. */
export const SPECIAL_PLOT_PRICE = 1_000_000_000;
/** Premium plots grow at twice the normal speed. */
export const SPECIAL_GROW_SCALE = 0.5;
/** Premium crops always carry this mutation, worth twenty times. */
export const SPECIAL_MUTATION: EffectId = "brainrot";
/** Premium harvests always come out at the top quality. */
export const SPECIAL_QUALITY_STARS = 5;
/** Bump to force a one-time wipe of every premium garden. */
export const SPECIAL_RESET_VERSION = 2;

/**
 * @brief Price of the next premium plot.
 * @param owned Plots already bought; every next plot doubles the last price.
 * @details Capped at 2^22 so the result stays in the safe integer range.
 */
export function specialPlotCost(owned: number): number {
  return SPECIAL_PLOT_PRICE * 2 ** Math.min(22, Math.max(0, Math.floor(owned)));
}

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

/** One day-phase rotation: 7m day, 3m dusk, 7m night, 3m dawn. */
export type DayPhaseId = "day" | "dusk" | "night" | "dawn";

/** One phase of the 20-minute day cycle. */
export interface DayPhaseDefinition {
  /** Stable id used by labels and weather pools. */
  readonly id: DayPhaseId;
  /** Length in milliseconds. */
  readonly durationMs: number;
  /** Growth-time multiplier while the phase is current. */
  readonly growScale: number;
}

/** Day, dusk, night, dawn: seven, three, seven and three minutes. */
export const DAY_PHASES: readonly DayPhaseDefinition[] = [
  { id: "day", durationMs: 7 * 60_000, growScale: 1 },
  { id: "dusk", durationMs: 3 * 60_000, growScale: 0.9 },
  { id: "night", durationMs: 7 * 60_000, growScale: 1.15 },
  { id: "dawn", durationMs: 3 * 60_000, growScale: 0.85 },
];

/** One full day/night rotation. */
export const DAY_CYCLE_MS = DAY_PHASES.reduce((sum, phase) => sum + phase.durationMs, 0);

/** One phase window with its absolute bounds. */
export interface DayPhaseState {
  /** Phase definition. */
  readonly phase: DayPhaseDefinition;
  /** Global window index; unique per phase occurrence. */
  readonly index: number;
  /** Server time the window opened. */
  readonly startsAt: number;
  /** Server time the window closes. */
  readonly endsAt: number;
}

/** @brief The phase containing one server timestamp. */
export function dayPhaseAt(now: number): DayPhaseState {
  const elapsed = now - EPOCH_MS;
  const cycle = Math.floor(elapsed / DAY_CYCLE_MS);
  let offset = elapsed - cycle * DAY_CYCLE_MS;
  if (offset < 0) offset += DAY_CYCLE_MS;
  let phaseIndex = 0;
  let start = 0;
  for (let index = 0; index < DAY_PHASES.length; index += 1) {
    const phase = DAY_PHASES[index];
    if (phase !== undefined && offset < start + phase.durationMs) {
      phaseIndex = index;
      return {
        phase,
        index: cycle * DAY_PHASES.length + index,
        startsAt: EPOCH_MS + cycle * DAY_CYCLE_MS + start,
        endsAt: EPOCH_MS + cycle * DAY_CYCLE_MS + start + phase.durationMs,
      };
    }
    start += phase?.durationMs ?? 0;
  }
  const fallback = DAY_PHASES[DAY_PHASES.length - 1] ?? DAY_PHASES[0]!;
  return {
    phase: fallback,
    index: cycle * DAY_PHASES.length + DAY_PHASES.length - 1,
    startsAt: EPOCH_MS + cycle * DAY_CYCLE_MS + DAY_CYCLE_MS - fallback.durationMs,
    endsAt: EPOCH_MS + (cycle + 1) * DAY_CYCLE_MS,
  };
}

/** @brief Phase-specific weather pools. */
const PHASE_WEATHER: Readonly<Record<DayPhaseId, readonly EventId[]>> = {
  day: ["goldenHour", "heatwave", "marketBoom", "rainbowSky", "rain", "thunderstorm", "metallicDew"],
  dusk: ["goldenFog", "wildfire", "smoke", "emberRain", "crystalFrost", "bloodMoon"],
  night: [
    "moonlight",
    "auroraNight",
    "meteorShower",
    "plasmaStorm",
    "cosmicRift",
    "discoNight",
    "diamondSky",
  ],
  dawn: ["frost", "snowfall", "coldSnap", "drought", "toxicRain", "twister", "blightWind", "acidRain"],
};

/** One event window ends where the phase ends. */
export const EVENT_WAVE_MS = DAY_PHASES[0]?.durationMs ?? 6 * 60_000;

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
  | "frostberry"
  | "beanstalk"
  | "emberLily"
  | "sugarApple"
  | "durian"
  | "lotus"
  | "venusFlyTrap"
  | "starfruit"
  | "hazelnut"
  | "olive"
  | "broccoli"
  | "onion"
  | "garlic"
  | "wheat"
  | "sugarcane"
  | "cactus"
  | "daffodil"
  | "tulip"
  | "rose"
  | "daisy"
  | "greenBean"
  | "beet"
  | "radish"
  | "lettuce"
  | "cabbage"
  | "honeydew"
  | "cantaloupe"
  | "papaya"
  | "pomegranate"
  | "raspberry"
  | "blackberry"
  | "passionfruit"
  | "lychee"
  | "persimmon"
  | "fig"
  | "avocado"
  | "ghostPepper"
  | "jalapeno"
  | "bellPepper"
  | "asparagus"
  | "cocomelon";

/** Fruit tree ids shipped in this build. */
export type TreeId =
  | "apple"
  | "grape"
  | "orange"
  | "plum"
  | "apricot"
  | "coconut"
  | "elderberry"
  | "banana"
  | "cherry"
  | "peach"
  | "pear"
  | "lemon"
  | "lime"
  | "mango"
  | "kiwi";

/** Custom cross-bred plant seed identifier minted by the Nursery. */
export type HybridId = `hybrid:${string}`;

/** Static or hybrid seed identifier that can be planted in a crop or greenhouse plot. */
export type AnySeedId = SeedId | HybridId;

/** Anything that can sit in the harvest bag: a crop seed or a tree fruit. */
export type ItemId = SeedId | TreeId;

/** Static or hybrid crop/fruit identifier stored in produce stacks. */
export type AnyItemId = ItemId | HybridId;

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
  | "shocked"
  | "bloodlit"
  | "radioactive"
  | "disco"
  | "cosmic"
  | "metallic"
  | "glimmering"
  | "twisted"
  | "diamond"
  | "burnt"
  | "shriveled"
  | "pale"
  | "brainrot"
  | "highquality";

/** Negative mutations that are prevented inside the greenhouse. */
export const BAD_MUTATIONS: ReadonlySet<EffectId> = new Set(["burnt", "shriveled", "pale"]);

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
  | "blightWind"
  | "thunderstorm"
  | "bloodMoon"
  | "acidRain"
  | "discoNight"
  | "cosmicRift"
  | "metallicDew"
  | "glimmerFog"
  | "twister"
  | "diamondSky"
  | "emberRain";

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
  /** Only sold by the prestige shop, never by the normal market. */
  readonly prestigeOnly?: boolean;
  /** Shop grouping: fruit-bearing plants sit in their own category. */
  readonly category?: "crop" | "fruit";
  /** Per-restock chance for a rare seed; defaults to EVENT_SEED_CHANCE. */
  readonly rareChance?: number;
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
    category: "fruit",
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
  // Premium rare seeds: sold one at a time in their own shop category.
  // Multi-harvest crops pay 5% of the seed price per pick; single harvests 150%.
  {
    id: "beanstalk",
    growMs: 60 * 60_000,
    buy: 3_000_000,
    sell: 150_000,
    art: [".", "v", "Y", "B"],
    regrow: true,
    rare: true,
    prestigeOnly: true,
    rareChance: 0.02,
  },
  {
    id: "emberLily",
    growMs: 20 * 60_000,
    buy: 5_000_000,
    sell: 250_000,
    art: [".", "v", "Y", "e"],
    regrow: true,
    rare: true,
    prestigeOnly: true,
    rareChance: 0.01,
  },
  {
    id: "sugarApple",
    growMs: 25 * 60_000,
    buy: 5_000_000,
    sell: 250_000,
    art: [".", "v", "Y", "S"],
    regrow: true,
    rare: true,
    category: "fruit",
    prestigeOnly: true,
    rareChance: 0.01,
  },
  {
    id: "durian",
    growMs: 30 * 60_000,
    buy: 5_000_000,
    sell: 250_000,
    art: [".", "v", "Y", "D"],
    regrow: true,
    rare: true,
    category: "fruit",
    prestigeOnly: true,
    rareChance: 0.01,
  },
  {
    id: "lotus",
    growMs: 35 * 60_000,
    buy: 10_000_000,
    sell: 500_000,
    art: [".", "v", "Y", "L"],
    regrow: true,
    rare: true,
    prestigeOnly: true,
    rareChance: 0.01,
  },
  {
    id: "venusFlyTrap",
    growMs: 90 * 60_000,
    buy: 10_000_000,
    sell: 15_000_000,
    art: [".", "v", "Y", "V"],
    regrow: false,
    rare: true,
    prestigeOnly: true,
    rareChance: 0.005,
  },
  {
    id: "starfruit",
    growMs: 40 * 60_000,
    buy: 10_000_000,
    sell: 500_000,
    art: [".", "v", "Y", "*"],
    regrow: true,
    rare: true,
    category: "fruit",
    prestigeOnly: true,
    rareChance: 0.005,
  },
  {
    id: "hazelnut",
    growMs: 100 * 60_000,
    buy: 10_000_000,
    sell: 500_000,
    art: [".", "v", "Y", "H"],
    regrow: true,
    rare: true,
    prestigeOnly: true,
    rareChance: 0.005,
  },
  {
    id: "olive",
    growMs: 45 * 60_000,
    buy: 20_000_000,
    sell: 1_000_000,
    art: [".", "v", "Y", "O"],
    regrow: true,
    rare: true,
    prestigeOnly: true,
    rareChance: 0.0025,
  },
  { id: "broccoli", growMs: 20 * 60_000, buy: 80, sell: 160, art: [".", "v", "Y", "B"], regrow: true },
  { id: "onion", growMs: 18 * 60_000, buy: 60, sell: 110, art: [".", "v", "Y", "o"], regrow: false },
  { id: "garlic", growMs: 22 * 60_000, buy: 90, sell: 170, art: [".", "v", "Y", "G"], regrow: false },
  { id: "wheat", growMs: 24 * 60_000, buy: 70, sell: 130, art: [".", "v", "Y", "W"], regrow: true },
  { id: "sugarcane", growMs: 30 * 60_000, buy: 110, sell: 220, art: [".", "v", "Y", "S"], regrow: true },
  { id: "cactus", growMs: 35 * 60_000, buy: 160, sell: 280, art: [".", "v", "Y", "c"], regrow: true },
  { id: "daffodil", growMs: 18 * 60_000, buy: 50, sell: 95, art: [".", "v", "Y", "d"], regrow: false },
  { id: "tulip", growMs: 20 * 60_000, buy: 60, sell: 115, art: [".", "v", "Y", "u"], regrow: false },
  { id: "rose", growMs: 26 * 60_000, buy: 140, sell: 260, art: [".", "v", "Y", "R"], regrow: false },
  { id: "daisy", growMs: 16 * 60_000, buy: 40, sell: 75, art: [".", "v", "Y", "y"], regrow: false },
  { id: "greenBean", growMs: 22 * 60_000, buy: 70, sell: 140, art: [".", "v", "Y", "n"], regrow: true },
  { id: "beet", growMs: 24 * 60_000, buy: 90, sell: 180, art: [".", "v", "Y", "b"], regrow: false },
  { id: "radish", growMs: 18 * 60_000, buy: 50, sell: 100, art: [".", "v", "Y", "r"], regrow: false },
  { id: "lettuce", growMs: 20 * 60_000, buy: 60, sell: 120, art: [".", "v", "Y", "l"], regrow: false },
  { id: "cabbage", growMs: 28 * 60_000, buy: 120, sell: 230, art: [".", "v", "Y", "k"], regrow: false },
  { id: "honeydew", growMs: 32 * 60_000, buy: 200, sell: 380, art: [".", "v", "Y", "h"], regrow: true },
  { id: "cantaloupe", growMs: 34 * 60_000, buy: 220, sell: 420, art: [".", "v", "Y", "q"], regrow: true },
  { id: "papaya", growMs: 36 * 60_000, buy: 260, sell: 500, art: [".", "v", "Y", "p"], regrow: true },
  { id: "pomegranate", growMs: 40 * 60_000, buy: 320, sell: 620, art: [".", "v", "Y", "P"], regrow: true },
  { id: "raspberry", growMs: 24 * 60_000, buy: 100, sell: 210, art: [".", "v", "Y", "j"], regrow: true },
  { id: "blackberry", growMs: 26 * 60_000, buy: 120, sell: 250, art: [".", "v", "Y", "x"], regrow: true },
  { id: "passionfruit", growMs: 38 * 60_000, buy: 300, sell: 600, art: [".", "v", "Y", "f"], regrow: true },
  { id: "lychee", growMs: 42 * 60_000, buy: 360, sell: 720, art: [".", "v", "Y", "L"], regrow: true },
  { id: "persimmon", growMs: 36 * 60_000, buy: 280, sell: 560, art: [".", "v", "Y", "m"], regrow: true },
  { id: "fig", growMs: 30 * 60_000, buy: 240, sell: 480, art: [".", "v", "Y", "F"], regrow: true },
  { id: "avocado", growMs: 44 * 60_000, buy: 400, sell: 800, art: [".", "v", "Y", "A"], regrow: true },
  { id: "jalapeno", growMs: 28 * 60_000, buy: 150, sell: 300, art: [".", "v", "Y", "i"], regrow: true },
  { id: "bellPepper", growMs: 30 * 60_000, buy: 170, sell: 340, art: [".", "v", "Y", "v"], regrow: true },
  { id: "asparagus", growMs: 32 * 60_000, buy: 190, sell: 380, art: [".", "v", "Y", "a"], regrow: true },
  {
    id: "ghostPepper",
    growMs: 50 * 60_000,
    buy: 7_000_000,
    sell: 350_000,
    art: [".", "v", "Y", "!"],
    regrow: true,
    rare: true,
    category: "fruit",
    prestigeOnly: true,
    rareChance: 0.01,
  },
  // Prestige tier 1: expensive, multi-harvest, never in the normal market.
  {
    id: "cocomelon",
    growMs: 30 * 60_000,
    buy: 1_000_000_000,
    sell: 50_000_000,
    regrow: true,
    prestigeOnly: true,
    art: [".", "v", "Y", "C"],
    category: "fruit",
  },
];

/** Chance an event seed shows up in a restock. */
export const EVENT_SEED_CHANCE = 0.01;

/** Multiplier-aware fertilizer ids. */
export type FertilizerId = "compost" | "speedGrow" | "superGrow" | "bioBoost" | "moonCompost";

/** Mutation-boosting spray ids. */
export type SprayId =
  "goldenSpray" | "frostSpray" | "snowSpray" | "stormSpray" | "cosmicSpray" | "diamondSpray" | "prismSpray";

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

/** Multiplier an active spray applies to the base chance of its mutations. */
export const SPRAY_MUTATION_BOOST = 1.05;

/** One spray: raises the base mutation chance for a number of harvests. */
export interface SprayDefinition {
  /** Stable id. */
  readonly id: SprayId;
  /** Mutations whose base chance this spray multiplies. */
  readonly effects: readonly EffectId[];
  /** Harvest cycles the boost survives. */
  readonly harvests: number;
  /** Shop price. */
  readonly price: number;
}

/** @brief Per-mutation chance multipliers from the active spray, if any. */
export function sprayBoostFor(spray: ActiveSpray | null): Readonly<Partial<Record<EffectId, number>>> {
  if (spray === null) return {};
  const definition = sprayById(spray.id);
  if (definition === undefined) return {};
  const boost: Partial<Record<EffectId, number>> = {};
  for (const id of definition.effects) boost[id] = SPRAY_MUTATION_BOOST;
  return boost;
}

/** Fertilizer catalog. */
export const FERTILIZERS: readonly FertilizerDefinition[] = [
  { id: "compost", growMultiplier: 0.75, harvests: 2, price: 25 },
  { id: "speedGrow", growMultiplier: 0.6, harvests: 3, price: 60 },
  { id: "superGrow", growMultiplier: 0.45, harvests: 4, price: 140 },
  { id: "bioBoost", growMultiplier: 0.5, harvests: 5, price: 260 },
  { id: "moonCompost", growMultiplier: 0.55, harvests: 4, price: 420 },
];

/** Spray catalog; mutation sprays are premium items now. */
export const SPRAYS: readonly SprayDefinition[] = [
  { id: "goldenSpray", effects: ["golden"], harvests: 2, price: 25_000 },
  { id: "frostSpray", effects: ["frozen"], harvests: 2, price: 20_000 },
  { id: "snowSpray", effects: ["snow"], harvests: 2, price: 20_000 },
  {
    id: "stormSpray",
    effects: ["snow", "chill", "sunray", "smoked", "cracked", "onfire"],
    harvests: 3,
    price: 75_000,
  },
  { id: "cosmicSpray", effects: ["cosmic", "meteor", "aurora"], harvests: 2, price: 60_000 },
  { id: "diamondSpray", effects: ["diamond", "crystal"], harvests: 2, price: 120_000 },
  { id: "prismSpray", effects: ["rainbow", "glimmering"], harvests: 3, price: 90_000 },
];

/** The fields a bulk fertilizer or spray reads from a crop or a tree. */
export interface SupplyTarget {
  /** Server time the plant is ready to harvest. */
  readonly readyAt: number;
  /** Whether a fertilizer charge is already active. */
  readonly fertilized: boolean;
  /** Active spray charge, or `null`. */
  readonly spray: ActiveSpray | null;
}

/** @brief Whether a plant still benefits from a fertilizer: growing and dry. */
export function needsFertilizer(plant: SupplyTarget, now: number): boolean {
  return now < plant.readyAt && !plant.fertilized;
}

/** @brief Whether a plant still accepts a spray charge. */
export function needsSpray(plant: SupplyTarget): boolean {
  return plant.spray === null;
}

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
  { id: "banana", growMs: 28 * 60_000, buy: 180, sell: 320, art: [".", "v", "Y", "N"] },
  { id: "cherry", growMs: 30 * 60_000, buy: 200, sell: 360, art: [".", "v", "Y", "C"] },
  { id: "peach", growMs: 32 * 60_000, buy: 240, sell: 430, art: [".", "v", "Y", "E"] },
  { id: "pear", growMs: 34 * 60_000, buy: 260, sell: 470, art: [".", "v", "Y", "R"] },
  { id: "lemon", growMs: 36 * 60_000, buy: 300, sell: 540, art: [".", "v", "Y", "Z"] },
  { id: "lime", growMs: 38 * 60_000, buy: 320, sell: 580, art: [".", "v", "Y", "I"] },
  { id: "mango", growMs: 42 * 60_000, buy: 380, sell: 700, art: [".", "v", "Y", "M"] },
  { id: "kiwi", growMs: 44 * 60_000, buy: 420, sell: 780, art: [".", "v", "Y", "K"] },
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
  { id: "shocked", mark: "z", multiplier: 4.6, natural: true },
  { id: "bloodlit", mark: "B", multiplier: 5.2, natural: true },
  { id: "radioactive", mark: "r", multiplier: 6, natural: true },
  { id: "disco", mark: "d", multiplier: 5.8, natural: true },
  { id: "cosmic", mark: "c", multiplier: 8, natural: true },
  { id: "metallic", mark: "M", multiplier: 4, natural: true },
  { id: "glimmering", mark: "g", multiplier: 5, natural: true },
  { id: "twisted", mark: "t", multiplier: 4.4, natural: true },
  { id: "diamond", mark: "D", multiplier: 9, natural: true },
  // Bad mutations: cheap, not dangerous, but they can ruin an otherwise good pick.
  { id: "burnt", mark: "b", multiplier: 0.7, natural: true },
  { id: "shriveled", mark: "-", multiplier: 0.5, natural: true },
  { id: "pale", mark: ".", multiplier: 0.7, natural: true },
  // Premium-garden-only mutation, never rolled by weather.
  { id: "brainrot", mark: "?", multiplier: 20, natural: false },
  // Greenhouse-only mutation: always grants 3x sale price, never naturally rolled.
  { id: "highquality", mark: "H", multiplier: 3, natural: false },
];

/**
 * Scale applied to mutation chances while a plant is merely growing.
 * @details Weather used to roll full odds on every six-minute wave, which made
 * long crops nearly guaranteed to carry several mutations and inflated sale
 * prices. The one-off planting roll keeps full odds; every wave after it only
 * gets this fraction.
 */
export const GROWTH_MUTATION_SCALE = 0.15;

/** Mutation polls run independently of the day/night phase clock. */
export const MUTATION_POLL_MS = 30_000;
/** Base chance scale applied to one 30s mutation poll. */
export const MUTATION_POLL_SCALE = 0.015;
/** Interval the prestige/wealth mutation bonuses were balanced against. */
export const MUTATION_BONUS_INTERVAL_MS = 5 * 60_000;

/** Effects every planting can roll even under a calm sky. */
export const BASE_EFFECT_CHANCES: Readonly<Partial<Record<EffectId, number>>> = {
  golden: 0.03,
  frozen: 0.02,
  moonlit: 0.015,
  shocked: 0.008,
  metallic: 0.006,
  glimmering: 0.005,
  disco: 0.003,
  cosmic: 0.001,
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
  {
    id: "thunderstorm",
    growScale: 1.15,
    sellBonus: 1.1,
    effectChances: { shocked: 0.12 },
  },
  { id: "bloodMoon", growScale: 1.05, sellBonus: 1.2, effectChances: { bloodlit: 0.1 } },
  {
    id: "acidRain",
    growScale: 0.95,
    sellBonus: 1.05,
    effectChances: { radioactive: 0.08, toxic: 0.08 },
  },
  { id: "discoNight", growScale: 1.1, sellBonus: 1.15, effectChances: { disco: 0.08 } },
  { id: "cosmicRift", growScale: 1.2, sellBonus: 1.3, effectChances: { cosmic: 0.03 } },
  { id: "metallicDew", growScale: 1, sellBonus: 1.1, effectChances: { metallic: 0.12 } },
  { id: "glimmerFog", growScale: 1, sellBonus: 1.15, effectChances: { glimmering: 0.1 } },
  { id: "twister", growScale: 0.85, sellBonus: 1, effectChances: { twisted: 0.12 } },
  {
    id: "diamondSky",
    growScale: 1.05,
    sellBonus: 1.35,
    effectChances: { diamond: 0.015 },
  },
  {
    id: "emberRain",
    growScale: 0.95,
    sellBonus: 1,
    effectChances: { burnt: 0.1, onfire: 0.03 },
  },
];

/** Length of one animal upkeep/production cycle: six minutes. */
export const FARM_CYCLE_MS = 6 * 60_000;

/** Cycles an egg spends incubating before it hatches. */
export const BREED_CYCLES = 2;

/** Chance per cycle that a barn with a free slot births one animal. */
export const BARN_BIRTH_CHANCE = 0.05;

/** Cycles the fish pond needs to grow one step. */
export const POND_GROWTH_CYCLES = 10;

/** Growth a pond step adds, in percent. */
export const POND_GROWTH_STEP = 10;

/** Pond growth ceiling, in percent. */
export const POND_GROWTH_MAX = 100;

/** The three animal buildings: coop, barn and fish pond. */
export type BuildingId = "coop" | "barn" | "pond";

/** Buildings iterated by the rules, in display order. */
export const BUILDING_IDS: readonly BuildingId[] = ["coop", "barn", "pond"];

/** Animals a building can host. */
export type AnimalId =
  | "chicken"
  | "duck"
  | "cow"
  | "goat"
  | "sheep"
  | "fish"
  | "snail"
  | "sturgeon"
  | "tilapia"
  | "bass"
  | "pike"
  | "carp"
  | "goby"
  | "hybridFish";

/** Products animals produce. */
export type ProductId =
  | "egg"
  | "duckEgg"
  | "milk"
  | "goatMilk"
  | "wool"
  | "roe"
  | "snailMeat"
  | "dried"
  | "wine"
  | "mayo"
  | "cheese"
  | "pickles"
  | "oil"
  | "fabric"
  | "juice"
  | "jam"
  | "butter"
  | "goatCheese"
  | "duckMayo"
  | "caviar"
  | "mushStraw"
  | "mushOyster"
  | "mushButton"
  | "mushShiitake"
  | "mushReishi"
  | "stone"
  | "coal"
  | "copperOre"
  | "ironOre"
  | "goldOre"
  | "iridiumOre"
  | "copperBar"
  | "ironBar"
  | "goldBar"
  | "iridiumBar"
  | "amethyst"
  | "ruby"
  | "emerald"
  | "diamond"
  | "prismaticShard";

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

/**
 * Slot ladder for every animal building: square numbers up to 81 slots.
 * @details Each upgrade adds the next odd number of slots (5, 7, 9, ...), so the
 * top tier opens a full 81-slot farm.
 */
export const BUILDING_SLOT_LADDER: readonly number[] = [4, 9, 16, 25, 36, 49, 64, 81];

/** Maximum number of slots per individual fish pond basin. */
export const POND_MAX_SLOTS = 9;

/**
 * Slot ladder for the fish pond: each level unlocks one distinct 9-slot pond basin.
 * @details Level 1 has 1 basin (9 slots), Level 2 has 2 basins (18 slots), etc.
 */
export const POND_SLOT_LADDER: readonly number[] = [9, 18, 27, 36, 45, 54, 63, 72];

/** The six base fish species initially available for the fish pond. */
export const BASE_FISH_SPECIES: readonly AnimalId[] = ["sturgeon", "tilapia", "bass", "pike", "carp", "goby"];

/** Every building upgrade costs this multiple of the previous step. */
export const BUILDING_UPGRADE_FACTOR = 2;

/** Buildings and their ladders: seven upgrades, up to eighty-one slots. */
export const BUILDINGS: readonly BuildingDefinition[] = [
  {
    id: "coop",
    price: 3_000_000,
    upgrade: 3_000_000,
    slots: BUILDING_SLOT_LADDER,
    animals: ["chicken", "duck"],
  },
  {
    id: "barn",
    price: 4_000_000,
    upgrade: 4_000_000,
    slots: BUILDING_SLOT_LADDER,
    animals: ["cow", "goat", "sheep"],
  },
  {
    id: "pond",
    price: 6_000_000,
    upgrade: 3_000_000,
    slots: POND_SLOT_LADDER,
    animals: ["fish", "snail", "sturgeon", "tilapia", "bass", "pike", "carp", "goby", "hybridFish"],
  },
];

/** Animal catalog with upkeep, production cadence and shop prices. */
export const ANIMALS: readonly AnimalDefinition[] = [
  { id: "chicken", building: "coop", upkeep: 40, intervalCycles: 2, product: "egg", buy: 5_000 },
  { id: "duck", building: "coop", upkeep: 40, intervalCycles: 3, product: "duckEgg", buy: 8_000 },
  { id: "cow", building: "barn", upkeep: 100, intervalCycles: 1, product: "milk", buy: 20_000 },
  { id: "goat", building: "barn", upkeep: 100, intervalCycles: 3, product: "goatMilk", buy: 25_000 },
  { id: "sheep", building: "barn", upkeep: 100, intervalCycles: 7, product: "wool", buy: 40_000 },
  // Pond stock: base fish and hybrid fish definitions
  { id: "fish", building: "pond", upkeep: 60, intervalCycles: 2, product: "roe", buy: 30_000 },
  { id: "snail", building: "pond", upkeep: 30, intervalCycles: 6, product: "snailMeat", buy: 12_000 },
  { id: "sturgeon", building: "pond", upkeep: 120, intervalCycles: 4, product: "caviar", buy: 150_000 },
  { id: "tilapia", building: "pond", upkeep: 25, intervalCycles: 1, product: "roe", buy: 12_000 },
  { id: "bass", building: "pond", upkeep: 50, intervalCycles: 2, product: "roe", buy: 45_000 },
  { id: "pike", building: "pond", upkeep: 75, intervalCycles: 3, product: "roe", buy: 65_000 },
  { id: "carp", building: "pond", upkeep: 40, intervalCycles: 2, product: "roe", buy: 30_000 },
  { id: "goby", building: "pond", upkeep: 15, intervalCycles: 1, product: "roe", buy: 8_000 },
  { id: "hybridFish", building: "pond", upkeep: 80, intervalCycles: 2, product: "roe", buy: 100_000 },
];

/** Product base prices; every quality star doubles the value. */
export const PRODUCTS: readonly ProductDefinition[] = [
  { id: "egg", base: 160 },
  { id: "duckEgg", base: 180 },
  { id: "milk", base: 120 },
  { id: "goatMilk", base: 400 },
  { id: "wool", base: 1_000 },
  { id: "roe", base: 900 },
  { id: "snailMeat", base: 600 },
  { id: "dried", base: 400 },
  { id: "wine", base: 1_500 },
  // Warehouse outputs: value already includes the recipe multiplier.
  { id: "mayo", base: 1_600 },
  { id: "cheese", base: 12_000 },
  { id: "pickles", base: 300 },
  { id: "oil", base: 2_600 },
  { id: "fabric", base: 100_000 },
  { id: "juice", base: 800 },
  { id: "jam", base: 1_200 },
  { id: "butter", base: 5_000 },
  { id: "goatCheese", base: 20_000 },
  { id: "duckMayo", base: 2_500 },
  { id: "caviar", base: 5_000_000 },
  // Mushroom house batches: base price of one mushroom of each species.
  { id: "mushStraw", base: 1_000 },
  { id: "mushOyster", base: 2_500 },
  { id: "mushButton", base: 5_000 },
  { id: "mushShiitake", base: 12_000 },
  { id: "mushReishi", base: 40_000 },
  // Mining resources: ores, coal, stone, and gems
  { id: "stone", base: 10 },
  { id: "coal", base: 50 },
  { id: "copperOre", base: 100 },
  { id: "ironOre", base: 250 },
  { id: "goldOre", base: 750 },
  { id: "iridiumOre", base: 3_000 },
  // Smelted metal bars
  { id: "copperBar", base: 800 },
  { id: "ironBar", base: 2_000 },
  { id: "goldBar", base: 6_000 },
  { id: "iridiumBar", base: 25_000 },
  // Precious gems
  { id: "amethyst", base: 1_200 },
  { id: "ruby", base: 3_500 },
  { id: "emerald", base: 5_000 },
  { id: "diamond", base: 15_000 },
  { id: "prismaticShard", base: 100_000 },
];

/** Mushroom house: every tray grows one batch per planting. */
export const MUSHROOM_TRAYS = 27;

/** One mushroom species the house can grow. */
export type MushroomId = "straw" | "oyster" | "button" | "shiitake" | "reishi";

/** One mushroom species definition. */
export interface MushroomDefinition {
  /** Stable id. */
  readonly id: MushroomId;
  /** Product stack the batch turns into. */
  readonly product: ProductId;
  /** Cycles one batch needs; one cycle is {@link FARM_CYCLE_MS}. */
  readonly cycles: number;
  /** Mushrooms harvested per batch. */
  readonly batch: number;
  /** Base sale price of one mushroom. */
  readonly base: number;
  /** Price of one spawn block, bought before planting. */
  readonly spawn: number;
  /** Four growth frames, like a crop. */
  readonly art: readonly [string, string, string, string];
}

/** Every mushroom species, cheapest first. */
export const MUSHROOMS: readonly MushroomDefinition[] = [
  {
    id: "straw",
    product: "mushStraw",
    cycles: 3,
    batch: 30,
    base: 1_000,
    spawn: 8_000,
    art: [".", "v", "Y", "m"],
  },
  {
    id: "oyster",
    product: "mushOyster",
    cycles: 3,
    batch: 30,
    base: 2_500,
    spawn: 20_000,
    art: [".", "v", "T", "M"],
  },
  {
    id: "button",
    product: "mushButton",
    cycles: 4,
    batch: 25,
    base: 5_000,
    spawn: 45_000,
    art: [".", "v", "b", "M"],
  },
  {
    id: "shiitake",
    product: "mushShiitake",
    cycles: 4,
    batch: 25,
    base: 12_000,
    spawn: 120_000,
    art: [".", "v", "h", "M"],
  },
  {
    id: "reishi",
    product: "mushReishi",
    cycles: 6,
    batch: 12,
    base: 40_000,
    spawn: 500_000,
    art: [".", "v", "R", "M"],
  },
];

/** @brief Mushroom species by id. */
export function mushroomById(id: string): MushroomDefinition | undefined {
  return MUSHROOMS.find((entry) => entry.id === id);
}

/** @brief Milliseconds one batch of this species needs. */
export function mushroomGrowMs(definition: MushroomDefinition): number {
  return Math.max(1, definition.cycles) * FARM_CYCLE_MS;
}

/** One planted mushroom tray, outside the crop grid. */
export interface MushroomTrayState {
  /** Zero-based tray index, `0..MUSHROOM_TRAYS-1`. */
  readonly slot: number;
  /** Species growing on the tray. */
  readonly mushroom: MushroomId;
  /** Server time the spawn block was planted. */
  readonly plantedAt: number;
  /** Server time the batch is ready to harvest. */
  readonly readyAt: number;
}

/** Warehouse machine ids. */
export type MachineId =
  | "seedMaker"
  | "mayoMaker"
  | "cheesePress"
  | "pickleJar"
  | "oilPress"
  | "loom"
  | "dryer"
  | "keg"
  | "juicer"
  | "jamMaker"
  | "butterChurn"
  | "caviarFermenter"
  | "smelter";

/** Extra product-to-product recipe on a converter. */
export interface MachineRecipe {
  /** Product consumed. */
  readonly input: ProductId;
  /** Product produced. */
  readonly output: ProductId;
  /** Informational multiplier. */
  readonly multiplier: number;
}

/** One machine recipe. */
export interface MachineDefinition {
  /** Stable id. */
  readonly id: MachineId;
  /** What it consumes. */
  readonly input:
    | { readonly kind: "seedCrop"; readonly seeds?: readonly (SeedId | TreeId)[] }
    | { readonly kind: "product"; readonly product: ProductId };
  /** What it produces. */
  readonly output: { readonly kind: "seeds" } | { readonly kind: "product"; readonly product: ProductId };
  /** Output multiplier, purely informative for labels. */
  readonly multiplier: number;
  /** Additional product-to-product recipes for a converter. */
  readonly recipes?: readonly MachineRecipe[];
  /** Cycles between two crafts. */
  readonly cooldownCycles: number;
  /** Accepts tree fruit as well as crops (the dryer does). */
  readonly allProduce?: boolean;
  /** Derives the output star from the input's base sale price (the dryer). */
  readonly gradeByPrice?: boolean;
  /**
   * Queues a timed job instead of crafting instantly: the input leaves the bag
   * while it brews, so the market cannot sell it, and the output lands when the
   * job finishes (the keg).
   */
  readonly queued?: boolean;
}

/** One timed job running inside a machine. */
export interface MachineJob {
  /** Item being processed; it lives in the machine, not in the bag. */
  readonly item: AnyItemId | ProductId;
  /** Server time the job started. */
  readonly startedAt: number;
  /** Server time the output is ready to collect. */
  readonly readyAt: number;
  /** Source quality for product inputs (mayo/cheese keep their star). */
  readonly star?: number;
  /** Base sell price for crop inputs, used by the dryer grading. */
  readonly sell?: number;
  /** Mutations carried into the machine output. */
  readonly effects?: readonly EffectId[];
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
    id: "loom",
    input: { kind: "product", product: "wool" },
    output: { kind: "product", product: "fabric" },
    multiplier: 100,
    cooldownCycles: 2,
  },
  {
    id: "cheesePress",
    input: { kind: "product", product: "milk" },
    output: { kind: "product", product: "cheese" },
    multiplier: 100,
    cooldownCycles: 2,
    recipes: [{ input: "goatMilk", output: "goatCheese", multiplier: 100 }],
  },
  {
    id: "mayoMaker",
    input: { kind: "product", product: "egg" },
    output: { kind: "product", product: "mayo" },
    multiplier: 10,
    cooldownCycles: 2,
    recipes: [{ input: "duckEgg", output: "duckMayo", multiplier: 10 }],
  },
  {
    id: "pickleJar",
    input: { kind: "seedCrop" },
    output: { kind: "product", product: "pickles" },
    multiplier: 10,
    cooldownCycles: 2,
  },
  {
    id: "caviarFermenter",
    input: { kind: "product", product: "roe" },
    output: { kind: "product", product: "caviar" },
    multiplier: 100,
    cooldownCycles: 6,
    queued: true,
    recipes: [{ input: "snailMeat", output: "caviar", multiplier: 100 }],
  },
  {
    id: "oilPress",
    input: { kind: "seedCrop", seeds: ["sunflower", "coconut", "olive", "corn", "avocado"] },
    output: { kind: "product", product: "oil" },
    multiplier: 20,
    cooldownCycles: 2,
    allProduce: true,
  },
  {
    id: "dryer",
    input: { kind: "seedCrop" },
    output: { kind: "product", product: "dried" },
    multiplier: 8,
    cooldownCycles: 3,
    allProduce: true,
    gradeByPrice: true,
  },
  {
    id: "juicer",
    input: { kind: "seedCrop" },
    output: { kind: "product", product: "juice" },
    multiplier: 12,
    cooldownCycles: 2,
    allProduce: true,
  },
  {
    id: "jamMaker",
    input: { kind: "seedCrop" },
    output: { kind: "product", product: "jam" },
    multiplier: 15,
    cooldownCycles: 3,
    allProduce: true,
  },
  {
    id: "butterChurn",
    input: { kind: "product", product: "milk" },
    output: { kind: "product", product: "butter" },
    multiplier: 20,
    cooldownCycles: 2,
    recipes: [
      { input: "goatMilk", output: "butter", multiplier: 20 },
      { input: "oil", output: "butter", multiplier: 20 },
    ],
  },
  {
    id: "keg",
    input: { kind: "seedCrop" },
    output: { kind: "product", product: "wine" },
    multiplier: 20,
    cooldownCycles: 4,
    allProduce: true,
    gradeByPrice: true,
    queued: true,
  },
  {
    id: "smelter",
    input: { kind: "product", product: "copperOre" },
    output: { kind: "product", product: "copperBar" },
    multiplier: 8,
    cooldownCycles: 3,
    queued: true,
    recipes: [
      { input: "ironOre", output: "ironBar", multiplier: 8 },
      { input: "goldOre", output: "goldBar", multiplier: 8 },
      { input: "iridiumOre", output: "iridiumBar", multiplier: 8 },
    ],
  },
];

/** @brief Machine definition by id. */
/** Passive machines mounted on the garden or farm buildings. */
export type AttachmentId = "sprinkler" | "scarecrow" | "fireSystem" | "heater" | "aerator";

/** Where an attachment can be mounted. */
export type AttachmentSlot = "garden" | "fire" | "coop" | "barn" | "pond";

/** One mountable passive machine. */
export interface AttachmentDefinition {
  readonly id: AttachmentId;
  readonly slot: AttachmentSlot;
  readonly price: number;
}

/** Attachment catalog. */
export const ATTACHMENTS: readonly AttachmentDefinition[] = [
  { id: "sprinkler", slot: "garden", price: 3_000_000 },
  { id: "scarecrow", slot: "garden", price: 4_000_000 },
  { id: "fireSystem", slot: "fire", price: 25_000_000 },
  { id: "heater", slot: "coop", price: 5_000_000 },
  { id: "aerator", slot: "pond", price: 6_000_000 },
];

/** One prestige shop offer. */
export interface PrestigeShopOffer {
  readonly seed: SeedId;
  readonly tier: number;
  /** Fraction of the player's current coin balance charged for this seed (e.g. `0.1` = 10%). */
  readonly rate: number;
  /** Fraction of the next prestige requirement used as the minimum coin floor (e.g. `0.01` = 1%). */
  readonly minRate: number;
}

/** Prestige level that unlocks the final shop. */
export const FINAL_SHOP_PRESTIGE = 5;

/** One final-shop plant, priced in prestige coins. */
export interface FinalShopOffer {
  readonly seed: SeedId;
  readonly coins: number;
}

/** Final shop stock; paid with prestige coins earned per 1000b. */
export const FINAL_SHOP: readonly FinalShopOffer[] = [{ seed: "cocomelon", coins: 1 }];

/** Seeds unlocked by prestige tiers. */
export const PRESTIGE_SHOP: readonly PrestigeShopOffer[] = [
  { seed: "beanstalk", tier: 1, rate: 0.1, minRate: 0.01 },
  { seed: "emberLily", tier: 1, rate: 0.1, minRate: 0.01 },
  { seed: "sugarApple", tier: 1, rate: 0.1, minRate: 0.01 },
  { seed: "durian", tier: 1, rate: 0.1, minRate: 0.01 },
  { seed: "starfruit", tier: 2, rate: 0.15, minRate: 0.015 },
  { seed: "lotus", tier: 2, rate: 0.15, minRate: 0.015 },
  { seed: "hazelnut", tier: 2, rate: 0.15, minRate: 0.015 },
  { seed: "ghostPepper", tier: 2, rate: 0.15, minRate: 0.015 },
  { seed: "venusFlyTrap", tier: 3, rate: 0.2, minRate: 0.02 },
  { seed: "olive", tier: 3, rate: 0.2, minRate: 0.02 },
  { seed: "cocomelon", tier: 5, rate: 0.3, minRate: 0.03 },
];

/**
 * @brief Calculates the minimum floor price of a prestige shop seed as a percentage of the next prestige requirement.
 * @param offer Prestige shop offer descriptor containing `minRate`.
 * @param prestige Player's current prestige level.
 * @return Minimum coin floor (`>= 1`).
 */
export function prestigeSeedFloor(offer: PrestigeShopOffer, prestige: number): number {
  return Math.max(1, Math.round(prestigeRequirement(prestige) * offer.minRate));
}

/**
 * @brief Calculates the coin cost of a prestige shop seed as `max(prestigeSeedFloor, coins * rate)`.
 * @param offer Prestige shop offer descriptor containing `rate` and `minRate`.
 * @param coins Player's current coin balance.
 * @param prestige Player's current prestige level.
 * @return Coin cost, always at least `prestigeSeedFloor(offer, prestige)`.
 */
export function prestigeSeedPrice(offer: PrestigeShopOffer, coins: number, prestige: number): number {
  const pctPrice = Number.isFinite(coins) && coins > 0 ? Math.round(coins * offer.rate) : 0;
  return Math.max(prestigeSeedFloor(offer, prestige), pctPrice);
}

/** @brief Minimum prestige tier needed to plant a seed; `0` for normal seeds. */
export function prestigeTierForSeed(seed: SeedId): number {
  return PRESTIGE_SHOP.find((offer) => offer.seed === seed)?.tier ?? 0;
}

/**
 * @brief Extra chance for bad mutations as the wallet grows.
 * @details Below one billion coins the player is safe; after that every
 * tenfold increase adds 2 percentage points, capped at +20%. Wealth should
 * make the bad rolls more likely.
 */
export function wealthBadLuck(coins: number): number {
  if (!Number.isFinite(coins) || coins < 1_000_000_000) return 0;
  return Math.min(0.2, 0.02 + Math.log10(coins / 1_000_000_000) * 0.02);
}

/** Branches in the prestige skill tree. */
export type PrestigeSkillId = "merchant" | "farmer" | "artisan";

/** Sell multiplier from merchant points (+10% each). */
export function prestigeSkillSellBonus(skills: Partial<Record<PrestigeSkillId, number>> | undefined): number {
  return 1 + (skills?.merchant ?? 0) * 0.1;
}

/** Growth-time multiplier from farmer points (-5% each, floor 10%). */
export function prestigeSkillGrowScale(skills: Partial<Record<PrestigeSkillId, number>> | undefined): number {
  return Math.max(0.1, 1 - (skills?.farmer ?? 0) * 0.05);
}

/** Absolute mutation chance from artisan points (+1% each). */
export function prestigeSkillMutationBonus(
  skills: Partial<Record<PrestigeSkillId, number>> | undefined,
): number {
  return (skills?.artisan ?? 0) * 0.01;
}

/** @brief Mutation-rate bonus per prestige level (+1% absolute chance). */
export function prestigeMutationBonus(level: number): number {
  return Math.max(0, level) * 0.01;
}

/** @brief Attachment definition by id. */
export function attachmentById(id: string): AttachmentDefinition | undefined {
  return ATTACHMENTS.find((entry) => entry.id === id);
}

export function machineById(id: string): MachineDefinition | undefined {
  return MACHINES.find((machine) => machine.id === id);
}

/** One built machine on the wire. */
export interface MachineState {
  /** Machine level, `1..3`. */
  readonly level: number;
  /** Server time of the last craft. */
  readonly lastCraftAt: number;
  /** Timed job currently brewing, if any. */
  readonly job?: MachineJob;
  /** Pending jobs, in order; inputs are already held by the machine. */
  readonly queue?: readonly MachineJob[];
  /** Stop the queue after this many units are produced; absent means no limit. */
  readonly limit?: number;
  /** Units produced since the current limit was set. */
  readonly made?: number;
}

/** @brief Seeds a seed maker returns for one crop at a level. */
/** Base chance a seed-maker batch actually yields seeds. */
export const SEED_MAKER_BASE_CHANCE = 0.5;

/** @brief Seed-maker success chance: 50% at P0, +10% per prestige, 100% at P5. */
export function seedMakerChance(prestige: number): number {
  return Math.min(1, SEED_MAKER_BASE_CHANCE + Math.max(0, prestige) * 0.1);
}

export function seedMakerOutput(level: number): number {
  return 3 + Math.max(1, Math.min(MACHINE_MAX_LEVEL, level)) * 2;
}

/** @brief Products a converter returns for one input at a level. */
export function converterOutput(level: number): number {
  return Math.max(1, Math.min(MACHINE_MAX_LEVEL, level)) * 2;
}

/** @brief Cycles one machine craft takes at a level; higher levels run faster. */
export function machineCycles(level: number, cooldownCycles: number): number {
  return Math.max(1, cooldownCycles - (Math.max(1, Math.min(MACHINE_MAX_LEVEL, level)) - 1));
}

/**
 * @brief Star the dryer stamps on dried goods, from the input's base value.
 * @param sell Base sale price of the crop or fruit being dried.
 * @details Every quadrupling of the input price adds one star, so a cheap
 * carrot dries into one-star goods and ginseng or elderberry into five-star.
 */
export function driedStarForSell(sell: number): number {
  const tier = Math.floor(Math.log2(Math.max(1, sell) / 25)) + 1;
  return Math.max(1, Math.min(5, tier));
}

/** @brief Requirements of one machine craft. */
export function machineCraftCost(machine: MachineDefinition): number {
  return MACHINE_PRICE;
}

/** Rare tools sold in the market. */
export type ToolId = "autoWater" | "reclaimer" | "shovel" | "favoriteLock";

/** One rare tool definition. */
export interface ToolDefinition {
  /** Stable id. */
  readonly id: ToolId;
  /** Fixed price, in coins. */
  readonly price: number;
}

/**
 * Rare tool catalog.
 * @details `autoWater` works on a timer, while the three hand tools are spent
 * once per use: `reclaimer` pops a seed back out of a planted crop, `shovel`
 * relocates one plant, and `favoriteLock` pins a plant so nothing removes it.
 */
export const TOOLS: readonly ToolDefinition[] = [
  { id: "autoWater", price: 1_000_000 },
  { id: "reclaimer", price: 600_000 },
  { id: "shovel", price: 900_000 },
  { id: "favoriteLock", price: 300_000 },
];

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

/**
 * @brief Price of the next upgrade step.
 * @param building Animal building.
 * @param level Current level, `1..maxBuildingLevel(building)`.
 * @details Every step doubles the last price, the same incremental curve the
 * premium plots use.
 */
export function buildingUpgradeCost(building: BuildingId, level = 1): number {
  const base = buildingById(building)?.upgrade ?? 0;
  return base * BUILDING_UPGRADE_FACTOR ** Math.min(10, Math.max(0, Math.floor(level) - 1));
}

/** @brief One animal living in a building slot. */
export interface AnimalState {
  /** Mutations carried by the animal; its produce inherits them. */
  readonly effects?: readonly EffectId[];
  /** Species. */
  readonly kind: AnimalId;
  /** Server time the animal was bought. */
  readonly bornAt: number;
  /** How many times it was petted. */
  readonly pats: number;
  /** Server time of the last pet; petting is limited to once per cycle. */
  readonly lastPatAt?: number;
  /** Inherited husbandry genes, 0..100 per stat. */
  readonly genes?: AnimalGenes;
  /** Server time of the last produced item. */
  readonly lastProduceAt: number;
  /** Server time the kept egg hatches; `0` or absent when nothing is incubating. */
  readonly incubatingUntil?: number;
  /** AI-generated hybrid fish unique identifier. */
  readonly hybridId?: string;
  /** Custom display name for this hybrid fish. */
  readonly hybridName?: string;
  /** The two parent species that were cross-bred. */
  readonly hybridParents?: readonly [AnimalId, AnimalId];
  /** Quality tier: "inferior" (đểu) or "superior" (ngon). */
  readonly hybridTier?: "inferior" | "superior";
  /** AI lore / description. */
  readonly hybridLore?: string;
  /** Custom buy / evaluation price. */
  readonly hybridPrice?: number;
  /** ASCII glyph symbol override. */
  readonly hybridGlyph?: string;
}

/**
 * @brief Metadata definition for an AI-generated hybrid fish.
 */
export interface HybridFishDefinition {
  /** Stable identifier (e.g. hybrid:sturgeon:carp:abc12345). */
  readonly id: string;
  /** Display name created by AI. */
  readonly name: string;
  /** The two parent species that were cross-bred. */
  readonly parents: readonly [AnimalId, AnimalId];
  /** Quality tier: "inferior" (đểu) or "superior" (ngon) compared to parents. */
  readonly tier: "inferior" | "superior";
  /** AI-generated lore and description of the hybrid fish. */
  readonly lore: string;
  /** ASCII glyph representing the hybrid fish (e.g. "X", "Ж", "§", "♦"). */
  readonly glyph: string;
  /** Upkeep per cycle in coins. */
  readonly upkeep: number;
  /** Production interval in farm cycles. */
  readonly intervalCycles: number;
  /** Purchase/market base price in coins. */
  readonly buy: number;
  /** Product it produces. */
  readonly product: ProductId;
  /** Server timestamp when first discovered/created. */
  readonly createdAt: number;
  /** Player ID who discovered it. */
  readonly discoveredBy?: string;
}

/**
 * @brief Calculates which distinct 9-slot pond basin hosts the given animal slot index.
 * @param slot Absolute animal slot inside the pond (0..71).
 * @return Zero-based pond basin index (0, 1, 2, ...).
 */
export function pondBasinIndex(slot: number): number {
  return Math.floor(Math.max(0, slot) / POND_MAX_SLOTS);
}

/**
 * @brief Calculates the local slot index (0..8) within a 9-slot pond basin.
 * @param slot Absolute animal slot inside the pond (0..71).
 * @return Local slot index within the 9-slot basin (0..8).
 */
export function pondBasinSlot(slot: number): number {
  return Math.max(0, slot) % POND_MAX_SLOTS;
}

/**
 * @brief Returns the start and end absolute slot indices for a pond basin.
 * @param basinIndex Zero-based pond basin index.
 * @return Tuple of [startSlot, endSlotExclusive].
 */
export function pondBasinSlotRange(basinIndex: number): [number, number] {
  const start = Math.max(0, basinIndex) * POND_MAX_SLOTS;
  return [start, start + POND_MAX_SLOTS];
}

/**
 * @brief Inspects a pond basin slice to determine whether it contains a single fish species or multiple species.
 * @param animals All pond animals.
 * @param basinIndex Zero-based basin index.
 * @return Summary containing fish count, free slots, species list, and whether it qualifies as purebred or crossbreeding.
 */
export function inspectPondBasin(
  animals: readonly (AnimalState | null)[],
  basinIndex: number,
): {
  readonly basinIndex: number;
  readonly fish: readonly AnimalState[];
  readonly freeSlots: readonly number[];
  readonly species: readonly AnimalId[];
  readonly isSingleSpecies: boolean;
  readonly isMixedSpecies: boolean;
  readonly isPurebred: boolean;
  readonly isCrossbreeding: boolean;
} {
  const [start, end] = pondBasinSlotRange(basinIndex);
  const fish: AnimalState[] = [];
  const freeSlots: number[] = [];
  const speciesSet = new Set<AnimalId>();

  for (let slot = start; slot < end; slot += 1) {
    const animal = animals[slot] ?? null;
    if (animal === null) {
      freeSlots.push(slot);
    } else {
      fish.push(animal);
      speciesSet.add(animal.kind);
    }
  }

  const species = Array.from(speciesSet);
  // Purebred ONLY applies when all fish in the basin are the exact same BASE species (not hybridFish or generic fish).
  const isPurebred =
    species.length === 1 && fish.length >= 2 && species[0] !== "hybridFish" && species[0] !== "fish";
  const isCrossbreeding = fish.length >= 2 && !isPurebred;

  return {
    basinIndex,
    fish,
    freeSlots,
    species,
    isSingleSpecies: isPurebred,
    isMixedSpecies: isCrossbreeding,
    isPurebred,
    isCrossbreeding,
  };
}

/**
 * @brief Tests whether an animal kind belongs to the fish family.
 * @param kind Animal species ID.
 * @return True if the animal is a base, generic or hybrid fish.
 */
export function isFishKind(kind: AnimalId): boolean {
  return kind === "fish" || kind === "hybridFish" || (BASE_FISH_SPECIES as readonly string[]).includes(kind);
}

/**
 * @brief Generates a deterministic hybrid fish from two parent species or living parent animals.
 * @param parentA First parent species.
 * @param parentB Second parent species.
 * @param seed Pseudo-random seed for determinism.
 * @param parentStateA Optional living parent state of the first fish.
 * @param parentStateB Optional living parent state of the second fish.
 * @return Definition and living AnimalState of the hybrid fish.
 */
export function generateDeterministicHybridFish(
  parentA: AnimalId,
  parentB: AnimalId,
  seed: number,
  parentStateA?: AnimalState | null,
  parentStateB?: AnimalState | null,
): {
  readonly id: string;
  readonly name: string;
  readonly tier: "inferior" | "superior";
  readonly lore: string;
  readonly glyph: string;
  readonly buy: number;
  readonly upkeep: number;
  readonly intervalCycles: number;
  readonly product: ProductId;
  readonly state: AnimalState;
} {
  const rng = createRng(Math.abs(seed) || 12345);

  const isHybridParentA = parentA === "hybridFish" || parentStateA?.kind === "hybridFish";
  const isHybridParentB = parentB === "hybridFish" || parentStateB?.kind === "hybridFish";
  const isBothHybrids = isHybridParentA && isHybridParentB;
  const isMultiGen = isHybridParentA || isHybridParentB;

  const defA = animalById(parentA);
  const defB = animalById(parentB);
  const baseA = parentStateA?.hybridPrice ?? defA?.buy ?? 30_000;
  const baseB = parentStateB?.hybridPrice ?? defB?.buy ?? 30_000;
  const avgBuy = Math.round((baseA + baseB) / 2);

  const rollTier = rng();
  const isSuperior = rollTier >= 0.45; // 55% superior (ngon), 45% inferior (đểu)
  const tier: "inferior" | "superior" = isSuperior ? "superior" : "inferior";

  // Ancestor tracking to see if caviar is appropriate
  const ancestorSpecies: AnimalId[] = [];
  if (parentStateA?.hybridParents && parentStateA.hybridParents.length > 0) {
    ancestorSpecies.push(...parentStateA.hybridParents);
  } else if (parentA !== "hybridFish") {
    ancestorSpecies.push(parentA);
  }
  if (parentStateB?.hybridParents && parentStateB.hybridParents.length > 0) {
    ancestorSpecies.push(...parentStateB.hybridParents);
  } else if (parentB !== "hybridFish") {
    ancestorSpecies.push(parentB);
  }
  const hasSturgeon =
    ancestorSpecies.includes("sturgeon") || parentA === "sturgeon" || parentB === "sturgeon";

  const VIET_NAMES: Record<AnimalId, string> = {
    sturgeon: "Tầm",
    tilapia: "Rô",
    bass: "Vược",
    pike: "Pike",
    carp: "Chép",
    goby: "Bống",
    fish: "Cá",
    snail: "Ốc",
    chicken: "Gà",
    duck: "Vịt",
    cow: "Bò",
    goat: "Dê",
    sheep: "Cừu",
    hybridFish: "Lai",
  };

  const F2_SUPERIOR_NAMES = [
    "Cá Rồng Huyết Long",
    "Cá Rồng Kim Long",
    "Cá Rồng Bạch Long",
    "Cá Hải Tượng Hoàng Kim",
    "Cá Hải Tượng Cổ Đại",
    "Cá Kỳ Lân Ngũ Sắc",
    "Cá Thần Long Đại Dương",
    "Cá Thái Hổ Bá Vương",
    "Cá Koi Ngũ Phước",
    "Cá Koi Kim Quy",
    "Cá Bách Niên Thần Ngư",
    "Cá Huyết Anh Vũ",
    "Cá Hắc Long Huyền Thoại",
    "Cá Kim Ngân Phúc Lộc",
    "Cá Thiên Nga Ngọc Bích",
    "Cá Phượng Hoàng Lửa",
    "Cá Cửu Vĩ Ngư Thần",
    "Cá Tinh Vân Vô Song",
  ];

  const F2_INFERIOR_NAMES = [
    "Cá Đột Biến Lỗi F2",
    "Cá Còi Cọc Dị Dạng",
    "Cá Lòi Mắt Ngáo Ngơ",
    "Cá Bụng Bự Hao Cám",
    "Cá Xương Xẩu Không Thịt",
    "Cá Ngủ Gật Bơi Lùi",
    "Cá Quái Dị Nhăn Nheo",
    "Cá Lác Mắt Tí Nị",
    "Cá Teo Tó Đuôi Cụt",
    "Cá Dị Hợm Đột Biến",
    "Cá Lười Biếng Ăn Hại",
    "Cá Mõm Nhọn Nhầy Nhụa",
    "Cá Móp Đầu Xiêu Vẹo",
    "Cá Vô Danh Dị Tật",
  ];

  const SUPERIOR_TITLES = [
    "Hoàng Gia",
    "Hoàng Kim",
    "Bá Vương",
    "Thần Long",
    "Kỳ Lân",
    "Cẩm Tú",
    "Đại Dương",
    "Hải Vương",
    "Kim Quy",
    "Hắc Mã",
  ];

  const INFERIOR_TITLES = [
    "Còi Cọc",
    "Gầy Gò",
    "Xương Xẩu",
    "Tí Nị",
    "Đột Biến Lỗi",
    "Ngáo Ngơ",
    "Tật Nguyền",
    "Hao Cám",
    "Bơi Lùi",
    "Lác Mắt",
  ];

  let name: string;
  let lore: string;

  if (isBothHybrids) {
    // Both parents are already hybrids ("2 loại cá đã lai") -> Generates a completely new distinct F2 hybrid!
    if (isSuperior) {
      name = F2_SUPERIOR_NAMES[Math.floor(rng() * F2_SUPERIOR_NAMES.length)] ?? "Cá Rồng Huyết Long";
      lore =
        "Thế hệ F2 siêu đột biến kết tinh tinh hoa từ cả hai dòng cá lai. Thân hình vạm vỡ, hào quang lấp lánh và cho phẩm cấp cực kỳ giá trị!";
    } else {
      name = F2_INFERIOR_NAMES[Math.floor(rng() * F2_INFERIOR_NAMES.length)] ?? "Cá Đột Biến Lỗi F2";
      lore =
        "Hậu quả của việc lai ghép gen hỗn loạn đời F2. Dáng bơi xiêu vẹo, ăn tốn thức ăn nhưng bơi lội tấu hài giải trí vô cùng!";
    }
  } else if (isMultiGen) {
    // One hybrid + one base fish -> Backcross hybrid
    const baseKind = isHybridParentA ? parentB : parentA;
    const baseName = VIET_NAMES[baseKind] ?? "Cá";
    const hybridParent = isHybridParentA ? parentStateA : parentStateB;
    const parentTitle = hybridParent?.hybridName ? hybridParent.hybridName.replace(/^Cá\s+/, "") : "Lai";
    const title = isSuperior
      ? (SUPERIOR_TITLES[Math.floor(rng() * SUPERIOR_TITLES.length)] ?? "Bá Vương")
      : (INFERIOR_TITLES[Math.floor(rng() * INFERIOR_TITLES.length)] ?? "Còi Cọc");
    name = `Cá ${baseName} ${parentTitle.slice(0, 6)} ${title}`;
    lore = isSuperior
      ? `Đột biến lai ngược ưu việt giữa cá ${baseName} thuần chủng và dòng cá lai ${parentTitle}. Tố chất vượt bậc!`
      : `Lai ngược không thành công giữa cá ${baseName} và cá lai. Gen lặn bộc phát làm cá gầy còi xương xẩu.`;
  } else {
    // Both are base species -> F1 hybrid
    const nameA = VIET_NAMES[parentA] ?? "Cá";
    const nameB = VIET_NAMES[parentB] ?? "Cá";
    const title = isSuperior
      ? (SUPERIOR_TITLES[Math.floor(rng() * SUPERIOR_TITLES.length)] ?? "Hoàng Gia")
      : (INFERIOR_TITLES[Math.floor(rng() * INFERIOR_TITLES.length)] ?? "Còi Cọc");
    name = `Cá ${nameA} ${nameB} ${title}`;
    lore = isSuperior
      ? `Thừa hưởng gen vượt trội giữa ${nameA} và ${nameB}. Thân hình lấp lánh, sinh trưởng mạnh mẽ và cho phẩm cấp cực kỳ giá trị!`
      : `Đột biến gen dở khóc dở cười giữa ${nameA} và ${nameB}. Thịt nhạt nhẽo, xương nhiều ăn tốn cám nhưng bơi lội trông rất giải trí.`;
  }

  const hexHash = Math.abs(seed % 0xfffffff)
    .toString(16)
    .padStart(7, "0");
  const tagA = parentStateA?.hybridId ? (parentStateA.hybridId.split(":")[1] ?? "hyb") : parentA;
  const tagB = parentStateB?.hybridId ? (parentStateB.hybridId.split(":")[1] ?? "hyb") : parentB;
  const sortedTags = [tagA, tagB].sort();
  const id = `hybrid:${sortedTags[0]}:${sortedTags[1]}:${hexHash}`;

  const buy = isSuperior
    ? Math.round(avgBuy * (isBothHybrids ? 2.5 + rng() * 2.0 : 1.8 + rng() * 1.5))
    : Math.round(avgBuy * (isBothHybrids ? 0.25 + rng() * 0.35 : 0.35 + rng() * 0.35));

  const upkeep = isSuperior
    ? Math.round(((defA?.upkeep ?? 40) + (defB?.upkeep ?? 40)) * 0.4)
    : Math.round(((defA?.upkeep ?? 40) + (defB?.upkeep ?? 40)) * 0.9);

  const intervalCycles = isSuperior
    ? Math.max(1, Math.min(defA?.intervalCycles ?? 2, defB?.intervalCycles ?? 2))
    : Math.max(3, (defA?.intervalCycles ?? 2) + 1);

  const product: ProductId =
    (isSuperior && hasSturgeon) || (isSuperior && isBothHybrids && rng() >= 0.4) ? "caviar" : "roe";

  const SUPERIOR_GLYPHS = ["Ж", "♦", "§", "★", "Ω", "Ψ", "♠", "✦", "✪", "♛"];
  const INFERIOR_GLYPHS = ["x", "d", "b", "z", "o", "v", "c", "¿"];
  const glyph = isSuperior
    ? (SUPERIOR_GLYPHS[Math.floor(rng() * SUPERIOR_GLYPHS.length)] ?? "Ж")
    : (INFERIOR_GLYPHS[Math.floor(rng() * INFERIOR_GLYPHS.length)] ?? "x");

  const resolvedParents: readonly [AnimalId, AnimalId] = [
    parentStateA?.kind ?? parentA,
    parentStateB?.kind ?? parentB,
  ];

  const state: AnimalState = {
    kind: "hybridFish",
    bornAt: 0,
    pats: 0,
    lastProduceAt: 0,
    hybridId: id,
    hybridName: name,
    hybridParents: resolvedParents,
    hybridTier: tier,
    hybridLore: lore,
    hybridPrice: buy,
    hybridGlyph: glyph,
  };

  return {
    id,
    name,
    tier,
    lore,
    glyph,
    buy,
    upkeep,
    intervalCycles,
    product,
    state,
  };
}

/** Heritable animal stat block. */
export interface AnimalGenes {
  /** Extra product quantity (50 = +1, 100 = +2). */
  readonly yield: number;
  /** Faster production interval (100 = 20% faster). */
  readonly speed: number;
  /** Extra petting mutation chance (100 = +10%). */
  readonly mutation: number;
}

/** @brief Product quantity multiplier from genes. */
export function animalGeneYield(animal: AnimalState): number {
  return 1 + Math.floor((animal.genes?.yield ?? 0) / 50);
}

/** @brief Production-interval multiplier from genes. */
export function animalGeneSpeed(animal: AnimalState): number {
  return Math.max(0.5, 1 - (animal.genes?.speed ?? 0) / 500);
}

/** @brief Extra mutation chance from genes. */
export function animalGeneMutation(animal: AnimalState): number {
  return (animal.genes?.mutation ?? 0) / 1000;
}

/** One stack of animal products in the bag. */
export interface ProductStack {
  /** Mutations carried by the product, inherited through crafting. */
  readonly effects?: readonly EffectId[];
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

/** @brief Whether this animal is sitting on a kept egg right now. */
export function animalIsIncubating(animal: AnimalState, now: number): boolean {
  return (animal.incubatingUntil ?? 0) > now;
}

/** @brief Egg product one species keeps for hatching, or `null` when it cannot breed. */
export function breedEggProduct(kind: AnimalId): ProductId | null {
  if (animalById(kind)?.building !== "coop") return null;
  if (kind === "chicken") return "egg";
  if (kind === "duck") return "duckEgg";
  return null;
}

/**
 * @brief Multiplier the pond growth applies to its produce and meat.
 * @param growth Pond growth in percent, `0..100`.
 */
export function pondGrowthFactor(growth: number): number {
  return 1 + Math.max(0, Math.min(POND_GROWTH_MAX, growth)) / 100;
}

/** Share of the purchase price a slaughtered animal returns. */
export const ANIMAL_MEAT_RATIO = 0.5;

/**
 * @brief Coins one animal returns when sold for meat.
 * @param kind Species.
 * @param stars Quality stars, `1..5`.
 * @param growth Pond growth in percent, ignored by land animals.
 * @details Slaughtering is a way out of a full building, never a profit: even a
 * five-star animal returns less than it cost, unless pond growth lifted it.
 */
/**
 * @brief Evaluates the meat sell price of an animal.
 * @param kind Animal species ID.
 * @param stars Animal quality stars (1..5).
 * @param growth Pond water growth bonus.
 * @param basePriceOverride Optional custom evaluation price (used for AI hybrids).
 * @return Meat sale price in coins.
 */
export function animalMeatPrice(
  kind: AnimalId,
  stars: number,
  growth = 0,
  basePriceOverride?: number,
): number {
  const definition = animalById(kind);
  if (definition === undefined) return 0;
  const clamped = Math.max(1, Math.min(5, stars));
  const quality = 1 + 0.2 * (clamped - 1);
  const pond = definition.building === "pond" ? pondGrowthFactor(growth) : 1;
  const buyPrice =
    typeof basePriceOverride === "number" && basePriceOverride > 0 ? basePriceOverride : definition.buy;
  return Math.round(buyPrice * ANIMAL_MEAT_RATIO * quality * pond);
}

/** Identifier for a craftable mine relic. */
export type RelicId = "crystalCharm" | "earthDragon" | "phoenixTalisman" | "midasSeal";

/** Maximum number of relics a player can equip at once. */
export const MAX_EQUIPPED_RELICS = 3;

/** Static definition of one craftable mine relic. */
export interface RelicDefinition {
  readonly id: RelicId;
  readonly costCoins: number;
  readonly materials: Readonly<Partial<Record<ProductId, number>>>;
}

/** Catalog of craftable mine relics forged from ores and gems. */
export const RELICS: readonly RelicDefinition[] = [
  { id: "crystalCharm", costCoins: 2_000_000, materials: { copperBar: 5, ruby: 1 } },
  { id: "earthDragon", costCoins: 8_000_000, materials: { ironBar: 5, goldBar: 3, coal: 5 } },
  { id: "phoenixTalisman", costCoins: 15_000_000, materials: { goldBar: 5, iridiumBar: 2 } },
  { id: "midasSeal", costCoins: 30_000_000, materials: { iridiumBar: 5, diamond: 3 } },
];

/**
 * @brief Looks up a relic definition by id.
 * @param id Candidate relic identifier.
 * @return Matching relic definition, or undefined.
 */
export function relicById(id: string): RelicDefinition | undefined {
  return RELICS.find((entry) => entry.id === id);
}

/** One active or claimable pet expedition. */
export interface PetExpeditionState {
  readonly id: string;
  readonly pet: PetId;
  readonly startedAt: number;
  readonly endsAt: number;
  readonly durationMin: 15 | 30;
}

/** Cooldown between equipped pet active skill triggers (30 minutes). */
export const PET_SKILL_COOLDOWN_MS = 30 * 60_000;

/** Identifier for a 3x3 / 9x9 plot synergy bonus. */
export type SynergyId = "trio" | "companion" | "harmony";

/** Computed synergy bonuses for a single plot slot. */
export interface PlotSynergy {
  readonly ids: readonly SynergyId[];
  readonly growScale: number;
  readonly sellBonus: number;
}

const FLOWER_OR_HERB_SEEDS = new Set<string>([
  "lavender",
  "chamomile",
  "mint",
  "rose",
  "sunflower",
  "lotus",
  "basil",
  "rosemary",
  "tea",
]);

/**
 * @brief Computes adjacency & line synergies for one crop plot inside a 3x3 patch or 9x9 greenhouse grid.
 * @param plots Flat array of plots (`3x3` patches per 9 slots when `gridWidth === 3`, or `9x9` when `gridWidth === 9`).
 * @param slot Target zero-based slot index.
 * @param gridWidth Row width (`3` for normal/VIP patches, `9` for greenhouse).
 * @param hybrids Optional custom hybrid definitions.
 * @return Active synergy ids, growth scale multiplier, and sell bonus fraction.
 */
export function plotSynergyAt(
  plots: readonly (PlotState | null)[],
  slot: number,
  gridWidth: 3 | 9,
  hybrids?: readonly HybridSeed[],
): PlotSynergy {
  const center = plots[slot] ?? null;
  if (center === null) return { ids: [], growScale: 1, sellBonus: 0 };

  const blockStart = gridWidth === 9 ? 0 : Math.floor(slot / 9) * 9;
  const blockSize = gridWidth === 9 ? 81 : 9;
  const local = slot - blockStart;
  const row = Math.floor(local / gridWidth);
  const col = local % gridWidth;
  const at = (r: number, c: number): PlotState | null => {
    if (r < 0 || c < 0 || r >= gridWidth || r * gridWidth + c >= blockSize) return null;
    return plots[blockStart + r * gridWidth + c] ?? null;
  };

  const ids: SynergyId[] = [];
  let growScale = 1;
  let sellBonus = 0;

  // 1. Trio: 3-in-a-row horizontally or vertically with the same seed.
  const same = (r: number, c: number): boolean => at(r, c)?.seed === center.seed;
  const hTrio =
    (same(row, col - 1) && same(row, col + 1)) ||
    (same(row, col - 2) && same(row, col - 1)) ||
    (same(row, col + 1) && same(row, col + 2));
  const vTrio =
    (same(row - 1, col) && same(row + 1, col)) ||
    (same(row - 2, col) && same(row - 1, col)) ||
    (same(row + 1, col) && same(row + 2, col));
  if (hTrio || vTrio) {
    ids.push("trio");
    growScale *= 0.85;
    sellBonus += 0.15;
  }

  const neighbors = [at(row - 1, col), at(row + 1, col), at(row, col - 1), at(row, col + 1)].filter(
    (entry): entry is PlotState => entry !== null,
  );

  // 2. Companion: adjacent to an herb or flower.
  const hasCompanion = neighbors.some((neighbor) => {
    const def = resolveSeed(neighbor.seed, hybrids);
    return def !== undefined && FLOWER_OR_HERB_SEEDS.has(def.id);
  });
  if (hasCompanion) {
    ids.push("companion");
    sellBonus += 0.25;
  }

  // 3. Seasonal Harmony: 3+ distinct seed varieties among center + orthogonal neighbors.
  const varieties = new Set<string>();
  const centerDef = resolveSeed(center.seed, hybrids);
  if (centerDef !== undefined) varieties.add(centerDef.id);
  for (const neighbor of neighbors) {
    const def = resolveSeed(neighbor.seed, hybrids);
    if (def !== undefined) varieties.add(def.id);
  }
  if (varieties.size >= 3) {
    ids.push("harmony");
    sellBonus += 0.5;
  }

  return { ids, growScale, sellBonus };
}

/** Rotating market news themes driving dynamic price surges per wave. */
export const MARKET_NEWS_THEMES: readonly MarketNewsSnapshot[] = [
  {
    id: "pastryFestival",
    tags: ["wheat", "strawberry", "blueberry", "cranberry", "bread", "jam"],
    multiplier: 1.8,
  },
  { id: "herbCraze", tags: ["tea", "lavender", "chamomile", "mint", "driedHerb"], multiplier: 1.9 },
  {
    id: "winterComfort",
    tags: ["mushroom", "soup", "wine", "cheese"],
    multiplier: 1.75,
  },
  {
    id: "industrialBoom",
    tags: ["copperBar", "ironBar", "goldBar", "iridiumBar", "coal", "ruby", "diamond"],
    multiplier: 1.8,
  },
  {
    id: "fruitFiesta",
    tags: ["fruit", "juice", "wine", "apple", "mango", "grape", "peach"],
    multiplier: 1.75,
  },
];

/**
 * @brief Returns the deterministic market surge news for a given wave.
 * @param wave Zero-based phase wave index.
 * @return Active MarketNewsSnapshot.
 */
export function marketNewsFor(wave: number): MarketNewsSnapshot {
  const index = Math.abs(wave) % MARKET_NEWS_THEMES.length;
  return MARKET_NEWS_THEMES[index] ?? MARKET_NEWS_THEMES[0]!;
}

/**
 * @brief Computes the active market news multiplier for a crop or tree item.
 * @param item Item identifier.
 * @param news Active market news, if any.
 * @return Price multiplier (>= 1).
 */
export function newsMultiplierForCrop(item: string, news?: MarketNewsSnapshot): number {
  if (news === undefined) return 1;
  const seed = seedById(item);
  if (seed !== undefined && news.tags.includes(seed.id)) {
    return news.multiplier;
  }
  const tree = treeById(item);
  if (tree !== undefined && (news.tags.includes(tree.id) || news.tags.includes("fruit"))) {
    return news.multiplier;
  }
  return 1;
}

/**
 * @brief Computes the active market news multiplier for a crafted product.
 * @param product Product identifier.
 * @param news Active market news, if any.
 * @return Price multiplier (>= 1).
 */
export function newsMultiplierForProduct(product: string, news?: MarketNewsSnapshot): number {
  if (news === undefined) return 1;
  if (news.tags.includes(product)) return news.multiplier;
  const def = productById(product);
  if (def !== undefined && news.tags.includes("mushroom") && def.id.includes("Mushroom")) {
    return news.multiplier;
  }
  return 1;
}

/** @brief Sell value of one product stack, after quality, event, and market news bonus. */
export function productPrice(stack: ProductStack, season: SeasonSnapshot): number {
  const definition = productById(stack.product);
  if (definition === undefined) return 0;
  const quality = 2 ** Math.max(0, Math.min(5, stack.star) - 1);
  const bonus = combinedSellBonus(
    season.events.length > 0 ? eventsAt(season.event.startedAt) : eventsAt(season.event.startedAt),
  );
  const mutation = effectsMultiplier(stack.effects ?? []);
  const newsMult = newsMultiplierForProduct(stack.product, season.news);
  return Math.max(1, Math.round(definition.base * quality * bonus * mutation * newsMult));
}

/** One occupied plot on the wire. */
export interface PlotState {
  /** Absolute plot index, `0..MAX_PLOTS-1`. */
  readonly slot: number;
  /** Seed planted here. */
  readonly seed: AnySeedId;
  /** Wall-clock planting time, server clock. */
  readonly plantedAt: number;
  /** Wall-clock time the crop becomes harvestable. */
  readonly readyAt: number;
  /** Mutations carried by the current fruit; may hold several at once. */
  readonly effects: readonly EffectId[];
  /** Whether pests are damaging this crop right now. */
  readonly pest: boolean;
  /** Server time the disease started; it dies after a few cycles. */
  readonly diseasedAt?: number;
  /** Burnt by a fire and unusable until repaired. */
  readonly damaged?: boolean;
  /** Prestige mutation bonus stored at planting for periodic rolls. */
  readonly mutationBoost?: number;
  /** Wealth bad-luck bonus stored at planting for periodic rolls. */
  readonly badLuck?: number;
  /** Pesticide protection expiry; pests cannot strike before it. */
  readonly protectedUntil: number;
  /** Whether the owner already watered this planting. */
  readonly watered: boolean;
  /** Full growth duration at planting; watered plants restart from here. */
  readonly growMs?: number;
  /** Unwatered for 24h: dead, cannot be harvested, must be uprooted. */
  readonly dead?: boolean;
  /** Whether the owner already fertilized this planting. */
  readonly fertilized: boolean;
  /** Fruits already harvested from this plant; `0` for single-harvest crops. */
  readonly harvests: number;
  /** Active fertilizer, or `null`. */
  readonly fertilizer: ActiveFertilizer | null;
  /** Active spray, or `null`. */
  readonly spray: ActiveSpray | null;
  /** Pinned by a favorite lock: nothing harvests, moves or removes it. */
  readonly favorite?: boolean;
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
  /** Server time the disease started; it dies after a few cycles. */
  readonly diseasedAt?: number;
  /** Pesticide protection expiry; pests cannot strike before it. */
  readonly protectedUntil: number;
  /** Whether the owner already watered this cycle. */
  readonly watered: boolean;
  /** Full growth duration at planting; watered plants restart from here. */
  readonly growMs?: number;
  /** Unwatered for 24h: dead, cannot be picked, must be uprooted. */
  readonly dead?: boolean;
  /** Whether the owner already fertilized this cycle. */
  readonly fertilized: boolean;
  /** Prestige mutation bonus stored at planting for periodic rolls. */
  readonly mutationBoost?: number;
  /** Wealth bad-luck bonus stored at planting for periodic rolls. */
  readonly badLuck?: number;
  /** Fruits already picked from this tree. */
  readonly harvests: number;
  /** Active fertilizer, or `null`. */
  readonly fertilizer: ActiveFertilizer | null;
  /** Active spray, or `null`. */
  readonly spray: ActiveSpray | null;
  /** Pinned by a favorite lock: nothing harvests, moves or removes it. */
  readonly favorite?: boolean;
}

/** One stack of harvested produce in the bag. */
export interface CropStack {
  /** Item of the harvested stack: a seed's crop or a tree's fruit. */
  readonly item: AnyItemId;
  /** Mutations the stack carried when harvested. */
  readonly effects: readonly EffectId[];
  /** Harvested from a pest-damaged plant; sells for half. */
  readonly pest?: boolean;
  /** Quality stars, `1..5`; every star doubles the value. Defaults to 1. */
  readonly star?: number;
  /** Units in the stack. */
  readonly qty: number;
}

/** Seeds and crops the player owns. */
export interface BagState {
  /** Unplanted seeds by id; missing ids are zero. */
  readonly seeds: Readonly<Partial<Record<AnySeedId, number>>>;
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

/** One line in the player's sale history. */
export interface SaleRecord {
  /** Server time of the sale. */
  readonly ts: number;
  /** What was sold. */
  readonly kind: "crop" | "product" | "animal" | "contract";
  /** Item id (crop/fruit/product/animal) or contract label. */
  readonly item: string;
  /** Units sold. */
  readonly qty: number;
  /** Quality stars when relevant. */
  readonly star?: number;
  /** Mutations carried by the sold stack. */
  readonly effects?: readonly EffectId[];
  /** Gross coins before tax. */
  readonly gross: number;
  /** Coins actually received. */
  readonly net: number;
}

/** Coins awarded the first time a collection key is claimed. */
export function codexReward(key: string): number {
  if (key.startsWith("effect:")) return 250_000;
  if (key.startsWith("seed:")) return 50_000;
  if (key.startsWith("product:")) return 100_000;
  if (key.startsWith("tool:")) return 100_000;
  if (key.startsWith("pet:")) return 1_000_000;
  if (key.startsWith("animal:")) return 150_000;
  if (key.startsWith("fish:")) return 200_000;
  if (key.startsWith("hybrid:")) return 500_000;
  if (key.startsWith("machine:")) return 500_000;
  if (key === "star:5") return 500_000;
  return 0;
}

/** One owner-visible garden timeline entry. */
export interface TimelineEvent {
  /** Server time. */
  readonly ts: number;
  /** Event family, used for the localized label. */
  readonly kind:
    "plant" | "harvest" | "sale" | "prestige" | "hazard" | "codex" | "skill" | "purchase" | "craft" | "breed";
  /** Item/product or short target id. */
  readonly item?: string;
  /** Quantity or secondary number. */
  readonly qty?: number;
  /** Coins moved by the event, when relevant. */
  readonly coins?: number;
}

/** One step of the permanent NPC contract chain. */
export interface ContractChainStep {
  /** Stable step id. */
  readonly id: string;
  /** Product to deliver. */
  readonly product: ProductId;
  /** Units required. */
  readonly qty: number;
  /** Minimum star quality. */
  readonly star: number;
  /** Coin reward. */
  readonly reward: number;
}

/** Permanent five-step NPC storyline chain. */
export const CONTRACT_CHAIN: readonly ContractChainStep[] = [
  { id: "farmhand", product: "egg", qty: 10, star: 1, reward: 15_000 },
  { id: "dairy", product: "milk", qty: 15, star: 2, reward: 40_000 },
  { id: "weaver", product: "wool", qty: 10, star: 3, reward: 100_000 },
  { id: "cheesemonger", product: "cheese", qty: 5, star: 3, reward: 300_000 },
  { id: "gourmet", product: "caviar", qty: 1, star: 4, reward: 1_000_000 },
];

/** One player-discovered recipe approved by the LLM. */
export interface CustomRecipe {
  /** Deterministic id from the sorted inputs/output. */
  readonly id: string;
  /** Ingredient ids chosen by the player. */
  readonly inputs: readonly string[];
  /** Dish name. */
  readonly output: string;
  /** Model-suggested coin value. */
  readonly price: number;
  /** Server time it was learned. */
  readonly createdAt: number;
}

/** Shared locust-raid state. */
export interface RaidSnapshot {
  /** Day window index. */
  readonly window: number;
  /** Remaining swarm HP. */
  readonly hp: number;
  /** Starting HP. */
  readonly maxHp: number;
  /** Server time the raid resets. */
  readonly endsAt: number;
}

/** Locust raid size and duration. */
export const RAID_MAX_HP = 10_000;
/** Damage dealt to the shared locust boss per player strike. */
export const RAID_HIT_DAMAGE = 250;
/** Fraction of the player's total coins deducted per locust raid strike (5%). */
export const RAID_HIT_COST_RATE = 0.05;

/**
 * @brief Calculates the coin cost for one locust raid strike (5% of total coins).
 * @param coins Player's current coin balance.
 * @return Coin deduction for one strike (at least 1 coin when balance is positive, else 0).
 */
export function raidHitCost(coins: number): number {
  if (!Number.isFinite(coins) || coins <= 0) return 0;
  return Math.max(1, Math.round(coins * RAID_HIT_COST_RATE));
}

/** @brief Daily raid window. */
export function raidWindowAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / DAY_MS);
}

/** @brief End of the current raid window. */
export function raidEndsAt(now: number): number {
  return EPOCH_MS + (raidWindowAt(now) + 1) * DAY_MS;
}

/** One guild member summary. */
export interface GuildMember {
  readonly playerId: string;
  readonly nick: string;
  readonly code: string;
  readonly joinedAt: number;
}

/** Market region for a listed stock ticker. */
export type StockMarketRegion = "VN" | "US";

/** Static definition of one stock listed on the Townhall Stock Exchange. */
export interface StockDefinition {
  readonly symbol: string;
  readonly name: string;
  readonly market: StockMarketRegion;
  readonly currency: "VND" | "USD";
  readonly fallbackPrice: number;
}

/** Realtime or cached quote for one stock ticker. */
export interface StockQuote {
  readonly symbol: string;
  readonly name: string;
  readonly market: StockMarketRegion;
  readonly currency: "VND" | "USD";
  readonly rawPrice: number;
  readonly changePct: number;
  readonly coinPrice: number;
  readonly updatedAt: number;
  readonly source: "live" | "cached" | "fallback";
}

/** Player share holding for one stock symbol. */
export interface StockHolding {
  readonly shares: number;
  readonly avgCostCoins: number;
}

/** Listed Vietnamese (HOSE) and International (NASDAQ/NYSE) stocks. */
export const STOCK_CATALOG: readonly StockDefinition[] = [
  { symbol: "VCB.VN", name: "Vietcombank", market: "VN", currency: "VND", fallbackPrice: 92_500 },
  { symbol: "FPT.VN", name: "FPT Corp", market: "VN", currency: "VND", fallbackPrice: 135_000 },
  { symbol: "VNM.VN", name: "Vinamilk", market: "VN", currency: "VND", fallbackPrice: 66_000 },
  { symbol: "HPG.VN", name: "Hoa Phat", market: "VN", currency: "VND", fallbackPrice: 27_200 },
  { symbol: "VIC.VN", name: "Vingroup", market: "VN", currency: "VND", fallbackPrice: 41_500 },
  { symbol: "MWG.VN", name: "Mobile World", market: "VN", currency: "VND", fallbackPrice: 63_000 },
  { symbol: "AAPL", name: "Apple", market: "US", currency: "USD", fallbackPrice: 230 },
  { symbol: "NVDA", name: "NVIDIA", market: "US", currency: "USD", fallbackPrice: 140 },
  { symbol: "MSFT", name: "Microsoft", market: "US", currency: "USD", fallbackPrice: 420 },
  { symbol: "GOOGL", name: "Alphabet", market: "US", currency: "USD", fallbackPrice: 175 },
  { symbol: "TSLA", name: "Tesla", market: "US", currency: "USD", fallbackPrice: 340 },
  { symbol: "AMZN", name: "Amazon", market: "US", currency: "USD", fallbackPrice: 210 },
];

/**
 * @brief Converts a live VND or USD stock price into in-game garden coins.
 * @param rawPrice Market price in native currency.
 * @param currency Native currency (`VND` or `USD`).
 * @return Integer share price in garden coins.
 */
export function stockCoinPrice(rawPrice: number, currency: "VND" | "USD"): number {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 1_000;
  return currency === "VND"
    ? Math.max(100, Math.round(rawPrice / 10))
    : Math.max(100, Math.round(rawPrice * 2_500));
}

/**
 * @brief Looks up a stock definition by ticker symbol.
 * @param symbol Ticker symbol (e.g. `FPT.VN`, `AAPL`).
 * @return Matching StockDefinition, or undefined.
 */
export function stockBySymbol(symbol: string): StockDefinition | undefined {
  return STOCK_CATALOG.find((entry) => entry.symbol === symbol);
}

/** Guild co-op weekly project progress. */
export interface GuildProjectSnapshot {
  /** Target item id (product or seed/crop). */
  readonly item: ProductId | SeedId;
  /** Total quantity required to finish the project. */
  readonly target: number;
  /** Current quantity donated by guild members. */
  readonly progress: number;
  /** Whether the project target has been reached. */
  readonly completed: boolean;
  /** Bonus coins awarded to the guild bank on completion. */
  readonly rewardCoins: number;
}

/** Guild summary returned by the hub. */
export interface GuildSnapshot {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly members: readonly GuildMember[];
  /** Shared guild coin bank. */
  readonly bank: number;
  readonly createdAt: number;
  /** Shared guild co-op project. */
  readonly project?: GuildProjectSnapshot;
}

/** Price of building the kitchen inside the warehouse. */
export const KITCHEN_PRICE = 50_000_000;

/** One public row in the global sale log. */
export interface GlobalSaleEntry extends SaleRecord {
  /** Seller share code. */
  readonly code: string;
  /** Seller display name. */
  readonly nick: string;
  /** Seller prestige level at sale time. */
  readonly prestige: number;
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

/** A full real day (24h) without water kills a plant, but leaves it for uprooting. */
export const PLANT_THIRST_MS = DAY_MS;

/** Current thirst rule version; older saves revive plants killed by the 20-minute rule. */
export const THIRST_RULE_VERSION = 2;

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

/** Maximum number of plots inside the greenhouse (9x9 grid = 81). */
export const GREENHOUSE_SLOTS = 81;

/** Greenhouse slots unlocked per greenhouse upgrade level (27, 54, 81). */
export const GREENHOUSE_SLOTS_PER_LEVEL = 27;

/** Effect guaranteed on every greenhouse crop harvest (x3 sell price). */
export const GREENHOUSE_MUTATION: EffectId = "highquality";

/**
 * @brief Computes unlocked greenhouse plots for a greenhouse level.
 * @param level Current greenhouse upgrade level (`0..3`).
 * @return Number of open greenhouse plots, capped at {@link GREENHOUSE_SLOTS}.
 */
export function greenhouseCapacity(level: number): number {
  return Math.min(GREENHOUSE_SLOTS, Math.max(0, Math.floor(level)) * GREENHOUSE_SLOTS_PER_LEVEL);
}

/** Quality tier produced by Nursery cross-breeding. */
export type HybridTier = "elite" | "normal" | "dud";

/** Prefix for player-bred custom hybrid seed ids. */
export const HYBRID_PREFIX = "hybrid:";

/** Wire format check for hybrid seed identifiers. */
export const HYBRID_ID_RE = /^hybrid:[a-z0-9_-]{1,24}$/;

/** Minimum and maximum parent plants combined in one Nursery cross-breed. */
export const MIN_BREED_PARENTS = 2;
export const MAX_BREED_PARENTS = 6;

/** Maximum stored hybrid varieties per garden. */
export const MAX_HYBRIDS = 40;

/** Nursery cross-breeding base price (2 parents) and exponential factor per extra parent. */
export const NURSERY_BASE_COST = 50_000;
export const NURSERY_COST_FACTOR = 3;

/** Custom cross-bred plant variety minted in the Nursery. */
export interface HybridSeed {
  /** Stable identifier (`hybrid:<n>`). */
  readonly id: HybridId;
  /** User-editable display name. */
  readonly name: string;
  /** Parent item ids combined to create this variety. */
  readonly parents: readonly string[];
  /** Rolled genetics tier: elite (cây xịn), normal, or dud (cây đểu). */
  readonly tier: HybridTier;
  /** Growth time in milliseconds. */
  readonly growMs: number;
  /** Base sale price of one harvested hybrid crop. */
  readonly sell: number;
  /** Whether the crop regrows after harvesting. */
  readonly regrow: boolean;
  /** Guaranteed bonus mutation on elite hybrids. */
  readonly bonusEffect?: EffectId;
  /** Four ASCII glyphs: seed, sprout, young, ripe. */
  readonly art: readonly [string, string, string, string];
  /** Creation server timestamp. */
  readonly createdAt: number;
}

/**
 * @brief Checks whether a seed/item identifier refers to a custom Nursery hybrid.
 * @param id Identifier string from wire or bag.
 * @return True if the identifier matches the hybrid prefix format.
 */
export function isHybridId(id: string): id is HybridId {
  return HYBRID_ID_RE.test(id);
}

/**
 * @brief Computes exponential cross-breeding cost for a parent count.
 * @param parentCount Number of selected parent plants (`>= 2`).
 * @return Coins required: `NURSERY_BASE_COST * NURSERY_COST_FACTOR^(parentCount - 2)`.
 */
export function hybridBreedCost(parentCount: number): number {
  const extra = Math.max(0, Math.min(MAX_BREED_PARENTS, Math.floor(parentCount)) - MIN_BREED_PARENTS);
  return NURSERY_BASE_COST * NURSERY_COST_FACTOR ** extra;
}

/**
 * @brief Computes outcome probabilities for a Nursery cross-breed roll.
 * @param parentCount Number of selected parents (`2..6`).
 * @param spliceBonus Genetics splice bonus points (`0..20`).
 * @return Probabilities in `0..1` summing to `1` for `elite`, `normal`, and `dud`.
 */
export function hybridOdds(
  parentCount: number,
  spliceBonus = 0,
): { readonly elite: number; readonly normal: number; readonly dud: number } {
  const extra = Math.max(0, Math.min(MAX_BREED_PARENTS, Math.floor(parentCount)) - MIN_BREED_PARENTS);
  const elite = Math.min(0.65, 0.25 + extra * 0.05 + Math.max(0, spliceBonus) * 0.005);
  const dud = Math.max(0.15, 0.3 - extra * 0.03);
  const normal = Math.max(0.05, Number((1 - elite - dud).toFixed(4)));
  return { elite, normal, dud };
}

/** Pet levels: prices and extra pest-chance reduction per level. */
export const PET_PRICES: readonly number[] = [100_000, 300_000, 800_000];

/** Genetics: maximum splice bonus in percentage points. */
export const SPLICE_MAX_BONUS = 20;

/** Compost: harvested crops needed per fertilizer. */
export const COMPOST_RATIO = 2;

/** Lucky wheel base price and pity spins. */
export const WHEEL_PRICE = 10_000;
export const WHEEL_PITY = 20;

/**
 * @brief Coins the next wheel spin costs today.
 * @param spins Spins already done today; the price doubles after each one.
 * @details `WHEEL_PRICE * 2^(spins + 1)`, capped so the number stays in the
 * safe integer range even for absurd daily counts.
 */
export function wheelCost(spins: number): number {
  const exponent = Math.min(35, Math.max(0, Math.floor(spins)) + 1);
  return WHEEL_PRICE * 2 ** exponent;
}

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

/** Chores a hired hand can be assigned to. */
export type StaffRole = "water" | "plant" | "harvest" | "harvestMushroom" | "saleHunt" | "mine";

/** Every assignable staff chore, in strip order. */
export const STAFF_ROLES: readonly StaffRole[] = [
  "water",
  "plant",
  "harvest",
  "harvestMushroom",
  "saleHunt",
  "mine",
];

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
  /** Level, `1..STAFF_MAX_LEVEL`; higher levels work faster. */
  readonly level: number;
  /** Experience inside the current level. */
  readonly xp: number;
}

/** Labour market rotation and slot rules. */
export const STAFF_MARKET_MS = 60 * 60_000;
/** Hired hands a garden can keep at once. */
export const STAFF_SLOTS = 4;
export const STAFF_QUIT_UNPAID = 3;
/** Level ceiling and experience rules for hired staff. */
export const STAFF_MAX_LEVEL = 10;
/** Experience granted per finished job. */
export const STAFF_XP_PER_TASK = 12;

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

/** @brief Deterministic labour market for one player (ten candidates). */
export function staffMarketAt(playerId: string, now: number): StaffDefinition[] {
  const window = staffWindowAt(now);
  const rng = createRng(hash32(`staff:${playerId}:${window}`));
  const badTraits: StaffTrait[] = ["lazy", "slow", "clumsy", "greedy"];
  const goodTraits: StaffTrait[] = ["diligent", "greenThumb"];
  const candidates: StaffDefinition[] = [];
  for (let index = 0; index < 10; index += 1) {
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

/** @brief One-off hiring fee for a candidate; better hands cost more. */
export function staffHireCost(candidate: StaffDefinition): number {
  return 50_000 + candidate.speed * 25_000 + candidate.skill * 30_000;
}

/**
 * @brief Minutes between two full work runs.
 * @details One run finishes the whole task (waters everything, harvests
 * everything, ...). Quality shortens the wait: the best tier runs every ten
 * minutes, rookies take about an hour.
 */
export function staffWorkIntervalMs(
  worker: Pick<StaffState, "speed" | "skill" | "level" | "traits">,
): number {
  const quality = worker.speed + worker.skill + Math.floor(worker.level / 2);
  const traits = (worker.traits.includes("slow") ? 8 : 0) - (worker.traits.includes("diligent") ? 8 : 0);
  const minutes = Math.max(10, 70 - quality * 4 + traits);
  return minutes * 60_000;
}

/** @brief Experience needed to leave one level. */
export function staffXpToLevel(level: number): number {
  return level * 100;
}

/**
 * @brief Applies experience, rolling any level-ups it earns.
 * @return The new level and the experience left inside it.
 */
export function staffGainXp(level: number, xp: number): { level: number; xp: number } {
  let nextLevel = Math.max(1, Math.min(STAFF_MAX_LEVEL, level));
  let nextXp = Math.max(0, xp);
  while (nextLevel < STAFF_MAX_LEVEL && nextXp >= staffXpToLevel(nextLevel)) {
    nextXp -= staffXpToLevel(nextLevel);
    nextLevel += 1;
  }
  if (nextLevel >= STAFF_MAX_LEVEL) nextXp = Math.min(nextXp, staffXpToLevel(STAFF_MAX_LEVEL));
  return { level: nextLevel, xp: nextXp };
}

/* ------------------------------------------------------------------ skills */

/** Skill tracks. */
export type SkillId = "farming" | "ranching" | "artisaning";

/** Skill level cap. */
export const SKILL_MAX_LEVEL = 10;

/** Progress of one skill. */
export interface SkillState {
  /** Current level, 0..10. */
  readonly level: number;
  /** Experience inside the current level. */
  readonly xp: number;
}

/** All skill progress. */
export type SkillsState = Readonly<Record<SkillId, SkillState>>;

/** Fresh skill progress for a new garden. */
export const DEFAULT_SKILLS: SkillsState = {
  farming: { level: 0, xp: 0 },
  ranching: { level: 0, xp: 0 },
  artisaning: { level: 0, xp: 0 },
};

/** @brief XP needed to leave one level, per the exponential formula.
 * @details `next = 1000 + previous * 2^(level + 1)`; level 0 needs 1000 XP.
 */
export function skillThreshold(level: number): number {
  if (level <= 0) return 1000;
  let previous = 1000;
  for (let current = 1; current <= level; current += 1) {
    previous = 1000 + previous * 2 ** (current + 1);
  }
  return previous;
}

/** @brief Adds XP to one skill and returns the updated level/xp. */
export function addSkillXp(state: SkillState, amount: number): SkillState {
  if (amount <= 0) return state;
  let level = state.level;
  let xp = state.xp + Math.max(0, Math.floor(amount));
  while (level < SKILL_MAX_LEVEL) {
    const threshold = skillThreshold(level);
    if (xp < threshold) break;
    xp -= threshold;
    level += 1;
  }
  if (level >= SKILL_MAX_LEVEL) xp = 0;
  return { level, xp };
}

/** @brief Farming sale bonus: 2% per level plus milestones at 5 and 10. */
export function farmingSellBonus(level: number): number {
  return level * 0.02 + (level >= 5 ? 0.05 : 0) + (level >= 10 ? 0.15 : 0);
}

/** @brief Farming growth-speed factor (1 = unchanged). */
export function farmingGrowFactor(level: number): number {
  return Math.max(0.7, 1 - level * 0.01);
}

/** @brief Ranching animal-upkeep factor (1 = unchanged). */
export function ranchingUpkeepFactor(level: number): number {
  return Math.max(0.6, 1 - level * 0.02);
}

/** @brief Ranching product-price bonus. */
export function ranchingSellBonus(level: number): number {
  return level * 0.02 + (level >= 5 ? 0.05 : 0) + (level >= 10 ? 0.15 : 0);
}

/** @brief Artisaning machine-output bonus. */
export function artisaningOutputBonus(level: number): number {
  return level * 0.02 + (level >= 5 ? 0.05 : 0) + (level >= 10 ? 0.15 : 0);
}

/** @brief Perks unlocked at each milestone level. */
export const SKILL_PERKS: Readonly<Record<SkillId, readonly number[]>> = {
  farming: [2, 5, 8, 10],
  ranching: [2, 5, 8, 10],
  artisaning: [2, 5, 8, 10],
};

/* ------------------------------------------------------------------ mine */

/** Total rock cells in one mine floor grid (5x5). */
export const MINE_FLOOR_CELLS = 25;

/** Possible states of a rock cell inside a mine floor. */
export type MineRockKind =
  "stone" | "gravel" | "copper" | "iron" | "gold" | "iridium" | "gem" | "chest" | "ladder" | "empty";

/**
 * @brief Representation of a single rock/cell on the mine floor grid.
 */
export interface MineRockCell {
  /** Kind of rock or deposit. */
  readonly kind: MineRockKind;
  /** Current remaining hit points. */
  readonly hp: number;
  /** Maximum hit points required to break. */
  readonly maxHp: number;
  /** Primary ore product dropped when broken. */
  readonly oreDrop?: ProductId;
  /** Quantity of product dropped (defaults to 1). */
  readonly dropQty?: number;
  /** Whether clearing this rock reveals the descending ladder. */
  readonly hasLadder?: boolean;
}

/**
 * @brief Tier definition for player pickaxes.
 */
export interface PickaxeTier {
  /** Pickaxe level index (0 = Rusty, 4 = Iridium). */
  readonly level: number;
  /** Damage dealt per strike to rock cells. */
  readonly damage: number;
  /** Type of metal bar required to craft this tier. */
  readonly barType?: ProductId;
  /** Count of metal bars required. */
  readonly barCount?: number;
  /** Coin cost for upgrading to this tier. */
  readonly cost: number;
}

/** Pickaxe progression ladder. */
export const PICKAXE_TIERS: readonly PickaxeTier[] = [
  { level: 0, damage: 1, cost: 0 },
  { level: 1, damage: 2, barType: "copperBar", barCount: 5, cost: 50_000 },
  { level: 2, damage: 3, barType: "ironBar", barCount: 5, cost: 250_000 },
  { level: 3, damage: 4, barType: "goldBar", barCount: 5, cost: 1_000_000 },
  { level: 4, damage: 6, barType: "iridiumBar", barCount: 5, cost: 5_000_000 },
];

/**
 * @brief State of the player's mine expedition.
 */
export interface MineState {
  /** Current floor depth (1-based index). */
  readonly currentFloor: number;
  /** Deepest floor reached (unlocks elevator checkpoints). */
  readonly maxFloor: number;
  /** Current pickaxe upgrade level (0..4). */
  readonly pickaxeLevel: number;
  /** Current available stamina points. */
  readonly stamina: number;
  /** Maximum stamina pool (default 100). */
  readonly maxStamina: number;
  /** Last server timestamp stamina was regenerated or settled. */
  readonly lastStaminaAt: number;
  /** Current 5x5 rock cells grid on the floor. */
  readonly grid: readonly MineRockCell[];
  /** Staff slot index assigned to mine chore, or null if unassigned. */
  readonly assignedStaffSlot: number | null;
}

/**
 * @brief Generates a deterministic 5x5 mine floor grid for a specific depth.
 * @param floor Floor depth (1..100+).
 * @param seed Random seed for determinism.
 * @return 25 rock cells with appropriate ores, HP, and a hidden ladder.
 */
export function generateMineFloor(floor: number, seed: number): readonly MineRockCell[] {
  const rng = createRng(Math.abs(seed) || 12345);
  const ladderSlot = Math.floor(rng() * MINE_FLOOR_CELLS);
  const cells: MineRockCell[] = [];

  for (let slot = 0; slot < MINE_FLOOR_CELLS; slot += 1) {
    const roll = rng();
    const hasLadder = slot === ladderSlot;

    if (floor <= 15) {
      if (roll < 0.5) {
        cells.push({
          kind: "stone",
          hp: 1,
          maxHp: 1,
          oreDrop: "stone",
          dropQty: 1 + Math.floor(rng() * 2),
          hasLadder,
        });
      } else if (roll < 0.75) {
        cells.push({
          kind: "gravel",
          hp: 1,
          maxHp: 1,
          oreDrop: rng() < 0.5 ? "coal" : "stone",
          dropQty: 1,
          hasLadder,
        });
      } else if (roll < 0.94) {
        cells.push({
          kind: "copper",
          hp: 2,
          maxHp: 2,
          oreDrop: "copperOre",
          dropQty: 1 + Math.floor(rng() * 2),
          hasLadder,
        });
      } else if (roll < 0.98) {
        cells.push({ kind: "gem", hp: 3, maxHp: 3, oreDrop: "amethyst", dropQty: 1, hasLadder });
      } else {
        cells.push({ kind: "chest", hp: 1, maxHp: 1, hasLadder });
      }
    } else if (floor <= 35) {
      if (roll < 0.35) {
        cells.push({ kind: "stone", hp: 2, maxHp: 2, oreDrop: "stone", dropQty: 2, hasLadder });
      } else if (roll < 0.55) {
        cells.push({
          kind: "gravel",
          hp: 1,
          maxHp: 1,
          oreDrop: "coal",
          dropQty: 1 + Math.floor(rng() * 2),
          hasLadder,
        });
      } else if (roll < 0.75) {
        cells.push({ kind: "copper", hp: 2, maxHp: 2, oreDrop: "copperOre", dropQty: 2, hasLadder });
      } else if (roll < 0.92) {
        cells.push({
          kind: "iron",
          hp: 3,
          maxHp: 3,
          oreDrop: "ironOre",
          dropQty: 1 + Math.floor(rng() * 2),
          hasLadder,
        });
      } else if (roll < 0.98) {
        cells.push({
          kind: "gem",
          hp: 3,
          maxHp: 3,
          oreDrop: rng() < 0.5 ? "amethyst" : "ruby",
          dropQty: 1,
          hasLadder,
        });
      } else {
        cells.push({ kind: "chest", hp: 1, maxHp: 1, hasLadder });
      }
    } else if (floor <= 65) {
      if (roll < 0.3) {
        cells.push({ kind: "stone", hp: 2, maxHp: 2, oreDrop: "stone", dropQty: 2, hasLadder });
      } else if (roll < 0.45) {
        cells.push({ kind: "gravel", hp: 1, maxHp: 1, oreDrop: "coal", dropQty: 2, hasLadder });
      } else if (roll < 0.65) {
        cells.push({ kind: "iron", hp: 3, maxHp: 3, oreDrop: "ironOre", dropQty: 2, hasLadder });
      } else if (roll < 0.88) {
        cells.push({
          kind: "gold",
          hp: 4,
          maxHp: 4,
          oreDrop: "goldOre",
          dropQty: 1 + Math.floor(rng() * 2),
          hasLadder,
        });
      } else if (roll < 0.97) {
        const gemPick = rng();
        const gem: ProductId = gemPick < 0.4 ? "ruby" : gemPick < 0.8 ? "emerald" : "diamond";
        cells.push({ kind: "gem", hp: 4, maxHp: 4, oreDrop: gem, dropQty: 1, hasLadder });
      } else {
        cells.push({ kind: "chest", hp: 1, maxHp: 1, hasLadder });
      }
    } else {
      if (roll < 0.25) {
        cells.push({ kind: "stone", hp: 3, maxHp: 3, oreDrop: "stone", dropQty: 3, hasLadder });
      } else if (roll < 0.4) {
        cells.push({ kind: "gravel", hp: 1, maxHp: 1, oreDrop: "coal", dropQty: 2, hasLadder });
      } else if (roll < 0.6) {
        cells.push({ kind: "gold", hp: 4, maxHp: 4, oreDrop: "goldOre", dropQty: 2, hasLadder });
      } else if (roll < 0.82) {
        cells.push({
          kind: "iridium",
          hp: 5,
          maxHp: 5,
          oreDrop: "iridiumOre",
          dropQty: 1 + Math.floor(rng() * 2),
          hasLadder,
        });
      } else if (roll < 0.96) {
        const gemPick = rng();
        const gem: ProductId = gemPick < 0.4 ? "emerald" : gemPick < 0.8 ? "diamond" : "prismaticShard";
        cells.push({ kind: "gem", hp: 5, maxHp: 5, oreDrop: gem, dropQty: 1, hasLadder });
      } else {
        cells.push({ kind: "chest", hp: 1, maxHp: 1, hasLadder });
      }
    }
  }

  return cells;
}

/**
 * @brief Constructs a fresh mine state.
 * @param seed Optional random seed.
 * @return Initialized MineState at Floor 1.
 */
export function initialMineState(seed = 12345): MineState {
  return {
    currentFloor: 1,
    maxFloor: 1,
    pickaxeLevel: 0,
    stamina: 100,
    maxStamina: 100,
    lastStaminaAt: 0,
    grid: generateMineFloor(1, seed),
    assignedStaffSlot: null,
  };
}

/**
 * @brief Computes list of elevator checkpoint floors unlocked by the player.
 * @param maxFloor Deepest floor reached.
 * @return Array of floor numbers (e.g. [1, 5, 10, 15...]).
 */
export function mineElevatorCheckpoints(maxFloor: number): readonly number[] {
  const checkpoints: number[] = [1];
  for (let f = 5; f <= maxFloor; f += 5) {
    checkpoints.push(f);
  }
  return checkpoints;
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
  /** Completed permanent NPC contract chain steps. */
  readonly chainStep?: number;
  /** Recipes learned through the AI Recipe Lab. */
  readonly recipes?: readonly CustomRecipe[];
  /** Last cook timestamp per custom recipe. */
  readonly recipeCookedAt?: Readonly<Record<string, number>>;
  /** Whether the warehouse kitchen has been built. */
  readonly kitchen?: boolean;
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
  /** Permanent prestige level; each level adds 5% sale value. */
  readonly prestige?: number;
  /** Daily quests for the current local day. */
  readonly quests?: readonly QuestSnapshot[];
  /** Coins taken by the last daily asset tax. */
  readonly taxLast?: number;
  /** Prestige coins earned per 1000b lifetime earnings. */
  readonly prestigeCoins?: number;
  readonly prestigeShopDay?: number;
  readonly nextPrestigeAt?: number;
  /** Progress toward the next prestige coin. */
  readonly prestigeProgress?: number;
  /** Spent prestige skill points per branch. */
  readonly prestigeSkills?: Partial<Record<PrestigeSkillId, number>>;
  /** Unspent prestige skill points. */
  readonly prestigePoints?: number;
  /** Crafted mine relics owned by the player. */
  readonly relics?: readonly RelicId[];
  /** Currently equipped mine relics (up to MAX_EQUIPPED_RELICS). */
  readonly equippedRelics?: readonly RelicId[];
  /** Active or completed pet expeditions waiting to be claimed. */
  readonly petExpeditions?: readonly PetExpeditionState[];
  /** Server timestamp of the last equipped pet active skill trigger. */
  readonly petSkillAt?: number;
  /** Stock exchange portfolio keyed by ticker symbol. */
  readonly stocks?: Readonly<Record<string, StockHolding>>;
}

/** Kinds of daily quest progress the server tracks. */
export type QuestKind = "water" | "plant" | "harvest" | "earn" | "pat" | "craft";

/** One daily quest template. */
export interface QuestDefinition {
  readonly id: string;
  readonly kind: QuestKind;
  readonly target: number;
  readonly reward: number;
}

/** One quest as shown to the player. */
export interface QuestSnapshot {
  readonly id: string;
  readonly kind: QuestKind;
  readonly target: number;
  readonly progress: number;
  readonly reward: number;
  readonly claimed: boolean;
}

/** Daily quest pool. */
export const DAILY_QUESTS: readonly QuestDefinition[] = [
  { id: "water10", kind: "water", target: 10, reward: 30_000 },
  { id: "plant10", kind: "plant", target: 10, reward: 40_000 },
  { id: "harvest15", kind: "harvest", target: 15, reward: 60_000 },
  { id: "earn100k", kind: "earn", target: 100_000, reward: 80_000 },
  { id: "pat5", kind: "pat", target: 5, reward: 50_000 },
  { id: "craft2", kind: "craft", target: 2, reward: 70_000 },
];

/** @brief Three deterministic daily quests for a player and local day. */
export function dailyQuestsFor(playerId: string, day: number): QuestDefinition[] {
  const pool = [...DAILY_QUESTS];
  const rng = createRng(hash32(`quests:${playerId}:${day}`));
  const picked: QuestDefinition[] = [];
  while (picked.length < 3 && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    const [quest] = pool.splice(index, 1);
    if (quest !== undefined) picked.push(quest);
  }
  return picked;
}

/** Minimum time between prestige resets: 2 days baseline. */
export const PRESTIGE_COOLDOWN_MS = 2 * DAY_MS;

/** Lifetime earnings required for the first prestige: 50,000b. */
export const PRESTIGE_BASE_EARNED = 50_000 * 1_000_000_000;

/** @brief Lifetime earnings required to prestige again. */
export function prestigeRequirement(level: number): number {
  // Next level = previous × 2^level: base × 2^(level*(level+1)/2).
  const exponent = Math.min(40, (Math.max(0, level) * (Math.max(0, level) + 1)) / 2);
  return PRESTIGE_BASE_EARNED * 2 ** exponent;
}

/** @brief Coin cost to upgrade to the next prestige level (50% of the earnings requirement). */
export function prestigeUpgradeCost(level: number): number {
  return Math.round(prestigeRequirement(level) * 0.5);
}

/** @brief Starter seeds handed out when a prestige reset wipes the bag. */
export function prestigeStarterSeeds(level: number): Partial<Record<SeedId, number>> {
  const seeds: Partial<Record<SeedId, number>> = {
    carrot: 20,
    parsnip: 10,
    potato: 5,
  };
  if (level >= 1) seeds.corn = 5;
  if (level >= 2) seeds.pumpkin = 3;
  if (level >= 3) seeds.watermelon = 2;
  if (level >= 5) seeds.dragonFruit = 1;
  return seeds;
}

/** @brief Sale multiplier granted by prestige levels (+50% per level). */
export function prestigeSellBonus(level: number): number {
  return 1 + Math.max(0, level) * 0.5;
}

/** @brief Growth-time multiplier granted by prestige levels (-10% per level). */
export function prestigeGrowScale(level: number): number {
  return Math.max(0.2, 1 - Math.max(0, level) * 0.1);
}

/** Coin + garden value converted into one prestige coin on prestige. */
export const PRESTIGE_COIN_VALUE = 100_000_000_000;

/** @brief Day index since epoch. */
export function dayIndexAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / DAY_MS);
}

/** UTC+7 offset so the daily wheel resets at local midnight. */
export const WHEEL_DAY_OFFSET_MS = 7 * 60 * 60_000;

/** @brief Vietnam-local day index used by the daily lucky wheel. */
export function wheelDayAt(now: number): number {
  return Math.floor((now + WHEEL_DAY_OFFSET_MS - EPOCH_MS) / DAY_MS);
}

/** @brief Current contract rotation window. */
export function contractWindowAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / CONTRACT_WINDOW_MS);
}

/** @brief Current merchant rotation window. */
export function merchantWindowAt(now: number): number {
  return Math.floor((now - EPOCH_MS) / MERCHANT_WINDOW_MS);
}

/** One rotating weekly gameplay modifier. */
export interface WeeklyModifier {
  /** Stable id used by i18n and the UI. */
  readonly id: "calm" | "goldRush" | "growth" | "mutation";
  /** Multiplier on crop/animal sale gross. */
  readonly sellScale: number;
  /** Multiplier on growth time. */
  readonly growScale: number;
  /** Extra absolute mutation chance while planting. */
  readonly mutationBonus: number;
}

/** Weekly modifier rotation, deterministic by week key. */
export const WEEKLY_MODIFIERS: readonly WeeklyModifier[] = [
  { id: "calm", sellScale: 1, growScale: 1, mutationBonus: 0 },
  { id: "goldRush", sellScale: 1.15, growScale: 1, mutationBonus: 0 },
  { id: "growth", sellScale: 1, growScale: 0.9, mutationBonus: 0 },
  { id: "mutation", sellScale: 1, growScale: 1, mutationBonus: 0.02 },
];

/** @brief Modifier active this week. */
export function weeklyModifier(now: number): WeeklyModifier {
  const index =
    ((weekKeyAt(now) % WEEKLY_MODIFIERS.length) + WEEKLY_MODIFIERS.length) % WEEKLY_MODIFIERS.length;
  return WEEKLY_MODIFIERS[index] ?? WEEKLY_MODIFIERS[0]!;
}

/** @brief Server time the current week ends. */
export function weekEndsAt(now: number): number {
  return EPOCH_MS + (weekKeyAt(now) + 1) * WEEK_MS;
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
  const pool = SEEDS.filter((seed) => seed.rare === true && seed.prestigeOnly !== true);
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

/** @brief Next phase windows for the toolbar forecast. */
export function forecastEvents(now: number, waves = 3): EventSnapshot[][] {
  const out: EventSnapshot[][] = [];
  let phase = dayPhaseAt(now);
  for (let step = 0; step < waves; step += 1) {
    phase = dayPhaseAt(phase.endsAt);
    out.push(
      phaseEvents(phase).map((event) => ({
        id: event.id,
        startedAt: phase.startsAt,
        endsAt: phase.endsAt,
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
  /** Discovery keys already found (Dynopedia codex). */
  readonly collection?: readonly string[];
  /** Total coins available from unclaimed codex discoveries. */
  readonly codexUnclaimed?: number;
  /** Recent owner activity for the garden log. */
  readonly timeline?: readonly TimelineEvent[];
  /** Completed steps in the permanent NPC contract chain. */
  readonly chainStep?: number;
  /** Recipes learned through the AI Recipe Lab. */
  readonly recipes?: readonly CustomRecipe[];
  /** Crop cells burnt by fire and awaiting repurchase. */
  readonly damagedPlots?: readonly boolean[];
  /** Fruit tree slots for the owned tabs, `tabs * TREES_PER_TAB` entries. */
  readonly trees: readonly (TreeState | null)[];
  /** Seeds and harvested crops. */
  readonly bag: BagState;
  /** Building levels: 0 means not built. */
  readonly buildings: Readonly<Record<BuildingId, number>>;
  /** Animals per building slot. */
  readonly animals: Readonly<Record<BuildingId, readonly (AnimalState | null)[]>>;
  /** Passive machines mounted on the garden or buildings. */
  readonly attachments?: Readonly<Partial<Record<AttachmentSlot, AttachmentId>>>;
  /** Last time farm upkeep and production were settled. */
  readonly farmSettledAt: number;
  /** Fish pond growth in percent, `0..100`; every ten cycles adds ten. */
  readonly pondGrowth: number;
  /** Remaining shop stock for the current restock, keyed by seed or tool id. */
  readonly shopStock: Readonly<Partial<Record<string, number>>>;
  /** Bought premium plots, `0..SPECIAL_SLOTS`. */
  readonly specialOwned?: number;
  /** Premium-garden reset migration version. */
  readonly specialVersion?: number;
  /** Owned special patches, `0..SPECIAL_PATCHES` (legacy). */
  readonly specialPatches: number;
  /** Unlocked plots per owned special patch, `0..SPECIAL_PLOTS_PER_PATCH`. */
  readonly specialUnlocked: readonly number[];
  /** Special plots outside the normal crop grid; never auto-sold. */
  readonly specialPlots: readonly (PlotState | null)[];
  /** Greenhouse crop plots, `0..GREENHOUSE_SLOTS-1` (auto-watered, highquality x3, immune). */
  readonly greenhousePlots?: readonly (PlotState | null)[];
  /** Custom hybrid seeds cross-bred in the Nursery. */
  readonly hybrids?: readonly HybridSeed[];
  /** Identifier of the most recently bred hybrid variety. */
  readonly lastHybridId?: HybridId;
  /** Mushroom house trays, `0..MUSHROOM_TRAYS-1`. */
  readonly mushroomTrays: readonly (MushroomTrayState | null)[];
  /** Owned spawn blocks per mushroom species. */
  readonly mushroomSpawn: Readonly<Partial<Record<MushroomId, number>>>;
  /** Warehouse and built machines. */
  readonly warehouse: WarehouseState;
  /** Mine floor state, depth, and pickaxe progression. */
  readonly mine?: MineState;
  /** Fertility percent per crop cell, index = absolute slot. */
  readonly soil: readonly number[];
  /** All extra systems: streak, achievements, wheel, contracts, etc. */
  readonly extras: ExtrasSnapshot;
  /** Farming, ranching and artisaning levels. */
  readonly skills: SkillsState;
  /** Lifetime counters. */
  readonly stats: GardenStats;
  /** Most recent sales, newest last (capped by the server). */
  readonly sales?: readonly SaleRecord[];
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
  /** Crop cells burnt by fire and awaiting repurchase. */
  readonly damagedPlots?: readonly boolean[];
  /** Fruit tree slots. */
  readonly trees: readonly (TreeState | null)[];
  /** Seeds and harvested crops. */
  readonly bag: BagState;
  /** Building levels: 0 means not built. */
  readonly buildings: Readonly<Record<BuildingId, number>>;
  /** Animals per building slot. */
  readonly animals: Readonly<Record<BuildingId, readonly (AnimalState | null)[]>>;
  /** Passive machines mounted on the garden or buildings. */
  readonly attachments?: Readonly<Partial<Record<AttachmentSlot, AttachmentId>>>;
  /** Fish pond growth in percent, `0..100`. */
  readonly pondGrowth: number;
  /** Bought premium plots, `0..SPECIAL_SLOTS`. */
  readonly specialOwned?: number;
  /** Owned special patches (legacy). */
  readonly specialPatches: number;
  /** Unlocked plots per owned special patch. */
  readonly specialUnlocked: readonly number[];
  /** Special plots outside the normal crop grid. */
  readonly specialPlots: readonly (PlotState | null)[];
  /** Greenhouse crop plots, `0..GREENHOUSE_SLOTS-1`. */
  readonly greenhousePlots?: readonly (PlotState | null)[];
  /** Custom hybrid seeds cross-bred in the Nursery. */
  readonly hybrids?: readonly HybridSeed[];
  /** Warehouse and its machines. */
  readonly warehouse: WarehouseState;
  /** Mine floor state, depth, and pickaxe progression. */
  readonly mine?: MineState;
  /** Fertility percent per crop cell. */
  readonly soil: readonly number[];
  /** Extra systems snapshot. */
  readonly extras: ExtrasSnapshot;
  /** Skill levels. */
  readonly skills: SkillsState;
  /** Lifetime counters. */
  readonly stats: GardenStats;
  /** Recent sale trace shown to visitors. */
  readonly sales?: readonly SaleRecord[];
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

/** One line of a Quick Plan preview: what to buy and how many. */
export interface QuickPlanEntry {
  /** Seed, tree or mushroom id. */
  readonly id: string;
  /** How many of them the plan would place. */
  readonly qty: number;
  /** Unit cost the plan would pay. */
  readonly unitCost: number;
}

/** Everything Quick Plan would buy and plant, computed before spending. */
export interface QuickPlanPreview {
  readonly crops: readonly QuickPlanEntry[];
  readonly trees: readonly QuickPlanEntry[];
  readonly mushrooms: readonly QuickPlanEntry[];
  readonly totalCost: number;
  readonly slots: number;
}

/** Inputs needed to compute a Quick Plan locally (client preview and server). */
export interface QuickPlanInput {
  readonly coins: number;
  readonly prestige: number;
  readonly shopOffers: readonly ShopOffer[];
  readonly emptyCrops: number;
  readonly emptyTrees: number;
  readonly emptyTrays: number;
}

/** @brief Adds one unit to an aggregated preview line. */
function addPlanEntry(list: QuickPlanEntry[], id: string, unitCost: number): void {
  const existing = list.find((entry) => entry.id === id && entry.unitCost === unitCost);
  if (existing === undefined) list.push({ id, qty: 1, unitCost });
  else list[list.indexOf(existing)] = { id, qty: existing.qty + 1, unitCost };
}

/**
 * @brief Plans the best-ROI Quick Plan run without touching the ledger.
 * @details Same ranking the server uses: crops by sale/shop-price (tie higher
 * sale), trees by fruit/sapling price, mushrooms by batch revenue/spawn price.
 * Coins and shop stock are consumed in order, so the preview is exactly what
 * the server attempt will do for the affordable part.
 */
export function planQuickPlan(input: QuickPlanInput): QuickPlanPreview {
  let coins = input.coins;
  const stock = new Map<SeedId, number>();
  for (const offer of input.shopOffers) stock.set(offer.seed, offer.stock);
  const crops: QuickPlanEntry[] = [];
  const trees: QuickPlanEntry[] = [];
  const mushrooms: QuickPlanEntry[] = [];

  for (let slot = 0; slot < input.emptyCrops; slot += 1) {
    let best: { seed: SeedId; price: number; score: number; sell: number } | null = null;
    for (const offer of input.shopOffers) {
      const left = stock.get(offer.seed) ?? 0;
      if (left < 1 || offer.price > coins) continue;
      const seed = seedById(offer.seed);
      if (seed === undefined || seed.category === "fruit") continue;
      if (prestigeTierForSeed(seed.id) > input.prestige) continue;
      // Most coins per planting wins; ROI only breaks ties.
      const profit = seed.sell - offer.price;
      if (profit <= 0) continue;
      const score = profit;
      if (best === null || score > best.score || (score === best.score && seed.sell > best.sell)) {
        best = { seed: seed.id, price: offer.price, score, sell: seed.sell };
      }
    }
    if (best === null) break;
    coins -= best.price;
    stock.set(best.seed, (stock.get(best.seed) ?? 0) - 1);
    addPlanEntry(crops, best.seed, best.price);
  }

  for (let slot = 0; slot < input.emptyTrees; slot += 1) {
    let best: { id: TreeId; buy: number; score: number } | null = null;
    for (const tree of TREES) {
      if (tree.buy > coins || tree.sell <= tree.buy) continue;
      const score = tree.sell - tree.buy;
      if (best === null || score > best.score) best = { id: tree.id, buy: tree.buy, score };
    }
    if (best === null) break;
    coins -= best.buy;
    addPlanEntry(trees, best.id, best.buy);
  }

  for (let slot = 0; slot < input.emptyTrays; slot += 1) {
    let best: { id: MushroomId; spawn: number; score: number } | null = null;
    for (const mushroom of MUSHROOMS) {
      if (mushroom.spawn > coins) continue;
      const product = productById(mushroom.product);
      if (product === undefined) continue;
      const revenue = product.base * mushroom.batch;
      if (revenue <= mushroom.spawn) continue;
      const score = revenue - mushroom.spawn;
      if (best === null || score > best.score) best = { id: mushroom.id, spawn: mushroom.spawn, score };
    }
    if (best === null) break;
    coins -= best.spawn;
    addPlanEntry(mushrooms, best.id, best.spawn);
  }

  const totalQty =
    crops.reduce((sum, entry) => sum + entry.qty, 0) +
    trees.reduce((sum, entry) => sum + entry.qty, 0) +
    mushrooms.reduce((sum, entry) => sum + entry.qty, 0);
  const totalCost =
    crops.reduce((sum, entry) => sum + entry.qty * entry.unitCost, 0) +
    trees.reduce((sum, entry) => sum + entry.qty * entry.unitCost, 0) +
    mushrooms.reduce((sum, entry) => sum + entry.qty * entry.unitCost, 0);
  return { crops, trees, mushrooms, totalCost, slots: totalQty };
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

/** Per-cycle chance a healthy crop catches a disease. */
export const DISEASE_CHANCE_PER_CYCLE = 0.0015;
/** Per-cycle chance a disease spreads to a same-type neighbour. */
export const DISEASE_SPREAD_CHANCE = 0.03;
/** Cycles a crop survives after catching the disease. */
export const DISEASE_DEATH_CYCLES = 3;
/** Cycles a fruit tree survives after catching the disease. */
export const TREE_DISEASE_DEATH_CYCLES = 4;
/** Per-cycle fire chance without the fire-protection attachment. */
export const FIRE_CHANCE_PER_CYCLE = 0.1;
/** Per-cycle crow chance without a scarecrow. */
export const CROW_CHANCE_PER_CYCLE = 0.3;
/** Cost to repurchase a plot burnt by fire. */
export const PLOT_REPAIR_COST = 2_000_000;

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
    if (seed.rare === true || seed.prestigeOnly === true) continue;
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

/** Dynamic market surge news item for the active wave. */
export interface MarketNewsSnapshot {
  /** Stable theme identifier. */
  readonly id: string;
  /** Matching crop categories or product ids boosted by this news. */
  readonly tags: readonly string[];
  /** Sell price multiplier applied to matching goods. */
  readonly multiplier: number;
}

/** Everything that changes with the server clock. */
export interface SeasonSnapshot {
  /** Rotation index of the current phase window. */
  readonly wave: number;
  /** Dynamic market surge news for this wave. */
  readonly news?: MarketNewsSnapshot;
  /** Current day phase: day, dusk, night or dawn. */
  readonly phase: {
    readonly id: DayPhaseId;
    readonly startsAt: number;
    readonly endsAt: number;
  };
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
  /** Permanent prestige level, shown before the nick in rankings. */
  readonly prestige?: number;
  /** Crops harvested. */
  readonly harvested: number;
  /** Server time of the last update. */
  readonly updatedAt: number;
}

/** Actions the owner can apply to their garden. */
export type GardenAction = (
  | { readonly kind: "plant"; readonly slot: number; readonly seed: AnySeedId }
  | { readonly kind: "plantAll"; readonly seed: AnySeedId }
  | {
      readonly kind: "uprootBulk";
      readonly seed?: AnySeedId;
      readonly tree?: TreeId;
      readonly priceBelow?: number;
      readonly profit?: "loss" | "win";
      readonly dead?: boolean;
    }
  | { readonly kind: "plantTree"; readonly slot: number; readonly tree: TreeId }
  | { readonly kind: "harvest"; readonly slot: number; readonly tree: boolean; readonly auto?: boolean }
  | { readonly kind: "water"; readonly slot: number; readonly tree: boolean; readonly auto?: boolean }
  | {
      readonly kind: "fertilize";
      readonly slot: number;
      readonly tree: boolean;
      readonly supply: FertilizerId;
    }
  | { readonly kind: "spray"; readonly slot: number; readonly tree: boolean; readonly supply: SprayId }
  | { readonly kind: "uproot"; readonly slot: number; readonly tree: boolean }
  | { readonly kind: "reclaimSeed"; readonly slot: number }
  | { readonly kind: "movePlant"; readonly from: number; readonly to: number; readonly tree: boolean }
  | { readonly kind: "toggleFavorite"; readonly slot: number; readonly tree: boolean }
  | { readonly kind: "buyTab" }
  | { readonly kind: "buyPatch"; readonly tab: number }
  | { readonly kind: "buySpecialPatch"; readonly patch: number }
  | { readonly kind: "buySpecialPlot"; readonly patch?: number }
  | { readonly kind: "plantSpecial"; readonly slot: number; readonly seed: AnySeedId }
  | { readonly kind: "harvestSpecial"; readonly slot: number }
  | { readonly kind: "waterSpecial"; readonly slot: number }
  | { readonly kind: "fertilizeSpecial"; readonly slot: number; readonly supply: FertilizerId }
  | { readonly kind: "spraySpecial"; readonly slot: number; readonly supply: SprayId }
  | { readonly kind: "uprootSpecial"; readonly slot: number }
  | { readonly kind: "plantGreenhouse"; readonly slot: number; readonly seed: AnySeedId }
  | { readonly kind: "harvestGreenhouse"; readonly slot: number }
  | { readonly kind: "uprootGreenhouse"; readonly slot: number }
  | { readonly kind: "fertilizeGreenhouse"; readonly slot: number; readonly supply: FertilizerId }
  | { readonly kind: "plantAllGreenhouse"; readonly seed: AnySeedId }
  | { readonly kind: "harvestAllGreenhouse" }
  | { readonly kind: "breedHybrid"; readonly parents: readonly AnyItemId[] }
  | { readonly kind: "renameHybrid"; readonly id: HybridId; readonly name: string }
  | { readonly kind: "waterAll" }
  | { readonly kind: "harvestAll" }
  | { readonly kind: "quickPlan" }
  | { readonly kind: "buildBuilding"; readonly building: BuildingId }
  | { readonly kind: "upgradeBuilding"; readonly building: BuildingId }
  | {
      readonly kind: "buyAnimal";
      readonly building: BuildingId;
      readonly slot: number;
      readonly animal: AnimalId;
    }
  | { readonly kind: "patAnimal"; readonly building: BuildingId; readonly slot: number }
  | { readonly kind: "breedAnimal"; readonly building: BuildingId; readonly slot: number }
  | { readonly kind: "sellAnimal"; readonly building: BuildingId; readonly slot: number }
  | {
      readonly kind: "sellProduct";
      readonly product: ProductId;
      readonly star: number;
      readonly effects?: readonly EffectId[];
      readonly qty: number;
    }
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
      readonly item: AnyItemId;
      readonly effects: readonly EffectId[];
      readonly pest?: boolean;
      readonly star?: number;
      readonly qty: number;
    }
  | { readonly kind: "sprayPest"; readonly slot: number; readonly tree: boolean }
  | { readonly kind: "sprayPestAll" }
  | { readonly kind: "fertilizeAll"; readonly supply: FertilizerId }
  | { readonly kind: "sprayAll"; readonly supply: SprayId }
  | { readonly kind: "buildMachine"; readonly machine: MachineId }
  | { readonly kind: "upgradeMachine"; readonly machine: MachineId }
  | {
      readonly kind: "craftMachine";
      readonly machine: MachineId;
      readonly item?: AnyItemId | ProductId;
    }
  | {
      readonly kind: "queueMachine";
      readonly machine: MachineId;
      readonly item?: AnyItemId | ProductId;
      readonly qty?: number;
    }
  | { readonly kind: "collectMachine"; readonly machine: MachineId }
  | { readonly kind: "clearMachineQueue"; readonly machine: MachineId }
  | {
      readonly kind: "setMachineLimit";
      readonly machine: MachineId;
      readonly limit?: number;
    }
  | { readonly kind: "attachMachine"; readonly slot: AttachmentSlot; readonly id: AttachmentId }
  | { readonly kind: "detachMachine"; readonly slot: AttachmentSlot }
  | { readonly kind: "buySeed"; readonly seed: SeedId; readonly qty: number }
  | { readonly kind: "buySupply"; readonly supply: SupplyId; readonly qty: number }
  | { readonly kind: "buyMushroomSpawn"; readonly mushroom: MushroomId; readonly qty: number }
  | { readonly kind: "plantMushroom"; readonly slot: number; readonly mushroom: MushroomId }
  | { readonly kind: "harvestMushroom"; readonly slot: number }
  | { readonly kind: "sellAll" }
  | { readonly kind: "claimQuest"; readonly id: string }
  | { readonly kind: "prestige" }
  | { readonly kind: "buyPrestigeSeed"; readonly seed: SeedId }
  | { readonly kind: "buyFinalSeed"; readonly seed: SeedId }
  | { readonly kind: "repairPlot"; readonly slot: number }
  | { readonly kind: "buyTree"; readonly tree: TreeId; readonly slot?: number }
  | { readonly kind: "claimCodex" }
  | { readonly kind: "buyPrestigeSkill"; readonly skill: PrestigeSkillId }
  | { readonly kind: "respecPrestige" }
  | { readonly kind: "fulfillChain" }
  | { readonly kind: "cookRecipe"; readonly id: string }
  | { readonly kind: "buildKitchen" }
  | { readonly kind: "plantFruitSeed"; readonly slot: number; readonly seed: SeedId }
  | { readonly kind: "giftCoins"; readonly code: string; readonly amount: number }
  | { readonly kind: "giftSeed"; readonly code: string; readonly seed: SeedId; readonly qty: number }
  | {
      readonly kind: "giftSupply";
      readonly code: string;
      readonly supply: SupplyId;
      readonly qty: number;
    }
  | { readonly kind: "giftTool"; readonly code: string; readonly tool: ToolId; readonly qty: number }
  | { readonly kind: "mineHit"; readonly slot: number }
  | { readonly kind: "mineDescend" }
  | { readonly kind: "mineElevator"; readonly targetFloor: number }
  | { readonly kind: "upgradePickaxe" }
  | { readonly kind: "mineEat"; readonly item: ProductId }
  | { readonly kind: "assignMiner"; readonly staffSlot: number | null }
  | { readonly kind: "craftRelic"; readonly relic: RelicId }
  | { readonly kind: "equipRelic"; readonly relic: RelicId }
  | { readonly kind: "usePetSkill" }
  | { readonly kind: "startPetExpedition"; readonly pet: PetId; readonly durationMin: 15 | 30 }
  | { readonly kind: "claimPetExpedition"; readonly id: string }
) & { readonly auto?: boolean };

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
  | "NO_SPAWN"
  | "TRAY_EMPTY"
  | "TRAY_OCCUPIED"
  | "NEEDS_WATER"
  | "PLANT_DEAD"
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
  | "NOT_BREEDABLE"
  | "ALREADY_BREEDING"
  | "NO_EGG"
  | "NO_FREE_SLOT"
  | "NEED_MORE_FISH"
  | "POND_BASIN_FULL"
  | "NO_PRODUCT"
  | "NO_TOOL"
  | "FAVORITE_LOCKED"
  | "ALREADY_PROTECTED"
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
  | "CANNOT_VISIT_SELF"
  | "GIFT_SELF"
  | "PRESTIGE_LOCKED"
  | "PLOT_DAMAGED"
  | "WRONG_AREA"
  | "KITCHEN_LOCKED"
  | "NO_STAMINA"
  | "LADDER_LOCKED"
  | "FLOOR_LOCKED"
  | "NO_BARS"
  | "MAX_PICKAXE"
  | "ROCK_EMPTY"
  | "GREENHOUSE_LOCKED"
  | "HYBRID_LIMIT"
  | "NOT_ENOUGH_PARENTS"
  | "RELIC_LOCKED"
  | "MAX_RELICS"
  | "PET_BUSY"
  | "SKILL_COOLDOWN"
  | "EXPEDITION_NOT_READY";

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

/**
 * @brief Converts a custom Nursery hybrid variety into a {@link SeedDefinition} shape.
 * @param hybrid Custom hybrid definition.
 * @return Seed-compatible definition used by growth, display, and pricing logic.
 */
export function hybridAsSeedDefinition(hybrid: HybridSeed): SeedDefinition {
  return {
    id: hybrid.id as unknown as SeedId,
    growMs: hybrid.growMs,
    buy: Math.max(100, Math.round(hybrid.sell * 0.5)),
    sell: hybrid.sell,
    regrow: hybrid.regrow,
    art: hybrid.art,
  };
}

/**
 * @brief Resolves either a static seed or a custom Nursery hybrid by id.
 * @param id Seed or hybrid identifier.
 * @param hybrids Optional list of player-created hybrid definitions.
 * @return Matching definition, or `undefined` if unknown.
 */
export function resolveSeed(id: string, hybrids?: readonly HybridSeed[]): SeedDefinition | undefined {
  const staticSeed = seedById(id);
  if (staticSeed !== undefined) return staticSeed;
  const hybrid = hybrids?.find((entry) => entry.id === id);
  return hybrid === undefined ? undefined : hybridAsSeedDefinition(hybrid);
}

/** @brief Looks one fruit tree up by id. */
export function treeById(id: string): TreeDefinition | undefined {
  return TREES.find((tree) => tree.id === id);
}

/** @brief Definition for a planted tree or a fruit seed growing in a tree plot. */
export function treeLikeById(id: string): TreeDefinition | undefined {
  const tree = treeById(id);
  if (tree !== undefined) return tree;
  const seed = seedById(id);
  if (seed === undefined || seed.category !== "fruit") return undefined;
  return {
    id: seed.id as unknown as TreeId,
    growMs: seed.growMs,
    buy: seed.buy,
    sell: seed.sell,
    art: seed.art,
  };
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
/** @brief Combined multiplier of every mutation copy on one fruit. */
export function effectsMultiplier(effects: readonly EffectId[]): number {
  const counts = new Map<EffectId, number>();
  for (const id of effects) {
    counts.set(id, Math.min(MAX_EFFECT_STACK, (counts.get(id) ?? 0) + 1));
  }
  let total = 1;
  for (const [id, count] of counts) {
    const factor = effectById(id)?.multiplier ?? 1;
    for (let copy = 0; copy < count; copy += 1) total *= factor;
  }
  return total;
}

/** @brief Alias kept for callers that only need the combined multiplier. */
export function effectsMultiplierRaw(effects: readonly EffectId[]): number {
  return effectsMultiplier(effects);
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
/** Most copies of one mutation a single fruit can carry. */
export const MAX_EFFECT_STACK = 5;

/**
 * Chance to earn each extra copy of a mutation that already rolled.
 * @details Index is the copy being attempted: the second copy is a quarter of
 * the time, the fifth one in two hundred. Each mutation type rolls its own
 * chain, so different mutations never share a probability pool.
 */
export const EFFECT_STACK_CHANCES: readonly number[] = [0, 0, 0.25, 0.05, 0.01, 0.005];

/**
 * @brief Orders mutations by catalog order and keeps duplicates.
 * @details Mutations stack: two Diamonds multiply the price twice. The only
 * limit is {@link MAX_EFFECT_STACK} copies of the same mutation, so a long
 * growing window cannot multiply without bound.
 */
export function canonicalEffects(effects: readonly EffectId[]): EffectId[] {
  const counts = new Map<EffectId, number>();
  for (const id of effects) counts.set(id, (counts.get(id) ?? 0) + 1);
  const out: EffectId[] = [];
  for (const effect of EFFECTS) {
    const count = Math.min(MAX_EFFECT_STACK, counts.get(effect.id) ?? 0);
    for (let copy = 0; copy < count; copy += 1) out.push(effect.id);
  }
  return out;
}

/** @brief Builds the bag key for one produce stack. */
export function cropKey(item: AnyItemId, effects: readonly EffectId[], star = 1): string {
  const canonical = canonicalEffects(effects);
  const quality = Math.max(1, Math.min(5, Math.floor(star)));
  const base = canonical.length === 0 ? item : `${item}:${canonical.join(":")}`;
  return quality > 1 ? `${base}#${quality}` : base;
}

/**
 * @brief Parses one bag key back into a stack identity.
 * @return The item and its mutation list, or `null` when malformed.
 */
export function parseCropKey(key: string): { item: AnyItemId; effects: EffectId[]; star: number } | null {
  const [base, starPart] = key.split("#");
  const star = starPart === undefined ? 1 : Number(starPart);
  if (!Number.isInteger(star) || star < 1 || star > 5) return null;
  let itemId: AnyItemId | undefined;
  let effectParts: string[];
  if ((base ?? "").startsWith(HYBRID_PREFIX)) {
    const rest = (base ?? "").slice(HYBRID_PREFIX.length);
    const [slug, ...effectsRaw] = rest.split(":");
    const candidate = `${HYBRID_PREFIX}${slug ?? ""}`;
    if (!isHybridId(candidate)) return null;
    itemId = candidate;
    effectParts = effectsRaw;
  } else {
    const [itemPart, ...effectsRaw] = (base ?? "").split(":");
    const item = itemPart === undefined ? undefined : itemById(itemPart);
    if (item === undefined) return null;
    itemId = item.id;
    effectParts = effectsRaw;
  }
  const effects: EffectId[] = [];
  for (const part of effectParts) {
    const effect = effectById(part);
    if (effect === undefined) return null;
    effects.push(effect.id);
  }
  return { item: itemId, effects: canonicalEffects(effects), star };
}

/** @brief Resolves a static seed or valid hybrid seed id from untrusted wire input. */
function parseAnySeedId(raw: unknown): AnySeedId | undefined {
  if (typeof raw !== "string") return undefined;
  const staticSeed = seedById(raw);
  if (staticSeed !== undefined) return staticSeed.id;
  return isHybridId(raw) ? raw : undefined;
}

/** @brief Resolves a static item or valid hybrid item id from untrusted wire input. */
function parseAnyItemId(raw: unknown): AnyItemId | undefined {
  if (typeof raw !== "string") return undefined;
  const staticItem = itemById(raw);
  if (staticItem !== undefined) return staticItem.id;
  return isHybridId(raw) ? raw : undefined;
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
    const seed = parseAnySeedId(value.seed);
    if (slot === null || seed === undefined) return null;
    return { kind, slot, seed };
  }
  if (kind === "plantAll") {
    const seed = parseAnySeedId(value.seed);
    return seed === undefined ? null : { kind, seed };
  }
  if (kind === "uprootBulk") {
    const seed = parseAnySeedId(value.seed);
    const tree = typeof value.tree === "string" ? treeById(value.tree) : undefined;
    if (value.seed !== undefined && seed === undefined) return null;
    if (value.tree !== undefined && tree === undefined) return null;
    const profitRaw = value.profit;
    const profit = profitRaw === "loss" || profitRaw === "win" ? profitRaw : undefined;
    const priceBelow = value.priceBelow;
    const dead = value.dead === true ? true : undefined;
    if (
      seed === undefined &&
      tree === undefined &&
      profit === undefined &&
      priceBelow === undefined &&
      dead === undefined
    ) {
      return null;
    }
    if (priceBelow !== undefined && (typeof priceBelow !== "number" || priceBelow < 0)) return null;
    return {
      kind,
      ...(seed === undefined ? {} : { seed }),
      ...(tree === undefined ? {} : { tree: tree.id }),
      ...(profit === undefined ? {} : { profit }),
      ...(priceBelow === undefined ? {} : { priceBelow }),
      ...(dead === undefined ? {} : { dead }),
    };
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
  if (kind === "fertilizeAll") {
    const supply = typeof value.supply === "string" ? fertilizerById(value.supply) : undefined;
    return supply === undefined ? null : { kind, supply: supply.id };
  }
  if (kind === "sprayAll") {
    const supply = typeof value.supply === "string" ? sprayById(value.supply) : undefined;
    return supply === undefined ? null : { kind, supply: supply.id };
  }
  if (kind === "reclaimSeed") {
    const slot = readSlot(value.slot, MAX_CROPS);
    return slot === null ? null : { kind, slot };
  }
  if (kind === "movePlant") {
    const isTree = value.tree === true;
    const from = readSlot(value.from, isTree ? MAX_TREES : MAX_CROPS);
    const to = readSlot(value.to, isTree ? MAX_TREES : MAX_CROPS);
    if (from === null || to === null || from === to) return null;
    return { kind, from, to, tree: isTree };
  }
  if (kind === "toggleFavorite") {
    const isTree = value.tree === true;
    const slot = readSlot(value.slot, isTree ? MAX_TREES : MAX_CROPS);
    return slot === null ? null : { kind, slot, tree: isTree };
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
  if (kind === "buyMushroomSpawn") {
    const mushroom = typeof value.mushroom === "string" ? mushroomById(value.mushroom) : undefined;
    const qty = value.qty;
    if (
      mushroom === undefined ||
      typeof qty !== "number" ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > MAX_BUY_QTY
    ) {
      return null;
    }
    return { kind, mushroom: mushroom.id, qty };
  }
  if (kind === "plantMushroom") {
    const slot = readSlot(value.slot, MUSHROOM_TRAYS);
    const mushroom = typeof value.mushroom === "string" ? mushroomById(value.mushroom) : undefined;
    if (slot === null || mushroom === undefined) return null;
    return { kind, slot, mushroom: mushroom.id };
  }
  if (kind === "harvestMushroom") {
    const slot = readSlot(value.slot, MUSHROOM_TRAYS);
    return slot === null ? null : { kind, slot };
  }
  if (kind === "sellCrop") {
    const item = parseAnyItemId(value.item);
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
    const star = value.star === undefined ? 1 : value.star;
    if (typeof star !== "number" || !Number.isInteger(star) || star < 1 || star > 5) return null;
    return {
      kind,
      item,
      effects: canonicalEffects(effects),
      pest: value.pest === true,
      star,
      qty,
    };
  }
  if (kind === "buySpecialPatch") {
    const patch = value.patch;
    if (typeof patch !== "number" || !Number.isInteger(patch) || patch < 0 || patch >= SPECIAL_PATCHES) {
      return null;
    }
    return { kind, patch };
  }
  if (kind === "buySpecialPlot") {
    const patch = value.patch;
    if (patch !== undefined && (typeof patch !== "number" || !Number.isInteger(patch) || patch < 0)) {
      return null;
    }
    return { kind, ...(patch === undefined ? {} : { patch }) };
  }
  if (kind === "fertilizeSpecial") {
    const slot = value.slot;
    const supply = typeof value.supply === "string" ? fertilizerById(value.supply) : undefined;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SPECIAL_SLOTS) {
      return null;
    }
    return supply === undefined ? null : { kind, slot, supply: supply.id };
  }
  if (kind === "spraySpecial") {
    const slot = value.slot;
    const supply = typeof value.supply === "string" ? sprayById(value.supply) : undefined;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SPECIAL_SLOTS) {
      return null;
    }
    return supply === undefined ? null : { kind, slot, supply: supply.id };
  }
  if (kind === "plantSpecial") {
    const slot = value.slot;
    const seed = parseAnySeedId(value.seed);
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SPECIAL_SLOTS) {
      return null;
    }
    return seed === undefined ? null : { kind, slot, seed };
  }
  if (kind === "harvestSpecial" || kind === "waterSpecial" || kind === "uprootSpecial") {
    const slot = value.slot;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SPECIAL_SLOTS) {
      return null;
    }
    return { kind, slot };
  }
  if (kind === "plantGreenhouse") {
    const slot = readSlot(value.slot, GREENHOUSE_SLOTS);
    const seed = parseAnySeedId(value.seed);
    if (slot === null || seed === undefined) return null;
    return { kind, slot, seed };
  }
  if (kind === "harvestGreenhouse" || kind === "uprootGreenhouse") {
    const slot = readSlot(value.slot, GREENHOUSE_SLOTS);
    return slot === null ? null : { kind, slot };
  }
  if (kind === "fertilizeGreenhouse") {
    const slot = readSlot(value.slot, GREENHOUSE_SLOTS);
    const supply = typeof value.supply === "string" ? fertilizerById(value.supply) : undefined;
    if (slot === null || supply === undefined) return null;
    return { kind, slot, supply: supply.id };
  }
  if (kind === "plantAllGreenhouse") {
    const seed = parseAnySeedId(value.seed);
    return seed === undefined ? null : { kind, seed };
  }
  if (kind === "harvestAllGreenhouse") return { kind };
  if (kind === "breedHybrid") {
    if (!Array.isArray(value.parents)) return null;
    if (value.parents.length < MIN_BREED_PARENTS || value.parents.length > MAX_BREED_PARENTS) {
      return null;
    }
    const parents: AnyItemId[] = [];
    for (const rawParent of value.parents) {
      const item = parseAnyItemId(rawParent);
      if (item === undefined) return null;
      parents.push(item);
    }
    return { kind, parents };
  }
  if (kind === "renameHybrid") {
    if (typeof value.id !== "string" || !isHybridId(value.id)) return null;
    if (typeof value.name !== "string") return null;
    const name = value.name.trim();
    if (name.length < 1 || name.length > 28) return null;
    return { kind, id: value.id, name };
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
    const role = STAFF_ROLES.find((entry) => entry === value.role);
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
    return { kind, item: item.id, qty };
  }
  if (kind === "spliceCrops") {
    const item = typeof value.item === "string" ? itemById(value.item) : undefined;
    return item === undefined ? null : { kind, item: item.id };
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
  if (kind === "craftMachine" || kind === "queueMachine") {
    const machine = typeof value.machine === "string" ? machineById(value.machine) : undefined;
    if (machine === undefined) return null;
    const rawItem = typeof value.item === "string" ? value.item : undefined;
    const parsedItemId =
      rawItem === undefined ? undefined : (parseAnyItemId(rawItem) ?? productById(rawItem)?.id);
    if (rawItem !== undefined && parsedItemId === undefined) return null;
    if (kind === "craftMachine") {
      return {
        kind: "craftMachine",
        machine: machine.id,
        ...(parsedItemId === undefined ? {} : { item: parsedItemId }),
      };
    }
    const qty = value.qty === undefined ? 1 : value.qty;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 999) return null;
    return {
      kind: "queueMachine",
      machine: machine.id,
      ...(parsedItemId === undefined ? {} : { item: parsedItemId }),
      qty,
    };
  }
  if (kind === "claimQuest") {
    return typeof value.id === "string" && value.id.length > 0 ? { kind, id: value.id } : null;
  }
  if (kind === "prestige") return { kind };
  if (kind === "plantFruitSeed") {
    const slot = Number(value.slot);
    const seed = typeof value.seed === "string" ? seedById(value.seed) : undefined;
    if (!Number.isInteger(slot) || slot < 0 || slot >= totalTrees(MAX_TABS)) return null;
    if (seed === undefined || seed.category !== "fruit") return null;
    return { kind, slot, seed: seed.id };
  }
  if (kind === "claimCodex") return { kind };
  if (kind === "craftRelic" || kind === "equipRelic") {
    const relic = typeof value.relic === "string" ? relicById(value.relic) : undefined;
    return relic === undefined ? null : { kind, relic: relic.id };
  }
  if (kind === "usePetSkill") return { kind };
  if (kind === "startPetExpedition") {
    const pet = typeof value.pet === "string" ? petById(value.pet) : undefined;
    const durationMin = value.durationMin === 30 ? 30 : value.durationMin === 15 ? 15 : null;
    return pet === undefined || durationMin === null ? null : { kind, pet: pet.id, durationMin };
  }
  if (kind === "claimPetExpedition") {
    return typeof value.id === "string" && value.id.length > 0 && value.id.length <= 64
      ? { kind, id: value.id }
      : null;
  }
  if (kind === "respecPrestige") return { kind };
  if (kind === "fulfillChain") return { kind };
  if (kind === "buildKitchen") return { kind };
  if (kind === "cookRecipe") {
    return typeof value.id === "string" && value.id.length > 0 ? { kind, id: value.id } : null;
  }
  if (kind === "buyPrestigeSkill") {
    const skill = value.skill;
    if (skill !== "merchant" && skill !== "farmer" && skill !== "artisan") return null;
    return { kind, skill };
  }
  if (kind === "buyTree") {
    const tree = typeof value.tree === "string" ? treeById(value.tree) : undefined;
    if (tree === undefined) return null;
    const slot = value.slot === undefined ? undefined : Number(value.slot);
    if (slot !== undefined && (!Number.isInteger(slot) || slot < 0 || slot >= totalTrees(MAX_TABS))) {
      return null;
    }
    return { kind, tree: tree.id, ...(slot === undefined ? {} : { slot }) };
  }
  if (kind === "repairPlot") {
    const slot = Number(value.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= totalCrops(MAX_TABS)) return null;
    return { kind, slot };
  }
  if (kind === "buyFinalSeed") {
    const seed = typeof value.seed === "string" ? seedById(value.seed) : undefined;
    if (seed === undefined) return null;
    if (!FINAL_SHOP.some((offer) => offer.seed === seed.id)) return null;
    return { kind, seed: seed.id };
  }
  if (kind === "buyPrestigeSeed") {
    const seed = typeof value.seed === "string" ? seedById(value.seed) : undefined;
    if (seed === undefined) return null;
    if (!PRESTIGE_SHOP.some((offer) => offer.seed === seed.id)) return null;
    return { kind, seed: seed.id };
  }
  if (kind === "giftCoins") {
    const code = typeof value.code === "string" ? value.code.toUpperCase() : "";
    const amount = value.amount;
    if (!isGardenCode(code)) return null;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000_000) {
      return null;
    }
    return { kind, code, amount };
  }
  if (kind === "giftSeed" || kind === "giftSupply" || kind === "giftTool") {
    const code = typeof value.code === "string" ? value.code.toUpperCase() : "";
    if (!isGardenCode(code)) return null;
    const qty = value.qty;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    if (kind === "giftSeed") {
      const seed = typeof value.seed === "string" ? seedById(value.seed) : undefined;
      return seed === undefined ? null : { kind, code, seed: seed.id, qty };
    }
    if (kind === "giftSupply") {
      const supply = typeof value.supply === "string" ? supplyById(value.supply) : undefined;
      return supply === undefined ? null : { kind, code, supply: supply.id, qty };
    }
    const tool = typeof value.tool === "string" ? toolById(value.tool) : undefined;
    return tool === undefined ? null : { kind, code, tool: tool.id, qty };
  }
  if (kind === "attachMachine") {
    const slot = value.slot;
    const id = typeof value.id === "string" ? attachmentById(value.id) : undefined;
    if (slot !== "garden" && slot !== "fire" && slot !== "coop" && slot !== "barn" && slot !== "pond") {
      return null;
    }
    if (id === undefined || id.slot !== slot) return null;
    return { kind, slot, id: id.id };
  }
  if (kind === "detachMachine") {
    const slot = value.slot;
    if (slot !== "garden" && slot !== "fire" && slot !== "coop" && slot !== "barn" && slot !== "pond") {
      return null;
    }
    return { kind, slot };
  }
  if (kind === "setMachineLimit") {
    const machine = typeof value.machine === "string" ? machineById(value.machine) : undefined;
    if (machine === undefined) return null;
    if (value.limit === undefined) return { kind, machine: machine.id };
    const limit = value.limit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 9_999) return null;
    return { kind, machine: machine.id, limit };
  }
  if (kind === "clearMachineQueue") {
    const machine = typeof value.machine === "string" ? machineById(value.machine) : undefined;
    return machine === undefined ? null : { kind, machine: machine.id };
  }
  if (kind === "collectMachine") {
    const machine = typeof value.machine === "string" ? machineById(value.machine) : undefined;
    return machine === undefined ? null : { kind, machine: machine.id };
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
    const limit = building.slots[building.slots.length - 1] ?? 81;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= limit) return null;
    return { kind, building: building.id, slot, animal: animal.id };
  }
  if (kind === "patAnimal" || kind === "breedAnimal" || kind === "sellAnimal") {
    const building = typeof value.building === "string" ? buildingById(value.building) : undefined;
    const slot = value.slot;
    if (building === undefined) return null;
    const limit = building.slots[building.slots.length - 1] ?? 81;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= limit) return null;
    return { kind, building: building.id, slot };
  }
  if (kind === "sellProduct") {
    const product = typeof value.product === "string" ? productById(value.product) : undefined;
    const star = value.star;
    const qty = value.qty;
    if (product === undefined) return null;
    if (typeof star !== "number" || !Number.isInteger(star) || star < 1 || star > 5) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    const effects: EffectId[] = [];
    if (Array.isArray(value.effects)) {
      for (const id of value.effects) {
        const effect = typeof id === "string" ? effectById(id) : undefined;
        if (effect !== undefined) effects.push(effect.id);
      }
    }
    return { kind, product: product.id, star, effects: canonicalEffects(effects), qty };
  }
  if (kind === "buyPatch") {
    const tab = value.tab;
    if (typeof tab !== "number" || !Number.isInteger(tab) || tab < 0 || tab >= MAX_TABS) return null;
    return { kind, tab };
  }
  if (kind === "sellAll") return { kind };
  if (kind === "quickPlan") return { kind };
  if (kind === "mineHit") {
    const slot = value.slot;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= MINE_FLOOR_CELLS) {
      return null;
    }
    return { kind, slot };
  }
  if (kind === "mineDescend") return { kind };
  if (kind === "mineElevator") {
    const targetFloor = value.targetFloor;
    if (typeof targetFloor !== "number" || !Number.isInteger(targetFloor) || targetFloor < 1) {
      return null;
    }
    return { kind, targetFloor };
  }
  if (kind === "upgradePickaxe") return { kind };
  if (kind === "mineEat") {
    const item = typeof value.item === "string" ? productById(value.item) : undefined;
    if (item === undefined) return null;
    return { kind, item: item.id };
  }
  if (kind === "assignMiner") {
    const staffSlot = value.staffSlot;
    if (staffSlot === null) return { kind, staffSlot: null };
    if (
      typeof staffSlot !== "number" ||
      !Number.isInteger(staffSlot) ||
      staffSlot < 0 ||
      staffSlot >= STAFF_SLOTS
    ) {
      return null;
    }
    return { kind, staffSlot };
  }
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
  const phase = dayPhaseAt(now);
  const nextPhase = dayPhaseAt(phase.endsAt);
  const currentEvents = phaseEvents(phase);
  const nextEvents = phaseEvents(nextPhase);
  const current = currentEvents[0] ?? CALM_EVENT;
  const next = nextEvents[0] ?? CALM_EVENT;

  const restockWave = Math.floor((now - EPOCH_MS) / SHOP_RESTOCK_MS);
  const restockAt = EPOCH_MS + (restockWave + 1) * SHOP_RESTOCK_MS;
  const shopRng = createRng(hash32(`garden:shop:${restockWave}`));
  const toolRng = createRng(hash32(`garden:tools:${restockWave}`));
  const tools: ShopToolOffer[] = [];
  // Rare stock: a restock carries at most one hand tool, and only some of them.
  if (toolRng() < TOOL_STOCK_CHANCE) {
    const picked = TOOLS[Math.floor(toolRng() * TOOLS.length)];
    if (picked !== undefined) tools.push({ tool: picked.id, price: picked.price, stock: 1 });
  }

  const eventSeedRng = createRng(hash32(`garden:eventSeeds:${restockWave}`));
  const offers: ShopOffer[] = SEEDS.filter((seed) => seed.rare !== true && seed.prestigeOnly !== true).map(
    (seed) => {
      const price = Math.max(1, Math.round(seed.buy * (0.85 + shopRng() * 0.3)));
      const stock = 2 + Math.floor(shopRng() * 9);
      return { seed: seed.id, price, stock };
    },
  );
  // Rare seeds: at most two per restock, one unit each, often none at all.
  const rarePool: SeedId[] = [];
  for (const seed of SEEDS) {
    if (seed.rare !== true || seed.prestigeOnly === true) continue;
    if (eventSeedRng() < (seed.rareChance ?? EVENT_SEED_CHANCE)) rarePool.push(seed.id);
  }
  const rarePicked: SeedId[] = [];
  while (rarePicked.length < 2 && rarePool.length > 0) {
    const index = Math.floor(eventSeedRng() * rarePool.length);
    const [id] = rarePool.splice(index, 1);
    if (id !== undefined) rarePicked.push(id);
  }
  for (const id of rarePicked) {
    const seed = seedById(id);
    if (seed !== undefined) offers.push({ seed: id, price: seed.buy, stock: 1 });
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
    wave: phase.index,
    news: marketNewsFor(phase.index),
    phase: { id: phase.phase.id, startsAt: phase.startsAt, endsAt: phase.endsAt },
    event: { id: current.id, startedAt: phase.startsAt, endsAt: phase.endsAt },
    events: currentEvents.map((event) => ({
      id: event.id,
      startedAt: phase.startsAt,
      endsAt: phase.endsAt,
    })),
    nextEvents: nextEvents.map((event) => ({
      id: event.id,
      startedAt: nextPhase.startsAt,
      endsAt: nextPhase.endsAt,
    })),
    forecast: forecastEvents(now, 3),
    next: { id: next.id, startedAt: nextPhase.startsAt, endsAt: nextPhase.endsAt },
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
/** @brief Weather events running inside one phase window. */
export function phaseEvents(phase: DayPhaseState): EventDefinition[] {
  const rng = createRng(hash32(`garden:phase:${phase.index}`));
  const roll = rng();
  const count = roll < 0.3 ? 0 : roll < 0.85 ? 1 : 2;
  if (count === 0) return [];
  const pool = PHASE_WEATHER[phase.phase.id];
  const picked = new Set<EventId>();
  while (picked.size < Math.min(count, pool.length)) {
    const id = pool[Math.floor(rng() * pool.length)];
    if (id !== undefined) picked.add(id);
  }
  return EVENTS.filter((event) => picked.has(event.id));
}

/** @brief Weather events for the phase containing `now`. */
export function eventsAt(now: number): EventDefinition[] {
  return phaseEvents(dayPhaseAt(now));
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
  boost: Readonly<Partial<Record<EffectId, number>>> = {},
  scale = 1,
): EffectId[] {
  // Each event rolls independently, so two events can stack the same mutation.
  const rolled: EffectId[] = [];
  for (const event of events) rolled.push(...rollEffects(event, rng, bonus, boost, scale));
  return canonicalEffects(rolled);
}

/** @brief Growth time under several simultaneous events. */
export function growTimeForEvents(
  plant: { readonly growMs: number },
  events: readonly EventDefinition[],
  fertilizer: ActiveFertilizer | null = null,
  phaseScale = 1,
): number {
  const multiplier = fertilizer === null ? 1 : (fertilizerById(fertilizer.id)?.growMultiplier ?? 1);
  return Math.max(5_000, Math.round((plant.growMs / combinedGrowScale(events)) * multiplier * phaseScale));
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
  boost: Readonly<Partial<Record<EffectId, number>>> = {},
  scale = 1,
): EffectId[] {
  const rolled: EffectId[] = [];
  // One independent roll per weather mutation, in catalog order, so a fruit can
  // carry several mutations at once and the sequence stays deterministic.
  for (const effect of EFFECTS) {
    if (!effect.natural) continue;
    const base =
      (BASE_EFFECT_CHANCES[effect.id] ?? 0) + (event.effectChances[effect.id] ?? 0) + (bonus[effect.id] ?? 0);
    const chance = base * (boost[effect.id] ?? 1) * scale;
    if (chance <= 0) continue;
    if (rng() >= chance) continue;
    // A hit can stack more copies of the same mutation, each rarer than the last.
    rolled.push(effect.id);
    for (let copy = 2; copy <= MAX_EFFECT_STACK; copy += 1) {
      const stackChance = EFFECT_STACK_CHANCES[copy] ?? 0;
      if (stackChance <= 0 || rng() >= stackChance) break;
      rolled.push(effect.id);
    }
  }
  return rolled;
}

/** @brief Rolls at most one mutation for one periodic growth check. */
function rollOneMutation(
  events: readonly EventDefinition[],
  rng: () => number,
  boost: Readonly<Partial<Record<EffectId, number>>>,
  goodOnly: boolean,
  mutationBoost: number,
  badLuck: number,
): EffectId | undefined {
  const weights: Array<{ id: EffectId; weight: number }> = [];
  let total = 0;
  for (const effect of EFFECTS) {
    if (!effect.natural) continue;
    if (goodOnly && effect.multiplier <= 1) continue;
    let weight = BASE_EFFECT_CHANCES[effect.id] ?? 0;
    for (const event of events) weight += event.effectChances[effect.id] ?? 0;
    weight = weight * MUTATION_POLL_SCALE * (boost[effect.id] ?? 1);
    const bonusScale = MUTATION_POLL_MS / MUTATION_BONUS_INTERVAL_MS;
    weight += mutationBoost * bonusScale;
    if (effect.multiplier < 1) weight += badLuck * bonusScale;
    if (weight <= 0) continue;
    weights.push({ id: effect.id, weight });
    total += weight;
  }
  if (total <= 0) return undefined;
  // The phase only mutates when the aggregate chance fires; then exactly one
  // weighted mutation is chosen (no per-effect jackpot).
  if (rng() >= Math.min(1, total)) return undefined;
  let pick = rng() * total;
  for (const entry of weights) {
    pick -= entry.weight;
    if (pick < 0) return entry.id;
  }
  return weights[weights.length - 1]?.id;
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
export function weatherEffects(
  kindId: string,
  slot: number,
  plantedAt: number,
  until: number,
  spray: ActiveSpray | null = null,
  goodOnly = false,
  mutationBoost = 0,
  badLuck = 0,
): EffectId[] {
  const end = Math.max(plantedAt, until);
  const effects: EffectId[] = [];
  // Independent 30s mutation polls; the day/night phase only decides which
  // weather is active for that poll. At most one mutation per poll.
  let at = plantedAt + MUTATION_POLL_MS;
  for (let guard = 0; at <= end && guard < 2000; guard += 1) {
    const events = phaseEvents(dayPhaseAt(at));
    const poll = Math.floor(at / MUTATION_POLL_MS);
    const rng = createRng(hash32(`${kindId}:${slot}:poll:${poll}`));
    const rolled = rollOneMutation(events, rng, sprayBoostFor(spray), goodOnly, mutationBoost, badLuck);
    if (rolled !== undefined) effects.push(rolled);
    at += MUTATION_POLL_MS;
  }
  return canonicalEffects(effects);
}

/** @brief All mutations on a crop: manual ones plus accumulated weather. */
export function resolvedCropEffects(
  plot: PlotState,
  until: number,
  goodOnly = false,
  greenhouse = false,
): EffectId[] {
  const safeGoodOnly = goodOnly || greenhouse;
  const weather = weatherEffects(
    plot.seed,
    plot.slot,
    plot.plantedAt,
    Math.min(until, plot.readyAt),
    plot.spray,
    safeGoodOnly,
    plot.mutationBoost ?? 0,
    greenhouse ? 0 : (plot.badLuck ?? 0),
  );
  // Premium soil always feeds at least one good weather mutation.
  if (goodOnly && weather.length === 0) {
    const good = EFFECTS.filter((effect) => effect.natural && effect.multiplier > 1);
    if (good.length > 0) {
      const picked = good[hash32(`premium:${plot.seed}:${plot.slot}:${plot.plantedAt}`) % good.length];
      if (picked !== undefined) weather.push(picked.id);
    }
  }
  const combined = [...plot.effects, ...weather];
  if (greenhouse) {
    combined.push(GREENHOUSE_MUTATION);
    return canonicalEffects(combined.filter((id) => !BAD_MUTATIONS.has(id)));
  }
  return canonicalEffects(combined);
}

/** @brief All mutations on a fruit tree: manual ones plus accumulated weather. */
export function resolvedTreeEffects(tree: TreeState, until: number): EffectId[] {
  return canonicalEffects([
    ...tree.effects,
    ...weatherEffects(
      tree.tree,
      tree.slot,
      tree.plantedAt,
      Math.min(until, tree.readyAt),
      tree.spray,
      false,
      tree.mutationBoost ?? 0,
      tree.badLuck ?? 0,
    ),
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
 * @param hybrids Optional player hybrid definitions for resolving hybrid seeds.
 * @param greenhouse Whether this plot sits inside the greenhouse.
 */
export function plotView(
  plot: PlotState,
  now: number,
  hybrids?: readonly HybridSeed[],
  greenhouse = false,
): PlotView {
  const seed = resolveSeed(plot.seed, hybrids);
  if (seed === undefined) throw new Error(`Unknown seed: ${plot.seed}`);
  const total = Math.max(1, plot.readyAt - plot.plantedAt);
  const elapsed = Math.max(0, now - plot.plantedAt);
  const ready = now >= plot.readyAt;
  const progress = Math.min(1, elapsed / total);
  const stage = ready ? 3 : Math.min(2, Math.floor(progress * 3));
  return {
    seed,
    effects: resolvedCropEffects(plot, now, false, greenhouse)
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
export function cropSellPrice(
  stack: CropStack,
  season: SeasonSnapshot,
  hybrids?: readonly HybridSeed[],
): number {
  const multiplier = effectsMultiplier(stack.effects);
  const seed = seedById(stack.item);
  const hybrid = seed === undefined ? hybrids?.find((entry) => entry.id === stack.item) : undefined;
  const tree = seed === undefined && hybrid === undefined ? treeById(stack.item) : undefined;
  const base =
    seed !== undefined
      ? (season.prices[seed.id] ?? 0)
      : hybrid !== undefined
        ? hybrid.sell
        : tree !== undefined
          ? (season.fruitPrices[tree.id as TreeId] ?? 0)
          : 0;
  // Event seeds are worth a lot more while their weather runs.
  const active = new Set(season.events.map((event) => event.id));
  const bonus =
    seed?.eventBonus !== undefined && seed.eventBonus.events.some((id) => active.has(id))
      ? seed.eventBonus.multiplier
      : 1;
  const pest = stack.pest === true ? PEST_VALUE_MULTIPLIER : 1;
  const quality = 2 ** (Math.max(1, Math.min(5, stack.star ?? 1)) - 1);
  const newsMult = newsMultiplierForCrop(stack.item, season.news);
  return Math.round(base * multiplier * bonus * pest * quality * newsMult);
}

/** @brief Total value of every crop in a bag. */
export function bagValue(bag: BagState, season: SeasonSnapshot, hybrids?: readonly HybridSeed[]): number {
  return bag.crops.reduce((total, stack) => total + cropSellPrice(stack, season, hybrids) * stack.qty, 0);
}
