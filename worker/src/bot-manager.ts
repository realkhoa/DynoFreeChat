/**
 * @file bot-manager.ts
 * @brief Owns the ten market-maker bot gardens and runs their automation.
 * @details A cron trigger pings this singleton every ten minutes. Each bot
 * garden is a normal Garden object (so friends can visit it), but its actions
 * are driven by a bounded heuristic and its leaderboard row is flagged as a bot
 * and hidden from the human board. The manager also reports each bot's sales and
 * purchases to the market board, which is what makes the bots stabilise prices.
 */

import { DurableObject } from "cloudflare:workers";
import { GARDEN_CODE_LENGTH, type MarketSnapshot } from "@dyno/shared/garden";
import type { Env } from "./env";
import { BOT_HEADER, GARDEN_TOKEN_HEADER, HUB_NAME, MARKET_HEADER } from "./garden";
import { json } from "./http";
import type { SqlRow } from "./sql";
import { MARKET_BOARD_NAME } from "./market-board";
import { randomCode, randomRecoveryKey, sha256Hex } from "./secrets";

/** How many generic bots exist. */
export const BOT_COUNT = 50;

/** One extra bot that only ever plants carrots. */
export const CARROT_BOT_NICK = "Bot Cà Rốt";

/** Bot gardens created at most per tick, keeping the first cron under limits. */
const BOT_CREATE_BATCH = 10;

/** Singleton name of the bot manager. */
export const BOT_MANAGER_NAME = "bots";

/** Cached one-line summary of a bot garden. */
interface BotRecord {
  playerId: string;
  token: string;
  code: string;
  nick: string;
  color: string;
  coins: number;
  earned: number;
  harvested: number;
  bag?: number;
  /** Set on the specialist: it only plants this crop. */
  focus?: "carrot";
}

type MetaRow = SqlRow<{ value: string }>;

/** Bottom-of-the-hub row returned to the bots tab. */
export interface BotSummary {
  code: string;
  nick: string;
  color: string;
  coins: number;
  earned: number;
  harvested: number;
  bag: number;
  focus?: string;
  online: boolean;
}

/** @brief Singleton that creates and ticks the ten bots. */
export class BotManager extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private ensureSchema(): void {
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/list") return json({ bots: this.summaries() });
    if (request.method === "POST" && url.pathname === "/tick") return this.tick(request);
    return json({ code: "NOT_FOUND" }, 404);
  }

  /** @brief Authorises cron/internal automation requests. */
  private authorised(request: Request): boolean {
    const secret = this.env.BOT_SECRET;
    if (secret === undefined || secret.length === 0) return true;
    return request.headers.get(BOT_HEADER) === secret;
  }

  /** @brief Reads the stored bot records. */
  private readBots(): BotRecord[] {
    const row = this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'bots'").toArray()[0];
    if (row === undefined) return [];
    try {
      const parsed = JSON.parse(row.value) as BotRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** @brief Last neighbourhood survey: how many of each crop the bots grow. */
  private readSurvey(): Record<string, number> {
    const row = this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'survey'").toArray()[0];
    if (row === undefined) return {};
    try {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      const clean: Record<string, number> = {};
      for (const [id, count] of Object.entries(parsed)) {
        if (typeof count === "number" && Number.isFinite(count) && count > 0) clean[id] = count;
      }
      return clean;
    } catch {
      return {};
    }
  }

  /** @brief Persists the neighbourhood survey for the next tick. */
  private writeSurvey(survey: Record<string, number>): void {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('survey', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(survey),
    );
  }

  /** @brief Persists the bot records. */
  private writeBots(bots: BotRecord[]): void {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('bots', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(bots),
    );
  }

  /** @brief Summaries for the bots tab. */
  private summaries(): BotSummary[] {
    const now = Date.now();
    return this.readBots().map((bot) => ({
      code: bot.code,
      nick: bot.nick,
      color: bot.color,
      coins: bot.coins,
      earned: bot.earned,
      harvested: bot.harvested,
      bag: bot.bag ?? 0,
      focus: bot.focus,
      online: true,
    }));
  }

  /** @brief Creates any missing bot garden, once. */
  private async ensureBots(bots: BotRecord[]): Promise<BotRecord[]> {
    const colors = ["#4ec9b0", "#d7ba7d", "#9cdcfe", "#ce9178", "#c586c0", "#6fe3b5"];
    let created = 0;
    let generic = bots.filter((bot) => bot.focus === undefined).length;
    while (generic < BOT_COUNT && created < BOT_CREATE_BATCH) {
      created += 1;
      generic += 1;
      const index = bots.length + 1;
      const nick = `Bot ${String(index).padStart(2, "0")}`;
      const playerId = crypto.randomUUID();
      const code = randomCode(GARDEN_CODE_LENGTH).toUpperCase();
      const recoveryHash = await sha256Hex(randomRecoveryKey());

      const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
      const registered = await hub.fetch("https://hub/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId,
          code,
          recoveryHash,
          nick,
          color: colors[index % colors.length],
          bot: true,
          // One bucket per bot so the create limiter never blocks the bots.
          ip: `bot-${index}`,
          now: Date.now(),
        }),
      });
      if (!registered.ok) {
        const body = (await registered.json()) as { code?: string };
        if (body.code === "CODE_EXISTS") continue;
        break;
      }

      const garden = this.env.GARDEN.get(this.env.GARDEN.idFromName(playerId));
      const registeredGarden = await garden.fetch("https://garden/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId,
          code,
          recoveryHash,
          nick,
          color: colors[index % colors.length],
        }),
      });
      if (!registeredGarden.ok) break;
      const payload = (await registeredGarden.json()) as { token?: string };
      if (typeof payload.token !== "string") break;

      bots.push({
        playerId,
        token: payload.token,
        code,
        nick,
        color: colors[index % colors.length] ?? "#4ec9b0",
        coins: 0,
        earned: 0,
        harvested: 0,
      });
      this.writeBots(bots);
    }

    // The carrot specialist: same pipeline, but its brain only plants carrots.
    const hasCarrotBot = bots.some((bot) => bot.focus === "carrot");
    if (!hasCarrotBot && bots.length >= BOT_COUNT && created < BOT_CREATE_BATCH) {
      const playerId = crypto.randomUUID();
      const code = randomCode(GARDEN_CODE_LENGTH).toUpperCase();
      const recoveryHash = await sha256Hex(randomRecoveryKey());
      const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
      const registered = await hub.fetch("https://hub/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId,
          code,
          recoveryHash,
          nick: CARROT_BOT_NICK,
          color: "#e8a33d",
          bot: true,
          ip: "bot-carrot",
          now: Date.now(),
        }),
      });
      if (registered.ok) {
        const garden = this.env.GARDEN.get(this.env.GARDEN.idFromName(playerId));
        const registeredGarden = await garden.fetch("https://garden/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            playerId,
            code,
            recoveryHash,
            nick: CARROT_BOT_NICK,
            color: "#e8a33d",
          }),
        });
        if (registeredGarden.ok) {
          const payload = (await registeredGarden.json()) as { token?: string };
          if (typeof payload.token === "string") {
            bots.push({
              playerId,
              token: payload.token,
              code,
              nick: CARROT_BOT_NICK,
              color: "#e8a33d",
              coins: 0,
              earned: 0,
              harvested: 0,
              focus: "carrot",
            });
            this.writeBots(bots);
          }
        }
      }
    }
    return bots;
  }

  /** @brief Loads the market board once per tick. */
  private async marketHeader(): Promise<{ header: string; snapshot: MarketSnapshot } | null> {
    try {
      const market = this.env.MARKET.get(this.env.MARKET.idFromName(MARKET_BOARD_NAME));
      const response = await market.fetch("https://market/snapshot");
      if (!response.ok) return null;
      const snapshot = (await response.json()) as MarketSnapshot;
      const sell: Record<string, number> = {};
      for (const item of snapshot.items) sell[item.item] = item.multiplier;
      const buy: Record<string, number> = {};
      for (const offer of snapshot.offers) buy[offer.item] = offer.multiplier;
      return { header: encodeURIComponent(JSON.stringify({ sell, buy })), snapshot };
    } catch {
      return null;
    }
  }

  /** @brief Advances every bot by one bounded step. */
  private async tick(request: Request): Promise<Response> {
    if (!this.authorised(request)) return json({ code: "UNAUTHORIZED" }, 401);

    let bots = this.readBots();
    bots = await this.ensureBots(bots);
    if (bots.length === 0) return json({ ok: true, bots: 0 });

    const market = await this.marketHeader();
    const marketStub = this.env.MARKET.get(this.env.MARKET.idFromName(MARKET_BOARD_NAME));
    const soldTotals: Record<string, number> = {};
    const boughtTotals: Record<string, number> = {};
    // Bots coordinate through this survey: they see what the neighbourhood is
    // growing and diversify instead of all flooding the same crop.
    const survey = this.readSurvey();
    const nextSurvey: Record<string, number> = {};
    let actions = 0;
    for (const bot of bots) {
      try {
        const garden = this.env.GARDEN.get(this.env.GARDEN.idFromName(bot.playerId));
        const headers: Record<string, string> = {
          "content-type": "application/json",
          [GARDEN_TOKEN_HEADER]: bot.token,
        };
        if (market !== null) headers[MARKET_HEADER] = market.header;
        if (this.env.BOT_SECRET !== undefined) headers[BOT_HEADER] = this.env.BOT_SECRET;
        const response = await garden.fetch("https://garden/bot-tick", {
          method: "POST",
          headers,
          body: JSON.stringify({ focus: bot.focus, survey }),
        });
        if (!response.ok) continue;
        const result = (await response.json()) as {
          actions?: number;
          coins?: number;
          earned?: number;
          harvested?: number;
          bag?: number;
          sold?: Record<string, number>;
          bought?: Record<string, number>;
          planted?: Record<string, number>;
        };
        actions += result.actions ?? 0;
        if (typeof result.coins === "number") bot.coins = result.coins;
        if (typeof result.earned === "number") bot.earned = result.earned;
        if (typeof result.harvested === "number") bot.harvested = result.harvested;
        if (typeof result.bag === "number") bot.bag = result.bag;
        for (const [id, count] of Object.entries(result.planted ?? {})) {
          if (count < 1) continue;
          nextSurvey[id] = (nextSurvey[id] ?? 0) + count;
        }

        // Aggregate first: one market request per item instead of one per bot,
        // which keeps a 50-bot tick well under the subrequest limit.
        for (const [item, qty] of Object.entries(result.sold ?? {})) {
          if (qty < 1) continue;
          soldTotals[item] = (soldTotals[item] ?? 0) + qty;
        }
        for (const [item, qty] of Object.entries(result.bought ?? {})) {
          if (qty < 1) continue;
          boughtTotals[item] = (boughtTotals[item] ?? 0) + qty;
        }
      } catch {
        // One failing bot must not stop the rest of the tick.
      }
    }
    this.writeBots(bots);
    this.writeSurvey(nextSurvey);
    for (const [item, qty] of Object.entries(soldTotals)) {
      try {
        await marketStub.fetch("https://market/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item, qty }),
        });
      } catch {
        // Market accounting must not fail the whole bot tick.
      }
    }
    for (const [item, qty] of Object.entries(boughtTotals)) {
      try {
        await marketStub.fetch("https://market/purchase", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item, qty }),
        });
      } catch {
        // Market accounting must not fail the whole bot tick.
      }
    }
    return json({ ok: true, bots: bots.length, actions });
  }
}
