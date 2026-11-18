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
  MAX_TABS,
  PLOTS_PER_PATCH,
  TREES_PER_TAB,
  SEEDS,
  SPRAYS,
  TREES,
  cropSellPrice,
  effectById,
  gardenCounts,
  effectsMultiplier,
  nextTabPrice,
  plotView,
  seedById,
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
  type SeedId,
  type SprayId,
  type SupplyId,
  type TreeId,
  type TreeState,
  type VisitSnapshot,
} from "@dyno/shared/garden";
import { formatDuration, formatNumber, onLocaleChange, t, tList, translateError } from "@/shared/i18n";
import { loadIdentity, type Identity } from "@/shared/lib/identity";
import { readParam, writeParams } from "@/shared/lib/urlstate";
import type { GameContext, GameMount } from "../mount";
import { cellRender, fitText, growthColor, labelValue, treeCellRender } from "./ascii";
import { GardenApi, GardenApiError } from "./api";

/** Repaint interval while the document is open. */
const TICK_MS = 1_000;

/** Background refresh interval for season, state and visits. */
const POLL_MS = 60_000;

/** How long an uproot confirmation stays armed. */
const UPROOT_ARM_MS = 4_000;

/** One active tab inside the document. */
type Tab = "garden" | "market" | "event";

/** Whether the document is showing the owner's garden or a friend's. */
type Mode = "owner" | "visit";

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

  /** @brief Localized full name of any bag item. */
  function itemName(id: ItemId): string {
    return seedById(id) === undefined ? t(`trees.${id}`) : t(`seeds.${id}`);
  }

  /** @brief Compact mutation badge: strongest name plus a `+n` counter. */
  function effectBadge(effects: readonly EffectId[]): string {
    const strongest = strongestEffect(effects);
    if (strongest === null) return "";
    return effects.length > 1
      ? `${t(`effects.${strongest.id}`)}+${effects.length - 1}`
      : t(`effects.${strongest.id}`);
  }

  /** @brief Full mutation summary for the detail panel, with the total. */
  function effectListText(effects: readonly EffectId[]): string {
    if (effects.length === 0) return t("garden.effectNone");
    const parts = effects.map((id) => `${t(`effects.${id}`)} x${effectById(id)?.multiplier ?? 1}`);
    const total = effectsMultiplier(effects);
    return effects.length > 1 ? `${parts.join(", ")} = x${total}` : (parts[0] ?? "");
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
  }

  /** @brief Refreshes season and snapshot from the server. */
  async function refresh(): Promise<void> {
    if (disposed || busy) return;
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
    }
    if (!disposed) render();
  }

  /** @brief Loads the leaderboard for the event tab. */
  async function loadLeaderboard(): Promise<void> {
    try {
      leaderboard = await api.leaderboard(20);
    } catch {
      // A missing leaderboard never blocks the garden itself.
    }
    if (!disposed && tab === "event") render();
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
      const gain = cropSellPrice({ item: tree.tree, effects: tree.effects, qty: 1 }, season);
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
    const gain = cropSellPrice({ item: plot.seed, effects: plot.effects, qty: 1 }, season);
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
  function applySupply(kind: "fertilize" | "spray", supply: SupplyId): void {
    if (selectedSlot === null) return;
    const tree = selectedArea === "tree";
    supplyPicker = null;
    const action: GardenAction =
      kind === "fertilize"
        ? { kind, slot: selectedSlot, tree, supply: supply as FertilizerId }
        : { kind: "spray", slot: selectedSlot, tree, supply: supply as SprayId };
    const name = t(`supplies.${supply}`);
    void runAction(
      action,
      t(kind === "fertilize" ? "garden.fertilized" : "garden.sprayed", { supply: name }),
    );
  }

  /** @brief Buys one fertilizer or spray. */
  function buySupply(supply: SupplyId): void {
    void runAction(
      { kind: "buySupply", supply, qty: 1 },
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
    void runAction(
      { kind: "buySeed", seed: seedId, qty: 1 },
      t("market.bought", { qty: 1, seed: seedName(seedId) }),
    );
  }

  /** @brief Whether two mutation lists describe the same stack. */
  function sameEffectSet(left: readonly EffectId[], right: readonly EffectId[]): boolean {
    const a = [...left].sort().join(":");
    const b = [...right].sort().join(":");
    return a === b;
  }

  /** @brief Sells one harvested stack. */
  function sellStack(item: ItemId, effects: readonly EffectId[]): void {
    if (state === null || season === null) return;
    const stack = state.bag.crops.find(
      (entry) => entry.item === item && sameEffectSet(entry.effects, effects),
    );
    if (stack === undefined) return;
    const gain = cropSellPrice(stack, season) * stack.qty;
    void runAction(
      { kind: "sellCrop", item, effects: stack.effects, qty: stack.qty },
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
    uprootArmed = false;
    if (next === "event") void loadLeaderboard();
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
    if (savedTab === "garden" || savedTab === "market" || savedTab === "event") tab = savedTab;
    const savedPage = Number(readParam("gpage"));
    pendingPage = Number.isInteger(savedPage) && savedPage > 0 ? savedPage : null;
    const savedArea = readParam("garea") === "tree" ? "tree" : "crop";
    const savedSlot = Number(readParam("gslot"));
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
    for (const id of ["garden", "market", "event"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "garden-tab";
      button.dataset.act = `tab:${id}`;
      const label = t(`tabs.${id}`);
      button.textContent = tab === id ? `[ ${label} ]` : ` ${label} `;
      if (tab === id) button.classList.add("is-active");
      bar.append(button);
    }
    const code = currentCode();
    if (code !== null) {
      bar.append(
        span("garden-tabs-spacer", ""),
        span("garden-code", `#${code}`),
        actionButton(t("garden.copyLink"), "share"),
      );
    }
    if (mode === "visit") bar.append(actionButton(t("garden.backHome"), "home"));
    return bar;
  }

  /** @brief HUD comment line. */
  function hudText(): string {
    if (mode === "visit" && visiting !== null) {
      const counts = gardenCounts(visiting.plots, visiting.trees, now());
      return `${t("garden.visitTitle", { nick: visiting.nick })} | ${t("garden.coins")} ${formatNumber(visiting.coins)} | ${t("garden.ready")} ${counts.ready} | ${visiting.online ? t("common.online") : t("common.offlineUser")}`;
    }
    if (state === null) return "";
    const counts = gardenCounts(state.plots, state.trees, now());
    return `${t("garden.coins")} ${formatNumber(state.coins)} | ${t("garden.ready")} ${counts.ready} | ${t("garden.growing")} ${counts.growing} | ${t("garden.free")} ${counts.free}`;
  }

  /** @brief Builds one compact (one-glyph) cell button. */
  function buildMiniCell(slot: number, area: "crop" | "tree"): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "garden-mini-cell";
    cell.dataset.act = "plot";
    cell.dataset.area = area;
    cell.dataset.slot = String(slot);
    if (isPreviewPage()) cell.disabled = true;
    syncMiniCell(cell, slot, area, now());
    return cell;
  }

  /** @brief One glyph for a planted crop. */
  function cropGlyph(plot: PlotState, at: number): string {
    const view = plotView(plot, at);
    return view.seed.art[view.stage] ?? ".";
  }

  /** @brief One glyph for a planted tree. */
  function treeGlyph(tree: TreeState, at: number): string {
    const view = treeById(tree.tree);
    const ready = at >= tree.readyAt;
    const progress = Math.min(
      1,
      Math.max(0, (at - tree.plantedAt) / Math.max(1, tree.readyAt - tree.plantedAt)),
    );
    const stage = ready ? 3 : Math.min(2, Math.floor(progress * 3));
    return view?.art[stage] ?? ".";
  }

  /** @brief Repaints one compact crop or tree cell. */
  function syncMiniCell(cell: HTMLButtonElement, slot: number, area: "crop" | "tree", at: number): void {
    const preview = isPreviewPage();
    const plot = preview || area === "tree" ? null : plotAt(slot);
    const tree = preview || area === "crop" ? null : treeAt(slot);
    const plant = area === "tree" ? tree : plot;
    const effects = plant?.effects ?? [];
    const ready = plant !== null && at >= plant.readyAt;
    const growing = plant !== null && at < plant.readyAt;
    const progress =
      plant === null
        ? 0
        : Math.min(1, Math.max(0, (at - plant.plantedAt) / Math.max(1, plant.readyAt - plant.plantedAt)));
    const strongest = strongestEffect(effects);
    let glyph = ".";
    if (preview) glyph = "+";
    else if (plot !== null) glyph = cropGlyph(plot, at);
    else if (tree !== null) glyph = treeGlyph(tree, at);

    cell.textContent = glyph;
    cell.classList.toggle("is-ready", ready);
    cell.classList.toggle("is-growing", growing);
    cell.classList.toggle("is-empty", plant === null);
    cell.classList.toggle("is-locked", preview);
    cell.classList.toggle("is-selected", selectedSlot === slot && selectedArea === area);
    for (const definition of EFFECTS)
      cell.classList.toggle(`is-${definition.id}`, effects.includes(definition.id));
    cell.style.color = growing ? growthColor(progress) : "";
    const label = plotLabel(slot, area);
    cell.setAttribute(
      "aria-label",
      `${t("garden.tab", { tab: page + 1 })} ${t(area === "tree" ? "garden.trees" : "garden.crops")} ${t("garden.patch", { patch: label.patch })} ${t("garden.plot", { slot: label.plot })}`,
    );
    if (preview) cell.textContent = "+";
    void strongest;
  }

  /** @brief Builds the 9x9 crop grid: nine 3x3 patches. */
  function buildCropBoard(): HTMLElement {
    const board = div("garden-crop-grid");
    for (let row = 0; row < 9; row += 1) {
      const line = div("garden-mini-row");
      for (let col = 0; col < 9; col += 1) {
        const patch = Math.floor(row / 3) * 3 + Math.floor(col / 3);
        const plot = (row % 3) * 3 + (col % 3);
        line.append(buildMiniCell(cropOffset() + patch * PLOTS_PER_PATCH + plot, "crop"));
      }
      board.append(line);
    }
    return board;
  }

  /** @brief Builds the three fruit patches as one 3x9 strip. */
  function buildTreeBoard(): HTMLElement {
    const board = div("garden-tree-grid");
    for (let row = 0; row < 3; row += 1) {
      const line = div("garden-mini-row");
      for (let col = 0; col < FRUIT_PATCHES_PER_TAB * 3; col += 1) {
        const patch = Math.floor(col / 3);
        const plot = row * 3 + (col % 3);
        line.append(buildMiniCell(treeOffset() + patch * PLOTS_PER_PATCH + plot, "tree"));
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
        lines.push(labelValue(t("garden.effect"), effectListText(tree.effects)));
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
              `${formatNumber(cropSellPrice({ item: tree.tree, effects: tree.effects, qty: 1 }, season))}c`,
            ),
          );
        }
        lines.push(labelValue(t("garden.kind"), t("garden.reharvest")));
        if (tree.harvests > 0) lines.push(labelValue(t("garden.harvestedTimes"), String(tree.harvests)));
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
            `${formatNumber(cropSellPrice({ item: plot.seed, effects: plot.effects, qty: 1 }, season))}c`,
          ),
        );
      }
      if (definition?.regrow === true) {
        lines.push(labelValue(t("garden.kind"), t("garden.reharvest")));
        if (plot.harvests > 0) lines.push(labelValue(t("garden.harvestedTimes"), String(plot.harvests)));
      } else {
        lines.push(labelValue(t("garden.kind"), t("garden.singleHarvest")));
      }
      if (mode === "owner") lines.push("", t("garden.actions"));
    }
    pre.textContent = lines.join("\n");
  }

  /** @brief Builds the seed picker rows for one empty plot. */
  function buildSeedPicker(slot: number): HTMLElement {
    const wrap = div("garden-seeds");
    wrap.append(span("garden-hint", t("garden.pickSeed", { slot: plotLabel(slot, "crop").plot })));
    for (const seed of SEEDS) {
      const offer = season?.shop.offers.find((entry) => entry.seed === seed.id);
      const price = offer?.price ?? seed.buy;
      const owned = state?.bag.seeds[seed.id] ?? 0;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "garden-row";
      row.dataset.act = "seed";
      row.dataset.seed = seed.id;
      row.textContent = `${fitText(seedName(seed.id), 9)}${fitText(`${price}c`, 5)}${fitText(`${t("garden.bag")} ${owned}`, 8)}${formatDuration(seed.growMs, "short")}`;
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
          : `+mut · ${supply.harvests}`;
      row.textContent = `${fitText(t(`supplies.${supply.id}`), 14)}${fitText(`${owned}`, 3)}${fitText(`${supply.price}c`, 5)}${detail}`;
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

  /** @brief Builds the garden tab: pager, 9x9 crop grid, 3 fruit patches and detail. */
  function buildGarden(): HTMLElement {
    const wrap = div("garden-garden");
    wrap.append(buildPager());
    const layout = div("garden-layout");
    const boards = div("garden-boards");
    const cropPanel = div("garden-board-panel");
    cropPanel.append(span("garden-board-title", t("garden.crops")), buildCropBoard());
    const treePanel = div("garden-board-panel");
    treePanel.append(span("garden-board-title", t("garden.trees")), buildTreeBoard());
    boards.append(cropPanel, treePanel);
    layout.append(boards, buildDetail());
    wrap.append(layout);
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

    const shop = div("garden-market-panel");
    shop.append(
      lineBlock(
        `// ${t("market.shop")} — ${t("market.restock", { time: formatDuration(season.shop.restockAt - now()) })}`,
      ),
    );
    for (const offer of season.shop.offers) {
      const owned = state.bag.seeds[offer.seed] ?? 0;
      const row = rowButton(
        "garden-market-row",
        `${fitText(seedName(offer.seed), 9)}${fitText(`${offer.price}c`, 5)}${fitText(`${t("market.stock")} ${offer.stock}`, 10)}${fitText(`${t("garden.bag")} ${owned}`, 8)}[${t("market.buy")}]`,
        "buy",
      );
      row.dataset.seed = offer.seed;
      shop.append(row);
    }

    const exchange = div("garden-market-panel");
    exchange.append(lineBlock(`// ${t("market.exchange")}`));
    if (state.bag.crops.length === 0) exchange.append(lineBlock(t("market.empty")));
    for (const stack of state.bag.crops) {
      const value = cropSellPrice(stack, season) * stack.qty;
      const row = rowButton(
        "garden-market-row",
        `${fitText(itemName(stack.item), 9)}${fitText(effectBadge(stack.effects), 8)}${fitText(`x${stack.qty}`, 4)}${fitText(`${value}c`, 7)}[${t("market.sell")}]`,
        "sell",
      );
      row.dataset.item = stack.item;
      row.dataset.effects = JSON.stringify(stack.effects);
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

    const supplies = div("garden-market-panel");
    supplies.append(lineBlock(`// ${t("market.supplies")}`));
    const supplyCatalog = [...FERTILIZERS, ...SPRAYS];
    for (const supply of supplyCatalog) {
      const owned = state.bag.supplies[supply.id] ?? 0;
      const row = rowButton(
        "garden-market-row",
        `${fitText(t(`supplies.${supply.id}`), 14)}${fitText(`${supply.price}c`, 5)}${fitText(`${t("garden.bag")} ${owned}`, 8)}[${t("market.buy")}]`,
        "buySupply",
      );
      row.dataset.supply = supply.id;
      supplies.append(row);
    }

    wrap.append(shop, exchange, supplies);
    return wrap;
  }

  /** @brief Builds the event tab: season, leaderboard and the backup panel. */
  function buildEvent(): HTMLElement {
    const wrap = div("garden-event");

    const seasonPanel = div("garden-event-panel");
    seasonPanel.append(lineBlock(`// ${t("event.now")}`));
    if (season !== null) {
      seasonPanel.append(
        lineBlock(`${t(`events.${season.event.id}`)} — ${t(`events.${season.event.id}.desc`)}`),
      );
      const countdown = div("garden-line");
      countdown.dataset.eventTimer = "now";
      seasonPanel.append(countdown);
      seasonPanel.append(lineBlock(""));
      seasonPanel.append(lineBlock(`// ${t("event.next")}`));
      seasonPanel.append(
        lineBlock(`${t(`events.${season.next.id}`)} — ${t(`events.${season.next.id}.desc`)}`),
      );
      const next = div("garden-line");
      next.dataset.eventTimer = "next";
      seasonPanel.append(next);
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
          coins: formatNumber(entry.earned),
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
    return buildEvent();
  }

  /** @brief Status comment line. */
  function buildStatus(): HTMLElement {
    const line = document.createElement("p");
    line.className = "stage-status";
    if (message !== null) {
      line.textContent = message.text;
      line.classList.add(`is-${message.kind}`);
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
    detailPre = null;
    root.dataset.tab = tab;
    root.dataset.mode = mode;
    root.dataset.offline = offline ? "on" : "off";
    root.dataset.busy = busy ? "on" : "off";
    const parts: HTMLElement[] = [buildTabs(), buildHud(), buildContent(), buildStatus()];
    root.replaceChildren(...parts);
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
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-mini-cell[data-slot]")) {
      const slot = Number(cell.dataset.slot);
      const area = cell.dataset.area === "tree" ? "tree" : "crop";
      if (Number.isInteger(slot) && cell instanceof HTMLButtonElement) syncMiniCell(cell, slot, area, at);
    }
    if (detailPre !== null) fillDetail(detailPre, at);
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
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-act]") : null;
    if (target === null) return;
    const action = target.dataset.act ?? "";
    if (action.startsWith("tab:")) {
      switchTab(action.slice(4) as Tab);
      return;
    }
    switch (action) {
      case "plot": {
        const slot = Number(target.dataset.slot);
        const area = target.dataset.area === "tree" ? "tree" : "crop";
        if (Number.isInteger(slot)) selectSlot(slot, area);
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
      case "harvest":
      case "water":
      case "uproot": {
        if (selectedSlot === null) return;
        if (action === "harvest") harvest(selectedSlot, selectedArea);
        else if (action === "uproot") uproot(selectedSlot, selectedArea);
        else waterSelected(selectedSlot, selectedArea);
        return;
      }
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
        void buyTab();
        return;
      case "waterFriend": {
        if (selectedSlot !== null) void waterFriend(selectedSlot, selectedArea);
        return;
      }
      case "cheer":
        void cheerHost();
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
        sellStack(item, effects);
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
      selectedSlot = null;
      uprootArmed = false;
      render();
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
      if (mode === "owner") uproot(selectedSlot, selectedArea);
    }
  }

  /** @brief Catches the restore input while it is typed. */
  function onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.role === "restore") restoreDraft = target.value;
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
    listen(window, "dyno:nick", () => {
      localIdentity = loadIdentity(identityStorage());
      void syncProfile();
    });
    disposeLocale = onLocaleChange(() => render());

    tickTimer = setInterval(refreshTimers, TICK_MS);
    pollTimer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) void refresh();
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
