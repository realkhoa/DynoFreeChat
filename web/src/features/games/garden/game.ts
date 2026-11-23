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
  INSURANCE_PRICE,
  PETS,
  PET_MAX_LEVEL,
  STAFF_SLOTS,
  STAFF_ROLES,
  type StaffRole,
  staffHireCost,
  staffXpToLevel,
  staffMarketAt,
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
  prestigeGrowScale,
  weeklyModifier,
  weekEndsAt,
  prestigeRequirement,
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
  type RaidSnapshot,
  type GlobalSaleEntry,
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
  onLocaleChange,
  t,
  tList,
  translateError,
} from "@/shared/i18n";
import { loadIdentity, type Identity } from "@/shared/lib/identity";
import type { GardenBot } from "@/features/games/garden/api";
import { readParam, writeParams } from "@/shared/lib/urlstate";
import type { GameContext, GameMount } from "../mount";
import { animalCellRender, cellRender, fitText, growthColor, labelValue, treeCellRender } from "./ascii";
import { GardenApi, GardenApiError } from "./api";
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
type RebornTab = "garden" | "townhall";

/** @brief Tabs of the rebuilt view, in strip order. */
const REBORN_TABS: readonly { readonly id: RebornTab; readonly labelKey: string }[] = [
  { id: "garden", labelKey: "reborn.tabGarden" },
  { id: "townhall", labelKey: "reborn.tabTownhall" },
];

/** One tab inside the garden tab of the rebuilt view. */
type GardenTab = "main" | "mushroom" | "greenhouse" | "nursery";

/** @brief Garden tabs, in strip order; only `main` is rebuilt so far. */
const GARDEN_TABS: readonly { readonly id: GardenTab; readonly labelKey: string }[] = [
  { id: "main", labelKey: "gardenTab.main" },
  { id: "mushroom", labelKey: "gardenTab.mushroom" },
  { id: "greenhouse", labelKey: "gardenTab.greenhouse" },
  { id: "nursery", labelKey: "gardenTab.nursery" },
];

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
  /** Which townhall NPC has its shop open, if any. */
  let townNpc: string | null = null;
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
  let farmPicker: { building: BuildingId; slot: number } | null = null;
  let animalMenu: { building: BuildingId; slot: number; x: number; y: number; anchorTop: number } | null =
    null;
  /** Source cell of a pending shovel move, cleared on cancel or completion. */
  let moveSource: { slot: number; area: "crop" | "tree" } | null = null;
  let machineMenu: { id: MachineId; x: number; y: number; anchorTop: number } | null = null;
  let specialPicker: number | null = null;
  let specialMenu: { slot: number; x: number; y: number } | null = null;
  let machineQty = 1;
  let chartSort: "roi" | "income" | "pressure" = "roi";
  let raidSnapshot: RaidSnapshot | null = null;
  let guildSnapshot: GuildSnapshot | null = null;
  let guildBoard: Array<{ id: string; name: string; ownerId: string; members: number }> = [];
  let guildNameDraft = "";
  let guildDonateDraft = "1000000";
  let globalSales: GlobalSaleEntry[] = [];
  let globalSalesStatus: "idle" | "loading" | "error" = "idle";
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
  let dynopediaQuery = "";
  let machineLimitDraft = "";
  let specialSupplyPicker: { kind: "fertilize" | "spray"; slot: number } | null = null;
  let bulkPanel: "plan" | "uproot" | null = null;
  let confirmPrestige = false;
  let sellAllDialog: { gross: number; net: number; stacks: number; qty: number } | null = null;
  let uprootPending: { seed?: SeedId; tree?: TreeId; priceBelow?: number; profit?: "loss" | "win" } | null =
    null;
  let uprootPriceDraft = "";
  let giftCode = "";
  let giftAmount = "1000";
  let buyQty = 1;
  type GardenTool =
    | { kind: "fertilize" | "spray"; supply: SupplyId }
    | { kind: "plant"; seed: SeedId }
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

  /** @brief Localized short seed name. */
  function seedName(id: SeedId): string {
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

  /** @brief Localized full name of any bag item. */
  function itemName(id: ItemId): string {
    return seedById(id) === undefined ? t(`trees.${id}`) : t(`seeds.${id}`);
  }

  /** @brief Minimum prestige tier needed to plant a seed. */
  function seedPrestigeTier(id: SeedId): number {
    return PRESTIGE_SHOP.find((offer) => offer.seed === id)?.tier ?? 0;
  }

  /** @brief Whether the current account is below a seed's prestige tier. */
  function seedLocked(id: SeedId): boolean {
    const level = state?.extras.prestige ?? 0;
    return seedPrestigeTier(id) > level;
  }

  /** @brief Display name for a crop, fruit or product id. */
  function materialName(id: string): string {
    if (seedById(id) !== undefined || treeById(id) !== undefined) return itemName(id as ItemId);
    return t(`products.${id}`);
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
        const bundle = await api.visit(visitCode);
        visiting = bundle.garden;
        season = bundle.season;
        state = null;
      } else {
        mode = "owner";
        visiting = null;
        await loadOwner();
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
    if (!disposed && (tab === "event" || tab === "rank")) render();
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
      message = { text: successText, kind: "ok" };
    } catch (error) {
      applyApiError(error);
    }
    busy = false;
    if (!disposed) render();
  }

  /** @brief Plants one seed, buying it first when the bag is empty. */
  async function plantSeed(slot: number, seedId: SeedId): Promise<void> {
    if (state === null || busy) return;
    busy = true;
    try {
      let current = state;
      const owned = current.bag.seeds[seedId] ?? 0;
      if (owned < 1) {
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
    const view = plotView(plot, now());
    if (!view.ready) {
      message = { text: translateError("NOT_READY"), kind: "err" };
      render();
      return;
    }
    const gain = cropSellPrice(
      { item: plot.seed, effects: resolvedCropEffects(plot, now()), qty: 1 },
      season,
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
  function sellStack(item: ItemId, effects: readonly EffectId[], pest = false, star = 1): void {
    if (state === null || season === null) return;
    const stack = state.bag.crops.find(
      (entry) =>
        entry.item === item &&
        sameEffectSet(entry.effects, effects) &&
        (entry.pest === true) === pest &&
        (entry.star ?? 1) === star,
    );
    if (stack === undefined) return;
    const gross = cropSellPrice(stack, season) * stack.qty;
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
      (sum, stack) => sum + cropSellPrice(stack, season as SeasonSnapshot) * stack.qty,
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
    if (next !== "reborn") {
      townNpc = null;
      staffPanel = null;
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
    if (next === "dynopedia") void loadGlobalRecipes();
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
      grtab: view === "reborn" && rebornTab === "townhall" ? "townhall" : null,
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
    if (readParam("grtab") === "townhall") rebornTab = "townhall";
    const savedGardenTab = readParam("gstab");
    if (savedGardenTab === "mushroom" || savedGardenTab === "greenhouse" || savedGardenTab === "nursery") {
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
            `${entry.name} · ${t("staff.level")} ${entry.level} · ${t(`staffRole.${entry.role}`)} · ${t("staff.jobs", { count: entry.jobs })}`,
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
          `${candidate.name} · ${candidate.speed}⚡ · ${t("staff.jobs", { count: candidate.jobs })} · ${candidate.wage}c · ${traits} · ${formatCompact(staffHireCost(candidate))}c`,
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
          `// ${t("staff.level")} ${worker.level} · ${worker.xp}/${staffXpToLevel(worker.level)} XP · ${t("staff.jobs", { count: worker.jobs })}`,
        ),
      );
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
    head.append(
      span(
        "garden-menu-title",
        `${t(`animals.${animal.kind}`)} · ${t(`farm.${animalMenu.building}`)} · ${t("farm.slots")} ${animalMenu.slot + 1}`,
      ),
    );
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
    const meat = animalMeatPrice(animal.kind, stars, state.pondGrowth ?? 0);
    const lines = [
      `// ${t("farm.stats")}`,
      labelValue(t("farm.quality"), `${"*".repeat(stars)} ${stars}/5`),
      labelValue(t("farm.mutations"), effectListText(animal.effects ?? [])),
      labelValue(
        t("farm.pats"),
        `${animal.pats} · ${t("farm.age")} ${formatDuration(Math.max(0, at - animal.bornAt))}`,
      ),
    ];
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
    bar.append(stealthButton);
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
      if (plot === null) continue;
      if (at >= plot.readyAt) harvest += 1;
      else if (!plot.watered) water += 1;
    }
    for (const tree of trees) {
      if (tree === null) continue;
      if (at >= tree.readyAt) harvest += 1;
      else if (!tree.watered) water += 1;
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
        : cellRender(plot, at, lockedCost, local % PLOTS_PER_PATCH);
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
    cell.style.color = render.growing ? growthColor(render.progress) : "";
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
      const button = actionButton(
        `[ ${worker.name} · ${t("staff.level")} ${worker.level} · ${t("staff.jobs", { count: worker.jobs })} ]`,
        "staffSlot",
      );
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
      const view = plotView(plot, at);
      const definition = seedById(plot.seed);
      lines.push(labelValue(t("garden.crop"), t(`seeds.${plot.seed}`)));
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
      lines.push(
        labelValue(t("garden.readyIn"), view.ready ? t("garden.ready") : formatDuration(view.remainingMs)),
      );
      if (season !== null) {
        lines.push(
          labelValue(
            t("garden.finalSell"),
            `${formatCompact(cropSellPrice({ item: plot.seed, effects: resolvedCropEffects(plot, at), qty: 1 }, season))}c`,
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
    const ownedSeeds = SEEDS.filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0);
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
      // Still under pesticide cover: no re-spray row until it lapses.
      if (plant.protectedUntil <= at) {
        rows.append(menuRow(t("garden.sprayPest", { cost: PEST_SPRAY_COST }), "sprayPest"));
      }
      rows.append(menuRow(t("garden.harvest"), "harvest", { disabled: !ready || favorite }));
      rows.append(menuRow(t("garden.water"), "water", { disabled: ready || plant.watered }));
      rows.append(menuRow(t("garden.menuFertilize"), "menuViewFertilize", { disabled: ready }));
      rows.append(menuRow(t("garden.menuSpray"), "menuViewSpray"));
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
    if (view === null) return side;

    side.append(span("garden-side-title", `// ${t("side.bag")}`));
    const seeds = Object.values(view.bag.seeds).reduce((sum, qty) => sum + (qty ?? 0), 0);
    const seedKinds = Object.values(view.bag.seeds).filter((qty) => (qty ?? 0) > 0).length;
    const seedRow = sideRow(
      "🌱",
      t("side.seeds"),
      `${formatCompact(seeds)} · ${seedKinds} ${t("side.kinds")}`,
    );
    seedRow.title = Object.entries(view.bag.seeds)
      .filter(([, qty]) => (qty ?? 0) > 0)
      .map(([id, qty]) => `${t(`seeds.${id}.short`)} ×${qty}`)
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
    if (view === null) return null;
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
    const seedKinds = SEEDS.filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0).length;
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
          note: seedKinds > 0 ? String(seedKinds) : "",
          tone: "plant",
          act: "pickPlantTool",
          disabled: seedKinds === 0,
          active: toolPicker === "plant" || tool?.kind === "plant",
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
    const render = cellRender(plot, at, null, slot % SPECIAL_PLOTS_PER_PATCH);
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
        const value = cropSellPrice(
          { item: plot.seed, effects: resolvedCropEffects(plot, at), pest: plot.pest, star: 1, qty: 1 },
          season,
        );
        if (!matches(value, seedById(plot.seed)?.buy ?? 0)) continue;
        add(seedName(plot.seed));
      }
    }

    if (filter.seed === undefined) {
      for (const tree of state.trees) {
        if (tree === null || tree.favorite === true) continue;
        if (filter.tree !== undefined && tree.tree !== filter.tree) continue;
        const value = cropSellPrice(
          { item: tree.tree, effects: resolvedTreeEffects(tree, at), pest: tree.pest, star: 1, qty: 1 },
          season,
        );
        if (!matches(value, treeById(tree.tree)?.buy ?? 0)) continue;
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
      const ownedSeeds = SEEDS.filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0);
      if (ownedSeeds.length === 0) picker.append(span("garden-hint", t("garden.plantNoSeeds")));
      for (const seed of ownedSeeds) {
        const locked = seedLocked(seed.id);
        const button = actionButton(
          `${t(`seeds.${seed.id}`)} (${state?.bag.seeds[seed.id] ?? 0})${locked ? ` · P${seedPrestigeTier(seed.id)}` : ""}`,
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
    const planted = new Map<SeedId, number>();
    for (const plot of state?.plots ?? []) {
      if (plot === null) continue;
      planted.set(plot.seed, (planted.get(plot.seed) ?? 0) + 1);
    }
    for (const [seed, count] of planted) {
      const button = actionButton(`${t("auto.byPlant", { seed: seedName(seed) })} ×${count}`, "uprootSeed");
      button.dataset.seed = seed;
      panel.append(button);
    }
    const plantedTrees = new Map<TreeId, number>();
    for (const tree of state?.trees ?? []) {
      if (tree === null) continue;
      plantedTrees.set(tree.tree, (plantedTrees.get(tree.tree) ?? 0) + 1);
    }
    for (const [tree, count] of plantedTrees) {
      const button = actionButton(`${t("auto.byPlant", { seed: treeName(tree) })} ×${count}`, "uprootTree");
      button.dataset.tree = tree;
      panel.append(button);
    }
    panel.append(actionButton(t("auto.loss"), "uprootLoss"), actionButton(t("auto.win"), "uprootWin"));
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
    cell.title = [
      `${t(`animals.${animal.kind}`)} · ${t("farm.quality")} ${render.stars}/5`,
      `${t("farm.pats")} ${animal.pats}`,
      tail,
    ].join(" · ");
    cell.setAttribute(
      "aria-label",
      `${t(`farm.${building}`)} · ${t("farm.slots")} ${slot + 1}: ${t(`animals.${animal.kind}`)}`,
    );
  }

  /** @brief Builds the animal shop rows for one empty slot. */
  function buildAnimalPicker(building: BuildingId, slot: number): HTMLElement {
    const wrap = div("garden-seeds");
    wrap.append(span("garden-hint", t("farm.pickAnimal", { slot: slot + 1 })));
    for (const animal of ANIMALS.filter((entry) => entry.building === building)) {
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
      const upgradeCost = buildingUpgradeCost(building);
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
      const grid = div("garden-animal-grid");
      for (let slot = 0; slot < animals.length; slot += 1) grid.append(animalCell(building, slot));
      panel.append(grid);
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
      const items = (state.bag.crops ?? [])
        .filter(
          (stack) => seedById(stack.item) !== undefined || (allowFruit && treeById(stack.item) !== undefined),
        )
        .filter((stack) => allowed === undefined || allowed.includes(stack.item as SeedId))
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
          : cropSellPrice({ item: plot.seed, effects, pest: plot.pest, star, qty: 1 }, season);
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
      const value = cropSellPrice(stack, season) * stack.qty;
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
        (sum, stack) => sum + cropSellPrice(stack, currentSeason) * stack.qty,
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
    if (state === null) return lineBlock(t("common.loading"));
    const extras = state.extras;
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
    if (state.stats.earned >= prestigeNeed) {
      control.append(
        actionButton(
          confirmPrestige
            ? t("prestige.confirm", { level: prestigeLevel + 1 })
            : t("prestige.ready", { level: prestigeLevel + 1 }),
          "prestige",
        ),
      );
    } else {
      control.append(
        lineBlock(
          t("prestige.progress", {
            earned: formatCompact(state.stats.earned),
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
        skillPoints > 0,
      );
      button.dataset.skill = skill;
      skillPanel.append(button);
    }
    const spentPoints = Object.values(extras.prestigeSkills ?? {}).reduce((sum, points) => sum + points, 0);
    if (prestigeLevel > 0 && spentPoints > 0) {
      skillPanel.append(
        actionButton(t("prestige.respec"), "respecPrestige", (extras.prestigeCoins ?? 0) >= 1),
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
        card.disabled = locked || (state?.coins ?? 0) < offer.price;
        card.title = `${seedName(offer.seed)} · ${formatCompact(offer.price)}c · P${offer.tier}`;
        card.append(
          span("garden-buy-line is-name", seedName(offer.seed)),
          span("garden-buy-line", `P${offer.tier}`),
          span("garden-buy-line is-price", `${formatCompact(offer.price)}c`),
          span(
            "garden-buy-line is-stock",
            locked
              ? t("prestige.tierLocked", { tier: offer.tier })
              : `${t("garden.bag")} ${state?.bag.seeds[offer.seed] ?? 0}`,
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
      card.disabled = !finalUnlocked || prestigeCoins < offer.coins;
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

  /** @brief Loads the public AI-discovered recipe list. */
  async function loadGlobalRecipes(): Promise<void> {
    try {
      globalRecipes = (await api.globalRecipes()).recipes;
      render();
    } catch {
      // The list stays empty while offline.
    }
  }

  /** @brief Builds the Dynopedia wiki tab: catalogs and search. */
  function buildDynopedia(): HTMLElement {
    const wrap = div("garden-dynopedia garden-market");
    wrap.append(lineBlock(`// ${t("dynopedia.title")}`));
    const discovered = state?.collection?.length ?? 0;
    wrap.append(
      lineBlock(
        t("dynopedia.discovered", { count: discovered, coins: formatCompact(state?.codexUnclaimed ?? 0) }),
      ),
    );
    if ((state?.codexUnclaimed ?? 0) > 0) {
      wrap.append(actionButton(t("dynopedia.claim"), "claimCodex"));
    }
    const search = document.createElement("input");
    search.type = "search";
    search.className = "stage-input garden-dynopedia-search";
    search.placeholder = t("dynopedia.search");
    search.value = dynopediaQuery;
    search.dataset.role = "dynopediaSearch";
    search.setAttribute("aria-label", t("dynopedia.search"));
    wrap.append(search);

    const lab = div("garden-market-panel");
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
    lab.append(ingredientList);
    lab.append(lineBlock(`// ${t("recipe.title")}`));
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
    lab.append(recipeRow, actionButton(t("recipe.suggest"), "recipeSuggest"));
    if (recipeResult.length > 0) lab.append(lineBlock(recipeResult));
    for (const recipe of state?.extras.recipes ?? []) {
      const row = div("garden-machine-row");
      row.append(
        lineBlock(
          `${t("recipe.saved")}: ${recipe.inputs.join(" + ")} → ${recipe.output} · ${formatCompact(recipe.price)}c`,
        ),
      );
      const canCook = state?.extras.kitchen === true;
      const cook = actionButton(t("recipe.cook"), "cookRecipe", canCook);
      if (!canCook) lab.append(lineBlock(t("kitchen.required")));
      cook.dataset.id = recipe.id;
      row.append(cook);
      lab.append(row);
    }
    if (globalRecipes.length > 0) {
      lab.append(lineBlock(`// ${t("recipe.global")}`));
      for (const recipe of globalRecipes) {
        const row = div("garden-machine-row");
        row.append(
          lineBlock(`${recipe.inputs.join(" + ")} → ${recipe.output} · ${formatCompact(recipe.price)}c`),
        );
        const learn = actionButton(t("recipe.learn"), "recipeLearn");
        learn.dataset.id = recipe.id;
        row.append(learn);
        lab.append(row);
      }
    }
    wrap.append(lab);

    const categories = [
      "effects",
      "seeds",
      "trees",
      "animals",
      "products",
      "machines",
      "supplies",
      "tools",
      "buildings",
      "attachments",
      "events",
      "pets",
    ] as const;
    const bar = div("garden-tools");
    for (const category of categories) {
      const button = actionButton(t(`dynopedia.cat.${category}`), "dynopediaCategory");
      button.dataset.category = category;
      if (dynopediaCategory === category) button.classList.add("is-active");
      bar.append(button);
    }
    wrap.append(bar);

    const rows: Array<{ id: string; title: string; detail: string }> = [];
    if (dynopediaCategory === "effects") {
      for (const effect of EFFECTS) {
        rows.push({
          id: effect.id,
          title: t(`effects.${effect.id}`),
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
        rows.push({
          id: seed.id,
          title: t(`seeds.${seed.id}`),
          detail: `${formatDuration(seed.growMs)} · ${formatCompact(seed.buy)}c → ${formatCompact(seed.sell)}c · ${tags.join(" · ")}`,
        });
      }
    } else if (dynopediaCategory === "trees") {
      for (const tree of TREES) {
        rows.push({
          id: tree.id,
          title: t(`trees.${tree.id}`),
          detail: `${formatDuration(tree.growMs)} · ${formatCompact(tree.buy)}c → ${formatCompact(tree.sell)}c`,
        });
      }
    } else if (dynopediaCategory === "animals") {
      for (const animal of ANIMALS) {
        rows.push({
          id: animal.id,
          title: t(`animals.${animal.id}`),
          detail: `${t(`farm.${animal.building}`)} · ${formatCompact(animal.buy)}c · ${formatDuration(animalIntervalMs(animal.id))} · ${t(`products.${animal.product}`)}`,
        });
      }
    } else if (dynopediaCategory === "products") {
      for (const product of PRODUCTS) {
        rows.push({
          id: product.id,
          title: t(`products.${product.id}`),
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
        rows.push({
          id: machine.id,
          title: t(`machines.${machine.id}`),
          detail: `${input} → ${output}${recipes.length > 0 ? ` · ${recipes}` : ""} · ${machine.cooldownCycles} ${t("dynopedia.cycles")}${machine.queued === true ? ` · ${t("dynopedia.timed")}` : ""}`,
        });
      }
    } else if (dynopediaCategory === "supplies") {
      for (const fertilizer of FERTILIZERS) {
        rows.push({
          id: fertilizer.id,
          title: t(`supplies.${fertilizer.id}`),
          detail: `x${fertilizer.growMultiplier} · ${fertilizer.harvests} ${t("dynopedia.harvests")} · ${formatCompact(fertilizer.price)}c`,
        });
      }
      for (const spray of SPRAYS) {
        rows.push({
          id: spray.id,
          title: t(`supplies.${spray.id}`),
          detail: `${spray.effects.map((id) => t(`effects.${id}`)).join(", ")} · x${SPRAY_MUTATION_BOOST} · ${formatCompact(spray.price)}c`,
        });
      }
    } else if (dynopediaCategory === "tools") {
      for (const tool of TOOLS) {
        rows.push({
          id: tool.id,
          title: t(`tools.${tool.id}`),
          detail: `${formatCompact(tool.price)}c`,
        });
      }
    } else if (dynopediaCategory === "buildings") {
      for (const building of BUILDINGS) {
        rows.push({
          id: building.id,
          title: t(`farm.${building.id}`),
          detail: `${formatCompact(building.price)}c · ${building.slots.join("/")} ${t("dynopedia.slots")} · ${formatCompact(building.upgrade)}c/${t("farm.level")}`,
        });
      }
    } else if (dynopediaCategory === "attachments") {
      for (const attachment of ATTACHMENTS) {
        rows.push({
          id: attachment.id,
          title: t(`attachments.${attachment.id}`),
          detail: `${t(`farm.${attachment.slot}`)} · ${formatCompact(attachment.price)}c · ${t(`dynopedia.attach.${attachment.id}`)}`,
        });
      }
    } else if (dynopediaCategory === "events") {
      for (const event of EVENTS) {
        rows.push({
          id: event.id,
          title: t(`events.${event.id}`),
          detail: `${t(`events.${event.id}.desc`)} · grow x${event.growScale} · sell x${event.sellBonus}`,
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
        rows.push({
          id: pet.id,
          title: t(`pets.${pet.id}`),
          detail: `${t(`petRarity.${pet.rarity}`)} · ${bonuses.join(" · ")}`,
        });
      }
    }

    const query = dynopediaQuery.trim().toLowerCase();
    const list = div("garden-dynopedia-list");
    let shown = 0;
    const codexKey = (id: string): string | null => {
      if (dynopediaCategory === "effects") return `effect:${id}`;
      if (dynopediaCategory === "seeds") return `seed:${id}`;
      if (dynopediaCategory === "animals") return `animal:${id}`;
      if (dynopediaCategory === "products") return `product:${id}`;
      if (dynopediaCategory === "machines") return `machine:${id}`;
      if (dynopediaCategory === "pets") return `pet:${id}`;
      return null;
    };
    for (const row of rows) {
      const key = codexKey(row.id);
      const known = key !== null && (state?.collection?.includes(key) ?? false);
      const marker = key === null ? "" : known ? "✓ " : "· ";
      const line = lineBlock(`// ${marker}${row.title} — ${row.detail}`);
      line.classList.add("garden-dynopedia-row");
      const haystack = `${row.id} ${row.title} ${row.detail}`.toLowerCase();
      if (query.length > 0 && !haystack.includes(query)) line.hidden = true;
      else shown += 1;
      list.append(line);
    }
    if (shown === 0) list.append(lineBlock(t("dynopedia.empty")));
    wrap.append(list);
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
    if (!disposed && tab === "extras") render();
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
          `// ${worker.name} · ${t("staff.level")} ${worker.level} (${worker.xp} XP) · ${t("staff.jobs", { count: worker.jobs })} · ${worker.wage}c · ${traits}`,
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
        `${fitText(bot.nick, 12)}${fitText(bot.focus === undefined ? "" : `[${t("bots.focusCarrot")}]`, 10)}${fitText(`#${bot.code}`, 10)}${fitText(`${formatCompact(bot.coins)}c`, 10)}`,
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
    if (mode !== "owner" || disposed || chartBusy) return;
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
      seasonPanel.append(
        lineBlock(
          t("raid.hp", {
            hp: formatCompact(raidSnapshot.hp),
            max: formatCompact(raidSnapshot.maxHp),
            time: formatDuration(Math.max(0, raidSnapshot.endsAt - now())),
          }),
        ),
      );
      const hit = actionButton(t("raid.hit", { cost: formatCompact(100_000) }), "raidHit");
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

    wrap.append(seasonPanel, backup);
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
    if (rebornTab === "townhall") {
      wrap.append(buildTownhallSection());
      return wrap;
    }
    wrap.append(buildGardenTabStrip());
    if (gardenTab !== "main") {
      wrap.append(gardenTab === "mushroom" ? buildMushroomHouse(at) : buildGardenTabPlaceholder());
      return wrap;
    }
    const row = div("garden-reborn-row");
    const vip = div("garden-reborn-vip");
    const owned = specialView()?.owned ?? 0;
    vip.append(
      lineBlock(`// ${t("reborn.vipTitle")} · ${t("reborn.vipProgress", { owned, total: SPECIAL_SLOTS })}`),
      buildRebornBoard(rebornPlots(), at),
    );
    row.append(vip);
    if (mode === "owner") {
      row.append(div("garden-reborn-sep"));
      const quick = div("garden-reborn-quick");
      quick.append(lineBlock(`// ${t("quick.title")}`), buildRebornActionColumns(rebornActionColumns(at)));
      row.append(quick);
      row.append(div("garden-reborn-sep"));
      const staff = div("garden-reborn-staff");
      staff.append(lineBlock(`// ${t("staff.rebornTitle")}`), buildRebornStaffCells());
      row.append(staff);
    }
    wrap.append(row);
    if (mode === "owner" && staffPanel !== null) {
      const panel = buildStaffPanel(at);
      if (panel !== null) wrap.append(panel);
      else staffPanel = null;
    }
    appendSpecialPickers(wrap);
    if (mode === "owner") {
      appendToolPickers(wrap);
      appendUprootPanel(wrap);
    }
    wrap.append(buildRebornGarden(at));
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
          `${candidate.name} · ${candidate.speed}⚡ · ${t("staff.jobs", { count: candidate.jobs })} · ${t("staff.wage", { wage: candidate.wage })} · ${traits} · ${formatCompact(staffHireCost(candidate))}c`,
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
        `${t("staff.jobs", { count: worker.jobs })} · ${traits}`,
        `${t("staff.currentTask")}: ${t(`staffRole.${worker.role}`)}`,
      ].join("\n");
      wrap.append(info, lineBlock(t("staff.assignHint")));
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

  /** @brief Switches the rebuilt view between the garden and the townhall. */
  function switchRebornTab(next: RebornTab): void {
    if (rebornTab === next) return;
    rebornTab = next;
    townNpc = null;
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
    staffPanel = null;
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
   * @brief Builds a garden tab whose UI has not been rebuilt yet.
   * @details Keeping the tab in the strip from day one fixes the shell; the body
   * fills in on later passes.
   */
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
    return {
      id: `seed:${offer.seed}`,
      name: t(`seeds.${offer.seed}.short`),
      glyph: definition?.art[3] ?? "?",
      note: stock > 0 ? `${formatCompact(price)}c·${stock}` : t("town.soldOut"),
      tone: "harvest",
      title: `${seedName(offer.seed)} · ${formatNumber(price)}c · ${t("market.stock")} ${stock}`,
      act: "townBuy",
      data: { kind: "seed", item: offer.seed },
      disabled: stock <= 0 || (state?.coins ?? 0) < price,
    };
  }

  /** @brief One fertilizer or spray as a townhall shop cell. */
  function townSupplyItem(supply: { readonly id: SupplyId; readonly price: number }): TownShopItem {
    const price = buyPriceOf(supply.id, supply.price);
    return {
      id: `supply:${supply.id}`,
      name: t(`supplies.${supply.id}`),
      glyph: "+",
      note: `${formatCompact(price)}c`,
      tone: "fertilizer",
      title: `${t(`supplies.${supply.id}`)} · ${formatNumber(price)}c`,
      act: "townBuy",
      data: { kind: "supply", item: supply.id },
      disabled: (state?.coins ?? 0) < price,
    };
  }

  /** @brief Seed and fertilizer merchant stock. */
  function seedShopSections(): TownShopSection[] {
    return [
      {
        id: "seeds",
        title: t("town.sectionSeeds"),
        items: (season?.shop.offers ?? []).map(townSeedItem),
        emptyHint: t("town.soldOut"),
      },
      {
        id: "supplies",
        title: t("town.sectionSupplies"),
        items: FERTILIZERS.map(townSupplyItem),
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
      return {
        id: `tool:${tool.id}`,
        name: t(`tools.${tool.id}`),
        glyph: "w",
        note: offer === undefined ? t("town.soldOut") : `${formatCompact(price)}c·${stock}`,
        tone: "soil",
        title: `${t(`tools.${tool.id}`)} · ${formatNumber(price)}c`,
        act: "townBuy",
        data: { kind: "tool", item: tool.id },
        disabled: offer === undefined || stock <= 0 || (state?.coins ?? 0) < price,
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
    const open = townNpc === null ? undefined : npcs.find((npc) => npc.id === townNpc);
    if (open !== undefined && mode === "owner") {
      wrap.append(buildTownShop(open, townShopSections(open.id), t("town.close")));
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
    const reborn = rebornPlots();
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-reborn-cell[data-slot]")) {
      const slot = Number(cell.dataset.slot);
      const plot = Number.isInteger(slot) ? reborn[slot] : undefined;
      if (plot !== undefined && cell instanceof HTMLButtonElement) paintRebornCell(cell, plot, at);
    }
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-mushroom-tray[data-slot]")) {
      const slot = Number(cell.dataset.slot);
      if (Number.isInteger(slot) && cell instanceof HTMLButtonElement) {
        paintRebornAction(cell, mushroomTrayAction(slot, at));
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
                { kind: "plantFruitSeed", slot, seed: tool.seed },
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
      case "pickPlantTool":
        toolPicker = toolPicker === "plant" ? null : "plant";
        render();
        return;
      case "pickPlantSeed": {
        const seed = target.dataset.seed as SeedId | undefined;
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
        const item = target.dataset.item as ItemId | undefined;
        void runAction(
          { kind: "queueMachine", machine, qty: machineQty, ...(item === undefined ? {} : { item }) },
          t("warehouse.queued"),
        );
        return;
      }
      case "machineCraft": {
        const machine = target.dataset.machine as MachineId | undefined;
        const item = target.dataset.item as ItemId | undefined;
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
      case "townNpc": {
        const npc = target.dataset.npc;
        if (npc === undefined) return;
        townNpc = townNpc === npc ? null : npc;
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
        if (kind === "seed") {
          void runAction(
            { kind: "buySeed", seed: item as SeedId, qty: 1 },
            t("market.bought", { qty: 1, seed: seedName(item as SeedId) }),
          );
        } else if (kind === "supply") {
          void runAction(
            { kind: "buySupply", supply: item as SupplyId, qty: 1 },
            t("garden.boughtSupply", { supply: t(`supplies.${item}`) }),
          );
        } else if (kind === "tool") {
          void runAction({ kind: "buyTool", tool: item as ToolId, qty: 1 }, t("market.boughtTool"));
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
        void runAction({ kind: "buyGreenhouse" }, t("extras.greenhouseBought"));
        return;
      case "extrasHatch":
        void runAction({ kind: "hatchEgg" }, t("extras.hatched"));
        return;
      case "extrasEquip": {
        const pet = target.dataset.pet;
        if (pet !== undefined) void runAction({ kind: "equipPet", pet: pet as never }, t("extras.equipped"));
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
        const item = target.dataset.item as ItemId | undefined;
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
      const query = dynopediaQuery.trim().toLowerCase();
      for (const row of root?.querySelectorAll<HTMLElement>(".garden-dynopedia-row") ?? []) {
        row.hidden = query.length > 0 && !(row.textContent ?? "").toLowerCase().includes(query);
      }
    }
    if (target.dataset.role === "giftCode") giftCode = target.value;
    if (target.dataset.role === "giftAmount") giftAmount = target.value;
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
