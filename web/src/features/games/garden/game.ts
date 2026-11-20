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
  staffHireCost,
  staffXpToLevel,
  staffMarketAt,
  wheelCost,
  petById,
  contractOffers,
  merchantOffers,
  soilRenovateCost,
  WATER_ALL_COST,
  MAX_TABS,
  PLOTS_PER_PATCH,
  TREES_PER_TAB,
  SEEDS,
  prestigeGrowScale,
  prestigeRequirement,
  prestigeSellBonus,
  SPRAYS,
  SPRAY_MUTATION_BOOST,
  fertilizerById,
  sprayById,
  TREES,
  cropSellPrice,
  effectById,
  gardenCounts,
  effectsMultiplier,
  nextPatchPrice,
  nextTabPrice,
  resolvedCropEffects,
  resolvedTreeEffects,
  ANIMALS,
  BUILDING_IDS,
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
  MACHINES,
  MACHINE_MAX_LEVEL,
  machineCycles,
  MACHINE_PRICE,
  WAREHOUSE_PRICE,
  converterOutput,
  machineById,
  seedById,
  seedMakerOutput,
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
  type EffectId,
  type GardenAction,
  type GardenSnapshot,
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
import { formatCompact, formatDuration, onLocaleChange, t, tList, translateError } from "@/shared/i18n";
import { loadIdentity, type Identity } from "@/shared/lib/identity";
import type { GardenBot } from "@/features/games/garden/api";
import { readParam, writeParams } from "@/shared/lib/urlstate";
import type { GameContext, GameMount } from "../mount";
import { animalCellRender, cellRender, fitText, growthColor, labelValue, treeCellRender } from "./ascii";
import { GardenApi, GardenApiError } from "./api";

/** Repaint interval while the document is open. */
const TICK_MS = 1_000;

/** Background refresh interval for season, state and visits. */
const POLL_MS = 60_000;

/** Tab data stays fresh this long, so flipping tabs does not re-request it. */
const DATA_TTL_MS = 30_000;

/** How long an uproot confirmation stays armed. */
const UPROOT_ARM_MS = 4_000;

/** One active tab inside the document. */
type Tab =
  "garden" | "market" | "event" | "chart" | "bots" | "rank" | "farm" | "warehouse" | "extras" | "levels";

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
  let tab: Tab = "garden";
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
  let bulkPanel: "plan" | "uproot" | null = null;
  let confirmPrestige = false;
  let uprootPending: { seed?: SeedId; priceBelow?: number; profit?: "loss" | "win" } | null = null;
  let uprootPriceDraft = "";
  let giftCode = "";
  let giftAmount = "1000";
  let buyQty = 1;
  type GardenTool =
    { kind: "fertilize" | "spray"; supply: SupplyId } | { kind: "plant"; seed: SeedId } | { kind: "water" };
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

  /** @brief Sells every harvested crop. */
  function sellAll(): void {
    if (state === null || season === null || state.bag.crops.length === 0) return;
    const currentSeason = season;
    const total = state.bag.crops.reduce(
      (sum, stack) => sum + cropSellPrice(stack, currentSeason) * stack.qty,
      0,
    );
    void runAction({ kind: "sellAll" }, t("market.sellAllValue", { coins: total }));
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
    if (next === "event") void loadLeaderboard();
    if (next === "chart") void loadChart();
    if (next === "bots") void loadBots();
    if (next === "rank") void loadLeaderboard();
    if (next === "extras") void loadExtras();
    syncGardenQuery();
    render();
  }

  /** @brief Writes the garden view state into the URL query. */
  function syncGardenQuery(): void {
    writeParams({
      gtab: tab,
      gpage: page > 0 ? String(page) : null,
      garea: selectedSlot === null ? null : selectedArea,
      gslot: selectedSlot === null ? null : String(selectedSlot),
    });
  }

  /** @brief Restores tab, page and selection saved in the URL. */
  function readGardenQuery(): void {
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
    head.append(span("garden-menu-balance", `$ ${formatCompact(coins)}c`));
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

  /** @brief Builds the tab strip with the garden code and share action. */
  function buildTabs(): HTMLElement {
    const bar = div("garden-tabs");
    for (const id of [
      "garden",
      "market",
      "event",
      "chart",
      "bots",
      "rank",
      "farm",
      "warehouse",
      "extras",
      "levels",
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "garden-tab";
      button.dataset.act = `tab:${id}`;
      const label = t(`tabs.${id}`);
      button.textContent = tab === id ? `[ ${label} ]` : ` ${label} `;
      if (tab === id) button.classList.add("is-active");
      bar.append(button);
    }
    bar.append(span("garden-tabs-spacer", ""));
    const balance = mode === "visit" ? visiting?.coins : state?.coins;
    if (balance !== undefined) {
      const chip = span("garden-balance", `$ ${formatCompact(balance)}c`);
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
        const definition = treeById(tree.tree);
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
      lines.push("", t("garden.empty"), t("garden.emptyHint"));
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
    if (coins !== undefined) head.append(span("garden-menu-balance", `$ ${formatCompact(coins)}c`));
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
        rows.append(
          menuRow(`${fitText(seedName(seed.id), 9)} ${t("garden.bag")} ${owned}`, "menuSeed", {
            data: { seed: seed.id },
          }),
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
    if (specialPicker !== null) {
      const picker = div("garden-tools");
      picker.append(span("garden-hint", t("special.pickSeed")));
      const seeds = SEEDS.filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0);
      if (seeds.length === 0) picker.append(span("garden-hint", t("garden.noSeedsOwned")));
      for (const seed of seeds) {
        const button = actionButton(
          `${seedName(seed.id)} (${state?.bag.seeds[seed.id] ?? 0})`,
          "specialSeed",
        );
        button.dataset.slot = String(specialPicker);
        button.dataset.seed = seed.id;
        picker.append(button);
      }
      wrap.append(picker);
    }
    return wrap;
  }

  /** @brief Crops the pending bulk-uproot filter would remove, grouped. */
  function uprootTargets(filter: { seed?: SeedId; priceBelow?: number; profit?: "loss" | "win" }): {
    summary: string;
    count: number;
  } {
    if (state === null || season === null) return { summary: "", count: 0 };
    const at = now();
    const counts = new Map<SeedId, number>();
    let total = 0;
    for (const plot of state.plots) {
      if (plot === null || plot.favorite === true) continue;
      if (filter.seed !== undefined && plot.seed !== filter.seed) continue;
      const value = cropSellPrice(
        {
          item: plot.seed,
          effects: resolvedCropEffects(plot, at),
          pest: plot.pest,
          star: 1,
          qty: 1,
        },
        season,
      );
      if (filter.priceBelow !== undefined && value >= filter.priceBelow) continue;
      if (filter.profit !== undefined) {
        const cost = seedById(plot.seed)?.buy ?? 0;
        const winning = value > cost;
        if (filter.profit === "win" ? !winning : winning) continue;
      }
      counts.set(plot.seed, (counts.get(plot.seed) ?? 0) + 1);
      total += 1;
    }
    const summary = [...counts].map(([seed, count]) => `${seedName(seed)} ×${count}`).join(", ");
    return { summary, count: total };
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
      );
      if (tool !== null) {
        const activeLabel =
          tool.kind === "water"
            ? t("garden.waterToolActive")
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

      if (toolPicker === "plant") {
        const picker = div("garden-tools");
        const ownedSeeds = SEEDS.filter((seed) => (state?.bag.seeds[seed.id] ?? 0) > 0);
        if (ownedSeeds.length === 0) picker.append(span("garden-hint", t("garden.plantNoSeeds")));
        for (const seed of ownedSeeds) {
          const button = actionButton(
            `${t(`seeds.${seed.id}`)} (${state?.bag.seeds[seed.id] ?? 0})`,
            "pickPlantSeed",
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
          const button = actionButton(
            `${t(`supplies.${supply.id}`)} (${owned})`,
            "pickToolSupply",
            owned > 0,
          );
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
          const button = actionButton(
            `${t(`seeds.${seed.id}`)} (${state?.bag.seeds[seed.id] ?? 0})`,
            "plantAllSeed",
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

      wrap.append(lineBlock(`// ${t("auto.title")}`));
      const auto = div("garden-tools");
      auto.append(actionButton(t("auto.uproot"), "bulkUproot", true));
      wrap.append(auto);

      if (bulkPanel === "uproot") {
        const panel = div("garden-tools");
        if (uprootPending !== null) {
          const targets = uprootTargets(uprootPending);
          panel.append(
            lineBlock(
              targets.count > 0 ? t("auto.preview", { crops: targets.summary }) : t("auto.previewEmpty"),
            ),
          );
          panel.append(
            actionButton(t("auto.confirmUproot"), "uprootConfirm", targets.count > 0),
            actionButton(t("auto.cancelUproot"), "uprootCancel"),
          );
          wrap.append(panel);
        } else {
          const planted = new Map<SeedId, number>();
          for (const plot of state?.plots ?? []) {
            if (plot === null) continue;
            planted.set(plot.seed, (planted.get(plot.seed) ?? 0) + 1);
          }
          for (const [seed, count] of planted) {
            const button = actionButton(
              `${t("auto.byPlant", { seed: seedName(seed) })} ×${count}`,
              "uprootSeed",
            );
            button.dataset.seed = seed;
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
      }

      wrap.append(lineBlock(`// ${t("staff.title")}`));
      wrap.append(buildStaffBar());
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
          job.readyAt <= at ? t("warehouse.jobReady") : t("warehouse.brewing", { item: itemName(job.item) }),
        ),
      );
    } else if (remaining > 0) {
      lines.push(labelValue(t("warehouse.status"), t("warehouse.cooling")));
    } else {
      lines.push(labelValue(t("warehouse.status"), t("warehouse.ready")));
    }
    if (definition.output.kind === "product") {
      lines.push(labelValue(t("warehouse.output"), t(`products.${definition.output.product}`)));
    }
    const queue = built.queue ?? [];
    lines.push(labelValue(t("warehouse.queue"), String(queue.length)));
    for (let index = 0; index < Math.min(5, queue.length); index += 1) {
      const job = queue[index];
      if (job === undefined) continue;
      const name =
        seedById(job.item) !== undefined || treeById(job.item) !== undefined
          ? itemName(job.item)
          : t(`products.${job.item}`);
      lines.push(`  ${index + 1}. ${name}`);
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

    if (job !== undefined) {
      if (job.readyAt <= at) {
        rows.append(menuRow(t("warehouse.collect"), "machineCollect", { data: { machine: definition.id } }));
      } else {
        rows.append(
          menuRow(t("warehouse.brewing", { item: itemName(job.item) }), "machineNoop", { disabled: true }),
        );
      }
    } else if (remaining > 0) {
      rows.append(menuRow(t("warehouse.cooling"), "machineNoop", { disabled: true }));
    } else if (definition.input.kind === "product") {
      const inputProduct = definition.input.product;
      const count =
        state.bag.products
          ?.filter((stack) => stack.product === inputProduct)
          .reduce((sum, stack) => sum + stack.qty, 0) ?? 0;
      const pair = div("garden-machine-row");
      pair.append(
        menuRow(`${t(`products.${inputProduct}`)} ×${count}`, "machineCraft", {
          data: { machine: definition.id },
          disabled: count < 1,
        }),
        menuRow("+Q", "machineQueue", {
          data: { machine: definition.id },
          disabled: count < 1,
        }),
      );
      rows.append(pair);
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
          }),
          menuRow("+Q", "machineQueue", {
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
      rows.append(menuRow(`[ ${t("garden.uproot")} ]`, "specialMenuUproot"));
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
              : t("warehouse.brewing", { item: itemName(built.job.item) })
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
      act: "buy" | "buySupply" | "buyTool";
      key: string;
      name: string;
      glyph: string;
      price: number;
      stock: number | null;
      owned: number;
      data: Record<string, string>;
    }): HTMLButtonElement => {
      const soldOut = item.stock !== null && item.stock <= 0;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "garden-buy-card";
      if (soldOut) {
        card.classList.add("is-sold-out");
        card.disabled = true;
      }
      card.dataset.act = item.act;
      for (const [key, value] of Object.entries(item.data)) card.dataset[key] = value;
      card.title = `${item.name} · ${formatCompact(item.price)}c × ${buyQty} = ${formatCompact(item.price * buyQty)}c`;
      card.append(
        span("garden-buy-line is-glyph", item.glyph),
        span("garden-buy-line is-name", item.name),
        span("garden-buy-line is-price", `${formatCompact(item.price)}c`),
        span("garden-buy-line", `x${buyQty}=${formatCompact(item.price * buyQty)}c`),
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
    for (const offer of season.shop.offers) {
      const definition = seedById(offer.seed);
      const rare = definition?.rare === true;
      (rare ? rareSeedItems : seedItems).push({
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
        `${t(`products.${stack.product}`)} ${fitText(`${"*".repeat(stack.star)}`, 6)}${fitText(`x${stack.qty}`, 5)}${fitText(`${formatCompact(unit)}c`, 7)}[${t("market.sell")}]`,
        "sellProduct",
      );
      row.dataset.product = stack.product;
      row.dataset.star = String(stack.star);
      products.append(row);
    }
    if (stacks.length > 0) products.append(actionButton(t("farm.sellAllProducts"), "sellAllProducts"));

    wrap.append(exchange, products);
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

    const prestigeLevel = extras.prestige ?? 0;
    const prestigeNeed = prestigeRequirement(prestigeLevel);
    wrap.append(lineBlock(`// ${t("prestige.title")}`));
    wrap.append(
      lineBlock(
        t("prestige.level", {
          level: prestigeLevel,
          sell: Math.round((prestigeSellBonus(prestigeLevel) - 1) * 100),
          grow: Math.round((1 - prestigeGrowScale(prestigeLevel)) * 100),
        }),
      ),
    );
    if (state.stats.earned >= prestigeNeed) {
      wrap.append(
        actionButton(
          confirmPrestige
            ? t("prestige.confirm", { level: prestigeLevel + 1 })
            : t("prestige.ready", { level: prestigeLevel + 1 }),
          "prestige",
        ),
      );
    } else {
      wrap.append(
        lineBlock(
          t("prestige.progress", {
            earned: formatCompact(state.stats.earned),
            need: formatCompact(prestigeNeed),
          }),
        ),
      );
    }
    if ((extras.taxLast ?? 0) > 0) {
      wrap.append(lineBlock(`// ${t("tax.last", { coins: formatCompact(extras.taxLast ?? 0) })}`));
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
      const gardener = actionButton(t("staffRole.gardener"), "staffRoleGardener");
      gardener.dataset.index = String(index);
      const waterer = actionButton(t("staffRole.waterer"), "staffRoleWaterer");
      waterer.dataset.index = String(index);
      const fire = actionButton(t("staff.fire"), "staffFire");
      fire.dataset.index = String(index);
      wrap.append(gardener, waterer, fire);
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

  /** @brief Builds the dedicated leaderboard tab: coins, ROI and harvests. */
  function buildRank(): HTMLElement {
    const wrap = div("garden-rank");
    wrap.append(lineBlock(`// ${t("rank.title")}`));
    if (leaderboard.length === 0) {
      wrap.append(lineBlock(t("rank.empty")));
      return wrap;
    }
    const head = div("garden-rank-row is-head");
    head.append(
      span("garden-rank-cell", t("rank.rank")),
      span("garden-rank-cell is-name", t("rank.player")),
      span("garden-rank-cell", t("rank.coins")),
      span("garden-rank-cell", t("rank.earned")),
      span("garden-rank-cell", t("rank.roi")),
      span("garden-rank-cell", t("rank.harvested")),
    );
    wrap.append(head);
    leaderboard.forEach((entry, index) => {
      const spent = entry.spent ?? 0;
      const roi = spent > 0 ? Math.round(((entry.earned - spent) / spent) * 100) : entry.earned > 0 ? 100 : 0;
      const row = div("garden-rank-row");
      row.append(
        span("garden-rank-cell", `#${index + 1}`),
        span("garden-rank-cell is-name", `${entry.nick} · ${entry.code}`),
        span("garden-rank-cell", `${formatCompact(entry.coins ?? 0)}c`),
        span("garden-rank-cell", `${formatCompact(entry.earned)}c`),
        span("garden-rank-cell", `${roi >= 0 ? "+" : ""}${roi}%`),
        span("garden-rank-cell", String(entry.harvested)),
      );
      wrap.append(row);
    });
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

    const items = [...chartMarket.items].sort((left, right) => right.multiplier - left.multiplier);
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
        span("garden-chart-sold", `${t("chart.sold")} ${item.sold}/${chartMarket.soldTarget}`),
      );
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

  /** @brief Builds the event tab: season, leaderboard and the backup panel. */
  function buildEvent(): HTMLElement {
    const wrap = div("garden-event");

    const seasonPanel = div("garden-event-panel");
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

    const board = div("garden-event-panel");
    board.append(lineBlock(`// ${t("event.leaderboard")}`));
    if (leaderboard.length === 0) board.append(lineBlock(t("event.leaderboardEmpty")));
    leaderboard.forEach((entry, index) => {
      const mine = entry.code === currentCode();
      const row = rowButton(
        "garden-leaderboard-row",
        `${t("event.rank", {
          rank: index + 1,
          nick: mine ? t("event.you") : entry.nick,
          coins: formatCompact(entry.earned),
        })} [${t("event.visit")}]`,
        "visit",
      );
      row.dataset.code = entry.code;
      board.append(row);
    });

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

    wrap.append(seasonPanel, board, backup);
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

  /** @brief Builds the active tab content. */
  function buildContent(): HTMLElement {
    if (mode === "owner" && state === null)
      return lineBlock(offline ? t("common.offline") : t("common.loading"));
    if (mode === "visit" && visiting === null)
      return lineBlock(offline ? t("common.offline") : t("common.loading"));
    if (tab === "garden") return buildGarden();
    if (tab === "market") return buildMarket();
    if (tab === "chart") return buildChart();
    if (tab === "bots") return buildBots();
    if (tab === "rank") return buildRank();
    if (tab === "farm") return buildFarm();
    if (tab === "warehouse") return buildWarehouse();
    if (tab === "extras") return buildExtras();
    if (tab === "levels") return buildLevels();
    return buildEvent();
  }

  /** @brief Status comment line. */
  function buildStatus(): HTMLElement {
    const line = document.createElement("p");
    line.className = "stage-status";
    if (message !== null) {
      line.textContent = message.text;
      line.classList.add(`is-${message.kind}`);
    } else if (tool !== null) {
      line.textContent =
        tool.kind === "water"
          ? t("garden.waterToolActive")
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
    const parts: HTMLElement[] = [buildTabs(), buildHud(), buildContent(), buildStatus()];
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
    if (action.startsWith("tab:")) {
      closeMenu();
      switchTab(action.slice(4) as Tab);
      return;
    }
    if (action.startsWith("tab:")) {
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
            // Quick plant: one click sows the picked seed, no menu in the way.
            const occupied = area === "tree" || plotAt(slot) !== null || isPreviewPage();
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
      case "machineQueue": {
        const machine = target.dataset.machine as MachineId | undefined;
        if (machine === undefined) return;
        const item = target.dataset.item as ItemId | undefined;
        void runAction(
          { kind: "queueMachine", machine, ...(item === undefined ? {} : { item }) },
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
        if (product !== undefined && Number.isInteger(star)) {
          void runAction({ kind: "sellProduct", product, star, qty: 1 }, t("farm.soldProduct"));
        }
        return;
      }
      case "sellAllProducts":
        void runAction({ kind: "sellAllProducts" }, t("farm.soldAllProducts"));
        return;
      case "toggleStealth":
        stealth = !stealth;
        localStorage.setItem("dyno.garden.stealth", stealth ? "1" : "0");
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
        if (target.dataset.act === "staffMenuFire") {
          void runAction({ kind: "fireStaff", index }, t("staff.fired"));
        } else {
          const role = target.dataset.act === "staffMenuWaterer" ? "waterer" : "gardener";
          void runAction({ kind: "setStaffRole", index, role }, t("staff.roleSet"));
        }
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
      case "staffRoleGardener":
      case "staffRoleWaterer": {
        const index = Number(target.dataset.index);
        if (Number.isInteger(index)) {
          const role = target.dataset.act === "staffRoleWaterer" ? "waterer" : "gardener";
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
      case "restore":
        void restoreGarden();
        return;
      case "rotate":
        void rotateRecovery();
        return;
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
    if (target.dataset.role === "giftCode") giftCode = target.value;
    if (target.dataset.role === "giftAmount") giftAmount = target.value;
  }

  /** @brief Closes the context menu when the pointer lands outside it. */
  function onPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      specialMenu !== null &&
      target.closest(".garden-menu") === null &&
      target.closest(".garden-special-cell") === null
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
