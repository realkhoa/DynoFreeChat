/**
 * @file market-board.ts
 * @brief Global market pressure for sell prices and for seed/supply purchases.
 * @details One singleton Durable Object owns both boards. Every six minutes it
 * reads the previous cycle: sell prices fall when supply arrives (harder above
 * 25 units) and only rise after two empty cycles in a row; purchase prices rise
 * when players buy in bulk and drift back toward the base when demand is quiet.
 */

import { DurableObject } from "cloudflare:workers";
import {
  MARKET_CYCLE_MS,
  MARKET_SOLD_TARGET,
  itemById,
  marketBaseItems,
  marketBuyBaseItems,
  marketCycleAt,
  marketCycleEndsAt,
  nextBuyMultiplier,
  nextSellState,
  seasonAt,
  type ItemId,
  type MarketOfferItem,
  type MarketQuoteItem,
  type MarketSnapshot,
  type SeedId,
  type SupplyId,
} from "@dyno/shared/garden";
import type { Env } from "./env";
import { json, readJson } from "./http";
import type { SqlRow } from "./sql";

/** Singleton name of the market board. */
export const MARKET_BOARD_NAME = "board";

type MetaRow = SqlRow<{ value: string }>;

type VolumeRow = SqlRow<{ item: string; qty: number }>;

/** Sell-side state of one item. */
interface SellState {
  multiplier: number;
  previous: number;
  emptyCycles: number;
}

/** Buy-side state of one seed/supply. */
interface BuyState {
  multiplier: number;
  previous: number;
}

/** Persisted board state. */
interface BoardState {
  cycle: number;
  sell: Record<string, SellState>;
  buy: Record<string, BuyState>;
  /** When the board last advanced a cycle; zero means legacy/unknown. */
  updatedAt: number;
}

/** @brief One global market board (sell prices + purchase prices). */
export class MarketBoard extends DurableObject<Env> {
  private schemaReady = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    try {
      this.ensureSchema();
    } catch {
      // Write quota exhausted: existing tables still serve reads.
    }
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.schemaReady = true;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sales (
        cycle INTEGER NOT NULL,
        item TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (cycle, item)
      );
      CREATE TABLE IF NOT EXISTS purchases (
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
    if (request.method === "POST" && url.pathname === "/record") return this.record(request, "sales");
    if (request.method === "POST" && url.pathname === "/purchase") return this.record(request, "purchases");
    if (request.method === "GET" && url.pathname === "/snapshot") return json(this.snapshot(Date.now()));
    return json({ code: "NOT_FOUND" }, 404);
  }

  /** @brief Records sold or bought units for the running cycle. */
  private async record(request: Request, table: "sales" | "purchases"): Promise<Response> {
    const body = await readJson(request);
    const item = typeof body.item === "string" ? itemById(body.item) : undefined;
    const supply =
      typeof body.item === "string" ? marketBuyBaseItems().find((row) => row.item === body.item) : undefined;
    const id = item?.id ?? supply?.item;
    const qty = typeof body.qty === "number" && Number.isFinite(body.qty) ? Math.floor(body.qty) : 0;
    if (id === undefined || qty < 1 || qty > 999) return json({ code: "BAD_REQUEST" }, 400);

    const now = Date.now();
    this.roll(now);
    this.sql.exec(
      `INSERT INTO ${table} (cycle, item, qty) VALUES (?, ?, ?)
       ON CONFLICT(cycle, item) DO UPDATE SET qty = qty + excluded.qty`,
      marketCycleAt(now),
      id,
      qty,
    );
    return json({ ok: true });
  }

  /** @brief Builds the public snapshot with both boards. */
  private snapshot(now: number): MarketSnapshot {
    this.roll(now);
    const state = this.readState(now);
    const cycle = marketCycleAt(now);
    const season = seasonAt(now);
    const sold = this.volumes("sales", cycle);
    const bought = this.volumes("purchases", cycle);

    const items: MarketQuoteItem[] = marketBaseItems(season).map(({ item, base }) => {
      const entry = state.sell[item] ?? { multiplier: 1, previous: 1, emptyCycles: 0 };
      return {
        item,
        base,
        multiplier: entry.multiplier,
        previous: entry.previous,
        price: Math.max(1, Math.round(base * entry.multiplier)),
        sold: sold.get(item) ?? 0,
      };
    });

    const offers: MarketOfferItem[] = marketBuyBaseItems(season).map(({ item, kind, base }) => {
      const entry = state.buy[item] ?? { multiplier: 1, previous: 1 };
      return {
        item,
        kind,
        base,
        multiplier: entry.multiplier,
        previous: entry.previous,
        price: Math.max(1, Math.round(base * entry.multiplier)),
        bought: bought.get(item) ?? 0,
      };
    });

    return {
      cycle,
      nextCycleAt: marketCycleEndsAt(now),
      soldTarget: MARKET_SOLD_TARGET,
      items,
      offers,
    };
  }

  /** @brief Volume per item for one cycle and table. */
  private volumes(table: "sales" | "purchases", cycle: number): Map<string, number> {
    const volumes = new Map<string, number>();
    for (const row of this.sql
      .exec<VolumeRow>(`SELECT item, qty FROM ${table} WHERE cycle = ?`, cycle)
      .toArray()) {
      volumes.set(row.item, row.qty);
    }
    return volumes;
  }

  /** @brief Reads persisted state, migrating the first sell-only board shape. */
  private readState(now: number): BoardState {
    const row = this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'board'").toArray()[0];
    if (row === undefined) {
      const fresh = this.freshState(now);
      this.writeState(fresh);
      return fresh;
    }
    try {
      const parsed = JSON.parse(row.value) as Partial<BoardState> & {
        multipliers?: Record<string, number>;
        previous?: Record<string, number>;
      };
      if (parsed.sell !== undefined && parsed.buy !== undefined) {
        return {
          cycle: parsed.cycle ?? marketCycleAt(now),
          sell: parsed.sell,
          buy: parsed.buy,
          updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
        };
      }
      // Old shape: only sell multipliers and their previous values.
      // Legacy shape: convert to the current one at base prices and persist it so
      // the board can advance again (the old cycle field would freeze the roll).
      const fresh = this.freshState(now);
      try {
        this.writeState(fresh);
      } catch {
        // Reads still work; the next successful write repairs it.
      }
      return fresh;
    } catch {
      return this.freshState(now);
    }
  }

  /** @brief Brand new board at base prices. */
  private freshState(now: number): BoardState {
    const sell: Record<string, SellState> = {};
    for (const { item } of marketBaseItems(seasonAt(now))) {
      sell[item] = { multiplier: 1, previous: 1, emptyCycles: 0 };
    }
    const buy: Record<string, BuyState> = {};
    for (const { item } of marketBuyBaseItems(seasonAt(now))) buy[item] = { multiplier: 1, previous: 1 };
    return { cycle: marketCycleAt(now), sell, buy, updatedAt: now };
  }

  private writeState(state: BoardState): void {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('board', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(state),
    );
  }

  /** @brief Advances both boards across every elapsed cycle. */
  private roll(now: number): void {
    const current = marketCycleAt(now);
    let state = this.readState(now);
    if (state.updatedAt === 0 || now - state.updatedAt > MARKET_CYCLE_MS * 2) {
      // The board stopped advancing for more than two cycles (legacy migration,
      // corrupt state or a stalled instance): reset to base and clear volumes.
      state = this.freshState(now);
      try {
        this.writeState(state);
        this.sql.exec("DELETE FROM sales");
        this.sql.exec("DELETE FROM purchases");
      } catch {
        // Reads stay available even if the repair write cannot land.
      }
      return;
    }
    if (state.cycle > current) {
      // A corrupt/future cycle index would freeze the board forever (every roll
      // would early-return). Heal to base prices at the real current cycle and
      // clear the volume tables so the market starts moving again.
      state = this.freshState(now);
      try {
        this.writeState(state);
        this.sql.exec("DELETE FROM sales");
        this.sql.exec("DELETE FROM purchases");
      } catch {
        // Reads stay available even if the repair write cannot land.
      }
      return;
    }
    if (state.cycle >= current) return;

    const sellCatalog = marketBaseItems(seasonAt(now));
    const buyCatalog = marketBuyBaseItems(seasonAt(now));
    const steps = Math.min(50, current - state.cycle);
    for (let step = 0; step < steps; step += 1) {
      const fromCycle = current - steps + step;
      const sold = this.volumes("sales", fromCycle);
      const bought = this.volumes("purchases", fromCycle);

      const sell: Record<string, SellState> = {};
      for (const { item } of sellCatalog) {
        const entry = state.sell[item] ?? { multiplier: 1, previous: 1, emptyCycles: 0 };
        const next = nextSellState(entry.multiplier, entry.emptyCycles, sold.get(item) ?? 0);
        sell[item] = {
          multiplier: next.multiplier,
          previous: entry.multiplier,
          emptyCycles: next.emptyCycles,
        };
      }
      const buy: Record<string, BuyState> = {};
      for (const { item } of buyCatalog) {
        const entry = state.buy[item] ?? { multiplier: 1, previous: 1 };
        buy[item] = {
          multiplier: nextBuyMultiplier(entry.multiplier, bought.get(item) ?? 0),
          previous: entry.multiplier,
        };
      }
      state = { cycle: fromCycle + 1, sell, buy, updatedAt: now };
    }

    try {
      this.writeState(state);
      this.sql.exec("DELETE FROM sales WHERE cycle < ?", current - 1);
    } catch {
      // Out of write quota: keep serving the in-memory snapshot.
    }
    this.sql.exec("DELETE FROM purchases WHERE cycle < ?", current - 1);
  }
}

/** Re-exported for tests and tools that need the ids. */
export type BoardItem = ItemId | SeedId | SupplyId;
