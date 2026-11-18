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

/** Plots in one 3x3 patch; one garden page shows exactly one patch. */
export const PLOTS_PER_PATCH = 9;

/** Hard cap on bought patches, so the garden and the leaderboard stay bounded. */
export const MAX_PATCHES = 6;

/** Patches free when a garden is created. */
export const STARTING_PATCHES = 1;

/** Price of the second patch, in coins. */
export const PATCH_BASE_PRICE = 3_000;

/** Each further patch costs this multiple of the previous one. */
export const PATCH_PRICE_FACTOR = 3;

/** Absolute plot ceiling; action parsing uses it before the state is known. */
export const MAX_PLOTS = PLOTS_PER_PATCH * MAX_PATCHES;

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
  { id: "carrot", growMs: 3 * 60_000, buy: 5, sell: 9, art: [".", "v", "Y", "^"], regrow: false },
  { id: "parsnip", growMs: 6 * 60_000, buy: 14, sell: 30, art: [".", "v", "Y", "p"], regrow: false },
  { id: "cucumber", growMs: 10 * 60_000, buy: 30, sell: 40, art: [".", "v", "Y", "c"], regrow: true },
  { id: "tomato", growMs: 8 * 60_000, buy: 18, sell: 34, art: [".", "v", "Y", "o"], regrow: true },
  { id: "strawberry", growMs: 12 * 60_000, buy: 60, sell: 90, art: [".", "v", "Y", "s"], regrow: true },
  { id: "corn", growMs: 15 * 60_000, buy: 45, sell: 95, art: [".", "v", "Y", "u"], regrow: true },
  { id: "hop", growMs: 18 * 60_000, buy: 100, sell: 140, art: [".", "v", "Y", "h"], regrow: true },
  { id: "cauliflower", growMs: 20 * 60_000, buy: 90, sell: 220, art: [".", "v", "Y", "f"], regrow: false },
  { id: "blueberry", growMs: 25 * 60_000, buy: 180, sell: 260, art: [".", "v", "Y", "b"], regrow: true },
  { id: "pumpkin", growMs: 30 * 60_000, buy: 120, sell: 280, art: [".", "v", "Y", "@"], regrow: true },
  { id: "potato", growMs: 7 * 60_000, buy: 16, sell: 36, art: [".", "v", "Y", "t"], regrow: false },
  { id: "sunflower", growMs: 14 * 60_000, buy: 55, sell: 130, art: [".", "v", "Y", "X"], regrow: false },
  { id: "lavender", growMs: 16 * 60_000, buy: 70, sell: 160, art: [".", "v", "Y", "l"], regrow: false },
  { id: "watermelon", growMs: 22 * 60_000, buy: 130, sell: 210, art: [".", "v", "Y", "w"], regrow: true },
  { id: "pineapple", growMs: 28 * 60_000, buy: 200, sell: 320, art: [".", "v", "Y", "i"], regrow: true },
  { id: "pitcher", growMs: 35 * 60_000, buy: 250, sell: 380, art: [".", "v", "Y", "&"], regrow: true },
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
  /** Effect rolled at planting, or `null`. */
  readonly effect: EffectId | null;
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
  /** Effect rolled for the current fruit, or `null`. */
  readonly effect: EffectId | null;
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
  /** Effect the crop carried when harvested, or `null`. */
  readonly effect: EffectId | null;
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
  /** Bought 3x3 patches, `STARTING_PATCHES..MAX_PATCHES`. */
  readonly patches: number;
  /** Plot states for the owned patches, `patches * PLOTS_PER_PATCH` entries. */
  readonly plots: readonly (PlotState | null)[];
  /** Tree states for the owned patches, parallel to `plots`. */
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
  /** Bought 3x3 patches. */
  readonly patches: number;
  /** Plot states. */
  readonly plots: readonly (PlotState | null)[];
  /** Tree states, parallel to `plots`. */
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

/** Everything that changes with the server clock. */
export interface SeasonSnapshot {
  /** Rotation index of the current event wave. */
  readonly wave: number;
  /** Current event window. */
  readonly event: EventSnapshot;
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
  | { readonly kind: "buyPatch" }
  | { readonly kind: "buySeed"; readonly seed: SeedId; readonly qty: number }
  | { readonly kind: "buySupply"; readonly supply: SupplyId; readonly qty: number }
  | {
      readonly kind: "sellCrop";
      readonly item: ItemId;
      readonly effect: EffectId | null;
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
  | "MAX_PATCHES"
  | "CANNOT_VISIT_SELF";

/** Successful response to a garden action. */
export interface GardenActResponse {
  /** Updated owner snapshot. */
  readonly state: GardenSnapshot;
  /** Season the action was validated against. */
  readonly season: SeasonSnapshot;
  /** Server clock when the action was applied. */
  readonly serverNow: number;
}

/** Successful response to a state read. */
export interface GardenStateResponse {
  /** Owner snapshot. */
  readonly state: GardenSnapshot;
  /** Current season snapshot. */
  readonly season: SeasonSnapshot;
  /** Server clock. */
  readonly serverNow: number;
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

/** @brief Looks one event up by id. */
export function eventById(id: string): EventDefinition | undefined {
  return EVENTS.find((event) => event.id === id);
}

/** @brief Total plots owned with `patches` bought patches. */
export function totalPlots(patches: number): number {
  return patches * PLOTS_PER_PATCH;
}

/**
 * @brief Price of the next patch.
 * @param patchesOwned Patches already owned; the first bought patch is number 2.
 * @details The ladder compounds: 3,000 -> 9,000 -> 27,000 -> ...
 */
export function nextPatchPrice(patchesOwned: number): number {
  return Math.round(PATCH_BASE_PRICE * PATCH_PRICE_FACTOR ** Math.max(0, patchesOwned - 1));
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

/** @brief Builds the bag key for one produce stack. */
export function cropKey(item: ItemId, effect: EffectId | null): string {
  return effect === null ? item : `${item}:${effect}`;
}

/**
 * @brief Parses one bag key back into a stack identity.
 * @return The item and effect, or `null` when malformed.
 */
export function parseCropKey(key: string): { item: ItemId; effect: EffectId | null } | null {
  const [itemPart, effectPart] = key.split(":");
  const item = itemPart === undefined ? undefined : itemById(itemPart);
  if (item === undefined) return null;
  if (effectPart === undefined) return { item: item.id as ItemId, effect: null };
  const effect = effectById(effectPart);
  return effect === undefined ? null : { item: item.id as ItemId, effect: effect.id };
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
    const slot = readSlot(value.slot);
    const seed = typeof value.seed === "string" ? seedById(value.seed) : undefined;
    if (slot === null || seed === undefined) return null;
    return { kind, slot, seed: seed.id };
  }
  if (kind === "plantTree") {
    const slot = readSlot(value.slot);
    const tree = typeof value.tree === "string" ? treeById(value.tree) : undefined;
    if (slot === null || tree === undefined) return null;
    return { kind, slot, tree: tree.id };
  }
  if (kind === "harvest" || kind === "water" || kind === "uproot") {
    const slot = readSlot(value.slot);
    if (slot === null) return null;
    return { kind, slot, tree: value.tree === true };
  }
  if (kind === "fertilize") {
    const slot = readSlot(value.slot);
    const supply = typeof value.supply === "string" ? fertilizerById(value.supply) : undefined;
    if (slot === null || supply === undefined) return null;
    return { kind, slot, tree: value.tree === true, supply: supply.id };
  }
  if (kind === "spray") {
    const slot = readSlot(value.slot);
    const supply = typeof value.supply === "string" ? sprayById(value.supply) : undefined;
    if (slot === null || supply === undefined) return null;
    return { kind, slot, tree: value.tree === true, supply: supply.id };
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
    const effect =
      value.effect === null ? null : typeof value.effect === "string" ? effectById(value.effect) : undefined;
    const qty = value.qty;
    if (item === undefined || effect === undefined) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    return { kind, item: item.id as ItemId, effect: effect === null ? null : effect.id, qty };
  }
  if (kind === "buyPatch") return { kind };
  if (kind === "sellAll") return { kind };
  return null;
}

/** @brief Reads a plot slot, or `null` when out of range. */
function readSlot(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw >= MAX_PLOTS) return null;
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
  const eventIndex = modulo(wave, EVENTS.length);
  const current = EVENTS[eventIndex];
  if (current === undefined) throw new Error("Garden event catalog is empty");
  const nextWave = wave + 1;
  const next = EVENTS[modulo(nextWave, EVENTS.length)] ?? current;

  const waveStart = EPOCH_MS + wave * EVENT_WAVE_MS;
  const nextStart = EPOCH_MS + nextWave * EVENT_WAVE_MS;

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
    prices[seed.id] = Math.max(1, Math.round(seed.sell * (0.85 + priceRng() * 0.3) * current.sellBonus));
  }
  const fruitPrices = {} as Record<TreeId, number>;
  for (const tree of TREES) {
    fruitPrices[tree.id] = Math.max(1, Math.round(tree.sell * (0.85 + priceRng() * 0.3) * current.sellBonus));
  }

  return {
    wave,
    event: { id: current.id, startedAt: waveStart, endsAt: waveStart + EVENT_WAVE_MS },
    next: { id: next.id, startedAt: nextStart, endsAt: nextStart + EVENT_WAVE_MS },
    shop: { restockAt, offers },
    prices,
    fruitPrices,
  };
}

/** @brief Current event definition for a server time. */
export function eventAt(now: number): EventDefinition {
  const index = modulo(Math.floor((now - EPOCH_MS) / EVENT_WAVE_MS), EVENTS.length);
  return (
    EVENTS[index] ??
    EVENTS[0] ?? {
      id: "calm",
      growScale: 1,
      sellBonus: 1,
      effectChances: {},
    }
  );
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
export function rollEffect(
  event: EventDefinition,
  rng: () => number,
  bonus: Readonly<Partial<Record<EffectId, number>>> = {},
): EffectId | null {
  const natural = EFFECTS.filter((effect) => effect.natural);
  const chances = natural.map((effect) => ({
    id: effect.id,
    chance:
      (BASE_EFFECT_CHANCES[effect.id] ?? 0) + (event.effectChances[effect.id] ?? 0) + (bonus[effect.id] ?? 0),
  }));
  const total = chances.reduce((sum, entry) => sum + entry.chance, 0);
  if (total <= 0) return null;

  // More than 95% of plantings may be lucky; scale down so a stack of event
  // chances never makes "plain" impossible.
  const scale = total > 0.95 ? 0.95 / total : 1;
  const roll = rng();
  let cursor = 0;
  for (const entry of chances) {
    cursor += entry.chance * scale;
    if (roll < cursor) return entry.id;
  }
  return null;
}

/** Live view of one plot for rendering. */
export interface PlotView {
  /** Seed planted here. */
  readonly seed: SeedDefinition;
  /** Effect on the crop. */
  readonly effect: EffectDefinition | null;
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
    effect: plot.effect === null ? null : (effectById(plot.effect) ?? null),
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
  const effect = stack.effect === null ? null : effectById(stack.effect);
  const multiplier = effect?.multiplier ?? 1;
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
