import { sanitizeSlug } from "@dyno/shared/protocol";
import type { Env } from "./env";
import { json } from "./http";
import { Registry } from "./registry";
import { ChatRoom } from "./room";

export { ChatRoom, Registry };

/**
 * Exact-match origin allowlist. A missing Origin (CLI, curl, miniflare) is
 * allowed. The token `localhost` allows any loopback origin, which keeps local
 * dev working when Vite picks a different port.
 */
export function isAllowedOrigin(origin: string | null, allowlist: string): boolean {
  if (origin === null || origin.length === 0) return true;

  const allowed = allowlist
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (allowed.length === 0) return true;
  if (allowed.includes(origin)) return true;

  if (allowed.includes("localhost") && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)) {
    return true;
  }

  return false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin === null || origin.length === 0) return { vary: "Origin" };
  return { "access-control-allow-origin": origin, vary: "Origin" };
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return json({ ok: true, ts: Date.now() });

    const origin = request.headers.get("Origin");
    if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) return json({ code: "FORBIDDEN" }, 403);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "600",
        },
      });
    }

    const registry = () => env.REGISTRY.get(env.REGISTRY.idFromName("registry"));

    if (url.pathname === "/api/rooms") {
      if (request.method === "GET") {
        return withCors(await registry().fetch("https://registry/list"), origin);
      }
      if (request.method === "POST") {
        const response = await registry().fetch("https://registry/create", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": request.headers.get("cf-connecting-ip") ?? "unknown",
          },
          body: await request.text(),
        });
        return withCors(response, origin);
      }
      return withCors(json({ code: "METHOD_NOT_ALLOWED" }, 405), origin);
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return withCors(json({ code: "EXPECTED_UPGRADE" }, 426), origin);
      }

      const slug = sanitizeSlug(url.searchParams.get("r"));
      if (!slug.ok) return withCors(json({ code: "BAD_SLUG" }, 400), origin);

      const target = new URL("https://room/ws");
      target.searchParams.set("r", slug.slug);

      const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(slug.slug));
      return stub.fetch(new Request(target.toString(), request));
    }

    return withCors(json({ code: "NOT_FOUND" }, 404), origin);
  },
} satisfies ExportedHandler<Env>;
