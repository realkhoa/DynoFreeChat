import type { ChatRoom } from "./room";
import type { Registry } from "./registry";

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  REGISTRY: DurableObjectNamespace<Registry>;
  /** Comma separated origin allowlist. Empty string allows everything (local dev only). */
  ALLOWED_ORIGINS: string;
  /** Access token for the market gate. Unset (or missing the PIN hash) leaves the gate open. */
  LOCK_TOKEN?: string;
  /** SHA-256 hex of the access PIN. */
  LOCK_PIN_HASH?: string;
}
