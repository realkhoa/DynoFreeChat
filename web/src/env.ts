/** WebSocket endpoint of the Cloudflare Worker. */
export const wsUrl: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8787/ws";

function deriveApiBase(socketUrl: string): string {
  try {
    const url = new URL(socketUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    return url.origin;
  } catch {
    return "http://localhost:8787";
  }
}

/** HTTP base for the lobby API, derived from the socket URL unless overridden. */
export const apiBase: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? deriveApiBase(wsUrl);

/** Builds the socket URL for a room. The password never goes in a URL. */
export function roomSocketUrl(base: string, slug: string): string {
  const url = new URL(base);
  url.searchParams.set("r", slug);
  return url.toString();
}
