import type { Garden, GardenHub } from "./garden";
import type { BotManager } from "./bot-manager";
import type { MarketBoard } from "./market-board";
import type { ChatRoom } from "./room";
import type { Registry } from "./registry";

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  REGISTRY: DurableObjectNamespace<Registry>;
  GARDEN: DurableObjectNamespace<Garden>;
  GARDEN_HUB: DurableObjectNamespace<GardenHub>;
  /** Singleton global market pressure board. */
  MARKET: DurableObjectNamespace<MarketBoard>;
  /** Singleton that owns and ticks the bot gardens. */
  BOT_MANAGER: DurableObjectNamespace<BotManager>;
  /** Comma separated origin allowlist. Empty string allows everything (local dev only). */
  ALLOWED_ORIGINS: string;
  /** Access token for the market gate. Unset (or missing the PIN hash) leaves the gate open. */
  LOCK_TOKEN?: string;
  /** SHA-256 hex of the access PIN. */
  LOCK_PIN_HASH?: string;
  /** Secret shared by the cron trigger and the bot automation routes. */
  BOT_SECRET?: string;
}
