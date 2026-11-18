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
  EFFECTS,
  FERTILIZER_PRICE,
  MAX_PATCHES,
  PLOTS_PER_PATCH,
  SEEDS,
  cropSellPrice,
  gardenCounts,
  nextPatchPrice,
  plotView,
  seedById,
  type EffectId,
  type GardenAction,
  type GardenSnapshot,
  type LeaderboardEntry,
  type PlotState,
  type SeasonSnapshot,
  type SeedId,
  type VisitSnapshot,
} from "@dyno/shared/garden";
import { formatDuration, formatNumber, onLocaleChange, t, tList, translateError } from "@/shared/i18n";
import { loadIdentity, type Identity } from "@/shared/lib/identity";
import type { GameContext, GameMount } from "../mount";
import { cellRender, fitText, growthColor, labelValue } from "./ascii";
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
  let page = 0;
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

  /** @brief Plots for the active mode. */
  function currentPlots(): readonly (PlotState | null)[] | null {
    return mode === "visit" ? (visiting?.plots ?? null) : (state?.plots ?? null);
  }

  /** @brief Bought patch count for the active mode. */
  function currentPatches(): number {
    return mode === "visit" ? (visiting?.patches ?? 1) : (state?.patches ?? 1);
  }

  /** @brief Pages to show: owned patches plus one not-yet-bought preview. */
  function pageCount(): number {
    const owned = currentPatches();
    return owned < MAX_PATCHES ? owned + 1 : owned;
  }

  /** @brief Whether the current page is the preview of the next patch. */
  function isPreviewPage(): boolean {
    return page >= currentPatches();
  }

  /** @brief Absolute plot index of the current page's first cell. */
  function pageOffset(): number {
    return page * PLOTS_PER_PATCH;
  }

  /** @brief Price of the next patch, or `null` at the cap. */
  function nextPatchCost(): number | null {
    return currentPatches() >= MAX_PATCHES ? null : nextPatchPrice(currentPatches());
  }

  /** @brief Public share code for the active mode. */
  function currentCode(): string | null {
    return mode === "visit" ? (visiting?.code ?? null) : (state?.code ?? null);
  }

  /** @brief One plot from the active snapshot. */
  function plotAt(slot: number): PlotState | null {
    const plots = currentPlots();
    return plots === null ? null : (plots[slot] ?? null);
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

  /** @brief Harvests one ripe plot. */
  function harvest(slot: number): void {
    const plot = plotAt(slot);
    if (plot === null || state === null || season === null) return;
    const view = plotView(plot, now());
    if (!view.ready) {
      message = { text: translateError("NOT_READY"), kind: "err" };
      render();
      return;
    }
    const gain = cropSellPrice({ seed: plot.seed, effect: plot.effect, qty: 1 }, season);
    void runAction(
      { kind: "harvest", slot },
      t("garden.harvested", { seed: seedName(plot.seed), coins: gain }),
    );
  }

  /** @brief Waters or fertilizes the selected growing crop. */
  function tend(slot: number, kind: "water" | "fertilize"): void {
    const plot = plotAt(slot);
    if (plot === null) return;
    const name = seedName(plot.seed);
    if (kind === "water") {
      void runAction({ kind: "water", slot }, t("garden.watered", { seed: name }));
      return;
    }
    void runAction({ kind: "fertilize", slot }, t("garden.fed", { seed: name }));
  }

  /** @brief Uproots the selected crop after a two-step confirmation. */
  function uproot(slot: number): void {
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
    void runAction({ kind: "uproot", slot }, t("garden.uprooted", { slot: slot + 1 }));
  }

  /** @brief Buys one seed from the current shop rotation. */
  function buySeed(seedId: SeedId): void {
    void runAction(
      { kind: "buySeed", seed: seedId, qty: 1 },
      t("market.bought", { qty: 1, seed: seedName(seedId) }),
    );
  }

  /** @brief Sells one crop stack. */
  function sellStack(seedId: SeedId, effect: EffectId | null): void {
    if (state === null || season === null) return;
    const stack = state.bag.crops.find((entry) => entry.seed === seedId && entry.effect === effect);
    if (stack === undefined) return;
    const gain = cropSellPrice(stack, season) * stack.qty;
    void runAction(
      { kind: "sellCrop", seed: seedId, effect, qty: stack.qty },
      t("market.sold", { seed: seedName(seedId), coins: gain }),
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

  /** @brief Waters one crop on a friend's garden. */
  async function waterFriend(slot: number): Promise<void> {
    if (visiting === null || visitCode === null || busy) return;
    busy = true;
    try {
      await ensureVisitorSession();
      const bundle = await api.waterVisit(visitCode, slot);
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
    render();
  }

  /** @brief Selects one owned plot and shows its detail panel. */
  function selectSlot(slot: number): void {
    const plots = currentPlots();
    if (plots === null || slot < 0 || slot >= plots.length) return;
    selectedSlot = slot;
    uprootArmed = false;
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
    uprootArmed = false;
    render();
  }

  /** @brief Buys the next 3x3 patch and flips to it. */
  async function buyPatch(): Promise<void> {
    if (state === null || busy || mode !== "owner") return;
    const cost = nextPatchCost();
    if (cost === null) return;
    busy = true;
    try {
      const result = await api.act(state.rev, { kind: "buyPatch" });
      state = result.state;
      season = result.season;
      offline = false;
      page = state.patches - 1;
      selectedSlot = null;
      message = { text: t("garden.patchBought", { patch: state.patches }), kind: "ok" };
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
      const counts = gardenCounts(visiting.plots, now());
      return `${t("garden.visitTitle", { nick: visiting.nick })} | ${t("garden.coins")} ${formatNumber(visiting.coins)} | ${t("garden.ready")} ${counts.ready} | ${visiting.online ? t("common.online") : t("common.offlineUser")}`;
    }
    if (state === null) return "";
    const counts = gardenCounts(state.plots, now());
    return `${t("garden.coins")} ${formatNumber(state.coins)} | ${t("garden.ready")} ${counts.ready} | ${t("garden.growing")} ${counts.growing} | ${t("garden.free")} ${counts.free}`;
  }

  /**
   * @brief Builds one plot cell button.
   * @param local Zero-based cell index inside the current page.
   */
  function buildCell(local: number): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "garden-cell";
    cell.dataset.act = "plot";
    cell.dataset.slot = String(pageOffset() + local);
    if (isPreviewPage()) cell.disabled = true;
    for (let index = 0; index < 6; index += 1) {
      const line = document.createElement("span");
      line.className = "garden-cell-line";
      cell.append(line);
    }
    syncCell(cell, pageOffset() + local, now());
    return cell;
  }

  /** @brief Repaints one plot cell from the current snapshot and clock. */
  function syncCell(cell: HTMLButtonElement, slot: number, at: number): void {
    const local = slot - pageOffset();
    const preview = isPreviewPage();
    const plot = preview ? null : plotAt(slot);
    const render = cellRender(plot, at, preview ? 0 : null, local);
    for (let index = 0; index < 6; index += 1) {
      const line = cell.children.item(index);
      if (line instanceof HTMLElement) line.textContent = render.lines[index] ?? "";
    }
    cell.classList.toggle("is-ready", render.ready);
    cell.classList.toggle("is-growing", render.growing);
    cell.classList.toggle("is-empty", render.empty);
    cell.classList.toggle("is-locked", render.locked);
    cell.classList.toggle("is-selected", selectedSlot === slot);
    for (const effect of EFFECTS) {
      cell.classList.toggle(`is-${effect.id}`, plot?.effect === effect.id);
    }
    cell.style.color = render.growing ? growthColor(render.progress) : "";
    const label =
      plot === null
        ? t("garden.empty")
        : `${seedName(plot.seed)}${render.ready ? `, ${t("garden.ready")}` : ""}`;
    cell.setAttribute(
      "aria-label",
      `${t("garden.patch", { patch: page + 1 })} ${t("garden.plot", { slot: local + 1 })} ${label}`,
    );
  }

  /** @brief Builds the plot grid for the current 3x3 patch page. */
  function buildBoard(): HTMLElement {
    const board = div("garden-board");
    for (let row = 0; row < 3; row += 1) {
      const line = div("garden-plot-row");
      for (let column = 0; column < 3; column += 1) line.append(buildCell(row * 3 + column));
      board.append(line);
    }
    return board;
  }

  /** @brief Builds the page strip: prev/next, patch counter and the buy action. */
  function buildPager(): HTMLElement {
    const bar = div("garden-pager");
    bar.append(actionButton("<", "prevPage", page > 0));
    bar.append(span("garden-page", t("garden.page", { page: page + 1, total: pageCount() })));
    bar.append(actionButton(">", "nextPage", page < pageCount() - 1));
    const cost = nextPatchCost();
    if (mode === "owner") {
      if (cost === null) bar.append(span("garden-page-hint", t("garden.patchMax")));
      else {
        const affordable = (state?.coins ?? 0) >= cost;
        bar.append(actionButton(t("garden.buyPatch", { cost }), "buyPatch", affordable));
      }
    }
    return bar;
  }

  /** @brief Fills the detail panel text for the selected plot. */
  function fillDetail(pre: HTMLPreElement, at: number): void {
    const lines: string[] = [];
    const slot = selectedSlot;
    if (slot === null) {
      lines.push(t("garden.noSelection"), "", t("garden.noSelectionHint"));
    } else {
      const plot = plotAt(slot);
      lines.push(
        `// ${t("garden.patch", { patch: page + 1 })} · ${t("garden.plot", { slot: slot - pageOffset() + 1 })}`,
      );
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
        lines.push(
          labelValue(
            t("garden.effect"),
            view.effect === null
              ? t("garden.effectNone")
              : `${t(`effects.${view.effect.id}`)} x${view.effect.multiplier}`,
          ),
        );
        lines.push(
          labelValue(t("garden.readyIn"), view.ready ? t("garden.ready") : formatDuration(view.remainingMs)),
        );
        if (season !== null) {
          lines.push(
            labelValue(
              t("garden.finalSell"),
              `${formatNumber(cropSellPrice({ seed: plot.seed, effect: plot.effect, qty: 1 }, season))}c`,
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
    }
    pre.textContent = lines.join("\n");
  }

  /** @brief Builds the seed picker rows for one empty plot. */
  function buildSeedPicker(slot: number): HTMLElement {
    const wrap = div("garden-seeds");
    wrap.append(span("garden-hint", t("garden.pickSeed", { slot: slot + 1 })));
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
    } else {
      const plot = plotAt(slot);
      if (plot === null) {
        actions.append(buildSeedPicker(slot));
      } else {
        const view = plotView(plot, now());
        if (mode === "owner") {
          actions.append(actionButton(t("garden.harvest"), "harvest", view.ready));
          actions.append(actionButton(t("garden.water"), "water", !view.ready && !plot.watered));
          actions.append(
            actionButton(
              t("garden.fertilize", { cost: FERTILIZER_PRICE }),
              "fertilize",
              !view.ready && !plot.fertilized && (state?.coins ?? 0) >= FERTILIZER_PRICE,
            ),
          );
          actions.append(
            actionButton(uprootArmed ? t("garden.uprootConfirm") : t("garden.uproot"), "uproot"),
          );
        } else {
          actions.append(actionButton(t("garden.waterFriend"), "waterFriend", !view.ready));
          actions.append(actionButton(t("garden.cheer"), "cheer"));
        }
      }
    }
    wrap.append(actions);
    return wrap;
  }

  /** @brief Builds the garden tab: patch pager above the 3x3 board and detail. */
  function buildGarden(): HTMLElement {
    const wrap = div("garden-garden");
    wrap.append(buildPager());
    const layout = div("garden-layout");
    layout.append(buildBoard(), buildDetail());
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
        `${fitText(seedName(stack.seed), 9)}${fitText(stack.effect === null ? "" : t(`effects.${stack.effect}`), 8)}${fitText(`x${stack.qty}`, 4)}${fitText(`${value}c`, 7)}[${t("market.sell")}]`,
        "sell",
      );
      row.dataset.seed = stack.seed;
      row.dataset.effect = stack.effect ?? "plain";
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

    wrap.append(shop, exchange);
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
    for (const cell of root.querySelectorAll<HTMLElement>(".garden-cell[data-slot]")) {
      const slot = Number(cell.dataset.slot);
      if (Number.isInteger(slot) && cell instanceof HTMLButtonElement) syncCell(cell, slot, at);
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
        if (Number.isInteger(slot)) selectSlot(slot);
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
      case "harvest":
      case "water":
      case "fertilize":
      case "uproot": {
        if (selectedSlot === null) return;
        if (action === "harvest") harvest(selectedSlot);
        else if (action === "uproot") uproot(selectedSlot);
        else tend(selectedSlot, action);
        return;
      }
      case "prevPage":
        goPage(-1);
        return;
      case "nextPage":
        goPage(1);
        return;
      case "buyPatch":
        void buyPatch();
        return;
      case "waterFriend": {
        if (selectedSlot !== null) void waterFriend(selectedSlot);
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
        const seedId = target.dataset.seed as SeedId | undefined;
        if (seedId === undefined) return;
        const effect = target.dataset.effect;
        sellStack(seedId, effect === undefined || effect === "plain" ? null : (effect as EffectId));
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
      selectSlot(pageOffset() + digit - 1);
      return;
    }
    if (selectedSlot === null) return;
    if (event.key === "h" || event.key === "H") {
      if (mode === "owner") harvest(selectedSlot);
    } else if (event.key === "w" || event.key === "W") {
      if (mode === "owner") tend(selectedSlot, "water");
      else void waterFriend(selectedSlot);
    } else if (event.key === "f" || event.key === "F") {
      if (mode === "owner") tend(selectedSlot, "fertilize");
    } else if (event.key === "u" || event.key === "U") {
      if (mode === "owner") uproot(selectedSlot);
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
