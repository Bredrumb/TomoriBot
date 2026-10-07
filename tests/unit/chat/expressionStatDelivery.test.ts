import * as stm from "@/utils/cache/shortTermMemoryCache";
import * as quotas from "@/utils/quota/textQuotaManager";
import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { RecordStatInput } from "@/utils/db/repositories/StatRepository";
import type { ChatIncoming, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { statRepository } from "@/utils/db/repositories";
import { runPostTurnEffects } from "@/utils/chat/postTurnEffects";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";

const recorded: RecordStatInput[] = [];

// A `mock.module` over the repositories barrel would be process-global for the whole run and is not
// undone by `mock.restore()`, which left `spyOn` against `statRepository` silently installing
// nothing in every file loaded afterwards. `recordStat` is resolved off the live singleton at call
// time, so spying the method captures the same calls without replacing the module for anyone else.
const recordStatSpy = spyOn(statRepository, "recordStat").mockImplementation((input: RecordStatInput) => {
  recorded.push(input);
});

const SERVER_ID = 7;
const USER_ID = 42;
const LINEAGE_ID = 5;

function metricKeys(metric: string): string[] {
  return recorded.filter((entry) => entry.metric === metric).map((entry) => entry.metricKey ?? "");
}

function makeContext(): ChatTurnContext {
  const channel = {
    // Unique per context so the delivered-identity and self-reply channel caches
    // never carry state between cases.
    id: `channel_${Math.random().toString(36).slice(2)}`,
    isThread: () => false,
  };
  const message = { id: "message_1", channel, createdTimestamp: Date.now() };
  const incoming = {
    client: { channels: { fetch: async () => null } },
    message,
    isFromQueue: false,
    retryCount: 0,
    skipLock: false,
    isPersonaJob: false,
    isUserImpersonation: false,
    textQuotaSource: "user",
  } as unknown as ChatIncoming;
  const tomoriState = createPersona({
    server_id: SERVER_ID,
    persona_lineage_id: LINEAGE_ID,
    config: { thought_log_channel_disc_id: null, private_channel_ids: [] },
  });

  return {
    client: incoming.client,
    message,
    channel,
    guild: { id: "123456789012345678" },
    locale: "en-US",
    turn: { lockedTurn: { admission: { incoming } } },
    currentPersona: { ...tomoriState, persona_id: 3, persona_nickname: "Tomori" },
    tomoriState,
    triggererUserId: USER_ID,
    contextItems: [],
    shouldSurfaceUserErrors: false,
    isUserImpersonation: false,
    isDMChannel: false,
    isFromQueue: false,
    shouldApplyTextQuota: false,
    simplifiedMessages: [],
    isStopResponse: false,
    reunionPresence: null,
  } as unknown as ChatTurnContext;
}

function makeResult(overrides: Partial<GenerationTurnResult>): GenerationTurnResult {
  return {
    status: "completed",
    streamResults: [],
    personaResponses: [{ text: "placeholder", personaName: "Tomori", personaId: 3, personaLineageId: LINEAGE_ID }],
    ...overrides,
  };
}

describe("emoji stats count only what Discord accepted", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  afterAll(() => {
    recordStatSpy.mockRestore();
  });

  beforeEach(() => {
    recorded.length = 0;
  });

  it("ignores emoji that only exist in the [Scene Metadata] block", async () => {
    const context = makeContext();
    await runPostTurnEffects(
      context,
      makeResult({
        streamResults: [{ status: "completed", accumulatedText: "hey <:Smile:111>" }],
        personaResponses: [
          {
            // The short-term-memory payload: delivered text plus the `<details>` drain,
            // which never reached Discord.
            text: "hey <:Smile:111>\n\n[Scene Metadata]\nshe grins <:Sneaky:222>",
            personaName: "Tomori",
            personaId: 3,
            personaLineageId: LINEAGE_ID,
          },
        ],
      }),
    );

    expect(metricKeys("emoji_used")).toEqual(["Smile"]);
  });

  it("counts emoji delivered before a tool call, not just the final stream segment", async () => {
    const context = makeContext();
    await runPostTurnEffects(
      context,
      makeResult({
        streamResults: [
          { status: "function_call", accumulatedText: "gimme a sec <:Think:111>" },
          { status: "completed", accumulatedText: "found it <:Smile:222> <:Smile:222>" },
        ],
        personaResponses: [
          {
            text: "found it <:Smile:222> <:Smile:222>",
            personaName: "Tomori",
            personaId: 3,
            personaLineageId: LINEAGE_ID,
          },
        ],
      }),
    );

    const emojiStats = recorded.filter((entry) => entry.metric === "emoji_used");
    expect(emojiStats.map((entry) => [entry.metricKey, entry.delta ?? 1])).toEqual([
      ["Think", 1],
      ["Smile", 2],
    ]);
  });

  it("accounts for author attempts and reviewer spend on cancellation without recording dialogue", async () => {
    const context = makeContext();
    await runPostTurnEffects(
      context,
      makeResult({
        status: "stopped_by_user",
        personaResponses: [],
        usageEntries: [
          { kind: "author", model: "first-author", usage: { inputTokens: 11, outputTokens: 7 } },
          { kind: "reviewer", model: "review-model", usage: { inputTokens: 20, outputTokens: 3 } },
          { kind: "decision", model: "decision-model", decisionModelId: 7, usage: { inputTokens: 5, outputTokens: 0 } },
          { kind: "author", model: "fallback-author", usage: { inputTokens: 6, outputTokens: 2 } },
        ],
      }),
    );
    expect(
      recorded.filter((entry) => entry.metric === "tokens_in").map((entry) => [entry.metricKey, entry.delta]),
    ).toEqual([
      ["first-author", 11],
      ["review-model", 20],
      ["decision:7", 5],
      ["fallback-author", 6],
    ]);
    expect(recorded.filter((entry) => entry.metric === "reviewer_tokens_out").map((entry) => entry.delta)).toEqual([3]);
    expect(
      recorded.filter((entry) => entry.metric === "decision_tokens_in").map((entry) => [entry.metricKey, entry.delta]),
    ).toEqual([["decision:7", 5]]);
    expect(metricKeys("message_sent")).toEqual([]);
    expect(metricKeys("text_generated")).toEqual([]);
  });

  it("writes only delivered prose to memory and consumes one reply quota despite discarded drafts", async () => {
    const context = makeContext();
    context.turn.requestSnapshot = {};
    context.streamingContext = { disableYouTubeProcessing: false };
    context.userDiscId = "fixture_user";
    context.serverDiscId = "fixture_server";
    context.shouldApplyTextQuota = true;
    context.textQuotaTriggerKey = "fixture_trigger";
    context.textQuotaState = {
      serverId: SERVER_ID,
      userDiscId: "fixture_user",
      consumed: false,
    } as ChatTurnContext["textQuotaState"];
    context.simplifiedMessages = [
      { authorType: "user", authorName: "Juno", content: "Stay here." },
    ] as ChatTurnContext["simplifiedMessages"];
    const memory = spyOn(stm, "storeShortTermMemory").mockImplementation(() => {});
    const cadence = spyOn(stm, "incrementStmTurnCounter").mockImplementation(async () => {});
    const quota = spyOn(quotas, "incrementTextQuota").mockImplementation(async () => {});
    try {
      const result = makeResult({
        streamResults: [
          {
            status: "completed",
            accumulatedText: "",
            pendingResponse: { text: "discarded draft", deliver: async () => ({ status: "completed" }) },
          },
          { status: "completed", accumulatedText: "delivered reply" },
        ],
        personaResponses: [{ text: "delivered reply", personaName: "Mirri", personaId: 3 }],
        usageEntries: [
          { kind: "author", model: "author", usage: { inputTokens: 10, outputTokens: 6 } },
          { kind: "reviewer", model: "reviewer", usage: { inputTokens: 12, outputTokens: 2 } },
        ],
      });
      await runPostTurnEffects(context, result);
      expect(memory).toHaveBeenCalledTimes(1);
      const stored = memory.mock.calls[0]?.[2] ?? [];
      expect(stored.filter((entry) => entry.role === "model").map((entry) => entry.content)).toEqual([
        "delivered reply",
      ]);
      expect(quota).toHaveBeenCalledTimes(1);
      expect(context.textQuotaState?.consumed).toBe(true);
      expect(metricKeys("message_sent")).toHaveLength(1);
      expect(
        recorded
          .filter((entry) => entry.metric === "tokens_in")
          .reduce((total, entry) => total + (entry.delta ?? 0), 0),
      ).toBe(22);
    } finally {
      memory.mockRestore();
      cadence.mockRestore();
      quota.mockRestore();
    }
  });
});
