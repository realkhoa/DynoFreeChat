/**
 * @file game.ts
 * @brief ASCII Garden document: three tabs, an ASCII plot board and live sync.
 * @details The document stays a source file: the tabs are drawn in the code
 * view, the board is a fixed-width character literal, and the HUD is a comment
 * line. All economy decisions happen on the server; this module renders the
 * returned snapshot, counts down against the server clock and translates every
 * label through the app locale layer.
 */

import {
  CROPS_PER_TAB,
  EFFECTS,
  FERTILIZERS,
  FRUIT_PATCHES_PER_TAB,
  HARVEST_ALL_COST,
  PEST_SPRAY_COST,
  DISEASE_DEATH_CYCLES,
  PLOT_REPAIR_COST,
  TREE_DISEASE_DEATH_CYCLES,
  SKILL_MAX_LEVEL,
  SOIL_START,
  SPECIAL_PATCH_PRICE,
  SPECIAL_PLOT_PRICE,
  SPECIAL_QUALITY_STARS,
  specialPlotCost,
  SPECIAL_PLOTS_PER_PATCH,
  SPECIAL_SLOTS,
  skillThreshold,
  ACHIEVEMENTS,
  EGG_PRICE,
  GREENHOUSE_PRICES,
  GREENHOUSE_SLOTS,
  GREENHOUSE_SLOTS_PER_LEVEL,
  GREENHOUSE_MUTATION,
  greenhouseCapacity,
  NURSERY_BASE_COST,
  NURSERY_COST_FACTOR,
  MIN_BREED_PARENTS,
  MAX_BREED_PARENTS,
  MAX_HYBRIDS,
  isHybridId,
  hybridBreedCost,
  hybridOdds,
  hybridAsSeedDefinition,
  resolveSeed,
  type AnySeedId,
  type AnyItemId,
  type HybridId,
  type HybridSeed,
  INSURANCE_PRICE,
  PETS,
  PET_MAX_LEVEL,
  STAFF_SLOTS,
  STAFF_ROLES,
  type StaffRole,
  MINE_FLOOR_CELLS,
  PICKAXE_TIERS,
  mineElevatorCheckpoints,
  initialMineState,
  RELICS,
  MAX_EQUIPPED_RELICS,
  PET_SKILL_COOLDOWN_MS,
  type RelicId,
  type PetId,
  type StockQuote,
  type MineRockKind,
  type MineRockCell,
  type MineState,
  type PickaxeTier,
  staffHireCost,
  staffXpToLevel,
  staffMarketAt,
  staffWorkIntervalMs,
  type StaffTrait,
  planQuickPlan,
  type QuickPlanPreview,
  wheelCost,
  petById,
  contractOffers,
  CONTRACT_CHAIN,
  merchantOffers,
  soilRenovateCost,
  WATER_ALL_COST,
  MAX_TABS,
  PLOTS_PER_PATCH,
  TREES_PER_TAB,
  SEEDS,
  FINAL_SHOP,
  FINAL_SHOP_PRESTIGE,
  PRESTIGE_SHOP,
  KITCHEN_PRICE,
  DAY_MS,
  prestigeGrowScale,
  weeklyModifier,
  weekEndsAt,
  prestigeRequirement,
  raidHitCost,
  prestigeStarterSeeds,
  prestigeSellBonus,
  SPRAYS,
  SPRAY_MUTATION_BOOST,
  fertilizerById,
  sprayById,
  TREES,
  cropSellPrice,
  codexReward,
  effectById,
  gardenCounts,
  effectsMultiplier,
  nextPatchPrice,
  nextTabPrice,
  resolvedCropEffects,
  resolvedTreeEffects,
  ANIMALS,
  BUILDING_IDS,
  ATTACHMENTS,
  type AttachmentSlot,
  BUILDINGS,
  BREED_CYCLES,
  FARM_CYCLE_MS,
  PLANT_THIRST_MS,
  POND_MAX_SLOTS,
  BASE_FISH_SPECIES,
  pondBasinIndex,
  pondBasinSlot,
  pondBasinSlotRange,
  inspectPondBasin,
  animalById,
  animalIntervalMs,
  animalIsIncubating,
  animalMeatPrice,
  animalQuality,
  breedEggProduct,
  needsFertilizer,
  needsSpray,
  buildingSlots,
  buildingUpgradeCost,
  buildingById,
  maxBuildingLevel,
  EVENTS,
  PRODUCTS,
  TOOLS,
  MUSHROOM_TRAYS,
  MUSHROOMS,
  mushroomById,
  type MushroomId,
  MACHINES,
  MACHINE_MAX_LEVEL,
  machineCycles,
  MACHINE_PRICE,
  WAREHOUSE_PRICE,
  converterOutput,
  machineById,
  seedById,
  seedMakerOutput,
  seedMakerChance,
  productById,
  productPrice,
  type AnimalId,
  type BuildingId,
  type CropStack,
  type ProductStack,
  type MachineDefinition,
  type MachineId,
  type MachineState,
  type ProductId,
  plotView,
  strongestEffect,
  treeById,
  treeLikeById,
  type EffectId,
  type GardenAction,
  type GardenSnapshot,
  type GuildSnapshot,
  type HybridFishDefinition,
  type RaidSnapshot,
  type GlobalSaleEntry,
  type TimelineEvent,
  type LeaderboardEntry,
  type PlotState,
  type SeasonSnapshot,
  type FertilizerId,
  type ItemId,
  type MarketSnapshot,
  type SeedId,
  type SprayId,
  type SupplyId,
  type ToolId,
  type TreeId,
  type TreeState,
  type VisitSnapshot,
} from "@dyno/shared/garden";
import {
  formatCompact,
  formatDuration,
  formatNumber,
  getLocale,
  onLocaleChange,
  t,
  tList,
  translateError,
} from "@/shared/i18n";
import { loadIdentity, type Identity } from "@/shared/lib/identity";
import type { GardenBot } from "@/features/games/garden/api";
import { readParam, writeParams } from "@/shared/lib/urlstate";
import type { GameContext, GameMount } from "../mount";
import {
  animalCellRender,
  CELL_INNER,
  cellRender,
  fitText,
  growthColor,
  labelValue,
  lockedCellRender,
  treeCellRender,
} from "./ascii";
import { GardenApi, GardenApiError } from "./api";
import { createChillMusicPlayer } from "./music";
import {
  buildRebornAction,
  buildRebornActionColumns,
  buildRebornBoard,
  paintRebornAction,
  paintRebornCell,
  type RebornAction,
  type RebornPlot,
} from "./reborn";
import {
  buildTownNpcs,
  buildTownShop,
  type TownNpc,
  type TownShopItem,
  type TownShopSection,
} from "./townhall";

/** Repaint interval while the document is open. */
const TICK_MS = 1_000;

/** Background refresh interval for season, state and visits. */
const POLL_MS = 60_000;

/** Tab data stays fresh this long, so flipping tabs does not re-request it. */
const DATA_TTL_MS = 30_000;

/** How long an uproot confirmation stays armed. */
const UPROOT_ARM_MS = 4_000;

/** One active tab inside the legacy UI. */
type Tab =
  | "garden"
  | "market"
  | "event"
  | "chart"
  | "bots"
  | "rank"
  | "farm"
  | "warehouse"
  | "extras"
  | "prestige"
  | "dynopedia"
  | "log"
  | "levels";

/** One visible view of the document. The pre-rebuild UI sits behind `legacy`. */
type GardenView = "legacy" | "reborn";

/** One tab inside the rebuilt view. */
type RebornTab = "garden" | "townhall" | "weather" | "event" | "dynopedia" | "log" | "levels" | "restore";

/** @brief Tabs of the rebuilt view, in strip order. */
const REBORN_TABS: readonly { readonly id: RebornTab; readonly labelKey: string }[] = [
  { id: "garden", labelKey: "reborn.tabGarden" },
  { id: "townhall", labelKey: "reborn.tabTownhall" },
  { id: "weather", labelKey: "reborn.tabWeather" },
  { id: "event", labelKey: "reborn.tabEvent" },
  { id: "dynopedia", labelKey: "reborn.tabDynopedia" },
  { id: "log", labelKey: "reborn.tabLog" },
  { id: "levels", labelKey: "reborn.tabLevels" },
  { id: "restore", labelKey: "reborn.tabRestore" },
];

/** One tab inside the garden tab of the rebuilt view. */
type GardenTab =
  | "main"
  | "mushroom"
  | "greenhouse"
  | "nursery"
  | "barn"
  | "coop"
  | "pond"
  | "warehouse"
  | "kitchen"
  | "mine"
  | "shipping"
  | "prestige";

/** @brief Garden tabs, in strip order. */
const GARDEN_TABS: readonly { readonly id: GardenTab; readonly labelKey: string }[] = [
  { id: "main", labelKey: "gardenTab.main" },
  { id: "mushroom", labelKey: "gardenTab.mushroom" },
  { id: "greenhouse", labelKey: "gardenTab.greenhouse" },
  { id: "nursery", labelKey: "gardenTab.nursery" },
  { id: "barn", labelKey: "gardenTab.barn" },
  { id: "coop", labelKey: "gardenTab.coop" },
  { id: "pond", labelKey: "gardenTab.pond" },
  { id: "warehouse", labelKey: "gardenTab.warehouse" },
  { id: "kitchen", labelKey: "gardenTab.kitchen" },
  { id: "mine", labelKey: "gardenTab.mine" },
  { id: "shipping", labelKey: "gardenTab.shipping" },
  { id: "prestige", labelKey: "gardenTab.prestige" },
];

/** Quick actions that open a menu, shown as a popover at the clicked cell. */
const QUICK_MENU_ACTS: ReadonlySet<string> = new Set([
  "bulkUproot",
  "pickAllSupply",
  "pickTool",
  "pickPlantTool",
  "quickPlan",
]);

/**
 * @brief Tabs preserved inside the collapsed legacy view.
 * @details Order drives the legacy strip; every id must stay in sync with {@link Tab}.
 */
const LEGACY_TABS = [
  "garden",
  "market",
  "event",
  "chart",
  "bots",
  "rank",
  "farm",
  "warehouse",
  "extras",
  "prestige",
  "dynopedia",
  "log",
  "levels",
] as const satisfies readonly Tab[];

/**
 * @brief Tabs shown in the document strip.
 * @details The whole old UI is one `legacy` view. Rebuilt views are added here and
 * dispatched from {@link buildContent}, without touching the legacy strip.
 */
const VIEWS: readonly { readonly id: GardenView; readonly labelKey: string }[] = [
  { id: "legacy", labelKey: "tabs.legacy" },
  { id: "reborn", labelKey: "tabs.reborn" },
];

/** Whether the document is showing the owner's garden or a friend's. */
type Mode = "owner" | "visit";

/** One open context menu: position, target slot and the visible submenu. */
interface MenuState {
  /** Which grid owns the target. */
  readonly area: "crop" | "tree";
  /** Absolute slot index inside that grid. */
  readonly slot: number;
  /** Viewport x of the menu origin. */
  readonly x: number;
  /** Viewport y of the menu origin (cell bottom). */
  readonly y: number;
  /** Viewport y of the cell top, used to flip the menu above the cell. */
  readonly anchorTop: number;
  /** Which submenu is showing. */
  readonly view: "actions" | "fertilize" | "spray" | "seed" | "tree";
}

/** One status message. */
interface Message {
  /** Localized text. */
  readonly text: string;
  /** Visual tone. */
  readonly kind: "ok" | "err" | "info";
}

/** Overrides used by tests; production uses the browser defaults. */
export interface GardenGameOptions {
  /** Prebuilt API client. */
  readonly api?: GardenApi;
  /** Storage for credentials. */
  readonly storage?: Storage | null;
}

/**
 * @brief Builds the ASCII Garden game module.
 * @param options Test overrides.
 * @return A mount whose timers, listeners and DOM are released by `unmount`.
 */
export function createAsciiGardenGame(options: GardenGameOptions = {}): GameMount {
  const api = options.api ?? new GardenApi({ storage: options.storage });

  let host: HTMLElement | null = null;
  let root: HTMLElement | null = null;
  let detailPre: HTMLPreElement | null = null;
  let cleanups: Array<() => void> = [];
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether a snapshot refresh is already on the wire. */
  let refreshing = false;
  /** Cache stamps and in-flight guards for the secondary tabs. */
  let leaderboardAt = 0;
  let leaderboardBusy = false;
  let botsAt = 0;
  let botsBusy = false;
  let chartAt = 0;
  let chartBusy = false;
  let extrasAt = 0;
  let extrasBusy = false;
  let uprootTimer: ReturnType<typeof setTimeout> | null = null;
  let disposeLocale: (() => void) | null = null;
  let disposed = false;

  let mode: Mode = "owner";
  let view: GardenView = "legacy";
  let tab: Tab = "garden";
  /** Active tab inside the rebuilt view: the garden or the town. */
  let rebornTab: RebornTab = "garden";
  /** Active tab inside the garden: main garden, mushroom house, greenhouse, nursery. */
  let gardenTab: GardenTab = "main";
  /** Tray slot whose spawn picker is open, if any. */
  let mushroomPicker: number | null = null;
  /** Tray slot whose info panel is open, if any. */
  let mushroomInfo: number | null = null;
  /** Staff slot whose hire/config panel is open, if any. */
  let staffPanel: number | null = null;
  /** Quick Plan preview waiting for confirmation, if any. */
  let quickPlanPreview: QuickPlanPreview | null = null;
  /** Quick action cell whose menu is shown as a popover, if any. */
  let quickMenu: { action: string; x: number; y: number; anchorTop: number } | null = null;
  /** Which townhall NPC has its shop open, if any. */
  let townNpc: string | null = null;
  /** Which public board is open in the town square, if any. */
  let townBoard:
    | "rank"
    | "chart"
    | "bots"
    | "billboard"
    | "quests"
    | "jobs"
    | "gift"
    | "achievements"
    | "tournament"
    | "stocks"
    | null = null;
  let stockQuotes: StockQuote[] = [];
  let stockUpdatedAt = 0;
  let stockBusy = false;
  let visitCode: string | null = null;
  let state: GardenSnapshot | null = null;
  let visiting: VisitSnapshot | null = null;
  let season: SeasonSnapshot | null = null;
  let selectedSlot: number | null = null;
  let selectedArea: "crop" | "tree" = "crop";
  let supplyPicker: "fertilize" | "spray" | null = null;
  let page = 0;
  let menu: MenuState | null = null;
  let chartMarket: MarketSnapshot | null = null;
  let botGardens: GardenBot[] = [];
  let tournament: Array<{ nick: string; code: string; earned: number; harvested: number }> = [];
  // Staff popover, mirroring the plot context menu.
  let staffMenu: { index: number | null | "list"; x: number; y: number; anchorTop: number } | null = null;
  // Work-safe look by default: no bright game colours unless the player opts in.
  let stealth = localStorage.getItem("dyno.garden.stealth") !== "0";
  const music = createChillMusicPlayer();
  let musicWanted = localStorage.getItem("dyno.garden.music") === "1";
  let farmPicker: { building: BuildingId; slot: number } | null = null;
  let animalMenu: { building: BuildingId; slot: number; x: number; y: number; anchorTop: number } | null =
    null;
  /** Source cell of a pending shovel move, cleared on cancel or completion. */
  let moveSource: { slot: number; area: "crop" | "tree" } | null = null;
  let machineMenu: { id: MachineId; x: number; y: number; anchorTop: number } | null = null;
  let specialPicker: number | null = null;
  let specialMenu: { slot: number; x: number; y: number } | null = null;
  let greenhousePicker: number | null = null;
  let greenhouseMenu: { slot: number; x: number; y: number } | null = null;
  let greenhouseSupplyPicker: number | null = null;
  let greenhouseBulkSeed = "";
  let nurseryParents: AnyItemId[] = [];
  let nurseryPopover: HybridId | null = null;
  let hybridRenameDraft = "";
  let minerMenuOpen = false;
  let machineQty = 1;
  let chartSort: "roi" | "income" | "pressure" = "roi";
  let raidSnapshot: RaidSnapshot | null = null;
  let guildSnapshot: GuildSnapshot | null = null;
  let guildBoard: Array<{ id: string; name: string; ownerId: string; members: number }> = [];
  let guildNameDraft = "";
  let guildDonateDraft = "1000000";
  let globalSales: GlobalSaleEntry[] = [];
  let globalSalesStatus: "idle" | "loading" | "error" = "idle";
  /** Filter selection for reborn log view: all, global server sales, or personal timeline. */
  let logFilter: "all" | "global" | "timeline" = "all";
  /** Search string filter for reborn log items. */
  let logQuery = "";
  let dynopediaCategory = "effects";
  let recipeInputs: string[] = ["roe", "milk"];
  let recipeResult = "";
  let globalRecipes: Array<{
    id: string;
    inputs: string[];
    output: string;
    price: number;
    createdAt: number;
  }> = [];
  let globalHybrids: HybridFishDefinition[] = [];
  let dynopediaQuery = "";
  /** Filter for dynopedia items: all, discovered only, or undiscovered only. */
  let dynopediaFilter: "all" | "known" | "unknown" = "all";
  let kitchenQuery = "";
  let kitchenStatusFilter: "all" | "cookable" | "missing" | "cooldown" = "all";
  let kitchenIngredientFilter = "";
  let machineLimitDraft = "";
  let specialSupplyPicker: { kind: "fertilize" | "spray"; slot: number } | null = null;
  let bulkPanel: "plan" | "uproot" | null = null;
  let confirmPrestige = false;
  let sellAllDialog: { gross: number; net: number; stacks: number; qty: number } | null = null;
  let uprootPending: {
    seed?: SeedId;
    tree?: TreeId;
    priceBelow?: number;
    profit?: "loss" | "win";
    dead?: boolean;
  } | null = null;
  let uprootPriceDraft = "";
  let giftCode = "";
  let giftAmount = "1000";
  let buyQty = 1;
  type GardenTool =
    | { kind: "fertilize" | "spray"; supply: SupplyId }
    | { kind: "plant"; seed: AnySeedId }
    | { kind: "water" }
    | { kind: "harvest" };
  let tool: GardenTool | null = null;
  let toolPicker: "fertilize" | "spray" | "plant" | "fertilizeAll" | "sprayAll" | null = null;
  let pendingSelection: { area: "crop" | "tree"; slot: number } | null = null;
  let pendingPage: number | null = null;
  let message: Message | null = null;
  let loading = true;
  let offline = false;
  let busy = false;
  let uprootArmed = false;
  let restoreDraft = "";
  let accountUserDraft = "";
  let accountPassDraft = "";
  let accountRecoveryDraft = "";
  let linkedAccountUsername: string | null = api.account?.username ?? null;
  let leaderboard: LeaderboardEntry[] = [];
  let localIdentity: Identity = { nick: "guest", color: "hsl(210 40% 70%)" };

  // ------------------------------------------------------------------ helpers

  /** @brief Registers one listener removed by `unmount`. */
  function listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  }

  /** @brief Localized garden clock: server time corrected by the API offset. */
  function now(): number {
    return api.now();
  }

  /** @brief Reads `localStorage` when the browser allows it. */
  function identityStorage(): Storage | null {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  }

  /** @brief Pushes the latest local nickname onto the garden profile. */
  async function syncProfile(): Promise<void> {
    if (mode !== "owner" || state === null || busy) return;
    if (state.nick === localIdentity.nick && state.color === localIdentity.color) return;
    busy = true;
    try {
      const result = await api.rename(localIdentity.nick, localIdentity.color);
      state = result.state;
      season = result.season;
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Creates one plain div. */
  function div(className: string): HTMLDivElement {
    const element = document.createElement("div");
    element.className = className;
    return element;
  }

  /** @brief Creates one span. */
  function span(className: string, text: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = text;
    return element;
  }

  /** @brief Creates one monospace line block. */
  function lineBlock(text: string): HTMLDivElement {
    const line = div("garden-line");
    line.textContent = text;
    return line;
  }

  /** @brief Creates one `[ action ]` button. */
  function actionButton(label: string, act: string, enabled = true): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-btn";
    button.textContent = `[ ${label} ]`;
    button.dataset.act = act;
    if (!enabled) button.disabled = true;
    return button;
  }

  /** @brief Creates one clickable monospace row. */
  function rowButton(className: string, text: string, act: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `garden-row ${className}`;
    button.textContent = text;
    button.dataset.act = act;
    return button;
  }

  /** @brief Returns the active view's custom Nursery hybrids list. */
  function activeHybrids(): readonly HybridSeed[] {
    return (mode === "visit" ? visiting?.hybrids : state?.hybrids) ?? [];
  }

  /** @brief Localized short seed name, supporting Nursery hybrids. */
  function seedName(id: AnySeedId | string): string {
    if (isHybridId(id)) {
      return activeHybrids().find((entry) => entry.id === id)?.name ?? id;
    }
    return t(`seeds.${id}.short`);
  }

  /** @brief Localized short tree name. */
  function treeName(id: TreeId): string {
    return t(`trees.${id}.short`);
  }

  /** @brief Market-adjusted purchase price for a seed or supply. */
  function buyPriceOf(item: string, base: number): number {
    return season?.buyPrices?.[item] ?? base;
  }

  /**
   * @brief Counts plants that still accept a bulk fertilizer or spray.
   * @param kind Bulk supply family.
   * @param at Server-clock time, used by the fertilizer check.
   * @details Mirrors the worker rule: fertilizer skips ripe and already-fed
   * plants, spray skips plants that still carry a charge.
   */
  function supplyTargetCount(kind: "fertilize" | "spray", at: number): number {
    let count = 0;
    for (const plant of state?.plots ?? []) {
      if (plant === null) continue;
      if (kind === "fertilize" ? needsFertilizer(plant, at) : needsSpray(plant)) count += 1;
    }
    for (const plant of state?.trees ?? []) {
      if (plant === null) continue;
      if (kind === "fertilize" ? needsFertilizer(plant, at) : needsSpray(plant)) count += 1;
    }
    return count;
  }

  /** @brief Localized full name of any bag item or Nursery hybrid. */
  function itemName(id: AnyItemId | string): string {
    if (isHybridId(id)) {
      return activeHybrids().find((entry) => entry.id === id)?.name ?? id;
    }
    return seedById(id) === undefined ? t(`trees.${id}`) : t(`seeds.${id}`);
  }

  /** @brief Minimum prestige tier needed to plant a seed. */
  function seedPrestigeTier(id: AnySeedId | string): number {
    if (isHybridId(id)) return 0;
    return PRESTIGE_SHOP.find((offer) => offer.seed === id)?.tier ?? 0;
  }

  /** @brief Whether the current account is below a seed's prestige tier. */
  function seedLocked(id: AnySeedId | string): boolean {
    if (isHybridId(id)) return false;
    const level = state?.extras.prestige ?? 0;
    return seedPrestigeTier(id) > level;
  }

  /**
   * @brief Removes diacritical marks and normalizes letters for fuzzy text matching.
   * @details Normalizes Unicode characters using NFD decomposition and strips accent marks,
   * while mapping special Vietnamese characters such as đ/Đ to d.
   * @param text Raw text string to normalize.
   * @return Lowercase diacritics-free string suitable for substring matching.
   */
  function foldDiacritics(text: string): string {
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase();
  }

  /** @brief Display name for a crop, fruit, hybrid or product id. */
  function materialName(id: string): string {
    if (isHybridId(id) || seedById(id) !== undefined || treeById(id) !== undefined) {
      return itemName(id);
    }
    const key = `products.${id}`;
    const translated = t(key);
    return translated === key ? id : translated;
  }

  /**
   * @brief Counts the total quantity of a crop, fruit or product across the bag.
   * @param id Identifier of the crop or product.
   * @return Available quantity in player's crops or products stacks.
   */
  function countMaterialInBag(id: string): number {
    if (state === null) return 0;
    let total = 0;
    for (const stack of state.bag.crops) {
      if (stack.item === id) total += stack.qty;
    }
    for (const stack of state.bag.products ?? []) {
      if (stack.product === id) total += stack.qty;
    }
    return total;
  }

  /** @brief Compact mutation badge: strongest name plus a `+n` counter. */
  function effectBadge(effects: readonly EffectId[]): string {
    const strongest = strongestEffect(effects);
    if (strongest === null) return "";
    const copies = effects.filter((id) => id === strongest.id).length;
    const others = effects.length - copies;
    const base = copies > 1 ? `${t(`effects.${strongest.id}`)} ×${copies}` : t(`effects.${strongest.id}`);
    return others > 0 ? `${base}+${others}` : base;
  }

  /** @brief Full mutation summary for the detail panel, with the total. */
  function effectListText(effects: readonly EffectId[]): string {
    if (effects.length === 0) return t("garden.effectNone");
    const counts = new Map<EffectId, number>();
    for (const id of effects) counts.set(id, (counts.get(id) ?? 0) + 1);
    const parts = [...counts].map(([id, count]) => {
      const label = t(`effects.${id}`);
      const per = effectById(id)?.multiplier ?? 1;
      return count > 1 ? `${label} ×${count} (x${per})` : `${label} x${per}`;
    });
    const total = effectsMultiplier(effects);
    return effects.length > 1 ? `${parts.join(" + ")} = x${total}` : (parts[0] ?? "");
  }

  /** @brief Plots for the active mode. */
  function currentPlots(): readonly (PlotState | null)[] | null {
    return mode === "visit" ? (visiting?.plots ?? null) : (state?.plots ?? null);
  }

  /** @brief Bought tab count for the active mode. */
  function currentTabs(): number {
    return mode === "visit" ? (visiting?.tabs ?? 1) : (state?.tabs ?? 1);
  }

  /** @brief Pages to show: owned tabs plus one not-yet-bought preview. */
  function pageCount(): number {
    const owned = currentTabs();
    return owned < MAX_TABS ? owned + 1 : owned;
  }

  /** @brief Whether the current page is the preview of the next tab. */
  function isPreviewPage(): boolean {
    return page >= currentTabs();
  }

  /** @brief Absolute crop index of the current tab's first slot. */
  function cropOffset(): number {
    return page * CROPS_PER_TAB;
  }

  /** @brief Absolute tree index of the current tab's first slot. */
  function treeOffset(): number {
    return page * TREES_PER_TAB;
  }

  /** @brief Price of the next tab, or `null` at the cap. */
  function nextTabCost(): number | null {
    return currentTabs() >= MAX_TABS ? null : nextTabPrice(currentTabs());
  }

  /** @brief Open crop patch counts per tab for the active mode. */
  function currentPatches(): readonly number[] {
    return mode === "visit" ? (visiting?.unlockedPatches ?? [1]) : (state?.unlockedPatches ?? [1]);
  }

  /** @brief Whether one crop slot sits in a still-locked 3x3 patch. */
  function cropSlotLocked(slot: number): boolean {
    const tab = Math.floor(slot / CROPS_PER_TAB);
    const local = slot % CROPS_PER_TAB;
    const patch = Math.floor(local / PLOTS_PER_PATCH);
    return (currentPatches()[tab] ?? 1) <= patch;
  }

  /** @brief Next crop patch price for one tab. */
  function patchCost(tab: number): number {
    return nextPatchPrice(currentPatches()[tab] ?? 1);
  }

  /** @brief Public share code for the active mode. */
  function currentCode(): string | null {
    return mode === "visit" ? (visiting?.code ?? null) : (state?.code ?? null);
  }

  /** @brief Trees for the active mode. */
  function currentTrees(): readonly (TreeState | null)[] | null {
    return mode === "visit" ? (visiting?.trees ?? null) : (state?.trees ?? null);
  }

  /** @brief One plot from the active snapshot. */
  function plotAt(slot: number): PlotState | null {
    const plots = currentPlots();
    return plots === null ? null : (plots[slot] ?? null);
  }

  /** @brief One tree from the active snapshot. */
  function treeAt(slot: number): TreeState | null {
    const trees = currentTrees();
    return trees === null ? null : (trees[slot] ?? null);
  }

  /** @brief Names the selected slot for the action messages. */
  function selectedName(): string {
    if (selectedSlot === null) return "";
    if (selectedArea === "tree") {
      const tree = treeAt(selectedSlot);
      return tree === null ? "" : t(`trees.${tree.tree}`);
    }
    const plot = plotAt(selectedSlot);
    return plot === null ? "" : t(`seeds.${plot.seed}`);
  }

  /** @brief Localized text for one caught error. */
  function errorText(error: unknown): string {
    if (error instanceof GardenApiError) {
      return translateError(error.code === "SOCKET" ? "NETWORK" : error.code);
    }
    return translateError("UNKNOWN");
  }

  /** @brief Applies one caught error to the status line. */
  function applyApiError(error: unknown): void {
    offline = error instanceof GardenApiError && error.code === "NETWORK";
    if (error instanceof GardenApiError && error.code === "STALE_REV") {
      message = { text: translateError("STALE_REV"), kind: "err" };
      void refresh();
      return;
    }
    if (error instanceof GardenApiError && error.code === "UNAUTHORIZED") api.forget();
    message = { text: errorText(error), kind: "err" };
  }

  // ------------------------------------------------------------- data loading

  /** @brief Loads the owner garden, registering on a fresh browser. */
  async function loadOwner(): Promise<void> {
    if (api.hasSession()) {
      try {
        const result = await api.state();
        state = result.state;
        season = result.season;
        if (state.nick !== localIdentity.nick || state.color !== localIdentity.color) {
          const renamed = await api.rename(localIdentity.nick, localIdentity.color);
          state = renamed.state;
          season = renamed.season;
        }
        return;
      } catch (error) {
        if (!(error instanceof GardenApiError) || error.code !== "UNAUTHORIZED") throw error;
        api.forget();
      }
    }
    const bundle = await api.register();
    state = bundle.state;
    season = bundle.season;
    message = { text: t("garden.recoveryOnce"), kind: "info" };
  }

  /** @brief Loads the document for the current mode. */
  async function bootstrap(): Promise<void> {
    if (disposed) return;
    loading = true;
    offline = false;
    message = null;
    selectedSlot = null;
    page = 0;
    pendingPage = null;
    pendingSelection = null;
    readGardenQuery();
    uprootArmed = false;
    render();
    try {
      if (visitCode !== null) {
        mode = "visit";
        tab = "garden";
        rebornTab = "garden";
        gardenTab = "main";
        townNpc = null;
        townBoard = null;
        const bundle = await api.visit(visitCode);
        visiting = bundle.garden;
        season = bundle.season;
        state = null;
      } else {
        mode = "owner";
        visiting = null;
        await loadOwner();
        if (view === "reborn" && (rebornTab === "dynopedia" || gardenTab === "kitchen")) {
          void loadGlobalRecipes();
        }
        if (view === "reborn" && rebornTab === "dynopedia") {
          void loadGlobalHybrids();
        }
      }
      if (disposed) return;
      offline = false;
      applyPendingView();
      syncGardenQuery();
    } catch (error) {
      if (disposed) return;
      applyApiError(error);
    }
    loading = false;
    render();
    // A saved selection (URL gslot) reopens the context menu on the same cell.
    if (selectedSlot !== null && menu === null) {
      const cell = root?.querySelector<HTMLElement>(
        `.garden-cell[data-area="${selectedArea}"][data-slot="${selectedSlot}"]`,
      );
      const rect = cell?.getBoundingClientRect();
      openMenu(
        selectedSlot,
        selectedArea,
        (rect?.left ?? 24) + 6,
        (rect?.bottom ?? 120) + 2,
        rect?.top ?? 60,
      );
    }
  }

  /** @brief Refreshes season and snapshot from the server. */
  async function refresh(): Promise<void> {
    if (disposed || busy || refreshing) return;
    refreshing = true;
    try {
      if (mode === "visit" && visitCode !== null) {
        const bundle = await api.visit(visitCode);
        visiting = bundle.garden;
        season = bundle.season;
      } else if (state !== null) {
        const result = await api.state();
        state = result.state;
        season = result.season;
      }
      offline = false;
    } catch (error) {
      offline = error instanceof GardenApiError && error.code === "NETWORK";
      if (!offline) message = { text: errorText(error), kind: "err" };
    } finally {
      refreshing = false;
    }
    if (!disposed) render();
  }

  /** @brief Loads the leaderboard for the event tab. */
  async function loadLeaderboard(force = false): Promise<void> {
    if (disposed || leaderboardBusy) return;
    if (!force && leaderboardAt !== 0 && Date.now() - leaderboardAt < DATA_TTL_MS) return;
    leaderboardBusy = true;
    try {
      leaderboard = await api.leaderboard(100);
      leaderboardAt = Date.now();
    } catch {
      // A missing leaderboard never blocks the garden itself.
      leaderboardAt = 0;
    } finally {
      leaderboardBusy = false;
    }
    if (!disposed && (tab === "event" || tab === "rank" || rebornTab === "townhall")) render();
  }

  // ---------------------------------------------------------------- mutations

  /** @brief Runs one owner action and reports the outcome. */
  async function runAction(action: GardenAction, successText: string): Promise<void> {
    if (state === null || busy) return;
    busy = true;
    try {
      const result = await api.act(state.rev, action);
      state = result.state;
      season = result.season;
      offline = false;
      if (action.kind === "breedHybrid" && result.state.lastHybridId !== undefined) {
        nurseryPopover = result.state.lastHybridId;
        const created = result.state.hybrids?.find((entry) => entry.id === nurseryPopover);
        hybridRenameDraft = created?.name ?? "";
        nurseryParents = [];
      }
      if (action.kind === "renameHybrid") {
        nurseryPopover = null;
      }
      message = { text: successText, kind: "ok" };
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /**
   * @brief Plants one seed into a greenhouse plot, buying from the seasonal shop if needed.
   * @param slot Target greenhouse slot index (0..80).
   * @param seedId Standard or custom hybrid seed identifier.
   */
  async function plantGreenhouseSeed(slot: number, seedId: AnySeedId): Promise<void> {
    if (state === null || busy) return;
    busy = true;
    try {
      let current = state;
      const owned = current.bag.seeds[seedId] ?? 0;
      if (owned < 1) {
        if (isHybridId(seedId)) throw new GardenApiError("NO_SEEDS", 0);
        const offer = season?.shop.offers.find((entry) => entry.seed === seedId);
        if (offer === undefined) throw new GardenApiError("SHOP_SOLD_OUT", 0);
        const bought = await api.act(current.rev, { kind: "buySeed", seed: seedId, qty: 1 });
        current = bought.state;
        season = bought.season;
      }
      const planted = await api.act(current.rev, { kind: "plantGreenhouse", slot, seed: seedId });
      state = planted.state;
      season = planted.season;
      offline = false;
      greenhousePicker = null;
      message = { text: t("greenhouse.planted"), kind: "ok" };
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Plants one seed, buying it first when the bag is empty. */
  async function plantSeed(slot: number, seedId: AnySeedId): Promise<void> {
    if (state === null || busy) return;
    busy = true;
    try {
      let current = state;
      const owned = current.bag.seeds[seedId] ?? 0;
      if (owned < 1) {
        if (isHybridId(seedId)) throw new GardenApiError("NO_SEEDS", 0);
        const offer = season?.shop.offers.find((entry) => entry.seed === seedId);
        if (offer === undefined) throw new GardenApiError("SHOP_SOLD_OUT", 0);
        const bought = await api.act(current.rev, { kind: "buySeed", seed: seedId, qty: 1 });
        current = bought.state;
        season = bought.season;
      }
      const planted = await api.act(current.rev, { kind: "plant", slot, seed: seedId });
      state = planted.state;
      season = planted.season;
      offline = false;
      message = { text: t("garden.planted", { seed: seedName(seedId) }), kind: "ok" };
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Harvests one ripe crop or picks one tree fruit. */
  function harvest(slot: number, area: "crop" | "tree"): void {
    if (state === null || season === null) return;
    if (area === "tree") {
      const tree = treeAt(slot);
      if (tree === null) return;
      if (now() < tree.readyAt) {
        message = { text: translateError("NOT_READY"), kind: "err" };
        render();
        return;
      }
      const gain = cropSellPrice(
        { item: tree.tree, effects: resolvedTreeEffects(tree, now()), qty: 1 },
        season,
      );
      void runAction(
        { kind: "harvest", slot, tree: true },
        t("garden.harvestedTree", { tree: itemName(tree.tree), coins: gain }),
      );
      return;
    }
    const plot = plotAt(slot);
    if (plot === null) return;
    const view = plotView(plot, now(), activeHybrids());
    if (!view.ready) {
      message = { text: translateError("NOT_READY"), kind: "err" };
      render();
      return;
    }
    const gain = cropSellPrice(
      { item: plot.seed, effects: resolvedCropEffects(plot, now()), qty: 1 },
      season,
      activeHybrids(),
    );
    void runAction(
      { kind: "harvest", slot, tree: false },
      t("garden.harvested", { seed: itemName(plot.seed), coins: gain }),
    );
  }

  /** @brief Waters the selected growing crop or tree. */
  function waterSelected(slot: number, area: "crop" | "tree"): void {
    if (area === "tree") {
      const tree = treeAt(slot);
      if (tree === null) return;
      void runAction(
        { kind: "water", slot, tree: true },
        t("garden.wateredTree", { tree: itemName(tree.tree) }),
      );
      return;
    }
    const plot = plotAt(slot);
    if (plot === null) return;
    void runAction({ kind: "water", slot, tree: false }, t("garden.watered", { seed: itemName(plot.seed) }));
  }

  /** @brief Applies one owned fertilizer to the selected plant. */
  function applySupply(
    kind: "fertilize" | "spray",
    supply: SupplyId,
    slot: number | null = selectedSlot,
    area: "crop" | "tree" = selectedArea,
  ): void {
    if (slot === null) return;
    const tree = area === "tree";
    supplyPicker = null;
    const action: GardenAction =
      kind === "fertilize"
        ? { kind, slot, tree, supply: supply as FertilizerId }
        : { kind: "spray", slot, tree, supply: supply as SprayId };
    const name = t(`supplies.${supply}`);
    void runAction(
      action,
      t(kind === "fertilize" ? "garden.fertilized" : "garden.sprayed", { supply: name }),
    );
  }

  /** @brief Buys one fertilizer or spray. */
  function buySupply(supply: SupplyId): void {
    if (state === null || season === null) return;
    const definition = [...FERTILIZERS, ...SPRAYS].find((entry) => entry.id === supply);
    if (definition === undefined) return;
    const qty = buyQty;
    void runAction(
      { kind: "buySupply", supply, qty },
      t("garden.boughtSupply", { supply: t(`supplies.${supply}`) }),
    );
  }

  /** @brief Plants one fruit tree sapling. */
  async function plantTree(slot: number, treeId: TreeId): Promise<void> {
    if (state === null || busy || mode !== "owner") return;
    const definition = treeById(treeId);
    if (definition === undefined || state.coins < definition.buy) return;
    busy = true;
    try {
      const result = await api.act(state.rev, { kind: "plantTree", slot, tree: treeId });
      state = result.state;
      season = result.season;
      offline = false;
      message = { text: t("garden.plantedTree", { tree: itemName(treeId) }), kind: "ok" };
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Removes the selected plant after a two-step confirmation. */
  function uproot(slot: number, area: "crop" | "tree"): void {
    if (!uprootArmed) {
      uprootArmed = true;
      message = { text: t("garden.uprootConfirm"), kind: "info" };
      if (uprootTimer !== null) clearTimeout(uprootTimer);
      uprootTimer = setTimeout(() => {
        uprootTimer = null;
        uprootArmed = false;
        if (!disposed) render();
      }, UPROOT_ARM_MS);
      render();
      return;
    }
    uprootArmed = false;
    const local = plotLabel(slot, area).plot;
    void runAction(
      { kind: "uproot", slot, tree: area === "tree" },
      area === "tree" ? t("garden.uprootedTree", { slot: local }) : t("garden.uprooted", { slot: local }),
    );
  }

  /** @brief Buys one seed from the current shop rotation. */
  function buySeed(seedId: SeedId): void {
    if (state === null || season === null) return;
    const offer = season.shop.offers.find((entry) => entry.seed === seedId);
    // The shop stock caps one order; the wallet is validated by the server so a
    // short balance reports an error instead of silently buying fewer seeds.
    const stock = offer?.stock ?? 1;
    const qty = Math.max(1, Math.min(buyQty, stock));
    void runAction(
      { kind: "buySeed", seed: seedId, qty },
      t("market.bought", { qty, seed: seedName(seedId) }),
    );
  }

  /** @brief Whether two mutation lists describe the same stack. */
  function sameEffectSet(left: readonly EffectId[], right: readonly EffectId[]): boolean {
    const a = [...left].sort().join(":");
    const b = [...right].sort().join(":");
    return a === b;
  }

  /** @brief Sells one harvested stack. */
  function sellStack(item: AnyItemId, effects: readonly EffectId[], pest = false, star = 1): void {
    if (state === null || season === null) return;
    const stack = state.bag.crops.find(
      (entry) =>
        entry.item === item &&
        sameEffectSet(entry.effects, effects) &&
        (entry.pest === true) === pest &&
        (entry.star ?? 1) === star,
    );
    if (stack === undefined) return;
    const gross = cropSellPrice(stack, season, activeHybrids()) * stack.qty;
    // The server keeps 10% of every sale; show the amount actually received.
    const gain = gross - Math.round(gross * 0.1);
    void runAction(
      {
        kind: "sellCrop",
        item,
        effects: stack.effects,
        pest: stack.pest === true,
        star: stack.star ?? 1,
        qty: stack.qty,
      },
      t("market.sold", { seed: itemName(item), coins: gain }),
    );
  }

  /** @brief Opens the sell-all confirmation with the pending amount. */
  function sellAll(): void {
    if (state === null || season === null || state.bag.crops.length === 0) return;
    const total = state.bag.crops.reduce(
      (sum, stack) => sum + cropSellPrice(stack, season as SeasonSnapshot, activeHybrids()) * stack.qty,
      0,
    );
    sellAllDialog = {
      gross: total,
      net: total - Math.round(total * 0.1),
      stacks: state.bag.crops.length,
      qty: state.bag.crops.reduce((sum, stack) => sum + stack.qty, 0),
    };
    render();
  }

  /** @brief Confirms the pending sell-all and closes the dialog. */
  function confirmSellAll(): void {
    const dialog = sellAllDialog;
    sellAllDialog = null;
    if (dialog === null) return;
    void runAction({ kind: "sellAll" }, t("market.sellAllValue", { coins: formatCompact(dialog.gross) }));
  }

  /** @brief Registers a visitor identity the first time a friend action runs. */
  async function ensureVisitorSession(): Promise<void> {
    if (api.hasSession()) return;
    const bundle = await api.register();
    state = bundle.state;
    season = bundle.season;
  }

  /** @brief Waters one crop or tree on a friend's garden. */
  async function waterFriend(slot: number, area: "crop" | "tree"): Promise<void> {
    if (visiting === null || visitCode === null || busy) return;
    busy = true;
    try {
      await ensureVisitorSession();
      const bundle = await api.waterVisit(visitCode, slot, area === "tree");
      visiting = bundle.garden;
      season = bundle.season;
      offline = false;
      message = { text: t("garden.waterSent", { nick: visiting.nick }), kind: "ok" };
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Leaves one cheer on the visited garden. */
  async function cheerHost(): Promise<void> {
    if (visiting === null || visitCode === null || busy) return;
    busy = true;
    try {
      await ensureVisitorSession();
      const bundle = await api.cheerVisit(visitCode);
      visiting = bundle.garden;
      season = bundle.season;
      offline = false;
      message = { text: t("garden.cheered", { nick: visiting.nick }), kind: "ok" };
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Restores the garden behind the typed recovery key. */
  async function restoreGarden(): Promise<void> {
    const key = restoreDraft.trim().toUpperCase();
    if (key.length === 0 || busy) return;
    busy = true;
    try {
      const bundle = await api.restore(key);
      state = bundle.state;
      season = bundle.season;
      mode = "owner";
      visiting = null;
      visitCode = null;
      selectedSlot = null;
      restoreDraft = "";
      offline = false;
      message = { text: t("garden.restoreOk"), kind: "ok" };
      if (typeof history !== "undefined")
        history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /**
   * @brief Applies an authenticated Cloudflare account bundle onto the active garden session.
   * @param bundle Response payload returned by register, login, or link endpoints.
   * @param okKey Localized success message key.
   */
  function applyAccountBundle(
    bundle: {
      username: string;
      state?: GardenSnapshot;
      season?: SeasonSnapshot;
    },
    okKey: string,
  ): void {
    linkedAccountUsername = bundle.username;
    if (bundle.state !== undefined && bundle.season !== undefined) {
      state = bundle.state;
      season = bundle.season;
      mode = "owner";
      visiting = null;
      visitCode = null;
      selectedSlot = null;
      offline = false;
    }
    accountPassDraft = "";
    accountRecoveryDraft = "";
    message = { text: t(okKey), kind: "ok" };
  }

  /** @brief Registers a Cloudflare account without email verification and links the current or recovered garden. */
  async function submitAccountRegister(): Promise<void> {
    const username = accountUserDraft.trim();
    const password = accountPassDraft;
    if (username.length === 0 || password.length === 0 || busy) return;
    busy = true;
    try {
      const typedRec = accountRecoveryDraft.trim().toUpperCase();
      const autoRec = typedRec.length > 0 ? typedRec : api.session?.recovery;
      const bundle = await api.accountRegister(username, password, autoRec);
      applyAccountBundle(bundle, "account.registerOk");
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Signs into a Cloudflare account and syncs its linked garden to this device. */
  async function submitAccountLogin(): Promise<void> {
    const username = accountUserDraft.trim();
    const password = accountPassDraft;
    if (username.length === 0 || password.length === 0 || busy) return;
    busy = true;
    try {
      const rec = accountRecoveryDraft.trim().toUpperCase();
      const bundle = await api.accountLogin(username, password, rec.length > 0 ? rec : undefined);
      applyAccountBundle(bundle, "account.loginOk");
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Links the active Cloudflare account (or Cloudflare Access user) to the current or recovered garden. */
  async function submitAccountLink(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const rec = accountRecoveryDraft.trim().toUpperCase();
      const bundle = await api.accountLink(rec.length > 0 ? rec : undefined);
      applyAccountBundle(bundle, "account.linkOk");
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Clears the Cloudflare account session on this device only. */
  function logoutAccountLocal(): void {
    api.logoutAccount();
    linkedAccountUsername = null;
    accountPassDraft = "";
    message = { text: t("account.logoutOk"), kind: "ok" };
    render();
  }

  /** @brief Mints a new recovery key and shows it once. */
  async function rotateRecovery(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const recovery = await api.rotateRecovery();
      message = { text: t("garden.recoveryNew", { code: recovery }), kind: "ok" };
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Copies the shareable garden link. */
  async function shareGarden(): Promise<void> {
    const code = currentCode();
    if (code === null) return;
    const link = `${location.origin}${location.pathname}#garden=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      message = { text: t("garden.linkCopied"), kind: "ok" };
    } catch {
      message = { text: link, kind: "info" };
    }
    render();
  }

  /** @brief Opens a friend garden from a code. */
  function openVisit(code: string): void {
    visitCode = code;
    mode = "visit";
    visiting = null;
    state = null;
    selectedSlot = null;
    page = 0;
    restoreDraft = "";
    tab = "garden";
    rebornTab = "garden";
    gardenTab = "main";
    townNpc = null;
    townBoard = null;
    syncGardenQuery();
    if (typeof history !== "undefined") {
      history.replaceState(null, "", `${location.pathname}${location.search}#garden=${code}`);
    }
    void bootstrap();
  }

  /** @brief Returns from a visit to the owner garden. */
  function backHome(): void {
    visitCode = null;
    mode = "owner";
    visiting = null;
    selectedSlot = null;
    page = 0;
    tab = "garden";
    rebornTab = "garden";
    gardenTab = "main";
    townNpc = null;
    townBoard = null;
    syncGardenQuery();
    if (typeof history !== "undefined") {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    void bootstrap();
  }

  // ------------------------------------------------------------------- render

  /** @brief Switches the visible view. */
  function switchView(next: GardenView): void {
    if (view === next) return;
    view = next;
    selectedSlot = null;
    menu = null;
    uprootArmed = false;
    farmPicker = null;
    animalMenu = null;
    moveSource = null;
    machineMenu = null;
    specialPicker = null;
    if (next === "legacy") loadTabData(tab);
    if (next === "reborn" && (rebornTab === "event" || rebornTab === "weather")) {
      void loadRaid();
    }
    if (next !== "reborn") {
      townNpc = null;
      townBoard = null;
      staffPanel = null;
      quickPlanPreview = null;
      quickMenu = null;
    }
    syncGardenQuery();
    render();
  }

  /** @brief Fetches the slow data one legacy tab needs on first open. */
  function loadTabData(next: Tab): void {
    if (next === "chart") void loadChart();
    if (next === "bots") void loadBots();
    if (next === "rank") void loadLeaderboard();
    if (next === "extras") {
      void loadExtras();
      void loadGuilds();
    }
    if (next === "log") void loadGlobalSales();
    if (next === "dynopedia") {
      void loadGlobalRecipes();
      void loadGlobalHybrids();
    }
    if (next === "event") void loadRaid();
  }

  /** @brief Switches the active tab. */
  function switchTab(next: Tab): void {
    if (tab === next) return;
    tab = next;
    selectedSlot = null;
    menu = null;
    uprootArmed = false;
    farmPicker = null;
    animalMenu = null;
    moveSource = null;
    machineMenu = null;
    specialPicker = null;
    loadTabData(next);
    syncGardenQuery();
    render();
  }

  /** @brief Writes the garden view state into the URL query. */
  function syncGardenQuery(): void {
    writeParams({
      gtab: tab,
      gview: view === "legacy" ? null : view,
      grtab:
        view === "reborn" &&
        (rebornTab === "townhall" ||
          rebornTab === "weather" ||
          rebornTab === "event" ||
          rebornTab === "dynopedia" ||
          rebornTab === "log" ||
          rebornTab === "levels" ||
          rebornTab === "restore")
          ? rebornTab
          : null,
      gstab: view === "reborn" && rebornTab === "garden" && gardenTab !== "main" ? gardenTab : null,
      gpage: page > 0 ? String(page) : null,
      garea: selectedSlot === null ? null : selectedArea,
      gslot: selectedSlot === null ? null : String(selectedSlot),
    });
  }

  /** @brief Restores tab, view, page and selection saved in the URL. */
  function readGardenQuery(): void {
    const savedView = readParam("gview");
    // An old ?gview=townhall bookmark now lands on reborn, which hosts the town.
    if (savedView === "reborn" || savedView === "townhall") view = "reborn";
    const savedRebornTab = readParam("grtab");
    if (
      visitCode === null &&
      (savedRebornTab === "townhall" ||
        savedRebornTab === "weather" ||
        savedRebornTab === "event" ||
        savedRebornTab === "dynopedia" ||
        savedRebornTab === "log" ||
        savedRebornTab === "levels" ||
        savedRebornTab === "restore")
    ) {
      rebornTab = savedRebornTab;
    }
    const savedGardenTab = readParam("gstab");
    if (
      visitCode === null &&
      (savedGardenTab === "mushroom" ||
        savedGardenTab === "greenhouse" ||
        savedGardenTab === "nursery" ||
        savedGardenTab === "barn" ||
        savedGardenTab === "coop" ||
        savedGardenTab === "pond" ||
        savedGardenTab === "warehouse" ||
        savedGardenTab === "kitchen" ||
        savedGardenTab === "mine" ||
        savedGardenTab === "shipping" ||
        savedGardenTab === "prestige")
    ) {
      gardenTab = savedGardenTab;
    }
    const savedTab = readParam("gtab");
    if (
      savedTab === "garden" ||
      savedTab === "market" ||
      savedTab === "event" ||
      savedTab === "chart" ||
      savedTab === "bots" ||
      savedTab === "rank" ||
      savedTab === "farm" ||
      savedTab === "warehouse" ||
      savedTab === "extras" ||
      savedTab === "prestige" ||
      savedTab === "dynopedia" ||
      savedTab === "log" ||
      savedTab === "levels"
    ) {
      tab = savedTab;
    }
    const rawPage = readParam("gpage");
    const savedPage = rawPage === null ? Number.NaN : Number(rawPage);
    pendingPage = Number.isInteger(savedPage) && savedPage > 0 ? savedPage : null;
    const savedArea = readParam("garea") === "tree" ? "tree" : "crop";
    const rawSlot = readParam("gslot");
    const savedSlot = rawSlot === null ? Number.NaN : Number(rawSlot);
    pendingSelection =
      Number.isInteger(savedSlot) && savedSlot >= 0 ? { area: savedArea, slot: savedSlot } : null;
  }

  /** @brief Applies the URL selection once a snapshot is available. */
  function applyPendingView(): void {
    if (pendingPage !== null) {
      page = Math.min(pendingPage, pageCount() - 1);
      pendingPage = null;
    }
    if (pendingSelection !== null) {
      const slots = pendingSelection.area === "tree" ? currentTrees() : currentPlots();
      if (slots !== null && pendingSelection.slot < slots.length) {
        selectedSlot = pendingSelection.slot;
        selectedArea = pendingSelection.area;
      }
      pendingSelection = null;
    }
  }

  /** @brief Patch and plot numbers of one slot inside the current tab. */
  function plotLabel(slot: number, area: "crop" | "tree"): { patch: number; plot: number } {
    const offset = area === "crop" ? cropOffset() : treeOffset();
    const local = Math.max(0, slot - offset);
    return { patch: Math.floor(local / PLOTS_PER_PATCH) + 1, plot: (local % PLOTS_PER_PATCH) + 1 };
  }

  /**
   * @brief Opens the context menu for one cell.
   * @param slot Absolute slot index.
   * @param area Which grid it belongs to.
   * @param x Viewport x of the pointer.
   * @param y Viewport y of the pointer.
   */
  function openMenu(slot: number, area: "crop" | "tree", x: number, y: number, anchorTop = y): void {
    selectedSlot = slot;
    selectedArea = area;
    supplyPicker = null;
    uprootArmed = false;
    moveSource = null;
    machineMenu = null;
    menu = { area, slot, x, y, anchorTop, view: "actions" };
    syncGardenQuery();
    render();
  }

  /** @brief Closes the context menu and drops the selection. */
  function closeMenu(): void {
    if (menu === null) return;
    menu = null;
    selectedSlot = null;
    supplyPicker = null;
    uprootArmed = false;
    syncGardenQuery();
    render();
  }

  /** @brief Opens the staff popover for one slot (or the empty slot market). */
  function openStaffMenu(index: number | null | "list", x: number, y: number, anchorTop = y): void {
    closeMenu();
    staffMenu = { index, x, y, anchorTop };
    render();
  }

  /** @brief Closes the staff popover. */
  function closeStaffMenu(): void {
    if (staffMenu === null) return;
    staffMenu = null;
    render();
  }

  /** @brief Localized wait between two finished tasks for one worker. */
  function staffIntervalText(worker: {
    readonly speed: number;
    readonly skill: number;
    readonly level: number;
    readonly traits: readonly StaffTrait[];
  }): string {
    const intervalMs = staffWorkIntervalMs(worker);
    return t("staff.interval", { minutes: Math.round(intervalMs / 60_000) });
  }

  /** @brief Builds the staff popover with role actions or hire candidates. */
  function buildStaffMenu(): HTMLElement | null {
    if (staffMenu === null || state === null) return null;
    const wrap = div("garden-menu garden-staff-menu");
    wrap.append(span("garden-menu-title", t("staff.title")));
    const worker = typeof staffMenu.index === "number" ? state.extras.staff[staffMenu.index] : null;
    if (staffMenu.index === "list") {
      wrap.append(lineBlock(`// ${t("staff.roster")} ${state.extras.staff.length}/${STAFF_SLOTS}`));
      state.extras.staff.forEach((entry, index) => {
        wrap.append(
          menuRow(
            `${entry.name} · ${t("staff.level")} ${entry.level} · ${t(`staffRole.${entry.role}`)}`,
            "staffMenuSelect",
            { data: { index: String(index) } },
          ),
        );
      });
      wrap.append(menuRow(t("staff.openMarket"), "staffMenuMarket"));
      wrap.append(menuRow(t("common.close"), "staffMenuClose"));
    } else if (staffMenu.index === null || worker === null || worker === undefined) {
      wrap.append(lineBlock(`// ${t("staff.market")}`));
      for (const candidate of staffMarketAt(state.playerId, now())) {
        const traits = candidate.traits.map((trait) => t(`staffTrait.${trait}`)).join(", ");
        const row = menuRow(
          `${candidate.name} · ${candidate.speed}⚡ · ${candidate.skill}✦ · ${candidate.wage}c · ${traits} · ${formatCompact(staffHireCost(candidate))}c`,
          "staffMenuHire",
          { data: { id: candidate.id } },
        );
        row.disabled = state.extras.staff.length >= STAFF_SLOTS;
        wrap.append(row);
      }
      wrap.append(menuRow(t("staff.openMarket"), "staffMenuMarket"));
      wrap.append(menuRow(t("common.close"), "staffMenuClose"));
    } else {
      const traits = worker.traits.map((trait) => t(`staffTrait.${trait}`)).join(", ");
      wrap.append(lineBlock(`${worker.name} · ${worker.wage}c`));
      wrap.append(
        lineBlock(
          `// ${t("staff.level")} ${worker.level} · ${worker.xp}/${staffXpToLevel(worker.level)} XP · ${staffIntervalText(worker)}`,
        ),
      );
      wrap.append(lineBlock(`// ${t("staff.formula")}`));
      wrap.append(lineBlock(`// ${traits}`));
      wrap.append(menuRow(t("staff.fire"), "staffMenuFire", { data: { index: String(staffMenu.index) } }));
      wrap.append(menuRow(t("common.close"), "staffMenuClose"));
    }
    return wrap;
  }

  /** @brief Opens the animal stats popover for one building slot. */
  function openAnimalMenu(building: BuildingId, slot: number, x: number, y: number, anchorTop = y): void {
    closeMenu();
    machineMenu = null;
    farmPicker = null;
    animalMenu = { building, slot, x, y, anchorTop };
    render();
  }

  /** @brief Closes the animal popover. */
  function closeAnimalMenu(): void {
    if (animalMenu === null) return;
    animalMenu = null;
    render();
  }

  /**
   * @brief Builds the animal popover: stats, then the actions that apply.
   * @param at Server-clock time used for the age, stars and countdown.
   * @details Mirrors the crop context menu: a `pre` block with the numbers and
   * a row of actions below it, anchored to the clicked cell.
   */
  function buildAnimalMenu(at: number): HTMLElement | null {
    if (animalMenu === null || state === null) return null;
    const animals = state.animals[animalMenu.building] ?? [];
    const animal = animals[animalMenu.slot] ?? null;
    if (animal === null) return null;

    const wrap = div("garden-menu garden-animal-menu");
    const head = div("garden-menu-head");
    const displayName = animal.hybridName ?? t(`animals.${animal.kind}`);
    const locationText =
      animalMenu.building === "pond"
        ? `${t("farm.pondBasin", { index: pondBasinIndex(animalMenu.slot) + 1 })} · ${t("farm.slots")} ${pondBasinSlot(animalMenu.slot) + 1}`
        : `${t(`farm.${animalMenu.building}`)} · ${t("farm.slots")} ${animalMenu.slot + 1}`;
    head.append(span("garden-menu-title", `${displayName} · ${locationText}`));
    const coins = state.coins;
    const balanceChip = span("garden-menu-balance", `$ ${formatCompact(coins)}c`);
    balanceChip.title = `${formatNumber(coins)} coins`;
    head.append(balanceChip);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "garden-menu-close";
    close.dataset.act = "animalMenuClose";
    close.textContent = "×";
    close.setAttribute("aria-label", t("common.close"));
    head.append(close);
    wrap.append(head);

    const stars = animalQuality(animal, at);
    const definition = animalById(animal.kind);
    const readyAt = animal.lastProduceAt + animalIntervalMs(animal.kind);
    const incubation = animal.incubatingUntil ?? 0;
    const meat = animalMeatPrice(animal.kind, stars, state.pondGrowth ?? 0, animal.hybridPrice);
    const lines = [
      `// ${t("farm.stats")}`,
      labelValue(t("farm.quality"), `${"*".repeat(stars)} ${stars}/5`),
      labelValue(t("farm.mutations"), effectListText(animal.effects ?? [])),
      labelValue(
        t("farm.pats"),
        `${animal.pats} · ${t("farm.age")} ${formatDuration(Math.max(0, at - animal.bornAt))}`,
      ),
    ];
    if (animal.hybridParents !== undefined && animal.hybridParents.length >= 2) {
      const parentNameA = t(`animals.${animal.hybridParents[0]}`) || animal.hybridParents[0];
      const parentNameB = t(`animals.${animal.hybridParents[1]}`) || animal.hybridParents[1];
      lines.push(labelValue(t("dynopedia.parents"), `${parentNameA} × ${parentNameB}`));
    }
    if (animal.hybridTier !== undefined) {
      lines.push(
        labelValue(
          "Tier",
          animal.hybridTier === "superior" ? t("dynopedia.superior") : t("dynopedia.inferior"),
        ),
      );
    }
    if (animal.hybridLore !== undefined && animal.hybridLore.length > 0) {
      lines.push(labelValue("Lore", animal.hybridLore));
    }
    if (definition !== undefined) {
      lines.push(labelValue(t("farm.product"), t(`products.${definition.product}`)));
      lines.push(
        labelValue(
          t("farm.next"),
          incubation > 0 ? t("farm.breeding") : formatDuration(Math.max(0, readyAt - at), "short"),
        ),
      );
      lines.push(labelValue(t("farm.upkeep"), `${formatCompact(definition.upkeep)}c/${t("farm.cycle")}`));
    }
    if (animalMenu.building === "pond") {
      lines.push(labelValue(t("farm.growth"), `${state.pondGrowth ?? 0}%`));
    }
    if (incubation > 0) {
      lines.push(
        labelValue(
          t("farm.breeding"),
          at >= incubation ? t("farm.hatchReady") : formatDuration(incubation - at),
        ),
      );
    }
    if (animal.genes !== undefined) {
      lines.push(
        labelValue(
          t("farm.genes"),
          `Y${animal.genes.yield} · S${animal.genes.speed} · M${animal.genes.mutation}`,
        ),
      );
    }
    lines.push("", labelValue(t("farm.meat"), `${formatCompact(meat)}c`));
    if (animalMenu.building === "pond") {
      const basinIndex = pondBasinIndex(animalMenu.slot);
      const basin = inspectPondBasin(animals, basinIndex);
      lines.push(
        "",
        labelValue(t("farm.pondBasin", { index: basinIndex + 1 }), `${basin.fish.length}/${POND_MAX_SLOTS}`),
        labelValue(
          t("farm.pondBasinMode"),
          basin.isPurebred
            ? t("farm.pondModePure", { species: t(`animals.${basin.species[0] ?? "fish"}`) })
            : basin.fish.length >= 2
              ? t("farm.pondModeHybrid")
              : t("farm.pondModeIdle"),
        ),
        labelValue(t("farm.pondBreedStatus"), t("farm.pondAutoBreed")),
      );
    }
    const info = document.createElement("pre");
    info.className = "garden-menu-info";
    info.textContent = lines.join("\n");
    wrap.append(info);

    const rows = div("garden-menu-rows");
    rows.append(menuRow(t("farm.pat"), "animalMenuPat"));
    if (animalMenu.building === "coop" && definition !== undefined) {
      const egg = breedEggProduct(animal.kind);
      const eggs =
        egg === null
          ? 0
          : (state.bag.products ?? [])
              .filter((stack) => stack.product === egg)
              .reduce((sum, stack) => sum + stack.qty, 0);
      const free = animals.some((entry) => entry === null);
      rows.append(
        menuRow(
          t("farm.breed", { cost: formatDuration(BREED_CYCLES * FARM_CYCLE_MS, "short") }),
          "animalMenuBreed",
          {
            disabled: incubation > 0 || eggs < 1 || !free,
          },
        ),
      );
    }
    rows.append(
      menuRow(t("farm.sellAnimal", { price: `${formatCompact(meat)}c` }), "animalMenuSell", {
        disabled: incubation > 0,
      }),
    );
    rows.append(menuRow(t("common.close"), "animalMenuClose"));
    wrap.append(rows);
    return wrap;
  }

  /** @brief Keeps the animal popover inside the viewport. */
  function fitAnimalMenu(): void {
    if (root === null || animalMenu === null) return;
    const element = root.querySelector<HTMLElement>(".garden-animal-menu");
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, animalMenu.x),
      Math.max(margin, window.innerWidth - rect.width - margin),
    );
    let top = animalMenu.y;
    if (top + rect.height > window.innerHeight - margin) {
      top = animalMenu.anchorTop - rect.height - 4;
    }
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  /** @brief Keeps the open menu inside the viewport, flipping it above the cell. */
  function fitMenu(): void {
    if (root === null || menu === null) return;
    const element = root.querySelector<HTMLElement>(".garden-menu");
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, menu.x),
      Math.max(margin, window.innerWidth - rect.width - margin),
    );
    let top = menu.y;
    if (top + rect.height > window.innerHeight - margin) {
      top = menu.anchorTop - rect.height - 4;
    }
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  /** @brief Keeps the staff popover inside the viewport. */
  function fitStaffMenu(): void {
    if (root === null || staffMenu === null) return;
    const element = root.querySelector<HTMLElement>(".garden-staff-menu");
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, staffMenu.x),
      Math.max(margin, window.innerWidth - rect.width - margin),
    );
    let top = staffMenu.y;
    if (top + rect.height > window.innerHeight - margin) {
      top = staffMenu.anchorTop - rect.height - 4;
    }
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  /** @brief Switches the open context menu to another submenu. */
  function menuView(view: MenuState["view"]): void {
    if (menu === null) return;
    menu = { ...menu, view };
    render();
  }

  /** @brief Selects one owned crop or tree slot and shows its detail panel. */
  function selectSlot(slot: number, area: "crop" | "tree"): void {
    const slots = area === "tree" ? currentTrees() : currentPlots();
    if (slots === null || slot < 0 || slot >= slots.length) return;
    selectedSlot = slot;
    selectedArea = area;
    supplyPicker = null;
    uprootArmed = false;
    syncGardenQuery();
    render();
  }

  /**
   * @brief Flips the garden page.
   * @param delta `-1` previous page, `1` next page.
   */
  function goPage(delta: number): void {
    const next = Math.min(pageCount() - 1, Math.max(0, page + delta));
    if (next === page) return;
    page = next;
    selectedSlot = null;
    menu = null;
    supplyPicker = null;
    uprootArmed = false;
    syncGardenQuery();
    render();
  }

  /** @brief Buys the next tab and flips to it. */
  async function buyTab(): Promise<void> {
    if (state === null || busy || mode !== "owner") return;
    const cost = nextTabCost();
    if (cost === null) return;
    busy = true;
    try {
      const result = await api.act(state.rev, { kind: "buyTab" });
      state = result.state;
      season = result.season;
      offline = false;
      page = state.tabs - 1;
      selectedSlot = null;
      syncGardenQuery();
      message = { text: t("garden.tabBought", { tab: state.tabs }), kind: "ok" };
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Builds the view strip with the garden code and share action. */
  function buildTabs(): HTMLElement {
    const bar = div("garden-tabs");
    for (const entry of VIEWS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "garden-view-tab";
      button.dataset.act = `view:${entry.id}`;
      const label = t(entry.labelKey);
      button.textContent = view === entry.id ? `[ ${label} ]` : ` ${label} `;
      if (view === entry.id) {
        button.classList.add("is-active");
        button.setAttribute("aria-current", "page");
      }
      bar.append(button);
    }
    bar.append(span("garden-tabs-spacer", ""));
    const balance = mode === "visit" ? visiting?.coins : state?.coins;
    if (balance !== undefined) {
      const chip = span("garden-balance", `$ ${formatCompact(balance)}c`);
      chip.title = `${formatNumber(balance)} coins`;
      chip.title = t("garden.balance");
      chip.setAttribute("aria-label", `${t("garden.balance")}: ${formatCompact(balance)} coins`);
      bar.append(chip);
    }
    const code = currentCode();
    if (code !== null) {
      bar.append(span("garden-code", `#${code}`), actionButton(t("garden.copyLink"), "share"));
    }
    const stealthButton = actionButton(t("garden.stealth"), "toggleStealth");
    if (stealth) stealthButton.classList.add("is-active");
    const musicButton = actionButton(
      music.isPlaying() ? t("garden.musicOn") : t("garden.musicOff"),
      "toggleMusic",
    );
    const trackTitle = music.getTrackTitle();
    if (trackTitle !== null) musicButton.title = trackTitle;
    if (music.isPlaying()) musicButton.classList.add("is-active");
    bar.append(stealthButton, musicButton);
    if (mode === "visit") bar.append(actionButton(t("garden.backHome"), "home"));
    return bar;
  }

  /**
   * @brief Builds the collapsed legacy strip.
   * @details Every pre-rebuild tab stays reachable from here. Delete this strip and
   * {@link LEGACY_TABS} once the rebuilt views replace the old UI.
   */
  function buildLegacyStrip(): HTMLElement {
    const bar = div("garden-tabs garden-tabs-legacy");
    for (const id of LEGACY_TABS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "garden-tab";
      button.dataset.act = `tab:${id}`;
      const label = t(`tabs.${id}`);
      button.textContent = tab === id ? `[ ${label} ]` : ` ${label} `;
      if (tab === id) button.classList.add("is-active");
      bar.append(button);
    }
    return bar;
  }

  /** @brief Ready/growing/free counts over the open crop patches and fruit slots. */
  function gardenSummary(at: number): { ready: number; growing: number; free: number } {
    let ready = 0;
    let growing = 0;
    let free = 0;
    const plots = currentPlots() ?? [];
    const trees = currentTrees() ?? [];
    const patches = currentPatches();
    for (let slot = 0; slot < plots.length; slot += 1) {
      if (cropSlotLocked(slot)) continue;
      const plot = plots[slot] ?? null;
      if (plot === null) {
        free += 1;
        continue;
      }
      if (at >= plot.readyAt) ready += 1;
      else growing += 1;
    }
    for (const tree of trees) {
      if (tree === null) {
        free += 1;
        continue;
      }
      if (at >= tree.readyAt) ready += 1;
      else growing += 1;
    }
    return { ready, growing, free };
  }

  /** @brief Counts for the bulk water/harvest buttons. */
  function bulkCounts(at: number): { water: number; harvest: number } {
    let water = 0;
    let harvest = 0;
    const plots = currentPlots() ?? [];
    const trees = currentTrees() ?? [];
    for (let slot = 0; slot < plots.length; slot += 1) {
      if (cropSlotLocked(slot)) continue;
      const plot = plots[slot] ?? null;
      if (plot === null || plot.dead === true) continue;
      if (!plot.watered) {
        water += 1;
        continue;
      }
      if (at >= plot.readyAt) harvest += 1;
    }
    for (const tree of trees) {
      if (tree === null || tree.dead === true) continue;
      if (!tree.watered) {
        water += 1;
        continue;
      }
      if (at >= tree.readyAt) harvest += 1;
    }
    // The quick harvest action reaches the mushroom house too.
    for (const tray of state?.mushroomTrays ?? []) {
      if (tray !== null && at >= tray.readyAt) harvest += 1;
    }
    return { water, harvest };
  }

  /** @brief HUD comment line. */
  function hudText(): string {
    const at = now();
    if (mode === "visit" && visiting !== null) {
      const counts = gardenSummary(at);
      return `${t("garden.visitTitle", { nick: visiting.nick })} | ${t("garden.ready")} ${counts.ready} | ${visiting.online ? t("common.online") : t("common.offlineUser")}`;
    }
    if (state === null) return "";
    const counts = gardenSummary(at);
    return `${t("garden.ready")} ${counts.ready} | ${t("garden.growing")} ${counts.growing} | ${t("garden.free")} ${counts.free}`;
  }

  /** @brief Builds one large cell (glyph, name, effect, countdown). */
  function buildCell(slot: number, area: "crop" | "tree"): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "garden-cell";
    cell.dataset.act = "plot";
    cell.dataset.area = area;
    cell.dataset.slot = String(slot);
    for (let index = 0; index < 6; index += 1) {
      const line = document.createElement("span");
      line.className = "garden-cell-line";
      cell.append(line);
    }
    syncCell(cell, slot, area, now());
    return cell;
  }

  /** @brief Repaints one large crop or tree cell from the snapshot and clock. */
  function syncCell(cell: HTMLButtonElement, slot: number, area: "crop" | "tree", at: number): void {
    const preview = isPreviewPage();
    const plot = preview || area === "tree" ? null : plotAt(slot);
    const tree = preview || area === "crop" ? null : treeAt(slot);
    const local = area === "crop" ? slot - cropOffset() : slot - treeOffset();
    const locked = preview || (area === "crop" && cropSlotLocked(slot));
    const lockedCost = !locked ? null : preview ? 0 : patchCost(Math.floor(slot / CROPS_PER_TAB));
    const render =
      area === "tree"
        ? treeCellRender(tree, at, lockedCost, local % PLOTS_PER_PATCH)
        : cellRender(plot, at, lockedCost, local % PLOTS_PER_PATCH, activeHybrids());
    for (let index = 0; index < 6; index += 1) {
      const line = cell.children.item(index);
      if (line instanceof HTMLElement) line.textContent = render.lines[index] ?? "";
    }
    cell.classList.toggle("is-ready", render.ready);
    cell.classList.toggle("is-growing", render.growing);
    cell.classList.toggle("is-empty", render.empty);
    cell.classList.toggle("is-locked", render.locked);
    cell.classList.toggle("is-selected", selectedSlot === slot && selectedArea === area);
    const favorite = (area === "tree" ? tree?.favorite : plot?.favorite) === true;
    cell.classList.toggle("is-favorite", favorite);
    cell.classList.toggle(
      "is-move-source",
      moveSource !== null && moveSource.slot === slot && moveSource.area === area,
    );
    cell.classList.toggle("is-dead", render.dead === true);
    cell.classList.toggle("is-thirsty", render.needsWater === true);
    cell.classList.toggle("is-pest", area === "crop" ? plot?.pest === true : tree?.pest === true);
    cell.classList.toggle(
      "is-diseased",
      (area === "crop" ? plot?.diseasedAt : tree?.diseasedAt) !== undefined,
    );
    cell.classList.toggle("is-damaged", area === "crop" && !preview && state?.damagedPlots?.[slot] === true);
    const effects =
      area === "tree"
        ? tree === null
          ? []
          : resolvedTreeEffects(tree, at)
        : plot === null
          ? []
          : resolvedCropEffects(plot, at);
    for (const definition of EFFECTS)
      cell.classList.toggle(`is-${definition.id}`, effects.includes(definition.id));
    cell.style.color =
      render.dead === true
        ? "#f48771"
        : render.needsWater === true
          ? "#dcdcaa"
          : render.growing
            ? growthColor(render.progress)
            : "";
    const label = plotLabel(slot, area);
    cell.setAttribute(
      "aria-label",
      `${t("garden.tab", { tab: page + 1 })} ${t(area === "tree" ? "garden.trees" : "garden.crops")} ${t("garden.patch", { patch: label.patch })} ${t("garden.plot", { slot: label.plot })}`,
    );
  }

  /** @brief Builds the 9x9 crop grid: nine 3x3 patches of large cells. */
  /** @brief Builds the staff slot strip shown directly in the garden. */
  function buildStaffBar(): HTMLElement {
    const bar = div("garden-staff");
    const staff = state?.extras.staff ?? [];
    bar.append(lineBlock(`// ${t("staff.title")} ${staff.length}/${STAFF_SLOTS}`));
    const shown = staff.slice(0, 8);
    shown.forEach((worker, index) => {
      const button = actionButton(`[ ${worker.name} · ${t("staff.level")} ${worker.level} ]`, "staffSlot");
      button.dataset.index = String(index);
      button.classList.add("is-filled");
      bar.append(button);
    });
    if (staff.length > shown.length) {
      const rest = actionButton(`+${staff.length - shown.length}`, "staffList");
      rest.title = t("staff.list");
      bar.append(rest);
    }
    if (staff.length < STAFF_SLOTS) {
      const empty = actionButton(`[ ${t("staff.emptySlot")} ]`, "staffSlot");
      empty.dataset.index = "";
      empty.classList.add("is-empty");
      bar.append(empty);
    }
    return bar;
  }

  function buildCropBoard(): HTMLElement {
    const board = div("garden-crop-grid");
    for (let row = 0; row < 9; row += 1) {
      const line = div("garden-mini-row");
      for (let col = 0; col < 9; col += 1) {
        const patch = Math.floor(row / 3) * 3 + Math.floor(col / 3);
        const plot = (row % 3) * 3 + (col % 3);
        line.append(buildCell(cropOffset() + patch * PLOTS_PER_PATCH + plot, "crop"));
      }
      board.append(line);
    }
    return board;
  }

  /** @brief Builds the three fruit patches stacked vertically: 3 columns, 9 rows. */
  function buildTreeBoard(): HTMLElement {
    const board = div("garden-tree-grid");
    for (let row = 0; row < FRUIT_PATCHES_PER_TAB * 3; row += 1) {
      const line = div("garden-mini-row");
      const patch = Math.floor(row / 3);
      for (let col = 0; col < 3; col += 1) {
        const plot = (row % 3) * 3 + col;
        line.append(buildCell(treeOffset() + patch * PLOTS_PER_PATCH + plot, "tree"));
      }
      board.append(line);
    }
    return board;
  }

  /** @brief Builds the tab strip: prev/next, tab counter and the buy action. */
  function buildPager(): HTMLElement {
    const bar = div("garden-pager");
    bar.append(actionButton("<", "prevPage", page > 0));
    bar.append(span("garden-page", t("garden.page", { page: page + 1, total: pageCount() })));
    bar.append(actionButton(">", "nextPage", page < pageCount() - 1));
    const cost = nextTabCost();
    if (mode === "owner") {
      if (cost === null) bar.append(span("garden-page-hint", t("garden.tabMax")));
      else {
        const affordable = (state?.coins ?? 0) >= cost;
        bar.append(actionButton(t("garden.buyTab", { cost }), "buyTab", affordable));
      }
    }
    return bar;
  }

  /** @brief Fills the detail panel text for the selected crop or tree. */
  function fillDetail(pre: HTMLPreElement, at: number): void {
    const lines: string[] = [];
    const slot = selectedSlot;
    if (slot === null) {
      pre.textContent = [t("garden.noSelection"), "", t("garden.noSelectionHint")].join("\n");
      return;
    }
    const label = plotLabel(slot, selectedArea);
    const board = t(selectedArea === "tree" ? "garden.trees" : "garden.crops");
    lines.push(
      `// ${t("garden.tab", { tab: page + 1 })} · ${board} · ${t("garden.patch", { patch: label.patch })} · ${t("garden.plot", { slot: label.plot })}`,
    );

    if (selectedArea === "tree") {
      const tree = treeAt(slot);
      if (tree === null) {
        lines.push("", t("garden.empty"), t("garden.pickTree", { slot: label.plot }));
      } else {
        const definition = treeLikeById(tree.tree);
        const ready = at >= tree.readyAt;
        const total = Math.max(1, tree.readyAt - tree.plantedAt);
        const progress = Math.min(1, Math.max(0, at - tree.plantedAt) / total);
        lines.push(labelValue(t("garden.crop"), t(`trees.${tree.tree}`)));
        const stages = tList("garden.stageValues");
        const stageIndex = ready ? 3 : Math.min(2, Math.floor(progress * 3));
        lines.push(
          labelValue(
            t("garden.stage"),
            ready ? (stages[3] ?? "") : `${stages[stageIndex] ?? ""} (${stageIndex + 1}/3)`,
          ),
        );
        lines.push(labelValue(t("garden.effect"), effectListText(resolvedTreeEffects(tree, at))));
        if (tree.fertilizer !== null) {
          lines.push(
            labelValue(
              t("garden.fertilizer"),
              `${t(`supplies.${tree.fertilizer.id}`)} (${t("garden.supplyLeft", { left: tree.fertilizer.left })})`,
            ),
          );
        }
        if (tree.spray !== null) {
          lines.push(
            labelValue(
              t("garden.sprayActive"),
              `${t(`supplies.${tree.spray.id}`)} (${t("garden.supplyLeft", { left: tree.spray.left })})`,
            ),
          );
        }
        if (tree.dead === true) {
          lines.push("", t("garden.dead"), t("garden.deadHint"));
        } else if (tree.watered !== true) {
          lines.push(
            labelValue(
              t("garden.water"),
              formatDuration(Math.max(0, PLANT_THIRST_MS - (at - tree.plantedAt))),
            ),
            t("garden.waterHint"),
          );
        }
        lines.push(
          labelValue(
            t("garden.readyIn"),
            ready ? t("garden.ready") : formatDuration(Math.max(0, tree.readyAt - at)),
          ),
        );
        if (tree.diseasedAt !== undefined) {
          lines.push(
            labelValue(
              t("garden.disease"),
              t("garden.diseaseHint", {
                time: formatDuration(
                  Math.max(0, tree.diseasedAt + TREE_DISEASE_DEATH_CYCLES * FARM_CYCLE_MS - at),
                  "short",
                ),
              }),
            ),
          );
        }
        if (season !== null) {
          lines.push(
            labelValue(
              t("garden.finalSell"),
              `${formatCompact(cropSellPrice({ item: tree.tree, effects: resolvedTreeEffects(tree, at), qty: 1 }, season))}c`,
            ),
          );
        }
        lines.push(labelValue(t("garden.kind"), t("garden.reharvest")));
        if (tree.harvests > 0) lines.push(labelValue(t("garden.harvestedTimes"), String(tree.harvests)));
        lines.push(
          labelValue(
            t("garden.favorite"),
            tree.favorite === true ? t("garden.favoriteOn") : t("garden.favoriteOff"),
          ),
        );
      }
      if (mode === "owner") lines.push("", t("garden.actions"));
      pre.textContent = lines.join("\n");
      return;
    }

    const plot = plotAt(slot);
    if (plot === null) {
      if (state?.damagedPlots?.[slot] === true) {
        lines.push("", t("garden.damaged"), t("garden.damagedHint"));
      } else {
        lines.push("", t("garden.empty"), t("garden.emptyHint"));
      }
    } else {
      const view = plotView(plot, at, activeHybrids());
      const definition = resolveSeed(plot.seed, activeHybrids());
      lines.push(labelValue(t("garden.crop"), itemName(plot.seed)));
      const stages = tList("garden.stageValues");
      const stageIndex = view.ready ? 3 : Math.min(view.stage, 2);
      const stage = stages[stageIndex] ?? "";
      lines.push(labelValue(t("garden.stage"), view.ready ? stage : `${stage} (${stageIndex + 1}/3)`));
      lines.push(labelValue(t("garden.effect"), effectListText(view.effects.map((effect) => effect.id))));
      lines.push(
        labelValue(
          t("garden.pest"),
          plot.pest
            ? t("garden.pestHint")
            : plot.protectedUntil > at
              ? t("garden.protected", { time: formatDuration(plot.protectedUntil - at, "short") })
              : t("garden.pestNone"),
        ),
      );
      if (plot.diseasedAt !== undefined) {
        lines.push(
          labelValue(
            t("garden.disease"),
            t("garden.diseaseHint", {
              time: formatDuration(
                Math.max(0, plot.diseasedAt + DISEASE_DEATH_CYCLES * FARM_CYCLE_MS - at),
                "short",
              ),
            }),
          ),
        );
      }
      const fertility = state?.soil?.[slot] ?? SOIL_START;
      lines.push(
        labelValue(
          t("garden.soil"),
          fertility < 50 ? `${fertility}% · ${t("garden.soilLow")}` : `${fertility}%`,
        ),
      );
      if (plot.fertilizer !== null) {
        lines.push(
          labelValue(
            t("garden.fertilizer"),
            `${t(`supplies.${plot.fertilizer.id}`)} (${t("garden.supplyLeft", { left: plot.fertilizer.left })})`,
          ),
        );
      }
      if (plot.spray !== null) {
        lines.push(
          labelValue(
            t("garden.sprayActive"),
            `${t(`supplies.${plot.spray.id}`)} (${t("garden.supplyLeft", { left: plot.spray.left })})`,
          ),
        );
      }
      if (plot.dead === true) {
        lines.push("", t("garden.dead"), t("garden.deadHint"));
      } else if (plot.watered !== true) {
        lines.push(
          labelValue(t("garden.water"), formatDuration(Math.max(0, PLANT_THIRST_MS - (at - plot.plantedAt)))),
          t("garden.waterHint"),
        );
      }
      lines.push(
        labelValue(t("garden.readyIn"), view.ready ? t("garden.ready") : formatDuration(view.remainingMs)),
      );
      if (season !== null) {
        lines.push(
          labelValue(
            t("garden.finalSell"),
            `${formatCompact(cropSellPrice({ item: plot.seed, effects: resolvedCropEffects(plot, at), qty: 1 }, season, activeHybrids()))}c`,
          ),
        );
      }
      if (definition?.regrow === true) {
        lines.push(labelValue(t("garden.kind"), t("garden.reharvest")));
        if (plot.harvests > 0) lines.push(labelValue(t("garden.harvestedTimes"), String(plot.harvests)));
      } else {
        lines.push(labelValue(t("garden.kind"), t("garden.singleHarvest")));
      }
      lines.push(
        labelValue(
          t("garden.favorite"),
          plot.favorite === true ? t("garden.favoriteOn") : t("garden.favoriteOff"),
        ),
      );
      if (mode === "owner") lines.push("", t("garden.actions"));
    }
    pre.textContent = lines.join("\n");
  }

  /** @brief Builds the seed picker rows for one empty plot. */
  function buildSeedPicker(slot: number): HTMLElement {
    const wrap = div("garden-seeds");
    wrap.append(span("garden-hint", t("garden.pickSeed", { slot: plotLabel(slot, "crop").plot })));
    const hybridDefs = activeHybrids().map((hybrid) => hybridAsSeedDefinition(hybrid));
    const ownedSeeds = [...SEEDS, ...hybridDefs].filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0);
    if (ownedSeeds.length === 0) wrap.append(span("garden-hint", t("garden.noSeedsOwned")));
    for (const seed of ownedSeeds) {
      const owned = state?.bag.seeds[seed.id] ?? 0;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "garden-row";
      row.dataset.act = "seed";
      row.dataset.seed = seed.id;
      row.disabled = seedLocked(seed.id);
      row.textContent = `${fitText(seedName(seed.id), 9)}${fitText(`${t("garden.bag")} ${owned}`, 8)}${formatDuration(seed.growMs, "short")}`;
      wrap.append(row);
    }
    return wrap;
  }

  /** @brief Builds the tree picker rows for one empty tree slot. */
  function buildTreePicker(slot: number): HTMLElement {
    const wrap = div("garden-seeds");
    wrap.append(span("garden-hint", t("garden.pickTree", { slot: plotLabel(slot, "tree").plot })));
    for (const tree of TREES) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "garden-row";
      row.dataset.act = "tree";
      row.dataset.tree = tree.id;
      row.textContent = `${fitText(treeName(tree.id), 9)}${fitText(`${tree.buy}c`, 6)}${fitText(`${tree.sell}c`, 6)}${formatDuration(tree.growMs, "short")}`;
      wrap.append(row);
    }
    return wrap;
  }

  /**
   * @brief Builds the fertilizer or spray picker for the selected plant.
   * @param kind Which consumable kind to list.
   * @param slot Absolute slot index.
   * @param area Whether the selected plant is a crop or a tree.
   */
  function buildSupplyPicker(kind: "fertilize" | "spray", slot: number, area: "crop" | "tree"): HTMLElement {
    const wrap = div("garden-seeds");
    wrap.append(span("garden-hint", t("garden.noSupplies")));
    const catalog = kind === "fertilize" ? FERTILIZERS : SPRAYS;
    for (const supply of catalog) {
      const owned = state?.bag.supplies[supply.id] ?? 0;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "garden-row";
      row.dataset.act = "applySupply";
      row.dataset.kind = kind;
      row.dataset.supply = supply.id;
      row.dataset.area = area;
      row.dataset.slot = String(slot);
      if (owned < 1) row.disabled = true;
      const detail =
        "growMultiplier" in supply
          ? `x${supply.growMultiplier} · ${supply.harvests}`
          : `x${SPRAY_MUTATION_BOOST} mut · ${supply.harvests}`;
      row.textContent = `${fitText(t(`supplies.${supply.id}`), 14)}${fitText(`${owned}`, 3)}${fitText(`${buyPriceOf(supply.id, supply.price)}c`, 5)}${detail}`;
      wrap.append(row);
    }
    return wrap;
  }

  /** @brief Builds the right-hand detail panel and its actions. */
  function buildDetail(): HTMLElement {
    const wrap = div("garden-detail");
    const pre = document.createElement("pre");
    pre.className = "garden-detail-text";
    detailPre = pre;
    fillDetail(pre, now());
    wrap.append(pre);

    const actions = div("garden-actions");
    const slot = selectedSlot;
    if (slot === null) {
      actions.append(span("garden-hint", t("garden.noSelectionHint")));
      wrap.append(actions);
      return wrap;
    }

    const tree = selectedArea === "tree" ? treeAt(slot) : null;
    const plot = selectedArea === "crop" ? plotAt(slot) : null;
    const plant = tree ?? plot;
    const ready = plant !== null && now() >= plant.readyAt;

    if (plant === null) {
      if (mode === "owner") {
        actions.append(selectedArea === "tree" ? buildTreePicker(slot) : buildSeedPicker(slot));
      } else {
        actions.append(span("garden-hint", t("garden.noSelectionHint")));
      }
    } else if (supplyPicker !== null) {
      actions.append(buildSupplyPicker(supplyPicker, slot, selectedArea));
      actions.append(actionButton(t("common.cancel"), "cancelSupply"));
    } else if (mode === "owner") {
      actions.append(actionButton(t("garden.harvest"), "harvest", ready));
      actions.append(actionButton(t("garden.water"), "water", !ready && !plant.watered));
      actions.append(actionButton(t("garden.fertilize"), "pickFertilize", !ready));
      actions.append(actionButton(t("garden.spray"), "pickSpray", !ready));
      actions.append(actionButton(uprootArmed ? t("garden.uprootConfirm") : t("garden.uproot"), "uproot"));
    } else {
      actions.append(actionButton(t("garden.waterFriend"), "waterFriend", !ready));
      actions.append(actionButton(t("garden.cheer"), "cheer"));
    }
    wrap.append(actions);
    return wrap;
  }

  /** @brief Builds one full-width row inside the context menu. */
  function menuRow(
    label: string,
    act: string,
    options: { disabled?: boolean; data?: Record<string, string> } = {},
  ): HTMLButtonElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "garden-menu-row";
    row.dataset.act = act;
    row.textContent = label;
    if (options.disabled === true) row.disabled = true;
    if (options.data !== undefined) {
      for (const [key, value] of Object.entries(options.data)) row.dataset[key] = value;
    }
    return row;
  }

  /** @brief Builds the context menu anchored at the clicked cell. */
  function buildMenu(at: number): HTMLElement | null {
    const menuState = menu;
    if (menuState === null) return null;
    const wrap = div("garden-menu");
    const width = 340;
    const left = Math.min(Math.max(8, menuState.x), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(Math.max(8, menuState.y), Math.max(8, window.innerHeight - 120));
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;

    const label = plotLabel(menuState.slot, menuState.area);
    const head = div("garden-menu-head");
    head.append(
      span(
        "garden-menu-title",
        `${t(menuState.area === "tree" ? "garden.trees" : "garden.crops")} · ${t("garden.patch", { patch: label.patch })} · ${t("garden.plot", { slot: label.plot })}`,
      ),
    );
    const coins = mode === "visit" ? visiting?.coins : state?.coins;
    if (coins !== undefined) {
      const menuBalance = span("garden-menu-balance", `$ ${formatCompact(coins)}c`);
      menuBalance.title = `${formatNumber(coins)} coins`;
      head.append(menuBalance);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "garden-menu-close";
    close.dataset.act = "menuClose";
    close.textContent = "×";
    close.setAttribute("aria-label", t("common.close"));
    head.append(close);
    wrap.append(head);

    const info = document.createElement("pre");
    info.className = "garden-menu-info";
    fillDetail(info, at);
    wrap.append(info);

    const rows = div("garden-menu-rows");
    const plot = menuState.area === "crop" ? plotAt(menuState.slot) : null;
    const tree = menuState.area === "tree" ? treeAt(menuState.slot) : null;
    const plant = tree ?? plot;
    const ready = plant !== null && at >= plant.readyAt;
    const locked = menuState.area === "crop" && cropSlotLocked(menuState.slot);

    if (menuState.view === "seed") {
      rows.append(menuRow(t("garden.menuBack"), "menuBack"));
      const ownedSeeds = SEEDS.filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0);
      if (ownedSeeds.length === 0)
        rows.append(menuRow(t("garden.noSeedsOwned"), "menuNoop", { disabled: true }));
      for (const seed of ownedSeeds) {
        const owned = state?.bag.seeds[seed.id] ?? 0;
        const locked = seedLocked(seed.id);
        rows.append(
          menuRow(
            `${fitText(seedName(seed.id), 9)} ${t("garden.bag")} ${owned}${locked ? ` · P${seedPrestigeTier(seed.id)}` : ""}`,
            "menuSeed",
            { data: { seed: seed.id }, disabled: locked },
          ),
        );
      }
    } else if (menuState.view === "tree") {
      rows.append(menuRow(t("garden.menuBack"), "menuBack"));
      for (const treeDef of TREES) {
        rows.append(
          menuRow(
            `${fitText(treeName(treeDef.id), 9)} ${fitText(`${treeDef.buy}c`, 6)} ${formatDuration(treeDef.growMs, "short")}`,
            "menuTree",
            { data: { tree: treeDef.id }, disabled: (state?.coins ?? 0) < treeDef.buy },
          ),
        );
      }
      const ownedFruit = SEEDS.filter(
        (seed) => seed.category === "fruit" && (state?.bag.seeds[seed.id] ?? 0) > 0,
      );
      for (const seed of ownedFruit) {
        rows.append(
          menuRow(
            `${fitText(seedName(seed.id), 9)} ${t("garden.bag")} ${state?.bag.seeds[seed.id] ?? 0}`,
            "menuFruitSeed",
            { data: { seed: seed.id } },
          ),
        );
      }
    } else if (menuState.view === "fertilize" || menuState.view === "spray") {
      rows.append(menuRow(t("garden.menuBack"), "menuBack"));
      const catalog = menuState.view === "fertilize" ? FERTILIZERS : SPRAYS;
      const act = menuState.view === "fertilize" ? "menuUseFertilize" : "menuUseSpray";
      for (const supply of catalog) {
        const owned = state?.bag.supplies[supply.id] ?? 0;
        rows.append(
          menuRow(
            `${fitText(t(`supplies.${supply.id}`), 14)} ${t("garden.bag")} ${owned} · ${buyPriceOf(supply.id, supply.price)}c`,
            act,
            { data: { supply: supply.id }, disabled: owned < 1 },
          ),
        );
      }
    } else if (mode === "visit") {
      if (plant !== null) {
        rows.append(menuRow(t("garden.waterFriend"), "waterFriend", { disabled: ready }));
        rows.append(menuRow(t("garden.cheer"), "cheer"));
      }
    } else if (locked) {
      rows.append(
        menuRow(
          t("garden.menuBuyPatch", {
            patch: label.patch,
            cost: `${formatCompact(patchCost(Math.floor(menuState.slot / CROPS_PER_TAB)))}c`,
          }),
          "menuBuyPatch",
        ),
      );
    } else if (menuState.area === "crop" && state?.damagedPlots?.[menuState.slot] === true) {
      rows.append(
        menuRow(t("garden.repairPlot", { cost: `${formatCompact(PLOT_REPAIR_COST)}c` }), "repairPlot", {
          data: { slot: String(menuState.slot) },
        }),
      );
    } else if (plant === null) {
      rows.append(
        menuRow(
          menuState.area === "crop" ? t("garden.menuSeed") : t("garden.menuTree"),
          menuState.area === "crop" ? "menuViewSeed" : "menuViewTree",
        ),
      );
    } else {
      const tools = state?.bag.tools ?? {};
      const favorite = plant.favorite === true;
      const reclaimer = tools.reclaimer ?? 0;
      const shovel = tools.shovel ?? 0;
      const favoriteLock = tools.favoriteLock ?? 0;
      const dead = plant.dead === true;
      // Still under pesticide cover: no re-spray row until it lapses.
      if (!dead && plant.protectedUntil <= at) {
        rows.append(menuRow(t("garden.sprayPest", { cost: PEST_SPRAY_COST }), "sprayPest"));
      }
      rows.append(menuRow(t("garden.harvest"), "harvest", { disabled: !ready || favorite || dead }));
      rows.append(menuRow(t("garden.water"), "water", { disabled: ready || plant.watered || dead }));
      rows.append(menuRow(t("garden.menuFertilize"), "menuViewFertilize", { disabled: ready || dead }));
      rows.append(menuRow(t("garden.menuSpray"), "menuViewSpray", { disabled: dead }));
      if (menuState.area === "crop") {
        rows.append(
          menuRow(t("garden.reclaim", { left: reclaimer }), "menuReclaim", {
            disabled: favorite || reclaimer < 1,
          }),
        );
      }
      rows.append(
        menuRow(t("garden.movePlant", { left: shovel }), "menuMove", {
          disabled: favorite || shovel < 1,
        }),
      );
      rows.append(
        menuRow(
          favorite ? t("garden.favoriteUnlock") : t("garden.favoriteLock", { left: favoriteLock }),
          "menuFavorite",
          { disabled: !favorite && favoriteLock < 1 },
        ),
      );
      rows.append(
        menuRow(uprootArmed ? t("garden.uprootConfirm") : t("garden.uproot"), "uproot", {
          disabled: favorite,
        }),
      );
    }
    wrap.append(rows);
    return wrap;
  }

  /**
   * @brief Builds one row inside the right-hand status rail.
   * @param icon Unicode glyph shown first.
   * @param label Row label.
   * @param value Value text; when `until` is set a live countdown follows it.
   * @param until Server time the value expires, for countdown rows.
   */
  function sideRow(icon: string, label: string, value: string, until: number | null = null): HTMLDivElement {
    const row = div("garden-side-row");
    row.append(span("garden-side-icon", icon), span("garden-side-label", label));
    const cell = span("garden-side-value", value);
    if (until !== null && until > now()) {
      const timer = span("garden-side-time", formatDuration(until - now(), "short"));
      timer.dataset.sideUntil = String(until);
      cell.append(" · ", timer);
    }
    row.append(cell);
    return row;
  }

  /**
   * @brief Builds the right rail: bag contents, upgrades and live status.
   * @param at Server-clock time used for the countdowns.
   * @details The rail answers "what do I own, what is upgraded and what is
   * running" without leaving the board. Pesticide coverage is shown for the
   * whole field, since `sprayPestAll` can protect every plant at once.
   */
  function buildSidebar(at: number): HTMLElement {
    const side = div("garden-side");
    const view = mode === "visit" ? visiting : state;
    if (!view) return side;

    side.append(span("garden-side-title", `// ${t("side.bag")}`));
    const seeds = Object.values(view.bag.seeds).reduce<number>((sum, qty) => sum + (qty ?? 0), 0);
    const seedKinds = Object.values(view.bag.seeds).filter((qty) => (qty ?? 0) > 0).length;
    const seedRow = sideRow(
      "🌱",
      t("side.seeds"),
      `${formatCompact(seeds)} · ${seedKinds} ${t("side.kinds")}`,
    );
    seedRow.title = Object.entries(view.bag.seeds)
      .filter(([, qty]) => (qty ?? 0) > 0)
      .map(([id, qty]) => `${seedName(id)} ×${qty}`)
      .join(" · ");
    side.append(seedRow);
    const supplyRow = sideRow(
      "🧪",
      t("side.supplies"),
      formatCompact(Object.values(view.bag.supplies).reduce((sum, qty) => sum + (qty ?? 0), 0)),
    );
    supplyRow.title = Object.entries(view.bag.supplies)
      .filter(([, qty]) => (qty ?? 0) > 0)
      .map(([id, qty]) => `${t(`supplies.${id}`)} ×${qty}`)
      .join(" · ");
    side.append(supplyRow);
    const tools = view.bag.tools ?? {};
    const toolRow = sideRow(
      "🛠",
      t("side.tools"),
      formatCompact(Object.values(tools).reduce((sum, qty) => sum + (qty ?? 0), 0)),
    );
    toolRow.title = Object.entries(tools)
      .filter(([, qty]) => (qty ?? 0) > 0)
      .map(([id, qty]) => `${t(`tools.${id}`)} ×${qty}`)
      .join(" · ");
    side.append(toolRow);
    const products = view.bag.products ?? [];
    const productRow = sideRow(
      "🥚",
      t("side.products"),
      formatCompact(products.reduce((sum, stack) => sum + stack.qty, 0)),
    );
    productRow.title = products
      .map((stack) => `${t(`products.${stack.product}`)} ${stack.star}★ ×${stack.qty}`)
      .join(" · ");
    side.append(productRow);
    const cropRow = sideRow(
      "🌾",
      t("side.crops"),
      formatCompact(view.bag.crops.reduce((sum, stack) => sum + stack.qty, 0)),
    );
    cropRow.title = view.bag.crops.map((stack) => `${itemName(stack.item)} ×${stack.qty}`).join(" · ");
    side.append(cropRow);

    side.append(span("garden-side-title", `// ${t("side.upgrades")}`));
    const extras = view.extras;
    side.append(sideRow("🌡", t("side.greenhouse"), `${extras.greenhouse}/${GREENHOUSE_PRICES.length}`));
    const machines = Object.keys(view.warehouse.machines ?? {}).length;
    side.append(
      sideRow(
        "🏚",
        t("side.warehouse"),
        `${view.warehouse.level} · ${machines}/${MACHINES.length} ${t("side.machines")}`,
      ),
    );
    const coop = view.buildings.coop ?? 0;
    const barn = view.buildings.barn ?? 0;
    const pond = view.buildings.pond ?? 0;
    side.append(sideRow("🏠", t("side.buildings"), `C${coop} · B${barn} · P${pond}`));
    side.append(sideRow("🐟", t("farm.pond"), `${pond} · ${t("farm.growth")} ${view.pondGrowth ?? 0}%`));
    const pet = extras.equippedPet === null ? t("side.none") : t(`pets.${extras.equippedPet}`);
    side.append(sideRow("🐾", t("side.pet"), pet));
    side.append(
      extras.insuranceUntil > at
        ? sideRow("🛟", t("side.insurance"), t("side.active"), extras.insuranceUntil)
        : sideRow("🛟", t("side.insurance"), t("side.none")),
    );
    const patches = view.unlockedPatches.reduce((sum, count) => sum + count, 0);
    side.append(sideRow("📑", t("side.tabs"), `${view.tabs}/${MAX_TABS} · ${patches} ${t("side.patches")}`));

    side.append(span("garden-side-title", `// ${t("side.status")}`));
    if (season !== null && season.events.length > 0) {
      const names = season.events.map((event) => t(`events.${event.id}`)).join(", ");
      side.append(
        sideRow("🕒", t("side.phase"), t(`phase.${season.phase.id}`), season.phase.endsAt),
        sideRow("🌦", t("side.weather"), names, season.event.endsAt),
      );
    } else if (season !== null) {
      side.append(
        sideRow("🕒", t("side.phase"), t(`phase.${season.phase.id}`), season.phase.endsAt),
        sideRow("🌦", t("side.weather"), t("events.calm")),
      );
    } else {
      side.append(sideRow("🌦", t("side.weather"), t("events.calm")));
    }

    const plants = [...(currentPlots() ?? []), ...(currentTrees() ?? [])].filter(
      (plant): plant is PlotState | TreeState => plant !== null,
    );
    const guarded = plants.filter((plant) => plant.protectedUntil > at);
    const guardUntil = guarded.reduce((max, plant) => Math.max(max, plant.protectedUntil), 0);
    const coverage =
      guarded.length === 0
        ? t("side.pestNone")
        : guarded.length >= plants.length
          ? t("side.pestAll")
          : `${guarded.length}/${plants.length}`;
    side.append(sideRow("🛡", t("side.pesticide"), coverage, guardUntil > at ? guardUntil : null));

    const watered = plants.filter((plant) => plant.watered).length;
    const fed = plants.filter((plant) => plant.fertilizer !== null).length;
    const charged = plants.filter((plant) => plant.spray !== null).length;
    side.append(sideRow("💧", t("side.watered"), `${watered}/${plants.length}`));
    side.append(sideRow("🌿", t("side.fertilized"), `${fed}/${plants.length}`));
    side.append(sideRow("✨", t("side.sprayed"), `${charged}/${plants.length}`));

    const soil = view.soil ?? [];
    const fertility =
      soil.length === 0 ? 100 : Math.round(soil.reduce((sum, value) => sum + value, 0) / soil.length);
    side.append(sideRow("🟫", t("side.soil"), `${fertility}%`));
    const pests = plants.filter((plant) => plant.pest).length;
    side.append(sideRow("🐛", t("side.pests"), pests === 0 ? t("side.none") : String(pests)));

    const skills = view.skills;
    side.append(
      sideRow(
        "⭐",
        t("side.skills"),
        `F${skills.farming.level} · R${skills.ranching.level} · A${skills.artisaning.level}`,
      ),
    );
    return side;
  }

  /** @brief Special plots for the active mode. */
  function specialView(): {
    owned: number;
    plots: readonly (PlotState | null)[];
  } | null {
    const view = mode === "visit" ? visiting : state;
    if (!view) return null;
    return {
      owned: Math.min(SPECIAL_SLOTS, view.specialOwned ?? 0),
      plots: view.specialPlots ?? [],
    };
  }

  /**
   * @brief The 27 premium plots as plain plot cells for the rebuilt board.
   * @details Unbought plots stay locked like normal soil; only the next plot in the
   * sequence is buyable and carries its price.
   */
  function rebornPlots(): RebornPlot[] {
    const view = specialView();
    const plots: RebornPlot[] = [];
    for (let slot = 0; slot < SPECIAL_SLOTS; slot += 1) {
      plots.push({
        slot,
        owned: view !== null && slot < view.owned,
        buyable: view !== null && mode === "owner" && slot === view.owned,
        plot: view?.plots[slot] ?? null,
        price: specialPlotCost(slot),
      });
    }
    return plots;
  }

  /**
   * @brief Quick actions grouped in three columns beside the VIP board.
   * @param at Server-clock time.
   * @return One array per column; each entry reuses a legacy data-act handler.
   * @details Column 1 holds the field-wide actions, column 2 the bulk supplies and
   * soil work, column 3 the quick tools plus the bulk uproot panel.
   */
  function rebornActionColumns(at: number): RebornAction[][] {
    const coins = state?.coins ?? 0;
    const counts = bulkCounts(at);
    const waterCost = counts.water * WATER_ALL_COST;
    const harvestCost = counts.harvest * HARVEST_ALL_COST;
    const bagQty = (state?.bag.crops ?? []).reduce((sum, stack) => sum + stack.qty, 0);
    const pestTargets =
      (state?.plots ?? []).filter(
        (plot, slot) => plot !== null && !cropSlotLocked(slot) && plot.protectedUntil <= at,
      ).length + (state?.trees ?? []).filter((tree) => tree !== null && tree.protectedUntil <= at).length;
    const pestCost = pestTargets * PEST_SPRAY_COST;
    const renovateCost = (state?.soil ?? []).reduce((sum, fertility) => sum + soilRenovateCost(fertility), 0);
    const fertilizerTargets = supplyTargetCount("fertilize", at);
    const seedKinds = [...SEEDS, ...activeHybrids()].filter(
      (seed) => (state?.bag.seeds[seed.id] ?? 0) > 0,
    ).length;
    // Quick Plan fills every empty slot it can afford across crops, trees and trays.
    const planSlots =
      (state?.plots ?? []).filter((plot, slot) => plot === null && !cropSlotLocked(slot)).length +
      (state?.trees ?? []).filter((tree) => tree === null).length +
      (state?.mushroomTrays ?? []).filter((tray) => tray === null).length;
    const note = (count: number, cost: number): string =>
      count > 0 ? `${count}·${formatCompact(cost)}c` : "";

    return [
      [
        {
          id: "water",
          label: t("reborn.action.water"),
          glyph: "~",
          note: note(counts.water, waterCost),
          tone: "water",
          act: "waterAll",
          disabled: counts.water === 0 || coins < waterCost,
        },
        {
          id: "harvest",
          label: t("reborn.action.harvest"),
          glyph: "*",
          note: note(counts.harvest, harvestCost),
          tone: "harvest",
          act: "harvestAll",
          disabled: counts.harvest === 0 || coins < harvestCost,
        },
        {
          id: "sell",
          label: t("reborn.action.sell"),
          glyph: "$",
          note: bagQty > 0 ? String(bagQty) : "",
          tone: "money",
          act: "sellAll",
          disabled: bagQty === 0,
        },
      ],
      [
        {
          id: "sprayPests",
          label: t("reborn.action.spray"),
          glyph: "!",
          note: note(pestTargets, pestCost),
          tone: "chemical",
          act: "sprayPestAll",
          disabled: pestTargets === 0 || coins < pestCost,
        },
        {
          id: "renovate",
          label: t("reborn.action.renovate"),
          glyph: "^",
          note: renovateCost > 0 ? `${formatCompact(renovateCost)}c` : "",
          tone: "soil",
          act: "renovateSoil",
          disabled: renovateCost === 0 || coins < renovateCost,
        },
        {
          id: "bulkFertilize",
          label: t("reborn.action.bulkFertilize"),
          glyph: "+",
          note: fertilizerTargets > 0 ? String(fertilizerTargets) : "",
          tone: "fertilizer",
          act: "pickAllSupply",
          kind: "fertilize",
          disabled: fertilizerTargets === 0,
          active: toolPicker === "fertilizeAll",
        },
      ],
      [
        {
          id: "quickPlan",
          label: t("reborn.action.plan"),
          glyph: ">",
          note: planSlots > 0 ? String(planSlots) : "",
          tone: "plant",
          act: "quickPlan",
          disabled: planSlots === 0,
        },
        {
          id: "quickSpray",
          label: t("reborn.action.sprayTool"),
          glyph: "z",
          note: "",
          tone: "chemical",
          act: "pickTool",
          kind: "spray",
          active: toolPicker === "spray" || tool?.kind === "spray",
        },
        {
          id: "quickFertilize",
          label: t("reborn.action.fertilizeTool"),
          glyph: "o",
          note: "",
          tone: "fertilizer",
          act: "pickTool",
          kind: "fertilize",
          active: toolPicker === "fertilize" || tool?.kind === "fertilize",
        },
      ],
      [
        {
          id: "quickUproot",
          label: t("reborn.action.uproot"),
          glyph: "x",
          note: "",
          tone: "danger",
          act: "bulkUproot",
          active: bulkPanel === "uproot",
        },
        {
          id: "quickPlant",
          label: t("reborn.action.plant"),
          glyph: "+",
          note: seedKinds > 0 ? String(seedKinds) : "",
          tone: "plant",
          act: "pickPlantTool",
          active: toolPicker === "plant" || tool?.kind === "plant",
        },
        {
          id: "quickWater",
          label: t("garden.waterQuick"),
          glyph: "w",
          note: "",
          tone: "water",
          act: "quickWater",
          active: tool?.kind === "water",
        },
      ],
    ];
  }

  /** @brief Repaints one premium plot cell as a full ASCII crop cell. */
  function syncSpecialCell(button: HTMLButtonElement, slot: number, at: number): void {
    const view = specialView();
    for (let index = 0; index < 6; index += 1) {
      const line = button.children.item(index);
      if (line instanceof HTMLElement) line.textContent = "";
    }
    button.classList.remove("is-empty", "is-ready", "is-locked", "is-pest");
    if (view === null) return;
    if (slot >= view.owned) {
      button.classList.add("is-locked");
      if (slot === view.owned && mode === "owner") {
        const cost = formatCompact(specialPlotCost(slot));
        const lines = [`+ ${cost}c`, "", "", "", "", ""];
        for (let index = 0; index < 6; index += 1) {
          const line = button.children.item(index);
          if (line instanceof HTMLElement) line.textContent = lines[index] ?? "";
        }
        button.dataset.act = "buySpecialPlot";
        button.title = t("special.buyPlot", { cost });
      } else {
        const line = button.children.item(0);
        if (line instanceof HTMLElement) line.textContent = "· · ·";
        button.dataset.act = "specialNoop";
        button.disabled = true;
      }
      return;
    }
    const plot = view.plots[slot] ?? null;
    const render = cellRender(plot, at, null, slot % SPECIAL_PLOTS_PER_PATCH, activeHybrids());
    for (let index = 0; index < 6; index += 1) {
      const line = button.children.item(index);
      if (line instanceof HTMLElement) line.textContent = render.lines[index] ?? "";
    }
    button.classList.toggle("is-ready", render.ready);
    button.classList.toggle("is-empty", render.empty);
    button.classList.toggle("is-pest", plot?.pest === true);
    button.classList.toggle("is-diseased", plot?.diseasedAt !== undefined);
    button.dataset.act = "specialPlot";
    button.title =
      plot === null ? t("special.empty") : at >= plot.readyAt ? t("special.ready") : t("special.growing");
  }

  /** @brief Builds the premium 27-plot board with the same ASCII cells. */
  function buildSpecialBoard(at: number): HTMLElement {
    const wrap = div("garden-special");
    wrap.append(lineBlock(`// ${t("special.title")} · ${t("special.note")}`));
    const view = specialView();
    for (let patch = 0; patch < 3; patch += 1) {
      const row = div("garden-special-row garden-plot-row");
      row.append(span("garden-special-patch", `V${patch + 1}`));
      for (let local = 0; local < SPECIAL_PLOTS_PER_PATCH; local += 1) {
        const slot = patch * SPECIAL_PLOTS_PER_PATCH + local;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "garden-special-cell";
        button.dataset.slot = String(slot);
        for (let index = 0; index < 6; index += 1) {
          const line = document.createElement("span");
          line.className = "garden-cell-line";
          button.append(line);
        }
        syncSpecialCell(button, slot, at);
        if (mode === "visit" && (view === null || slot >= view.owned)) button.disabled = true;
        row.append(button);
      }
      wrap.append(row);
    }
    appendSpecialPickers(wrap);
    return wrap;
  }

  /**
   * @brief Appends the seed and supply pickers opened from a premium plot menu.
   * @param wrap Board wrapper that receives the pickers.
   * @details Shared by the legacy premium board and the rebuilt VIP board so both
   * views keep the same menu flow.
   */
  function appendSpecialPickers(wrap: HTMLElement): void {
    if (specialPicker !== null) {
      const picker = div("garden-tools");
      picker.append(span("garden-hint", t("special.pickSeed")));
      const seeds = SEEDS.filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0);
      if (seeds.length === 0) picker.append(span("garden-hint", t("garden.noSeedsOwned")));
      for (const seed of seeds) {
        const locked = seedLocked(seed.id);
        const button = actionButton(
          `${seedName(seed.id)} (${state?.bag.seeds[seed.id] ?? 0})${locked ? ` · P${seedPrestigeTier(seed.id)}` : ""}`,
          "specialSeed",
          !locked,
        );
        button.dataset.slot = String(specialPicker);
        button.dataset.seed = seed.id;
        picker.append(button);
      }
      wrap.append(picker);
    }
    if (specialSupplyPicker !== null) {
      const picker = div("garden-tools");
      picker.append(span("garden-hint", t("special.pickSupply")));
      const catalog = specialSupplyPicker.kind === "fertilize" ? FERTILIZERS : SPRAYS;
      for (const supply of catalog) {
        const owned = state?.bag.supplies[supply.id] ?? 0;
        const button = actionButton(
          `${t(`supplies.${supply.id}`)} (${owned})`,
          specialSupplyPicker.kind === "fertilize" ? "specialFertilize" : "specialSpray",
          owned > 0,
        );
        button.dataset.slot = String(specialSupplyPicker.slot);
        button.dataset.supply = supply.id;
        picker.append(button);
      }
      picker.append(span("garden-hint", t("special.buySupplyHint")));
      wrap.append(picker);
    }
  }

  /** @brief Crops and fruit trees the pending bulk-uproot filter would remove. */
  function uprootTargets(filter: {
    seed?: SeedId;
    tree?: TreeId;
    priceBelow?: number;
    profit?: "loss" | "win";
    dead?: boolean;
  }): { summary: string; count: number } {
    if (state === null || season === null) return { summary: "", count: 0 };
    const at = now();
    const counts = new Map<string, number>();
    let total = 0;
    const add = (name: string): void => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      total += 1;
    };
    const matches = (value: number, cost: number): boolean => {
      if (filter.priceBelow !== undefined && value >= filter.priceBelow) return false;
      if (filter.profit !== undefined) {
        const winning = value > cost;
        if (filter.profit === "win" ? !winning : winning) return false;
      }
      return true;
    };

    if (filter.tree === undefined) {
      for (const plot of state.plots) {
        if (plot === null || plot.favorite === true) continue;
        if (filter.seed !== undefined && plot.seed !== filter.seed) continue;
        if (plot.dead !== true) {
          if (filter.dead === true) continue;
          const value = cropSellPrice(
            { item: plot.seed, effects: resolvedCropEffects(plot, at), pest: plot.pest, star: 1, qty: 1 },
            season,
            activeHybrids(),
          );
          if (!matches(value, resolveSeed(plot.seed, activeHybrids())?.buy ?? 0)) continue;
        }
        add(seedName(plot.seed));
      }
    }

    if (filter.seed === undefined) {
      for (const tree of state.trees) {
        if (tree === null || tree.favorite === true) continue;
        if (filter.tree !== undefined && tree.tree !== filter.tree) continue;
        if (tree.dead !== true) {
          if (filter.dead === true) continue;
          const value = cropSellPrice(
            { item: tree.tree, effects: resolvedTreeEffects(tree, at), pest: tree.pest, star: 1, qty: 1 },
            season,
          );
          if (!matches(value, treeById(tree.tree)?.buy ?? 0)) continue;
        }
        add(treeName(tree.tree));
      }
    }

    return { summary: [...counts].map(([name, count]) => `${name} ×${count}`).join(", "), count: total };
  }

  /**
   * @brief Appends the tool and bulk-supply pickers opened by the quick actions.
   * @param wrap Panel that receives the pickers.
   * @details Shared by the legacy garden tab and the rebuilt board so both views
   * keep the same picker flow.
   */
  function appendToolPickers(wrap: HTMLElement): void {
    if (toolPicker === "plant") {
      const picker = div("garden-tools");
      const catalog = [...SEEDS, ...activeHybrids().map((hybrid) => hybridAsSeedDefinition(hybrid))];
      const ownedSeeds = catalog.filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0);
      if (ownedSeeds.length === 0) picker.append(span("garden-hint", t("garden.plantNoSeeds")));
      for (const seed of ownedSeeds) {
        const locked = seedLocked(seed.id);
        const button = actionButton(
          `${seedName(seed.id)} (${state?.bag.seeds[seed.id] ?? 0})${locked ? ` · P${seedPrestigeTier(seed.id)}` : ""}`,
          "pickPlantSeed",
          !locked,
        );
        button.dataset.seed = seed.id;
        picker.append(button);
      }
      wrap.append(picker);
    }
    if (toolPicker === "fertilize" || toolPicker === "spray") {
      const picker = div("garden-tools");
      const catalog = toolPicker === "fertilize" ? FERTILIZERS : SPRAYS;
      for (const supply of catalog) {
        const owned = state?.bag.supplies[supply.id] ?? 0;
        const button = actionButton(`${t(`supplies.${supply.id}`)} (${owned})`, "pickToolSupply", owned > 0);
        button.dataset.kind = toolPicker;
        button.dataset.supply = supply.id;
        picker.append(button);
      }
      wrap.append(picker);
    }
    if (bulkPanel === "plan") {
      const picker = div("garden-tools");
      const ownedSeeds = SEEDS.filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0);
      if (ownedSeeds.length === 0) picker.append(span("garden-hint", t("garden.plantNoSeeds")));
      for (const seed of ownedSeeds) {
        const locked = seedLocked(seed.id);
        const button = actionButton(
          `${t(`seeds.${seed.id}`)} (${state?.bag.seeds[seed.id] ?? 0})${locked ? ` · P${seedPrestigeTier(seed.id)}` : ""}`,
          "plantAllSeed",
          !locked,
        );
        button.dataset.seed = seed.id;
        picker.append(button);
      }
      wrap.append(picker);
    }
    if (toolPicker === "fertilizeAll" || toolPicker === "sprayAll") {
      const picker = div("garden-tools");
      const bulkKind = toolPicker === "fertilizeAll" ? "fertilize" : "spray";
      const catalog = bulkKind === "fertilize" ? FERTILIZERS : SPRAYS;
      const targets = supplyTargetCount(bulkKind, now());
      picker.append(
        span("garden-hint", t("garden.pickAllSupply", { count: targets, plants: t("garden.plants") })),
      );
      const coins = state?.coins ?? 0;
      for (const supply of catalog) {
        const unit = buyPriceOf(supply.id, supply.price);
        const affordable = unit <= 0 ? targets : Math.min(targets, Math.floor(coins / unit));
        const button = actionButton(
          `${t(`supplies.${supply.id}`)} · ${formatCompact(unit)}c × ${affordable}`,
          "quickSupplyAll",
          targets > 0 && affordable > 0,
        );
        button.dataset.kind = bulkKind;
        button.dataset.supply = supply.id;
        picker.append(button);
      }
      wrap.append(picker);
    }
  }

  /**
   * @brief Appends the bulk-uproot filter panel.
   * @param wrap Panel that receives the filter controls.
   */
  function appendUprootPanel(wrap: HTMLElement): void {
    if (bulkPanel !== "uproot") return;
    const panel = div("garden-tools");
    if (uprootPending !== null) {
      const targets = uprootTargets(uprootPending);
      panel.append(
        lineBlock(targets.count > 0 ? t("auto.preview", { crops: targets.summary }) : t("auto.previewEmpty")),
      );
      panel.append(
        actionButton(t("auto.confirmUproot"), "uprootConfirm", targets.count > 0),
        actionButton(t("auto.cancelUproot"), "uprootCancel"),
      );
      wrap.append(panel);
      return;
    }
    // One dropdown for "uproot exactly this plant", not a button per species.
    const planted = new Map<AnySeedId, number>();
    for (const plot of state?.plots ?? []) {
      if (plot === null) continue;
      planted.set(plot.seed, (planted.get(plot.seed) ?? 0) + 1);
    }
    const plantedTrees = new Map<TreeId, number>();
    for (const tree of state?.trees ?? []) {
      if (tree === null) continue;
      plantedTrees.set(tree.tree, (plantedTrees.get(tree.tree) ?? 0) + 1);
    }
    if (planted.size > 0 || plantedTrees.size > 0) {
      const select = document.createElement("select");
      select.className = "stage-input garden-uproot-select";
      select.dataset.role = "uprootPlant";
      select.setAttribute("aria-label", t("auto.pickPlant"));
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = t("auto.pickPlant");
      select.append(placeholder);
      if (planted.size > 0) {
        const group = document.createElement("optgroup");
        group.label = t("garden.crops");
        for (const [seed, count] of planted) {
          const option = document.createElement("option");
          option.value = `seed:${seed}`;
          option.textContent = `${seedName(seed)} ×${count}`;
          group.append(option);
        }
        select.append(group);
      }
      if (plantedTrees.size > 0) {
        const group = document.createElement("optgroup");
        group.label = t("garden.trees");
        for (const [tree, count] of plantedTrees) {
          const option = document.createElement("option");
          option.value = `tree:${tree}`;
          option.textContent = `${treeName(tree)} ×${count}`;
          group.append(option);
        }
        select.append(group);
      }
      select.addEventListener("change", () => {
        const [kind, id] = select.value.split(":");
        if (id === undefined || id.length === 0) return;
        uprootPending = kind === "tree" ? { tree: id as TreeId } : { seed: id as SeedId };
        render();
      });
      panel.append(select);
    }
    let deadCount = 0;
    for (const plot of state?.plots ?? []) {
      if (plot !== null && plot.dead === true && plot.favorite !== true) deadCount += 1;
    }
    for (const tree of state?.trees ?? []) {
      if (tree !== null && tree.dead === true && tree.favorite !== true) deadCount += 1;
    }
    panel.append(
      actionButton(t("auto.deadPlants", { count: deadCount }), "uprootDead", deadCount > 0),
      actionButton(t("auto.loss"), "uprootLoss"),
      actionButton(t("auto.win"), "uprootWin"),
    );
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.min = "0";
    priceInput.className = "stage-input garden-uproot-price";
    priceInput.placeholder = t("auto.price");
    priceInput.value = uprootPriceDraft;
    priceInput.dataset.role = "uprootPrice";
    priceInput.setAttribute("aria-label", t("auto.price"));
    panel.append(priceInput, actionButton(t("auto.uprootPrice"), "uprootPrice"));
    panel.append(span("garden-hint", t("auto.hint")));
    wrap.append(panel);
  }

  /** @brief Builds the garden tab: pager plus the crop grid and fruit stack. */
  function buildGarden(): HTMLElement {
    const wrap = div("garden-garden");
    wrap.append(buildPager());
    if (mode === "owner") {
      const at = now();
      const counts = bulkCounts(at);
      const coins = state?.coins ?? 0;

      wrap.append(lineBlock(`// ${t("quick.title")}`));
      const quick = div("garden-bulk");
      const waterAll = actionButton(
        t("garden.waterAll", { count: counts.water, cost: counts.water * WATER_ALL_COST }),
        "waterAll",
        counts.water > 0 && coins >= counts.water * WATER_ALL_COST,
      );
      waterAll.classList.add("garden-btn-water");
      const harvestAll = actionButton(
        t("garden.harvestAll", {
          count: counts.harvest,
          cost: counts.harvest * HARVEST_ALL_COST,
        }),
        "harvestAll",
        counts.harvest > 0 && coins >= counts.harvest * HARVEST_ALL_COST,
      );
      harvestAll.classList.add("garden-btn-harvest");
      quick.append(
        waterAll,
        harvestAll,
        actionButton(t("garden.sellAll"), "sellAll", (state?.bag.crops.length ?? 0) > 0),
      );
      const pestTargets =
        (state?.plots ?? []).filter(
          (plot, slot) => plot !== null && !cropSlotLocked(slot) && plot.protectedUntil <= at,
        ).length + (state?.trees ?? []).filter((tree) => tree !== null && tree.protectedUntil <= at).length;
      if (pestTargets > 0) {
        quick.append(
          actionButton(
            t("garden.sprayPestAll", {
              count: pestTargets,
              cost: pestTargets * PEST_SPRAY_COST,
            }),
            "sprayPestAll",
            coins >= pestTargets * PEST_SPRAY_COST,
          ),
        );
      }
      const soil = state?.soil ?? [];
      const renovateCost = soil.reduce((sum, fertility) => sum + soilRenovateCost(fertility), 0);
      quick.append(
        actionButton(
          t("garden.renovate", { cost: renovateCost }),
          "renovateSoil",
          renovateCost > 0 && coins >= renovateCost,
        ),
      );
      wrap.append(quick);

      wrap.append(lineBlock(`// ${t("mode.title")}`));
      const modes = div("garden-tools");
      const bulkFertilize = actionButton(t("mode.bulkFertilize"), "pickAllSupply");
      bulkFertilize.dataset.kind = "fertilize";
      const bulkSpray = actionButton(t("mode.bulkSpray"), "pickAllSupply");
      bulkSpray.dataset.kind = "spray";
      modes.append(actionButton(t("mode.bulkPlan"), "bulkPlan"), bulkFertilize, bulkSpray);
      wrap.append(modes);

      const tools = div("garden-tools");
      tools.append(span("garden-hint", t("garden.tools")));
      const fertilizeTool = actionButton(t("garden.useFertilizer"), "pickTool");
      fertilizeTool.dataset.kind = "fertilize";
      const sprayTool = actionButton(t("garden.useSpray"), "pickTool");
      sprayTool.dataset.kind = "spray";
      tools.append(
        fertilizeTool,
        sprayTool,
        actionButton(t("garden.plantQuick"), "pickPlantTool"),
        actionButton(t("garden.waterQuick"), "quickWater"),
        actionButton(t("garden.harvestQuick"), "quickHarvest"),
      );
      if (tool !== null) {
        const activeLabel =
          tool.kind === "water"
            ? t("garden.waterToolActive")
            : tool.kind === "harvest"
              ? t("garden.harvestToolActive")
              : tool.kind === "plant"
                ? t("garden.plantToolActive", {
                    seed: seedName(tool.seed),
                    left: state?.bag.seeds[tool.seed] ?? 0,
                  })
                : t("garden.toolActive", {
                    supply: t(`supplies.${tool.supply}`),
                    left: state?.bag.supplies[tool.supply] ?? 0,
                  });
        tools.append(
          span("garden-tool-active", activeLabel),
          actionButton(t("garden.toolCancel"), "cancelTool"),
        );
      }
      wrap.append(tools);

      appendToolPickers(wrap);

      wrap.append(lineBlock(`// ${t("auto.title")}`));
      const auto = div("garden-tools");
      auto.append(actionButton(t("auto.uproot"), "bulkUproot", true));
      wrap.append(auto);

      appendUprootPanel(wrap);

      wrap.append(lineBlock(`// ${t("staff.title")}`));
      wrap.append(buildStaffBar());

      wrap.append(lineBlock(`// ${t("attachments.title")}`));
      const attachRow = div("garden-tools");
      for (const slot of ["garden", "fire", "coop", "barn", "pond"] as const) {
        const current = state?.attachments?.[slot];
        if (current !== undefined) {
          const detach = actionButton(
            t("attachments.detach", { name: t(`attachments.${current}`) }),
            "detachMachine",
          );
          detach.dataset.slot = slot;
          attachRow.append(detach);
        } else {
          for (const attachment of ATTACHMENTS.filter((entry) => entry.slot === slot)) {
            const button = actionButton(
              t("attachments.install", {
                name: t(`attachments.${attachment.id}`),
                cost: formatCompact(attachment.price),
              }),
              "attachMachine",
              (state?.coins ?? 0) >= attachment.price,
            );
            button.dataset.slot = slot;
            button.dataset.id = attachment.id;
            attachRow.append(button);
          }
        }
      }
      wrap.append(attachRow);
    }
    wrap.append(buildSpecialBoard(now()));
    const layout = div("garden-layout");
    const boards = div("garden-boards");
    const cropPanel = div("garden-board-panel");
    cropPanel.append(span("garden-board-title", t("garden.crops")), buildCropBoard());
    const treePanel = div("garden-board-panel");
    treePanel.append(span("garden-board-title", t("garden.trees")), buildTreeBoard());
    boards.append(cropPanel, treePanel);
    layout.append(boards, buildSidebar(now()));
    wrap.append(layout);
    return wrap;
  }

  /** @brief Builds one animal cell on the same ASCII frame as a crop plot. */
  function animalCell(building: BuildingId, slot: number): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "garden-cell garden-animal-cell";
    cell.dataset.act = "patAnimal";
    cell.dataset.building = building;
    cell.dataset.slot = String(slot);
    for (let index = 0; index < 6; index += 1) {
      const line = document.createElement("span");
      line.className = "garden-cell-line";
      cell.append(line);
    }
    syncAnimalCell(cell, building, slot, now());
    return cell;
  }

  /** @brief Repaints one animal cell from the snapshot and clock. */
  function syncAnimalCell(cell: HTMLButtonElement, building: BuildingId, slot: number, at: number): void {
    const animal = state?.animals[building]?.[slot] ?? null;
    const render = animalCellRender(animal, at, slot);
    for (let index = 0; index < 6; index += 1) {
      const line = cell.children.item(index);
      if (line instanceof HTMLElement) line.textContent = render.lines[index] ?? "";
    }
    cell.classList.toggle("is-empty", render.empty);
    cell.classList.toggle("is-ready", render.ready);
    cell.classList.toggle("is-breeding", render.breeding);
    cell.dataset.act = render.empty ? "pickAnimal" : "animalSlot";
    const picker = farmPicker !== null && farmPicker.building === building && farmPicker.slot === slot;
    cell.classList.toggle("is-selected", picker);
    if (animal === null) {
      cell.title = t("farm.pickAnimal", { slot: slot + 1 });
      cell.setAttribute("aria-label", `${t("farm.emptySlot")} ${slot + 1}`);
      return;
    }
    const product = animalById(animal.kind)?.product;
    const productName = product === undefined ? "" : t(`products.${product}`);
    const tail = render.breeding
      ? `${t("farm.breeding")} · ${formatDuration(Math.max(0, (animal.incubatingUntil ?? 0) - at), "short")}`
      : `${productName} · ${render.ready ? t("farm.due") : formatDuration(render.remainingMs, "short")}`;
    const displayName = animal.hybridName ?? t(`animals.${animal.kind}`);
    cell.title = [
      `${displayName} · ${t("farm.quality")} ${render.stars}/5`,
      `${t("farm.pats")} ${animal.pats}`,
      tail,
    ].join(" · ");
    cell.setAttribute(
      "aria-label",
      `${t(`farm.${building}`)} · ${t("farm.slots")} ${slot + 1}: ${displayName}`,
    );
  }

  /** @brief Builds the animal shop rows for one empty slot. */
  function buildAnimalPicker(building: BuildingId, slot: number): HTMLElement {
    const wrap = div("garden-seeds");
    wrap.append(span("garden-hint", t("farm.pickAnimal", { slot: slot + 1 })));
    for (const animal of ANIMALS.filter(
      (entry) => entry.building === building && entry.id !== "hybridFish",
    )) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "garden-row";
      row.dataset.act = "buyAnimal";
      row.dataset.building = building;
      row.dataset.slot = String(slot);
      row.dataset.animal = animal.id;
      row.textContent = `${fitText(t(`animals.${animal.id}`), 9)}${fitText(`${formatCompact(animal.buy)}c`, 10)}${formatDuration(animalIntervalMs(animal.id), "short")}`;
      row.title = `${t(`animals.${animal.id}`)} · ${t(`products.${animal.product}`)}`;
      row.disabled = (state?.coins ?? 0) < animal.buy;
      wrap.append(row);
    }
    return wrap;
  }

  /** @brief Builds the construction tab: coop, barn, pond and their animals. */
  function buildFarm(): HTMLElement {
    const wrap = div("garden-farm");
    if (state === null) return lineBlock(t("common.loading"));
    wrap.append(lineBlock(`// ${t("farm.title")}`));
    const boards = div("garden-boards");
    for (const building of BUILDING_IDS) {
      const definition = buildingById(building);
      if (definition === undefined) continue;
      // A worker older than the pond serves no pond key at all: hide the panel
      // instead of offering a Build the backend would reject.
      const stored = state.buildings[building];
      if (building === "pond" && stored === undefined) continue;
      const level = stored ?? 0;
      const animals = state.animals[building] ?? [];
      const panel = div("garden-board-panel garden-farm-panel");
      const growth =
        building === "pond" && level > 0 ? ` · ${t("farm.growth")} ${state.pondGrowth ?? 0}%` : "";
      panel.append(
        span(
          "garden-board-title",
          `${t(`farm.${building}`)} · ${level > 0 ? `${t("farm.level")} ${level}/${maxBuildingLevel(building)} · ${animals.length} ${t("farm.slots")}${growth}` : t("farm.notBuilt")}`,
        ),
      );
      if (level === 0) {
        const build = actionButton(
          t("farm.build", { cost: formatCompact(definition.price) }),
          "buildBuilding",
          (state.coins ?? 0) >= definition.price,
        );
        build.dataset.building = building;
        panel.append(build);
        boards.append(panel);
        continue;
      }
      const upgradeCost = buildingUpgradeCost(building, level);
      const actions = div("garden-farm-actions");
      const upgrade = actionButton(
        level >= maxBuildingLevel(building)
          ? t("farm.maxLevel")
          : t("farm.upgrade", { cost: formatCompact(upgradeCost) }),
        "upgradeBuilding",
        level < maxBuildingLevel(building) && (state.coins ?? 0) >= upgradeCost,
      );
      upgrade.dataset.building = building;
      actions.append(upgrade);
      panel.append(actions);
      if (building === "pond") {
        const basins = Math.max(1, Math.floor(animals.length / POND_MAX_SLOTS));
        for (let b = 0; b < basins; b += 1) {
          const [start, end] = pondBasinSlotRange(b);
          const basinHeader = div("garden-board-title garden-pond-basin-header");
          basinHeader.textContent = t("farm.pondBasin", { index: b + 1 });
          panel.append(basinHeader);
          const grid = div("garden-animal-grid garden-pond-grid");
          for (let slot = start; slot < end; slot += 1) {
            grid.append(animalCell(building, slot));
          }
          panel.append(grid);
        }
      } else {
        const grid = div("garden-animal-grid");
        for (let slot = 0; slot < animals.length; slot += 1) grid.append(animalCell(building, slot));
        panel.append(grid);
      }
      if (farmPicker !== null && farmPicker.building === building) {
        panel.append(buildAnimalPicker(building, farmPicker.slot));
      }
      boards.append(panel);
    }
    wrap.append(boards);
    return wrap;
  }

  /** @brief Remaining cooldown or brew time of one machine. */
  function machineRemaining(built: MachineState, id: MachineId, at: number): number {
    const definition = machineById(id);
    if (definition === undefined) return 0;
    if (built.job !== undefined) return Math.max(0, built.job.readyAt - at);
    return Math.max(
      0,
      built.lastCraftAt + machineCycles(built.level, definition.cooldownCycles) * FARM_CYCLE_MS - at,
    );
  }

  /** @brief Opens the machine popover anchored on its warehouse row. */
  function openMachineMenu(id: MachineId, x: number, y: number, anchorTop = y): void {
    closeMenu();
    animalMenu = null;
    machineMenu = { id, x, y, anchorTop };
    render();
  }

  /** @brief Closes the machine popover. */
  function closeMachineMenu(): void {
    if (machineMenu === null) return;
    machineMenu = null;
    render();
  }

  /** @brief Keeps the machine popover inside the viewport. */
  function fitMachineMenu(): void {
    if (root === null || machineMenu === null) return;
    const element = root.querySelector<HTMLElement>(".garden-machine-menu");
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, machineMenu.x),
      Math.max(margin, window.innerWidth - rect.width - margin),
    );
    let top = machineMenu.y;
    if (top + rect.height > window.innerHeight - margin) {
      top = machineMenu.anchorTop - rect.height - 4;
    }
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  /** @brief Builds the machine popover: status, job and the input rows. */
  function buildMachineMenu(at: number): HTMLElement | null {
    if (machineMenu === null || state === null) return null;
    const definition = machineById(machineMenu.id);
    const built = state.warehouse.machines[machineMenu.id];
    if (definition === undefined || built === undefined) return null;

    const wrap = div("garden-menu garden-machine-menu");
    const head = div("garden-menu-head");
    head.append(
      span(
        "garden-menu-title",
        `${t(`machines.${definition.id}`)} · ${t("warehouse.level")} ${built.level}/${MACHINE_MAX_LEVEL}`,
      ),
    );
    const close = document.createElement("button");
    close.type = "button";
    close.className = "garden-menu-close";
    close.dataset.act = "machineMenuClose";
    close.textContent = "×";
    close.setAttribute("aria-label", t("common.close"));
    head.append(close);
    wrap.append(head);

    const remaining = machineRemaining(built, definition.id, at);
    const job = built.job;
    const info = document.createElement("pre");
    info.className = "garden-menu-info";
    const lines = [`// ${t("warehouse.machine")}`];
    if (job !== undefined) {
      lines.push(
        labelValue(
          t("warehouse.status"),
          job.readyAt <= at
            ? t("warehouse.jobReady")
            : t("warehouse.brewing", { item: materialName(job.item) }),
        ),
      );
    } else if (remaining > 0) {
      lines.push(labelValue(t("warehouse.status"), t("warehouse.cooling")));
    } else {
      lines.push(labelValue(t("warehouse.status"), t("warehouse.ready")));
    }
    if (job !== undefined) {
      lines.push(labelValue(t("warehouse.crafting"), materialName(job.item)));
    }
    if (definition.output.kind === "product") {
      const outputs = [
        definition.output.product,
        ...(definition.recipes?.map((recipe) => recipe.output) ?? []),
      ];
      lines.push(
        labelValue(
          t("warehouse.output"),
          [...new Set(outputs)].map((product) => t(`products.${product}`)).join(", "),
        ),
      );
    }
    if (definition.output.kind === "seeds") {
      const chance = Math.round(seedMakerChance(state.extras.prestige ?? 0) * 100);
      lines.push(labelValue(t("warehouse.seedChance"), `${chance}%`));
    }
    const queue = built.queue ?? [];
    lines.push(labelValue(t("warehouse.queue"), String(queue.length)));
    if (built.limit !== undefined) {
      lines.push(
        labelValue(t("warehouse.limitProgress"), `${Math.min(built.made ?? 0, built.limit)}/${built.limit}`),
      );
    }
    for (let index = 0; index < Math.min(5, queue.length); index += 1) {
      const job = queue[index];
      if (job === undefined) continue;
      lines.push(`  ${index + 1}. ${materialName(job.item)}`);
    }
    if (queue.length > 5) lines.push(`  … +${queue.length - 5}`);
    info.textContent = lines.join("\n");
    wrap.append(info);

    if (remaining > 0) {
      const timer = span("garden-hint", `${t("warehouse.remaining")} ${formatDuration(remaining, "short")}`);
      timer.dataset.machineUntil = String(at + remaining);
      wrap.append(timer);
    }

    const rows = div("garden-menu-rows");
    const upgrade = menuRow(
      built.level >= MACHINE_MAX_LEVEL
        ? t("farm.maxLevel")
        : t("warehouse.upgrade", { cost: formatCompact(MACHINE_PRICE) }),
      "machineUpgrade",
      {
        data: { machine: definition.id },
        disabled: built.level >= MACHINE_MAX_LEVEL || state.coins < MACHINE_PRICE,
      },
    );
    rows.append(upgrade);

    const qtyRow = div("garden-tools");
    qtyRow.append(span("garden-hint", t("warehouse.qty")));
    for (const qty of [1, 5, 10, 50]) {
      const button = actionButton(`x${qty}`, "machineQty");
      button.dataset.qty = String(qty);
      if (machineQty === qty) button.classList.add("is-active");
      qtyRow.append(button);
    }
    rows.append(qtyRow);

    const limitRow = div("garden-tools");
    const limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.min = "1";
    limitInput.className = "stage-input garden-machine-limit";
    limitInput.placeholder = t("warehouse.limit");
    limitInput.value = machineLimitDraft;
    limitInput.dataset.role = "machineLimit";
    limitInput.setAttribute("aria-label", t("warehouse.limit"));
    limitRow.append(limitInput, actionButton(t("warehouse.limitSet"), "machineLimitSet"));
    if (built.limit !== undefined) {
      limitRow.append(actionButton(t("warehouse.limitClear"), "machineLimitClear"));
    }
    rows.append(limitRow);

    if (job !== undefined && job.readyAt <= at) {
      rows.append(menuRow(t("warehouse.collect"), "machineCollect", { data: { machine: definition.id } }));
    }

    const busy = job !== undefined || remaining > 0;
    if (definition.input.kind === "product") {
      const inputs = [definition.input.product, ...(definition.recipes?.map((recipe) => recipe.input) ?? [])];
      for (const inputProduct of [...new Set(inputs)]) {
        const count =
          state.bag.products
            ?.filter((stack) => stack.product === inputProduct)
            .reduce((sum, stack) => sum + stack.qty, 0) ?? 0;
        const pair = div("garden-machine-row");
        pair.append(
          menuRow(`${t(`products.${inputProduct}`)} ×${count}`, "machineCraft", {
            data: { machine: definition.id, item: inputProduct },
            disabled: count < 1 || busy,
          }),
          menuRow(`+Q×${machineQty}`, "machineQueue", {
            data: { machine: definition.id, item: inputProduct },
            disabled: count < 1,
          }),
        );
        rows.append(pair);
      }
    } else {
      const allowed = definition.input.seeds;
      const allowFruit = definition.allProduce === true;
      const hybrids = state.hybrids;
      const items = (state.bag.crops ?? [])
        .filter(
          (stack) =>
            resolveSeed(stack.item, hybrids) !== undefined ||
            (allowFruit && treeById(stack.item) !== undefined),
        )
        .filter((stack) => allowed === undefined || allowed.includes(stack.item as never))
        .map((stack) => stack.item);
      for (const item of [...new Set(items)]) {
        const pair = div("garden-machine-row");
        pair.append(
          menuRow(`[ ${itemName(item)} ]`, "machineCraft", {
            data: { machine: definition.id, item },
            disabled: busy,
          }),
          menuRow(`+Q×${machineQty}`, "machineQueue", {
            data: { machine: definition.id, item },
          }),
        );
        rows.append(pair);
      }
      if (items.length === 0) {
        rows.append(menuRow(t("warehouse.noInput"), "machineNoop", { disabled: true }));
      }
    }

    if ((built.queue?.length ?? 0) > 0) {
      rows.append(
        menuRow(t("warehouse.clearQueue"), "machineClearQueue", {
          data: { machine: definition.id },
        }),
      );
    }
    rows.append(menuRow(t("common.close"), "machineMenuClose"));
    wrap.append(rows);
    return wrap;
  }

  /** @brief Confirmation dialog for the quick Sell-all button. */
  function buildSellAllDialog(): HTMLElement | null {
    if (sellAllDialog === null) return null;
    const wrap = div("garden-menu garden-sell-all-dialog");
    wrap.style.left = "50%";
    wrap.style.top = "30%";
    wrap.style.transform = "translateX(-50%)";
    const head = div("garden-menu-head");
    head.append(span("garden-menu-title", t("market.sellAllTitle")));
    head.append(
      (() => {
        const close = document.createElement("button");
        close.type = "button";
        close.className = "garden-menu-close";
        close.dataset.act = "sellAllCancel";
        close.textContent = "×";
        close.setAttribute("aria-label", t("common.close"));
        return close;
      })(),
    );
    wrap.append(head);
    const info = document.createElement("pre");
    info.className = "garden-menu-info";
    info.textContent = [
      t("market.sellAllSummary", { stacks: sellAllDialog.stacks, qty: sellAllDialog.qty }),
      labelValue(t("market.sellAllGross"), `${formatCompact(sellAllDialog.gross)}c`),
      labelValue(t("market.sellAllTax"), `-${formatCompact(sellAllDialog.gross - sellAllDialog.net)}c`),
      labelValue(t("market.sellAllNet"), `${formatCompact(sellAllDialog.net)}c`),
    ].join("\n");
    wrap.append(info);
    const rows = div("garden-menu-rows");
    rows.append(
      menuRow(t("market.sellAllConfirm"), "sellAllConfirm"),
      menuRow(t("auto.cancelUproot"), "sellAllCancel"),
    );
    wrap.append(rows);
    return wrap;
  }

  /** @brief Popover for one premium plot: info first, actions below. */
  function buildSpecialMenu(at: number): HTMLElement | null {
    if (specialMenu === null || state === null) return null;
    const view = specialView();
    const slot = specialMenu.slot;
    if (view === null || slot >= view.owned) return null;
    const plot = view.plots[slot] ?? null;
    const wrap = div("garden-menu garden-special-menu");
    const left = Math.min(Math.max(8, specialMenu.x), Math.max(8, window.innerWidth - 340 - 8));
    const top = Math.min(Math.max(8, specialMenu.y), Math.max(8, window.innerHeight - 160));
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;

    const head = div("garden-menu-head");
    const patch = Math.floor(slot / SPECIAL_PLOTS_PER_PATCH);
    const local = slot % SPECIAL_PLOTS_PER_PATCH;
    head.append(
      span(
        "garden-menu-title",
        `${t("special.title")} · V${patch + 1} · ${t("garden.plot", { slot: local + 1 })}`,
      ),
    );
    const close = document.createElement("button");
    close.type = "button";
    close.className = "garden-menu-close";
    close.dataset.act = "specialMenuClose";
    close.textContent = "×";
    close.setAttribute("aria-label", t("common.close"));
    head.append(close);
    wrap.append(head);

    const info = document.createElement("pre");
    info.className = "garden-menu-info";
    if (plot === null) {
      info.textContent = `${t("special.empty")}\n${t("special.pickSeed")}`;
    } else {
      const effects = resolvedCropEffects(plot, at, true);
      const star = SPECIAL_QUALITY_STARS;
      const value =
        season === null
          ? null
          : cropSellPrice(
              { item: plot.seed, effects, pest: plot.pest, star, qty: 1 },
              season,
              activeHybrids(),
            );
      const lines = [
        `// ${seedName(plot.seed)}`,
        labelValue(t("garden.stage"), at >= plot.readyAt ? t("garden.ripe") : t("garden.growing")),
        labelValue(
          t("garden.timeLeft"),
          at >= plot.readyAt ? t("special.ready") : formatDuration(plot.readyAt - at),
        ),
        labelValue(t("special.quality"), `${star}★`),
        labelValue(t("garden.effects"), effectBadge(effects) || t("side.none")),
        labelValue(t("side.value"), value === null ? "—" : `${formatCompact(value)}c`),
      ];
      if (effects.length > 1) lines.push(`// ${effectsMultiplier(effects)}x`);
      if (plot.watered) lines.push(`// ${t("garden.wateredAlready")}`);
      info.textContent = lines.join("\n");
    }
    wrap.append(info);

    const rows = div("garden-menu-rows");
    if (plot === null) {
      rows.append(menuRow(`[ ${t("special.plantHere")} ]`, "specialMenuPlant"));
    } else {
      if (at >= plot.readyAt) {
        rows.append(menuRow(`[ ${t("special.harvest")} ]`, "specialMenuHarvest"));
      } else if (!plot.watered) {
        rows.append(menuRow(`[ ${t("garden.water")} ]`, "specialMenuWater"));
      }
      rows.append(
        menuRow(`[ ${t("special.fertilize")} ]`, "specialMenuFertilize"),
        menuRow(`[ ${t("special.spray")} ]`, "specialMenuSpray"),
        menuRow(`[ ${t("garden.uproot")} ]`, "specialMenuUproot"),
      );
    }
    rows.append(menuRow(t("common.close"), "specialMenuClose"));
    wrap.append(rows);
    return wrap;
  }

  /** @brief Builds the warehouse tab: machines, levels and crafting. */
  function buildWarehouse(): HTMLElement {
    const wrap = div("garden-warehouse");
    if (state === null) return lineBlock(t("common.loading"));
    wrap.append(lineBlock(`// ${t("warehouse.title")}`));
    if (state.warehouse.level === 0) {
      wrap.append(
        actionButton(
          t("warehouse.build", { cost: formatCompact(WAREHOUSE_PRICE) }),
          "buildWarehouse",
          (state.coins ?? 0) >= WAREHOUSE_PRICE,
        ),
      );
      return wrap;
    }
    wrap.append(lineBlock(`// ${t("kitchen.title")}`));
    if (state.extras.kitchen === true) {
      wrap.append(lineBlock(t("kitchen.built")));
      wrap.append(actionButton(`🍳 ${t("kitchen.openKitchen")}`, "kitchenInfo"));
    } else {
      wrap.append(
        actionButton(
          t("kitchen.build", { cost: formatCompact(KITCHEN_PRICE) }),
          "buildKitchen",
          (state.coins ?? 0) >= KITCHEN_PRICE,
        ),
      );
      wrap.append(lineBlock(t("kitchen.hint")));
    }
    for (const machine of MACHINES) {
      const built = state.warehouse.machines[machine.id];
      const panel = div("garden-warehouse-machine");
      if (built === undefined) {
        panel.append(span("garden-farm-title", t(`machines.${machine.id}`)));
        panel.append(
          actionButton(
            t("warehouse.buildMachine", { cost: formatCompact(MACHINE_PRICE) }),
            "buildMachine",
            (state.coins ?? 0) >= MACHINE_PRICE,
          ).cloneNode(true) as HTMLButtonElement,
        );
        const button = panel.lastElementChild as HTMLButtonElement;
        button.dataset.machine = machine.id;
        button.dataset.act = "buildMachine";
      } else {
        const at = now();
        const remaining = machineRemaining(built, machine.id, at);
        const status =
          built.job !== undefined
            ? built.job.readyAt <= at
              ? t("warehouse.jobReady")
              : t("warehouse.brewing", { item: materialName(built.job.item) })
            : remaining > 0
              ? t("warehouse.cooling")
              : t("warehouse.ready");
        const queueCount = built.queue?.length ?? 0;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "garden-warehouse-row";
        row.dataset.act = "machineMenuOpen";
        row.dataset.machine = machine.id;
        const name = span("garden-warehouse-name", t(`machines.${machine.id}`));
        const level = span(
          `garden-warehouse-level is-level-${built.level}`,
          `${t("warehouse.level")} ${built.level}/${MACHINE_MAX_LEVEL}`,
        );
        const stateText = span("garden-warehouse-status", status);
        row.append(name, level, stateText);
        if (queueCount > 0) {
          row.append(span("garden-warehouse-queue", `+${queueCount}Q`));
        }
        if (built.limit !== undefined) {
          row.append(
            span("garden-warehouse-queue", `${Math.min(built.made ?? 0, built.limit)}/${built.limit}`),
          );
        }
        panel.append(row);
      }
      wrap.append(panel);
    }
    return wrap;
  }

  /** Glyphs representing each machine on its reborn plot cell. */
  const MACHINE_GLYPHS: Readonly<Record<MachineId, string>> = {
    seedMaker: ".",
    loom: "#",
    cheesePress: "O",
    mayoMaker: "o",
    pickleJar: "&",
    caviarFermenter: "*",
    oilPress: "~",
    dryer: "%",
    juicer: "!",
    jamMaker: "@",
    butterChurn: "=",
    keg: "U",
    smelter: "^",
  };

  /** Compact Vietnamese product names for 8-char plot cells. */
  const SHORT_PRODUCT_NAMES: Readonly<Record<string, string>> = {
    dried: "Đồ sấy",
    cheese: "Phô mai",
    goatCheese: "P.M Dê",
    copperBar: "Thỏi Đ",
    ironBar: "Thỏi S",
    goldBar: "Thỏi V",
    iridiumBar: "Thỏi Ir",
    caviar: "Caviar",
    mayo: "Mayo",
    duckMayo: "Mayo V",
    pickles: "Dưa muối",
    oil: "Dầu",
    juice: "Nước ép",
    jam: "Mứt",
    butter: "Bơ",
    wine: "Rượu",
    fabric: "Vải",
  };

  /** Compact English product names for 8-char plot cells. */
  const SHORT_PRODUCT_NAMES_EN: Readonly<Record<string, string>> = {
    dried: "Dried",
    cheese: "Cheese",
    goatCheese: "GoatChz",
    copperBar: "Cu Bar",
    ironBar: "Fe Bar",
    goldBar: "Au Bar",
    iridiumBar: "Ir Bar",
    caviar: "Caviar",
    mayo: "Mayo",
    duckMayo: "DuckMayo",
    pickles: "Pickles",
    oil: "Oil",
    juice: "Juice",
    jam: "Jam",
    butter: "Butter",
    wine: "Wine",
    fabric: "Fabric",
  };

  /**
   * @brief Resolves a short product name for fitting inside 8-char plot cells.
   * @param machine Machine definition from {@link MACHINES}.
   * @param inputItem Input item or product identifier.
   * @return Compact product display name (at most 7 chars).
   */
  function machineOutputShortName(machine: MachineDefinition, inputItem: string): string {
    const isEn = getLocale() === "en";
    const dict = isEn ? SHORT_PRODUCT_NAMES_EN : SHORT_PRODUCT_NAMES;
    const recipe = machine.recipes?.find((r) => r.input === inputItem);
    if (recipe !== undefined) {
      return dict[recipe.output] ?? recipe.output;
    }
    if (machine.output.kind === "product") {
      return dict[machine.output.product] ?? machine.output.product;
    }
    if (machine.output.kind === "seeds") {
      return isEn ? "Seeds" : "Hạt";
    }
    return isEn ? "Out" : "Sản phẩm";
  }

  /**
   * @brief Resolves the product or output name produced by a machine for a given input item.
   * @param machine Machine definition from {@link MACHINES}.
   * @param inputItem Input item or product identifier.
   * @return Localized product display name.
   */
  function machineOutputName(machine: MachineDefinition, inputItem: string): string {
    const recipe = machine.recipes?.find((r) => r.input === inputItem);
    if (recipe !== undefined) {
      return t(`products.${recipe.output}`);
    }
    if (machine.output.kind === "product") {
      return t(`products.${machine.output.product}`);
    }
    if (machine.output.kind === "seeds") {
      return t("warehouse.seedsOutput");
    }
    return t("warehouse.output");
  }

  /**
   * @brief Builds the plot action data for one warehouse machine cell.
   * @param machine Machine definition from {@link MACHINES}.
   * @param at Server-clock timestamp.
   * @return Plot cell action configuration with ASCII plot lines and active production state.
   */
  function machinePlotAction(machine: MachineDefinition, at: number): RebornAction {
    const built = state?.warehouse.machines[machine.id];
    const name = t(`machines.${machine.id}.plot`);
    const fullTitle = t(`machines.${machine.id}`);

    if (built === undefined) {
      const cost = MACHINE_PRICE;
      const canAfford = (state?.coins ?? 0) >= cost;
      const costStr = `${formatCompact(cost)}c`;
      const lines = [
        `+${"-".repeat(CELL_INNER)}+`,
        `|${fitText(name, CELL_INNER, "center")}|`,
        `|${fitText(t("warehouse.unbuilt"), CELL_INNER, "center")}|`,
        `|${fitText(t("warehouse.clickToBuild"), CELL_INNER, "center")}|`,
        `|${fitText(costStr, CELL_INNER, "center")}|`,
        `+${"-".repeat(CELL_INNER)}+`,
      ];
      return {
        id: `machine:${machine.id}`,
        label: name,
        glyph: "+",
        note: costStr,
        tone: "money",
        act: "buildMachine",
        data: { machine: machine.id },
        title: `${fullTitle} · ${t("warehouse.buildMachine", { cost: costStr })}`,
        disabled: !canAfford,
        lines,
      };
    }

    const remaining = machineRemaining(built, machine.id, at);
    const queueCount = built.queue?.length ?? 0;
    const isReady = built.job !== undefined && built.job.readyAt <= at;
    const isBrewing = built.job !== undefined && built.job.readyAt > at;
    const glyph = MACHINE_GLYPHS[machine.id] ?? "M";
    const levelTag = `Lv.${built.level}`;
    const levelDashes = Math.max(0, CELL_INNER - levelTag.length);
    const levelLeft = Math.floor(levelDashes / 2);
    const levelRight = levelDashes - levelLeft;
    const topBorder = `+${"-".repeat(levelLeft)}${levelTag}${"-".repeat(levelRight)}+`;

    const queueTag = queueCount > 0 ? `+${queueCount}Q` : "";
    let bottomBorder = `+${"-".repeat(CELL_INNER)}+`;
    if (queueTag.length > 0) {
      const qDashes = Math.max(0, CELL_INNER - queueTag.length);
      const qLeft = Math.floor(qDashes / 2);
      const qRight = qDashes - qLeft;
      bottomBorder = `+${"-".repeat(qLeft)}${queueTag}${"-".repeat(qRight)}+`;
    }

    if (isReady && built.job !== undefined) {
      const inName = materialName(built.job.item);
      const outShort = machineOutputShortName(machine, built.job.item);
      const outFull = machineOutputName(machine, built.job.item);
      const lines = [
        topBorder,
        `|${fitText(name, CELL_INNER, "center")}|`,
        `|${fitText(inName, CELL_INNER, "center")}|`,
        `|${fitText(`➔ ${outShort}`, CELL_INNER, "center")}|`,
        `|${fitText("✨ Xong!", CELL_INNER, "center")}|`,
        bottomBorder,
      ];
      return {
        id: `machine:${machine.id}`,
        label: name,
        glyph: "✨",
        note: t("warehouse.jobReady"),
        tone: "harvest",
        active: true,
        act: "machineMenuOpen",
        data: { machine: machine.id },
        title: `${fullTitle} · ${levelTag}/${MACHINE_MAX_LEVEL} · ${t("warehouse.jobReady")}: ${inName} ➔ ${outFull}${queueCount > 0 ? ` · +${queueCount}Q` : ""}`,
        lines,
      };
    }

    if (isBrewing && built.job !== undefined) {
      const inName = materialName(built.job.item);
      const outShort = machineOutputShortName(machine, built.job.item);
      const outFull = machineOutputName(machine, built.job.item);
      const timeStr = formatDuration(built.job.readyAt - at, "short");
      const lines = [
        topBorder,
        `|${fitText(name, CELL_INNER, "center")}|`,
        `|${fitText(inName, CELL_INNER, "center")}|`,
        `|${fitText(`➔ ${outShort}`, CELL_INNER, "center")}|`,
        `|${fitText(`⏱ ${timeStr}`, CELL_INNER, "center")}|`,
        bottomBorder,
      ];
      return {
        id: `machine:${machine.id}`,
        label: name,
        glyph,
        note: timeStr,
        tone: "water",
        active: true,
        act: "machineMenuOpen",
        data: { machine: machine.id },
        title: `${fullTitle} · ${levelTag}/${MACHINE_MAX_LEVEL} · ${t("warehouse.crafting")}: ${inName} ➔ ${outFull} · ⏱ ${timeStr}${queueCount > 0 ? ` · +${queueCount}Q` : ""}`,
        lines,
      };
    }

    if (remaining > 0) {
      const timeStr = formatDuration(remaining, "short");
      const lines = [
        topBorder,
        `|${fitText(name, CELL_INNER, "center")}|`,
        `|${fitText(t("warehouse.cooling"), CELL_INNER, "center")}|`,
        `|${fitText(t("warehouse.machineResting"), CELL_INNER, "center")}|`,
        `|${fitText(`❄ ${timeStr}`, CELL_INNER, "center")}|`,
        bottomBorder,
      ];
      return {
        id: `machine:${machine.id}`,
        label: name,
        glyph,
        note: timeStr,
        tone: "tool",
        act: "machineMenuOpen",
        data: { machine: machine.id },
        title: `${fullTitle} · ${levelTag}/${MACHINE_MAX_LEVEL} · ${t("warehouse.cooling")}: ${timeStr}${queueCount > 0 ? ` · +${queueCount}Q` : ""}`,
        lines,
      };
    }

    // Idle
    const limitInfo =
      built.limit !== undefined ? `${Math.min(built.made ?? 0, built.limit)}/${built.limit}` : null;
    const lines = [
      topBorder,
      `|${fitText(name, CELL_INNER, "center")}|`,
      `|${fitText(t("warehouse.idle"), CELL_INNER, "center")}|`,
      `|${fitText(queueCount > 0 ? `+${queueCount}Q` : t("warehouse.readyHint"), CELL_INNER, "center")}|`,
      `|${fitText(limitInfo ?? t("warehouse.ready"), CELL_INNER, "center")}|`,
      bottomBorder,
    ];
    return {
      id: `machine:${machine.id}`,
      label: name,
      glyph,
      note: levelTag,
      tone: queueCount > 0 ? "fertilizer" : "default",
      act: "machineMenuOpen",
      data: { machine: machine.id },
      title: `${fullTitle} · ${levelTag}/${MACHINE_MAX_LEVEL} · ${t("warehouse.ready")}${queueCount > 0 ? ` · +${queueCount}Q` : ""}${limitInfo ? ` · ${limitInfo}` : ""}`,
      lines,
    };
  }

  /**
   * @brief Builds the reborn warehouse tab: each machine is an individual ASCII plot cell.
   * @param at Server-clock timestamp.
   * @return The warehouse container with the machine plots grid.
   */
  function buildWarehouseReborn(at: number): HTMLElement {
    const wrap = div("garden-warehouse-reborn");
    if (state === null) return lineBlock(t("common.loading"));
    wrap.append(lineBlock(`// ${t("warehouse.title")} · ${t("gardenTab.warehouse")}`));
    if (state.warehouse.level === 0) {
      wrap.append(
        buildRebornAction({
          id: "buildWarehouse",
          label: t("warehouse.title"),
          glyph: "+",
          note: `${formatCompact(WAREHOUSE_PRICE)}c`,
          tone: "money",
          act: "buildWarehouse",
          title: t("warehouse.build", { cost: formatCompact(WAREHOUSE_PRICE) }),
          disabled: (state.coins ?? 0) < WAREHOUSE_PRICE,
        }),
      );
      return wrap;
    }

    const grid = div("garden-warehouse-plots");
    for (const machine of MACHINES) {
      const cell = buildRebornAction(machinePlotAction(machine, at));
      cell.classList.add("garden-warehouse-cell");
      grid.append(cell);
    }
    wrap.append(grid);

    wrap.append(lineBlock(`// ${t("kitchen.title")}`));
    const kitchenGrid = div("garden-warehouse-plots");
    if (state.extras.kitchen === true) {
      kitchenGrid.append(
        buildRebornAction({
          id: "kitchen",
          label: t("kitchen.title"),
          glyph: "K",
          note: t("kitchen.built"),
          tone: "harvest",
          act: "kitchenInfo",
          title: `${t("kitchen.title")} · ${t("kitchen.built")}`,
        }),
      );
    } else {
      kitchenGrid.append(
        buildRebornAction({
          id: "buildKitchen",
          label: t("kitchen.title"),
          glyph: "+",
          note: `${formatCompact(KITCHEN_PRICE)}c`,
          tone: "money",
          act: "buildKitchen",
          title: t("kitchen.build", { cost: formatCompact(KITCHEN_PRICE) }),
          disabled: (state.coins ?? 0) < KITCHEN_PRICE,
        }),
      );
    }
    wrap.append(kitchenGrid);
    if (state.extras.kitchen === true) {
      wrap.append(actionButton(`🍳 ${t("kitchen.openKitchen")}`, "kitchenInfo"));
    }
    return wrap;
  }

  /**
   * @brief Builds the reborn kitchen tab: cooking stove, cooldown timers, ingredient checks,
   * AI recipe creation lab, and global community cookbook.
   * @param at Server-clock timestamp.
   * @return Kitchen container element with all cooking and recipe workflows.
   */
  function buildKitchenTab(at: number): HTMLElement {
    const wrap = div("garden-kitchen-reborn");
    if (state === null) return lineBlock(t("common.loading"));

    // 1. Header
    wrap.append(lineBlock(`// ${t("kitchen.title")} · ${t("gardenTab.kitchen")}`));

    // 2. Kitchen Status / Build Gate
    if (state.extras.kitchen !== true) {
      wrap.append(
        buildRebornAction({
          id: "buildKitchen",
          label: t("kitchen.title"),
          glyph: "+",
          note: `${formatCompact(KITCHEN_PRICE)}c`,
          tone: "money",
          act: "buildKitchen",
          title: t("kitchen.build", { cost: formatCompact(KITCHEN_PRICE) }),
          disabled: (state.coins ?? 0) < KITCHEN_PRICE,
        }),
      );
      wrap.append(lineBlock(t("kitchen.hint")));
      wrap.append(lineBlock(t("kitchen.required")));
      return wrap;
    }

    wrap.append(lineBlock(`🍳 ${t("kitchen.built")}`));

    // 3. Cooking Stove & Learned Recipes
    const stoveSection = div("garden-kitchen-section");
    stoveSection.append(lineBlock(`// ${t("kitchen.stove")} (${(state.extras.recipes ?? []).length})`));

    const recipes = state.extras.recipes ?? [];
    if (recipes.length === 0) {
      stoveSection.append(lineBlock(t("kitchen.noRecipes")));
    } else {
      let countCookable = 0;
      let countMissing = 0;
      let countCooldown = 0;

      for (const recipe of recipes) {
        const hasAll = recipe.inputs.every((input) => countMaterialInBag(input) >= 1);
        const lastCooked = state.extras.recipeCookedAt?.[recipe.id] ?? 0;
        const elapsed = at - lastCooked;
        const remaining = Math.max(0, DAY_MS - elapsed);
        const inCooldown = remaining > 0;

        if (inCooldown) countCooldown += 1;
        if (hasAll && !inCooldown) countCookable += 1;
        if (!hasAll) countMissing += 1;
      }

      const uniqueIngredients = Array.from(new Set(recipes.flatMap((r) => r.inputs))).sort((a, b) =>
        materialName(a).localeCompare(materialName(b)),
      );

      // Filter Toolbar
      const toolbar = div("garden-kitchen-toolbar");

      const searchRow = div("garden-kitchen-search-row");
      const searchInput = document.createElement("input");
      searchInput.type = "search";
      searchInput.className = "stage-input garden-kitchen-search";
      searchInput.placeholder = t("kitchen.searchPlaceholder");
      searchInput.value = kitchenQuery;
      searchInput.dataset.role = "kitchenSearch";
      searchInput.setAttribute("aria-label", t("kitchen.searchPlaceholder"));
      searchRow.append(searchInput);

      if (uniqueIngredients.length > 0) {
        const ingSelect = document.createElement("select");
        ingSelect.className = "stage-input garden-kitchen-select";
        ingSelect.dataset.role = "kitchenIngredientSelect";
        ingSelect.setAttribute("aria-label", t("kitchen.ingredientFilter"));
        const allOpt = document.createElement("option");
        allOpt.value = "";
        allOpt.textContent = `-- ${t("kitchen.allIngredients")} --`;
        ingSelect.append(allOpt);
        for (const ing of uniqueIngredients) {
          const opt = document.createElement("option");
          opt.value = ing;
          const count = recipes.filter((r) => r.inputs.includes(ing)).length;
          opt.textContent = `${materialName(ing)} (${count})`;
          if (kitchenIngredientFilter === ing) opt.selected = true;
          ingSelect.append(opt);
        }
        searchRow.append(ingSelect);
      }
      toolbar.append(searchRow);

      const filterChips = div("garden-kitchen-filter-chips");
      const allBtn = actionButton(t("kitchen.filterAll", { count: recipes.length }), "kitchenFilter");
      allBtn.dataset.filter = "all";
      if (kitchenStatusFilter === "all") allBtn.classList.add("is-active");
      filterChips.append(allBtn);

      const cookableBtn = actionButton(
        t("kitchen.filterCookable", { count: countCookable }),
        "kitchenFilter",
      );
      cookableBtn.dataset.filter = "cookable";
      if (kitchenStatusFilter === "cookable") cookableBtn.classList.add("is-active");
      filterChips.append(cookableBtn);

      const missingBtn = actionButton(t("kitchen.filterMissing", { count: countMissing }), "kitchenFilter");
      missingBtn.dataset.filter = "missing";
      if (kitchenStatusFilter === "missing") missingBtn.classList.add("is-active");
      filterChips.append(missingBtn);

      const cooldownBtn = actionButton(
        t("kitchen.filterCooldown", { count: countCooldown }),
        "kitchenFilter",
      );
      cooldownBtn.dataset.filter = "cooldown";
      if (kitchenStatusFilter === "cooldown") cooldownBtn.classList.add("is-active");
      filterChips.append(cooldownBtn);

      if (kitchenQuery.trim() !== "" || kitchenStatusFilter !== "all" || kitchenIngredientFilter !== "") {
        const clearBtn = actionButton(`× ${t("kitchen.clearFilters")}`, "kitchenClearFilters");
        clearBtn.classList.add("is-danger");
        filterChips.append(clearBtn);
      }

      toolbar.append(filterChips);
      stoveSection.append(toolbar);

      const query = kitchenQuery.trim();
      const queryLower = query.toLowerCase();
      const queryFolded = foldDiacritics(query);

      let visibleCount = 0;
      for (const recipe of recipes) {
        const hasAll = recipe.inputs.every((input) => countMaterialInBag(input) >= 1);
        const lastCooked = state.extras.recipeCookedAt?.[recipe.id] ?? 0;
        const elapsed = at - lastCooked;
        const remaining = Math.max(0, DAY_MS - elapsed);
        const inCooldown = remaining > 0;

        let matchStatus = true;
        if (kitchenStatusFilter === "cookable" && (!hasAll || inCooldown)) matchStatus = false;
        else if (kitchenStatusFilter === "missing" && hasAll) matchStatus = false;
        else if (kitchenStatusFilter === "cooldown" && !inCooldown) matchStatus = false;

        let matchIng = true;
        if (kitchenIngredientFilter !== "" && !recipe.inputs.includes(kitchenIngredientFilter)) {
          matchIng = false;
        }

        const inputNames = recipe.inputs.map(materialName).join(" ");
        const searchableText = `${recipe.output} ${inputNames} ${recipe.inputs.join(" ")}`;
        let matchQuery = true;
        if (query.length > 0) {
          matchQuery =
            searchableText.toLowerCase().includes(queryLower) ||
            foldDiacritics(searchableText).includes(queryFolded);
        }

        const isVisible = matchStatus && matchIng && matchQuery;
        if (isVisible) visibleCount += 1;

        const card = div("garden-kitchen-card");
        card.dataset.search = searchableText;
        card.dataset.matchStatus = String(matchStatus);
        card.dataset.matchIng = String(matchIng);
        if (!isVisible) card.hidden = true;

        // Head: Dish name & Base value
        const head = div("garden-kitchen-card-head");
        head.append(span("garden-farm-title", `🍲 ${recipe.output}`));
        head.append(span("garden-gold-tag", `${formatCompact(recipe.price)}c`));
        card.append(head);

        // Ingredients with real-time stock from crops & products
        const ingContainer = div("garden-kitchen-card-ingredients");
        for (const input of recipe.inputs) {
          const count = countMaterialInBag(input);
          const name = materialName(input);
          const isEnough = count >= 1;
          const tag = document.createElement("button");
          tag.type = "button";
          const activeTagClass = kitchenIngredientFilter === input ? "is-active-filter" : "";
          tag.className =
            `garden-kitchen-ing-tag ${isEnough ? "is-enough" : "is-missing"} ${activeTagClass}`.trim();
          tag.dataset.act = "kitchenPickIngredient";
          tag.dataset.ing = input;
          tag.title = t("kitchen.filterByIngredient", { name });
          tag.textContent = `${name} (${count >= 1 ? `x${count}` : t("kitchen.missingIng")})`;
          ingContainer.append(tag);
        }
        card.append(ingContainer);

        // Foot: Cooldown timer & Cook button
        const foot = div("garden-kitchen-card-foot");
        const statusLabel = span(
          "garden-kitchen-status",
          inCooldown
            ? `⏳ ${t("kitchen.cooldown", { time: formatDuration(remaining, "short") })}`
            : hasAll
              ? `✨ ${t("kitchen.ready")}`
              : `⚠️ ${t("kitchen.missingIng")}`,
        );
        foot.append(statusLabel);

        const canCook = hasAll && !inCooldown && state.extras.kitchen === true;
        const cookBtn = actionButton(
          inCooldown ? formatDuration(remaining, "short") : t("recipe.cook"),
          "cookRecipe",
          canCook,
        );
        cookBtn.dataset.id = recipe.id;
        foot.append(cookBtn);

        card.append(foot);
        stoveSection.append(card);
      }

      const emptyNotice = lineBlock(t("kitchen.noMatch"));
      emptyNotice.className = "garden-kitchen-empty-filter";
      if (visibleCount > 0) emptyNotice.hidden = true;
      stoveSection.append(emptyNotice);
    }
    wrap.append(stoveSection);

    // 4. AI Recipe Creation Lab
    const labSection = div("garden-kitchen-section garden-market-panel");
    const ingredientList = document.createElement("datalist");
    ingredientList.id = "kitchen-recipe-ingredients";
    for (const seed of SEEDS) {
      const option = document.createElement("option");
      option.value = seed.id;
      option.label = t(`seeds.${seed.id}`);
      ingredientList.append(option);
    }
    for (const tree of TREES) {
      const option = document.createElement("option");
      option.value = tree.id;
      option.label = t(`trees.${tree.id}`);
      ingredientList.append(option);
    }
    for (const product of PRODUCTS) {
      const option = document.createElement("option");
      option.value = product.id;
      option.label = t(`products.${product.id}`);
      ingredientList.append(option);
    }
    labSection.append(ingredientList);

    labSection.append(lineBlock(`// ${t("recipe.title")}`));
    const recipeRow = div("garden-restore-row");
    recipeInputs.forEach((value, index) => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "stage-input";
      input.value = value;
      input.placeholder = t("recipe.ingredient", { index: index + 1 });
      input.dataset.role = "recipeInput";
      input.dataset.index = String(index);
      input.setAttribute("list", "kitchen-recipe-ingredients");
      input.setAttribute("aria-label", t("recipe.ingredient", { index: index + 1 }));
      recipeRow.append(input);
      if (recipeInputs.length > 2) {
        const remove = actionButton("×", "recipeRemoveInput");
        remove.dataset.index = String(index);
        recipeRow.append(remove);
      }
    });
    if (recipeInputs.length < 6) {
      recipeRow.append(actionButton(t("recipe.addIngredient"), "recipeAddInput"));
    }
    labSection.append(recipeRow, actionButton(t("recipe.suggest"), "recipeSuggest"));
    if (recipeResult.length > 0) labSection.append(lineBlock(recipeResult));
    wrap.append(labSection);

    // 5. Global Community Recipes
    if (globalRecipes.length > 0) {
      const globalSection = div("garden-kitchen-section");
      globalSection.append(lineBlock(`// ${t("recipe.global")} (${globalRecipes.length})`));
      for (const recipe of globalRecipes) {
        const row = div("garden-machine-row");
        const formattedInputs = recipe.inputs.map(materialName).join(" + ");
        row.append(lineBlock(`${formattedInputs} → ${recipe.output} · ${formatCompact(recipe.price)}c`));
        const alreadyLearned = (state.extras.recipes ?? []).some((r) => r.id === recipe.id);
        if (alreadyLearned) {
          row.append(span("garden-learned-tag", `[ ${t("recipe.learned")} ]`));
        } else {
          const learn = actionButton(t("recipe.learn"), "recipeLearn");
          learn.dataset.id = recipe.id;
          row.append(learn);
        }
        globalSection.append(row);
      }
      wrap.append(globalSection);
    }

    return wrap;
  }

  /**
   * @brief Builds the reborn mine tab: 5x5 rock grid, ladder, checkpoint elevators,
   * pickaxe upgrades, stamina pool, and dedicated staff miner slot.
   * @param at Server-clock timestamp.
   * @return Mine container element.
   */
  function buildMineReborn(at: number): HTMLElement {
    const wrap = div("garden-mine-reborn");
    if (!state) return lineBlock(t("common.loading"));

    const mine: MineState = state.mine ?? initialMineState(at);
    const tier: PickaxeTier = PICKAXE_TIERS[mine.pickaxeLevel] ?? (PICKAXE_TIERS[0] as PickaxeTier);

    // 1. Header with Depth, Max Depth, Stamina
    wrap.append(
      lineBlock(
        `// ${t("mine.title")} · ${t("mine.floor")} ${mine.currentFloor} · (Max: ${mine.maxFloor}) · ⚡ ${mine.stamina}/${mine.maxStamina} · ${t(`pickaxe.${mine.pickaxeLevel}`)} (DMG: ${tier.damage})`,
      ),
    );

    // 2. Control bar: Elevator Checkpoints & Pickaxe Upgrade & Eat Stamina
    const controls = div("garden-mine-controls");

    // Elevator buttons
    const checkpoints = mineElevatorCheckpoints(mine.maxFloor);
    if (checkpoints.length > 1) {
      const elevatorBar = div("garden-mine-elevators");
      elevatorBar.append(span("garden-hint", `[ ${t("mine.elevator")} ]: `));
      for (const f of checkpoints) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `garden-action-btn ${f === mine.currentFloor ? "is-active" : ""}`;
        btn.dataset.act = "mineElevator";
        btn.dataset.targetFloor = String(f);
        btn.textContent = `T${f}`;
        elevatorBar.append(btn);
      }
      controls.append(elevatorBar);
    }

    // Top action row: Miner Slot cell & Pickaxe Upgrade & Eat Stamina
    const topRow = div("garden-mine-top-row");

    // Dedicated Staff Miner Slot cell
    const assignedWorkerIndex = mine.assignedStaffSlot;
    const staffList = state.extras?.staff ?? [];
    const assignedWorker =
      typeof assignedWorkerIndex === "number" && assignedWorkerIndex >= 0
        ? staffList[assignedWorkerIndex]
        : null;

    if (assignedWorker) {
      topRow.append(
        buildRebornAction({
          id: "minerSlot",
          label: assignedWorker.name,
          glyph: "M",
          note: `Lv.${assignedWorker.level} · Đang đào`,
          tone: "tool",
          act: "minerSlotToggle",
          title: `Thợ mỏ: ${assignedWorker.name} (Lv.${assignedWorker.level}) · Bấm để đổi/gỡ`,
        }),
      );
    } else {
      topRow.append(
        buildRebornAction({
          id: "minerSlot",
          label: t("mine.minerSlot"),
          glyph: "+",
          note: t("mine.assignMiner"),
          tone: "money",
          act: "minerSlotToggle",
          title: t("mine.assignMiner"),
        }),
      );
    }

    // Pickaxe upgrade cell
    const nextTier = PICKAXE_TIERS[mine.pickaxeLevel + 1];
    if (nextTier) {
      let haveBars = 0;
      if (nextTier.barType) {
        for (const p of state.bag.products ?? []) {
          if (p.product === nextTier.barType) haveBars += p.qty;
        }
      }
      const canUpgrade =
        (state.coins ?? 0) >= nextTier.cost && (!nextTier.barCount || haveBars >= nextTier.barCount);
      const barLabel = nextTier.barType ? t(`products.${nextTier.barType}`) : "";
      topRow.append(
        buildRebornAction({
          id: "upgradePickaxe",
          label: t(`pickaxe.${nextTier.level}`),
          glyph: "^",
          note: nextTier.barCount
            ? `${haveBars}/${nextTier.barCount} ${barLabel} · ${formatCompact(nextTier.cost)}c`
            : `${formatCompact(nextTier.cost)}c`,
          tone: canUpgrade ? "money" : "default",
          act: "upgradePickaxe",
          title: `${t("mine.upgradePickaxe")} (DMG: ${nextTier.damage})`,
          disabled: !canUpgrade,
        }),
      );
    }

    // Eat produce to restore stamina cell
    if (mine.stamina < mine.maxStamina) {
      const edibleProduct = (state.bag.products ?? []).find((p) => p.qty > 0);
      if (edibleProduct) {
        topRow.append(
          buildRebornAction({
            id: "mineEat",
            label: t("mine.eatToRestore"),
            glyph: "E",
            note: `${t(`products.${edibleProduct.product}`)} (${edibleProduct.qty})`,
            tone: "harvest",
            act: "mineEat",
            data: { item: edibleProduct.product },
            title: `Ăn ${t(`products.${edibleProduct.product}`)} để hồi thể lực`,
          }),
        );
      }
    }

    controls.append(topRow);
    wrap.append(controls);

    // Miner assignment popover / picker
    if (minerMenuOpen) {
      const pickerWrap = div("garden-miner-picker");
      pickerWrap.append(lineBlock(`// ${t("mine.assignMiner")}`));
      if (staffList.length === 0) {
        pickerWrap.append(lineBlock("Chưa có nhân viên nào. Vào Chợ lao động để thuê!"));
      } else {
        staffList.forEach((worker, idx) => {
          const isCurrent = idx === mine.assignedStaffSlot;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `garden-action-btn ${isCurrent ? "is-active" : ""}`;
          btn.dataset.act = "assignMinerSlot";
          btn.dataset.staffSlot = String(idx);
          btn.textContent = `${isCurrent ? "✓ " : ""}${worker.name} (Lv.${worker.level} · ${t(`staffRole.${worker.role}`)})`;
          pickerWrap.append(btn);
        });
        if (mine.assignedStaffSlot !== null) {
          const unassignBtn = document.createElement("button");
          unassignBtn.type = "button";
          unassignBtn.className = "garden-action-btn is-danger";
          unassignBtn.dataset.act = "unassignMinerSlot";
          unassignBtn.textContent = `[ ${t("mine.unassignMiner")} ]`;
          pickerWrap.append(unassignBtn);
        }
      }
      wrap.append(pickerWrap);
    }

    // 3. 5x5 Mine Rock Grid
    const grid = div("garden-mine-grid");
    const ROCK_GLYPHS: Record<MineRockKind, string> = {
      stone: "#",
      gravel: ".",
      copper: "c",
      iron: "i",
      gold: "g",
      iridium: "I",
      gem: "♦",
      chest: "?",
      ladder: "v",
      empty: " ",
    };

    const ROCK_TONES: Record<MineRockKind, string> = {
      stone: "default",
      gravel: "default",
      copper: "warning",
      iron: "tool",
      gold: "money",
      iridium: "rare",
      gem: "rare",
      chest: "rainbow",
      ladder: "harvest",
      empty: "default",
    };

    mine.grid.forEach((cell, slot) => {
      if (cell.kind === "ladder") {
        grid.append(
          buildRebornAction({
            id: `mine-cell-${slot}`,
            label: t("mine.descend"),
            glyph: "v",
            note: `T${mine.currentFloor + 1} ↓`,
            tone: "harvest",
            act: "mineDescend",
            title: t("mine.descend"),
          }),
        );
      } else if (cell.kind === "empty") {
        const emptyCell = buildRebornAction({
          id: `mine-cell-${slot}`,
          label: "",
          glyph: " ",
          note: "",
          tone: "default",
          act: "noop",
          title: "",
          disabled: true,
        });
        emptyCell.classList.add("is-empty-mine-cell");
        grid.append(emptyCell);
      } else {
        const name =
          cell.kind === "chest" ? "Rương báu" : cell.oreDrop ? t(`products.${cell.oreDrop}`) : cell.kind;
        const cellAction = buildRebornAction({
          id: `mine-cell-${slot}`,
          label: name,
          glyph: ROCK_GLYPHS[cell.kind] ?? "#",
          note: `${cell.hp}/${cell.maxHp} HP`,
          tone: ROCK_TONES[cell.kind] ?? "default",
          act: "mineHit",
          data: { slot: String(slot) },
          title: `${name} · ${cell.hp}/${cell.maxHp} HP · Tiêu hao 2 thể lực`,
          disabled: mine.stamina < 2,
        });
        grid.append(cellAction);
      }
    });

    wrap.append(grid);

    // 4. Relic Forge & Mine Artifacts
    if (mode === "owner" && state !== null) {
      const relicWrap = div("garden-town-section");
      relicWrap.append(span("garden-board-title", t("relics.title")));
      const ownedRelics = state.extras.relics ?? [];
      const equippedRelics = state.extras.equippedRelics ?? [];
      const relicRow = div("garden-tools");
      for (const relic of RELICS) {
        const isOwned = ownedRelics.includes(relic.id);
        const isEquipped = equippedRelics.includes(relic.id);
        const matsText = Object.entries(relic.materials)
          .map(([prod, qty]) => `${t(`products.${prod}`)}×${qty}`)
          .join(" + ");
        if (!isOwned) {
          const canCraft =
            state.coins >= relic.costCoins &&
            Object.entries(relic.materials).every(
              ([prod, qty]) =>
                (state?.bag.products ?? [])
                  .filter((s) => s.product === prod)
                  .reduce((sum, s) => sum + s.qty, 0) >= (qty ?? 0),
            );
          const btn = actionButton(
            `${t(`relics.${relic.id}`)} — ${t("relics.craft")} (${formatCompact(relic.costCoins)}c + ${matsText})`,
            "craftRelic",
            canCraft,
          );
          btn.dataset.relic = relic.id;
          relicRow.append(btn);
        } else {
          const canToggle = isEquipped || equippedRelics.length < MAX_EQUIPPED_RELICS;
          const btn = actionButton(
            `${isEquipped ? "★ " : ""}${t(`relics.${relic.id}`)} — ${isEquipped ? t("relics.unequip") : t("relics.equip")}`,
            "equipRelic",
            canToggle,
          );
          btn.dataset.relic = relic.id;
          if (isEquipped) btn.classList.add("is-active");
          relicRow.append(btn);
        }
      }
      relicWrap.append(relicRow);
      wrap.append(relicWrap);
    }

    return wrap;
  }

  /** @brief Builds the market tab. */
  function buildMarket(): HTMLElement {
    const wrap = div("garden-market");
    if (mode === "visit") {
      wrap.append(lineBlock(t("garden.marketReadonly")));
      return wrap;
    }
    if (state === null || season === null) return lineBlock(t("common.loading"));
    const qtyRow = div("garden-market-qty");
    qtyRow.append(span("garden-hint", t("market.buyQty")));
    for (const qty of [1, 10, 25, 50]) {
      const button = actionButton(`x${qty}`, "setBuyQty");
      button.dataset.qty = String(qty);
      if (buyQty === qty) button.classList.add("is-active");
      qtyRow.append(button);
    }
    wrap.append(qtyRow);
    wrap.append(lineBlock(`// ${t("market.taxHint")}`));
    const restock = div("garden-line");
    restock.dataset.restockTimer = "now";
    restock.textContent = `// ${t("market.restockLine", {
      time: formatDuration(Math.max(0, season.shop.restockAt - now())),
    })}`;
    wrap.append(restock);

    const makeBuyCard = (item: {
      act: "buy" | "buySupply" | "buyTool" | "buyTree";
      key: string;
      name: string;
      glyph: string;
      price: number;
      stock: number | null;
      owned: number;
      oneOnly?: boolean;
      data: Record<string, string>;
    }): HTMLButtonElement => {
      const soldOut = item.stock !== null && item.stock <= 0;
      const qty = item.oneOnly === true ? 1 : buyQty;
      const total = item.price * qty;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "garden-buy-card";
      if (soldOut) {
        card.classList.add("is-sold-out");
        card.disabled = true;
      } else if ((state?.coins ?? 0) < total) {
        card.disabled = true;
        card.classList.add("is-unaffordable");
      }
      card.dataset.act = item.act;
      for (const [key, value] of Object.entries(item.data)) card.dataset[key] = value;
      card.title = `${item.name} · ${formatNumber(item.price)}c × ${qty} = ${formatNumber(total)}c`;
      card.append(
        span("garden-buy-line is-glyph", item.glyph),
        span("garden-buy-line is-name", item.name),
        span("garden-buy-line is-price", `${formatCompact(item.price)}c`),
        span("garden-buy-line", `x${qty}=${formatCompact(total)}c`),
        span(
          "garden-buy-line is-stock",
          soldOut
            ? `${t("market.soldOut")} · ${item.owned}`
            : `${t("market.stock")} ${item.stock === null ? "\u221e" : item.stock} · ${item.owned}`,
        ),
      );
      return card;
    };

    // Remaining stock for this restock: the server reports only the live one.
    const stockOf = (id: string, fallback: number | null): number | null => {
      if (fallback === null) return null;
      const tracked = state?.shopStock ?? {};
      return Object.prototype.hasOwnProperty.call(tracked, id) ? (tracked[id] ?? 0) : fallback;
    };

    const seedItems: Parameters<typeof makeBuyCard>[0][] = [];
    const rareSeedItems: Parameters<typeof makeBuyCard>[0][] = [];
    const fruitSeedItems: Parameters<typeof makeBuyCard>[0][] = [];
    for (const offer of season.shop.offers) {
      const definition = seedById(offer.seed);
      const rare = definition?.rare === true;
      const bucket = definition?.category === "fruit" ? fruitSeedItems : rare ? rareSeedItems : seedItems;
      bucket.push({
        act: "buy",
        key: `seed:${offer.seed}`,
        name: seedName(offer.seed),
        glyph: definition?.art[3] ?? "?",
        // Rare seeds keep their fixed price; only normal seeds feel the market.
        price: rare ? offer.price : buyPriceOf(offer.seed, offer.price),
        stock: stockOf(offer.seed, offer.stock),
        owned: state.bag.seeds[offer.seed] ?? 0,
        data: { seed: offer.seed },
      });
    }
    const supplyItems: Parameters<typeof makeBuyCard>[0][] = [];
    for (const supply of [...FERTILIZERS, ...SPRAYS]) {
      const supplyDef = [...FERTILIZERS, ...SPRAYS].find((entry) => entry.id === supply.id);
      supplyItems.push({
        act: "buySupply",
        key: `supply:${supply.id}`,
        name: t(`supplies.${supply.id}`),
        glyph: supplyDef !== undefined && "growMultiplier" in supplyDef ? "f" : "s",
        price: buyPriceOf(supply.id, supplyDef?.price ?? 0),
        stock: null,
        owned: state.bag.supplies[supply.id] ?? 0,
        data: { supply: supply.id },
      });
    }
    const toolItems: Parameters<typeof makeBuyCard>[0][] = [];
    for (const offer of season.shop.tools) {
      toolItems.push({
        act: "buyTool",
        key: `tool:${offer.tool}`,
        name: t(`tools.${offer.tool}`),
        glyph: "w",
        price: offer.price,
        stock: stockOf(offer.tool, offer.stock),
        owned: state.bag.tools?.[offer.tool] ?? 0,
        data: { tool: offer.tool },
      });
    }

    const treeItems: Parameters<typeof makeBuyCard>[0][] = [];
    for (const tree of TREES) {
      treeItems.push({
        act: "buyTree",
        key: `tree:${tree.id}`,
        name: treeName(tree.id),
        glyph: tree.art[3] ?? "?",
        price: tree.buy,
        stock: null,
        owned: 0,
        oneOnly: true,
        data: { tree: tree.id },
      });
    }

    const addBuySection = (items: Parameters<typeof makeBuyCard>[0][]): void => {
      items.sort((left, right) => left.price - right.price);
      const grid = div("garden-buy-grid");
      for (const item of items) grid.append(makeBuyCard(item));
      wrap.append(grid);
    };

    wrap.append(lineBlock(`// ${t("market.shop")} · ${t("market.sortAsc")}`));
    addBuySection(seedItems);
    wrap.append(lineBlock(`// ${t("market.rareSeeds")}`));
    if (rareSeedItems.length === 0) wrap.append(lineBlock(t("market.rareEmpty")));
    else addBuySection(rareSeedItems);
    wrap.append(lineBlock(`// ${t("market.fruitTrees")}`));
    const fruitItems = [...fruitSeedItems, ...treeItems];
    if (fruitItems.length === 0) wrap.append(lineBlock(t("market.rareEmpty")));
    else addBuySection(fruitItems);
    wrap.append(lineBlock(`// ${t("market.supplies")} · ${t("market.sortAsc")}`));
    addBuySection(supplyItems);
    wrap.append(lineBlock(`// ${t("market.tools")}`));
    if (toolItems.length === 0) wrap.append(lineBlock(t("market.toolsEmpty")));
    else addBuySection(toolItems);

    const exchange = div("garden-market-panel");
    exchange.append(lineBlock(`// ${t("market.exchange")}`));
    if (state.bag.crops.length === 0) exchange.append(lineBlock(t("market.empty")));
    for (const stack of state.bag.crops) {
      const value = cropSellPrice(stack, season, activeHybrids()) * stack.qty;
      const row = rowButton(
        "garden-market-row",
        `${itemName(stack.item)} ${stack.star ?? 1}★ ${fitText(effectBadge(stack.effects), 8)}${stack.pest === true ? t("market.pestTag") : ""}${fitText(`x${stack.qty}`, 4)}${fitText(`${formatCompact(value)}c`, 7)}[${t("market.sell")}]`,
        "sell",
      );
      row.dataset.item = stack.item;
      row.dataset.effects = JSON.stringify(stack.effects);
      row.dataset.pest = stack.pest === true ? "1" : "0";
      row.dataset.star = String(stack.star ?? 1);
      row.title = `${formatNumber(value)}c`;
      exchange.append(row);
    }
    if (state.bag.crops.length > 0) {
      const currentSeason = season;
      const total = state.bag.crops.reduce(
        (sum, stack) => sum + cropSellPrice(stack, currentSeason, activeHybrids()) * stack.qty,
        0,
      );
      exchange.append(actionButton(t("market.sellAllValue", { coins: total }), "sellAll"));
    }

    const products = div("garden-market-panel");
    products.append(lineBlock(`// ${t("farm.products")}`));
    const stacks = state.bag.products ?? [];
    if (stacks.length === 0) products.append(lineBlock(t("farm.noProducts")));
    for (const stack of stacks) {
      const unit = season === null ? 0 : productPrice(stack, season);
      const row = rowButton(
        "garden-market-row",
        `${t(`products.${stack.product}`)} ${effectBadge(stack.effects ?? [])} ${fitText(`${"*".repeat(stack.star)}`, 6)}${fitText(`x${stack.qty}`, 5)}${fitText(`${formatCompact(unit)}c`, 7)}[${t("market.sell")}]`,
        "sellProduct",
      );
      row.dataset.product = stack.product;
      row.dataset.star = String(stack.star);
      row.dataset.effects = JSON.stringify(stack.effects ?? []);
      row.title = `${formatNumber(unit)}c each · ${formatNumber(unit * stack.qty)}c total`;
      products.append(row);
    }
    if (stacks.length > 0) products.append(actionButton(t("farm.sellAllProducts"), "sellAllProducts"));

    wrap.append(exchange, products);

    const history = div("garden-market-panel");
    history.append(lineBlock(`// ${t("history.title")}`));
    const sales = state.sales ?? [];
    if (sales.length === 0) history.append(lineBlock(t("history.empty")));
    for (const sale of sales.slice(-12).reverse()) {
      const name =
        sale.kind === "crop"
          ? itemName(sale.item as ItemId)
          : sale.kind === "animal"
            ? t(`animals.${sale.item}`)
            : t(`products.${sale.item}`);
      const time = new Date(sale.ts).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const historyLine = lineBlock(
        `${time} ${name}${sale.star === undefined ? "" : ` ${sale.star}★`} ${effectBadge(sale.effects ?? [])} x${sale.qty} → ${formatCompact(sale.net)}c`,
      );
      historyLine.title = `${formatNumber(sale.net)}c received · ${formatNumber(sale.gross)}c gross`;
      history.append(historyLine);
    }
    wrap.append(history);
    return wrap;
  }

  /** @brief Builds the dedicated Prestige tab: control, buffs and shops. */
  function buildPrestige(): HTMLElement {
    const wrap = div("garden-market garden-prestige");
    const view = mode === "visit" ? visiting : state;
    if (view === null) return lineBlock(t("common.loading"));
    const extras = view.extras;
    const prestigeLevel = extras.prestige ?? 0;
    const prestigeNeed = prestigeRequirement(prestigeLevel);

    const control = div("garden-market-panel");
    control.append(lineBlock(`// ${t("prestige.title")}`));
    control.append(
      lineBlock(
        t("prestige.level", {
          level: prestigeLevel,
          sell: Math.round((prestigeSellBonus(prestigeLevel) - 1) * 100),
          grow: Math.round((1 - prestigeGrowScale(prestigeLevel)) * 100),
        }),
      ),
    );
    control.append(
      lineBlock(
        t("prestige.mutationBonus", {
          percent: Math.round(prestigeLevel * 5),
        }),
      ),
    );
    const starters = Object.entries(prestigeStarterSeeds(prestigeLevel + 1))
      .map(([seed, qty]) => `${seedName(seed as SeedId)} ×${qty}`)
      .join(", ");
    control.append(lineBlock(t("prestige.starterSeeds", { list: starters })));
    const prestigeCoinLine = lineBlock(
      t("prestige.coins", { coins: formatCompact(extras.prestigeCoins ?? 0) }),
    );
    prestigeCoinLine.title = `${formatNumber(extras.prestigeCoins ?? 0)} prestige coins`;
    control.append(prestigeCoinLine);
    control.append(lineBlock(t("prestige.conversionHint")));
    if (view.stats.earned >= prestigeNeed) {
      if (mode === "owner") {
        control.append(
          actionButton(
            confirmPrestige
              ? t("prestige.confirm", { level: prestigeLevel + 1 })
              : t("prestige.ready", { level: prestigeLevel + 1 }),
            "prestige",
          ),
        );
      }
    } else {
      control.append(
        lineBlock(
          t("prestige.progress", {
            earned: formatCompact(view.stats.earned),
            need: formatCompact(prestigeNeed),
          }),
        ),
      );
    }
    if ((extras.taxLast ?? 0) > 0) {
      control.append(lineBlock(`// ${t("tax.last", { coins: formatCompact(extras.taxLast ?? 0) })}`));
    }
    wrap.append(control);

    const skillPanel = div("garden-market-panel");
    skillPanel.append(lineBlock(`// ${t("prestige.skills")}`));
    const skillPoints = extras.prestigePoints ?? Math.max(0, prestigeLevel);
    skillPanel.append(lineBlock(t("prestige.points", { points: skillPoints })));
    for (const skill of ["merchant", "farmer", "artisan"] as const) {
      const level = extras.prestigeSkills?.[skill] ?? 0;
      const button = actionButton(
        t(`prestige.skill.${skill}`, { level }),
        "buyPrestigeSkill",
        mode === "owner" && skillPoints > 0,
      );
      button.dataset.skill = skill;
      skillPanel.append(button);
    }
    const spentPoints = Object.values(extras.prestigeSkills ?? {}).reduce((sum, points) => sum + points, 0);
    if (prestigeLevel > 0 && spentPoints > 0) {
      skillPanel.append(
        actionButton(
          t("prestige.respec"),
          "respecPrestige",
          mode === "owner" && (extras.prestigeCoins ?? 0) >= 1,
        ),
      );
    }
    wrap.append(skillPanel);

    const shop = div("garden-market-panel");
    shop.append(lineBlock(`// ${t("prestige.shop")}`));
    const addOffers = (label: string, offers: typeof PRESTIGE_SHOP): void => {
      if (offers.length === 0) return;
      shop.append(lineBlock(`// ${label}`));
      const grid = div("garden-buy-grid");
      for (const offer of offers) {
        const locked = prestigeLevel < offer.tier;
        const card = document.createElement("button");
        card.type = "button";
        card.className = "garden-buy-card";
        if (locked) card.classList.add("is-prestige-locked");
        card.dataset.act = "buyPrestigeSeed";
        card.dataset.seed = offer.seed;
        card.disabled = locked || (view.coins ?? 0) < offer.price || mode !== "owner";
        card.title = `${seedName(offer.seed)} · ${formatCompact(offer.price)}c · P${offer.tier}`;
        card.append(
          span("garden-buy-line is-name", seedName(offer.seed)),
          span("garden-buy-line", `P${offer.tier}`),
          span("garden-buy-line is-price", `${formatCompact(offer.price)}c`),
          span(
            "garden-buy-line is-stock",
            locked
              ? t("prestige.tierLocked", { tier: offer.tier })
              : `${t("garden.bag")} ${view.bag.seeds[offer.seed] ?? 0}`,
          ),
        );
        grid.append(card);
      }
      shop.append(grid);
    };
    addOffers(
      t("prestige.shopSeeds"),
      PRESTIGE_SHOP.filter((offer) => seedById(offer.seed)?.category !== "fruit"),
    );
    addOffers(
      t("prestige.shopFruit"),
      PRESTIGE_SHOP.filter((offer) => seedById(offer.seed)?.category === "fruit"),
    );
    wrap.append(shop);

    const final = div("garden-market-panel");
    const finalUnlocked = prestigeLevel >= FINAL_SHOP_PRESTIGE;
    final.append(lineBlock(`// ${t("finalShop.title")}`));
    final.append(
      lineBlock(
        finalUnlocked ? t("finalShop.unlocked") : t("finalShop.locked", { tier: FINAL_SHOP_PRESTIGE }),
      ),
    );
    const finalGrid = div("garden-buy-grid");
    const prestigeCoins = extras.prestigeCoins ?? 0;
    for (const offer of FINAL_SHOP) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "garden-buy-card";
      if (!finalUnlocked) card.classList.add("is-prestige-locked");
      card.dataset.act = "buyFinalSeed";
      card.dataset.seed = offer.seed;
      card.disabled = !finalUnlocked || prestigeCoins < offer.coins || mode !== "owner";
      card.title = `${seedName(offer.seed)} · ${offer.coins} xu`;
      card.append(
        span("garden-buy-line is-name", seedName(offer.seed)),
        span("garden-buy-line is-price", `${offer.coins} ✦`),
        span(
          "garden-buy-line is-stock",
          finalUnlocked
            ? `${t("prestige.coinsShort")} ${prestigeCoins}`
            : t("finalShop.locked", { tier: FINAL_SHOP_PRESTIGE }),
        ),
      );
      finalGrid.append(card);
    }
    final.append(finalGrid);
    if (finalUnlocked) final.append(lineBlock(t("finalShop.comingSoon")));
    wrap.append(final);
    return wrap;
  }

  /** @brief Loads the public global sale log. */
  async function loadGlobalSales(): Promise<void> {
    globalSalesStatus = "loading";
    render();
    try {
      const result = await api.sales();
      globalSales = result.entries;
      globalSalesStatus = "idle";
    } catch {
      globalSalesStatus = "error";
    }
    render();
  }

  /** @brief Builds the global sale log tab. */
  function buildLog(): HTMLElement {
    const wrap = div("garden-log garden-market");
    wrap.append(lineBlock(`// ${t("log.title")}`));
    const timeline = state?.timeline ?? [];
    if (timeline.length > 0) {
      wrap.append(lineBlock(`// ${t("log.timeline")}`));
      for (const entry of [...timeline].reverse().slice(0, 30)) {
        const time = new Date(entry.ts).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const target =
          entry.item === undefined || entry.kind === "skill" ? "" : ` · ${itemName(entry.item as ItemId)}`;
        const amount = entry.coins === undefined ? "" : ` · ${formatCompact(entry.coins)}c`;
        wrap.append(
          lineBlock(
            `${time} ${t(`timeline.${entry.kind}`)}${target}${entry.qty === undefined ? "" : ` x${entry.qty}`}${amount}`,
          ),
        );
      }
      wrap.append(lineBlock(""));
    }
    const actions = div("garden-tools");
    actions.append(actionButton(t("log.refresh"), "logRefresh", globalSalesStatus !== "loading"));
    wrap.append(actions);
    if (globalSalesStatus === "loading") {
      wrap.append(lineBlock(t("common.loading")));
      return wrap;
    }
    if (globalSalesStatus === "error") {
      wrap.append(lineBlock(t("log.error")));
      return wrap;
    }
    if (globalSales.length === 0) {
      wrap.append(lineBlock(t("log.empty")));
      return wrap;
    }
    for (const sale of globalSales) {
      const name =
        sale.kind === "crop"
          ? itemName(sale.item as ItemId)
          : sale.kind === "animal"
            ? t(`animals.${sale.item}`)
            : t(`products.${sale.item}`);
      const time = new Date(sale.ts).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      wrap.append(
        lineBlock(
          `${time} [${sale.prestige}] ${sale.nick} #${sale.code} — ${name}${sale.star === undefined ? "" : ` ${sale.star}★`} ${effectBadge(sale.effects ?? [])} ×${sale.qty} → ${formatCompact(sale.net)}c`,
        ),
      );
    }
    return wrap;
  }

  /**
   * @brief Builds the reborn log view displaying complete server actions and personal timeline.
   * @details Renders an interactive log dashboard for the reborn UI containing:
   * 1. Overview summary metrics: server action count, total volume in coins, personal timeline count.
   * 2. Filter tabs: All, Global Server, Personal Timeline.
   * 3. Instant search bar: filter by player name, code #, action type, crop, or item name.
   * 4. Complete, un-truncated list of global server transactions and personal events.
   * @return HTMLElement representing the reborn log view.
   */
  function buildRebornLog(): HTMLElement {
    const wrap = div("garden-reborn-log");

    const header = div("garden-reborn-log-header");
    const title = div("garden-reborn-log-title");
    title.textContent = t("log.rebornTitle");
    header.append(title);

    const stats = div("garden-reborn-log-stats");
    const totalVolume = globalSales.reduce((acc, s) => acc + (s.net ?? 0), 0);
    const timeline = state?.timeline ?? [];

    const statServer = div("garden-reborn-log-stat");
    statServer.textContent = t("log.statsTotal", { count: globalSales.length });
    const statVolume = div("garden-reborn-log-stat");
    statVolume.textContent = t("log.statsVolume", { amount: formatCompact(totalVolume) });
    const statPersonal = div("garden-reborn-log-stat");
    statPersonal.textContent = t("log.statsTimeline", { count: timeline.length });

    stats.append(statServer, statVolume, statPersonal);
    header.append(stats);
    wrap.append(header);

    const toolbar = div("garden-reborn-log-toolbar");
    const filterGroup = div("garden-reborn-log-filters");

    const filters: readonly { readonly id: "all" | "global" | "timeline"; readonly label: string }[] = [
      { id: "all", label: t("log.filterAll") },
      { id: "global", label: t("log.filterGlobal") },
      { id: "timeline", label: t("log.filterTimeline") },
    ];

    for (const f of filters) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `stage-btn garden-reborn-log-filter-btn${logFilter === f.id ? " is-active" : ""}`;
      btn.dataset.act = `logFilter:${f.id}`;
      btn.textContent = logFilter === f.id ? `[ ${f.label} ]` : f.label;
      filterGroup.append(btn);
    }
    toolbar.append(filterGroup);

    const refreshBtn = actionButton(t("log.refresh"), "logRefresh", globalSalesStatus !== "loading");
    toolbar.append(refreshBtn);
    wrap.append(toolbar);

    const searchWrap = div("garden-reborn-log-search-wrap");
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "stage-input garden-reborn-log-search";
    searchInput.dataset.role = "logSearch";
    searchInput.placeholder = t("log.searchPlaceholder");
    searchInput.value = logQuery;
    searchWrap.append(searchInput);
    wrap.append(searchWrap);

    const list = div("garden-reborn-log-list");

    if (globalSalesStatus === "loading") {
      const loadingBox = div("garden-reborn-log-empty");
      loadingBox.textContent = t("common.loading");
      list.append(loadingBox);
      wrap.append(list);
      return wrap;
    }

    if (globalSalesStatus === "error") {
      const errorBox = div("garden-reborn-log-empty");
      errorBox.textContent = t("log.error");
      list.append(errorBox);
      wrap.append(list);
      return wrap;
    }

    type LogEntryItem =
      | { type: "global"; ts: number; sale: GlobalSaleEntry }
      | { type: "timeline"; ts: number; event: TimelineEvent };

    const items: LogEntryItem[] = [];

    if (logFilter === "all" || logFilter === "global") {
      for (const sale of globalSales) {
        items.push({ type: "global", ts: sale.ts, sale });
      }
    }

    if (logFilter === "all" || logFilter === "timeline") {
      for (const event of timeline) {
        items.push({ type: "timeline", ts: event.ts, event });
      }
    }

    items.sort((a, b) => b.ts - a.ts);

    const query = logQuery.trim();
    const queryLower = query.toLowerCase();
    const queryFolded = foldDiacritics(query);
    let visibleCount = 0;

    for (const item of items) {
      const row = div("garden-reborn-log-row");
      row.dataset.type = item.type;

      const dateObj = new Date(item.ts);
      const timeStr = dateObj.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const dateStr = dateObj.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
      });
      const stampStr = `${timeStr} ${dateStr}`;

      if (item.type === "global") {
        const sale = item.sale;
        const name =
          sale.kind === "crop"
            ? itemName(sale.item as ItemId)
            : sale.kind === "animal"
              ? t(`animals.${sale.item}`)
              : sale.kind === "contract"
                ? sale.item
                : t(`products.${sale.item}`);

        const kindBadge =
          sale.kind === "crop"
            ? "[Cây]"
            : sale.kind === "animal"
              ? "[Thú]"
              : sale.kind === "contract"
                ? "[HĐ]"
                : "[Sp]";

        const starStr = sale.star !== undefined && sale.star > 0 ? ` ${sale.star}★` : "";
        const effectStr = effectBadge(sale.effects ?? []);
        const effectsPlain = (sale.effects ?? []).map((e) => t(`effects.${e}`)).join(" ");
        const searchCorpus = `${stampStr} ${sale.nick} #${sale.code} P${sale.prestige} ${kindBadge} ${name} ${effectsPlain} ${sale.qty} ${sale.net}c ${sale.gross}c global server`;

        row.dataset.search = searchCorpus;

        const timeSpan = div("garden-reborn-log-time");
        timeSpan.textContent = stampStr;

        const scopeBadge = div("garden-reborn-log-scope scope-global");
        scopeBadge.textContent = "SERVER";

        const playerSpan = div("garden-reborn-log-player");
        playerSpan.textContent = `[P${sale.prestige}] ${sale.nick} #${sale.code}`;

        const descSpan = div("garden-reborn-log-desc");
        descSpan.textContent = `${kindBadge} ${name}${starStr} ${effectStr ? effectStr + " " : ""}×${sale.qty}`;

        const amountSpan = div("garden-reborn-log-amount amount-plus");
        amountSpan.textContent = `+${formatCompact(sale.net)}c`;

        row.append(timeSpan, scopeBadge, playerSpan, descSpan, amountSpan);
      } else {
        const ev = item.event;
        const kindLabel = t(`timeline.${ev.kind}`);
        const target =
          ev.item === undefined || ev.kind === "skill" ? "" : ` · ${itemName(ev.item as ItemId)}`;
        const qtyStr = ev.qty === undefined ? "" : ` ×${ev.qty}`;
        const amountStr = ev.coins === undefined ? "" : ` · ${formatCompact(ev.coins)}c`;
        const searchCorpus = `${stampStr} cá nhân personal timeline ${kindLabel} ${target} ${qtyStr} ${amountStr}`;

        row.dataset.search = searchCorpus;

        const timeSpan = div("garden-reborn-log-time");
        timeSpan.textContent = stampStr;

        const scopeBadge = div("garden-reborn-log-scope scope-personal");
        scopeBadge.textContent = "BẠN";

        const playerSpan = div("garden-reborn-log-player player-self");
        playerSpan.textContent = `[${kindLabel}]`;

        const descSpan = div("garden-reborn-log-desc");
        descSpan.textContent = `${target}${qtyStr}`.trim() || kindLabel;

        const amountSpan = div("garden-reborn-log-amount");
        if (ev.coins !== undefined) {
          amountSpan.textContent = `${ev.coins >= 0 ? "+" : ""}${formatCompact(ev.coins)}c`;
          amountSpan.classList.add(ev.coins >= 0 ? "amount-plus" : "amount-minus");
        } else {
          amountSpan.textContent = "—";
        }

        row.append(timeSpan, scopeBadge, playerSpan, descSpan, amountSpan);
      }

      const text = row.dataset.search ?? row.textContent ?? "";
      const matchesQuery =
        query.length === 0 ||
        text.toLowerCase().includes(queryLower) ||
        foldDiacritics(text).includes(queryFolded);

      row.hidden = !matchesQuery;
      if (matchesQuery) visibleCount += 1;
      list.append(row);
    }

    const emptyBox = div("garden-reborn-log-empty");
    emptyBox.textContent = t("log.emptyFilter");
    emptyBox.hidden = visibleCount > 0;
    list.append(emptyBox);

    wrap.append(list);
    return wrap;
  }

  /** @brief Loads the public AI-discovered recipe list. */
  async function loadGlobalRecipes(): Promise<void> {
    try {
      globalRecipes = (await api.globalRecipes()).recipes;
      render();
    } catch {
      // The list stays empty while offline.
    }
  }

  /**
   * @brief Loads the public AI-discovered hybrid fish catalog.
   * @return Promise resolving when the catalog is loaded and UI re-rendered.
   */
  async function loadGlobalHybrids(): Promise<void> {
    try {
      globalHybrids = (await api.globalHybrids()).hybrids;
      render();
    } catch {
      // The list stays empty while offline.
    }
  }

  /**
   * @brief Helper to pick an iconic emoji avatar for Dynopedia items.
   * @param category Dynopedia category name.
   * @param id Identifier of the item or entity.
   * @return Emoji string representation for visual card depiction.
   */
  function dynopediaItemIcon(category: string, id: string): string {
    if (category === "effects") return "✨";
    if (category === "seeds") {
      const map: Record<string, string> = {
        carrot: "🥕",
        potato: "🥔",
        tomato: "🍅",
        cucumber: "🥒",
        onion: "🧅",
        garlic: "🧄",
        pepper: "🌶️",
        corn: "🌽",
        wheat: "🌾",
        strawberry: "🍓",
        cocomelon: "🍈",
        watermelon: "🍉",
        pumpkin: "🎃",
        blueberry: "🫐",
        dragonfruit: "🐉",
        persimmon: "🍊",
      };
      return map[id] ?? "🌱";
    }
    if (category === "trees") {
      const map: Record<string, string> = {
        apple: "🍎",
        orange: "🍊",
        peach: "🍑",
        cherry: "🍒",
        banana: "🍌",
        mango: "🥭",
      };
      return map[id] ?? "🌳";
    }
    if (category === "animals") {
      const map: Record<string, string> = {
        chicken: "🐔",
        cow: "🐮",
        sheep: "🐑",
        pig: "🐷",
        duck: "🦆",
        goat: "🐐",
      };
      return map[id] ?? "🐮";
    }
    if (category === "fish") {
      const map: Record<string, string> = {
        salmon: "🐟",
        carp: "🐠",
        tuna: "🦈",
      };
      return map[id] ?? "🐟";
    }
    if (category === "products") {
      const map: Record<string, string> = {
        milk: "🥛",
        cheese: "🧀",
        egg: "🥚",
        mayo: "🥣",
        wool: "🧶",
        cloth: "🧵",
        wine: "🍷",
        juice: "🧃",
        jam: "🍯",
        flour: "🥡",
        bread: "🍞",
        dried_crop: "🥨",
        cured_meat: "🥓",
      };
      return map[id] ?? "📦";
    }
    if (category === "machines") return "⚙️";
    if (category === "supplies") return "🧪";
    if (category === "tools") return "🛠️";
    if (category === "buildings") return "🏠";
    if (category === "attachments") return "🧩";
    if (category === "events") return "⛅";
    if (category === "pets") return "🐾";
    return "📦";
  }

  /**
   * @brief Builds the redesigned Dynopedia wiki and codex tab.
   * @details Renders an interactive encyclopedia dashboard for the garden ecosystem:
   * 1. Header with Codex progress tracker, mastery percentage, and unclaimed reward claim button.
   * 2. Category navigation with icons and active counters.
   * 3. Toolbar with debounced search and discovery filter chips (all / discovered / undiscovered).
   * 4. High-contrast visual cards grid with badges, price margins, growth times, and codex status.
   * 5. Collapsible culinary recipe research lab for AI and server recipe crafting.
   * @return HTMLElement representing the rebuilt Dynopedia view.
   */
  function buildDynopedia(): HTMLElement {
    const wrap = div("garden-dynopedia garden-market");

    // 1. Header & Codex Mastery Box
    const header = div("garden-dynopedia-header");
    const headline = div("garden-dynopedia-headline");
    const titleWrap = div("garden-dynopedia-title-wrap");

    const title = div("garden-dynopedia-title");
    title.textContent = t("dynopedia.title");
    const subtitle = div("garden-dynopedia-subtitle");
    subtitle.textContent = t("dynopedia.subtitle");
    titleWrap.append(title, subtitle);
    headline.append(titleWrap);

    const discovered = state?.collection?.length ?? 0;
    const codexTotalTargets =
      EFFECTS.length +
      SEEDS.length +
      ANIMALS.length +
      PRODUCTS.length +
      MACHINES.length +
      TOOLS.length +
      PETS.length;
    const codexPercent = Math.min(100, Math.round((discovered / Math.max(1, codexTotalTargets)) * 100));
    const unclaimed = state?.codexUnclaimed ?? 0;

    const codexCard = div("garden-dynopedia-codex-card");
    const codexMeta = div("garden-dynopedia-codex-meta");
    const codexLabel = div("garden-dynopedia-codex-label");
    codexLabel.textContent = t("dynopedia.codexProgress", {
      count: discovered,
      total: codexTotalTargets,
      percent: codexPercent,
    });
    codexMeta.append(codexLabel);

    const progBar = div("garden-dynopedia-progress-bar");
    const progFill = div("garden-dynopedia-progress-fill");
    progFill.style.width = `${codexPercent}%`;
    progBar.append(progFill);
    codexCard.append(codexMeta, progBar);

    if (unclaimed > 0) {
      const claimBtn = actionButton(
        t("dynopedia.claimReward", { coins: formatCompact(unclaimed) }),
        "claimCodex",
      );
      claimBtn.className = "stage-btn garden-dynopedia-claim-btn tone-gold";
      codexCard.append(claimBtn);
    } else {
      const allClaimed = div("garden-dynopedia-claimed-tag");
      allClaimed.textContent = t("dynopedia.allRewardsClaimed");
      codexCard.append(allClaimed);
    }

    headline.append(codexCard);
    header.append(headline);
    wrap.append(header);

    // 2. Categories Bar
    const categoriesBar = div("garden-dynopedia-categories");
    const categories = [
      { id: "effects", icon: "✨", labelKey: "dynopedia.cat.effects" },
      { id: "seeds", icon: "🌱", labelKey: "dynopedia.cat.seeds" },
      { id: "trees", icon: "🌳", labelKey: "dynopedia.cat.trees" },
      { id: "animals", icon: "🐮", labelKey: "dynopedia.cat.animals" },
      { id: "fish", icon: "🐟", labelKey: "dynopedia.cat.fish" },
      { id: "products", icon: "📦", labelKey: "dynopedia.cat.products" },
      { id: "machines", icon: "⚙️", labelKey: "dynopedia.cat.machines" },
      { id: "supplies", icon: "🧪", labelKey: "dynopedia.cat.supplies" },
      { id: "tools", icon: "🛠️", labelKey: "dynopedia.cat.tools" },
      { id: "buildings", icon: "🏠", labelKey: "dynopedia.cat.buildings" },
      { id: "attachments", icon: "🧩", labelKey: "dynopedia.cat.attachments" },
      { id: "events", icon: "⛅", labelKey: "dynopedia.cat.events" },
      { id: "pets", icon: "🐾", labelKey: "dynopedia.cat.pets" },
      { id: "mechanics", icon: "📘", labelKey: "dynopedia.cat.mechanics" },
    ] as const;

    for (const cat of categories) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `stage-btn garden-dynopedia-cat-btn${dynopediaCategory === cat.id ? " is-active" : ""}`;
      btn.dataset.act = "dynopediaCategory";
      btn.dataset.category = cat.id;

      const catIcon = document.createElement("span");
      catIcon.className = "garden-dynopedia-cat-icon";
      catIcon.textContent = cat.icon;

      const catLabel = document.createElement("span");
      catLabel.className = "garden-dynopedia-cat-label";
      catLabel.textContent = t(cat.labelKey);

      btn.append(catIcon, catLabel);
      categoriesBar.append(btn);
    }
    wrap.append(categoriesBar);

    // 3. Toolbar: Search Input + Discovery Filter Chips
    const toolbar = div("garden-dynopedia-toolbar");
    const searchWrap = div("garden-dynopedia-search-wrap");

    const searchIcon = div("garden-dynopedia-search-icon");
    searchIcon.textContent = "🔍";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "stage-input garden-dynopedia-search";
    search.placeholder = t("dynopedia.search");
    search.value = dynopediaQuery;
    search.dataset.role = "dynopediaSearch";
    search.setAttribute("aria-label", t("dynopedia.search"));

    searchWrap.append(searchIcon, search);
    toolbar.append(searchWrap);

    const filterGroup = div("garden-dynopedia-filters");
    const filters: readonly { readonly id: "all" | "known" | "unknown"; readonly labelKey: string }[] = [
      { id: "all", labelKey: "dynopedia.filterAll" },
      { id: "known", labelKey: "dynopedia.filterDiscovered" },
      { id: "unknown", labelKey: "dynopedia.filterUndiscovered" },
    ];

    for (const f of filters) {
      const fBtn = document.createElement("button");
      fBtn.type = "button";
      fBtn.className = `stage-btn garden-dynopedia-filter-btn${dynopediaFilter === f.id ? " is-active" : ""}`;
      fBtn.dataset.act = `dynopediaFilter:${f.id}`;
      fBtn.textContent = dynopediaFilter === f.id ? `[ ${t(f.labelKey)} ]` : t(f.labelKey);
      filterGroup.append(fBtn);
    }
    toolbar.append(filterGroup);
    wrap.append(toolbar);

    // 4. Gather Cards
    interface CardData {
      id: string;
      title: string;
      codexKey: string | null;
      icon: string;
      tags: string[];
      buy?: number;
      sell?: number;
      growTime?: string;
      boost?: string;
      detail: string;
    }

    const cards: CardData[] = [];

    if (dynopediaCategory === "effects") {
      for (const effect of EFFECTS) {
        cards.push({
          id: effect.id,
          title: t(`effects.${effect.id}`),
          codexKey: `effect:${effect.id}`,
          icon: dynopediaItemIcon("effects", effect.id),
          tags: [effect.natural ? t("dynopedia.weather") : t("dynopedia.special")],
          boost: `x${effect.multiplier}`,
          detail: `x${effect.multiplier} · ${effect.natural ? t("dynopedia.weather") : t("dynopedia.special")}`,
        });
      }
    } else if (dynopediaCategory === "seeds") {
      for (const seed of SEEDS) {
        const tags = [
          seed.regrow ? t("dynopedia.regrow") : t("dynopedia.single"),
          seed.rare === true ? t("dynopedia.rare") : "",
          seed.prestigeOnly === true ? `P${PRESTIGE_SHOP.find((o) => o.seed === seed.id)?.tier ?? 0}` : "",
        ].filter((tag) => tag.length > 0);
        cards.push({
          id: seed.id,
          title: t(`seeds.${seed.id}`),
          codexKey: `seed:${seed.id}`,
          icon: dynopediaItemIcon("seeds", seed.id),
          tags,
          buy: seed.buy,
          sell: seed.sell,
          growTime: formatDuration(seed.growMs),
          detail: `${formatDuration(seed.growMs)} · ${formatCompact(seed.buy)}c → ${formatCompact(seed.sell)}c · ${tags.join(" · ")}`,
        });
      }
    } else if (dynopediaCategory === "trees") {
      for (const tree of TREES) {
        cards.push({
          id: tree.id,
          title: t(`trees.${tree.id}`),
          codexKey: null,
          icon: dynopediaItemIcon("trees", tree.id),
          tags: [t("dynopedia.regrow")],
          buy: tree.buy,
          sell: tree.sell,
          growTime: formatDuration(tree.growMs),
          detail: `${formatDuration(tree.growMs)} · ${formatCompact(tree.buy)}c → ${formatCompact(tree.sell)}c`,
        });
      }
    } else if (dynopediaCategory === "animals") {
      for (const animal of ANIMALS) {
        if (animal.building === "pond") continue;
        cards.push({
          id: animal.id,
          title: t(`animals.${animal.id}`),
          codexKey: `animal:${animal.id}`,
          icon: dynopediaItemIcon("animals", animal.id),
          tags: [t(`farm.${animal.building}`)],
          buy: animal.buy,
          growTime: formatDuration(animalIntervalMs(animal.id)),
          detail: `${t(`farm.${animal.building}`)} · ${formatCompact(animal.buy)}c · ${formatDuration(animalIntervalMs(animal.id))} · ${t(`products.${animal.product}`)}`,
        });
      }
    } else if (dynopediaCategory === "fish") {
      for (const fishId of BASE_FISH_SPECIES) {
        const def = animalById(fishId);
        if (def === undefined) continue;
        cards.push({
          id: fishId,
          title: t(`animals.${fishId}`),
          codexKey: `fish:${fishId}`,
          icon: dynopediaItemIcon("fish", fishId),
          tags: [t("farm.pond")],
          buy: def.buy,
          growTime: formatDuration(animalIntervalMs(fishId)),
          detail: `${formatCompact(def.buy)}c · ${formatDuration(animalIntervalMs(fishId))} · ${t(`products.${def.product}`)}`,
        });
      }
      const hybridMap = new Map<
        string,
        { id: string; name: string; tier: string; glyph: string; price: number; lore: string }
      >();

      for (const animal of state?.animals?.pond ?? []) {
        if (animal !== null && animal.hybridId && animal.hybridName) {
          hybridMap.set(animal.hybridId, {
            id: animal.hybridId,
            name: animal.hybridName,
            tier: animal.hybridTier === "inferior" ? t("dynopedia.inferior") : t("dynopedia.superior"),
            glyph: animal.hybridGlyph ?? "Ж",
            price: animal.hybridPrice ?? 0,
            lore: animal.hybridLore ?? "",
          });
        }
      }

      for (const hybrid of globalHybrids) {
        if (!hybridMap.has(hybrid.id)) {
          hybridMap.set(hybrid.id, {
            id: hybrid.id,
            name: hybrid.name,
            tier: hybrid.tier === "inferior" ? t("dynopedia.inferior") : t("dynopedia.superior"),
            glyph: hybrid.glyph || "Ж",
            price: hybrid.buy || 0,
            lore: hybrid.lore || "",
          });
        }
      }

      for (const key of state?.collection ?? []) {
        if (key.startsWith("hybrid:")) {
          const hid = key.slice("hybrid:".length);
          if (!hybridMap.has(hid)) {
            hybridMap.set(hid, {
              id: hid,
              name: hid,
              tier: t("dynopedia.superior"),
              glyph: "Ж",
              price: 0,
              lore: "",
            });
          }
        }
      }

      for (const [hid, hybrid] of hybridMap) {
        const fullKey = hid.startsWith("hybrid:") ? hid : `hybrid:${hid}`;
        cards.push({
          id: fullKey,
          title: `${hybrid.glyph} ${hybrid.name} [${hybrid.tier}]`,
          codexKey: fullKey,
          icon: hybrid.glyph || "Ж",
          tags: [hybrid.tier],
          buy: hybrid.price > 0 ? hybrid.price : undefined,
          detail: `${hybrid.price > 0 ? formatCompact(hybrid.price) + "c" : ""}${hybrid.lore ? ` · ${hybrid.lore}` : ""}`,
        });
      }
    } else if (dynopediaCategory === "products") {
      for (const product of PRODUCTS) {
        cards.push({
          id: product.id,
          title: t(`products.${product.id}`),
          codexKey: `product:${product.id}`,
          icon: dynopediaItemIcon("products", product.id),
          tags: [],
          sell: product.base,
          detail: `${formatCompact(product.base)}c`,
        });
      }
    } else if (dynopediaCategory === "machines") {
      for (const machine of MACHINES) {
        const input =
          machine.input.kind === "product"
            ? t(`products.${machine.input.product}`)
            : machine.allProduce === true
              ? t("dynopedia.anyProduce")
              : t("dynopedia.crops");
        const output =
          machine.output.kind === "seeds" ? t("dynopedia.seedsOut") : t(`products.${machine.output.product}`);
        const recipes = (machine.recipes ?? [])
          .map((recipe) => `${t(`products.${recipe.input}`)} → ${t(`products.${recipe.output}`)}`)
          .join(", ");
        cards.push({
          id: machine.id,
          title: t(`machines.${machine.id}`),
          codexKey: `machine:${machine.id}`,
          icon: dynopediaItemIcon("machines", machine.id),
          tags: [
            machine.queued ? t("dynopedia.timed") : `${machine.cooldownCycles} ${t("dynopedia.cycles")}`,
          ],
          detail: `${input} → ${output}${recipes.length > 0 ? ` · ${recipes}` : ""} · ${machine.cooldownCycles} ${t("dynopedia.cycles")}`,
        });
      }
    } else if (dynopediaCategory === "supplies") {
      for (const fertilizer of FERTILIZERS) {
        cards.push({
          id: fertilizer.id,
          title: t(`supplies.${fertilizer.id}`),
          codexKey: null,
          icon: dynopediaItemIcon("supplies", fertilizer.id),
          tags: [`x${fertilizer.growMultiplier}`],
          buy: fertilizer.price,
          detail: `x${fertilizer.growMultiplier} · ${fertilizer.harvests} ${t("dynopedia.harvests")} · ${formatCompact(fertilizer.price)}c`,
        });
      }
      for (const spray of SPRAYS) {
        cards.push({
          id: spray.id,
          title: t(`supplies.${spray.id}`),
          codexKey: null,
          icon: dynopediaItemIcon("supplies", spray.id),
          tags: [`x${SPRAY_MUTATION_BOOST}`],
          buy: spray.price,
          detail: `${spray.effects.map((id) => t(`effects.${id}`)).join(", ")} · x${SPRAY_MUTATION_BOOST} · ${formatCompact(spray.price)}c`,
        });
      }
    } else if (dynopediaCategory === "tools") {
      for (const tool of TOOLS) {
        cards.push({
          id: tool.id,
          title: t(`tools.${tool.id}`),
          codexKey: `tool:${tool.id}`,
          icon: dynopediaItemIcon("tools", tool.id),
          tags: [],
          buy: tool.price,
          detail: `${formatCompact(tool.price)}c`,
        });
      }
    } else if (dynopediaCategory === "buildings") {
      for (const building of BUILDINGS) {
        cards.push({
          id: building.id,
          title: t(`farm.${building.id}`),
          codexKey: null,
          icon: dynopediaItemIcon("buildings", building.id),
          tags: [`${building.slots.join("/")} ${t("dynopedia.slots")}`],
          buy: building.price,
          detail: `${formatCompact(building.price)}c · ${building.slots.join("/")} ${t("dynopedia.slots")} · ${formatCompact(building.upgrade)}c/${t("farm.level")}`,
        });
      }
    } else if (dynopediaCategory === "attachments") {
      for (const attachment of ATTACHMENTS) {
        cards.push({
          id: attachment.id,
          title: t(`attachments.${attachment.id}`),
          codexKey: null,
          icon: dynopediaItemIcon("attachments", attachment.id),
          tags: [t(`farm.${attachment.slot}`)],
          buy: attachment.price,
          detail: `${t(`farm.${attachment.slot}`)} · ${formatCompact(attachment.price)}c · ${t(`dynopedia.attach.${attachment.id}`)}`,
        });
      }
    } else if (dynopediaCategory === "events") {
      for (const event of EVENTS) {
        cards.push({
          id: event.id,
          title: t(`events.${event.id}`),
          codexKey: null,
          icon: dynopediaItemIcon("events", event.id),
          tags: [`grow x${event.growScale}`, `sell x${event.sellBonus}`],
          detail: `${t(`events.${event.id}.desc`)} · grow x${event.growScale} · sell x${event.sellBonus}`,
        });
      }
    } else if (dynopediaCategory === "mechanics") {
      const guides = [
        { id: "synergy", icon: "🧩", tag: "3×3 & 81" },
        { id: "relics", icon: "🏺", tag: "Mine Forge" },
        { id: "guild", icon: "🏰", tag: "Co-op" },
        { id: "news", icon: "📰", tag: "Market Surge" },
        { id: "pet", icon: "🐾", tag: "Expedition" },
        { id: "vip", icon: "🌟", tag: "VIP & Nursery" },
        { id: "mine", icon: "⛏️", tag: "Staff Miner" },
        { id: "stocks", icon: "📈", tag: "VN & US" },
      ] as const;
      for (const guide of guides) {
        cards.push({
          id: `mech:${guide.id}`,
          title: t(`dynopedia.mech.${guide.id}Title`),
          codexKey: null,
          icon: guide.icon,
          tags: [guide.tag],
          detail: t(`dynopedia.mech.${guide.id}Desc`),
        });
      }
    } else {
      for (const pet of PETS) {
        const bonuses: string[] = [];
        if (pet.pestShield !== undefined) bonuses.push(`pest -${Math.round(pet.pestShield * 100)}%`);
        if (pet.extraHarvest !== undefined) bonuses.push(`extra +${Math.round(pet.extraHarvest * 100)}%`);
        if (pet.grow !== undefined) bonuses.push(`grow +${Math.round(pet.grow * 100)}%`);
        if (pet.mutation !== undefined) bonuses.push(`mutation +${Math.round(pet.mutation * 100)}%`);
        if (pet.sell !== undefined) bonuses.push(`sell +${Math.round(pet.sell * 100)}%`);
        cards.push({
          id: pet.id,
          title: t(`pets.${pet.id}`),
          codexKey: `pet:${pet.id}`,
          icon: dynopediaItemIcon("pets", pet.id),
          tags: [t(`petRarity.${pet.rarity}`)],
          detail: `${t(`petRarity.${pet.rarity}`)} · ${bonuses.join(" · ")}`,
        });
      }
    }

    // 5. Render Cards Grid
    const grid = div("garden-dynopedia-grid");
    let shownCount = 0;

    const query = dynopediaQuery.trim();
    const queryLower = query.toLowerCase();
    const queryFolded = foldDiacritics(query);

    for (const card of cards) {
      const isCodex = card.codexKey !== null;
      const isKnown = isCodex ? (state?.collection?.includes(card.codexKey!) ?? false) : true;
      const statusStr = isKnown ? "known" : "unknown";

      const cardEl = div("garden-dynopedia-card garden-dynopedia-row");
      cardEl.dataset.id = card.id;
      cardEl.dataset.category = dynopediaCategory;
      cardEl.dataset.status = statusStr;

      // Top row: Icon + Ident + Status Badge
      const topRow = div("garden-dynopedia-card-top");
      const identWrap = div("garden-dynopedia-ident-wrap");

      const iconEl = div("garden-dynopedia-card-icon");
      iconEl.textContent = card.icon;

      const titleCol = div("garden-dynopedia-title-col");
      const titleEl = div("garden-dynopedia-card-title");
      titleEl.textContent = card.title;
      const idEl = div("garden-dynopedia-card-id");
      idEl.textContent = `#${card.id}`;
      titleCol.append(titleEl, idEl);
      identWrap.append(iconEl, titleCol);

      const statusBadge = div(`garden-dynopedia-status-badge ${isKnown ? "status-known" : "status-unknown"}`);
      statusBadge.textContent = isCodex
        ? isKnown
          ? t("dynopedia.statusDiscovered")
          : t("dynopedia.statusUndiscovered")
        : t(`dynopedia.cat.${dynopediaCategory}`);
      topRow.append(identWrap, statusBadge);
      cardEl.append(topRow);

      // Metrics row
      const metricsRow = div("garden-dynopedia-card-metrics");
      if (card.buy !== undefined) {
        const buyPill = div("garden-dynopedia-pill pill-buy");
        buyPill.textContent = t("dynopedia.buy", { amount: formatCompact(card.buy) });
        metricsRow.append(buyPill);
      }
      if (card.sell !== undefined) {
        const sellPill = div("garden-dynopedia-pill pill-sell");
        sellPill.textContent = t("dynopedia.sell", { amount: formatCompact(card.sell) });
        metricsRow.append(sellPill);

        if (card.buy !== undefined && card.buy > 0) {
          const profitPercent = Math.round(((card.sell - card.buy) / card.buy) * 100);
          if (profitPercent > 0) {
            const profitPill = div("garden-dynopedia-pill pill-profit");
            profitPill.textContent = t("dynopedia.profit", { percent: profitPercent });
            metricsRow.append(profitPill);
          }
        }
      }
      if (card.growTime !== undefined) {
        const growPill = div("garden-dynopedia-pill pill-time");
        growPill.textContent = `⏱️ ${card.growTime}`;
        metricsRow.append(growPill);
      }
      if (card.boost !== undefined) {
        const boostPill = div("garden-dynopedia-pill pill-boost");
        boostPill.textContent = `⚡ ${card.boost}`;
        metricsRow.append(boostPill);
      }
      if (metricsRow.children.length > 0) {
        cardEl.append(metricsRow);
      }

      // Tags row
      if (card.tags.length > 0) {
        const tagsRow = div("garden-dynopedia-card-tags");
        for (const tag of card.tags) {
          const tagPill = div("garden-dynopedia-tag");
          tagPill.textContent = tag;
          tagsRow.append(tagPill);
        }
        cardEl.append(tagsRow);
      }

      // Details footer text
      const descEl = div("garden-dynopedia-card-desc");
      descEl.textContent = card.detail;
      cardEl.append(descEl);

      // Search corpus
      const searchCorpus =
        `${card.id} ${card.title} ${card.detail} ${card.tags.join(" ")} ${card.buy ?? ""} ${card.sell ?? ""}`.toLowerCase();
      cardEl.dataset.search = searchCorpus;

      const matchesQuery =
        query.length === 0 ||
        searchCorpus.includes(queryLower) ||
        foldDiacritics(searchCorpus).includes(queryFolded);
      const matchesFilter =
        dynopediaFilter === "all" ||
        (dynopediaFilter === "known" && isKnown) ||
        (dynopediaFilter === "unknown" && !isKnown);

      const isVisible = matchesQuery && matchesFilter;
      cardEl.hidden = !isVisible;
      if (isVisible) shownCount += 1;

      grid.append(cardEl);
    }

    const emptyBox = div("garden-dynopedia-empty");
    emptyBox.textContent = t("dynopedia.empty");
    emptyBox.hidden = shownCount > 0;
    grid.append(emptyBox);

    wrap.append(grid);

    // 6. Collapsible Culinary Recipe Laboratory
    const labDetails = document.createElement("details");
    labDetails.className = "garden-dynopedia-lab";
    const labSummary = document.createElement("summary");
    labSummary.className = "garden-dynopedia-lab-toggle";
    labSummary.textContent = `🧪 ${t("dynopedia.recipeLabTitle")}`;
    labDetails.append(labSummary);

    const labContent = div("garden-dynopedia-lab-content");
    const labHint = div("garden-dynopedia-lab-hint");
    labHint.textContent = t("dynopedia.recipeLabHint");
    labContent.append(labHint);

    const ingredientList = document.createElement("datalist");
    ingredientList.id = "recipe-ingredients";
    for (const seed of SEEDS) {
      const option = document.createElement("option");
      option.value = seed.id;
      option.label = t(`seeds.${seed.id}`);
      ingredientList.append(option);
    }
    for (const tree of TREES) {
      const option = document.createElement("option");
      option.value = tree.id;
      option.label = t(`trees.${tree.id}`);
      ingredientList.append(option);
    }
    for (const product of PRODUCTS) {
      const option = document.createElement("option");
      option.value = product.id;
      option.label = t(`products.${product.id}`);
      ingredientList.append(option);
    }
    labContent.append(ingredientList);

    const recipeRow = div("garden-restore-row");
    recipeInputs.forEach((value, index) => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "stage-input";
      input.value = value;
      input.placeholder = t("recipe.ingredient", { index: index + 1 });
      input.dataset.role = "recipeInput";
      input.dataset.index = String(index);
      input.setAttribute("list", "recipe-ingredients");
      input.setAttribute("aria-label", t("recipe.ingredient", { index: index + 1 }));
      recipeRow.append(input);
      if (recipeInputs.length > 2) {
        const remove = actionButton("×", "recipeRemoveInput");
        remove.dataset.index = String(index);
        recipeRow.append(remove);
      }
    });
    if (recipeInputs.length < 6) {
      recipeRow.append(actionButton(t("recipe.addIngredient"), "recipeAddInput"));
    }
    labContent.append(recipeRow, actionButton(t("recipe.suggest"), "recipeSuggest"));
    if (recipeResult.length > 0) labContent.append(lineBlock(recipeResult));

    for (const recipe of state?.extras.recipes ?? []) {
      const row = div("garden-machine-row");
      row.append(
        lineBlock(
          `${t("recipe.saved")}: ${recipe.inputs.join(" + ")} → ${recipe.output} · ${formatCompact(recipe.price)}c`,
        ),
      );
      const canCook = state?.extras.kitchen === true;
      const cook = actionButton(t("recipe.cook"), "cookRecipe", canCook);
      if (!canCook) labContent.append(lineBlock(t("kitchen.required")));
      cook.dataset.id = recipe.id;
      row.append(cook);
      labContent.append(row);
    }
    if (globalRecipes.length > 0) {
      labContent.append(lineBlock(`// ${t("recipe.global")}`));
      for (const recipe of globalRecipes) {
        const row = div("garden-machine-row");
        row.append(
          lineBlock(`${recipe.inputs.join(" + ")} → ${recipe.output} · ${formatCompact(recipe.price)}c`),
        );
        const learn = actionButton(t("recipe.learn"), "recipeLearn");
        learn.dataset.id = recipe.id;
        row.append(learn);
        labContent.append(row);
      }
    }

    labDetails.append(labContent);
    wrap.append(labDetails);

    return wrap;
  }

  /** @brief Builds the skill level tab with XP bars and perks. */
  function buildLevels(): HTMLElement {
    const wrap = div("garden-levels");
    if (state === null) return lineBlock(t("common.loading"));
    wrap.append(lineBlock(`// ${t("levels.title")}`));
    for (const skill of ["farming", "ranching", "artisaning"] as const) {
      const progress = state.skills[skill];
      const next = progress.level >= SKILL_MAX_LEVEL ? 0 : skillThreshold(progress.level);
      const ratio = progress.level >= SKILL_MAX_LEVEL || next <= 0 ? 1 : Math.min(1, progress.xp / next);
      const filled = Math.min(20, Math.round(ratio * 20));
      wrap.append(
        lineBlock(
          `// ${t(`skills.${skill}`)} — Lv ${progress.level}/${SKILL_MAX_LEVEL} · ${progress.xp}/${next} XP`,
        ),
      );
      wrap.append(lineBlock(`[${"=".repeat(filled)}${"-".repeat(20 - filled)}]`));
      wrap.append(lineBlock(`// ${t(`skills.${skill}.desc`)}`));
      if (progress.level >= SKILL_MAX_LEVEL) wrap.append(lineBlock(`// ${t("levels.max")}`));
      else wrap.append(lineBlock(`// ${t("levels.nextPerk")}`));
    }
    return wrap;
  }

  /** @brief Loads the weekly tournament for the extras tab. */
  async function loadExtras(force = false): Promise<void> {
    if (disposed || extrasBusy) return;
    if (!force && extrasAt !== 0 && Date.now() - extrasAt < DATA_TTL_MS) return;
    extrasBusy = true;
    try {
      tournament = await api.tournament();
      extrasAt = Date.now();
    } catch {
      // A missing tournament never blocks the garden.
      extrasAt = 0;
    } finally {
      extrasBusy = false;
    }
    if (
      !disposed &&
      (tab === "extras" || (view === "reborn" && rebornTab === "townhall" && townBoard === "tournament"))
    ) {
      render();
    }
  }

  /** @brief Loads guild membership and the public guild board. */
  async function loadGuilds(): Promise<void> {
    try {
      const [mine, board] = await Promise.all([api.guildMine(), api.guildList()]);
      guildSnapshot = mine.guild;
      guildBoard = board.guilds;
      render();
    } catch {
      // Guild panel stays empty while offline.
    }
  }

  /**
   * @brief Loads realtime Vietnamese and international stock quotes from the hub.
   * @param force When true, bypasses the 60s server and client TTL cache.
   */
  async function loadStocks(force = false): Promise<void> {
    if (disposed || stockBusy) return;
    if (!force && stockUpdatedAt !== 0 && Date.now() - stockUpdatedAt < 30_000) return;
    stockBusy = true;
    try {
      const result = await api.stocks(force);
      if (disposed) return;
      stockQuotes = result.quotes;
      stockUpdatedAt = result.updatedAt || Date.now();
    } catch {
      // Keep existing quotes if offline.
    } finally {
      stockBusy = false;
    }
    if (!disposed && view === "reborn" && rebornTab === "townhall" && townBoard === "stocks") render();
  }

  /** @brief Builds the extras tab: streak, contracts, merchant, upgrades. */
  function buildExtras(): HTMLElement {
    const wrap = div("garden-extras");
    if (state === null) return lineBlock(t("common.loading"));
    const extras = state.extras;
    const at = now();
    wrap.append(lineBlock(`// ${t("extras.title")}`));
    const info = [
      t("extras.streak", { count: extras.streak }),
      t("extras.greenhouseLine", { level: extras.greenhouse }),
      t("extras.petLine", { level: extras.pet }),
      t("extras.spliceLine", { bonus: extras.spliceBonus }),
      t("extras.collectionLine", { count: extras.collection.length }),
      t("extras.weekLine", {
        earned: formatCompact(extras.weekEarned),
        harvested: extras.weekHarvested,
      }),
      extras.insuranceUntil > at
        ? t("extras.insured", { time: formatDuration(extras.insuranceUntil - at, "short") })
        : t("extras.notInsured"),
    ];
    for (const line of info) wrap.append(lineBlock(`// ${line}`));
    wrap.append(lineBlock(""));

    wrap.append(lineBlock(`// ${t("extras.actions")}`));
    let cost = INSURANCE_PRICE;
    const insurance = actionButton(t("extras.insurance", { cost }), "extrasInsurance", state.coins >= cost);
    wrap.append(insurance);
    cost = GREENHOUSE_PRICES[extras.greenhouse] ?? 0;
    if (cost > 0) {
      wrap.append(
        actionButton(
          t("extras.greenhouse", { cost: formatCompact(cost) }),
          "extrasGreenhouse",
          state.coins >= cost,
        ),
      );
    }
    const wheelPrice = wheelCost(extras.wheelSpins);
    wrap.append(
      actionButton(
        t("extras.wheel", { cost: formatCompact(wheelPrice) }),
        "extrasWheel",
        state.coins >= wheelPrice,
      ),
      lineBlock(
        `// ${t("extras.wheelToday", {
          spins: extras.wheelSpins,
          cost: formatCompact(wheelCost(extras.wheelSpins + 1)),
        })}`,
      ),
    );
    wrap.append(
      actionButton(
        t("extras.hatch", { cost: formatCompact(EGG_PRICE) }),
        "extrasHatch",
        state.coins >= EGG_PRICE,
      ),
    );
    wrap.append(actionButton(t("extras.compost"), "extrasCompost"));
    if (extras.wheelLast.length > 0)
      wrap.append(lineBlock(`// ${t("extras.wheelLast")}: ${extras.wheelLast}`));

    wrap.append(lineBlock(`// ${t("quests.title")}`));
    for (const quest of extras.quests ?? []) {
      const label = `${t("quests.progress", {
        progress: Math.min(quest.progress, quest.target),
        target: quest.target,
      })} · +${formatCompact(quest.reward)}c`;
      if (quest.claimed) {
        wrap.append(lineBlock(`// ${t(`quests.${quest.id}`)} — ${t("quests.claimed")}`));
      } else {
        const button = actionButton(
          `${t(`quests.${quest.id}`)} · ${label}`,
          "claimQuest",
          quest.progress >= quest.target,
        );
        button.dataset.id = quest.id;
        wrap.append(button);
      }
    }
    if ((extras.quests ?? []).length === 0) wrap.append(lineBlock(t("quests.empty")));

    if ((extras.taxLast ?? 0) > 0) {
      wrap.append(lineBlock(`// ${t("tax.last", { coins: formatCompact(extras.taxLast ?? 0) })}`));
    }

    wrap.append(lineBlock(`// ${t("guild.title")}`));
    if (guildSnapshot !== null) {
      wrap.append(
        lineBlock(t("guild.current", { name: guildSnapshot.name, count: guildSnapshot.members.length })),
      );
      for (const member of guildSnapshot.members) {
        wrap.append(lineBlock(`// [${member.code}] ${member.nick}`));
      }
      wrap.append(lineBlock(t("guild.bank", { coins: formatCompact(guildSnapshot.bank) })));
      const donateRow = div("garden-restore-row");
      const donateInput = document.createElement("input");
      donateInput.type = "number";
      donateInput.min = "1";
      donateInput.className = "stage-input";
      donateInput.value = guildDonateDraft;
      donateInput.dataset.role = "guildDonate";
      donateInput.setAttribute("aria-label", t("guild.donate"));
      donateRow.append(donateInput, actionButton(t("guild.donate"), "guildDonate"));
      wrap.append(donateRow);
      wrap.append(actionButton(t("guild.leave"), "guildLeave"));
    } else {
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "stage-input";
      nameInput.value = guildNameDraft;
      nameInput.placeholder = t("guild.name");
      nameInput.dataset.role = "guildName";
      wrap.append(nameInput, actionButton(t("guild.create"), "guildCreate"));
      for (const guild of guildBoard) {
        const join = actionButton(t("guild.join", { name: guild.name, count: guild.members }), "guildJoin");
        join.dataset.id = guild.id;
        wrap.append(join);
      }
    }

    wrap.append(lineBlock(`// ${t("gift.title")}`));
    const giftRow = div("garden-restore-row");
    const giftCodeInput = document.createElement("input");
    giftCodeInput.type = "text";
    giftCodeInput.className = "stage-input garden-gift-code";
    giftCodeInput.placeholder = t("gift.code");
    giftCodeInput.value = giftCode;
    giftCodeInput.dataset.role = "giftCode";
    giftCodeInput.setAttribute("aria-label", t("gift.code"));
    const giftAmountInput = document.createElement("input");
    giftAmountInput.type = "number";
    giftAmountInput.min = "1";
    giftAmountInput.className = "stage-input garden-gift-amount";
    giftAmountInput.placeholder = t("gift.amount");
    giftAmountInput.value = giftAmount;
    giftAmountInput.dataset.role = "giftAmount";
    giftAmountInput.setAttribute("aria-label", t("gift.amount"));
    giftRow.append(giftCodeInput, giftAmountInput, actionButton(t("gift.sendCoins"), "giftCoins"));
    wrap.append(giftRow);

    const giftGoods = div("garden-tools");
    giftGoods.append(span("garden-hint", t("gift.goods")));
    for (const [seed, qty] of Object.entries(state.bag.seeds)) {
      if ((qty ?? 0) < 1) continue;
      const button = actionButton(`${seedName(seed as SeedId)} ×1`, "giftSeed");
      button.dataset.seed = seed;
      giftGoods.append(button);
    }
    for (const [supply, qty] of Object.entries(state.bag.supplies)) {
      if ((qty ?? 0) < 1) continue;
      const button = actionButton(`${t(`supplies.${supply}`)} ×1`, "giftSupply");
      button.dataset.supply = supply;
      giftGoods.append(button);
    }
    for (const [tool, qty] of Object.entries(state.bag.tools ?? {})) {
      if ((qty ?? 0) < 1) continue;
      const button = actionButton(`${t(`tools.${tool}`)} ×1`, "giftTool");
      button.dataset.tool = tool;
      giftGoods.append(button);
    }
    wrap.append(giftGoods);

    wrap.append(lineBlock(`// ${t("staff.market")}`));
    for (const candidate of staffMarketAt(state.playerId, at)) {
      const traits = candidate.traits.map((trait) => t(`staffTrait.${trait}`)).join(", ");
      const label = `${candidate.name} · ${candidate.speed}⚡ · ${candidate.wage}c/lương · ${traits} · ${t("staff.hireFee", { cost: formatCompact(staffHireCost(candidate)) })}`;
      const hire = actionButton(label, "staffHire", extras.staff.length < STAFF_SLOTS);
      hire.dataset.id = candidate.id;
      wrap.append(hire);
    }
    wrap.append(lineBlock(`// ${t("staff.roster")}`));
    if (extras.staff.length === 0) wrap.append(lineBlock(t("staff.none")));
    extras.staff.forEach((worker, index) => {
      const traits = worker.traits.map((trait) => t(`staffTrait.${trait}`)).join(", ");
      wrap.append(
        lineBlock(
          `// ${worker.name} · ${t("staff.level")} ${worker.level} (${worker.xp} XP) · ${staffIntervalText(worker)} · ${worker.wage}c · ${traits}`,
        ),
      );
      const taskButtons: HTMLButtonElement[] = [];
      for (const role of STAFF_ROLES) {
        const task = actionButton(t(`staffRole.${role}`), "staffTask");
        task.dataset.index = String(index);
        task.dataset.role = role;
        if (worker.role === role) task.classList.add("is-active");
        taskButtons.push(task);
      }
      const fire = actionButton(t("staff.fire"), "staffFire");
      fire.dataset.index = String(index);
      wrap.append(...taskButtons, fire);
    });

    wrap.append(lineBlock(`// ${t("extras.contracts")}`));
    for (const offer of contractOffers(state.playerId, at)) {
      const claimed = extras.contractClaims.includes(offer.id);
      const label = `${t(`products.${offer.product}`)} ≥${offer.star}★ x${offer.qty} → ${formatCompact(offer.reward)}c`;
      if (claimed) wrap.append(lineBlock(`// ${label} [${t("extras.claimed")}]`));
      else {
        const button = actionButton(label, "extrasContract");
        button.dataset.id = offer.id;
        wrap.append(button);
      }
    }

    wrap.append(lineBlock(`// ${t("chain.title")}`));
    const chainStep = extras.chainStep ?? 0;
    const chain = CONTRACT_CHAIN[chainStep];
    if (chain === undefined) {
      wrap.append(lineBlock(t("chain.done")));
    } else {
      const label = `${t(`chain.${chain.id}`)} · ${t(`products.${chain.product}`)} ≥${chain.star}★ x${chain.qty} → ${formatCompact(chain.reward)}c`;
      wrap.append(actionButton(label, "extrasChain"));
      wrap.append(lineBlock(t("chain.progress", { step: chainStep + 1, total: CONTRACT_CHAIN.length })));
    }

    wrap.append(lineBlock(`// ${t("extras.merchant")}`));
    for (const offer of merchantOffers(state.playerId, at)) {
      const claimed = extras.merchantClaims.includes(offer.id);
      const name = offer.kind === "seed" ? seedName(offer.item as SeedId) : t(`tools.${offer.item}`);
      const label = `${name} x${offer.stock} — ${formatCompact(offer.price)}c`;
      if (claimed) wrap.append(lineBlock(`// ${label} [${t("extras.claimed")}]`));
      else {
        const button = actionButton(label, "extrasMerchant");
        button.dataset.id = offer.id;
        button.disabled = state.coins < offer.price;
        wrap.append(button);
      }
    }

    wrap.append(lineBlock(`// ${t("extras.futures")}`));
    if (extras.futures.length === 0) wrap.append(lineBlock(t("extras.noFutures")));
    for (const future of extras.futures) {
      wrap.append(lineBlock(`// ${itemName(future.item)} x${future.qty} @ ${formatCompact(future.price)}c`));
    }
    for (const item of new Set((state.bag.crops ?? []).map((stack) => stack.item))) {
      const button = actionButton(t("extras.lockFuture", { item: itemName(item) }), "extrasFuture");
      button.dataset.item = item;
      wrap.append(button);
    }

    const cropItems = [...new Set((state.bag.crops ?? []).map((stack) => stack.item))];
    if (cropItems.length > 0) wrap.append(lineBlock(`// ${t("extras.splice")}`));
    for (const item of cropItems) {
      const button = actionButton(t("extras.spliceItem", { item: itemName(item) }), "extrasSplice");
      button.dataset.item = item;
      wrap.append(button);
    }

    wrap.append(lineBlock(`// ${t("extras.pets")}`));
    if (extras.lastHatch.length > 0) {
      wrap.append(lineBlock(`// ${t("extras.lastHatch")}: ${t(`pets.${extras.lastHatch}`)}`));
    }
    for (const pet of PETS) {
      const copies = Math.min(PET_MAX_LEVEL, extras.pets[pet.id] ?? 0);
      const parts: string[] = [];
      if (pet.pestShield !== undefined)
        parts.push(t("petEffects.pestShield", { value: Math.round(pet.pestShield * 100) }));
      if (pet.mutation !== undefined)
        parts.push(t("petEffects.mutation", { value: Math.round(pet.mutation * 100) }));
      if (pet.grow !== undefined) parts.push(t("petEffects.grow", { value: Math.round(pet.grow * 100) }));
      if (pet.sell !== undefined) parts.push(t("petEffects.sell", { value: Math.round(pet.sell * 100) }));
      if (pet.extraHarvest !== undefined)
        parts.push(t("petEffects.extraHarvest", { value: Math.round(pet.extraHarvest * 100) }));
      const equipped = extras.equippedPet === pet.id;
      wrap.append(
        lineBlock(
          `${copies > 0 ? "*" : " "} ${t(`pets.${pet.id}`)} [${t(`petRarity.${pet.rarity}`)}] lv${copies}${equipped ? " " + t("extras.equippedLabel") : ""} — ${parts.join(", ")}`,
        ),
      );
      if (copies > 0 && !equipped) {
        const equip = actionButton(t("extras.equip"), "extrasEquip");
        equip.dataset.pet = pet.id;
        wrap.append(equip);
      }
    }

    wrap.append(lineBlock(`// ${t("extras.achievements")}`));
    for (const achievement of ACHIEVEMENTS) {
      const done = extras.achievements.includes(achievement.id);
      wrap.append(lineBlock(`${done ? "[x]" : "[ ]"} ${t(`achievements.${achievement.id}`)}`));
    }

    wrap.append(lineBlock(`// ${t("extras.tournament")}`));
    if (tournament.length === 0) wrap.append(lineBlock(t("extras.tournamentEmpty")));
    tournament.forEach((entry, index) => {
      wrap.append(
        lineBlock(
          `#${index + 1} ${entry.nick} — ${formatCompact(entry.earned)}c · ${entry.harvested} ${t("rank.harvested")}`,
        ),
      );
    });
    return wrap;
  }

  /** @brief Loads the bot garden list for the bots tab. */
  async function loadBots(force = false): Promise<void> {
    if (disposed || botsBusy) return;
    if (!force && botsAt !== 0 && Date.now() - botsAt < DATA_TTL_MS) return;
    botsBusy = true;
    try {
      const result = await api.bots();
      if (disposed) return;
      botGardens = result.bots;
      botsAt = Date.now();
      offline = false;
      render();
    } catch {
      if (!disposed) {
        botsAt = 0;
        offline = true;
        render();
      }
    } finally {
      botsBusy = false;
    }
  }

  /** @brief Builds the dedicated leaderboard tab: one compact row per player. */
  function buildRank(): HTMLElement {
    const wrap = div("garden-rank");
    const header = div("garden-rank-header");
    const kicker = div("garden-rank-kicker");
    kicker.append(`// ${t("rank.title")}`);
    const subtitle = div("garden-rank-subtitle");
    subtitle.append(t("rank.subtitle", { count: leaderboard.length }));
    header.append(kicker, subtitle);
    wrap.append(header);
    if (leaderboard.length === 0) {
      wrap.append(lineBlock(t("rank.empty")));
      return wrap;
    }

    const table = div("garden-rank-table");
    const head = div("garden-rank-row is-head");
    head.append(
      span("garden-rank-cell", t("rank.rank")),
      span("garden-rank-cell is-name", t("rank.player")),
      span("garden-rank-cell", t("rank.coins")),
      span("garden-rank-cell", t("rank.earned")),
      span("garden-rank-cell", t("rank.roi")),
      span("garden-rank-cell", t("rank.harvested")),
    );
    table.append(head);
    leaderboard.forEach((entry, index) => {
      const spent = entry.spent ?? 0;
      const roi = spent > 0 ? Math.round(((entry.earned - spent) / spent) * 100) : entry.earned > 0 ? 100 : 0;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "garden-rank-row";
      if (index < 3) row.classList.add(`is-top-${index + 1}`);
      if (entry.code === currentCode()) row.classList.add("is-self");
      row.dataset.act = "rankVisit";
      row.dataset.code = entry.code;
      row.title = `${t("rank.visitHint", { nick: entry.nick })} · ${formatNumber(entry.coins ?? 0)}c / ${formatNumber(entry.earned)}c`;
      const rank = span("garden-rank-cell is-rank", `#${index + 1}`);
      const avatar = span("garden-rank-avatar", entry.nick.slice(0, 1).toUpperCase());
      avatar.style.background = entry.color;
      const name = span("garden-rank-cell is-name", "");
      name.append(
        avatar,
        span("garden-rank-name-text", entry.nick),
        span("garden-prestige-chip", `P${entry.prestige ?? 0}`),
        span("garden-rank-code", `#${entry.code}`),
      );
      row.append(
        rank,
        name,
        span("garden-rank-cell", `${formatCompact(entry.coins ?? 0)}c`),
        span("garden-rank-cell is-earned", `${formatCompact(entry.earned)}c`),
        span("garden-rank-cell", `${roi >= 0 ? "+" : ""}${roi}%`),
        span("garden-rank-cell", String(entry.harvested)),
      );
      table.append(row);
    });
    wrap.append(table);
    return wrap;
  }

  /** @brief Builds the bots tab: the ten market-maker gardens. */
  function buildBots(): HTMLElement {
    const wrap = div("garden-bots");
    wrap.append(lineBlock(`// ${t("bots.title", { count: botGardens.length })}`));
    if (botGardens.length === 0) {
      wrap.append(lineBlock(t("bots.empty")));
      return wrap;
    }
    for (const bot of botGardens) {
      const row = rowButton(
        "garden-bot-row",
        `${fitText(bot.nick, 12)}${fitText(bot.focus !== undefined ? `[${t("bots.focusCarrot")}]` : bot.ai === true ? `[${t("bots.ai")}]` : "", 10)}${fitText(`#${bot.code}`, 10)}${fitText(`${formatCompact(bot.coins)}c`, 10)}`,
        "visitBot",
      );
      row.dataset.code = bot.code;
      wrap.append(row);
    }
    wrap.append(lineBlock(t("bots.hint")));
    return wrap;
  }

  /** @brief Loads the global market board for the chart tab. */
  async function loadChart(force = false): Promise<void> {
    if (disposed || chartBusy) return;
    if (!force && chartAt !== 0 && Date.now() - chartAt < DATA_TTL_MS) return;
    chartBusy = true;
    try {
      const result = await api.market();
      if (disposed) return;
      chartMarket = result.market;
      chartAt = Date.now();
      offline = false;
      render();
    } catch {
      if (!disposed) {
        chartAt = 0;
        offline = true;
        render();
      }
    } finally {
      chartBusy = false;
    }
  }

  /** @brief Builds the market chart tab: cycle timer and every item's trend. */
  function buildChart(): HTMLElement {
    const wrap = div("garden-chart");
    if (chartMarket === null) {
      wrap.append(lineBlock(offline ? t("common.offline") : t("chart.loading")));
      return wrap;
    }
    const head = div("garden-chart-head");
    head.append(
      span(
        "garden-chart-cycle",
        `// ${t("chart.cycle", { cycle: chartMarket.cycle })} · ${t("chart.next")} `,
      ),
    );
    const timer = span("garden-chart-timer", "");
    timer.dataset.marketTimer = "now";
    timer.textContent = formatDuration(Math.max(0, chartMarket.nextCycleAt - now()));
    head.append(timer, span("garden-chart-hint", t("chart.hint")));
    wrap.append(head);

    const sortBar = div("garden-tools");
    sortBar.append(span("garden-hint", t("chart.sort")));
    const sortButton = (mode: "roi" | "income" | "pressure", label: string) => {
      const button = actionButton(label, "chartSort");
      button.dataset.sort = mode;
      if (chartSort === mode) button.classList.add("is-active");
      sortBar.append(button);
    };
    sortButton("roi", t("chart.sortRoi"));
    sortButton("income", t("chart.sortIncome"));
    sortButton("pressure", t("chart.sortPressure"));
    sortBar.append(span("garden-hint", t("chart.simNote")));
    wrap.append(sortBar);

    const simulated = chartMarket.items.map((item) => {
      const seed = seedById(item.item);
      const tree = treeById(item.item);
      const cost = (seed?.buy ?? tree?.buy ?? 0) * 1000;
      const income = item.price * 1000;
      const profit = income - cost;
      const roi = cost <= 0 ? 0 : (profit / cost) * 100;
      return { ...item, cost, income, profit, roi };
    });
    const items = [...simulated].sort((left, right) => {
      if (chartSort === "roi") return right.roi - left.roi;
      if (chartSort === "income") return right.income - left.income;
      return right.multiplier - left.multiplier;
    });
    for (const item of items) {
      const row = div("garden-chart-row");
      const change = item.previous === 0 ? 0 : (item.multiplier / item.previous - 1) * 100;
      const trend =
        item.multiplier > item.previous ? "is-up" : item.multiplier < item.previous ? "is-down" : "is-flat";
      row.classList.add(trend);
      row.append(
        span("garden-chart-name", itemName(item.item)),
        span("garden-chart-price", `${formatCompact(item.price)}c`),
        span("garden-chart-mult", `x${item.multiplier.toFixed(2)}`),
        span(
          "garden-chart-trend",
          `${item.multiplier > item.previous ? "^" : item.multiplier < item.previous ? "v" : "-"} ${change >= 0 ? "+" : ""}${change.toFixed(0)}%`,
        ),
        span("garden-chart-roi", `${item.roi >= 0 ? "+" : ""}${item.roi.toFixed(0)}%`),
        span("garden-chart-income", `${formatCompact(item.income)}c`),
        span("garden-chart-sold", `${t("chart.sold")} ${item.sold}/${chartMarket.soldTarget}`),
      );
      row.title = `${t("chart.simTooltip", {
        cost: formatNumber(item.cost),
        profit: formatNumber(item.profit),
      })} · ${formatNumber(item.income)}c`;
      wrap.append(row);
    }
    if (chartMarket.offers.length > 0) {
      wrap.append(span("garden-chart-section", `// ${t("chart.buy")}`));
      const offers = [...chartMarket.offers].sort((left, right) => right.multiplier - left.multiplier);
      for (const offer of offers) {
        const row = div("garden-chart-row is-buy");
        const change = offer.previous === 0 ? 0 : (offer.multiplier / offer.previous - 1) * 100;
        const isUp = offer.multiplier > offer.previous;
        row.classList.add(isUp ? "is-up" : offer.multiplier < offer.previous ? "is-down" : "is-flat");
        const name = offer.kind === "seed" ? seedName(offer.item as SeedId) : t(`supplies.${offer.item}`);
        row.append(
          span("garden-chart-name", name),
          span("garden-chart-price", `${formatCompact(offer.price)}c`),
          span("garden-chart-mult", `x${offer.multiplier.toFixed(2)}`),
          span(
            "garden-chart-trend",
            `${isUp ? "^" : offer.multiplier < offer.previous ? "v" : "-"} ${change >= 0 ? "+" : ""}${change.toFixed(0)}%`,
          ),
          span("garden-chart-sold", `${t("chart.bought")} ${offer.bought}/${chartMarket.soldTarget}`),
        );
        wrap.append(row);
      }
    }
    return wrap;
  }

  /** @brief Loads the shared locust raid. */
  async function loadRaid(): Promise<void> {
    try {
      raidSnapshot = await api.raid();
      render();
    } catch {
      // The raid widget simply stays hidden while offline.
    }
  }

  /** @brief Builds the event tab: season, leaderboard and the backup panel. */
  function buildEvent(): HTMLElement {
    const wrap = div("garden-event");

    const seasonPanel = div("garden-event-panel");
    const modifier = weeklyModifier(now());
    seasonPanel.append(
      lineBlock(
        t("event.weekly", {
          name: t(`weekly.${modifier.id}`),
          time: formatDuration(Math.max(0, weekEndsAt(now()) - now())),
        }),
      ),
    );
    if (raidSnapshot !== null) {
      const raidCost = raidHitCost(state?.coins ?? 0);
      seasonPanel.append(
        lineBlock(
          t("raid.hp", {
            hp: formatCompact(raidSnapshot.hp),
            max: formatCompact(raidSnapshot.maxHp),
            time: formatDuration(Math.max(0, raidSnapshot.endsAt - now())),
          }),
        ),
      );
      const hit = actionButton(
        t("raid.hit", { cost: formatCompact(raidCost) }),
        "raidHit",
        mode === "owner" && raidCost > 0,
      );
      seasonPanel.append(hit);
    }
    seasonPanel.append(lineBlock(`// ${t("event.now")}`));
    if (season !== null) {
      seasonPanel.append(
        lineBlock(
          `${t("event.phase")}: ${t(`phase.${season.phase.id}`)} · ${formatDuration(Math.max(0, season.phase.endsAt - now()))}`,
        ),
      );
      const active = season.events;
      if (active.length === 0) {
        seasonPanel.append(lineBlock(`${t("events.calm")} — ${t("events.calm.desc")}`));
      } else {
        for (const event of active) {
          seasonPanel.append(lineBlock(`${t(`events.${event.id}`)} — ${t(`events.${event.id}.desc`)}`));
        }
      }
      const countdown = div("garden-line");
      countdown.dataset.eventTimer = "now";
      seasonPanel.append(countdown);
      seasonPanel.append(lineBlock(""));
      seasonPanel.append(lineBlock(`// ${t("event.next")}`));
      if (season.nextEvents.length === 0) {
        seasonPanel.append(lineBlock(`${t("events.calm")} — ${t("events.calm.desc")}`));
      } else {
        for (const event of season.nextEvents) {
          seasonPanel.append(lineBlock(`${t(`events.${event.id}`)} — ${t(`events.${event.id}.desc`)}`));
        }
      }
      const next = div("garden-line");
      next.dataset.eventTimer = "next";
      seasonPanel.append(next);
      seasonPanel.append(lineBlock(""));
      seasonPanel.append(lineBlock(`// ${t("event.forecast")}`));
      for (const wave of season.forecast) {
        const names =
          wave.length === 0 ? t("events.calm") : wave.map((event) => t(`events.${event.id}`)).join(" + ");
        seasonPanel.append(lineBlock(`// ${names}`));
      }
    } else {
      seasonPanel.append(lineBlock(t("common.loading")));
    }

    wrap.append(seasonPanel, buildRecoveryPanel());
    return wrap;
  }

  /**
   * @brief Builds the shared backup & recovery panel (recovery key display, rotate, and restore input).
   * @return HTMLElement containing the recovery key controls and restore form.
   */
  function buildRecoveryPanel(): HTMLElement {
    const backup = div("garden-event-panel");
    backup.append(lineBlock(`// ${t("event.recoveryTitle")}`));
    if (mode === "owner") {
      backup.append(lineBlock(t("garden.shareHint")));
      const recovery = api.session?.recovery;
      if (recovery !== undefined) backup.append(lineBlock(`${t("garden.recovery")}: ${recovery}`));
      backup.append(actionButton(t("garden.rotateRecovery"), "rotate"));
    }
    backup.append(lineBlock(t("garden.restoreHint")));
    const restoreRow = div("garden-restore-row");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "stage-input garden-restore-input";
    input.placeholder = t("garden.restorePlaceholder");
    input.value = restoreDraft;
    input.dataset.role = "restore";
    input.setAttribute("aria-label", t("garden.recovery"));
    restoreRow.append(input, actionButton(t("garden.restore"), "restore"));
    backup.append(restoreRow);
    return backup;
  }

  /**
   * @brief Builds the Cloudflare account & multi-device sync panel.
   * @return HTMLElement containing account registration, login, link-to-garden, and logout controls.
   */
  function buildAccountSyncPanel(): HTMLElement {
    const panel = div("garden-event-panel");
    panel.append(lineBlock(`// ${t("account.title")}`));
    const activeUser = linkedAccountUsername ?? api.account?.username ?? null;
    if (activeUser !== null) {
      panel.append(lineBlock(t("account.linkedAs", { username: activeUser })));
      panel.append(lineBlock(t("account.multiDeviceActive")));
      const row = div("garden-restore-row");
      const recInput = document.createElement("input");
      recInput.type = "text";
      recInput.className = "stage-input garden-restore-input";
      recInput.placeholder = t("account.recoveryOptionalPlaceholder");
      recInput.value = accountRecoveryDraft;
      recInput.dataset.role = "accountRecovery";
      row.append(
        recInput,
        actionButton(t("account.linkCurrent"), "accountLink"),
        actionButton(t("account.logout"), "accountLogout"),
      );
      panel.append(row);
      return panel;
    }

    panel.append(lineBlock(t("account.hint")));
    if (mode === "owner" && state !== null) {
      panel.append(lineBlock(t("account.currentGardenTarget", { nick: state.nick, code: state.code })));
    }
    const userRow = div("garden-restore-row");
    const userInput = document.createElement("input");
    userInput.type = "text";
    userInput.className = "stage-input garden-restore-input";
    userInput.placeholder = t("account.usernamePlaceholder");
    userInput.value = accountUserDraft;
    userInput.dataset.role = "accountUser";
    userInput.setAttribute("aria-label", t("account.usernamePlaceholder"));

    const passInput = document.createElement("input");
    passInput.type = "password";
    passInput.className = "stage-input garden-restore-input";
    passInput.placeholder = t("account.passwordPlaceholder");
    passInput.value = accountPassDraft;
    passInput.dataset.role = "accountPass";
    passInput.setAttribute("aria-label", t("account.passwordPlaceholder"));
    userRow.append(userInput, passInput);
    panel.append(userRow);

    const actionRow = div("garden-restore-row");
    const recInput = document.createElement("input");
    recInput.type = "text";
    recInput.className = "stage-input garden-restore-input";
    recInput.placeholder = t("account.recoveryOptionalPlaceholder");
    recInput.value = accountRecoveryDraft;
    recInput.dataset.role = "accountRecovery";
    actionRow.append(
      recInput,
      actionButton(t("account.registerLink"), "accountRegister"),
      actionButton(t("account.loginSync"), "accountLogin"),
    );
    panel.append(actionRow);
    return panel;
  }

  /**
   * @brief Builds the dedicated top-level Restore tab content in the rebuilt view.
   * @return HTMLElement wrapping the Cloudflare account sync panel and backup & recovery panel.
   */
  function buildRebornRestoreSection(): HTMLElement {
    const wrap = div("garden-event");
    wrap.append(buildAccountSyncPanel(), buildRecoveryPanel());
    return wrap;
  }

  /** @brief Builds the retry block for a dead connection. */
  function buildRetry(): HTMLElement {
    const wrap = div("garden-garden");
    wrap.append(lineBlock(t("common.offline")));
    const retry = actionButton(t("common.retry"), "retry");
    wrap.append(retry);
    return wrap;
  }

  /** @brief Builds the active view content. */
  function buildContent(): HTMLElement {
    if (view === "reborn") return buildRebornView();
    if (mode === "owner" && state === null)
      return lineBlock(offline ? t("common.offline") : t("common.loading"));
    if (mode === "visit" && visiting === null)
      return lineBlock(offline ? t("common.offline") : t("common.loading"));
    return buildLegacyContent();
  }

  /**
   * @brief Builds the rebuilt UI: sub-tab strip, then the active tab body.
   * @details The garden tab carries a second strip (main garden, mushroom house,
   * greenhouse, nursery); the town tab is the townhall. Only the main garden is
   * rebuilt so far, the other garden tabs are placeholders for the next UI passes.
   */
  function buildRebornView(): HTMLElement {
    const at = now();
    const wrap = div("garden-reborn");
    wrap.append(buildRebornTabStrip());
    // Owner views keep the AI thought feed fresh; the loader has its own TTL.
    if (mode === "owner") void loadBots();
    if (rebornTab === "townhall") {
      wrap.append(buildTownhallSection());
      return wrap;
    }
    if (rebornTab === "weather") {
      wrap.append(buildWeatherSection(at));
      return wrap;
    }
    if (rebornTab === "event") {
      wrap.append(buildRebornEventSection());
      return wrap;
    }
    if (rebornTab === "dynopedia") {
      wrap.append(buildDynopedia());
      return wrap;
    }
    if (rebornTab === "log") {
      wrap.append(buildRebornLog());
      return wrap;
    }
    if (rebornTab === "levels") {
      wrap.append(buildLevels());
      return wrap;
    }
    if (rebornTab === "restore") {
      wrap.append(buildRebornRestoreSection());
      return wrap;
    }
    wrap.append(buildGardenTabStrip());
    if (gardenTab !== "main") {
      // The main garden's quick actions stay available in every garden tab:
      // they are garden-wide, so the mushroom house and the future rooms can
      // trigger them without walking back to the main board.
      const row = div("garden-reborn-row");
      const content = div("garden-tab-body");
      content.append(buildGardenTabBody(at));
      row.append(content);
      if (mode === "owner") row.append(div("garden-reborn-sep"), buildRebornSide(at));
      wrap.append(row);
      if (mode === "owner") {
        const popover = buildQuickPopover(at);
        if (popover !== null) wrap.append(popover);
      }
      return wrap;
    }
    const row = div("garden-reborn-row");
    const vip = div("garden-reborn-vip");
    const owned = specialView()?.owned ?? 0;
    vip.append(
      lineBlock(`// ${t("reborn.vipTitle")} · ${t("reborn.vipProgress", { owned, total: SPECIAL_SLOTS })}`),
      buildRebornBoard(rebornPlots(), at, activeHybrids()),
    );
    row.append(vip);
    if (mode === "owner") row.append(div("garden-reborn-sep"), buildRebornSide(at));
    wrap.append(row);
    if (mode === "owner" && staffPanel !== null) {
      const panel = buildStaffPanel(at);
      if (panel !== null) wrap.append(panel);
      else staffPanel = null;
    }
    appendSpecialPickers(wrap);
    if (mode === "owner") {
      const popover = buildQuickPopover(at);
      if (popover !== null) wrap.append(popover);
    }
    wrap.append(buildRebornGarden(at));
    if (mode === "owner") wrap.append(buildAiThoughts());
    return wrap;
  }

  /**
   * @brief Thought feed for the five AI bots, under the garden.
   * @details Shows the short plan the model wrote, the action kinds it ran and
   * whether the deterministic fallback had to take over.
   */
  function buildAiThoughts(): HTMLElement {
    const wrap = div("garden-ai-thoughts");
    wrap.append(lineBlock(`// ${t("aiBots.title")}`));
    const bots = botGardens.filter((bot) => bot.ai === true);
    if (bots.length === 0) {
      wrap.append(lineBlock(t("aiBots.empty")));
      return wrap;
    }
    for (const bot of bots) {
      const thought = bot.thought;
      if (thought === undefined) {
        wrap.append(lineBlock(`${bot.nick} · ${t("aiBots.waiting")}`));
        continue;
      }
      const ago = formatDuration(Math.max(0, Date.now() - thought.at), "short");
      const label = thought.fallback === true ? t("aiBots.fallback") : (thought.model ?? t("aiBots.noModel"));
      wrap.append(lineBlock(`${bot.nick} · ${ago} · ${label}`));
      if (thought.reasoning !== undefined) wrap.append(span("garden-hint", `  → ${thought.reasoning}`));
      if (thought.cot !== undefined && thought.cot !== thought.reasoning) {
        wrap.append(span("garden-hint", `  ${t("aiBots.cot")}: ${thought.cot}`));
      }
      if (thought.actions !== undefined && thought.actions.length > 0) {
        wrap.append(lineBlock(`  ${t("aiBots.actions")}: ${thought.actions.join(", ")}`));
      }
      if (thought.error !== undefined) wrap.append(lineBlock(`  ! ${thought.error}`));
    }
    return wrap;
  }

  /** @brief Staff cells beside the quick actions: four slots as plot cells. */
  function buildRebornStaffCells(): HTMLElement {
    const grid = div("garden-staff-grid");
    const staff = state?.extras.staff ?? [];
    for (let slot = 0; slot < STAFF_SLOTS; slot += 1) {
      const worker = staff[slot];
      if (worker === undefined) {
        grid.append(
          buildRebornAction({
            id: `staff:${slot}`,
            label: t("staff.emptyShort"),
            glyph: "+",
            note: t("staff.hireShort"),
            tone: "money",
            act: "staffCell",
            data: { index: String(slot) },
            title: t("staff.panelHint"),
          }),
        );
        continue;
      }
      grid.append(
        buildRebornAction({
          id: `staff:${slot}`,
          label: worker.name,
          glyph: "s",
          note: t(`staffRoleShort.${worker.role}`),
          tone: "money",
          act: "staffCell",
          data: { index: String(slot) },
          title: `${worker.name} · ${t("staff.level")} ${worker.level} · ${t(`staffRole.${worker.role}`)}`,
        }),
      );
    }
    return grid;
  }

  /** @brief Empty crop cells, tree slots and mushroom trays Quick Plan can fill. */
  function planEmptyCounts(): { crops: number; trees: number; trays: number } {
    const crops = (state?.plots ?? []).filter(
      (plot, slot) => plot === null && !cropSlotLocked(slot) && state?.damagedPlots?.[slot] !== true,
    ).length;
    const trees = (state?.trees ?? []).filter((tree) => tree === null).length;
    const trays = (state?.mushroomTrays ?? []).filter((tray) => tray === null).length;
    return { crops, trees, trays };
  }

  /** @brief Preview panel: what Quick Plan would buy and plant. */
  function buildQuickPlanPanel(preview: QuickPlanPreview): HTMLElement {
    const wrap = div("garden-plan-panel");
    wrap.append(lineBlock(`// ${t("quick.planPreview")}`));
    const section = (
      labelKey: string,
      entries: readonly { id: string; qty: number; unitCost: number }[],
      nameKey: string,
    ): void => {
      if (entries.length === 0) return;
      const text = entries
        .map((entry) => `${t(`${nameKey}.${entry.id}`)} ×${entry.qty} · ${formatCompact(entry.unitCost)}c`)
        .join(" · ");
      wrap.append(lineBlock(`${t(labelKey)}: ${text}`));
    };
    section("quick.planCrops", preview.crops, "seeds");
    section("quick.planTrees", preview.trees, "trees");
    section("quick.planMushrooms", preview.mushrooms, "mushrooms");
    wrap.append(
      lineBlock(t("quick.planTotal", { slots: preview.slots, cost: formatCompact(preview.totalCost) })),
    );
    const row = div("garden-tools");
    row.append(
      actionButton(t("quick.planConfirm"), "quickPlanRun"),
      actionButton(t("quick.planCancel"), "quickPlanCancel"),
    );
    wrap.append(row);
    return wrap;
  }
  /**
   * @brief Popover holding the menu of one quick action.
   * @param at Server-clock time.
   * @details Pickers, uproot filters and the Quick Plan preview all render here,
   * anchored at the clicked quick-action cell instead of under the toolbar.
   */
  function buildQuickPopover(at: number): HTMLElement | null {
    if (quickMenu === null) return null;
    const body = div("garden-quick-menu-body");
    appendToolPickers(body);
    appendUprootPanel(body);
    if (quickPlanPreview !== null) body.append(buildQuickPlanPanel(quickPlanPreview));
    if (body.childElementCount === 0) {
      quickMenu = null;
      return null;
    }
    const wrap = div("garden-menu garden-quick-menu");
    const width = 380;
    const left = Math.min(Math.max(8, quickMenu.x), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(Math.max(8, quickMenu.y), Math.max(8, window.innerHeight - 220));
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
    wrap.append(body, actionButton(t("common.close"), "quickMenuClose"));
    return wrap;
  }
  /**
   * @brief Panel for hiring an empty staff slot or reconfiguring a hired worker.
   * @param at Server-clock time.
   * @return The panel, or `null` when the open slot has no worker and no market.
   */
  function buildStaffPanel(at: number): HTMLElement | null {
    if (staffPanel === null || state === null) return null;
    const wrap = div("garden-staff-panel");
    const staff = state.extras.staff ?? [];
    const worker = staff[staffPanel];
    if (worker === undefined) {
      wrap.append(lineBlock(`// ${t("staff.market")} · ${staff.length}/${STAFF_SLOTS}`));
      const market = div("garden-staff-market");
      for (const candidate of staffMarketAt(state.playerId, at)) {
        const traits = candidate.traits.map((trait) => t(`staffTrait.${trait}`)).join(", ");
        const hire = actionButton(
          `${candidate.name} · ${candidate.speed}⚡ · ${candidate.skill}✦ · ${staffIntervalText({ ...candidate, level: 1 })} · ${t("staff.wage", { wage: candidate.wage })} · ${traits} · ${formatCompact(staffHireCost(candidate))}c`,
          "staffHire",
          staff.length < STAFF_SLOTS,
        );
        hire.dataset.id = candidate.id;
        market.append(hire);
      }
      wrap.append(market);
    } else {
      const traits = worker.traits.map((trait) => t(`staffTrait.${trait}`)).join(", ");
      const info = document.createElement("pre");
      info.className = "garden-menu-info";
      info.textContent = [
        `// ${worker.name} · ${t("staff.level")} ${worker.level} (${worker.xp}/${staffXpToLevel(worker.level)} XP) · ${worker.wage}c`,
        `${staffIntervalText(worker)} · ${traits}`,
        `${t("staff.currentTask")}: ${t(`staffRole.${worker.role}`)}`,
      ].join("\n");
      wrap.append(
        info,
        lineBlock(`// ${t("staff.formula")}`),
        lineBlock(`//   ${t("staff.formulaLine")}`),
        lineBlock(`//   ${t("staff.formulaQuality")}`),
        lineBlock(
          `// ${t("staff.formulaNow", {
            speed: worker.speed,
            skill: worker.skill,
            level: worker.level,
            quality: worker.speed + worker.skill + Math.floor(worker.level / 2),
            minutes: Math.round(staffWorkIntervalMs(worker) / 60_000),
          })}`,
        ),
        lineBlock(t("staff.assignHint")),
      );
      const tasks = div("garden-tools");
      for (const role of STAFF_ROLES) {
        const task = actionButton(t(`staffRole.${role}`), "staffTask");
        task.dataset.index = String(staffPanel);
        task.dataset.role = role;
        if (worker.role === role) task.classList.add("is-active");
        tasks.append(task);
      }
      const fire = actionButton(t("staff.fire"), "staffFire");
      fire.dataset.index = String(staffPanel);
      tasks.append(fire);
      wrap.append(tasks);
    }
    wrap.append(actionButton(t("common.close"), "staffPanelClose"));
    return wrap;
  }

  /**
   * @brief Quick actions plus the four staff cells, kept on one row.
   * @param at Server-clock time.
   * @details They share a single flex cluster so the staff block never wraps
   * away from the quick actions on narrower screens.
   */
  function buildRebornSide(at: number): HTMLElement {
    const side = div("garden-reborn-side");
    side.append(buildQuickColumn(at), div("garden-reborn-sep"));
    const staff = div("garden-reborn-staff");
    staff.append(lineBlock(`// ${t("staff.rebornTitle")}`), buildRebornStaffCells());
    side.append(staff);
    return side;
  }

  /** @brief The quick action column shared by every garden tab. */
  function buildQuickColumn(at: number): HTMLElement {
    const quick = div("garden-reborn-quick");
    quick.append(lineBlock(`// ${t("quick.title")}`), buildRebornActionColumns(rebornActionColumns(at)));
    return quick;
  }

  /** @brief Builds the garden / townhall sub-tab strip of the rebuilt view. */
  function buildRebornTabStrip(): HTMLElement {
    const bar = div("garden-tabs garden-tabs-reborn");
    for (const entry of REBORN_TABS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "garden-reborn-tab";
      button.dataset.act = `rebornTab:${entry.id}`;
      const label = t(entry.labelKey);
      button.textContent = rebornTab === entry.id ? `[ ${label} ]` : ` ${label} `;
      if (rebornTab === entry.id) button.classList.add("is-active");
      bar.append(button);
    }
    return bar;
  }

  /** @brief Switches the rebuilt view between garden, townhall, weather, dynopedia, and log. */
  function switchRebornTab(next: RebornTab): void {
    if (rebornTab === next) return;
    rebornTab = next;
    townNpc = null;
    townBoard = null;
    if (next === "dynopedia") {
      void loadGlobalRecipes();
      void loadGlobalHybrids();
    }
    if (next === "log") {
      void loadGlobalSales();
    }
    if (next === "event" || next === "weather") {
      void loadRaid();
    }

    syncGardenQuery();
    render();
  }

  /** @brief Builds the second-level tab strip inside the garden tab. */
  function buildGardenTabStrip(): HTMLElement {
    const bar = div("garden-tabs garden-tabs-section");
    for (const entry of GARDEN_TABS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "garden-section-tab";
      button.dataset.act = `gardenTab:${entry.id}`;
      const label = t(entry.labelKey);
      button.textContent = gardenTab === entry.id ? `[ ${label} ]` : ` ${label} `;
      if (gardenTab === entry.id) button.classList.add("is-active");
      bar.append(button);
    }
    return bar;
  }

  /** @brief Switches the garden tab between main garden, mushroom house, … */
  function switchGardenTab(next: GardenTab): void {
    if (gardenTab === next) return;
    gardenTab = next;
    selectedSlot = null;
    menu = null;
    mushroomPicker = null;
    mushroomInfo = null;
    greenhousePicker = null;
    greenhouseMenu = null;
    greenhouseSupplyPicker = null;
    nurseryPopover = null;
    staffPanel = null;
    quickPlanPreview = null;
    quickMenu = null;
    if (next === "kitchen") {
      void loadGlobalRecipes();
    }
    syncGardenQuery();
    render();
  }

  /**
   * @brief Builds the mushroom house: spawn shop, 27 trays and the spawn picker.
   * @param at Server-clock time.
   * @details Trays are plot cells. An empty tray opens the spawn picker; a tray
   * whose batch is ripe harvests straight into the product bag.
   */
  function buildMushroomHouse(at: number): HTMLElement {
    const wrap = div("garden-mushroom-house");
    wrap.append(lineBlock(`// ${t("mushroomHouse.title")} · ${t("mushroomHouse.summary")}`));
    if (mode === "visit") {
      wrap.append(lineBlock(t("mushroomHouse.visitHint")));
      return wrap;
    }
    const coins = state?.coins ?? 0;
    const spawn = state?.mushroomSpawn ?? {};
    const shop = div("garden-mushroom-spawns");
    for (const mushroom of MUSHROOMS) {
      const owned = spawn[mushroom.id] ?? 0;
      shop.append(
        buildRebornAction({
          id: `spawn:${mushroom.id}`,
          label: t(`mushrooms.${mushroom.id}`),
          glyph: mushroom.art[2] ?? "m",
          note: `${formatCompact(mushroom.spawn)}c·${owned}`,
          tone: "harvest",
          act: "buyMushroomSpawn",
          data: { mushroom: mushroom.id },
          title: `${t(`mushrooms.${mushroom.id}`)} · ${t("mushroomHouse.buySpawn")} ${formatNumber(mushroom.spawn)}c · ${t("mushroomHouse.spawnOwned")} ${owned}`,
          disabled: coins < mushroom.spawn,
        }),
      );
    }
    wrap.append(shop);
    const grid = div("garden-mushroom-grid");
    for (let slot = 0; slot < MUSHROOM_TRAYS; slot += 1) {
      const cell = buildRebornAction(mushroomTrayAction(slot, at));
      cell.classList.add("garden-mushroom-tray");
      cell.dataset.slot = String(slot);
      grid.append(cell);
    }
    wrap.append(grid);
    if (mushroomPicker !== null) wrap.append(buildMushroomPicker(mushroomPicker));
    else if (mushroomInfo !== null) {
      const panel = buildMushroomInfoPanel(mushroomInfo, at);
      if (panel !== null) wrap.append(panel);
      else mushroomInfo = null;
    }
    return wrap;
  }

  /** @brief One mushroom tray as a plot-styled cell. */
  function mushroomTrayAction(slot: number, at: number): RebornAction {
    const tray = (state?.mushroomTrays ?? [])[slot] ?? null;
    if (tray === null) {
      return {
        id: `tray:${slot}`,
        label: t("mushroomHouse.emptyTray"),
        glyph: ".",
        note: "--",
        act: "mushroomTray",
        data: { slot: String(slot) },
        title: t("mushroomHouse.pickSpawn"),
      };
    }
    const definition = mushroomById(tray.mushroom);
    const ready = at >= tray.readyAt;
    const progress = Math.min(
      1,
      Math.max(0, (at - tray.plantedAt) / Math.max(1, tray.readyAt - tray.plantedAt)),
    );
    const stage = ready ? 3 : Math.min(2, Math.floor(progress * 3));
    return {
      id: `tray:${slot}`,
      label: t(`mushrooms.${tray.mushroom}`),
      glyph: definition?.art[stage] ?? "m",
      note: ready ? t("mushroomHouse.ready") : formatDuration(tray.readyAt - at, "short"),
      tone: ready ? "harvest" : "fertilizer",
      active: ready,
      act: "mushroomTray",
      data: { slot: String(slot) },
      title: ready
        ? t("mushroomHouse.trayReadyHint")
        : `${t(`mushrooms.${tray.mushroom}`)} · ${formatDuration(tray.readyAt - at, "short")}`,
    };
  }

  /** @brief Spawn picker shown after clicking an empty tray. */
  function buildMushroomPicker(slot: number): HTMLElement {
    const wrap = div("garden-mushroom-picker");
    wrap.append(lineBlock(t("mushroomHouse.pickSpawn")));
    const spawn = state?.mushroomSpawn ?? {};
    const row = div("garden-mushroom-spawns");
    let any = false;
    for (const mushroom of MUSHROOMS) {
      const owned = spawn[mushroom.id] ?? 0;
      if (owned < 1) continue;
      any = true;
      row.append(
        buildRebornAction({
          id: `plant:${mushroom.id}`,
          label: t(`mushrooms.${mushroom.id}`),
          glyph: mushroom.art[2] ?? "m",
          note: String(owned),
          tone: "fertilizer",
          act: "mushroomPlant",
          data: { slot: String(slot), mushroom: mushroom.id },
        }),
      );
    }
    if (any) wrap.append(row);
    else wrap.append(lineBlock(t("mushroomHouse.noSpawn")));
    wrap.append(actionButton(t("mushroomHouse.close"), "mushroomPickerClose"));
    return wrap;
  }

  /**
   * @brief Builds the info panel for one occupied mushroom tray.
   * @param slot Tray index.
   * @param at Server-clock time.
   * @return The panel, or `null` when the tray is empty.
   * @details Clicking a tray opens this instead of acting blind: species, cycle
   * length, batch size, base price, spawn price and the live countdown, plus the
   * harvest button once the batch is ripe.
   */
  function buildMushroomInfoPanel(slot: number, at: number): HTMLElement | null {
    const tray = (state?.mushroomTrays ?? [])[slot] ?? null;
    if (tray === null) return null;
    const definition = mushroomById(tray.mushroom);
    if (definition === undefined) return null;
    const ready = at >= tray.readyAt;
    const name = t(`mushrooms.${tray.mushroom}`);
    const panel = div("garden-mushroom-info");
    panel.dataset.ready = ready ? "on" : "off";
    panel.dataset.slot = String(slot);
    const info = document.createElement("pre");
    info.className = "garden-menu-info";
    info.textContent = [
      `// ${t("mushroomHouse.infoTitle", { slot: slot + 1, name })}`,
      labelValue(
        t("mushroomHouse.infoCycles"),
        `${definition.cycles} · ${formatDuration(definition.cycles * FARM_CYCLE_MS)}`,
      ),
      labelValue(t("mushroomHouse.infoYield"), `${definition.batch} ${t("mushroomHouse.infoPerBatch")}`),
      labelValue(t("mushroomHouse.infoBase"), `${formatNumber(definition.base)}c`),
      labelValue(t("mushroomHouse.infoSpawn"), `${formatNumber(definition.spawn)}c`),
      labelValue(t("mushroomHouse.infoMutation"), t("mushroomHouse.infoMutationYes")),
      ready
        ? t("mushroomHouse.infoReady")
        : t("mushroomHouse.infoGrowing", { time: formatDuration(tray.readyAt - at) }),
    ].join("\n");
    panel.append(info);
    const rows = div("garden-tools");
    if (ready) {
      const harvest = actionButton(t("mushroomHouse.harvest"), "mushroomHarvest");
      harvest.dataset.slot = String(slot);
      rows.append(harvest);
    }
    rows.append(actionButton(t("mushroomHouse.close"), "mushroomInfoClose"));
    panel.append(rows);
    return panel;
  }

  /**
   * @brief Returns the active farm snapshot for greenhouse rendering (owner or visited friend).
   * @return Active garden or visit snapshot, or `null` when unavailable.
   */
  function greenhouseView(): GardenSnapshot | VisitSnapshot | null {
    return mode === "visit" ? visiting : state;
  }

  /**
   * @brief Repaints one 81-slot greenhouse cell with auto-water and HighQuality protection.
   * @param button Target ASCII button cell element.
   * @param slot Zero-based greenhouse slot index (0..80).
   * @param at Server-clock timestamp.
   */
  function syncGreenhouseCell(button: HTMLButtonElement, slot: number, at: number): void {
    const view = greenhouseView();
    for (let index = 0; index < 6; index += 1) {
      const line = button.children.item(index);
      if (line instanceof HTMLElement) line.textContent = "";
    }
    button.classList.remove("is-empty", "is-ready", "is-locked", "is-pest", "is-diseased");
    if (view === null) return;
    const capacity = greenhouseCapacity(view.extras.greenhouse ?? 0);
    if (slot >= capacity) {
      button.classList.add("is-locked");
      button.disabled = true;
      const line0 = button.children.item(0);
      if (line0 instanceof HTMLElement) line0.textContent = "· · ·";
      button.dataset.act = "greenhouseNoop";
      button.title = t("greenhouse.lockedPlot");
      return;
    }
    const plot = view.greenhousePlots?.[slot] ?? null;
    const rendered = cellRender(plot, at, null, slot, activeHybrids(), true);
    for (let index = 0; index < 6; index += 1) {
      const line = button.children.item(index);
      if (line instanceof HTMLElement) line.textContent = rendered.lines[index] ?? "";
    }
    button.classList.toggle("is-ready", rendered.ready);
    button.classList.toggle("is-empty", rendered.empty);
    button.disabled = false;
    button.dataset.act = "greenhousePlot";
    button.title =
      plot === null
        ? t("greenhouse.emptyPlot")
        : rendered.ready
          ? t("greenhouse.harvest")
          : seedName(plot.seed);
  }

  /**
   * @brief Builds the inline seed picker for planting into one greenhouse plot.
   * @param slot Target greenhouse slot index.
   * @return Picker container listing owned seeds, hybrids, and seasonal shop seeds.
   */
  function buildGreenhousePicker(slot: number): HTMLElement {
    const wrap = div("garden-seeds");
    wrap.append(span("garden-hint", t("greenhouse.pickSeed", { slot: slot + 1 })));
    const catalog = [...SEEDS, ...activeHybrids().map((hybrid) => hybridAsSeedDefinition(hybrid))];
    const offers = new Set((season?.shop.offers ?? []).map((entry) => entry.seed));
    let any = false;
    for (const entry of catalog) {
      const owned = state?.bag.seeds[entry.id] ?? 0;
      const canBuy = !isHybridId(entry.id) && offers.has(entry.id as SeedId);
      if (owned < 1 && !canBuy) continue;
      any = true;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "garden-row";
      row.dataset.slot = String(slot);
      row.dataset.seed = entry.id;
      if (owned > 0) {
        row.dataset.act = "greenhousePlantSeed";
        row.textContent = `${fitText(seedName(entry.id), 12)}${fitText(`${t("garden.bag")} ${owned}`, 8)}${formatDuration(entry.growMs, "short")}`;
      } else {
        row.dataset.act = "greenhouseBuyAndPlant";
        const price = season?.buyPrices?.[entry.id as SeedId] ?? entry.buy;
        row.disabled = (state?.coins ?? 0) < price;
        row.textContent = `${fitText(seedName(entry.id), 12)}${fitText(`${formatCompact(price)}c`, 8)}${formatDuration(entry.growMs, "short")}`;
      }
      wrap.append(row);
    }
    if (!any) wrap.append(span("garden-hint", t("greenhouse.noSeeds")));
    wrap.append(actionButton(t("common.close"), "greenhousePickerClose"));
    return wrap;
  }

  /**
   * @brief Builds the fertilizer picker for one growing greenhouse plot.
   * @param slot Target greenhouse slot index.
   * @return Supply picker container element.
   */
  function buildGreenhouseSupplyPicker(slot: number): HTMLElement {
    const wrap = div("garden-seeds");
    for (const supply of FERTILIZERS) {
      const owned = state?.bag.supplies[supply.id] ?? 0;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "garden-row";
      row.dataset.act = "greenhouseFertilize";
      row.dataset.slot = String(slot);
      row.dataset.supply = supply.id;
      row.disabled = owned < 1;
      row.textContent = `${fitText(t(`supplies.${supply.id}`), 16)}${fitText(`${owned}`, 4)}x${supply.growMultiplier} · ${supply.harvests}`;
      wrap.append(row);
    }
    wrap.append(actionButton(t("common.close"), "greenhouseSupplyClose"));
    return wrap;
  }

  /**
   * @brief Builds the floating context menu for a clicked greenhouse plot.
   * @param at Server-clock timestamp.
   * @return Popover element or `null` when closed or out of bounds.
   */
  function buildGreenhouseMenu(at: number): HTMLElement | null {
    if (greenhouseMenu === null || mode !== "owner") return null;
    const view = greenhouseView();
    const slot = greenhouseMenu.slot;
    const capacity = greenhouseCapacity(view?.extras.greenhouse ?? 0);
    if (view === null || slot < 0 || slot >= capacity) return null;
    const plot = view.greenhousePlots?.[slot] ?? null;
    const wrap = div("garden-menu garden-greenhouse-menu");
    const left = Math.min(Math.max(8, greenhouseMenu.x), Math.max(8, window.innerWidth - 340 - 8));
    const top = Math.min(Math.max(8, greenhouseMenu.y), Math.max(8, window.innerHeight - 180));
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;

    const head = div("garden-menu-head");
    head.append(span("garden-menu-title", `${t("greenhouse.title")} · #${slot + 1}`));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "garden-menu-close";
    close.dataset.act = "greenhouseMenuClose";
    close.textContent = "×";
    close.setAttribute("aria-label", t("common.close"));
    head.append(close);
    wrap.append(head);

    const info = document.createElement("pre");
    info.className = "garden-menu-info";
    if (plot === null) {
      info.textContent = `${t("greenhouse.emptyPlot")}\n${t("greenhouse.perkQuality")}\n${t("greenhouse.immune")}`;
    } else {
      const effects = resolvedCropEffects(plot, at, false, true);
      const pv = plotView(plot, at, activeHybrids(), true);
      const value =
        season === null
          ? null
          : cropSellPrice(
              { item: plot.seed, effects, pest: false, star: 1, qty: 1 },
              season,
              activeHybrids(),
            );
      const lines = [
        `// ${seedName(plot.seed)}`,
        labelValue(t("garden.stage"), pv.ready ? t("garden.ripe") : t("garden.growing")),
        labelValue(t("garden.timeLeft"), pv.ready ? t("garden.ready") : formatDuration(pv.remainingMs)),
        labelValue(t("garden.effects"), effectBadge(effects) || t("effects.highquality")),
        labelValue(t("side.value"), value === null ? "—" : `${formatCompact(value)}c`),
        `// ${t("greenhouse.autoWatered")}`,
        `// ${t("greenhouse.immune")}`,
      ];
      info.textContent = lines.join("\n");
    }
    wrap.append(info);

    const rows = div("garden-menu-rows");
    if (plot === null) {
      rows.append(menuRow(`[ ${t("greenhouse.plant")} ]`, "greenhouseMenuPlant"));
    } else {
      const pv = plotView(plot, at, activeHybrids(), true);
      if (pv.ready) {
        rows.append(menuRow(`[ ${t("greenhouse.harvest")} ]`, "greenhouseMenuHarvest"));
      }
      rows.append(
        menuRow(`[ ${t("greenhouse.fertilize")} ]`, "greenhouseMenuFertilize"),
        menuRow(`[ ${t("greenhouse.uproot")} ]`, "greenhouseMenuUproot"),
      );
    }
    rows.append(menuRow(t("common.close"), "greenhouseMenuClose"));
    wrap.append(rows);
    return wrap;
  }

  /**
   * @brief Builds the 81-slot Reborn Greenhouse tab with auto-water, HighQuality x3,
   * pest/hazard immunity, bulk plant/harvest controls, and upgrade tiers.
   * @param at Server-clock timestamp.
   * @return Complete Greenhouse tab container element.
   */
  function buildGreenhouseTab(at: number): HTMLElement {
    const wrap = div("garden-greenhouse-reborn");
    const view = greenhouseView();
    if (view === null) return lineBlock(t("common.loading"));

    const level = view.extras.greenhouse ?? 0;
    const capacity = greenhouseCapacity(level);
    wrap.append(
      lineBlock(
        `// ${t("greenhouse.title")} · ${t("greenhouse.slots", { owned: capacity, max: GREENHOUSE_SLOTS })}`,
      ),
    );

    const perks = div("garden-greenhouse-perks");
    for (const key of ["perkWater", "perkQuality", "perkSafe", "perkStaff", "perkLimit"] as const) {
      perks.append(span("garden-greenhouse-perk", t(`greenhouse.${key}`)));
    }
    wrap.append(perks);

    if (mode === "visit") {
      wrap.append(lineBlock(t("greenhouse.visitHint")));
    }

    if (mode === "owner") {
      const controls = div("garden-greenhouse-controls");
      if (level < GREENHOUSE_PRICES.length) {
        const nextPrice = GREENHOUSE_PRICES[level] ?? 0;
        const nextSlots = (level + 1) * GREENHOUSE_SLOTS_PER_LEVEL;
        controls.append(
          actionButton(
            level === 0
              ? t("greenhouse.unlock", { cost: formatCompact(nextPrice) })
              : t("greenhouse.upgrade", {
                  level: level + 1,
                  slots: nextSlots,
                  cost: formatCompact(nextPrice),
                }),
            "buyGreenhouse",
            (state?.coins ?? 0) >= nextPrice,
          ),
        );
      } else {
        controls.append(span("garden-greenhouse-max-badge", `✓ ${t("greenhouse.maxLevel")}`));
      }

      if (level > 0) {
        const seedOptions = [
          ...SEEDS,
          ...activeHybrids().map((hybrid) => hybridAsSeedDefinition(hybrid)),
        ].filter((entry) => (state?.bag.seeds[entry.id] ?? 0) > 0);
        if (seedOptions.length > 0 && !seedOptions.some((entry) => entry.id === greenhouseBulkSeed)) {
          greenhouseBulkSeed = seedOptions[0]?.id ?? "";
        }
        const select = document.createElement("select");
        select.className = "garden-greenhouse-seed-select";
        select.dataset.role = "greenhouseBulkSeed";
        for (const entry of seedOptions) {
          const opt = document.createElement("option");
          opt.value = entry.id;
          opt.textContent = `${seedName(entry.id)} (×${state?.bag.seeds[entry.id] ?? 0})`;
          if (entry.id === greenhouseBulkSeed) opt.selected = true;
          select.append(opt);
        }
        if (seedOptions.length === 0) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = t("greenhouse.noSeeds");
          select.append(opt);
          select.disabled = true;
        }
        controls.append(select);
        controls.append(
          actionButton(
            t("greenhouse.plantAll"),
            "plantAllGreenhouse",
            seedOptions.length > 0 && greenhouseBulkSeed.length > 0,
          ),
          actionButton(t("greenhouse.harvestAll"), "harvestAllGreenhouse", true),
        );
      }
      wrap.append(controls);
    }

    if (level > 0) {
      const grid = div("garden-greenhouse-grid");
      for (let slot = 0; slot < GREENHOUSE_SLOTS; slot += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "garden-cell garden-greenhouse-cell";
        cell.dataset.slot = String(slot);
        for (let lineIndex = 0; lineIndex < 6; lineIndex += 1) {
          cell.append(document.createElement("span"));
        }
        syncGreenhouseCell(cell, slot, at);
        grid.append(cell);
      }
      wrap.append(grid);
    }

    if (mode === "owner" && greenhousePicker !== null) {
      wrap.append(buildGreenhousePicker(greenhousePicker));
    } else if (mode === "owner" && greenhouseSupplyPicker !== null) {
      wrap.append(buildGreenhouseSupplyPicker(greenhouseSupplyPicker));
    }
    return wrap;
  }

  /**
   * @brief Lists all owned crop/fruit/seed/hybrid items eligible for cross-breeding.
   * @param snapshot Owner garden state snapshot.
   * @return Aggregated inventory entries ordered for Nursery parent selection.
   */
  function nurseryParentPool(
    snapshot: GardenSnapshot,
  ): Array<{ id: AnyItemId; name: string; total: number; crops: number; seeds: number; isHybrid: boolean }> {
    const out: Array<{
      id: AnyItemId;
      name: string;
      total: number;
      crops: number;
      seeds: number;
      isHybrid: boolean;
    }> = [];
    const ids: AnyItemId[] = [
      ...SEEDS.map((seed) => seed.id),
      ...TREES.map((tree) => tree.id),
      ...(snapshot.hybrids ?? []).map((hybrid) => hybrid.id),
    ];
    for (const id of ids) {
      const crops = (snapshot.bag.crops ?? [])
        .filter((stack) => stack.item === id)
        .reduce((sum, stack) => sum + stack.qty, 0);
      const seeds = snapshot.bag.seeds?.[id as AnySeedId] ?? 0;
      const total = crops + seeds;
      if (total < 1) continue;
      out.push({
        id,
        name: itemName(id),
        total,
        crops,
        seeds,
        isHybrid: isHybridId(id),
      });
    }
    return out;
  }

  /**
   * @brief Builds the Seed Maker bridge section embedded directly in the Nursery tab.
   * @param at Server-clock timestamp.
   * @return Seed Maker bridge card allowing users to build/craft/collect hybrid & crop seeds.
   */
  function buildNurserySeedMakerSection(at: number): HTMLElement {
    const card = div("garden-nursery-card");
    card.append(lineBlock(`// ${t("nursery.seedMakerTitle")}`));
    if (state === null) return card;

    if (state.warehouse.level === 0) {
      card.append(lineBlock(t("nursery.seedMakerLockedWarehouse")));
      card.append(
        actionButton(
          t("warehouse.build", { cost: formatCompact(WAREHOUSE_PRICE) }),
          "buildWarehouse",
          state.coins >= WAREHOUSE_PRICE,
        ),
      );
      return card;
    }

    const seedMaker = state.warehouse.machines.seedMaker;
    const definition = machineById("seedMaker");
    if (definition === undefined || seedMaker === undefined || seedMaker.level === 0) {
      card.append(lineBlock(t("nursery.seedMakerLocked")));
      const buildButton = actionButton(
        t("warehouse.buildMachine", { cost: formatCompact(MACHINE_PRICE) }),
        "buildMachine",
        state.coins >= MACHINE_PRICE,
      );
      buildButton.dataset.machine = "seedMaker";
      card.append(buildButton);
      return card;
    }

    const coolingMs = machineRemaining(seedMaker, "seedMaker", at);
    const jobReady = seedMaker.job !== undefined && at >= seedMaker.job.readyAt;
    const jobBrewing = seedMaker.job !== undefined && at < seedMaker.job.readyAt;
    const headRow = div("garden-nursery-seedmaker-head");
    const statusText = jobReady
      ? `${t("warehouse.jobReady")} · ${itemName(seedMaker.job!.item as AnyItemId)}`
      : jobBrewing
        ? `${t("warehouse.brewing", { item: itemName(seedMaker.job!.item as AnyItemId) })}`
        : coolingMs > 0
          ? `${t("warehouse.cooling")} ${formatDuration(coolingMs, "short")}`
          : t("nursery.seedMakerIdle");
    headRow.append(span("garden-nursery-status", `Lv ${seedMaker.level} · ${statusText}`));
    if (jobBrewing && seedMaker.job !== undefined) {
      const timer = span(
        "garden-nursery-timer",
        `${t("warehouse.remaining")} ${formatDuration(seedMaker.job.readyAt - at, "short")}`,
      );
      timer.dataset.machineUntil = String(seedMaker.job.readyAt);
      headRow.append(timer);
    }
    card.append(headRow);

    const actions = div("garden-tools");
    if (jobReady) {
      const collect = actionButton(t("warehouse.collect"), "machineCollect");
      collect.dataset.machine = "seedMaker";
      actions.append(collect);
    }
    const openBtn = actionButton(t("nursery.seedMakerOpen"), "machineMenuOpen");
    openBtn.dataset.machine = "seedMaker";
    actions.append(openBtn);
    card.append(actions);

    const hybrids = state.hybrids ?? [];
    const processableItems = [
      ...new Set(
        (state.bag.crops ?? [])
          .filter((stack) => resolveSeed(stack.item, hybrids) !== undefined)
          .map((stack) => stack.item),
      ),
    ];
    if (processableItems.length === 0) {
      card.append(span("garden-hint", t("nursery.seedMakerNoCrops")));
    } else {
      const cropGrid = div("garden-nursery-seedmaker-crops");
      const machineBusy = seedMaker.job !== undefined || coolingMs > 0;
      for (const item of processableItems) {
        const count = (state.bag.crops ?? [])
          .filter((stack) => stack.item === item)
          .reduce((sum, stack) => sum + stack.qty, 0);
        const row = div("garden-nursery-seedmaker-row");
        row.append(
          span("garden-nursery-item-name", `${itemName(item)} (×${count})`),
          menuRow(`[ +1 ${t("nursery.makeSeeds")} ]`, "machineCraft", {
            data: { machine: "seedMaker", item },
            disabled: machineBusy,
          }),
          menuRow(`[ +Q ]`, "machineQueue", {
            data: { machine: "seedMaker", item },
          }),
        );
        cropGrid.append(row);
      }
      card.append(cropGrid);
    }
    return card;
  }

  /**
   * @brief Builds the Reborn Nursery & Cross-Breeding tab connected to Seed Maker.
   * @param at Server-clock timestamp.
   * @return Complete Nursery container element.
   */
  function buildNurseryTab(at: number): HTMLElement {
    const wrap = div("garden-nursery-reborn");
    const view = mode === "visit" ? visiting : state;
    if (view === null) return lineBlock(t("common.loading"));

    const hybrids = view.hybrids ?? [];
    wrap.append(
      lineBlock(
        `// ${t("nursery.title")} · ${t("nursery.summary", { count: hybrids.length, max: MAX_HYBRIDS })}`,
      ),
    );
    if (mode === "visit") {
      wrap.append(lineBlock(t("nursery.visitHint")));
    }

    if (mode === "owner" && state !== null) {
      wrap.append(buildNurserySeedMakerSection(at));

      const lab = div("garden-nursery-card");
      lab.append(lineBlock(`// ${t("nursery.labTitle")}`));
      lab.append(
        span(
          "garden-hint",
          t("nursery.parentsLabel", { count: nurseryParents.length, max: MAX_BREED_PARENTS }),
        ),
      );

      const selectedWrap = div("garden-nursery-parents");
      if (nurseryParents.length === 0) {
        selectedWrap.append(span("garden-hint", t("nursery.parentsEmpty")));
      } else {
        nurseryParents.forEach((parentId, index) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "garden-nursery-parent-chip";
          chip.dataset.act = "nurseryRemoveParent";
          chip.dataset.index = String(index);
          chip.textContent = `${itemName(parentId)} ×`;
          selectedWrap.append(chip);
        });
        selectedWrap.append(actionButton(t("nursery.clearParents"), "nurseryClearParents"));
      }
      lab.append(selectedWrap);

      const parentCountForCost = Math.max(MIN_BREED_PARENTS, nurseryParents.length);
      const cost = hybridBreedCost(parentCountForCost);
      const odds = hybridOdds(parentCountForCost, state.extras.spliceBonus);
      const metrics = div("garden-nursery-metrics");
      metrics.append(
        span(
          "garden-nursery-cost",
          `${t("nursery.costLabel")} ${formatCompact(cost)}c (${formatNumber(cost)}c)`,
        ),
        span(
          "garden-nursery-odds",
          `${t("nursery.oddsLabel")} ${t("nursery.oddsElite", { pct: Math.round(odds.elite * 100) })} · ${t("nursery.oddsNormal", { pct: Math.round(odds.normal * 100) })} · ${t("nursery.oddsDud", { pct: Math.round(odds.dud * 100) })}`,
        ),
      );
      lab.append(metrics);

      const canBreed =
        nurseryParents.length >= MIN_BREED_PARENTS &&
        nurseryParents.length <= MAX_BREED_PARENTS &&
        hybrids.length < MAX_HYBRIDS &&
        state.coins >= cost;
      const breedBtn = actionButton(
        t("nursery.breedBtn", { cost: formatCompact(cost) }),
        "breedHybrid",
        canBreed,
      );
      breedBtn.classList.add("garden-nursery-breed-btn");
      lab.append(breedBtn);

      lab.append(span("garden-hint", t("nursery.poolTitle")));
      const pool = nurseryParentPool(state);
      if (pool.length === 0) {
        lab.append(span("garden-hint", t("nursery.poolEmpty")));
      } else {
        const poolGrid = div("garden-nursery-pool");
        for (const entry of pool) {
          const pickedCount = nurseryParents.filter((parent) => parent === entry.id).length;
          const remaining = entry.total - pickedCount;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `garden-nursery-pool-btn${entry.isHybrid ? " is-hybrid" : ""}`;
          btn.dataset.act = "nurseryAddParent";
          btn.dataset.item = entry.id;
          btn.disabled = remaining < 1 || nurseryParents.length >= MAX_BREED_PARENTS;
          btn.textContent = `${entry.name} (${remaining}) ${t("nursery.addParent")}`;
          poolGrid.append(btn);
        }
        lab.append(poolGrid);
      }
      wrap.append(lab);
    }

    const catalog = div("garden-nursery-card");
    catalog.append(lineBlock(`// ${t("nursery.catalogTitle", { count: hybrids.length, max: MAX_HYBRIDS })}`));
    if (hybrids.length === 0) {
      catalog.append(span("garden-hint", t("nursery.catalogEmpty")));
    } else {
      const list = div("garden-nursery-catalog");
      for (const hybrid of [...hybrids].reverse()) {
        const card = div(`garden-nursery-hybrid-item is-${hybrid.tier}`);
        const top = div("garden-nursery-hybrid-head");
        top.append(
          span(`garden-nursery-tier badge-${hybrid.tier}`, t(`nursery.tier.${hybrid.tier}`)),
          span("garden-nursery-hybrid-name", hybrid.name),
        );
        card.append(top);
        const parentsLine = hybrid.parents.map((p) => itemName(p)).join(" × ");
        const seedOwned = state?.bag.seeds[hybrid.id] ?? 0;
        const statsText = [
          t("nursery.parentsLine", { parents: parentsLine }),
          `${formatCompact(hybrid.sell)}c · ${formatDuration(hybrid.growMs, "short")} · ${hybrid.regrow ? t("nursery.regrowYes") : t("nursery.regrowNo")}`,
          hybrid.bonusEffect ? `✨ ${t(`effects.${hybrid.bonusEffect}`)}` : "",
          `${t("garden.bag")}: ${seedOwned} hạt`,
        ]
          .filter(Boolean)
          .join(" · ");
        card.append(span("garden-nursery-hybrid-stats", statsText));

        if (mode === "owner") {
          const actions = div("garden-tools");
          const renameBtn = actionButton(t("nursery.renameBtn"), "nurseryOpenRename");
          renameBtn.dataset.hybridId = hybrid.id;
          const pickBtn = actionButton(
            t("nursery.addParent"),
            "nurseryAddParent",
            nurseryParents.length < MAX_BREED_PARENTS &&
              ((state?.bag.seeds[hybrid.id] ?? 0) > 0 ||
                (state?.bag.crops ?? []).some((s) => s.item === hybrid.id)),
          );
          pickBtn.dataset.item = hybrid.id;
          actions.append(renameBtn, pickBtn);
          card.append(actions);
        }
        list.append(card);
      }
      catalog.append(list);
    }
    wrap.append(catalog);

    if (mode === "owner" && state !== null) {
      const genetics = div("garden-nursery-card");
      genetics.append(lineBlock(`// ${t("nursery.compostSpliceTitle")}`));
      genetics.append(lineBlock(`// ${t("extras.spliceLine", { bonus: state.extras.spliceBonus })}`));
      const compostRow = div("garden-tools");
      compostRow.append(actionButton(t("extras.compost"), "extrasCompost"));
      const cropItems = [...new Set((state.bag.crops ?? []).map((stack) => stack.item))];
      for (const item of cropItems) {
        const button = actionButton(t("extras.spliceItem", { item: itemName(item) }), "extrasSplice");
        button.dataset.item = item;
        compostRow.append(button);
      }
      genetics.append(compostRow);
      wrap.append(genetics);
    }

    return wrap;
  }

  /**
   * @brief Builds the post-breeding result and rename popover overlay for a custom hybrid.
   * @return Popover modal container element, or `null` when hidden.
   */
  function buildNurseryPopover(): HTMLElement | null {
    if (nurseryPopover === null || state === null || mode !== "owner") return null;
    const hybrid = state.hybrids?.find((entry) => entry.id === nurseryPopover);
    if (hybrid === undefined) return null;

    const backdrop = div("garden-nursery-popover-backdrop");
    const modal = div(`garden-nursery-popover is-${hybrid.tier}`);

    const head = div("garden-menu-head");
    head.append(span("garden-menu-title", `🧬 ${t("nursery.popoverTitle")}`));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "garden-menu-close";
    close.dataset.act = "nurseryPopoverClose";
    close.textContent = "×";
    close.setAttribute("aria-label", t("common.close"));
    head.append(close);
    modal.append(head);

    const badge = span(`garden-nursery-tier badge-${hybrid.tier}`, t(`nursery.tier.${hybrid.tier}`));
    modal.append(badge);

    const parentsLine = hybrid.parents.map((p) => itemName(p)).join(" × ");
    const info = document.createElement("pre");
    info.className = "garden-menu-info";
    info.textContent = [
      `// ${hybrid.name}`,
      t("nursery.parentsLine", { parents: parentsLine }),
      `${t("side.value")}: ${formatCompact(hybrid.sell)}c`,
      `${t("garden.timeLeft")}: ${formatDuration(hybrid.growMs, "short")}`,
      `${t("garden.kind")}: ${hybrid.regrow ? t("nursery.regrowYes") : t("nursery.regrowNo")}`,
      ...(hybrid.bonusEffect ? [`Effect: ${t(`effects.${hybrid.bonusEffect}`)}`] : []),
      `${t("garden.bag")}: ${state.bag.seeds[hybrid.id] ?? 0}`,
    ].join("\n");
    modal.append(info);

    const renameBox = div("garden-nursery-rename-row");
    const label = span("garden-hint", t("nursery.renameLabel"));
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 32;
    input.className = "garden-input garden-nursery-rename-input";
    input.dataset.role = "hybridRename";
    input.placeholder = t("nursery.renamePlaceholder");
    input.value = hybridRenameDraft;
    const saveBtn = actionButton(
      t("nursery.renameSave"),
      "renameHybrid",
      hybridRenameDraft.trim().length > 0,
    );
    saveBtn.dataset.hybridId = hybrid.id;
    renameBox.append(label, input, saveBtn);
    modal.append(renameBox);

    const footer = div("garden-tools");
    footer.append(
      actionButton(t("nursery.toGreenhouse"), "nurseryToGreenhouse"),
      actionButton(t("common.close"), "nurseryPopoverClose"),
    );
    modal.append(footer);
    backdrop.append(modal);
    return backdrop;
  }

  /**
   * @brief Dispatches the body of a non-main garden tab.
   * @details Extension point: add one branch here next to its builder.
   */
  function buildGardenTabBody(at: number): HTMLElement {
    if (gardenTab === "mushroom") return buildMushroomHouse(at);
    if (gardenTab === "greenhouse") return buildGreenhouseTab(at);
    if (gardenTab === "nursery") return buildNurseryTab(at);
    if (gardenTab === "barn" || gardenTab === "coop" || gardenTab === "pond") {
      return buildAnimalTab(gardenTab);
    }
    if (gardenTab === "warehouse") return buildWarehouseReborn(at);
    if (gardenTab === "kitchen") return buildKitchenTab(at);
    if (gardenTab === "mine") return buildMineReborn(at);
    if (gardenTab === "shipping") return buildShippingBin();
    if (gardenTab === "prestige") return buildPrestige();
    return buildGardenTabPlaceholder();
  }

  /**
   * @brief Builds one small-building tab (barn, coop or fish pond).
   * @param building Animal building shown by this tab.
   * @details Each level is one small pen: built pens show their capacity, the
   * next pen carries the old build/upgrade price, and the animal grid keeps the
   * legacy click flow (buy, pet, breed, sell) untouched.
   */
  function buildAnimalTab(building: BuildingId): HTMLElement {
    const wrap = div("garden-animal-tab");
    const definition = buildingById(building);
    if (state === null || definition === undefined) {
      wrap.append(lineBlock(t("common.loading")));
      return wrap;
    }
    const level = state.buildings[building] ?? 0;
    const animals = state.animals[building] ?? [];
    const maxLevel = maxBuildingLevel(building);
    const capacity = level > 0 ? (definition.slots[level - 1] ?? 0) : 0;
    const alive = animals.filter((animal) => animal !== null && animal !== undefined).length;
    const penSlots = (index: number): number =>
      (definition.slots[index] ?? 0) - (index > 0 ? (definition.slots[index - 1] ?? 0) : 0);
    wrap.append(
      lineBlock(
        `// ${t(`farm.${building}`)} · ${t("animalTab.pens", { count: level, max: maxLevel })} · ${alive}/${capacity} ${t("farm.slots")}`,
      ),
    );

    // One plot cell per small pen; the next locked pen is the build/upgrade action.
    const pens = div("garden-pen-row");
    for (let index = 0; index < maxLevel; index += 1) {
      const penLevel = index + 1;
      const slots = penSlots(index);
      if (penLevel <= level) {
        pens.append(
          buildRebornAction({
            id: `pen:${building}:${penLevel}`,
            label: t("animalTab.pen", { index: penLevel }),
            glyph: "#",
            note: `${slots} ${t("farm.slots")}`,
            tone: "harvest",
            act: "animalPenInfo",
            data: { building, level: String(penLevel) },
            title: `${t(`farm.${building}`)} · ${t("animalTab.pen", { index: penLevel })} · +${slots} ${t("farm.slots")} · ${t("animalTab.built")}`,
            active: penLevel === level,
          }),
        );
        continue;
      }
      if (penLevel === level + 1) {
        const cost = level === 0 ? definition.price : buildingUpgradeCost(building, level);
        pens.append(
          buildRebornAction({
            id: `pen:${building}:${penLevel}`,
            label: t("animalTab.buildPen"),
            glyph: "+",
            note: `${formatCompact(cost)}c`,
            tone: "money",
            act: level === 0 ? "buildBuilding" : "upgradeBuilding",
            data: { building, level: String(penLevel) },
            title: `${t("animalTab.pen", { index: penLevel })} · +${slots} ${t("farm.slots")} · ${formatCompact(cost)}c`,
            disabled: (state.coins ?? 0) < cost,
          }),
        );
        continue;
      }
      pens.append(
        buildRebornAction({
          id: `pen:${building}:${penLevel}`,
          label: t("animalTab.pen", { index: penLevel }),
          glyph: "x",
          note: t("animalTab.locked"),
          tone: "soil",
          act: "animalPenInfo",
          data: { building, level: String(penLevel) },
          disabled: true,
        }),
      );
    }
    wrap.append(pens);

    wrap.append(lineBlock(`// ${t("animalTab.animals")} · ${animals.length}/${capacity}`));
    const grid = div("garden-animal-grid");
    for (let slot = 0; slot < capacity; slot += 1) grid.append(animalCell(building, slot));
    wrap.append(grid);
    if (farmsPickerOpen(building)) wrap.append(buildAnimalPicker(building, farmPicker?.slot ?? 0));
    wrap.append(lineBlock(t("animalTab.hint")));
    return wrap;
  }

  /** @brief Whether the animal purchase picker is open for one building. */
  function farmsPickerOpen(building: BuildingId): boolean {
    return farmPicker !== null && farmPicker.building === building;
  }

  /**
   * @brief Builds an interactive inventory card button for selling a crop stack.
   * @param stack The crop stack with quantity, star rating, pest status and mutations.
   * @param atSeason Current season snapshot for market pricing.
   * @return A styled interactive card button configured with shipSellCrop dataset.
   */
  function buildCropShippingCard(stack: CropStack, atSeason: SeasonSnapshot | null): HTMLButtonElement {
    const unit = atSeason === null ? 0 : cropSellPrice(stack, atSeason, activeHybrids());
    const total = unit * stack.qty;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "garden-shipping-card garden-shipping-row garden-shipping-crop-card";
    card.dataset.act = "shipSellCrop";
    card.dataset.item = stack.item;
    card.dataset.effects = JSON.stringify(stack.effects);
    card.dataset.star = String(stack.star ?? 1);
    card.dataset.pest = stack.pest === true ? "1" : "0";
    card.dataset.qty = String(stack.qty);
    card.title = `${t("shipping.sellSingle")} ${itemName(stack.item)} (+${formatCompact(total)}c)`;

    const info = div("garden-shipping-card-info");
    const titleRow = div("garden-shipping-card-title-row");
    titleRow.append(span("garden-shipping-name", itemName(stack.item)));
    titleRow.append(span("garden-shipping-badge garden-shipping-qty", `×${stack.qty}`));
    if ((stack.star ?? 1) > 1) {
      titleRow.append(span("garden-shipping-star", `${stack.star}★`));
    }
    if (stack.pest === true) {
      titleRow.append(span("garden-shipping-pest", "🐛"));
    }
    info.append(titleRow);

    if (stack.effects.length > 0) {
      const effectsWrap = div("garden-shipping-effects");
      for (const effect of stack.effects) {
        effectsWrap.append(span(`garden-shipping-effect effect-${effect}`, t(`effects.${effect}`)));
      }
      info.append(effectsWrap);
    }

    const actions = div("garden-shipping-card-actions");
    const priceColumn = div("garden-shipping-price-col");
    priceColumn.append(span("garden-shipping-unit", `${formatCompact(unit)}c/món`));
    priceColumn.append(span("garden-shipping-total", `→ ${formatCompact(total)}c`));
    const sellBtn = span("garden-shipping-sell-btn", `[ ${t("shipping.sellSingle")} ]`);
    actions.append(priceColumn, sellBtn);

    card.append(info, actions);
    return card;
  }

  /**
   * @brief Builds an interactive inventory card button for selling a product stack.
   * @param stack The product stack with product ID, quantity, star rating and effects.
   * @param atSeason Current season snapshot for market pricing.
   * @return A styled interactive card button configured with shipSellProduct dataset.
   */
  function buildProductShippingCard(stack: ProductStack, atSeason: SeasonSnapshot | null): HTMLButtonElement {
    const unit = atSeason === null ? 0 : productPrice(stack, atSeason);
    const total = unit * stack.qty;
    const prodName = t(`products.${stack.product}`);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "garden-shipping-card garden-shipping-row garden-shipping-product-card";
    card.dataset.act = "shipSellProduct";
    card.dataset.product = stack.product;
    card.dataset.star = String(stack.star);
    card.dataset.effects = JSON.stringify(stack.effects ?? []);
    card.dataset.qty = String(stack.qty);
    card.title = `${t("shipping.sellSingle")} ${prodName} (+${formatCompact(total)}c)`;

    const info = div("garden-shipping-card-info");
    const titleRow = div("garden-shipping-card-title-row");
    titleRow.append(span("garden-shipping-name", prodName));
    titleRow.append(span("garden-shipping-badge garden-shipping-qty", `×${stack.qty}`));
    if (stack.star > 1) {
      titleRow.append(span("garden-shipping-star", `${stack.star}★`));
    }
    info.append(titleRow);

    if (stack.effects !== undefined && stack.effects.length > 0) {
      const effectsWrap = div("garden-shipping-effects");
      for (const effect of stack.effects) {
        effectsWrap.append(span(`garden-shipping-effect effect-${effect}`, t(`effects.${effect}`)));
      }
      info.append(effectsWrap);
    }

    const actions = div("garden-shipping-card-actions");
    const priceColumn = div("garden-shipping-price-col");
    priceColumn.append(span("garden-shipping-unit", `${formatCompact(unit)}c/món`));
    priceColumn.append(span("garden-shipping-total", `→ ${formatCompact(total)}c`));
    const sellBtn = span("garden-shipping-sell-btn", `[ ${t("shipping.sellSingle")} ]`);
    actions.append(priceColumn, sellBtn);

    card.append(info, actions);
    return card;
  }

  /**
   * @brief Builds one chip displaying an inventory item count.
   * @param glyph Emoji or icon representing the item type.
   * @param label Localized name of the item.
   * @param count Available quantity in the bag.
   * @return A styled chip element.
   */
  function buildInventoryChip(glyph: string, label: string, count: number): HTMLElement {
    const chip = div("garden-shipping-chip");
    chip.append(
      span("garden-shipping-chip-glyph", glyph),
      span("garden-shipping-chip-label", label),
      span("garden-shipping-chip-qty", `×${count}`),
    );
    return chip;
  }

  /**
   * @brief Builds the shipping bin tab: quick sell crops plus categorized bag inventory.
   * @details Quick sell strictly sells raw harvested crops, preserving processed
   * goods, seeds and tools. Bag inventory is organized into structured category
   * sections with responsive card grids and badges.
   * @return An HTML container representing the complete shipping bin interface.
   */
  function buildShippingBin(): HTMLElement {
    const wrap = div("garden-shipping");
    wrap.append(lineBlock(`// ${t("shipping.title")} · ${t("shipping.hint")}`));
    if (mode !== "owner") {
      wrap.append(lineBlock(t("mushroomHouse.visitHint")));
      return wrap;
    }
    const bag = state?.bag;
    const nowSeason = season;
    const cropStacks = (bag?.crops ?? []).filter((stack) => stack.qty > 0);
    const productStacks = (bag?.products ?? []).filter((stack) => stack.qty > 0);
    const cropValue =
      nowSeason === null
        ? 0
        : cropStacks.reduce(
            (sum, stack) => sum + cropSellPrice(stack, nowSeason, activeHybrids()) * stack.qty,
            0,
          );
    const productValue =
      nowSeason === null
        ? 0
        : productStacks.reduce((sum, stack) => sum + productPrice(stack, nowSeason) * stack.qty, 0);

    const quick = div("garden-shipping-quick");
    quick.append(
      buildRebornAction({
        id: "ship:crops",
        label: t("shipping.sellCrops"),
        glyph: "🌾",
        note: `${cropStacks.length} loại · ${formatCompact(cropValue)}c`,
        tone: "harvest",
        act: "shipSellAllCrops",
        disabled: cropStacks.length === 0,
        title: t("shipping.sellCropsDesc"),
      }),
    );
    wrap.append(quick);
    wrap.append(lineBlock(`// 🌾 ${t("shipping.quickSellNote")}`));

    const inventory = div("garden-shipping-inv");
    inventory.append(lineBlock(`// ${t("shipping.invTitle")}`));

    if (cropStacks.length > 0) {
      const sec = div("garden-shipping-section");
      sec.append(
        lineBlock(
          `// ${t("shipping.cropsTitle")} · ${cropStacks.length} loại · ${formatCompact(cropValue)}c`,
        ),
      );
      const cards = div("garden-shipping-cards");
      for (const stack of cropStacks) {
        cards.append(buildCropShippingCard(stack, nowSeason));
      }
      sec.append(cards);
      inventory.append(sec);
    }

    if (productStacks.length > 0) {
      const sec = div("garden-shipping-section");
      sec.append(
        lineBlock(
          `// ${t("shipping.productsTitle")} · ${productStacks.length} loại · ${formatCompact(productValue)}c`,
        ),
      );
      const note = div("garden-shipping-note");
      note.textContent = t("shipping.productsSubtitle");
      sec.append(note);
      const cards = div("garden-shipping-cards");
      for (const stack of productStacks) {
        cards.append(buildProductShippingCard(stack, nowSeason));
      }
      sec.append(cards);
      inventory.append(sec);
    }

    const seedCounts = Object.entries(bag?.seeds ?? {}).filter(([, count]) => (count ?? 0) > 0);
    if (seedCounts.length > 0) {
      const sec = div("garden-shipping-section");
      sec.append(lineBlock(`// ${t("shipping.seedsTitle")} · ${seedCounts.length} loại`));
      const chips = div("garden-shipping-chips");
      for (const [seed, count] of seedCounts) {
        chips.append(buildInventoryChip("🌱", t(`seeds.${seed as SeedId}`), count ?? 0));
      }
      sec.append(chips);
      inventory.append(sec);
    }

    const supplyCounts = Object.entries(bag?.supplies ?? {}).filter(([, count]) => (count ?? 0) > 0);
    if (supplyCounts.length > 0) {
      const sec = div("garden-shipping-section");
      sec.append(lineBlock(`// ${t("shipping.suppliesTitle")} · ${supplyCounts.length} loại`));
      const chips = div("garden-shipping-chips");
      for (const [supply, count] of supplyCounts) {
        chips.append(buildInventoryChip("🧪", t(`supplies.${supply}`), count ?? 0));
      }
      sec.append(chips);
      inventory.append(sec);
    }

    const toolCounts = Object.entries(bag?.tools ?? {}).filter(([, count]) => (count ?? 0) > 0);
    if (toolCounts.length > 0) {
      const sec = div("garden-shipping-section");
      sec.append(lineBlock(`// ${t("shipping.toolsTitle")} · ${toolCounts.length} loại`));
      const chips = div("garden-shipping-chips");
      for (const [tool, count] of toolCounts) {
        chips.append(buildInventoryChip("🛠", t(`tools.${tool}`), count ?? 0));
      }
      sec.append(chips);
      inventory.append(sec);
    }

    const spawnCounts = Object.entries(state?.mushroomSpawn ?? {}).filter(([, count]) => (count ?? 0) > 0);
    if (spawnCounts.length > 0) {
      const sec = div("garden-shipping-section");
      sec.append(lineBlock(`// ${t("shipping.spawnTitle")} · ${spawnCounts.length} loại`));
      const chips = div("garden-shipping-chips");
      for (const [spawn, count] of spawnCounts) {
        chips.append(buildInventoryChip("🍄", t(`mushrooms.${spawn}`), count ?? 0));
      }
      sec.append(chips);
      inventory.append(sec);
    }

    if (
      cropStacks.length === 0 &&
      productStacks.length === 0 &&
      seedCounts.length === 0 &&
      supplyCounts.length === 0 &&
      toolCounts.length === 0 &&
      spawnCounts.length === 0
    ) {
      inventory.append(lineBlock(t("shipping.empty")));
    }
    wrap.append(inventory);
    return wrap;
  }
  function buildGardenTabPlaceholder(): HTMLElement {
    const wrap = div("garden-garden-empty");
    wrap.append(lineBlock(`// ${t(`gardenTab.${gardenTab}`)} · ${t("gardenTab.empty")}`));
    return wrap;
  }

  /**
   * @brief Builds the normal garden boards under the VIP row.
   * @param at Server-clock time.
   * @details Reuses the legacy pager, crop board and fruit board, so every plot
   * keeps the exact same cell render, locked look and click handlers as before.
   */
  function buildRebornGarden(at: number): HTMLElement {
    const wrap = div("garden-reborn-garden");
    const counts = gardenSummary(at);
    wrap.append(
      lineBlock(
        `// ${t("reborn.gardenTitle")} · ${t("garden.page", { page: page + 1, total: pageCount() })} · ${t("garden.ready")} ${counts.ready} · ${t("garden.growing")} ${counts.growing} · ${t("garden.free")} ${counts.free}`,
      ),
    );
    wrap.append(buildPager());
    const boards = div("garden-boards");
    const cropPanel = div("garden-board-panel");
    cropPanel.append(span("garden-board-title", t("garden.crops")), buildCropBoard());
    const treePanel = div("garden-board-panel");
    treePanel.append(span("garden-board-title", t("garden.trees")), buildTreeBoard());
    boards.append(cropPanel, treePanel);
    wrap.append(boards);
    return wrap;
  }

  // ---------------------------------------------------------------- townhall

  /** @brief Whether the wanderer happens to be in town this wave. */
  function travellerInTown(): boolean {
    return season !== null && season.wave % 3 === 1;
  }

  /**
   * @brief NPC merchants standing in the townhall right now.
   * @details Extension point: add one entry here, one shop builder below and the
   * i18n labels. The townhall layout and click handler stay untouched.
   */
  function townNpcs(): TownNpc[] {
    const npcs: TownNpc[] = [
      { id: "seeds", name: t("town.seedNpc"), glyph: "s", tone: "harvest", note: t("town.seedNpcNote") },
      { id: "tools", name: t("town.toolNpc"), glyph: "w", tone: "soil", note: t("town.toolNpcNote") },
      { id: "wheel", name: t("town.wheelNpc"), glyph: "✦", tone: "money", note: t("town.wheelNpcNote") },
      {
        id: "insurance",
        name: t("town.insuranceNpc"),
        glyph: "§",
        tone: "water",
        note: t("town.insuranceNpcNote"),
      },
      { id: "pet", name: t("town.petNpc"), glyph: "p", tone: "harvest", note: t("town.petNpcNote") },
      { id: "guild", name: t("town.guildNpc"), glyph: "G", tone: "soil", note: t("town.guildNpcNote") },
    ];
    if (travellerInTown()) {
      npcs.push({
        id: "traveller",
        name: t("town.traveller"),
        glyph: "?",
        tone: "chemical",
        note: t("town.travellerNote"),
      });
    }
    return npcs;
  }

  /** @brief Remaining stock this restock, falling back to the offer's stock. */
  function shopStockOf(id: string, fallback: number): number {
    const tracked = state?.shopStock ?? {};
    return Object.prototype.hasOwnProperty.call(tracked, id) ? (tracked[id] ?? 0) : fallback;
  }

  /** @brief One seed offer as a townhall shop cell. */
  function townSeedItem(offer: {
    readonly seed: SeedId;
    readonly price: number;
    readonly stock: number;
  }): TownShopItem {
    const definition = seedById(offer.seed);
    const rare = definition?.rare === true;
    const price = rare ? offer.price : buyPriceOf(offer.seed, offer.price);
    const stock = shopStockOf(offer.seed, offer.stock);
    const total = price * buyQty;
    const qtyTag = buyQty > 1 ? `×${buyQty} ` : "";
    return {
      id: `seed:${offer.seed}`,
      name: t(`seeds.${offer.seed}.short`),
      glyph: definition?.art[3] ?? "?",
      note: stock > 0 ? `${qtyTag}${formatCompact(total)}c·${stock}` : t("town.soldOut"),
      tone: rare ? "money" : "harvest",
      title: `${seedName(offer.seed)} · ${formatNumber(price)}c × ${buyQty} = ${formatNumber(total)}c · ${t("market.stock")} ${stock}`,
      act: "townBuy",
      data: { kind: "seed", item: offer.seed },
      disabled: stock < buyQty || stock <= 0 || (state?.coins ?? 0) < total,
    };
  }

  /** @brief One fertilizer or spray as a townhall shop cell. */
  function townSupplyItem(supply: { readonly id: SupplyId; readonly price: number }): TownShopItem {
    const price = buyPriceOf(supply.id, supply.price);
    const total = price * buyQty;
    const qtyTag = buyQty > 1 ? `×${buyQty} ` : "";
    return {
      id: `supply:${supply.id}`,
      name: t(`supplies.${supply.id}`),
      glyph: "+",
      note: `${qtyTag}${formatCompact(total)}c`,
      tone: "fertilizer",
      title: `${t(`supplies.${supply.id}`)} · ${formatNumber(price)}c × ${buyQty} = ${formatNumber(total)}c`,
      act: "townBuy",
      data: { kind: "supply", item: supply.id },
      disabled: (state?.coins ?? 0) < total,
    };
  }

  /**
   * @brief Seed, rare shop and supply merchant stock in the Reborn townhall market.
   * @return Shop sections separating standard seeds, rare seeds, and supplies.
   */
  function seedShopSections(): TownShopSection[] {
    const offers = season?.shop.offers ?? [];
    const normalOffers = offers.filter((offer) => seedById(offer.seed)?.rare !== true);
    const rareOffers = offers.filter((offer) => seedById(offer.seed)?.rare === true);
    return [
      {
        id: "seeds",
        title: t("town.sectionSeeds"),
        items: normalOffers.map(townSeedItem),
        emptyHint: t("town.soldOut"),
      },
      {
        id: "rareSeeds",
        title: t("town.sectionRareSeeds"),
        items: rareOffers.map(townSeedItem),
        emptyHint: t("market.rareEmpty"),
      },
      {
        id: "supplies",
        title: t("town.sectionSupplies"),
        items: [...FERTILIZERS, ...SPRAYS].map(townSupplyItem),
        emptyHint: t("town.soldOut"),
      },
    ];
  }

  /** @brief Tool merchant stock; tools missing from the rotation read sold out. */
  function toolShopSections(): TownShopSection[] {
    const offers = new Map((season?.shop.tools ?? []).map((offer) => [offer.tool, offer]));
    const items = TOOLS.map((tool): TownShopItem => {
      const offer = offers.get(tool.id);
      const stock = offer === undefined ? 0 : shopStockOf(tool.id, offer.stock);
      const price = offer?.price ?? tool.price;
      const total = price * buyQty;
      const qtyTag = buyQty > 1 ? `×${buyQty} ` : "";
      return {
        id: `tool:${tool.id}`,
        name: t(`tools.${tool.id}`),
        glyph: "w",
        note: offer === undefined ? t("town.soldOut") : `${qtyTag}${formatCompact(total)}c·${stock}`,
        tone: "soil",
        title: `${t(`tools.${tool.id}`)} · ${formatNumber(price)}c × ${buyQty} = ${formatNumber(total)}c`,
        act: "townBuy",
        data: { kind: "tool", item: tool.id },
        disabled: offer === undefined || stock < buyQty || stock <= 0 || (state?.coins ?? 0) < total,
      };
    });
    return [{ id: "tools", title: t("town.sectionTools"), items, emptyHint: t("town.soldOut") }];
  }

  /** @brief The wanderer's rotating pick of seeds and supplies. */
  function travellerShopSections(): TownShopSection[] {
    const wave = season?.wave ?? 0;
    const seeds = (season?.shop.offers ?? []).filter((_, index) => (index + wave) % 3 === 0);
    const supplies = [...FERTILIZERS, ...SPRAYS].filter((_, index) => (index + wave) % 4 === 1);
    return [
      {
        id: "seeds",
        title: t("town.sectionSeeds"),
        items: seeds.map(townSeedItem),
        emptyHint: t("town.soldOut"),
      },
      {
        id: "supplies",
        title: t("town.sectionSupplies"),
        items: supplies.map(townSupplyItem),
        emptyHint: t("town.soldOut"),
      },
    ];
  }

  /**
   * @brief Stock for one NPC's shop.
   * @param id NPC id from {@link townNpcs}; unknown ids fall back to the seed shop.
   */
  function townShopSections(id: string): TownShopSection[] {
    if (id === "tools") return toolShopSections();
    if (id === "traveller") return travellerShopSections();
    return seedShopSections();
  }

  /**
   * @brief Builds the reborn weather tab section.
   * @details Renders current day phase, active weather events, weekly modifier,
   * next wave countdown, and the multi-wave weather forecast.
   * @param at Server-clock timestamp.
   * @return Weather container element.
   */
  function buildWeatherSection(at: number): HTMLElement {
    const wrap = div("garden-reborn-weather");
    if (!season) {
      wrap.append(lineBlock(t("common.loading")));
      return wrap;
    }

    // 1. Header: Section title, current day phase, phase countdown
    const phaseEndsIn = Math.max(0, season.phase.endsAt - at);
    const waveEndsIn = Math.max(0, season.event.endsAt - at);
    wrap.append(
      lineBlock(
        `// ${t("reborn.weatherTitle")} · ${t("event.phase")}: ${t(`phase.${season.phase.id}`)} (${formatDuration(phaseEndsIn)}) · Đợt ${season.wave}`,
      ),
    );

    // 2. Active Conditions Grid (Phase, Active Weather Events, Weekly Modifier, Boss Raid)
    if (season.news !== undefined) {
      wrap.append(lineBlock(`// ${t("news.title")}: ${t(`news.${season.news.id}`)}`));
    }
    wrap.append(lineBlock(`// ${t("reborn.weatherNow")}`));
    const activeGrid = div("garden-town-npcs");

    // Phase Card
    const phaseGlyph =
      season.phase.id === "day"
        ? "☼"
        : season.phase.id === "dusk"
          ? "☀"
          : season.phase.id === "night"
            ? "☾"
            : "☽";
    activeGrid.append(
      buildRebornAction({
        id: "weather:phase",
        label: t(`phase.${season.phase.id}`),
        glyph: phaseGlyph,
        note: formatDuration(phaseEndsIn),
        tone: season.phase.id === "night" ? "water" : "harvest",
        act: "noop",
        title: `${t("reborn.weatherPhase")}: ${t(`phase.${season.phase.id}`)}`,
      }),
    );

    // Active Weather Event Cards
    const EVENT_GLYPHS: Record<string, string> = {
      calm: "☼",
      rain: "~",
      goldenHour: "*",
      frost: "#",
      marketBoom: "$",
      snowfall: "*",
      coldSnap: "!",
      heatwave: "^",
      smoke: "%",
      drought: "x",
      wildfire: "^",
      meteorShower: "*",
      auroraNight: "@",
      moonlight: "o",
      toxicRain: "~",
      plasmaStorm: "&",
      goldenFog: "~",
      crystalFrost: "#",
      rainbowSky: "@",
      blightWind: "~",
    };

    const EVENT_TONES: Record<string, "default" | "harvest" | "money" | "water" | "tool"> = {
      calm: "default",
      rain: "water",
      goldenHour: "harvest",
      frost: "tool",
      marketBoom: "money",
      snowfall: "tool",
      coldSnap: "tool",
      heatwave: "money",
      smoke: "default",
      drought: "tool",
      wildfire: "money",
      meteorShower: "harvest",
      auroraNight: "harvest",
      moonlight: "water",
      toxicRain: "tool",
      plasmaStorm: "money",
      goldenFog: "harvest",
      crystalFrost: "tool",
      rainbowSky: "harvest",
      blightWind: "default",
    };

    if (season.events.length === 0) {
      activeGrid.append(
        buildRebornAction({
          id: "weather:calm",
          label: t("events.calm"),
          glyph: "☼",
          note: t("events.calm.desc"),
          tone: "default",
          act: "noop",
          title: `${t("events.calm")}: ${t("events.calm.desc")}`,
        }),
      );
    } else {
      for (const ev of season.events) {
        const glyph = EVENT_GLYPHS[ev.id] ?? "*";
        const tone = EVENT_TONES[ev.id] ?? "default";
        const timeLeft = Math.max(0, ev.endsAt - at);
        activeGrid.append(
          buildRebornAction({
            id: `weather:${ev.id}`,
            label: t(`events.${ev.id}`),
            glyph,
            note: formatDuration(timeLeft),
            tone,
            act: "noop",
            title: `${t(`events.${ev.id}`)}: ${t(`events.${ev.id}.desc`)} (${formatDuration(timeLeft)})`,
          }),
        );
      }
    }

    // Weekly Modifier Card
    const modifier = weeklyModifier(at);
    const weekTimeLeft = Math.max(0, weekEndsAt(at) - at);
    activeGrid.append(
      buildRebornAction({
        id: "weather:weekly",
        label: t(`weekly.${modifier.id}`),
        glyph: "W",
        note: formatDuration(weekTimeLeft),
        tone: "money",
        act: "noop",
        title: `${t("reborn.weatherWeekly")}: ${t(`weekly.${modifier.id}`)}`,
      }),
    );

    // Boss Raid Card (if active)
    if (raidSnapshot !== null) {
      const raidTimeLeft = Math.max(0, raidSnapshot.endsAt - at);
      const raidCost = raidHitCost(state?.coins ?? 0);
      activeGrid.append(
        buildRebornAction({
          id: "weather:raid",
          label: t("reborn.weatherRaid"),
          glyph: "!",
          note: `${formatCompact(raidSnapshot.hp)}/${formatCompact(raidSnapshot.maxHp)} HP`,
          tone: "harvest",
          act: "raidHit",
          disabled: mode !== "owner" || raidCost <= 0,
          title: `${t("reborn.weatherRaid")} · ${formatDuration(raidTimeLeft)} · ${t("raid.hitTitle", { cost: formatCompact(raidCost) })}`,
        }),
      );
    }

    wrap.append(activeGrid);

    // 3. Next Wave & Countdown
    wrap.append(div("garden-town-sep"));
    wrap.append(lineBlock(`// ${t("reborn.weatherNext")} (sau ${formatDuration(waveEndsIn)})`));
    const nextGrid = div("garden-town-npcs");
    if (season.nextEvents.length === 0) {
      nextGrid.append(
        buildRebornAction({
          id: "weather:next-calm",
          label: t("events.calm"),
          glyph: "☼",
          note: t("events.calm.desc"),
          tone: "default",
          act: "noop",
          title: t("events.calm"),
        }),
      );
    } else {
      for (const ev of season.nextEvents) {
        const glyph = EVENT_GLYPHS[ev.id] ?? "*";
        const tone = EVENT_TONES[ev.id] ?? "default";
        nextGrid.append(
          buildRebornAction({
            id: `weather:next-${ev.id}`,
            label: t(`events.${ev.id}`),
            glyph,
            note: t(`events.${ev.id}.desc`),
            tone,
            act: "noop",
            title: t(`events.${ev.id}`),
          }),
        );
      }
    }
    wrap.append(nextGrid);

    // 4. Multi-wave Weather Forecast Radar
    wrap.append(div("garden-town-sep"));
    wrap.append(lineBlock(`// ${t("reborn.weatherForecast")}`));
    const forecastGrid = div("garden-town-npcs");
    season.forecast.forEach((wave, idx) => {
      const waveOffsetMin = (idx + 1) * 10;
      const waveLabel = `+${waveOffsetMin}m`;
      if (wave.length === 0) {
        forecastGrid.append(
          buildRebornAction({
            id: `weather:fc-${idx}`,
            label: t("events.calm"),
            glyph: "☼",
            note: waveLabel,
            tone: "default",
            act: "noop",
            title: `Đợt ${idx + 1} (${waveLabel}): ${t("events.calm")}`,
          }),
        );
      } else {
        const names = wave.map((e) => t(`events.${e.id}`)).join(" + ");
        const firstEv = wave[0]!;
        const glyph = EVENT_GLYPHS[firstEv.id] ?? "*";
        const tone = EVENT_TONES[firstEv.id] ?? "default";
        forecastGrid.append(
          buildRebornAction({
            id: `weather:fc-${idx}`,
            label: names,
            glyph,
            note: waveLabel,
            tone,
            act: "noop",
            title: `Đợt ${idx + 1} (${waveLabel}): ${names}`,
          }),
        );
      }
    });
    wrap.append(forecastGrid);

    return wrap;
  }

  /**
   * @brief Builds the Reborn Event tab with seasonal events, boss raid, wave forecast, and recovery controls.
   * @return Reborn Event container wrapping the full event and recovery panels.
   */
  function buildRebornEventSection(): HTMLElement {
    const wrap = div("garden-reborn-event");
    wrap.append(lineBlock(`// ${t("reborn.eventTitle")}`), buildEvent());
    return wrap;
  }

  /**
   * @brief Builds the townhall lucky wheel panel.
   * @param npc Fortune host NPC descriptor.
   * @return Lucky wheel interactive panel.
   */
  function buildTownWheel(npc: TownNpc): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${npc.name} · ${npc.note}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townClose";
    head.append(title, close);
    panel.append(head);

    const block = div("garden-town-section");
    block.append(span("garden-board-title", t("town.wheelTitle")));
    block.append(lineBlock(t("town.wheelHint")));
    block.append(lineBlock(t("town.wheelPrizes")));

    const spins = state?.extras.wheelSpins ?? 0;
    const wheelPrice = wheelCost(spins);
    const canSpin = (state?.coins ?? 0) >= wheelPrice && mode === "owner";

    block.append(
      lineBlock(
        `// ${t("extras.wheelToday", {
          spins,
          cost: formatCompact(wheelCost(spins + 1)),
        })}`,
      ),
    );

    if ((state?.extras.wheelLast ?? "").length > 0) {
      block.append(lineBlock(`// ${t("extras.wheelLast")}: ${state?.extras.wheelLast}`));
    }

    const spinBtn = actionButton(
      t("extras.wheel", { cost: formatCompact(wheelPrice) }),
      "extrasWheel",
      canSpin,
    );
    block.append(spinBtn);

    const prizeGrid = div("garden-tools");
    prizeGrid.append(
      span("garden-gold-tag", "💰 100k - 5M coins"),
      span("garden-gold-tag", "🌱 Rare Seeds"),
      span("garden-gold-tag", "✨ Premium Fertilizers"),
      span("garden-gold-tag", "🧪 Pesticide Sprays"),
      span("garden-gold-tag", "⭐ Farming XP"),
    );
    block.append(prizeGrid);

    panel.append(block);
    return panel;
  }

  /**
   * @brief Builds the townhall crop insurance panel.
   * @param npc Insurance broker NPC descriptor.
   * @return Insurance interactive panel.
   */
  function buildTownInsurance(npc: TownNpc): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${npc.name} · ${npc.note}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townClose";
    head.append(title, close);
    panel.append(head);

    const block = div("garden-town-section");
    block.append(span("garden-board-title", t("town.insuranceTitle")));
    block.append(lineBlock(t("town.insuranceHint")));

    const at = now();
    const insured = (state?.extras.insuranceUntil ?? 0) > at;
    const remaining = (state?.extras.insuranceUntil ?? 0) - at;

    block.append(
      lineBlock(
        insured
          ? `// ${t("extras.insured", { time: formatDuration(remaining, "short") })}`
          : `// ${t("extras.notInsured")}`,
      ),
    );

    const canBuy = (state?.coins ?? 0) >= INSURANCE_PRICE && mode === "owner";
    const buyBtn = actionButton(
      t("extras.insurance", { cost: formatCompact(INSURANCE_PRICE) }),
      "extrasInsurance",
      canBuy,
    );
    block.append(buyBtn);

    const perkList = div("garden-tools");
    perkList.append(
      span("garden-gold-tag", "🛡️ Frost & Blizzard Immunity"),
      span("garden-gold-tag", "🪲 Pest Damage Protection"),
      span("garden-gold-tag", "🔥 Farm Explosion Shield"),
      span("garden-gold-tag", "⏱️ 24h Coverage Duration"),
    );
    block.append(perkList);

    panel.append(block);
    return panel;
  }

  /**
   * @brief Builds the townhall pet breeder and hatching panel.
   * @param npc Pet breeder NPC descriptor.
   * @return Pet breeder interactive panel.
   */
  function buildTownPet(npc: TownNpc): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${npc.name} · ${npc.note}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townClose";
    head.append(title, close);
    panel.append(head);

    // Section 1: Egg Hatching
    const hatchBlock = div("garden-town-section");
    hatchBlock.append(span("garden-board-title", t("town.petHatchTitle")));
    hatchBlock.append(lineBlock(t("town.petHatchHint")));

    if ((state?.extras.lastHatch ?? null) !== null) {
      hatchBlock.append(lineBlock(`// ${t("extras.lastHatch")}: ${t(`pets.${state?.extras.lastHatch}`)}`));
    }

    const canHatch = (state?.coins ?? 0) >= EGG_PRICE && mode === "owner";
    const hatchBtn = actionButton(
      t("extras.hatch", { cost: formatCompact(EGG_PRICE) }),
      "extrasHatch",
      canHatch,
    );
    hatchBlock.append(hatchBtn);
    panel.append(hatchBlock);

    // Section 2: Pet Collection & Equipped Pet
    const manageBlock = div("garden-town-section");
    const equipped = state?.extras.equippedPet ?? null;
    const equippedName = equipped !== null ? t(`pets.${equipped}`) : t("town.petNone");
    manageBlock.append(span("garden-board-title", t("town.petTitle")));
    manageBlock.append(lineBlock(t("town.petEquipped", { name: equippedName })));

    const petGrid = div("garden-tools");
    for (const pet of PETS) {
      const copies = Math.min(PET_MAX_LEVEL, state?.extras.pets[pet.id] ?? 0);
      const isEquipped = equipped === pet.id;
      const parts: string[] = [];
      if (pet.pestShield !== undefined)
        parts.push(t("petEffects.pestShield", { value: Math.round(pet.pestShield * 100) }));
      if (pet.mutation !== undefined)
        parts.push(t("petEffects.mutation", { value: Math.round(pet.mutation * 100) }));
      if (pet.grow !== undefined) parts.push(t("petEffects.grow", { value: Math.round(pet.grow * 100) }));
      if (pet.sell !== undefined) parts.push(t("petEffects.sell", { value: Math.round(pet.sell * 100) }));
      if (pet.extraHarvest !== undefined)
        parts.push(t("petEffects.extraHarvest", { value: Math.round(pet.extraHarvest * 100) }));

      if (copies > 0) {
        const btn = actionButton(
          `${isEquipped ? "★ " : ""}${t(`pets.${pet.id}`)} [${t(`petRarity.${pet.rarity}`)}] lv${copies} (${parts.join(", ")}) — ${isEquipped ? t("town.petActive") : t("town.petEquip")}`,
          "equipPet",
          mode === "owner" && !isEquipped,
        );
        btn.dataset.pet = pet.id;
        petGrid.append(btn);
      } else {
        manageBlock.append(
          lineBlock(
            `// ${t(`pets.${pet.id}`)} [${t(`petRarity.${pet.rarity}`)}] — ${t("town.petLocked")} (${parts.join(", ")})`,
          ),
        );
      }
    }
    manageBlock.append(petGrid);
    panel.append(manageBlock);

    if (mode === "owner" && state !== null) {
      const at = now();
      const skillBlock = div("garden-town-section");
      skillBlock.append(span("garden-board-title", t("pet.skillTitle")));
      const equippedCopies = equipped !== null ? (state.extras.pets[equipped] ?? 0) : 0;
      const lastSkillAt = state.extras.petSkillAt ?? 0;
      const cdLeft = Math.max(0, PET_SKILL_COOLDOWN_MS - (at - lastSkillAt));
      const canSkill = equipped !== null && equippedCopies >= 2 && cdLeft === 0;
      skillBlock.append(
        actionButton(
          cdLeft > 0 ? t("pet.skillCooldown", { time: formatDuration(cdLeft, "short") }) : t("pet.skillBtn"),
          "usePetSkill",
          canSkill,
        ),
      );
      panel.append(skillBlock);

      const expBlock = div("garden-town-section");
      expBlock.append(span("garden-board-title", t("pet.expeditionTitle")));
      const expeditions = state.extras.petExpeditions ?? [];
      for (const exp of expeditions) {
        const ready = at >= exp.endsAt;
        if (ready) {
          const btn = actionButton(
            `${t(`pets.${exp.pet}`)} — ${t("pet.expClaim")}`,
            "claimPetExpedition",
            true,
          );
          btn.dataset.id = exp.id;
          expBlock.append(btn);
        } else {
          expBlock.append(
            lineBlock(
              `// ${t(`pets.${exp.pet}`)} · ${t("pet.expRunning", { time: formatDuration(exp.endsAt - at, "short") })}`,
            ),
          );
        }
      }
      const idlePets = PETS.filter(
        (p) =>
          (state?.extras.pets[p.id] ?? 0) > 0 &&
          p.id !== equipped &&
          !expeditions.some((e) => e.pet === p.id),
      );
      if (idlePets.length > 0) {
        const expRow = div("garden-tools");
        for (const p of idlePets) {
          const b15 = actionButton(`${t(`pets.${p.id}`)} · ${t("pet.exp15")}`, "startPetExpedition");
          b15.dataset.pet = p.id;
          b15.dataset.min = "15";
          const b30 = actionButton(`${t(`pets.${p.id}`)} · ${t("pet.exp30")}`, "startPetExpedition");
          b30.dataset.pet = p.id;
          b30.dataset.min = "30";
          expRow.append(b15, b30);
        }
        expBlock.append(expRow);
      }
      panel.append(expBlock);
    }

    return panel;
  }

  /**
   * @brief Builds the townhall guild master hall panel.
   * @param npc Guild master NPC descriptor.
   * @return Guild hall interactive panel.
   */
  function buildTownGuild(npc: TownNpc): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${npc.name} · ${npc.note}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townClose";
    head.append(title, close);
    panel.append(head);

    const block = div("garden-town-section");
    block.append(span("garden-board-title", t("town.guildTitle")));

    if (guildSnapshot !== null) {
      block.append(
        lineBlock(t("guild.current", { name: guildSnapshot.name, count: guildSnapshot.members.length })),
      );
      for (const member of guildSnapshot.members) {
        block.append(lineBlock(`// [${member.code}] ${member.nick}`));
      }
      block.append(lineBlock(t("guild.bank", { coins: formatCompact(guildSnapshot.bank) })));

      const donateRow = div("garden-restore-row");
      const donateInput = document.createElement("input");
      donateInput.type = "number";
      donateInput.min = "1";
      donateInput.className = "stage-input";
      donateInput.value = guildDonateDraft;
      donateInput.dataset.role = "guildDonate";
      donateInput.setAttribute("aria-label", t("guild.donate"));
      donateRow.append(donateInput, actionButton(t("guild.donate"), "guildDonate", mode === "owner"));
      block.append(donateRow);

      if (guildSnapshot.project !== undefined) {
        const proj = guildSnapshot.project;
        const projBlock = div("garden-town-section");
        projBlock.append(span("garden-board-title", t("guild.projectTitle")));
        const itemLabel = t(`products.${proj.item}`);
        projBlock.append(
          lineBlock(
            t("guild.projectProgress", {
              progress: proj.progress,
              target: proj.target,
              item: itemLabel,
              reward: formatCompact(proj.rewardCoins),
            }),
          ),
        );
        if (proj.completed) {
          projBlock.append(lineBlock(t("guild.projectDone", { reward: formatCompact(proj.rewardCoins) })));
        } else {
          const haveQty = (state?.bag.products ?? [])
            .filter((s) => s.product === proj.item)
            .reduce((sum, s) => sum + s.qty, 0);
          projBlock.append(
            actionButton(
              t("guild.projectContribute", { item: itemLabel }),
              "guildContribute",
              mode === "owner" && haveQty >= 1,
            ),
          );
        }
        block.append(projBlock);
      }

      block.append(actionButton(t("guild.leave"), "guildLeave", mode === "owner"));
    } else {
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "stage-input";
      nameInput.value = guildNameDraft;
      nameInput.placeholder = t("guild.name");
      nameInput.dataset.role = "guildName";
      block.append(nameInput, actionButton(t("guild.create"), "guildCreate", mode === "owner"));

      if (guildBoard.length > 0) {
        block.append(lineBlock(`// ${t("guild.title")}`));
        for (const guild of guildBoard) {
          const join = actionButton(
            t("guild.join", { name: guild.name, count: guild.members }),
            "guildJoin",
            mode === "owner",
          );
          join.dataset.id = guild.id;
          block.append(join);
        }
      }
    }

    panel.append(block);
    return panel;
  }

  /**
   * @brief Builds the billboard contract board in town.
   * @return Delivery contract billboard element.
   */
  function buildTownBillboard(): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${t("town.boardBillboardTitle")}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townBoard";
    close.dataset.board = "billboard";
    head.append(title, close);
    panel.append(head);

    if (state === null) {
      panel.append(lineBlock(t("common.loading")));
      return panel;
    }

    const at = now();
    const contractBlock = div("garden-town-section");
    contractBlock.append(span("garden-board-title", t("extras.contracts")));

    const offers = contractOffers(state.playerId, at);
    if (offers.length === 0) {
      contractBlock.append(lineBlock(t("extras.claimed")));
    } else {
      for (const offer of offers) {
        const claimed = state.extras.contractClaims.includes(offer.id);
        const label = `${t(`products.${offer.product}`)} ≥${offer.star}★ x${offer.qty} → ${formatCompact(offer.reward)}c`;
        if (claimed) {
          contractBlock.append(lineBlock(`// ${label} [${t("extras.claimed")}]`));
        } else {
          const button = actionButton(label, "extrasContract", mode === "owner");
          button.dataset.id = offer.id;
          contractBlock.append(button);
        }
      }
    }
    panel.append(contractBlock);

    const chainBlock = div("garden-town-section");
    chainBlock.append(span("garden-board-title", t("chain.title")));
    const chainStep = state.extras.chainStep ?? 0;
    const chain = CONTRACT_CHAIN[chainStep];
    if (chain === undefined) {
      chainBlock.append(lineBlock(t("chain.done")));
    } else {
      const label = `${t(`chain.${chain.id}`)} · ${t(`products.${chain.product}`)} ≥${chain.star}★ x${chain.qty} → ${formatCompact(chain.reward)}c`;
      chainBlock.append(actionButton(label, "extrasChain", mode === "owner"));
      chainBlock.append(
        lineBlock(t("chain.progress", { step: chainStep + 1, total: CONTRACT_CHAIN.length })),
      );
    }
    panel.append(chainBlock);

    const futureBlock = div("garden-town-section");
    futureBlock.append(span("garden-board-title", t("extras.futures")));
    if (state.extras.futures.length === 0) {
      futureBlock.append(lineBlock(t("extras.noFutures")));
    } else {
      for (const future of state.extras.futures) {
        futureBlock.append(
          lineBlock(`// ${itemName(future.item)} x${future.qty} @ ${formatCompact(future.price)}c`),
        );
      }
    }
    for (const item of new Set((state.bag.crops ?? []).map((stack) => stack.item))) {
      const button = actionButton(
        t("extras.lockFuture", { item: itemName(item) }),
        "extrasFuture",
        mode === "owner",
      );
      button.dataset.item = item;
      futureBlock.append(button);
    }
    panel.append(futureBlock);

    const merchantBlock = div("garden-town-section");
    merchantBlock.append(span("garden-board-title", t("extras.merchant")));
    for (const offer of merchantOffers(state.playerId, at)) {
      const claimed = state.extras.merchantClaims.includes(offer.id);
      const name = offer.kind === "seed" ? seedName(offer.item as SeedId) : t(`tools.${offer.item}`);
      const label = `${name} x${offer.stock} — ${formatCompact(offer.price)}c`;
      if (claimed) {
        merchantBlock.append(lineBlock(`// ${label} [${t("extras.claimed")}]`));
      } else {
        const button = actionButton(label, "extrasMerchant", mode === "owner" && state.coins >= offer.price);
        button.dataset.id = offer.id;
        merchantBlock.append(button);
      }
    }
    panel.append(merchantBlock);

    return panel;
  }

  /**
   * @brief Builds the daily quest progress board in town.
   * @return Daily quest board element.
   */
  function buildTownQuests(): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${t("town.boardQuestsTitle")}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townBoard";
    close.dataset.board = "quests";
    head.append(title, close);
    panel.append(head);

    if (state === null) {
      panel.append(lineBlock(t("common.loading")));
      return panel;
    }

    const block = div("garden-town-section");
    block.append(span("garden-board-title", t("quests.title")));

    const quests = state.extras.quests ?? [];
    if (quests.length === 0) {
      block.append(lineBlock(t("quests.empty")));
    } else {
      for (const quest of quests) {
        const progress = Math.min(quest.progress, quest.target);
        const label = `${t("quests.progress", {
          progress,
          target: quest.target,
        })} · +${formatCompact(quest.reward)}c`;
        if (quest.claimed) {
          block.append(lineBlock(`// ${t(`quests.${quest.id}`)} — ${t("quests.claimed")}`));
        } else {
          const button = actionButton(
            `${t(`quests.${quest.id}`)} · ${label}`,
            "claimQuest",
            quest.progress >= quest.target && mode === "owner",
          );
          button.dataset.id = quest.id;
          block.append(button);
        }
      }
    }
    panel.append(block);
    return panel;
  }

  /**
   * @brief Builds the job market and staff employment board in town.
   * @return Staff job board element.
   */
  function buildTownJobs(): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${t("town.boardJobsTitle")}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townBoard";
    close.dataset.board = "jobs";
    head.append(title, close);
    panel.append(head);

    if (state === null) {
      panel.append(lineBlock(t("common.loading")));
      return panel;
    }

    panel.append(lineBlock(`// ${t("staff.roster")} ${state.extras.staff.length}/${STAFF_SLOTS}`));

    // Section 1: Candidate Market
    const marketBlock = div("garden-town-section");
    marketBlock.append(span("garden-board-title", t("staff.market")));
    const candidates = staffMarketAt(state.playerId, now());
    if (candidates.length === 0) {
      marketBlock.append(lineBlock(t("town.soldOut")));
    } else {
      for (const candidate of candidates) {
        const traits = candidate.traits.map((trait) => t(`staffTrait.${trait}`)).join(", ");
        const hireCost = staffHireCost(candidate);
        const canHire =
          state.extras.staff.length < STAFF_SLOTS && state.coins >= hireCost && mode === "owner";
        const label = `${candidate.name} · ${candidate.speed}⚡ · ${candidate.skill}✦ · ${candidate.wage}c · ${traits} · ${formatCompact(hireCost)}c`;
        const button = actionButton(label, "staffHire", canHire);
        button.dataset.id = candidate.id;
        marketBlock.append(button);
      }
    }
    panel.append(marketBlock);

    // Section 2: Hired Staff Roster & Role Assignments
    if (state.extras.staff.length > 0) {
      const rosterBlock = div("garden-town-section");
      rosterBlock.append(span("garden-board-title", t("staff.roster")));
      state.extras.staff.forEach((worker, index) => {
        const traits = worker.traits.map((trait) => t(`staffTrait.${trait}`)).join(", ");
        rosterBlock.append(
          lineBlock(
            `// ${worker.name} · ${t("staff.level")} ${worker.level} (${worker.xp}/${staffXpToLevel(worker.level)} XP) · ${worker.wage}c · ${traits}`,
          ),
        );
        const taskRow = div("garden-tools");
        for (const role of STAFF_ROLES) {
          const task = actionButton(t(`staffRole.${role}`), "staffTask", mode === "owner");
          task.dataset.index = String(index);
          task.dataset.role = role;
          if (worker.role === role) task.classList.add("is-active");
          taskRow.append(task);
        }
        const fire = actionButton(t("staff.fire"), "staffFire", mode === "owner");
        fire.dataset.index = String(index);
        taskRow.append(fire);
        rosterBlock.append(taskRow);
      });
      panel.append(rosterBlock);
    }

    return panel;
  }

  /**
   * @brief Builds the townhall gifting board for sending coins, seeds, supplies and tools.
   * @return Gift board element.
   */
  function buildTownGift(): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${t("town.boardGiftTitle")}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townBoard";
    close.dataset.board = "gift";
    head.append(title, close);
    panel.append(head);

    if (state === null) {
      panel.append(lineBlock(t("common.loading")));
      return panel;
    }

    const coinBlock = div("garden-town-section");
    coinBlock.append(span("garden-board-title", t("gift.title")));
    const giftRow = div("garden-restore-row");
    const giftCodeInput = document.createElement("input");
    giftCodeInput.type = "text";
    giftCodeInput.className = "stage-input garden-gift-code";
    giftCodeInput.placeholder = t("gift.code");
    giftCodeInput.value = giftCode;
    giftCodeInput.dataset.role = "giftCode";
    giftCodeInput.setAttribute("aria-label", t("gift.code"));
    const giftAmountInput = document.createElement("input");
    giftAmountInput.type = "number";
    giftAmountInput.min = "1";
    giftAmountInput.className = "stage-input garden-gift-amount";
    giftAmountInput.placeholder = t("gift.amount");
    giftAmountInput.value = giftAmount;
    giftAmountInput.dataset.role = "giftAmount";
    giftAmountInput.setAttribute("aria-label", t("gift.amount"));
    giftRow.append(
      giftCodeInput,
      giftAmountInput,
      actionButton(t("gift.sendCoins"), "giftCoins", mode === "owner"),
    );
    coinBlock.append(giftRow);
    panel.append(coinBlock);

    const goodsBlock = div("garden-town-section");
    goodsBlock.append(span("garden-board-title", t("gift.goods")));
    const giftGoods = div("garden-tools");
    for (const [seed, qty] of Object.entries(state.bag.seeds)) {
      if ((qty ?? 0) < 1) continue;
      const button = actionButton(`${seedName(seed as SeedId)} ×1`, "giftSeed", mode === "owner");
      button.dataset.seed = seed;
      giftGoods.append(button);
    }
    for (const [supply, qty] of Object.entries(state.bag.supplies)) {
      if ((qty ?? 0) < 1) continue;
      const button = actionButton(`${t(`supplies.${supply}`)} ×1`, "giftSupply", mode === "owner");
      button.dataset.supply = supply;
      giftGoods.append(button);
    }
    for (const [tool, qty] of Object.entries(state.bag.tools ?? {})) {
      if ((qty ?? 0) < 1) continue;
      const button = actionButton(`${t(`tools.${tool}`)} ×1`, "giftTool", mode === "owner");
      button.dataset.tool = tool;
      giftGoods.append(button);
    }
    if (giftGoods.childElementCount === 0) {
      goodsBlock.append(lineBlock(t("market.empty")));
    } else {
      goodsBlock.append(giftGoods);
    }
    panel.append(goodsBlock);

    return panel;
  }

  /**
   * @brief Builds the townhall achievements and seasonal farm summary board.
   * @return Achievements board element.
   */
  function buildTownAchievements(): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${t("town.boardAchievementsTitle")}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townBoard";
    close.dataset.board = "achievements";
    head.append(title, close);
    panel.append(head);

    if (state === null) {
      panel.append(lineBlock(t("common.loading")));
      return panel;
    }

    const extras = state.extras;
    const summaryBlock = div("garden-town-section");
    summaryBlock.append(span("garden-board-title", t("extras.title")));
    summaryBlock.append(
      lineBlock(`// ${t("extras.streak", { count: extras.streak })}`),
      lineBlock(`// ${t("extras.collectionLine", { count: extras.collection.length })}`),
      lineBlock(`// ${t("extras.spliceLine", { bonus: extras.spliceBonus })}`),
      lineBlock(
        `// ${t("extras.weekLine", {
          earned: formatCompact(extras.weekEarned),
          harvested: extras.weekHarvested,
        })}`,
      ),
    );
    if ((extras.taxLast ?? 0) > 0) {
      summaryBlock.append(lineBlock(`// ${t("tax.last", { coins: formatCompact(extras.taxLast ?? 0) })}`));
    }
    panel.append(summaryBlock);

    const achBlock = div("garden-town-section");
    achBlock.append(span("garden-board-title", t("extras.achievements")));
    for (const achievement of ACHIEVEMENTS) {
      const done = extras.achievements.includes(achievement.id);
      achBlock.append(lineBlock(`${done ? "[x]" : "[ ]"} ${t(`achievements.${achievement.id}`)}`));
    }
    panel.append(achBlock);

    return panel;
  }

  /**
   * @brief Builds the weekly tournament standings board in townhall.
   * @return Weekly tournament board element.
   */
  function buildTownTournament(): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${t("town.boardTournamentTitle")}`);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townBoard";
    close.dataset.board = "tournament";
    head.append(title, close);
    panel.append(head);

    const boardBlock = div("garden-town-section");
    boardBlock.append(span("garden-board-title", t("extras.tournament")));
    if (tournament.length === 0) {
      boardBlock.append(lineBlock(t("extras.tournamentEmpty")));
    } else {
      tournament.forEach((entry, index) => {
        boardBlock.append(
          lineBlock(
            `#${index + 1} ${entry.nick} — ${formatCompact(entry.earned)}c · ${entry.harvested} ${t("rank.harvested")}`,
          ),
        );
      });
    }
    panel.append(boardBlock);

    return panel;
  }

  /**
   * @brief Builds the realtime VN & International Stock Exchange board inside Townhall.
   * @return Stock exchange panel element.
   */
  function buildTownStocks(): HTMLElement {
    const panel = div("garden-town-shop");
    const head = div("garden-town-shop-head");
    const title = span("garden-line", `// ${t("town.boardStocksTitle")}`);
    const controls = div("garden-tools");
    controls.append(actionButton(t("stocks.refresh"), "stockRefresh", !stockBusy));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "stage-btn";
    close.textContent = `[ ${t("town.close")} ]`;
    close.dataset.act = "townBoard";
    close.dataset.board = "stocks";
    controls.append(close);
    head.append(title, controls);
    panel.append(head);

    if (stockQuotes.length === 0) {
      panel.append(lineBlock(t("common.loading")));
      return panel;
    }

    const holdings = state?.extras.stocks ?? {};
    const renderMarketGroup = (titleText: string, group: StockQuote[]): void => {
      const section = div("garden-town-section");
      section.append(span("garden-board-title", titleText));
      for (const q of group) {
        const sign = q.changePct > 0 ? "+" : "";
        const sourceTag = q.source === "live" ? t("stocks.live") : t("stocks.fallback");
        const priceLabel =
          q.currency === "VND"
            ? `${formatNumber(Math.round(q.rawPrice))} VND`
            : `$${q.rawPrice.toFixed(2)} USD`;
        const owned = holdings[q.symbol];
        const ownedText =
          owned !== undefined && owned.shares > 0
            ? ` · ${t("stocks.owned", { shares: owned.shares, avg: formatCompact(owned.avgCostCoins) })}`
            : "";
        section.append(
          lineBlock(
            `[${sourceTag}] ${q.symbol} (${q.name}) · ${priceLabel} (${sign}${q.changePct}%) · ${formatCompact(q.coinPrice)}c/cp${ownedText}`,
          ),
        );
        if (mode === "owner" && state !== null) {
          const row = div("garden-tools");
          const b1 = actionButton(t("stocks.buy1"), "stockTrade", state.coins >= q.coinPrice);
          b1.dataset.side = "buy";
          b1.dataset.symbol = q.symbol;
          b1.dataset.shares = "1";
          const b10 = actionButton(t("stocks.buy10"), "stockTrade", state.coins >= q.coinPrice * 10);
          b10.dataset.side = "buy";
          b10.dataset.symbol = q.symbol;
          b10.dataset.shares = "10";
          const ownedShares = owned?.shares ?? 0;
          const s1 = actionButton(t("stocks.sell1"), "stockTrade", ownedShares >= 1);
          s1.dataset.side = "sell";
          s1.dataset.symbol = q.symbol;
          s1.dataset.shares = "1";
          const sAll = actionButton(t("stocks.sellAll"), "stockTrade", ownedShares >= 1);
          sAll.dataset.side = "sell";
          sAll.dataset.symbol = q.symbol;
          sAll.dataset.shares = String(Math.max(1, ownedShares));
          row.append(b1, b10, s1, sAll);
          section.append(row);
        }
      }
      panel.append(section);
    };

    renderMarketGroup(
      t("stocks.vnTitle"),
      stockQuotes.filter((q) => q.market === "VN"),
    );
    renderMarketGroup(
      t("stocks.usTitle"),
      stockQuotes.filter((q) => q.market === "US"),
    );

    return panel;
  }

  /**
   * @brief Builds the townhall as a section of the rebuilt view.
   * @details It lives inside the reborn document, under the garden boards, so the
   * town reads as one more block of the same screen instead of a sibling tab.
   */
  function buildTownhallSection(): HTMLElement {
    const wrap = div("garden-townhall");
    if (mode === "owner" && state === null) return wrap;
    if (mode === "visit" && visiting === null) return wrap;
    const npcs = townNpcs();
    wrap.append(lineBlock(`// ${t("town.title")}`), buildTownNpcs(npcs, mode === "owner"));
    // Public boards are plot cells too: click one to open it, click again to close.
    const boards = div("garden-town-npcs garden-town-boards");
    boards.append(
      buildRebornAction({
        id: "town:rank",
        label: t("town.boardRank"),
        glyph: "#",
        note: t("town.boardRankNote"),
        tone: "money",
        act: "townBoard",
        data: { board: "rank" },
        title: t("rank.title"),
        active: townBoard === "rank",
      }),
      buildRebornAction({
        id: "town:chart",
        label: t("town.boardChart"),
        glyph: "%",
        note: t("town.boardChartNote"),
        tone: "water",
        act: "townBoard",
        data: { board: "chart" },
        title: t("chart.title"),
        active: townBoard === "chart",
      }),
      buildRebornAction({
        id: "town:bots",
        label: t("town.boardBots"),
        glyph: "b",
        note: t("town.boardBotsNote"),
        tone: "harvest",
        act: "townBoard",
        data: { board: "bots" },
        title: t("bots.title", { count: botGardens.length }),
        active: townBoard === "bots",
      }),
      buildRebornAction({
        id: "town:billboard",
        label: t("town.boardBillboard"),
        glyph: "B",
        note: t("town.boardBillboardNote"),
        tone: "chemical",
        act: "townBoard",
        data: { board: "billboard" },
        title: t("town.boardBillboardTitle"),
        active: townBoard === "billboard",
      }),
      buildRebornAction({
        id: "town:quests",
        label: t("town.boardQuests"),
        glyph: "Q",
        note: t("town.boardQuestsNote"),
        tone: "harvest",
        act: "townBoard",
        data: { board: "quests" },
        title: t("town.boardQuestsTitle"),
        active: townBoard === "quests",
      }),
      buildRebornAction({
        id: "town:jobs",
        label: t("town.boardJobs"),
        glyph: "J",
        note: t("town.boardJobsNote"),
        tone: "soil",
        act: "townBoard",
        data: { board: "jobs" },
        title: t("town.boardJobsTitle"),
        active: townBoard === "jobs",
      }),
      buildRebornAction({
        id: "town:gift",
        label: t("town.boardGift"),
        glyph: "g",
        note: t("town.boardGiftNote"),
        tone: "money",
        act: "townBoard",
        data: { board: "gift" },
        title: t("town.boardGiftTitle"),
        active: townBoard === "gift",
      }),
      buildRebornAction({
        id: "town:achievements",
        label: t("town.boardAchievements"),
        glyph: "A",
        note: t("town.boardAchievementsNote"),
        tone: "harvest",
        act: "townBoard",
        data: { board: "achievements" },
        title: t("town.boardAchievementsTitle"),
        active: townBoard === "achievements",
      }),
      buildRebornAction({
        id: "town:tournament",
        label: t("town.boardTournament"),
        glyph: "T",
        note: t("town.boardTournamentNote"),
        tone: "water",
        act: "townBoard",
        data: { board: "tournament" },
        title: t("town.boardTournamentTitle"),
        active: townBoard === "tournament",
      }),
      buildRebornAction({
        id: "town:stocks",
        label: t("town.boardStocks"),
        glyph: "$",
        note: t("town.boardStocksNote"),
        tone: "money",
        act: "townBoard",
        data: { board: "stocks" },
        title: t("town.boardStocksTitle"),
        active: townBoard === "stocks",
      }),
    );
    wrap.append(boards);
    const open = townNpc === null ? undefined : npcs.find((npc) => npc.id === townNpc);
    if (open !== undefined && mode === "owner") {
      if (open.id === "wheel") {
        wrap.append(buildTownWheel(open));
      } else if (open.id === "insurance") {
        wrap.append(buildTownInsurance(open));
      } else if (open.id === "pet") {
        wrap.append(buildTownPet(open));
      } else if (open.id === "guild") {
        wrap.append(buildTownGuild(open));
      } else {
        wrap.append(
          buildTownShop(open, townShopSections(open.id), t("town.close"), {
            active: buyQty,
            label: t("market.buyQty"),
          }),
        );
      }
    } else if (townBoard === "rank") {
      void loadLeaderboard();
      wrap.append(buildRank());
    } else if (townBoard === "chart") {
      void loadChart();
      wrap.append(buildChart());
    } else if (townBoard === "bots") {
      void loadBots();
      wrap.append(buildBots(), buildAiThoughts());
    } else if (townBoard === "billboard") {
      wrap.append(buildTownBillboard());
    } else if (townBoard === "quests") {
      wrap.append(buildTownQuests());
    } else if (townBoard === "jobs") {
      wrap.append(buildTownJobs());
    } else if (townBoard === "gift") {
      wrap.append(buildTownGift());
    } else if (townBoard === "achievements") {
      wrap.append(buildTownAchievements());
    } else if (townBoard === "tournament") {
      void loadExtras();
      wrap.append(buildTownTournament());
    } else if (townBoard === "stocks") {
      void loadStocks();
      wrap.append(buildTownStocks());
    } else {
      wrap.append(lineBlock(mode === "owner" ? t("town.hint") : t("town.visitHint")));
    }
    return wrap;
  }

  /** @brief Builds the content of the active legacy tab. */
  function buildLegacyContent(): HTMLElement {
    if (tab === "garden") return buildGarden();
    if (tab === "market") return buildMarket();
    if (tab === "chart") return buildChart();
    if (tab === "bots") return buildBots();
    if (tab === "rank") return buildRank();
    if (tab === "farm") return buildFarm();
    if (tab === "warehouse") return buildWarehouse();
    if (tab === "extras") return buildExtras();
    if (tab === "prestige") return buildPrestige();
    if (tab === "dynopedia") return buildDynopedia();
    if (tab === "log") return buildLog();
    if (tab === "levels") return buildLevels();
    return buildEvent();
  }

  /** @brief Status comment line. */
  function buildStatus(): HTMLElement {
    const line = document.createElement("p");
    line.className = "stage-status";
    if (message !== null) {
      line.textContent = message.text;
      if (tool?.kind === "harvest") {
        line.textContent += ` · ${t("garden.harvestToolActive")}`;
      }
      line.classList.add(`is-${message.kind}`);
    } else if (tool !== null) {
      line.textContent =
        tool.kind === "water"
          ? t("garden.waterToolActive")
          : tool.kind === "harvest"
            ? t("garden.harvestToolActive")
            : tool.kind === "plant"
              ? t("garden.plantToolActive", {
                  seed: seedName(tool.seed),
                  left: state?.bag.seeds[tool.seed] ?? 0,
                })
              : t("garden.toolActive", {
                  supply: t(`supplies.${tool.supply}`),
                  left: state?.bag.supplies[tool.supply] ?? 0,
                });
    } else {
      line.textContent = mode === "visit" ? t("garden.readonly") : t("garden.noSelectionHint");
    }
    if (offline) line.textContent = `[${t("common.offline")}] ${line.textContent}`;
    return line;
  }

  /** @brief Repaints the whole document. */
  function render(): void {
    if (root === null || disposed) return;
    if (season !== null) music.setPhase(season.phase.id);
    music.setWeather((season?.events ?? []).map((entry) => entry.id));
    page = Math.min(page, pageCount() - 1);
    root.dataset.tab = tab;
    root.dataset.mode = mode;
    root.dataset.stealth = stealth ? "on" : "off";
    root.dataset.offline = offline ? "on" : "off";
    root.dataset.busy = busy ? "on" : "off";
    const parts: HTMLElement[] = [buildTabs()];
    if (view === "legacy") parts.push(buildLegacyStrip());
    parts.push(buildHud(), buildContent(), buildStatus());
    const popover = buildMenu(now());
    if (popover !== null) parts.push(popover);
    if (staffMenu !== null) {
      const staffEl = buildStaffMenu();
      if (staffEl !== null) parts.push(staffEl);
    }
    if (animalMenu !== null) {
      const animalEl = buildAnimalMenu(now());
      if (animalEl !== null) parts.push(animalEl);
    }
    if (machineMenu !== null) {
      const machineEl = buildMachineMenu(now());
      if (machineEl !== null) parts.push(machineEl);
    }
    if (specialMenu !== null) {
      const specialEl = buildSpecialMenu(now());
      if (specialEl !== null) parts.push(specialEl);
    }
    if (greenhouseMenu !== null) {
      const greenhouseEl = buildGreenhouseMenu(now());
      if (greenhouseEl !== null) parts.push(greenhouseEl);
    }
    if (nurseryPopover !== null) {
      const nurseryEl = buildNurseryPopover();
      if (nurseryEl !== null) parts.push(nurseryEl);
    }
    if (sellAllDialog !== null) {
      const sellEl = buildSellAllDialog();
      if (sellEl !== null) parts.push(sellEl);
    }
    root.replaceChildren(...parts);
    fitMenu();
    fitStaffMenu();
    fitAnimalMenu();
    fitMachineMenu();
    refreshTimers();
  }

  /** @brief Creates the HUD comment line element. */
  function buildHud(): HTMLElement {
    const hud = document.createElement("span");
    hud.className = "stage-hud";
    hud.textContent = hudText();
    return hud;
  }

  /** @brief Updates countdowns and cell progress without rebuilding inputs. */
  function refreshTimers(): void {
    if (root === null) return;
    const at = now();
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-cell[data-area][data-slot]")) {
      const slot = Number(cell.dataset.slot);
      const area = cell.dataset.area === "tree" ? "tree" : "crop";
      if (Number.isInteger(slot) && cell instanceof HTMLButtonElement) syncCell(cell, slot, area, at);
    }
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-animal-cell[data-building][data-slot]")) {
      const building = cell.dataset.building as BuildingId | undefined;
      const slot = Number(cell.dataset.slot);
      if (building !== undefined && Number.isInteger(slot) && cell instanceof HTMLButtonElement) {
        syncAnimalCell(cell, building, slot, at);
      }
    }
    if (season !== null) {
      for (const element of root.querySelectorAll<HTMLElement>("[data-restock-timer]")) {
        element.textContent = `// ${t("market.restockLine", {
          time: formatDuration(Math.max(0, season.shop.restockAt - at)),
        })}`;
      }
    }
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-special-cell[data-slot]")) {
      const slot = Number(cell.dataset.slot);
      if (Number.isInteger(slot) && cell instanceof HTMLButtonElement) syncSpecialCell(cell, slot, at);
    }
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-greenhouse-cell[data-slot]")) {
      const slot = Number(cell.dataset.slot);
      if (Number.isInteger(slot) && cell instanceof HTMLButtonElement) syncGreenhouseCell(cell, slot, at);
    }
    const reborn = rebornPlots();
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-reborn-cell[data-slot]")) {
      const slot = Number(cell.dataset.slot);
      const plot = Number.isInteger(slot) ? reborn[slot] : undefined;
      if (plot !== undefined && cell instanceof HTMLButtonElement) {
        paintRebornCell(cell, plot, at, activeHybrids());
      }
    }
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-mushroom-tray[data-slot]")) {
      const slot = Number(cell.dataset.slot);
      if (Number.isInteger(slot) && cell instanceof HTMLButtonElement) {
        paintRebornAction(cell, mushroomTrayAction(slot, at));
      }
    }
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-warehouse-cell[data-machine]")) {
      const machineId = cell.dataset.machine as MachineId | undefined;
      const machine = machineId ? machineById(machineId) : undefined;
      if (machine !== undefined && cell instanceof HTMLButtonElement) {
        paintRebornAction(cell, machinePlotAction(machine, at));
      }
    }
    for (const element of root.querySelectorAll<HTMLElement>(".garden-side-time[data-side-until]")) {
      const until = Number(element.dataset.sideUntil);
      if (Number.isFinite(until)) {
        element.textContent = formatDuration(Math.max(0, until - at), "short");
      }
    }
    for (const element of root.querySelectorAll<HTMLElement>("[data-machine-until]")) {
      const until = Number(element.dataset.machineUntil);
      if (Number.isFinite(until)) {
        element.textContent = `${t("warehouse.remaining")} ${formatDuration(Math.max(0, until - at), "short")}`;
      }
    }
    for (const element of root.querySelectorAll<HTMLElement>("[data-market-timer]")) {
      if (chartMarket !== null) {
        element.textContent = formatDuration(Math.max(0, chartMarket.nextCycleAt - at));
      }
    }
    const hud = root.querySelector<HTMLElement>(".stage-hud");
    if (hud !== null) hud.textContent = hudText();
    if (season !== null) {
      for (const element of root.querySelectorAll<HTMLElement>("[data-event-timer]")) {
        if (element.dataset.eventTimer === "now") {
          element.textContent = t("event.left", {
            time: formatDuration(Math.max(0, season.event.endsAt - at)),
          });
        } else if (element.dataset.eventTimer === "next") {
          element.textContent = t("event.left", {
            time: formatDuration(Math.max(0, season.next.startedAt - at)),
          });
        }
      }
    }
    // A tray can ripen while its info panel is open: swap in the harvest button.
    if (mushroomInfo !== null) {
      const panel = root.querySelector<HTMLElement>(".garden-mushroom-info");
      const tray = (state?.mushroomTrays ?? [])[mushroomInfo] ?? null;
      const ready = tray !== null && at >= tray.readyAt;
      if (panel !== null && panel.dataset.ready !== (ready ? "on" : "off")) render();
    }
  }

  // ------------------------------------------------------------------ events

  /** @brief Click routing through `data-act` buttons. */
  function onClick(event: MouseEvent): void {
    if (busy) return;
    const clicked = event.target instanceof Element ? event.target : null;
    const target = clicked?.closest<HTMLElement>("[data-act]") ?? null;
    const inMenu = clicked?.closest(".garden-menu") !== null;
    if (target === null) {
      if (!inMenu) {
        closeMenu();
        if (quickMenu !== null) {
          quickMenu = null;
          render();
          return;
        }
        if (staffMenu !== null) {
          const inStaff = clicked?.closest(".garden-staff-menu") !== null;
          if (!inStaff) closeStaffMenu();
        }
        if (animalMenu !== null) {
          const inAnimal = clicked?.closest(".garden-animal-menu") !== null;
          if (!inAnimal) closeAnimalMenu();
        }
        if (machineMenu !== null) {
          const inMachine = clicked?.closest(".garden-machine-menu") !== null;
          if (!inMachine) closeMachineMenu();
        }
      }
      return;
    }
    const action = target.dataset.act ?? "";
    if (musicWanted && !music.isPlaying() && action !== "toggleMusic") {
      music.start();
    }
    if (QUICK_MENU_ACTS.has(action)) {
      const rect = target.getBoundingClientRect();
      quickMenu =
        quickMenu?.action === action
          ? null
          : { action, x: rect.left, y: rect.bottom + 4, anchorTop: rect.top };
    }
    if (action.startsWith("gardenTab:")) {
      closeMenu();
      switchGardenTab(action.slice(10) as GardenTab);
      return;
    }
    if (action.startsWith("rebornTab:")) {
      closeMenu();
      switchRebornTab(action.slice(10) as RebornTab);
      return;
    }
    if (action.startsWith("logFilter:")) {
      const nextFilter = action.slice(10) as "all" | "global" | "timeline";
      if (nextFilter === "all" || nextFilter === "global" || nextFilter === "timeline") {
        logFilter = nextFilter;
        render();
      }
      return;
    }
    if (action.startsWith("dynopediaFilter:")) {
      const nextFilter = action.slice(16) as "all" | "known" | "unknown";
      if (nextFilter === "all" || nextFilter === "known" || nextFilter === "unknown") {
        dynopediaFilter = nextFilter;
        render();
      }
      return;
    }
    if (action.startsWith("view:")) {
      closeMenu();
      switchView(action.slice(5) as GardenView);
      return;
    }
    if (action.startsWith("tab:")) {
      closeMenu();
      switchTab(action.slice(4) as Tab);
      return;
    }
    switch (action) {
      case "plot": {
        const slot = Number(target.dataset.slot);
        const area = target.dataset.area === "tree" ? "tree" : "crop";
        if (!Number.isInteger(slot)) return;
        if (isPreviewPage()) {
          message = { text: t("garden.previewTabHint"), kind: "info" };
          render();
          return;
        }
        if (moveSource !== null) {
          const source = moveSource;
          moveSource = null;
          if (area !== source.area) {
            message = { text: t("garden.moveSameBoard"), kind: "err" };
            render();
            return;
          }
          if (slot === source.slot) {
            message = { text: t("garden.moveCancelled"), kind: "info" };
            render();
            return;
          }
          const occupied = area === "tree" ? treeAt(slot) !== null : plotAt(slot) !== null;
          if (occupied) {
            message = { text: translateError("PLOT_OCCUPIED"), kind: "err" };
            render();
            return;
          }
          if (area === "crop" && cropSlotLocked(slot)) {
            message = { text: translateError("PLOT_LOCKED"), kind: "err" };
            render();
            return;
          }
          void runAction(
            { kind: "movePlant", from: source.slot, to: slot, tree: area === "tree" },
            t("garden.moved"),
          );
          return;
        }
        if (tool !== null && mode === "owner") {
          if (tool.kind === "harvest") {
            const plant = area === "tree" ? treeAt(slot) : plotAt(slot);
            if (plant === null || isPreviewPage()) {
              message = { text: t("garden.toolEmpty"), kind: "info" };
              render();
              return;
            }
            if (now() < plant.readyAt) {
              message = { text: translateError("NOT_READY"), kind: "info" };
              render();
              return;
            }
            harvest(slot, area);
            return;
          }
          if (tool.kind === "water") {
            const plant = area === "tree" ? treeAt(slot) : plotAt(slot);
            if (plant === null || isPreviewPage()) {
              message = { text: t("garden.toolEmpty"), kind: "info" };
              render();
              return;
            }
            if (now() >= plant.readyAt || plant.watered) {
              message = { text: t("garden.waterNotNeeded"), kind: "info" };
              render();
              return;
            }
            waterSelected(slot, area);
            return;
          }
          if (tool.kind === "plant") {
            const seedDef = seedById(tool.seed);
            if (area === "tree") {
              if (seedDef?.category !== "fruit") {
                message = { text: translateError("WRONG_AREA"), kind: "err" };
                render();
                return;
              }
              if (treeAt(slot) !== null || isPreviewPage()) {
                message = { text: t("garden.plantOccupied"), kind: "info" };
                render();
                return;
              }
              if ((state?.bag.seeds[tool.seed] ?? 0) < 1) {
                message = { text: t("garden.plantNoSeeds"), kind: "err" };
                tool = null;
                render();
                return;
              }
              void runAction(
                { kind: "plantFruitSeed", slot, seed: tool.seed as SeedId },
                t("garden.plantedFruitSeed", { seed: seedName(tool.seed) }),
              );
              return;
            }
            if (seedDef?.category === "fruit") {
              message = { text: translateError("WRONG_AREA"), kind: "err" };
              render();
              return;
            }
            const occupied = plotAt(slot) !== null || isPreviewPage();
            if (occupied) {
              message = { text: t("garden.plantOccupied"), kind: "info" };
              render();
              return;
            }
            if ((state?.bag.seeds[tool.seed] ?? 0) < 1) {
              message = { text: t("garden.plantNoSeeds"), kind: "err" };
              tool = null;
              render();
              return;
            }
            void plantSeed(slot, tool.seed);
            return;
          }
          // Tool mode: one click uses the picked supply, no menu in the way.
          const plant = area === "tree" ? treeAt(slot) : plotAt(slot);
          if (plant === null || isPreviewPage()) {
            message = { text: t("garden.toolEmpty"), kind: "info" };
            render();
            return;
          }
          applySupply(tool.kind, tool.supply, slot, area);
          return;
        }
        const rect = target.getBoundingClientRect();
        openMenu(slot, area, rect.left + 6, rect.bottom + 2, rect.top);
        return;
      }
      case "buySpecialPatch": {
        const patch = Number(target.dataset.patch);
        if (Number.isInteger(patch)) {
          void runAction({ kind: "buySpecialPatch", patch }, t("special.patched"));
        }
        return;
      }
      case "buySpecialPlot": {
        void runAction({ kind: "buySpecialPlot" }, t("special.plotBought"));
        return;
      }
      case "specialNoop":
        return;
      case "specialPlot": {
        const slot = Number(target.dataset.slot);
        if (!Number.isInteger(slot)) return;
        const view = specialView();
        const plot = view?.plots[slot] ?? null;
        if (event.shiftKey && plot !== null) {
          void runAction({ kind: "uprootSpecial", slot }, t("special.uprooted"));
          return;
        }
        specialPicker = null;
        specialMenu = { slot, x: event.clientX, y: event.clientY };
        render();
        return;
      }
      case "specialMenuClose":
        specialMenu = null;
        render();
        return;
      case "specialMenuPlant":
        if (specialMenu !== null) specialPicker = specialMenu.slot;
        specialMenu = null;
        render();
        return;
      case "specialMenuFertilize":
        if (specialMenu !== null) {
          specialSupplyPicker = { kind: "fertilize", slot: specialMenu.slot };
          specialMenu = null;
          render();
        }
        return;
      case "specialMenuSpray":
        if (specialMenu !== null) {
          specialSupplyPicker = { kind: "spray", slot: specialMenu.slot };
          specialMenu = null;
          render();
        }
        return;
      case "specialMenuHarvest":
        if (specialMenu !== null) {
          const slot = specialMenu.slot;
          specialMenu = null;
          void runAction({ kind: "harvestSpecial", slot }, t("special.harvested"));
        }
        return;
      case "specialMenuWater":
        if (specialMenu !== null) {
          const slot = specialMenu.slot;
          specialMenu = null;
          void runAction({ kind: "waterSpecial", slot }, t("garden.watered"));
        }
        return;
      case "specialMenuUproot":
        if (specialMenu !== null) {
          const slot = specialMenu.slot;
          specialMenu = null;
          void runAction({ kind: "uprootSpecial", slot }, t("special.uprooted"));
        }
        return;
      case "specialFertilize": {
        const slot = Number(target.dataset.slot);
        const supply = target.dataset.supply as FertilizerId | undefined;
        if (Number.isInteger(slot) && supply !== undefined) {
          specialSupplyPicker = null;
          void runAction({ kind: "fertilizeSpecial", slot, supply }, t("special.fertilized"));
        }
        return;
      }
      case "specialSpray": {
        const slot = Number(target.dataset.slot);
        const supply = target.dataset.supply as SprayId | undefined;
        if (Number.isInteger(slot) && supply !== undefined) {
          specialSupplyPicker = null;
          void runAction({ kind: "spraySpecial", slot, supply }, t("special.sprayed"));
        }
        return;
      }
      case "specialSeed": {
        const slot = Number(target.dataset.slot);
        const seed = target.dataset.seed as SeedId | undefined;
        if (Number.isInteger(slot) && seed !== undefined) {
          specialPicker = null;
          void runAction({ kind: "plantSpecial", slot, seed }, t("garden.planted"));
        }
        return;
      }
      case "pickTool": {
        const kind = target.dataset.kind === "spray" ? "spray" : "fertilize";
        toolPicker = toolPicker === kind ? null : kind;
        render();
        return;
      }
      case "pickAllSupply": {
        const kind = target.dataset.kind === "spray" ? "sprayAll" : "fertilizeAll";
        toolPicker = toolPicker === kind ? null : kind;
        tool = null;
        render();
        return;
      }
      case "bulkPlan":
        bulkPanel = bulkPanel === "plan" ? null : "plan";
        toolPicker = null;
        render();
        return;
      case "bulkFertilize":
        toolPicker = toolPicker === "fertilizeAll" ? null : "fertilizeAll";
        bulkPanel = null;
        render();
        return;
      case "bulkSpray":
        toolPicker = toolPicker === "sprayAll" ? null : "sprayAll";
        bulkPanel = null;
        render();
        return;
      case "bulkUproot":
        bulkPanel = bulkPanel === "uproot" ? null : "uproot";
        toolPicker = null;
        render();
        return;
      case "claimQuest": {
        const id = target.dataset.id;
        if (id !== undefined) void runAction({ kind: "claimQuest", id }, t("quests.claimedMsg"));
        return;
      }
      case "buyFinalSeed": {
        const seed = target.dataset.seed as SeedId | undefined;
        if (seed !== undefined) {
          void runAction({ kind: "buyFinalSeed", seed }, t("finalShop.bought"));
        }
        return;
      }
      case "buyPrestigeSeed": {
        const seed = target.dataset.seed as SeedId | undefined;
        if (seed !== undefined) {
          void runAction({ kind: "buyPrestigeSeed", seed }, t("prestige.seedBought"));
        }
        return;
      }
      case "prestige": {
        if (!confirmPrestige) {
          confirmPrestige = true;
          render();
          return;
        }
        confirmPrestige = false;
        void runAction({ kind: "prestige" }, t("prestige.done"));
        return;
      }
      case "plantAllSeed": {
        const seed = target.dataset.seed as SeedId | undefined;
        if (seed !== undefined) {
          void runAction({ kind: "plantAll", seed }, t("garden.plantedAll"));
        }
        return;
      }
      case "uprootSeed": {
        const seed = target.dataset.seed as SeedId | undefined;
        if (seed !== undefined) {
          uprootPending = { seed };
          render();
        }
        return;
      }
      case "uprootTree": {
        const tree = target.dataset.tree as TreeId | undefined;
        if (tree !== undefined) {
          uprootPending = { tree };
          render();
        }
        return;
      }
      case "uprootDead":
        uprootPending = { dead: true };
        render();
        return;
      case "uprootLoss":
        uprootPending = { profit: "loss" };
        render();
        return;
      case "uprootWin":
        uprootPending = { profit: "win" };
        render();
        return;
      case "uprootPrice": {
        const priceBelow = Number(uprootPriceDraft);
        if (!Number.isFinite(priceBelow) || priceBelow < 0) {
          message = { text: t("auto.priceBad"), kind: "err" };
          render();
          return;
        }
        uprootPending = { priceBelow };
        render();
        return;
      }
      case "uprootConfirm": {
        if (uprootPending === null) return;
        const filter = uprootPending;
        uprootPending = null;
        void runAction({ kind: "uprootBulk", ...filter }, t("auto.uprooted"));
        return;
      }
      case "uprootCancel":
        uprootPending = null;
        render();
        return;
      case "quickSupplyAll": {
        const kind = target.dataset.kind === "spray" ? "spray" : "fertilize";
        const supply = target.dataset.supply as SupplyId | undefined;
        if (supply === undefined || state === null) return;
        const definition = kind === "fertilize" ? fertilizerById(supply) : sprayById(supply);
        if (definition === undefined) return;
        const eligible = supplyTargetCount(kind, now());
        if (eligible <= 0) {
          message = { text: t("garden.noTargets"), kind: "info" };
          render();
          return;
        }
        const unit = buyPriceOf(supply, definition.price);
        const count = unit <= 0 ? eligible : Math.min(eligible, Math.floor(state.coins / unit));
        if (count <= 0) {
          message = { text: t("errors.NOT_ENOUGH_COINS"), kind: "err" };
          render();
          return;
        }
        toolPicker = null;
        const cost = count * unit;
        void runAction(
          kind === "fertilize"
            ? { kind: "fertilizeAll", supply: supply as FertilizerId }
            : { kind: "sprayAll", supply: supply as SprayId },
          t(kind === "fertilize" ? "garden.fertilizedAll" : "garden.sprayedAll", {
            count,
            cost: formatCompact(cost),
          }),
        );
        return;
      }
      case "quickWater":
        tool = tool?.kind === "water" ? null : { kind: "water" };
        toolPicker = null;
        message = tool === null ? null : { text: t("garden.waterToolActive"), kind: "info" };
        render();
        return;
      case "quickHarvest":
        tool = tool?.kind === "harvest" ? null : { kind: "harvest" };
        toolPicker = null;
        message = tool === null ? null : { text: t("garden.harvestToolActive"), kind: "info" };
        render();
        return;
      case "quickPlan": {
        if (state === null) return;
        const empties = planEmptyCounts();
        const preview = planQuickPlan({
          coins: state.coins,
          prestige: state.extras.prestige ?? 0,
          shopOffers: season?.shop.offers ?? [],
          emptyCrops: empties.crops,
          emptyTrees: empties.trees,
          emptyTrays: empties.trays,
        });
        toolPicker = null;
        bulkPanel = null;
        tool = null;
        if (preview.slots === 0) {
          message = { text: t("quick.planEmpty"), kind: "info" };
          render();
          return;
        }
        quickPlanPreview = preview;
        render();
        return;
      }
      case "quickPlanRun":
        if (quickPlanPreview !== null) {
          quickPlanPreview = null;
          void runAction({ kind: "quickPlan" }, t("quick.planDone"));
        }
        return;
      case "quickPlanCancel":
        quickPlanPreview = null;
        render();
        return;
      case "quickMenuClose":
        quickMenu = null;
        toolPicker = null;
        bulkPanel = null;
        quickPlanPreview = null;
        uprootPending = null;
        render();
        return;
      case "pickPlantTool":
        toolPicker = toolPicker === "plant" ? null : "plant";
        render();
        return;
      case "pickPlantSeed": {
        const seed = target.dataset.seed as AnySeedId | undefined;
        if (seed !== undefined) {
          tool = { kind: "plant", seed };
          toolPicker = null;
          message = {
            text: t("garden.plantToolPicked", { seed: seedName(seed) }),
            kind: "info",
          };
          render();
        }
        return;
      }
      case "pickToolSupply": {
        const supply = target.dataset.supply as SupplyId | undefined;
        const kind = target.dataset.kind === "spray" ? "spray" : "fertilize";
        if (supply !== undefined) {
          tool = { kind, supply };
          toolPicker = null;
          message = {
            text: t("garden.toolPicked", { supply: t(`supplies.${supply}`) }),
            kind: "info",
          };
          render();
        }
        return;
      }
      case "cancelTool":
        tool = null;
        toolPicker = null;
        render();
        return;
      case "menuClose":
        closeMenu();
        return;
      case "menuBack":
        menuView("actions");
        return;
      case "menuViewSeed":
        menuView("seed");
        return;
      case "menuViewTree":
        menuView("tree");
        return;
      case "menuViewFertilize":
        menuView("fertilize");
        return;
      case "menuViewSpray":
        menuView("spray");
        return;
      case "menuBuyPatch": {
        const tabIndex = menu === null ? page : Math.floor(menu.slot / CROPS_PER_TAB);
        void runAction(
          { kind: "buyPatch", tab: tabIndex },
          t("garden.patchBought", { patch: plotLabel(menu?.slot ?? cropOffset(), "crop").patch }),
        );
        closeMenu();
        return;
      }
      case "menuFruitSeed": {
        const seed = target.dataset.seed as SeedId | undefined;
        const slot = menu?.slot;
        if (seed !== undefined && slot !== undefined) {
          closeMenu();
          void runAction(
            { kind: "plantFruitSeed", slot, seed },
            t("garden.plantedFruitSeed", { seed: seedName(seed) }),
          );
        }
        return;
      }
      case "repairPlot": {
        const slot = Number(target.dataset.slot);
        if (Number.isInteger(slot)) void runAction({ kind: "repairPlot", slot }, t("garden.repaired"));
        return;
      }
      case "menuSeed": {
        const seedId = target.dataset.seed as SeedId | undefined;
        if (menu !== null && seedId !== undefined) void plantSeed(menu.slot, seedId);
        closeMenu();
        return;
      }
      case "menuTree": {
        const treeId = target.dataset.tree as TreeId | undefined;
        if (menu !== null && treeId !== undefined) void plantTree(menu.slot, treeId);
        closeMenu();
        return;
      }
      case "menuUseFertilize": {
        const supply = target.dataset.supply as SupplyId | undefined;
        if (supply !== undefined) applySupply("fertilize", supply);
        closeMenu();
        return;
      }
      case "menuUseSpray": {
        const supply = target.dataset.supply as SupplyId | undefined;
        if (supply !== undefined) applySupply("spray", supply);
        closeMenu();
        return;
      }
      case "share":
        void shareGarden();
        return;
      case "home":
        backHome();
        return;
      case "retry":
        void bootstrap();
        return;
      case "seed": {
        const seedId = target.dataset.seed as SeedId | undefined;
        if (selectedSlot !== null && seedId !== undefined) void plantSeed(selectedSlot, seedId);
        return;
      }
      case "tree": {
        const treeId = target.dataset.tree as TreeId | undefined;
        if (selectedSlot !== null && treeId !== undefined) void plantTree(selectedSlot, treeId);
        return;
      }
      case "sprayPest": {
        if (menu === null) return;
        void runAction(
          { kind: "sprayPest", slot: menu.slot, tree: menu.area === "tree" },
          t("garden.sprayedPest"),
        );
        closeMenu();
        return;
      }
      case "renovateSoil":
        void runAction({ kind: "renovateSoil" }, t("garden.renovated"));
        return;
      case "sprayPestAll": {
        if (state === null) return;
        const count =
          (state.plots ?? []).filter((plot, slot) => plot !== null && !cropSlotLocked(slot)).length +
          (state.trees ?? []).filter((tree) => tree !== null).length;
        void runAction(
          { kind: "sprayPestAll" },
          t("garden.sprayedPestAll", { count, cost: count * PEST_SPRAY_COST }),
        );
        return;
      }
      case "harvest":
      case "water": {
        if (selectedSlot === null) return;
        menu = null;
        if (action === "harvest") harvest(selectedSlot, selectedArea);
        else waterSelected(selectedSlot, selectedArea);
        closeMenu();
        return;
      }
      case "reclaimSeed":
      case "menuReclaim": {
        const ctx = menu ?? (selectedSlot === null ? null : { slot: selectedSlot, area: selectedArea });
        if (ctx === null || ctx.area !== "crop") return;
        menu = null;
        void runAction({ kind: "reclaimSeed", slot: ctx.slot }, t("garden.reclaimed"));
        return;
      }
      case "beginMove":
      case "menuMove": {
        const ctx = menu ?? (selectedSlot === null ? null : { slot: selectedSlot, area: selectedArea });
        if (ctx === null) return;
        menu = null;
        moveSource = { slot: ctx.slot, area: ctx.area };
        message = { text: t("garden.moveHint"), kind: "info" };
        render();
        return;
      }
      case "toggleFavorite":
      case "menuFavorite": {
        const ctx = menu ?? (selectedSlot === null ? null : { slot: selectedSlot, area: selectedArea });
        if (ctx === null) return;
        const plant = ctx.area === "tree" ? treeAt(ctx.slot) : plotAt(ctx.slot);
        if (plant === null) return;
        const locking = plant.favorite !== true;
        menu = null;
        void runAction(
          { kind: "toggleFavorite", slot: ctx.slot, tree: ctx.area === "tree" },
          t(locking ? "garden.favoriteSet" : "garden.favoriteCleared"),
        );
        return;
      }
      case "uproot": {
        if (selectedSlot === null) return;
        // First press arms the confirmation and keeps the menu open; only the
        // second press actually removes the plant.
        const armed = uprootArmed;
        uproot(selectedSlot, selectedArea);
        if (armed) closeMenu();
        return;
      }
      case "machineMenuOpen": {
        const machine = target.dataset.machine as MachineId | undefined;
        if (machine !== undefined) {
          const rect = target.getBoundingClientRect();
          openMachineMenu(machine, rect.left + 6, rect.bottom + 2, rect.top);
        }
        return;
      }
      case "machineMenuClose":
        closeMachineMenu();
        return;
      case "machineUpgrade": {
        const machine = target.dataset.machine as MachineId | undefined;
        if (machine !== undefined) {
          void runAction({ kind: "upgradeMachine", machine }, t("warehouse.machineUpgraded"));
        }
        return;
      }
      case "machineClearQueue": {
        const machine = target.dataset.machine as MachineId | undefined;
        if (machine !== undefined) {
          void runAction({ kind: "clearMachineQueue", machine }, t("warehouse.clearedQueue"));
        }
        return;
      }
      case "attachMachine": {
        const slot = target.dataset.slot as AttachmentSlot | undefined;
        const id = target.dataset.id;
        if (slot !== undefined && id !== undefined) {
          void runAction({ kind: "attachMachine", slot, id: id as never }, t("attachments.installed"));
        }
        return;
      }
      case "detachMachine": {
        const slot = target.dataset.slot as AttachmentSlot | undefined;
        if (slot !== undefined) void runAction({ kind: "detachMachine", slot }, t("attachments.detached"));
        return;
      }
      case "chartSort": {
        const sort = target.dataset.sort;
        if (sort === "roi" || sort === "income" || sort === "pressure") {
          chartSort = sort;
          render();
        }
        return;
      }
      case "buyPrestigeSkill": {
        const skill = target.dataset.skill;
        if (skill === "merchant" || skill === "farmer" || skill === "artisan") {
          void runAction({ kind: "buyPrestigeSkill", skill }, t("prestige.skillBought"));
        }
        return;
      }
      case "respecPrestige":
        void runAction({ kind: "respecPrestige" }, t("prestige.respecDone"));
        return;
      case "claimCodex": {
        void runAction({ kind: "claimCodex" }, t("dynopedia.claimed"));
        return;
      }
      case "cookRecipe": {
        const id = target.dataset.id;
        if (id !== undefined) void runAction({ kind: "cookRecipe", id }, t("recipe.cooked"));
        return;
      }
      case "raidHit": {
        void api
          .raidHit()
          .then((result) => {
            raidSnapshot = result.raid;
            message = { text: t("raid.hitDone"), kind: "info" };
          })
          .catch((error: unknown) => {
            message = {
              text: translateError(error instanceof Error ? error.message : "TRY_LATER"),
              kind: "err",
            };
          })
          .finally(() => {
            void refresh();
            render();
          });
        return;
      }
      case "recipeAddInput":
        if (recipeInputs.length < 6) recipeInputs.push("");
        render();
        return;
      case "recipeRemoveInput": {
        const index = Number(target.dataset.index);
        if (recipeInputs.length > 2 && Number.isInteger(index)) {
          recipeInputs.splice(index, 1);
          render();
        }
        return;
      }
      case "recipeSuggest": {
        const inputs = recipeInputs.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        if (inputs.length < 2) {
          message = { text: t("recipe.missing"), kind: "err" };
          render();
          return;
        }
        recipeResult = t("recipe.checking");
        render();
        void api
          .suggestRecipe(inputs)
          .then((result) => {
            recipeResult = result.valid
              ? t("recipe.suggested", {
                  name: result.recipe?.output ?? "",
                  price: formatCompact(result.recipe?.price ?? 0),
                })
              : t("recipe.invalid", { reason: result.reason });
            if (result.valid) void refresh();
            void loadGlobalRecipes();
          })
          .catch((error: unknown) => {
            const code =
              typeof error === "object" && error !== null && "code" in error
                ? String((error as { code: unknown }).code)
                : "NETWORK";
            recipeResult = code === "RECIPE_AI_OFFLINE" ? t("recipe.offline") : t("recipe.aiError", { code });
          })
          .finally(() => render());
        return;
      }
      case "recipeLearn": {
        const id = target.dataset.id;
        const recipe = globalRecipes.find((entry) => entry.id === id);
        if (recipe !== undefined) {
          void api
            .learnRecipe({ inputs: recipe.inputs, output: recipe.output, price: recipe.price })
            .then(() => {
              message = { text: t("recipe.learned"), kind: "info" };
              void refresh();
            })
            .catch(() => {
              message = { text: t("recipe.offline"), kind: "err" };
            });
        }
        return;
      }
      case "kitchenFilter": {
        const filter = target.dataset.filter;
        if (filter === "all" || filter === "cookable" || filter === "missing" || filter === "cooldown") {
          kitchenStatusFilter = filter;
          render();
        }
        return;
      }
      case "kitchenClearFilters": {
        kitchenQuery = "";
        kitchenStatusFilter = "all";
        kitchenIngredientFilter = "";
        render();
        return;
      }
      case "kitchenPickIngredient": {
        const ing = target.dataset.ing;
        if (ing !== undefined) {
          kitchenIngredientFilter = kitchenIngredientFilter === ing ? "" : ing;
          render();
        }
        return;
      }
      case "logRefresh":
        void loadGlobalSales();
        return;
      case "dynopediaCategory": {
        const category = target.dataset.category;
        if (category !== undefined) {
          dynopediaCategory = category;
          render();
        }
        return;
      }
      case "machineQty": {
        const qty = Number(target.dataset.qty);
        if (Number.isInteger(qty) && qty > 0) {
          machineQty = qty;
          render();
        }
        return;
      }
      case "machineLimitSet": {
        if (machineMenu === null) return;
        const limit = Number(machineLimitDraft);
        if (!Number.isInteger(limit) || limit < 1) {
          message = { text: t("warehouse.badLimit"), kind: "err" };
          render();
          return;
        }
        void runAction(
          { kind: "setMachineLimit", machine: machineMenu.id, limit },
          t("warehouse.limitSaved"),
        );
        return;
      }
      case "machineLimitClear": {
        if (machineMenu === null) return;
        void runAction({ kind: "setMachineLimit", machine: machineMenu.id }, t("warehouse.limitCleared"));
        return;
      }
      case "machineQueue": {
        const machine = target.dataset.machine as MachineId | undefined;
        if (machine === undefined) return;
        const item = target.dataset.item as AnyItemId | undefined;
        void runAction(
          { kind: "queueMachine", machine, qty: machineQty, ...(item === undefined ? {} : { item }) },
          t("warehouse.queued"),
        );
        return;
      }
      case "machineCraft": {
        const machine = target.dataset.machine as MachineId | undefined;
        const item = target.dataset.item as AnyItemId | undefined;
        if (machine !== undefined) {
          const action: GardenAction =
            item === undefined ? { kind: "craftMachine", machine } : { kind: "craftMachine", machine, item };
          void runAction(action, t("warehouse.crafted"));
        }
        return;
      }
      case "machineCollect": {
        const machine = target.dataset.machine as MachineId | undefined;
        if (machine !== undefined) {
          void runAction({ kind: "collectMachine", machine }, t("warehouse.collected"));
        }
        return;
      }
      case "machineNoop":
        return;
      case "pickFertilize":
        supplyPicker = "fertilize";
        render();
        return;
      case "pickSpray":
        supplyPicker = "spray";
        render();
        return;
      case "cancelSupply":
        supplyPicker = null;
        render();
        return;
      case "applySupply": {
        const supply = target.dataset.supply as SupplyId | undefined;
        const kind = target.dataset.kind === "spray" ? "spray" : "fertilize";
        if (supply !== undefined) applySupply(kind, supply);
        return;
      }
      case "visitBot": {
        const code = target.dataset.code;
        if (code !== undefined) openVisit(code);
        return;
      }
      case "minerSlotToggle":
        minerMenuOpen = !minerMenuOpen;
        render();
        return;
      case "assignMinerSlot": {
        const staffSlot = Number(target.dataset.staffSlot);
        if (Number.isInteger(staffSlot)) {
          minerMenuOpen = false;
          void runAction({ kind: "assignMiner", staffSlot }, t("mine.minerSlot"));
        }
        return;
      }
      case "unassignMinerSlot":
        minerMenuOpen = false;
        void runAction({ kind: "assignMiner", staffSlot: null }, t("mine.unassignMiner"));
        return;
      case "mineHit": {
        const slot = Number(target.dataset.slot);
        if (Number.isInteger(slot)) {
          void runAction({ kind: "mineHit", slot }, "");
        }
        return;
      }
      case "mineDescend":
        void runAction({ kind: "mineDescend" }, t("mine.descend"));
        return;
      case "mineElevator": {
        const targetFloor = Number(target.dataset.targetFloor);
        if (Number.isInteger(targetFloor)) {
          void runAction({ kind: "mineElevator", targetFloor }, `${t("mine.elevator")} T${targetFloor}`);
        }
        return;
      }
      case "upgradePickaxe":
        void runAction({ kind: "upgradePickaxe" }, t("mine.upgradePickaxe"));
        return;
      case "mineEat": {
        const item = target.dataset.item as ProductId | undefined;
        if (item !== undefined) {
          void runAction({ kind: "mineEat", item }, t("mine.eatToRestore"));
        }
        return;
      }
      case "buildWarehouse":
        void runAction({ kind: "buildWarehouse" }, t("warehouse.built"));
        return;
      case "buildMachine": {
        const machine = target.dataset.machine;
        if (machine !== undefined) {
          void runAction({ kind: "buildMachine", machine: machine as never }, t("warehouse.machineBuilt"));
        }
        return;
      }
      case "upgradeMachine": {
        const machine = target.dataset.machine;
        if (machine !== undefined) {
          void runAction(
            { kind: "upgradeMachine", machine: machine as never },
            t("warehouse.machineUpgraded"),
          );
        }
        return;
      }
      case "craftMachine": {
        const machine = target.dataset.machine;
        const item = target.dataset.item;
        if (machine !== undefined) {
          void runAction(
            { kind: "craftMachine", machine: machine as never, item: item as never },
            t("warehouse.crafted"),
          );
        }
        return;
      }
      case "buildBuilding": {
        const building = target.dataset.building as BuildingId | undefined;
        if (building !== undefined) void runAction({ kind: "buildBuilding", building }, t("farm.built"));
        return;
      }
      case "upgradeBuilding": {
        const building = target.dataset.building as BuildingId | undefined;
        if (building !== undefined) void runAction({ kind: "upgradeBuilding", building }, t("farm.upgraded"));
        return;
      }
      case "pickAnimal": {
        const building = target.dataset.building as BuildingId | undefined;
        const slot = Number(target.dataset.slot);
        if (building !== undefined && Number.isInteger(slot)) {
          animalMenu = null;
          farmPicker = { building, slot };
          render();
        }
        return;
      }
      case "buyAnimal": {
        const building = target.dataset.building as BuildingId | undefined;
        const animal = target.dataset.animal as AnimalId | undefined;
        const slot = Number(target.dataset.slot);
        if (building !== undefined && animal !== undefined && Number.isInteger(slot)) {
          farmPicker = null;
          void runAction(
            { kind: "buyAnimal", building, slot, animal },
            t("farm.boughtAnimal", { animal: t(`animals.${animal}`) }),
          );
        }
        return;
      }
      case "patAnimal": {
        const building = target.dataset.building as BuildingId | undefined;
        const slot = Number(target.dataset.slot);
        if (building !== undefined && Number.isInteger(slot)) {
          void runAction({ kind: "patAnimal", building, slot }, t("farm.patted"));
        }
        return;
      }
      case "animalSlot": {
        const building = target.dataset.building as BuildingId | undefined;
        const slot = Number(target.dataset.slot);
        if (building !== undefined && Number.isInteger(slot)) {
          const rect = target.getBoundingClientRect();
          openAnimalMenu(building, slot, rect.left + 6, rect.bottom + 2, rect.top);
        }
        return;
      }
      case "animalMenuClose":
        closeAnimalMenu();
        return;
      case "animalMenuPat": {
        const current = animalMenu;
        if (current === null) return;
        void runAction(
          { kind: "patAnimal", building: current.building, slot: current.slot },
          t("farm.patted"),
        );
        return;
      }
      case "animalMenuBreed": {
        const current = animalMenu;
        if (current === null) return;
        void runAction(
          { kind: "breedAnimal", building: current.building, slot: current.slot },
          t("farm.bred"),
        );
        return;
      }
      case "animalMenuSell": {
        const current = animalMenu;
        if (current === null) return;
        animalMenu = null;
        void runAction(
          { kind: "sellAnimal", building: current.building, slot: current.slot },
          t("farm.soldAnimal"),
        );
        return;
      }
      case "buyTool": {
        const tool = target.dataset.tool;
        if (tool !== undefined)
          void runAction({ kind: "buyTool", tool: tool as never, qty: 1 }, t("market.boughtTool"));
        return;
      }
      case "sellProduct": {
        const product = target.dataset.product as ProductId | undefined;
        const star = Number(target.dataset.star);
        let effects: EffectId[] = [];
        try {
          const parsed = JSON.parse(target.dataset.effects ?? "[]") as unknown;
          if (Array.isArray(parsed))
            effects = parsed.filter((entry): entry is EffectId => typeof entry === "string");
        } catch {
          effects = [];
        }
        if (product !== undefined && Number.isInteger(star)) {
          void runAction({ kind: "sellProduct", product, star, effects, qty: 1 }, t("farm.soldProduct"));
        }
        return;
      }
      case "sellAllProducts":
        void runAction({ kind: "sellAllProducts" }, t("farm.soldAllProducts"));
        return;
      case "toggleStealth":
        stealth = !stealth;
        localStorage.setItem("dyno.garden.stealth", stealth ? "1" : "0");
        // Painted in place: rebuilding the document would flash the whole board.
        if (root !== null) root.dataset.stealth = stealth ? "on" : "off";
        target.classList.toggle("is-active", stealth);
        return;
      case "toggleMusic": {
        const playing = music.toggle();
        musicWanted = playing;
        localStorage.setItem("dyno.garden.music", playing ? "1" : "0");
        target.classList.toggle("is-active", playing);
        target.textContent = playing ? t("garden.musicOn") : t("garden.musicOff");
        return;
      }
      case "animalPenInfo": {
        const building = target.dataset.building as BuildingId | undefined;
        const penRaw = Number(target.dataset.level);
        if (building === undefined || !Number.isInteger(penRaw)) return;
        const definition = buildingById(building);
        const slots =
          definition === undefined
            ? 0
            : (definition.slots[penRaw - 1] ?? 0) - (penRaw > 1 ? (definition.slots[penRaw - 2] ?? 0) : 0);
        message = {
          text: t("animalTab.penInfo", { index: penRaw, count: slots }),
          kind: "info",
        };
        render();
        return;
      }
      case "townBoard": {
        const board = target.dataset.board;
        if (
          board !== "rank" &&
          board !== "chart" &&
          board !== "bots" &&
          board !== "billboard" &&
          board !== "quests" &&
          board !== "jobs" &&
          board !== "gift" &&
          board !== "achievements" &&
          board !== "tournament" &&
          board !== "stocks"
        )
          return;
        townBoard = townBoard === board ? null : (board as typeof townBoard);
        townNpc = null;
        if (townBoard === "rank") void loadLeaderboard();
        if (townBoard === "chart") void loadChart();
        if (townBoard === "bots") void loadBots();
        if (townBoard === "tournament") void loadExtras();
        if (townBoard === "stocks") void loadStocks();
        render();
        return;
      }
      case "townNpc": {
        const npc = target.dataset.npc;
        if (npc === undefined) return;
        townNpc = townNpc === npc ? null : npc;
        townBoard = null;
        if (townNpc === "guild") void loadGuilds();
        render();
        return;
      }
      case "townClose":
        townNpc = null;
        render();
        return;
      case "townBuy": {
        const kind = target.dataset.kind;
        const item = target.dataset.item;
        if (item === undefined) return;
        const qty = buyQty;
        if (kind === "seed") {
          void runAction(
            { kind: "buySeed", seed: item as SeedId, qty },
            t("market.bought", { qty, seed: seedName(item as SeedId) }),
          );
        } else if (kind === "supply") {
          void runAction(
            { kind: "buySupply", supply: item as SupplyId, qty },
            t("garden.boughtSupply", { supply: t(`supplies.${item}`) }),
          );
        } else if (kind === "tool") {
          void runAction({ kind: "buyTool", tool: item as ToolId, qty }, t("market.boughtTool"));
        }
        return;
      }
      case "buyMushroomSpawn": {
        const mushroom = target.dataset.mushroom as MushroomId | undefined;
        if (mushroom === undefined) return;
        void runAction(
          { kind: "buyMushroomSpawn", mushroom, qty: 1 },
          t("mushroomHouse.boughtSpawn", { qty: 1, name: t(`mushrooms.${mushroom}`) }),
        );
        return;
      }
      case "mushroomTray": {
        const slot = Number(target.dataset.slot);
        if (!Number.isInteger(slot)) return;
        if (mode !== "owner" || state === null) return;
        const tray = (state.mushroomTrays ?? [])[slot] ?? null;
        if (tray === null) {
          mushroomPicker = mushroomPicker === slot ? null : slot;
          mushroomInfo = null;
          render();
          return;
        }
        // Occupied trays open an info panel instead of acting blind.
        mushroomPicker = null;
        mushroomInfo = mushroomInfo === slot ? null : slot;
        render();
        return;
      }
      case "mushroomHarvest": {
        const slot = Number(target.dataset.slot);
        if (!Number.isInteger(slot) || state === null) return;
        const tray = (state.mushroomTrays ?? [])[slot] ?? null;
        if (tray === null) return;
        const definition = mushroomById(tray.mushroom);
        mushroomInfo = null;
        void runAction(
          { kind: "harvestMushroom", slot },
          t("mushroomHouse.harvested", {
            count: definition?.batch ?? 0,
            name: t(`mushrooms.${tray.mushroom}`),
          }),
        );
        return;
      }
      case "mushroomInfoClose":
        mushroomInfo = null;
        render();
        return;
      case "mushroomPlant": {
        const slot = Number(target.dataset.slot);
        const mushroom = target.dataset.mushroom as MushroomId | undefined;
        if (!Number.isInteger(slot) || mushroom === undefined) return;
        mushroomPicker = null;
        mushroomInfo = null;
        void runAction(
          { kind: "plantMushroom", slot, mushroom },
          t("mushroomHouse.planted", { name: t(`mushrooms.${mushroom}`) }),
        );
        return;
      }
      case "mushroomPickerClose":
        mushroomPicker = null;
        render();
        return;
      case "staffSlot": {
        const rect = target?.getBoundingClientRect();
        if (rect === undefined) return;
        const raw = target?.dataset.index;
        const index = raw === undefined || raw === "" ? null : Number(raw);
        openStaffMenu(
          index !== null && Number.isInteger(index) ? index : null,
          rect.left,
          rect.bottom + 2,
          rect.top,
        );
        return;
      }
      case "staffMenuClose":
        closeStaffMenu();
        return;
      case "staffMenuMarket":
        closeStaffMenu();
        switchTab("extras");
        return;
      case "staffMenuHire": {
        const id = target.dataset.id;
        if (id !== undefined) {
          closeStaffMenu();
          void runAction({ kind: "hireStaff", id }, t("staff.hired"));
        }
        return;
      }
      case "staffMenuGardener":
      case "staffMenuWaterer":
      case "buildKitchen":
        void runAction({ kind: "buildKitchen" }, t("kitchen.builtToast"));
        return;
      case "kitchenInfo":
        switchGardenTab("kitchen");
        return;
      case "guildCreate": {
        if (state === null) return;
        const name = guildNameDraft.trim();
        if (name.length < 2) {
          message = { text: t("guild.nameTooShort"), kind: "err" };
          render();
          return;
        }
        void api
          .guildCreate(name, state.nick, state.code)
          .then((result) => {
            guildSnapshot = result.guild;
            guildNameDraft = "";
            message = { text: t("guild.created"), kind: "info" };
          })
          .catch(() => {
            message = { text: t("guild.failed"), kind: "err" };
          })
          .finally(() => void loadGuilds());
        return;
      }
      case "guildJoin": {
        const id = target.dataset.id;
        if (id !== undefined && state !== null) {
          void api
            .guildJoin(id, state.nick, state.code)
            .then((result) => {
              guildSnapshot = result.guild;
              message = { text: t("guild.joined"), kind: "info" };
            })
            .catch(() => {
              message = { text: t("guild.failed"), kind: "err" };
            })
            .finally(() => void loadGuilds());
        }
        return;
      }
      case "guildDonate": {
        const amount = Number(guildDonateDraft);
        if (Number.isInteger(amount) && amount > 0) {
          void api
            .guildDonate(amount)
            .then((result) => {
              guildSnapshot = result.guild;
              message = { text: t("guild.donated"), kind: "info" };
            })
            .catch(() => {
              message = { text: translateError("NOT_ENOUGH_COINS"), kind: "err" };
            })
            .finally(() => void loadGuilds());
        }
        return;
      }
      case "guildLeave":
        void api.guildLeave().then(() => {
          guildSnapshot = null;
          void loadGuilds();
        });
        return;
      case "guildContribute":
        void api
          .guildContribute(1)
          .then((result) => {
            guildSnapshot = result.guild;
            if (state !== null) state = { ...state, coins: result.coins };
            message = { text: t("guild.donated"), kind: "ok" };
          })
          .catch(() => {
            message = { text: translateError("NO_PRODUCT"), kind: "err" };
          })
          .finally(() => void loadGuilds());
        return;
      case "giftCoins": {
        const code = giftCode.trim().toUpperCase();
        const amount = Number(giftAmount);
        if (code.length === 0) {
          message = { text: t("gift.noCode"), kind: "err" };
          render();
          return;
        }
        if (!Number.isInteger(amount) || amount < 1) {
          message = { text: t("gift.badAmount"), kind: "err" };
          render();
          return;
        }
        void runAction(
          { kind: "giftCoins", code, amount },
          t("gift.sentCoins", { amount: formatCompact(amount) }),
        );
        return;
      }
      case "giftSeed":
      case "giftSupply":
      case "giftTool": {
        const code = giftCode.trim().toUpperCase();
        if (code.length === 0) {
          message = { text: t("gift.noCode"), kind: "err" };
          render();
          return;
        }
        const action: GardenAction =
          target.dataset.act === "giftSeed"
            ? { kind: "giftSeed", code, seed: target.dataset.seed as SeedId, qty: 1 }
            : target.dataset.act === "giftSupply"
              ? { kind: "giftSupply", code, supply: target.dataset.supply as SupplyId, qty: 1 }
              : { kind: "giftTool", code, tool: target.dataset.tool as ToolId, qty: 1 };
        void runAction(action, t("gift.sent"));
        return;
      }
      case "staffList": {
        const rect = target.getBoundingClientRect();
        openStaffMenu("list", rect.left + 6, rect.bottom + 2, rect.top);
        return;
      }
      case "staffMenuSelect": {
        const index = Number(target.dataset.index);
        if (!Number.isInteger(index)) return;
        const rect = target.getBoundingClientRect();
        openStaffMenu(index, rect.left + 6, rect.bottom + 2, rect.top);
        return;
      }
      case "staffMenuFire": {
        const index = Number(target.dataset.index);
        if (!Number.isInteger(index)) return;
        closeStaffMenu();
        void runAction({ kind: "fireStaff", index }, t("staff.fired"));
        return;
      }
      case "staffHire": {
        const id = target.dataset.id;
        if (id !== undefined) void runAction({ kind: "hireStaff", id }, t("staff.hired"));
        return;
      }
      case "staffFire": {
        const index = Number(target.dataset.index);
        if (Number.isInteger(index)) void runAction({ kind: "fireStaff", index }, t("staff.fired"));
        return;
      }
      case "staffCell": {
        const index = Number(target.dataset.index);
        if (!Number.isInteger(index)) return;
        staffPanel = staffPanel === index ? null : index;
        render();
        return;
      }
      case "staffPanelClose":
        staffPanel = null;
        render();
        return;
      case "shipSellCrop": {
        const item = target.dataset.item as AnyItemId | undefined;
        const qty = Number(target.dataset.qty);
        if (item === undefined || season === null || !Number.isInteger(qty) || qty < 1) return;
        let effects: EffectId[] = [];
        try {
          const parsed = JSON.parse(target.dataset.effects ?? "[]") as unknown;
          if (Array.isArray(parsed))
            effects = parsed.filter((entry): entry is EffectId => typeof entry === "string");
        } catch {
          effects = [];
        }
        const unit = cropSellPrice(
          {
            item,
            effects,
            pest: target.dataset.pest === "1",
            star: Number(target.dataset.star) || 1,
            qty: 1,
          },
          season,
          activeHybrids(),
        );
        void runAction(
          {
            kind: "sellCrop",
            item,
            effects,
            pest: target.dataset.pest === "1",
            star: Number(target.dataset.star) || 1,
            qty,
          },
          t("shipping.soldCrop", { name: itemName(item), qty, coins: formatCompact(unit * qty) }),
        );
        return;
      }
      case "shipSellAllCrops":
        void runAction({ kind: "sellAll" }, t("shipping.soldAll"));
        return;
      case "shipSellProduct": {
        const product = target.dataset.product as ProductId | undefined;
        const qty = Number(target.dataset.qty);
        if (product === undefined || !Number.isInteger(qty) || qty < 1) return;
        let effects: EffectId[] = [];
        try {
          const parsed = JSON.parse(target.dataset.effects ?? "[]") as unknown;
          if (Array.isArray(parsed))
            effects = parsed.filter((entry): entry is EffectId => typeof entry === "string");
        } catch {
          effects = [];
        }
        const unit =
          season === null
            ? 0
            : productPrice({ product, star: Number(target.dataset.star) || 1, effects, qty: 1 }, season);
        void runAction(
          { kind: "sellProduct", product, star: Number(target.dataset.star) || 1, effects, qty },
          t("shipping.soldProduct", {
            name: t(`products.${product}`),
            qty,
            coins: formatCompact(unit * qty),
          }),
        );
        return;
      }
      case "shipSellAllProducts":
        void runAction({ kind: "sellAllProducts" }, t("shipping.soldAll"));
        return;
      case "staffTask": {
        const index = Number(target.dataset.index);
        const role = target.dataset.role as StaffRole | undefined;
        if (Number.isInteger(index) && role !== undefined) {
          void runAction({ kind: "setStaffRole", index, role }, t("staff.roleSet"));
        }
        return;
      }
      case "extrasInsurance":
        void runAction({ kind: "buyInsurance" }, t("extras.insuranceBought"));
        return;
      case "extrasGreenhouse":
      case "buyGreenhouse":
        void runAction({ kind: "buyGreenhouse" }, t("extras.greenhouseBought"));
        return;
      case "greenhouseNoop":
        return;
      case "greenhousePlot": {
        const slot = Number(target.dataset.slot);
        if (!Number.isInteger(slot)) return;
        if (mode !== "owner") return;
        greenhousePicker = null;
        greenhouseSupplyPicker = null;
        greenhouseMenu = { slot, x: event.clientX, y: event.clientY };
        render();
        return;
      }
      case "greenhouseMenuClose":
        greenhouseMenu = null;
        render();
        return;
      case "greenhousePickerClose":
        greenhousePicker = null;
        render();
        return;
      case "greenhouseSupplyClose":
        greenhouseSupplyPicker = null;
        render();
        return;
      case "greenhouseMenuPlant":
        if (greenhouseMenu !== null) greenhousePicker = greenhouseMenu.slot;
        greenhouseMenu = null;
        greenhouseSupplyPicker = null;
        render();
        return;
      case "greenhouseMenuHarvest":
        if (greenhouseMenu !== null) {
          const slot = greenhouseMenu.slot;
          greenhouseMenu = null;
          void runAction({ kind: "harvestGreenhouse", slot }, t("greenhouse.harvested"));
        }
        return;
      case "greenhouseMenuFertilize":
        if (greenhouseMenu !== null) greenhouseSupplyPicker = greenhouseMenu.slot;
        greenhouseMenu = null;
        greenhousePicker = null;
        render();
        return;
      case "greenhouseMenuUproot":
        if (greenhouseMenu !== null) {
          const slot = greenhouseMenu.slot;
          greenhouseMenu = null;
          void runAction({ kind: "uprootGreenhouse", slot }, t("greenhouse.uprooted"));
        }
        return;
      case "greenhousePlantSeed": {
        const slot = Number(target.dataset.slot);
        const seed = target.dataset.seed as AnySeedId | undefined;
        if (Number.isInteger(slot) && seed !== undefined) {
          greenhousePicker = null;
          void runAction({ kind: "plantGreenhouse", slot, seed }, t("greenhouse.planted"));
        }
        return;
      }
      case "greenhouseBuyAndPlant": {
        const slot = Number(target.dataset.slot);
        const seed = target.dataset.seed as AnySeedId | undefined;
        if (Number.isInteger(slot) && seed !== undefined) {
          void plantGreenhouseSeed(slot, seed);
        }
        return;
      }
      case "greenhouseFertilize": {
        const slot = Number(target.dataset.slot);
        const supply = target.dataset.supply as FertilizerId | undefined;
        if (Number.isInteger(slot) && supply !== undefined) {
          greenhouseSupplyPicker = null;
          void runAction({ kind: "fertilizeGreenhouse", slot, supply }, t("greenhouse.fertilized"));
        }
        return;
      }
      case "plantAllGreenhouse":
        if (greenhouseBulkSeed.length > 0) {
          void runAction(
            { kind: "plantAllGreenhouse", seed: greenhouseBulkSeed as AnySeedId },
            t("greenhouse.plantedAll"),
          );
        }
        return;
      case "harvestAllGreenhouse":
        void runAction({ kind: "harvestAllGreenhouse" }, t("greenhouse.harvestedAll"));
        return;
      case "nurseryAddParent": {
        const item = target.dataset.item as AnyItemId | undefined;
        if (item !== undefined && nurseryParents.length < MAX_BREED_PARENTS) {
          nurseryParents = [...nurseryParents, item];
          render();
        }
        return;
      }
      case "nurseryRemoveParent": {
        const index = Number(target.dataset.index);
        if (Number.isInteger(index) && index >= 0 && index < nurseryParents.length) {
          nurseryParents = nurseryParents.filter((_, idx) => idx !== index);
          render();
        }
        return;
      }
      case "nurseryClearParents":
        nurseryParents = [];
        render();
        return;
      case "breedHybrid":
        if (nurseryParents.length >= MIN_BREED_PARENTS) {
          void runAction({ kind: "breedHybrid", parents: [...nurseryParents] }, t("nursery.bred"));
        }
        return;
      case "nurseryOpenRename": {
        const hybridId = target.dataset.hybridId as HybridId | undefined;
        const hybrid = state?.hybrids?.find((entry) => entry.id === hybridId);
        if (hybrid !== undefined) {
          nurseryPopover = hybrid.id;
          hybridRenameDraft = hybrid.name;
          render();
        }
        return;
      }
      case "renameHybrid": {
        const hybridId = (target.dataset.hybridId as HybridId | undefined) ?? nurseryPopover ?? undefined;
        const name = hybridRenameDraft.trim();
        if (hybridId !== undefined && name.length > 0) {
          void runAction({ kind: "renameHybrid", id: hybridId, name }, t("nursery.renamed", { name }));
        }
        return;
      }
      case "nurseryPopoverClose":
        nurseryPopover = null;
        render();
        return;
      case "nurseryToGreenhouse":
        nurseryPopover = null;
        switchGardenTab("greenhouse");
        return;
      case "extrasHatch":
        void runAction({ kind: "hatchEgg" }, t("extras.hatched"));
        return;
      case "extrasEquip": {
        const pet = target.dataset.pet;
        if (pet !== undefined) void runAction({ kind: "equipPet", pet: pet as never }, t("extras.equipped"));
        return;
      }
      case "craftRelic": {
        const relic = target.dataset.relic as RelicId | undefined;
        if (relic !== undefined) void runAction({ kind: "craftRelic", relic }, t("relics.craft"));
        return;
      }
      case "equipRelic": {
        const relic = target.dataset.relic as RelicId | undefined;
        if (relic !== undefined) void runAction({ kind: "equipRelic", relic }, t("relics.equipped"));
        return;
      }
      case "usePetSkill":
        void runAction({ kind: "usePetSkill" }, t("pet.skillBtn"));
        return;
      case "startPetExpedition": {
        const pet = target.dataset.pet as PetId | undefined;
        const durationMin = target.dataset.min === "30" ? 30 : 15;
        if (pet !== undefined) {
          void runAction({ kind: "startPetExpedition", pet, durationMin }, t("pet.expeditionTitle"));
        }
        return;
      }
      case "claimPetExpedition": {
        const id = target.dataset.id;
        if (id !== undefined) void runAction({ kind: "claimPetExpedition", id }, t("pet.expClaim"));
        return;
      }
      case "stockRefresh":
        void loadStocks(true);
        return;
      case "stockTrade": {
        const side = target.dataset.side === "sell" ? "sell" : "buy";
        const symbol = target.dataset.symbol;
        const shares = Number(target.dataset.shares);
        if (symbol === undefined || !Number.isInteger(shares) || shares < 1 || busy) return;
        busy = true;
        void api
          .tradeStock(side, symbol, shares)
          .then((result) => {
            state = result.state;
            stockQuotes = result.quotes;
            message = {
              text: t(side === "buy" ? "stocks.bought" : "stocks.sold", { shares, symbol }),
              kind: "ok",
            };
          })
          .catch((error) => {
            applyApiError(error);
          })
          .finally(() => {
            busy = false;
            if (!disposed) render();
          });
        return;
      }
      case "extrasWheel":
        void runAction({ kind: "spinWheel" }, t("extras.wheelSpun"));
        return;
      case "extrasCompost":
        void runAction({ kind: "compostCrops" }, t("extras.composted"));
        return;
      case "extrasChain":
        void runAction({ kind: "fulfillChain" }, t("chain.claimed"));
        return;
      case "extrasContract": {
        const id = target.dataset.id;
        if (id !== undefined) void runAction({ kind: "fulfillContract", id }, t("extras.contractDone"));
        return;
      }
      case "extrasMerchant": {
        const id = target.dataset.id;
        if (id !== undefined) void runAction({ kind: "buyMerchant", id }, t("extras.merchantBought"));
        return;
      }
      case "extrasFuture": {
        const item = target.dataset.item as ItemId | undefined;
        if (item !== undefined)
          void runAction({ kind: "lockFuture", item, qty: 1 }, t("extras.futureLocked"));
        return;
      }
      case "extrasSplice": {
        const item = target.dataset.item as ItemId | undefined;
        if (item !== undefined) void runAction({ kind: "spliceCrops", item }, t("extras.spliced"));
        return;
      }
      case "setBuyQty": {
        const qty = Number(target.dataset.qty);
        if (Number.isInteger(qty) && qty >= 1 && qty <= 99) buyQty = qty;
        render();
        return;
      }
      case "buySupply": {
        const supply = target.dataset.supply as SupplyId | undefined;
        if (supply !== undefined) buySupply(supply);
        return;
      }
      case "prevPage":
        goPage(-1);
        return;
      case "nextPage":
        goPage(1);
        return;
      case "buyTab":
        closeMenu();
        void buyTab();
        return;
      case "waterAll": {
        if (state === null) return;
        const count = bulkCounts(now()).water;
        void runAction({ kind: "waterAll" }, t("garden.wateredAll", { count, cost: count * WATER_ALL_COST }));
        return;
      }
      case "harvestAll": {
        if (state === null) return;
        const count = bulkCounts(now()).harvest;
        void runAction(
          { kind: "harvestAll" },
          t("garden.harvestedAll", { count, cost: count * HARVEST_ALL_COST }),
        );
        return;
      }
      case "waterFriend": {
        if (selectedSlot !== null) void waterFriend(selectedSlot, selectedArea);
        closeMenu();
        return;
      }
      case "cheer":
        void cheerHost();
        closeMenu();
        return;
      case "buyTree": {
        const tree = target.dataset.tree as TreeId | undefined;
        if (tree === undefined) return;
        const start = treeOffset();
        let slot: number | null = null;
        for (let index = 0; index < TREES_PER_TAB; index += 1) {
          if (treeAt(start + index) === null) {
            slot = start + index;
            break;
          }
        }
        if (slot === null) {
          message = { text: t("garden.noTreeSlot"), kind: "err" };
          render();
          return;
        }
        void runAction({ kind: "buyTree", tree, slot }, t("market.treeBought"));
        return;
      }
      case "buy": {
        const seedId = target.dataset.seed as SeedId | undefined;
        if (seedId !== undefined) buySeed(seedId);
        return;
      }
      case "sell": {
        const item = target.dataset.item as AnyItemId | undefined;
        if (item === undefined) return;
        let effects: EffectId[] = [];
        try {
          const parsed = JSON.parse(target.dataset.effects ?? "[]") as unknown;
          if (Array.isArray(parsed))
            effects = parsed.filter((entry): entry is EffectId => typeof entry === "string");
        } catch {
          effects = [];
        }
        const star = Number(target.dataset.star ?? 1);
        sellStack(item, effects, target.dataset.pest === "1", Number.isInteger(star) ? star : 1);
        return;
      }
      case "sellAll":
        sellAll();
        return;
      case "sellAllConfirm":
        confirmSellAll();
        return;
      case "sellAllCancel":
        sellAllDialog = null;
        render();
        return;
      case "restore":
        void restoreGarden();
        return;
      case "accountRegister":
        void submitAccountRegister();
        return;
      case "accountLogin":
        void submitAccountLogin();
        return;
      case "accountLink":
        void submitAccountLink();
        return;
      case "accountLogout":
        logoutAccountLocal();
        return;
      case "rotate":
        void rotateRecovery();
        return;
      case "rankVisit": {
        const code = target.dataset.code;
        if (code !== undefined && code !== state?.code) openVisit(code);
        return;
      }
      case "visit": {
        const code = target.dataset.code;
        if (code !== undefined) openVisit(code);
        return;
      }
      default:
        return;
    }
  }

  /** @brief Keyboard routing: plot digits, tab letters and action letters. */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (moveSource !== null) {
        moveSource = null;
        message = null;
        render();
        return;
      }
      if (tool !== null || toolPicker !== null) {
        tool = null;
        toolPicker = null;
        render();
        return;
      }
      if (machineMenu !== null) {
        closeMachineMenu();
        return;
      }
      if (staffMenu !== null) {
        closeStaffMenu();
        return;
      }
      if (sellAllDialog !== null) {
        sellAllDialog = null;
        render();
        return;
      }
      if (specialMenu !== null) {
        specialMenu = null;
        render();
        return;
      }
      if (greenhouseMenu !== null) {
        greenhouseMenu = null;
        render();
        return;
      }
      if (nurseryPopover !== null) {
        nurseryPopover = null;
        render();
        return;
      }
      if (menu !== null) closeMenu();
      else {
        selectedSlot = null;
        uprootArmed = false;
        render();
      }
      return;
    }
    if (event.key === "g" || event.key === "G") {
      switchTab("garden");
      return;
    }
    if (event.key === "m" || event.key === "M") {
      switchTab("market");
      return;
    }
    if (event.key === "e" || event.key === "E") {
      switchTab("event");
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "[") {
      event.preventDefault();
      goPage(-1);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "]") {
      event.preventDefault();
      goPage(1);
      return;
    }
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= PLOTS_PER_PATCH) {
      event.preventDefault();
      selectSlot(cropOffset() + (digit - 1) * PLOTS_PER_PATCH, "crop");
      return;
    }
    if (selectedSlot === null) return;
    if (event.key === "h" || event.key === "H") {
      if (mode === "owner") harvest(selectedSlot, selectedArea);
      closeMenu();
    } else if (event.key === "w" || event.key === "W") {
      if (mode === "owner") waterSelected(selectedSlot, selectedArea);
      else void waterFriend(selectedSlot, selectedArea);
    } else if (event.key === "f" || event.key === "F") {
      if (mode === "owner") {
        supplyPicker = "fertilize";
        render();
      }
    } else if (event.key === "x" || event.key === "X") {
      if (mode === "owner") {
        supplyPicker = "spray";
        render();
      }
    } else if (event.key === "u" || event.key === "U") {
      if (mode === "owner") {
        const armed = uprootArmed;
        uproot(selectedSlot, selectedArea);
        if (armed) closeMenu();
      }
    }
  }

  /** @brief Catches the restore input while it is typed. */
  function onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.role === "restore") restoreDraft = target.value;
    if (target.dataset.role === "accountUser") accountUserDraft = target.value;
    if (target.dataset.role === "accountPass") accountPassDraft = target.value;
    if (target.dataset.role === "accountRecovery") accountRecoveryDraft = target.value;
    if (target.dataset.role === "uprootPrice") uprootPriceDraft = target.value;
    if (target.dataset.role === "machineLimit") machineLimitDraft = target.value;
    if (target.dataset.role === "guildDonate") {
      guildDonateDraft = target.value;
      return;
    }
    if (target.dataset.role === "guildName") {
      guildNameDraft = target.value;
      return;
    }
    if (target.dataset.role === "recipeInput") {
      const index = Number(target.dataset.index);
      if (Number.isInteger(index) && index >= 0 && index < recipeInputs.length) {
        recipeInputs[index] = target.value;
      }
      return;
    }
    if (target.dataset.role === "dynopediaSearch") {
      dynopediaQuery = target.value;
      const query = dynopediaQuery.trim();
      const queryLower = query.toLowerCase();
      const queryFolded = foldDiacritics(query);
      let visibleCount = 0;
      for (const row of root?.querySelectorAll<HTMLElement>(".garden-dynopedia-row") ?? []) {
        const text = row.dataset.search ?? row.textContent ?? "";
        const matchesQuery =
          query.length === 0 ||
          text.toLowerCase().includes(queryLower) ||
          foldDiacritics(text).includes(queryFolded);
        const matchesFilter =
          dynopediaFilter === "all" ||
          (dynopediaFilter === "known" && row.dataset.status === "known") ||
          (dynopediaFilter === "unknown" && row.dataset.status === "unknown");
        const isVisible = matchesQuery && matchesFilter;
        row.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      }
      const emptyNotice = root?.querySelector<HTMLElement>(".garden-dynopedia-empty");
      if (emptyNotice) {
        emptyNotice.hidden = visibleCount > 0;
      }
    }
    if (target.dataset.role === "kitchenSearch") {
      kitchenQuery = target.value;
      const query = kitchenQuery.trim();
      const queryLower = query.toLowerCase();
      const queryFolded = foldDiacritics(query);
      let visibleCount = 0;
      for (const card of root?.querySelectorAll<HTMLElement>(".garden-kitchen-card") ?? []) {
        const text = card.dataset.search ?? card.textContent ?? "";
        const matchQuery =
          query.length === 0 ||
          text.toLowerCase().includes(queryLower) ||
          foldDiacritics(text).includes(queryFolded);
        const matchStatus = card.dataset.matchStatus !== "false";
        const matchIng = card.dataset.matchIng !== "false";
        const isVisible = matchQuery && matchStatus && matchIng;
        card.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      }
      const emptyNotice = root?.querySelector<HTMLElement>(".garden-kitchen-empty-filter");
      if (emptyNotice) {
        emptyNotice.hidden = visibleCount > 0;
      }
    }
    if (target.dataset.role === "logSearch") {
      logQuery = target.value;
      const query = logQuery.trim();
      const queryLower = query.toLowerCase();
      const queryFolded = foldDiacritics(query);
      let visibleCount = 0;
      for (const row of root?.querySelectorAll<HTMLElement>(".garden-reborn-log-row") ?? []) {
        const text = row.dataset.search ?? row.textContent ?? "";
        const matchesQuery =
          query.length === 0 ||
          text.toLowerCase().includes(queryLower) ||
          foldDiacritics(text).includes(queryFolded);
        const matchesFilter = logFilter === "all" || row.dataset.type === logFilter;
        const isVisible = matchesQuery && matchesFilter;
        row.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      }
      const emptyNotice = root?.querySelector<HTMLElement>(".garden-reborn-log-empty");
      if (emptyNotice) {
        emptyNotice.hidden = visibleCount > 0;
      }
    }
    if (target.dataset.role === "giftCode") giftCode = target.value;
    if (target.dataset.role === "giftAmount") giftAmount = target.value;
    if (target.dataset.role === "hybridRename") {
      hybridRenameDraft = target.value;
      const saveBtn = root?.querySelector<HTMLButtonElement>(
        '.garden-nursery-popover button[data-act="renameHybrid"]',
      );
      if (saveBtn) saveBtn.disabled = hybridRenameDraft.trim().length < 1;
    }
  }

  /**
   * @brief Handles change events for form controls such as select dropdowns.
   * @param event Native browser change event.
   */
  function onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.role === "kitchenIngredientSelect" && target instanceof HTMLSelectElement) {
      kitchenIngredientFilter = target.value;
      render();
      return;
    }
    if (target.dataset.role === "greenhouseBulkSeed" && target instanceof HTMLSelectElement) {
      greenhouseBulkSeed = target.value;
      render();
    }
  }

  /** @brief Closes the context menu when the pointer lands outside it. */
  function onPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (sellAllDialog !== null && target.closest(".garden-sell-all-dialog") === null) {
      sellAllDialog = null;
      render();
    }
    if (
      specialMenu !== null &&
      target.closest(".garden-menu") === null &&
      target.closest(".garden-special-cell") === null &&
      target.closest(".garden-reborn-cell") === null
    ) {
      specialMenu = null;
      render();
    }
    if (
      greenhouseMenu !== null &&
      target.closest(".garden-menu") === null &&
      target.closest(".garden-greenhouse-cell") === null
    ) {
      greenhouseMenu = null;
      render();
    }
    if (menu === null) return;
    if (target.closest(".garden-menu") !== null || target.closest(".garden-cell") !== null) return;
    closeMenu();
  }

  /** @brief Refreshes when the tab becomes visible again. */
  function onVisibility(): void {
    if (typeof document !== "undefined" && !document.hidden) void refresh();
  }

  // ------------------------------------------------------------ life cycle

  /** @brief Mounts the document into the stage host. */
  function mount(target: HTMLElement, context?: GameContext): void {
    unmount();
    disposed = false;
    host = target;
    localIdentity = loadIdentity(identityStorage());
    visitCode = context?.gardenCode ?? null;
    mode = visitCode === null ? "owner" : "visit";
    tab = "garden";
    selectedSlot = null;
    message = null;
    leaderboard = [];
    restoreDraft = "";
    loading = true;
    offline = false;
    busy = false;
    uprootArmed = false;

    root = div("garden-root");
    target.replaceChildren(root);
    target.tabIndex = 0;
    target.setAttribute("aria-label", "ASCII Garden");
    target.focus();

    listen(root, "click", (event) => onClick(event as MouseEvent));
    listen(root, "input", onInput);
    listen(root, "change", onChange);
    listen(target, "keydown", (event) => onKeyDown(event as KeyboardEvent));
    listen(document, "visibilitychange", onVisibility);
    listen(document, "pointerdown", (event) => onPointerDown(event as PointerEvent));
    listen(window, "dyno:nick", () => {
      localIdentity = loadIdentity(identityStorage());
      void syncProfile();
    });
    disposeLocale = onLocaleChange(() => render());

    tickTimer = setInterval(refreshTimers, TICK_MS);
    pollTimer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) {
        void refresh();
        if (tab === "chart") void loadChart();
        if (tab === "bots") void loadBots();
        if (tab === "rank") void loadLeaderboard();
        if (tab === "extras") void loadExtras();
        if (view === "reborn" && (rebornTab === "event" || rebornTab === "weather")) {
          void loadRaid();
        }
      }
    }, POLL_MS);

    void bootstrap();
  }

  /** @brief Releases timers, listeners and the rendered DOM. */
  function unmount(): void {
    disposed = true;
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (uprootTimer !== null) {
      clearTimeout(uprootTimer);
      uprootTimer = null;
    }
    if (disposeLocale !== null) {
      disposeLocale();
      disposeLocale = null;
    }
    music.dispose();
    if (host !== null) {
      host.replaceChildren();
      host.removeAttribute("tabindex");
      host.removeAttribute("aria-label");
    }
    host = null;
    root = null;
    detailPre = null;
    state = null;
    visiting = null;
    season = null;
    leaderboard = [];
  }

  return { mount, unmount };
}
