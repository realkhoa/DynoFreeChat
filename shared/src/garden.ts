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
  | "pitcher";

/** Fruit tree ids shipped in this build. */
export type TreeId = "apple" | "grape" | "orange" | "plum" | "apricot" | "coconut" | "elderberry";

/** Anything that can sit in the harvest bag: a crop seed or a tree fruit. */
export type ItemId = SeedId | TreeId;

/** Luck effects a crop can carry. */
export type EffectId =
  "wet" | "golden" | "frozen" | "snow" | "chill" | "sunray" | "smoked" | "cracked" | "onfire";

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
  | "wildfire";

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
];

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
];

/** Effects every planting can roll even under a calm sky. */
export const BASE_EFFECT_CHANCES: Readonly<Partial<Record<EffectId, number>>> = {
  golden: 0.03,
  frozen: 0.02,
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
];

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
}

/** Lifetime counters used by the HUD and the leaderboard. */
export interface GardenStats {
  /** Crops planted since the garden was created. */
  readonly planted: number;
  /** Crops harvested since the garden was created. */
  readonly harvested: number;
  /** Coins earned by selling since the garden was created. */
  readonly earned: number;
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
  /** Event window after this one, for the countdown. */
  readonly next: EventSnapshot;
  /** Seed shop offers and when they rotate. */
  readonly shop: {
    /** Server time of the next restock. */
    readonly restockAt: number;
    /** One offer per seed. */
    readonly offers: readonly ShopOffer[];
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
  | { readonly kind: "buySeed"; readonly seed: SeedId; readonly qty: number }
  | { readonly kind: "buySupply"; readonly supply: SupplyId; readonly qty: number }
  | {
      readonly kind: "sellCrop";
      readonly item: ItemId;
      readonly effects: readonly EffectId[];
      readonly qty: number;
    }
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
    return { kind, item: item.id as ItemId, effects: canonicalEffects(effects), qty };
  }
  if (kind === "buyTab") return { kind };
  if (kind === "waterAll" || kind === "harvestAll") return { kind };
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
  const offers: ShopOffer[] = SEEDS.map((seed) => {
    const price = Math.max(1, Math.round(seed.buy * (0.85 + shopRng() * 0.3)));
    const stock = 2 + Math.floor(shopRng() * 9);
    return { seed: seed.id, price, stock };
  });

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
    next: { id: next.id, startedAt: nextStart, endsAt: nextStart + EVENT_WAVE_MS },
    shop: { restockAt, offers },
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
  return Math.round(base * multiplier);
}

/** @brief Total value of every crop in a bag. */
export function bagValue(bag: BagState, season: SeasonSnapshot): number {
  return bag.crops.reduce((total, stack) => total + cropSellPrice(stack, season) * stack.qty, 0);
}
