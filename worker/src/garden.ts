/**
 * @file garden.ts
 * @brief Durable Objects that own ASCII Garden state and its public directory.
 * @details `Garden` is one player's authoritative database row set: plots, bag,
 * wallet, credentials and helper log. `GardenHub` keeps the code→player mapping
 * and the leaderboard, so visits and rankings never scan every garden. The pure
 * economy lives in `garden-rules.ts`; this module only stores, authenticates and
 * publishes.
 */

import { DurableObject } from "cloudflare:workers";
import {
  GARDEN_PROTOCOL_VERSION,
  GUEST_WATER_CUT_RATIO,
  CROPS_PER_TAB,
  MAX_TABS,
  PLOTS_PER_PATCH,
  TREES_PER_TAB,
  REGISTERS_PER_WINDOW,
  REGISTER_WINDOW_MS,
  parseGardenAction,
  cropKey,
  parseCropKey,
  applyMarket,
  seasonAt,
  type CropStack,
  type GardenAction,
  type GardenSnapshot,
  type LeaderboardEntry,
  type PlotState,
  type ActiveFertilizer,
  type ActiveSpray,
  type EffectId,
  type SeasonSnapshot,
  effectById,
  type SeedId,
  type SupplyId,
  type TreeId,
  type TreeState,
  type VisitSnapshot,
  type VisitorSummary,
} from "@dyno/shared/garden";
import { DEFAULT_COLOR, sanitizeColor, sanitizeNick } from "@dyno/shared/protocol";
import type { Env } from "./env";
import { json, readJson } from "./http";
import {
  applyGardenAction,
  createLedger,
  emptyCrops,
  emptyTrees,
  ledgerSnapshot,
  type GardenLedger,
} from "./garden-rules";
import { timingSafeEqualHex } from "./pass";
import { randomRecoveryKey, randomToken, sha256Hex } from "./secrets";
import type { SqlRow } from "./sql";

/** Name of the singleton Hub object. */
export const HUB_NAME = "hub";

/** Header carrying the raw write token from the Worker to a garden object. */
export const GARDEN_TOKEN_HEADER = "x-dyno-garden-token";

/** Header carrying market multipliers from the Worker to a garden object. */
export const MARKET_HEADER = "x-dyno-market";

/** Owners seen less than this long ago count as online visitors see it. */
export const ONLINE_WINDOW_MS = 30_000;

/** Visitors listed on a garden page. */
export const VISITOR_LIMIT = 12;

/**
 * @brief Derives the owned patch count from a stored meta row.
 * @param value Stored metadata; saves written before the 3x3 patch model only
 * carry `unlocked`, so those gardens keep their old unlock count as one patch.
 * @details Never reduces what a player already had: a legacy garden with four
 * unlocked plots becomes one fully usable 3x3 patch, with every planted crop kept.
 */
export function deriveTabs(value: { tabs?: unknown; patches?: unknown; unlocked?: unknown }): number {
  if (typeof value.tabs === "number" && Number.isInteger(value.tabs) && value.tabs >= 1) {
    return Math.min(MAX_TABS, value.tabs);
  }
  const patches =
    typeof value.patches === "number" && Number.isFinite(value.patches) && value.patches >= 1
      ? value.patches
      : typeof value.unlocked === "number" && Number.isFinite(value.unlocked)
        ? Math.max(1, Math.ceil(value.unlocked / PLOTS_PER_PATCH))
        : 1;
  // Old saves only had `patches * 9` crop and tree slots; promote to enough tabs
  // for both grids so no planted slot is dropped.
  const oldCropSlots = patches * PLOTS_PER_PATCH;
  return Math.min(
    MAX_TABS,
    Math.max(1, Math.ceil(oldCropSlots / CROPS_PER_TAB), Math.ceil(oldCropSlots / TREES_PER_TAB)),
  );
}

/**
 * @brief Derives which crop patches are open in each tab.
 * @param stored Value from an old or current save.
 * @param plots Read crop rows, used to keep every planted slot reachable.
 * @param tabs Owned tab count.
 */
export function deriveUnlockedPatches(stored: unknown, plots: (PlotState | null)[], tabs: number): number[] {
  const patches: number[] = [];
  for (let tab = 0; tab < tabs; tab += 1) {
    let open = 1;
    const local = Array.isArray(stored) && typeof stored[tab] === "number" ? stored[tab] : 0;
    if (Number.isFinite(local)) open = Math.min(PLOTS_PER_PATCH, Math.max(1, Math.floor(local)));
    // Never lock a slot that already holds a plant from an older layout.
    for (let patch = 0; patch < PLOTS_PER_PATCH; patch += 1) {
      for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
        const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
        if ((plots[slot] ?? null) !== null) open = Math.max(open, patch + 1);
      }
    }
    patches.push(open);
  }
  return patches;
}

/**
 * @brief Units of each item removed from the bag by one action.
 * @param before Bag before the action.
 * @param after Bag after the action.
 */
export function soldDiff(before: readonly CropStack[], after: readonly CropStack[]): Record<string, number> {
  const sold: Record<string, number> = {};
  for (const stack of before) {
    const left = after.find(
      (entry) =>
        entry.item === stack.item &&
        cropKey(entry.item, entry.effects) === cropKey(stack.item, stack.effects),
    );
    const removed = stack.qty - (left?.qty ?? 0);
    if (removed > 0) sold[stack.item] = (sold[stack.item] ?? 0) + removed;
  }
  return sold;
}

/** Stored metadata: the ledger minus the rows kept in their own tables. */
type StoredMeta = Omit<GardenLedger, "plots" | "trees" | "bag">;

type MetaRow = SqlRow<{ value: string }>;

type PlotRow = SqlRow<{
  slot: number;
  seed: string;
  planted_at: number;
  ready_at: number;
  effect: string | null;
  watered: number;
  fertilized: number;
  harvests: number;
  fertilizer: string | null;
  spray: string | null;
}>;

type TreeRow = SqlRow<{
  slot: number;
  tree: string;
  planted_at: number;
  ready_at: number;
  effect: string | null;
  watered: number;
  fertilized: number;
  harvests: number;
  fertilizer: string | null;
  spray: string | null;
}>;

type BagRow = SqlRow<{ kind: string; item: string; qty: number }>;

type VisitorRow = SqlRow<{
  player_id: string;
  nick: string;
  color: string;
  visited_at: number;
  waters: number;
  cheers: number;
}>;

/** @brief One authoritative garden. */
export class Garden extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  /** @brief Creates the tables on first use and after a reset. */
  private ensureSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plots (
        slot INTEGER PRIMARY KEY,
        seed TEXT NOT NULL,
        planted_at INTEGER NOT NULL,
        ready_at INTEGER NOT NULL,
        effect TEXT,
        watered INTEGER NOT NULL DEFAULT 0,
        fertilized INTEGER NOT NULL DEFAULT 0,
        harvests INTEGER NOT NULL DEFAULT 0,
        fertilizer TEXT,
        spray TEXT
      );
      CREATE TABLE IF NOT EXISTS trees (
        slot INTEGER PRIMARY KEY,
        tree TEXT NOT NULL,
        planted_at INTEGER NOT NULL,
        ready_at INTEGER NOT NULL,
        effect TEXT,
        watered INTEGER NOT NULL DEFAULT 0,
        fertilized INTEGER NOT NULL DEFAULT 0,
        harvests INTEGER NOT NULL DEFAULT 0,
        fertilizer TEXT,
        spray TEXT
      );
      CREATE TABLE IF NOT EXISTS bag (
        kind TEXT NOT NULL,
        item TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (kind, item)
      );
      CREATE TABLE IF NOT EXISTS visitors (
        player_id TEXT PRIMARY KEY,
        nick TEXT NOT NULL,
        color TEXT NOT NULL,
        visited_at INTEGER NOT NULL,
        waters INTEGER NOT NULL DEFAULT 0,
        cheers INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Existing gardens predate the reharvest counter: add the column in place,
    // keeping every plot row and every other column untouched.
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(plots)").toArray();
    if (!columns.some((column) => column.name === "harvests")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN harvests INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "fertilizer")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN fertilizer TEXT");
    }
    if (!columns.some((column) => column.name === "spray")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN spray TEXT");
    }
    const treeColumns = this.sql.exec<{ name: string }>("PRAGMA table_info(trees)").toArray();
    if (!treeColumns.some((column) => column.name === "fertilizer")) {
      this.sql.exec("ALTER TABLE trees ADD COLUMN fertilizer TEXT");
    }
    if (!treeColumns.some((column) => column.name === "spray")) {
      this.sql.exec("ALTER TABLE trees ADD COLUMN spray TEXT");
    }
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS help (
        visitor_id TEXT NOT NULL,
        slot INTEGER NOT NULL,
        day INTEGER NOT NULL,
        PRIMARY KEY (visitor_id, slot, day)
      );
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/register") return this.register(request);
    if (request.method === "GET" && url.pathname === "/state") return this.state(request);
    if (request.method === "POST" && url.pathname === "/act") return this.act(request);
    if (request.method === "GET" && url.pathname === "/snapshot") return this.snapshot();
    if (request.method === "POST" && url.pathname === "/profile") return this.profile(request);
    if (request.method === "POST" && url.pathname === "/recovery") return this.rotateRecovery(request);
    if (request.method === "POST" && url.pathname === "/issue-token") return this.issueToken(request);
    if (request.method === "POST" && url.pathname === "/identity") return this.identity(request);
    if (request.method === "POST" && url.pathname === "/water-guest") return this.waterGuest(request);
    if (request.method === "POST" && url.pathname === "/cheer-guest") return this.cheerGuest(request);
    if (request.method === "POST" && url.pathname === "/destroy") return this.destroy();
    return json({ code: "NOT_FOUND" }, 404);
  }

  // ---------------------------------------------------------------- storage

  /** @brief Reads the whole ledger, or `null` when this garden never registered. */
  private read(): GardenLedger | null {
    const row = this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'ledger'").toArray()[0];
    if (row === undefined) return null;
    const raw = JSON.parse(row.value) as StoredMeta & { patches?: number; unlocked?: number };
    // Old saves keep their planted slots; only the tab count is derived.
    const tabs = deriveTabs(raw);
    const plots = this.readPlots(tabs);
    const meta: StoredMeta = {
      ...raw,
      tabs,
      unlockedPatches: deriveUnlockedPatches(raw.unlockedPatches, plots, tabs),
    };
    return {
      ...meta,
      plots,
      trees: this.readTrees(tabs),
      bag: this.readBag(),
    };
  }

  /**
   * @brief Reads the plot rows into a dense vector for the owned patches.
   * @param patches Owned patch count.
   */
  private readPlots(tabs: number): (PlotState | null)[] {
    const plots = emptyCrops(tabs);
    const rows = this.sql
      .exec<PlotRow>(
        "SELECT slot, seed, planted_at, ready_at, effect, watered, fertilized, harvests, fertilizer, spray FROM plots",
      )
      .toArray();
    for (const row of rows) {
      plots[row.slot] = {
        slot: row.slot,
        seed: row.seed as SeedId,
        plantedAt: row.planted_at,
        readyAt: row.ready_at,
        effects: parseEffects(row.effect),
        watered: row.watered === 1,
        fertilized: row.fertilized === 1,
        harvests: row.harvests,
        fertilizer: parseFertilizer(row.fertilizer),
        spray: parseSpray(row.spray),
      };
    }
    return plots;
  }

  /**
   * @brief Reads the tree rows into a dense vector for the owned patches.
   * @param patches Owned patch count.
   */
  private readTrees(tabs: number): (TreeState | null)[] {
    const trees = emptyTrees(tabs);
    const rows = this.sql
      .exec<TreeRow>(
        "SELECT slot, tree, planted_at, ready_at, effect, watered, fertilized, harvests, fertilizer, spray FROM trees",
      )
      .toArray();
    for (const row of rows) {
      trees[row.slot] = {
        slot: row.slot,
        tree: row.tree as TreeId,
        plantedAt: row.planted_at,
        readyAt: row.ready_at,
        effects: parseEffects(row.effect),
        watered: row.watered === 1,
        fertilized: row.fertilized === 1,
        harvests: row.harvests,
        fertilizer: parseFertilizer(row.fertilizer),
        spray: parseSpray(row.spray),
      };
    }
    return trees;
  }

  /** @brief Reads the bag rows into seeds plus crop stacks. */
  private readBag(): GardenLedger["bag"] {
    const seeds: Partial<Record<SeedId, number>> = {};
    const crops: CropStack[] = [];
    const supplies: Partial<Record<SupplyId, number>> = {};
    const rows = this.sql.exec<BagRow>("SELECT kind, item, qty FROM bag").toArray();
    for (const row of rows) {
      if (row.kind === "seed") {
        seeds[row.item as SeedId] = row.qty;
        continue;
      }
      if (row.kind === "supply") {
        supplies[row.item as SupplyId] = row.qty;
        continue;
      }
      const parsed = parseCropKey(row.item);
      if (parsed !== null) crops.push({ item: parsed.item, effects: parsed.effects, qty: row.qty });
    }
    return { seeds, crops, supplies };
  }

  /** @brief Writes a complete ledger atomically, so a crash cannot lose the old one. */
  private write(ledger: GardenLedger): void {
    this.ctx.storage.transactionSync(() => this.writeRows(ledger));
  }

  /** @brief Replaces the plot and bag rows of one ledger. */
  private writeRows(ledger: GardenLedger): void {
    const { plots, trees, bag, ...meta } = ledger;
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('ledger', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(meta),
    );
    this.sql.exec("DELETE FROM plots");
    for (const plot of plots) {
      if (plot === null) continue;
      this.sql.exec(
        "INSERT INTO plots (slot, seed, planted_at, ready_at, effect, watered, fertilized, harvests, fertilizer, spray) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        plot.slot,
        plot.seed,
        plot.plantedAt,
        plot.readyAt,
        JSON.stringify(plot.effects),
        plot.watered ? 1 : 0,
        plot.fertilized ? 1 : 0,
        plot.harvests,
        plot.fertilizer === null ? null : JSON.stringify(plot.fertilizer),
        plot.spray === null ? null : JSON.stringify(plot.spray),
      );
    }
    this.sql.exec("DELETE FROM trees");
    for (const tree of trees) {
      if (tree === null) continue;
      this.sql.exec(
        "INSERT INTO trees (slot, tree, planted_at, ready_at, effect, watered, fertilized, harvests, fertilizer, spray) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        tree.slot,
        tree.tree,
        tree.plantedAt,
        tree.readyAt,
        JSON.stringify(tree.effects),
        tree.watered ? 1 : 0,
        tree.fertilized ? 1 : 0,
        tree.harvests,
        tree.fertilizer === null ? null : JSON.stringify(tree.fertilizer),
        tree.spray === null ? null : JSON.stringify(tree.spray),
      );
    }
    this.sql.exec("DELETE FROM bag");
    for (const [supply, qty] of Object.entries(bag.supplies)) {
      if (qty === undefined || qty <= 0) continue;
      this.sql.exec("INSERT INTO bag (kind, item, qty) VALUES ('supply', ?, ?)", supply, qty);
    }
    for (const [seed, qty] of Object.entries(bag.seeds)) {
      if (qty === undefined || qty <= 0) continue;
      this.sql.exec("INSERT INTO bag (kind, item, qty) VALUES ('seed', ?, ?)", seed, qty);
    }
    for (const stack of bag.crops) {
      const item = cropKey(stack.item, stack.effects);
      this.sql.exec("INSERT INTO bag (kind, item, qty) VALUES ('crop', ?, ?)", item, stack.qty);
    }
  }

  /** @brief Deletes every row; used to roll back a failed registration. */
  private destroy(): Response {
    for (const table of ["meta", "plots", "trees", "bag", "visitors", "help"]) {
      this.sql.exec(`DELETE FROM ${table}`);
    }
    return json({ ok: true });
  }

  // ------------------------------------------------------------------- auth

  /** @brief Authenticates one owner request against the stored token digest. */
  private async authorize(request: Request): Promise<GardenLedger | null> {
    const token = request.headers.get(GARDEN_TOKEN_HEADER);
    if (token === null || token.length !== 64) return null;
    const ledger = this.read();
    if (ledger === null) return null;
    const digest = await sha256Hex(token);
    return timingSafeEqualHex(digest, ledger.tokenHash) ? ledger : null;
  }

  /** @brief Standard unauthorized response. */
  private unauthorized(): Response {
    return json({ code: "UNAUTHORIZED" }, 401);
  }

  // --------------------------------------------------------------- lifetime

  /** @brief Registers a brand-new garden and mints its write token. */
  private async register(request: Request): Promise<Response> {
    if (this.read() !== null) return json({ code: "BAD_REQUEST" }, 400);

    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const code = typeof body.code === "string" ? body.code : "";
    const recoveryHash = typeof body.recoveryHash === "string" ? body.recoveryHash : "";
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (playerId.length === 0 || code.length === 0 || recoveryHash.length !== 64 || !nick.ok) {
      return json({ code: "BAD_REQUEST" }, 400);
    }

    const now = Date.now();
    const token = randomToken();
    const ledger = createLedger({
      playerId,
      nick: nick.nick,
      color: sanitizeColor(body.color),
      code,
      tokenHash: await sha256Hex(token),
      recoveryHash,
      now,
    });
    this.write(ledger);
    return json({
      token,
      state: ledgerSnapshot(ledger),
      season: seasonAt(now),
      serverNow: now,
    });
  }

  /**
   * @brief Applies the market multipliers the Worker forwarded with the request.
   * @param request Internal request carrying `x-dyno-market` (URI-encoded JSON).
   * @param now Server clock.
   * @details Selling and previews must agree with the shared board, so the season
   * used for rules already includes market pressure.
   */
  private seasonFor(request: Request, now: number): SeasonSnapshot {
    const season = seasonAt(now);
    const raw = request.headers.get(MARKET_HEADER);
    if (raw === null) return season;
    try {
      const multipliers = JSON.parse(decodeURIComponent(raw)) as Partial<Record<string, number>>;
      const typed: Partial<Record<string, number>> = {};
      for (const [item, value] of Object.entries(multipliers)) {
        if (typeof value === "number" && Number.isFinite(value)) typed[item] = value;
      }
      return applyMarket(season, typed);
    } catch {
      return season;
    }
  }

  /** @brief Returns the owner snapshot and refreshes the presence stamp. */
  private async state(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();

    const now = Date.now();
    if (now - ledger.lastSeen > 10_000) {
      ledger.lastSeen = now;
      this.write(ledger);
    }
    return json({
      state: ledgerSnapshot(ledger),
      season: this.seasonFor(request, now),
      serverNow: now,
    });
  }

  /** @brief Applies one owner action against the current revision. */
  private async act(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();

    const body = await readJson(request);
    if (typeof body.rev !== "number" || body.rev !== ledger.rev) {
      return json({ code: "STALE_REV" }, 409);
    }
    const action = parseGardenAction(body.action);
    if (action === null) return json({ code: "BAD_REQUEST" }, 400);

    const now = Date.now();
    const season = this.seasonFor(request, now);
    const result = applyGardenAction(ledger, action as GardenAction, season, now);
    if (!result.ok) return json({ code: result.code }, 400);

    this.write(result.ledger);
    await this.publish(result.ledger);
    return json({
      state: ledgerSnapshot(result.ledger),
      season,
      serverNow: now,
      sold: soldDiff(ledger.bag.crops, result.ledger.bag.crops),
    });
  }

  /** @brief Renames the player without touching the garden identity. */
  private async profile(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();

    const body = await readJson(request);
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (!nick.ok) return json({ code: "BAD_REQUEST" }, 400);

    const now = Date.now();
    ledger.nick = nick.nick;
    ledger.color = sanitizeColor(body.color);
    this.write(ledger);
    await this.publish(ledger);
    return json({ state: ledgerSnapshot(ledger), season: seasonAt(now), serverNow: now });
  }

  /** @brief Mints a new recovery key, invalidating the old one. */
  private async rotateRecovery(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();

    const recovery = randomRecoveryKey();
    ledger.recoveryHash = await sha256Hex(recovery);
    this.write(ledger);
    return json({ recovery });
  }

  /** @brief Exchanges a recovery key digest for a fresh write token. */
  private async issueToken(request: Request): Promise<Response> {
    const ledger = this.read();
    if (ledger === null) return json({ code: "NO_GARDEN" }, 404);

    const body = await readJson(request);
    const recoveryHash = typeof body.recoveryHash === "string" ? body.recoveryHash : "";
    if (!timingSafeEqualHex(recoveryHash, ledger.recoveryHash)) {
      return json({ code: "BAD_RECOVERY" }, 400);
    }

    const now = Date.now();
    const token = randomToken();
    ledger.tokenHash = await sha256Hex(token);
    ledger.rev += 1;
    ledger.updatedAt = now;
    ledger.lastSeen = now;
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (nick.ok) ledger.nick = nick.nick;
    if (typeof body.color === "string") ledger.color = sanitizeColor(body.color);
    this.write(ledger);
    await this.publish(ledger);
    return json({ token, state: ledgerSnapshot(ledger), season: seasonAt(now), serverNow: now });
  }

  /** @brief Verifies a token and returns the identity behind it. */
  private async identity(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();
    return json({ playerId: ledger.playerId, nick: ledger.nick, color: ledger.color });
  }

  // ------------------------------------------------------------------ visits

  /** @brief Public read-only snapshot used by the visit page. */
  private snapshot(): Response {
    const ledger = this.read();
    if (ledger === null) return json({ code: "NO_GARDEN" }, 404);
    const now = Date.now();
    return json({ garden: this.visitSnapshot(ledger, now), season: seasonAt(now), serverNow: now });
  }

  /** @brief Builds the public projection of one garden. */
  private visitSnapshot(ledger: GardenLedger, now: number): VisitSnapshot {
    return {
      nick: ledger.nick,
      color: ledger.color,
      code: ledger.code,
      coins: ledger.coins,
      tabs: ledger.tabs,
      unlockedPatches: [...ledger.unlockedPatches],
      plots: ledger.plots.map((plot) => (plot === null ? null : { ...plot })),
      trees: ledger.trees.map((tree) => (tree === null ? null : { ...tree })),
      bag: {
        seeds: { ...ledger.bag.seeds },
        crops: ledger.bag.crops.map((stack) => ({ ...stack })),
        supplies: { ...ledger.bag.supplies },
      },
      stats: { ...ledger.stats },
      updatedAt: ledger.updatedAt,
      lastSeen: ledger.lastSeen,
      online: now - ledger.lastSeen < ONLINE_WINDOW_MS,
      visitors: this.visitors(),
    };
  }

  /** @brief Reads the helper log, most recent first. */
  private visitors(): VisitorSummary[] {
    const rows = this.sql
      .exec<VisitorRow>(
        "SELECT player_id, nick, color, visited_at, waters, cheers FROM visitors ORDER BY visited_at DESC LIMIT ?",
        VISITOR_LIMIT,
      )
      .toArray();
    return rows.map((row) => ({
      playerId: row.player_id,
      nick: row.nick,
      color: row.color,
      visitedAt: row.visited_at,
      waters: row.waters,
      cheers: row.cheers,
    }));
  }

  /** @brief Applies one guest watering and records the helper. */
  private async waterGuest(request: Request): Promise<Response> {
    const ledger = this.read();
    if (ledger === null) return json({ code: "NO_GARDEN" }, 404);

    const body = await readJson(request);
    const visitorId = typeof body.visitorId === "string" ? body.visitorId : "";
    const slot = body.slot;
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (visitorId.length === 0 || typeof slot !== "number" || !Number.isInteger(slot) || !nick.ok) {
      return json({ code: "BAD_REQUEST" }, 400);
    }
    const target = body.tree === true ? ledger.trees : ledger.plots;
    if (slot < 0 || slot >= target.length) return json({ code: "BAD_REQUEST" }, 400);

    const plant = target[slot] ?? null;
    const now = Date.now();
    if (plant === null) return json({ code: "PLOT_EMPTY" }, 400);
    if (now >= plant.readyAt) return json({ code: "NOT_READY" }, 400);

    const day = Math.floor(now / 86_400_000);
    const helpSlot = body.tree === true ? 100 + slot : slot;
    const helped = this.sql
      .exec<SqlRow<{ one: number }>>(
        "SELECT 1 AS one FROM help WHERE visitor_id = ? AND slot = ? AND day = ?",
        visitorId,
        helpSlot,
        day,
      )
      .toArray();
    if (helped.length > 0) return json({ code: "ALREADY_WATERED" }, 409);

    const remaining = plant.readyAt - now;
    const next = {
      ...plant,
      readyAt: Math.max(now + 1_000, plant.readyAt - Math.round(remaining * GUEST_WATER_CUT_RATIO)),
    };
    if (body.tree === true) ledger.trees[slot] = next as TreeState;
    else ledger.plots[slot] = next as PlotState;
    ledger.rev += 1;
    ledger.updatedAt = now;
    this.sql.exec("INSERT INTO help (visitor_id, slot, day) VALUES (?, ?, ?)", visitorId, helpSlot, day);
    this.recordVisitor(visitorId, nick.nick, sanitizeColor(body.color), now, 1, 0);
    this.write(ledger);
    await this.publish(ledger);
    return json({ garden: this.visitSnapshot(ledger, now), season: seasonAt(now), serverNow: now });
  }

  /** @brief Records one cheer without touching the plots. */
  private async cheerGuest(request: Request): Promise<Response> {
    const ledger = this.read();
    if (ledger === null) return json({ code: "NO_GARDEN" }, 404);

    const body = await readJson(request);
    const visitorId = typeof body.visitorId === "string" ? body.visitorId : "";
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (visitorId.length === 0 || !nick.ok) return json({ code: "BAD_REQUEST" }, 400);

    const now = Date.now();
    this.recordVisitor(visitorId, nick.nick, sanitizeColor(body.color), now, 0, 1);
    return json({ garden: this.visitSnapshot(ledger, now), season: seasonAt(now), serverNow: now });
  }

  /** @brief Upserts one visitor row, accumulating helpers. */
  private recordVisitor(
    playerId: string,
    nick: string,
    color: string,
    now: number,
    waters: number,
    cheers: number,
  ): void {
    this.sql.exec(
      `INSERT INTO visitors (player_id, nick, color, visited_at, waters, cheers)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         nick = excluded.nick,
         color = excluded.color,
         visited_at = excluded.visited_at,
         waters = visitors.waters + excluded.waters,
         cheers = visitors.cheers + excluded.cheers`,
      playerId,
      nick,
      color,
      now,
      waters,
      cheers,
    );
  }

  /** @brief Publishes leaderboard fields to the Hub; failures never block play. */
  private async publish(ledger: GardenLedger): Promise<void> {
    try {
      const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
      await hub.fetch("https://hub/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: ledger.playerId,
          nick: ledger.nick,
          color: ledger.color,
          earned: ledger.stats.earned,
          harvested: ledger.stats.harvested,
          now: ledger.updatedAt,
        }),
      });
    } catch {
      // A stale leaderboard row is preferable to a failed harvest.
    }
  }
}

/** @brief Parses an effect cell: a JSON list, or one legacy effect string. */
function parseEffects(raw: string | null): EffectId[] {
  if (raw === null || raw.length === 0) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (Array.isArray(value)) {
      const parsed: EffectId[] = [];
      for (const entry of value) {
        if (typeof entry === "string" && effectById(entry) !== undefined) parsed.push(entry as EffectId);
      }
      return parsed;
    }
    if (typeof value === "string" && effectById(value) !== undefined) return [value as EffectId];
    return [];
  } catch {
    return effectById(raw) === undefined ? [] : [raw as EffectId];
  }
}

/** @brief Parses a stored fertilizer JSON cell. */
function parseFertilizer(raw: string | null): ActiveFertilizer | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { id?: unknown; left?: unknown };
    if (typeof value.id !== "string" || typeof value.left !== "number") return null;
    return { id: value.id as ActiveFertilizer["id"], left: value.left };
  } catch {
    return null;
  }
}

/** @brief Parses a stored spray JSON cell. */
function parseSpray(raw: string | null): ActiveSpray | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { id?: unknown; left?: unknown };
    if (typeof value.id !== "string" || typeof value.left !== "number") return null;
    return { id: value.id as ActiveSpray["id"], left: value.left };
  } catch {
    return null;
  }
}

/** One row of the public garden directory. */
type GardenRow = SqlRow<{
  player_id: string;
  code: string;
  nick: string;
  color: string;
  earned: number;
  harvested: number;
  updated_at: number;
  recovery_hash: string;
}>;

type CreateRow = SqlRow<{ window_start: number; count: number }>;

/** @brief Code directory and leaderboard for every garden. */
export class GardenHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private ensureSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS gardens (
        player_id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        nick TEXT NOT NULL,
        color TEXT NOT NULL,
        earned INTEGER NOT NULL DEFAULT 0,
        harvested INTEGER NOT NULL DEFAULT 0,
        recovery_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS creates (
        ip TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/register") return this.register(request);
    if (request.method === "POST" && url.pathname === "/upsert") return this.upsert(request);
    if (request.method === "GET" && url.pathname === "/by-code") return this.byCode(url);
    if (request.method === "GET" && url.pathname === "/by-recovery") return this.byRecovery(url);
    if (request.method === "GET" && url.pathname === "/leaderboard") return this.leaderboard(url);
    if (request.method === "POST" && url.pathname === "/remove") return this.remove(request);
    if (request.method === "GET" && url.pathname === "/info") return this.info();

    return json({ code: "NOT_FOUND" }, 404);
  }

  /** @brief Registers one garden row, enforcing the per-IP create budget. */
  private async register(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const code = typeof body.code === "string" ? body.code : "";
    const recoveryHash = typeof body.recoveryHash === "string" ? body.recoveryHash : "";
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    const ip = typeof body.ip === "string" && body.ip.length > 0 ? body.ip : "unknown";
    const now = typeof body.now === "number" ? body.now : Date.now();
    if (playerId.length === 0 || code.length === 0 || recoveryHash.length !== 64 || !nick.ok) {
      return json({ code: "BAD_REQUEST" }, 400);
    }

    if (!this.allowCreate(ip, now)) return json({ code: "TRY_LATER" }, 429);
    if (this.codeTaken(code)) return json({ code: "CODE_EXISTS" }, 409);

    this.sql.exec(
      "INSERT INTO gardens (player_id, code, nick, color, earned, harvested, recovery_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)",
      playerId,
      code,
      nick.nick,
      sanitizeColor(body.color),
      recoveryHash,
      now,
      now,
    );
    return json({ ok: true }, 201);
  }

  /** @brief Updates the leaderboard-visible fields of one garden. */
  private async upsert(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    if (playerId.length === 0) return json({ code: "BAD_REQUEST" }, 400);
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    const earned = typeof body.earned === "number" ? Math.max(0, Math.floor(body.earned)) : 0;
    const harvested = typeof body.harvested === "number" ? Math.max(0, Math.floor(body.harvested)) : 0;
    const now = typeof body.now === "number" ? body.now : Date.now();
    this.sql.exec(
      "UPDATE gardens SET nick = ?, color = ?, earned = ?, harvested = ?, updated_at = ? WHERE player_id = ?",
      nick.ok ? nick.nick : "",
      sanitizeColor(body.color),
      earned,
      harvested,
      now,
      playerId,
    );
    return json({ ok: true });
  }

  /** @brief Looks a garden up by its public share code. */
  private byCode(url: URL): Response {
    const code = url.searchParams.get("code") ?? "";
    const row = this.sql.exec<GardenRow>("SELECT player_id FROM gardens WHERE code = ?", code).toArray()[0];
    if (row === undefined) return json({ code: "NO_GARDEN" }, 404);
    return json({ playerId: row.player_id });
  }

  /** @brief Looks a garden up by recovery digest, for restore. */
  private byRecovery(url: URL): Response {
    const hash = url.searchParams.get("hash") ?? "";
    const row = this.sql
      .exec<GardenRow>("SELECT player_id FROM gardens WHERE recovery_hash = ?", hash)
      .toArray()[0];
    if (row === undefined) return json({ code: "BAD_RECOVERY" }, 404);
    return json({ playerId: row.player_id });
  }

  /** @brief Top gardens by earned coins. */
  private leaderboard(url: URL): Response {
    const raw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isInteger(raw) ? Math.min(50, Math.max(1, raw)) : 20;
    const rows = this.sql
      .exec<GardenRow>(
        "SELECT code, nick, color, earned, harvested, updated_at FROM gardens ORDER BY earned DESC, harvested DESC, updated_at ASC LIMIT ?",
        limit,
      )
      .toArray();
    const entries: LeaderboardEntry[] = rows.map((row) => ({
      code: row.code,
      nick: row.nick,
      color: row.color,
      earned: row.earned,
      harvested: row.harvested,
      updatedAt: row.updated_at,
    }));
    return json({ entries });
  }

  /** @brief Removes one garden row, used to roll back a failed register. */
  private async remove(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    if (playerId.length > 0) this.sql.exec("DELETE FROM gardens WHERE player_id = ?", playerId);
    return json({ ok: true });
  }

  /** @brief Small diagnostics payload for tests and maintenance. */
  private info(): Response {
    const rows = this.sql.exec<SqlRow<{ n: number }>>("SELECT COUNT(*) AS n FROM gardens").toArray();
    return json({ gardens: rows[0]?.n ?? 0 });
  }

  /** @brief Whether a code is already taken. */
  private codeTaken(code: string): boolean {
    return this.sql.exec("SELECT 1 FROM gardens WHERE code = ?", code).toArray().length > 0;
  }

  /** @brief Per-IP registration budget, mirroring the room lobby. */
  private allowCreate(ip: string, now: number): boolean {
    const row = this.sql
      .exec<CreateRow>("SELECT window_start, count FROM creates WHERE ip = ?", ip)
      .toArray()[0];
    if (row === undefined || now - row.window_start > REGISTER_WINDOW_MS) {
      this.sql.exec(
        "INSERT INTO creates (ip, window_start, count) VALUES (?, ?, 1) ON CONFLICT(ip) DO UPDATE SET window_start = excluded.window_start, count = 1",
        ip,
        now,
      );
      return true;
    }
    if (row.count >= REGISTERS_PER_WINDOW) return false;
    this.sql.exec("UPDATE creates SET count = count + 1 WHERE ip = ?", ip);
    return true;
  }
}

/** Kept for the wire version check performed by the API layer. */
export const GARDEN_WIRE_VERSION = GARDEN_PROTOCOL_VERSION;

/** Re-exported color default so the API layer has one import point. */
export const GARDEN_DEFAULT_COLOR = DEFAULT_COLOR;
