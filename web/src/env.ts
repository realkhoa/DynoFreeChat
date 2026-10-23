/** WebSocket endpoint of the Cloudflare Worker. */
export const wsUrl: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8787/ws";
