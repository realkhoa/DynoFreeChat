import { sanitizeSlug } from "@dyno/shared/protocol";
import { LOCK_HEADER, lockSecrets, stateResponse, verifyResponse, verifySession } from "./auth";
import type { Env } from "./env";
import { json } from "./http";
import {
  chartResponse,
  depthResponse,
  feedResponse,
  indicesResponse,
  marketDeps,
  quotesResponse,
  takeRate,
} from "./market";
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
          "access-control-allow-headers": "content-type,x-dyno-lock",
          "access-control-max-age": "600",
        },
      });
    }

    // Access gate: exchange the access token or PIN for a signed session token.
    if (url.pathname === "/api/auth/verify" && request.method === "POST") {
      return withCors(await verifyResponse(request, env), origin);
    }

    if (url.pathname === "/api/auth/state" && request.method === "GET") {
      return withCors(await stateResponse(request, env), origin);
    }

    // Market feed proxy. Read-only, rate limited per IP, never cached by the
    // browser, and gated behind the access token when the Worker has one.
    if (url.pathname.startsWith("/api/market/")) {
      if (request.method !== "GET") return withCors(json({ code: "METHOD_NOT_ALLOWED" }, 405), origin);

      const secrets = lockSecrets(env);
      if (secrets !== null) {
        const unlocked = await verifySession(secrets, request.headers.get(LOCK_HEADER), Date.now());
        if (!unlocked) return withCors(json({ code: "LOCKED" }, 401), origin);
      }

      const ip = request.headers.get("cf-connecting-ip") ?? "local";
      if (!takeRate(ip, Date.now())) {
        return withCors(json({ code: "RATE_LIMITED" }, 429, { "retry-after": "10" }), origin);
      }

      const deps = marketDeps();
      let response: Response;
      switch (url.pathname) {
        case "/api/market/quotes":
          response = await quotesResponse(url.searchParams.get("symbols"), deps);
          break;
        case "/api/market/indices":
          response = await indicesResponse(deps);
          break;
        case "/api/market/chart":
          response = await chartResponse(
            url.searchParams.get("symbol"),
            url.searchParams.get("resolution"),
            deps,
          );
          break;
        case "/api/market/depth":
          response = await depthResponse(url.searchParams.get("symbol"), deps);
          break;
        case "/api/market/feed":
          response = await feedResponse(
            url.searchParams.get("symbol"),
            url.searchParams.get("source"),
            url.searchParams.get("page"),
            deps,
          );
          break;
        default:
          response = json({ code: "NOT_FOUND" }, 404);
      }

      const out = withCors(response, origin);
      out.headers.set("cache-control", "no-store");
      return out;
    }

    const registry = () => env.REGISTRY.get(env.REGISTRY.idFromName("registry"));

    // Destructive maintenance: only a holder of a valid access session may purge.
    if (url.pathname === "/api/rooms/purge" && request.method === "POST") {
      const secrets = lockSecrets(env);
      const unlocked =
        secrets !== null && (await verifySession(secrets, request.headers.get(LOCK_HEADER), Date.now()));
      if (!unlocked) return withCors(json({ code: "LOCKED" }, 401), origin);

      const response = await registry().fetch("https://registry/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await request.text(),
      });
      return withCors(response, origin);
    }

    if (url.pathname === "/api/rooms") {
      if (request.method === "GET") {
        const listUrl = new URL("https://registry/list");
        listUrl.search = url.search;
        return withCors(await registry().fetch(listUrl), origin);
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

      // Forward the original upgrade request untouched. Rebuilding it with
      // `new Request(...)` drops the upgrade semantics in production and the
      // handshake then hangs forever, even though miniflare tolerates it.
      const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(slug.slug));
      return stub.fetch(request);
    }

    return withCors(json({ code: "NOT_FOUND" }, 404), origin);
  },
} satisfies ExportedHandler<Env>;
