#!/usr/bin/env node
/**
 * @file index.ts
 * @brief MCP server exposing every DynoFreeChat garden feature.
 * @details Runs over stdio. Reads plus writes go through the public worker API as
 * the configured player, so the server never keeps a second copy of the rules.
 * Tools cover the whole feature surface (garden, staff, market, bots, townhall,
 * codex, prestige, ...), with resources for live snapshots and a prompt that
 * briefs the model on the current garden.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ACTION_DOCS, ACTION_KINDS, isKnownAction } from "./actions.js";
import { DynoApi, type GardenActionShape } from "./client.js";
import { isAuthHeader, readConfig } from "./config.js";

/** Package version reported in the MCP handshake. */
const VERSION = "0.1.0";

const config = readConfig();
const api = new DynoApi(config);

/** @brief JSON text result for one tool call. */
function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** @brief Error result for one tool call. */
function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** @brief Runs a tool body and turns throws into MCP error results. */
async function run(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    return errorResult(error);
  }
}

/** @brief Validates one raw action object before sending it. */
function toAction(raw: Record<string, unknown>): GardenActionShape {
  const kind = raw.kind;
  if (typeof kind !== "string" || kind.length === 0) {
    throw new Error("action.kind must be a non-empty string");
  }
  if (!isKnownAction(kind)) {
    throw new Error(`Unknown action kind "${kind}". Call dyno_action_catalog to list every action.`);
  }
  return raw as GardenActionShape;
}

/** @brief MCP server instance with every tool, resource and prompt registered. */
const server = new McpServer({ name: "dynofreechat", version: VERSION });

/** Arguments object handed to one tool callback. */
type ToolArgs = Record<string, any>;

/** Tool metadata accepted by the loose helper. */
interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
  annotations?: { readOnlyHint?: boolean };
}

/**
 * @brief Registers one tool through a loosely typed shim.
 * @details The SDK's generic inference is far too deep for TypeScript 7 when a
 * dozen tools register at once, so the shim keeps the public types readable.
 */
function tool(
  name: string,
  config: ToolConfig,
  handler: (args: ToolArgs) => Promise<CallToolResult> | CallToolResult,
): void {
  server.registerTool(name, config as never, handler as never);
}

const ACTION_INPUT = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------- read tools

tool(
  "dyno_state",
  {
    title: "Garden state",
    description:
      "Owner snapshot: plots, trees, bag, coins, staff, mushroom trays, extras, shop stock, rev and server time.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => run(async () => jsonResult(await api.state())),
);

tool(
  "dyno_market",
  {
    title: "Market board",
    description: "Live market multipliers, offers and the sale log size the worker is serving.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => run(async () => jsonResult(await api.market())),
);

tool(
  "dyno_season",
  {
    title: "Season and shop",
    description: "Current day phase, weather events, prices, shop offers and buy prices.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => run(async () => jsonResult(await api.season())),
);

tool(
  "dyno_bots",
  {
    title: "Bot gardens",
    description: "Every market-maker bot with coins, earned totals and what it is growing.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => run(async () => jsonResult(await api.bots())),
);

tool(
  "dyno_leaderboard",
  {
    title: "Leaderboard",
    description: "Top garden rows; bots are flagged and hidden from the human board.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    annotations: { readOnlyHint: true },
  },
  ({ limit }) => run(async () => jsonResult(await api.leaderboard(limit))),
);

tool(
  "dyno_sales",
  {
    title: "Global sales",
    description: "Recent sales across every garden: item, qty, star, effects, gross and net coins.",
    inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true },
  },
  ({ limit }) => run(async () => jsonResult(await api.sales(limit))),
);

tool(
  "dyno_tournament",
  {
    title: "Weekly tournament",
    description: "Tournament standings and the current bucket.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    annotations: { readOnlyHint: true },
  },
  ({ limit }) => run(async () => jsonResult(await api.tournament(limit))),
);

tool(
  "dyno_visit",
  {
    title: "Visit a garden",
    description: "Public snapshot of any garden by its 6-character share code.",
    inputSchema: { code: z.string().min(4).max(12) },
    annotations: { readOnlyHint: true },
  },
  ({ code }) => run(async () => jsonResult(await api.visit(code))),
);

tool(
  "dyno_health",
  {
    title: "Worker health",
    description: "Ping the worker health endpoint.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => run(async () => jsonResult(await api.health())),
);

tool(
  "dyno_action_catalog",
  {
    title: "Action catalog",
    description: "Lists every action kind the API accepts with a one-line description, optionally filtered.",
    inputSchema: { kind: z.string().optional(), filter: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  ({ kind, filter }) =>
    run(async () => {
      if (kind !== undefined) {
        if (!isKnownAction(kind)) throw new Error(`Unknown action kind "${kind}"`);
        return jsonResult(ACTION_DOCS.filter((entry) => entry.kind === kind));
      }
      if (filter !== undefined) {
        const needle = filter.toLowerCase();
        return jsonResult(ACTION_DOCS.filter((entry) => entry.doc.toLowerCase().includes(needle)));
      }
      return jsonResult({ count: ACTION_KINDS.length, actions: ACTION_DOCS });
    }),
);

tool(
  "dyno_config",
  {
    title: "MCP configuration",
    description:
      "What this server is connected to: worker URL, whether credentials are present, read-only mode.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () =>
    run(async () =>
      jsonResult({
        apiBase: api.apiBase,
        authenticated: api.hasAuth(),
        readOnly: api.readOnly,
        actions: ACTION_KINDS.length,
      }),
    ),
);

// ---------------------------------------------------------------- write tools

tool(
  "dyno_act",
  {
    title: "Perform one garden action",
    description:
      "Sends one action to /api/garden/act. Omit rev to auto-read the latest one. Call dyno_action_catalog for the full list and required fields.",
    inputSchema: { action: ACTION_INPUT, rev: z.number().int().nonnegative().optional() },
    annotations: { readOnlyHint: false },
  },
  ({ action, rev }) => run(async () => jsonResult(await api.act(toAction(action), rev))),
);

tool(
  "dyno_act_batch",
  {
    title: "Perform a batch of actions",
    description:
      "Runs up to 50 actions in order, carrying the revision forward. Stops early unless stopOnError is false.",
    inputSchema: {
      actions: z.array(ACTION_INPUT).min(1).max(50),
      stopOnError: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false },
  },
  ({ actions, stopOnError }) =>
    run(async () => {
      const results: unknown[] = [];
      let rev: number | undefined;
      for (const entry of actions) {
        const action = toAction(entry);
        try {
          const result = await api.act(action, rev);
          rev = result.rev;
          results.push({ action: action.kind, ok: true, result });
        } catch (error) {
          results.push({ action: action.kind, ok: false, error: (error as Error).message });
          if (stopOnError !== false) break;
        }
      }
      return jsonResult({ results });
    }),
);

tool(
  "dyno_restore",
  {
    title: "Restore credentials",
    description: "Mints a fresh session token from the recovery key and uses it for later calls.",
    inputSchema: { recovery: z.string().min(8) },
  },
  ({ recovery }) =>
    run(async () => {
      const restored = await api.restore(recovery);
      return jsonResult({
        playerId: restored.playerId,
        token: restored.token,
        state: restored.state,
      });
    }),
);

tool(
  "dyno_quick_plan",
  {
    title: "Quick Plan",
    description:
      "Convenience wrapper for the Quick Plan action: buys the highest-profit seeds and plants every empty crop, tree and tray slot.",
    inputSchema: {},
  },
  () => run(async () => jsonResult(await api.act({ kind: "quickPlan" }))),
);

tool(
  "dyno_staff_run",
  {
    title: "Staff quick actions",
    description:
      "Convenience helper for staff: pass task (water|plant|harvest|harvestMushroom|saleHunt) and optionally an index to assign it, or omit to just read the roster from dyno_state.",
    inputSchema: {
      task: z.enum(["water", "plant", "harvest", "harvestMushroom", "saleHunt"]).optional(),
      index: z.number().int().min(0).max(3).optional(),
    },
  },
  ({ task, index }) =>
    run(async () => {
      if (task === undefined) {
        const state = await api.state();
        return jsonResult({ staff: (state as Record<string, unknown>).extras });
      }
      if (index === undefined) throw new Error("index is required when assigning a task");
      return jsonResult(await api.act({ kind: "setStaffRole", index, role: task }));
    }),
);

// ----------------------------------------------------------------- resources

/** @brief Registers one live JSON resource backed by a fetcher. */
function resource(
  name: string,
  uri: string,
  title: string,
  description: string,
  load: () => Promise<unknown>,
): void {
  const read = async (target: URL): Promise<unknown> => ({
    contents: [{ uri: target.href, text: JSON.stringify(await load(), null, 2) }],
  });
  server.registerResource(name, uri, { title, description, mimeType: "application/json" }, read as never);
}

resource("dyno-state", "dyno://state", "Garden state", "Owner snapshot with rev.", () => api.state());
resource("dyno-market", "dyno://market", "Market", "Market multipliers and offers.", () => api.market());
resource("dyno-season", "dyno://season", "Season", "Day phase, events, prices, shop.", () => api.season());
resource("dyno-bots", "dyno://bots", "Bots", "Bot garden summaries.", () => api.bots());
resource("dyno-leaderboard", "dyno://leaderboard", "Leaderboard", "Top gardens.", () => api.leaderboard(25));
resource("dyno-sales", "dyno://sales", "Sales", "Recent global sales.", () => api.sales(50));
resource("dyno-actions", "dyno://actions", "Action catalog", "Every action kind.", async () => ({
  count: ACTION_KINDS.length,
  actions: ACTION_DOCS,
}));

// ------------------------------------------------------------------- prompts

server.registerPrompt(
  "garden-briefing",
  {
    title: "Garden briefing",
    description: "Reads the live state and season, then asks for a concrete next-action plan.",
  } as never,
  (async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "You are the operator of my DynoFreeChat garden.",
            "Read dyno://state and dyno://season, then reply with a short briefing:",
            "1) ready to harvest / dying / losing plants, 2) staff status, 3) best next 3 actions.",
            "Use dyno_act with an action object (call dyno_action_catalog for fields) to execute.",
            "Never waste a plant: losses and dead plants must be uprooted.",
          ].join("\n"),
        },
      },
    ],
  })) as never,
);

// ---------------------------------------------------------------------- main

/** @brief Boots the stdio transport. */
async function main(): Promise<void> {
  if (!api.hasAuth() && config.recovery !== null) {
    try {
      await api.restore(config.recovery);
      process.stderr.write("[dynofreechat-mcp] restored a session from DYNO_RECOVERY\n");
    } catch (error) {
      process.stderr.write(`[dynofreechat-mcp] recovery failed: ${(error as Error).message}\n`);
    }
  }
  if (api.hasAuth() && config.auth !== null && !isAuthHeader(config.auth)) {
    process.stderr.write("[dynofreechat-mcp] DYNO_GARDEN_AUTH looks malformed; set playerId.token\n");
  }
  process.stderr.write(`[dynofreechat-mcp] worker=${api.apiBase} auth=${api.hasAuth() ? "yes" : "no"}\n`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`[dynofreechat-mcp] fatal: ${(error as Error).message}\n`);
  process.exit(1);
});
