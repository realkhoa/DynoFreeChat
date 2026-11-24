/**
 * @file bot-ai.spec.ts
 * @brief LLM bot brain: prompt context, decision parsing and model failures.
 */

import { describe, expect, it, vi } from "vitest";
import { EPOCH_MS, EVENT_WAVE_MS, seasonAt } from "@dyno/shared/garden";
import { createLedger } from "../src/garden-rules";
import {
  aiConfig,
  buildAiMessages,
  parseAiDecisions,
  parseAiPlan,
  trimReasoning,
  planAiActions,
  summarizeGarden,
  type AiGardenContext,
} from "../src/bot-ai";
import type { Env } from "../src/env";

const NOW = EPOCH_MS + 2 * EVENT_WAVE_MS + 1_000;

/** Builds one ledger for the AI tests. */
function makeLedger() {
  return createLedger({
    playerId: "bot-ai",
    nick: "AI",
    color: "#4ec9b0",
    code: "ABCDEF",
    tokenHash: "a".repeat(64),
    recoveryHash: "b".repeat(64),
    now: NOW,
  });
}

/** Minimal env with an AI key. */
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI_BOT_API_KEY: "test-key",
    AI_BOT_API_BASE: "https://ai.test/api",
    AI_BOT_MODEL: "free-model",
    ...overrides,
  } as unknown as Env;
}

/** Fake chat-completion response with the given JSON content. */
function modelReply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ai bot config", () => {
  it("returns null without a key and defaults the model", () => {
    expect(aiConfig(makeEnv({ AI_BOT_API_KEY: undefined }))).toBeNull();
    const config = aiConfig(makeEnv({ AI_BOT_API_BASE: undefined, AI_BOT_MODEL: undefined }));
    expect(config?.base).toBe("https://opencode.ai/inference/go/v1");
    expect(config?.model).toBe("beam-free");
  });
});

describe("ai bot context", () => {
  it("pre-counts ready, dry, dead and empty slot lists", () => {
    const ledger = makeLedger();
    const base = {
      effects: [],
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    ledger.plots[0] = {
      ...base,
      slot: 0,
      seed: "carrot",
      plantedAt: NOW - 600_000,
      readyAt: NOW - 1_000,
      watered: true,
    };
    ledger.plots[1] = {
      ...base,
      slot: 1,
      seed: "potato",
      plantedAt: NOW - 60_000,
      readyAt: NOW + 60_000,
      watered: false,
    };
    ledger.plots[2] = {
      ...base,
      slot: 2,
      seed: "carrot",
      plantedAt: NOW - 60_000,
      readyAt: NOW + 60_000,
      watered: true,
      dead: true,
    };
    ledger.trees[0] = {
      ...base,
      slot: 0,
      tree: "apple",
      plantedAt: NOW - 600_000,
      readyAt: NOW - 1_000,
      watered: true,
    };
    const context = summarizeGarden(ledger, seasonAt(NOW), NOW, { carrot: 3 });
    expect(context.readySlots).toEqual([0]);
    expect(context.drySlots).toEqual([1]);
    expect(context.deadSlots).toEqual([2]);
    expect(context.treeReadySlots).toEqual([0]);
    expect(context.emptySlots.length).toBeGreaterThan(0);
    expect(context.totals).toMatchObject({ ready: 1, dry: 1, dead: 1 });
    expect(context.trays.empty).toBe(27);
    expect(context.shop.length).toBeGreaterThan(0);
    expect(context.neighbourhood).toEqual({ carrot: 3 });
    expect(context.planted.carrot).toBe(2);
  });
  it("asks for strict JSON and lists the allowed actions", () => {
    const context = summarizeGarden(makeLedger(), seasonAt(NOW), NOW, {});
    const messages = buildAiMessages(context);
    expect(messages[0]?.content).toContain("STRICT JSON");
    expect(messages[0]?.content).toContain("Do NOT recount");
    expect(messages[0]?.content).toContain("readySlots");
    expect(messages[1]?.content).toContain("State:");
  });
});

describe("ai decision parsing", () => {
  it("accepts fenced JSON with valid actions", () => {
    const raw = [
      "```json",
      JSON.stringify({
        actions: [
          { kind: "water", slot: 2, tree: false },
          { kind: "harvest", slot: 4, tree: false },
          { kind: "sellAll" },
        ],
      }),
      "```",
    ].join("\n");
    const actions = parseAiDecisions(raw);
    expect(actions.map((action) => action.kind)).toEqual(["water", "harvest", "sellAll"]);
  });

  it("drops unknown, dangerous and malformed actions", () => {
    const raw = JSON.stringify({
      actions: [
        { kind: "giftCoins", code: "ABCDEF", amount: 10_000 },
        { kind: "prestige" },
        { kind: "water", slot: "nope" },
        { kind: "uprootBulk", dead: true },
        { kind: "nonsense" },
      ],
    });
    const actions = parseAiDecisions(raw);
    expect(actions).toEqual([{ kind: "uprootBulk", dead: true }]);
  });

  it("keeps the model's short reasoning with the actions", () => {
    const plan = parseAiPlan(
      JSON.stringify({
        reasoning: "Thu hoạch trước rồi tưới.",
        actions: [{ kind: "harvest", slot: 1, tree: false }],
      }),
    );
    expect(plan.reasoning).toBe("Thu hoạch trước rồi tưới.");
    expect(plan.actions).toHaveLength(1);
    expect(parseAiPlan("not json").reasoning).toBeNull();
    expect(parseAiDecisions(JSON.stringify({ actions: [{ kind: "sellAll" }] }))).toHaveLength(1);
  });

  it("caps the plan and survives non-JSON replies", () => {
    const actions = Array.from({ length: 20 }, (_unused, slot) => ({
      kind: "water",
      slot,
      tree: false,
    }));
    expect(parseAiDecisions(JSON.stringify({ actions }))).toHaveLength(8);
    expect(parseAiDecisions("I cannot help with that.")).toEqual([]);
    expect(parseAiDecisions("{}")).toEqual([]);
  });
});

describe("opencode integration", () => {
  it("reuses the recipe-lab key when the bot key is missing", () => {
    const config = aiConfig(makeEnv({ AI_BOT_API_KEY: undefined, OPENCODE_API_KEY: "shared-key" }));
    expect(config?.key).toBe("shared-key");
    expect(aiConfig(makeEnv({ AI_BOT_API_KEY: undefined, OPENCODE_API_KEY: undefined }))).toBeNull();
  });

  it("shows the model's own reasoning_content when it is present", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ actions: [{ kind: "sellAll" }] }),
                  reasoning_content: "Tôi thấy túi đầy nên bán trước, rồi mới trồng.",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const plan = await planAiActions(
      makeEnv({ AI_BOT_API_KEY: "oc-key", AI_BOT_API_BASE: "https://opencode.ai/inference/go/v1" }),
      makeLedger(),
      seasonAt(NOW),
      NOW,
      {},
      fetchImpl as unknown as typeof fetch,
      "bot-session",
    );
    expect(plan.reasoning).toContain("bán trước");
    expect(plan.actions.map((action) => action.kind)).toEqual(["sellAll"]);
    const call = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(call[1].headers["x-opencode-session"]).toContain("bot-session");
  });
});

describe("reasoning excerpt", () => {
  it("cuts on a sentence boundary and marks the truncation", () => {
    const long =
      "First thought about the garden. Second thought with more detail. Third thought that goes on and on.";
    const trimmed = trimReasoning(long, 60);
    expect(trimmed.length).toBeLessThanOrEqual(62);
    expect(trimmed.endsWith("…")).toBe(true);
    expect(trimReasoning("short", 60)).toBe("short");
    expect(trimReasoning("word ".repeat(40), 40).endsWith("…")).toBe(true);
  });
});

describe("ai planning", () => {
  it("requests the model and returns validated actions", async () => {
    const fetchImpl = vi.fn(async () => modelReply(JSON.stringify({ actions: [{ kind: "sellAll" }] })));
    const plan = await planAiActions(
      makeEnv(),
      makeLedger(),
      seasonAt(NOW),
      NOW,
      {},
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(call[0]).toBe("https://ai.test/api/chat/completions");
    expect(call[1].headers.authorization).toBe("Bearer test-key");
    expect(plan.actions.map((action) => action.kind)).toEqual(["sellAll"]);
    expect(plan.error).toBeNull();
  });

  it("never throws when the key or endpoint fails", async () => {
    const noKey = await planAiActions(
      makeEnv({ AI_BOT_API_KEY: undefined }),
      makeLedger(),
      seasonAt(NOW),
      NOW,
      {},
    );
    expect(noKey.actions).toEqual([]);
    expect(noKey.error).toContain("AI_BOT_API_KEY");

    const failing = vi.fn(async () => new Response("boom", { status: 500 }));
    const failed = await planAiActions(
      makeEnv(),
      makeLedger(),
      seasonAt(NOW),
      NOW,
      {},
      failing as unknown as typeof fetch,
    );
    expect(failed.actions).toEqual([]);
    expect(failed.error).toContain("model HTTP 500");
  });

  it("retries once when a reasoning model burns the budget and returns no content", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: { content: "", reasoning_content: "Let me think about the whole garden first..." },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return modelReply(JSON.stringify({ actions: [{ kind: "sellAll" }] }));
    });
    const plan = await planAiActions(
      makeEnv(),
      makeLedger(),
      seasonAt(NOW),
      NOW,
      {},
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(plan.actions.map((action) => action.kind)).toEqual(["sellAll"]);
    expect(plan.error).toBeNull();
  });

  it("recovers the plan from reasoning_content when the content field is empty", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  reasoning_content: 'Plan: sell the bag now. {"actions":[{"kind":"sellAll"}]}',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const plan = await planAiActions(
      makeEnv(),
      makeLedger(),
      seasonAt(NOW),
      NOW,
      {},
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(plan.actions.map((action) => action.kind)).toEqual(["sellAll"]);
    expect(plan.reasoning).toContain("sell the bag");
  });

  it("returns a helpful error when the model replies with prose", async () => {
    const fetchImpl = vi.fn(async () => modelReply("Water everything, then sell."));
    const plan = await planAiActions(
      makeEnv(),
      makeLedger(),
      seasonAt(NOW),
      NOW,
      {},
      fetchImpl as unknown as typeof fetch,
    );
    expect(plan.actions).toEqual([]);
    expect(plan.error).toContain("no usable actions");
  });
});

/** Compile-time check kept for future context extensions. */
const _contextShape: AiGardenContext | null = null;
void _contextShape;
