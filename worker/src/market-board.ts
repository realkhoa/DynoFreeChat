/**
 * @file market-board.ts
 * @brief Global market pressure: one row per sellable item, retuned every six minutes.
 * @details Sales are reported by the garden objects; at each cycle boundary the
 * board moves every multiplier from the previous cycle's volume (no sales raise
 * the price, heavy sales crash it, floored at 30% and capped at 600%). The
 * board is a singleton Durable Object, so every player sees the same prices.
 */

import { DurableObject } from "cloudflare:workers";
import {
  MARKET_CYCLE_MS,
  MARKET_SOLD_TARGET,
  MARKET_MAX_MULTIPLIER,
  MARKET_MIN_MULTIPLIER,
  itemById,
  marketBaseItems,
  marketCycleAt,
  marketCycleEndsAt,
  nextMarketMultiplier,
  seasonAt,
  type ItemId,
  type MarketQuoteItem,
  type MarketSnapshot,
} from "@dyno/shared/garden";
import type { Env } from "./env";
import { json, readJson } from "./http";
import type { SqlRow } from "./sql";

/** Singleton name of the market board. */
export const MARKET_BOARD_NAME = "board";

type MetaRow = SqlRow<{ value: string }>;

type SaleRow = SqlRow<{ item: string; qty: number }>;

/** Persisted board state. */
interface BoardState {
  /** Cycle the multipliers belong to. */
  cycle: number;
  /** Current multiplier per item. */
  multipliers: Record<string, number>;
  /** Multipliers from the cycle before, for the trend arrow. */
  previous: Record<string, number>;
}

/** @brief One global market board. */
export class MarketBoard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private ensureSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sales (
        cycle INTEGER NOT NULL,
        item TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (cycle, item)
      );
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/record") return this.record(request);
    if (request.method === "GET" && url.pathname === "/snapshot") return json(this.snapshot(Date.now()));
    return json({ code: "NOT_FOUND" }, 404);
  }

  /** @brief Records sold units for the running cycle. */
  private async record(request: Request): Promise<Response> {
    const body = await readJson(request);
    const item = typeof body.item === "string" ? itemById(body.item) : undefined;
    const qty = typeof body.qty === "number" && Number.isFinite(body.qty) ? Math.floor(body.qty) : 0;
    if (item === undefined || qty < 1 || qty > 999) return json({ code: "BAD_REQUEST" }, 400);

    const now = Date.now();
    this.roll(now);
    this.sql.exec(
      "INSERT INTO sales (cycle, item, qty) VALUES (?, ?, ?) ON CONFLICT(cycle, item) DO UPDATE SET qty = qty + excluded.qty",
      marketCycleAt(now),
      item.id,
      qty,
    );
    return json({ ok: true });
  }

  /** @brief Builds the public market snapshot. */
  private snapshot(now: number): MarketSnapshot {
    this.roll(now);
    const state = this.readState(now);
    const cycle = marketCycleAt(now);
    const season = seasonAt(now);
    const sold = new Map<string, number>();
    for (const row of this.sql
      .exec<SaleRow>("SELECT item, qty FROM sales WHERE cycle = ?", cycle)
      .toArray()) {
      sold.set(row.item, row.qty);
    }

    const items: MarketQuoteItem[] = marketBaseItems(season).map(({ item, base }) => {
      const multiplier = state.multipliers[item] ?? 1;
      return {
        item,
        base,
        multiplier,
        previous: state.previous[item] ?? multiplier,
        price: Math.max(1, Math.round(base * multiplier)),
        sold: sold.get(item) ?? 0,
      };
    });

    return {
      cycle,
      nextCycleAt: marketCycleEndsAt(now),
      soldTarget: MARKET_SOLD_TARGET,
      items,
    };
  }

  /** @brief Reads the persisted board state, initializing a fresh one. */
  private readState(now: number): BoardState {
    const row = this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'board'").toArray()[0];
    if (row === undefined) {
      const fresh: BoardState = {
        cycle: marketCycleAt(now),
        multipliers: {},
        previous: {},
      };
      for (const { item } of marketBaseItems(seasonAt(now))) {
        fresh.multipliers[item] = 1;
        fresh.previous[item] = 1;
      }
      this.writeState(fresh);
      return fresh;
    }
    try {
      const parsed = JSON.parse(row.value) as BoardState;
      return {
        cycle: typeof parsed.cycle === "number" ? parsed.cycle : marketCycleAt(now),
        multipliers: parsed.multipliers ?? {},
        previous: parsed.previous ?? {},
      };
    } catch {
      return { cycle: marketCycleAt(now), multipliers: {}, previous: {} };
    }
  }

  /** @brief Persists the board state. */
  private writeState(state: BoardState): void {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('board', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(state),
    );
  }

  /**
   * @brief Advances the board across every elapsed cycle.
   * @param now Server clock.
   * @details Skipped cycles count as empty (no sales) and raise prices, matching
   * "nobody sells this crop" pressure.
   */
  private roll(now: number): void {
    const current = marketCycleAt(now);
    let state = this.readState(now);
    if (state.cycle >= current) return;

    const catalog = marketBaseItems(seasonAt(now));
    const steps = Math.min(50, current - state.cycle);
    for (let step = 0; step < steps; step += 1) {
      const fromCycle = current - steps + step;
      const sold = new Map<string, number>();
      for (const row of this.sql
        .exec<SaleRow>("SELECT item, qty FROM sales WHERE cycle = ?", fromCycle)
        .toArray()) {
        sold.set(row.item, row.qty);
      }
      const multipliers: Record<string, number> = {};
      for (const { item } of catalog) {
        multipliers[item] = nextMarketMultiplier(state.multipliers[item] ?? 1, sold.get(item) ?? 0);
      }
      state = { cycle: fromCycle + 1, multipliers, previous: state.multipliers };
    }

    this.writeState(state);
    // Keep only the two cycles the next boundary can still read.
    this.sql.exec("DELETE FROM sales WHERE cycle < ?", current - 1);
  }
}

/** Kept for tests and configuration that need the cycle length. */
export const MARKET_BOARD_CYCLE_MS = MARKET_CYCLE_MS;

/** Multiplier bounds re-exported for the chart labels. */
export const MARKET_BOARD_LIMITS = {
  min: MARKET_MIN_MULTIPLIER,
  max: MARKET_MAX_MULTIPLIER,
} as const;
