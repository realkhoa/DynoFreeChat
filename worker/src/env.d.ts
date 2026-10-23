import type { ChatRoom } from "./room";
import type { Registry } from "./registry";

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  REGISTRY: DurableObjectNamespace<Registry>;
  /** Comma separated origin allowlist. Empty string allows everything (local dev only). */
  ALLOWED_ORIGINS: string;
}
