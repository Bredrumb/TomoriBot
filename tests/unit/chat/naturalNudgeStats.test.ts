import * as tomoriChatModule from "@/events/messageCreate/tomoriChat";
import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { RecordStatInput } from "@/utils/db/repositories/StatRepository";
import type { ChatIncoming, ChatTurnContext, GenerationTurnResult, TomoriChatInput } from "@/utils/chat/types";
import * as shortTermMemoryCache from "@/utils/cache/shortTermMemoryCache";
import { statRepository } from "@/utils/db/repositories";
import { runPostTurnEffects } from "@/utils/chat/postTurnEffects";
import * as nudgeCache from "@/modules/natural-nudges/runtime/configCache";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";

const recorded: RecordStatInput[] = [];
const recordStatSpy = spyOn(statRepository, "recordStat").mockImplementation((input: RecordStatInput) => {
  recorded.push(input);
});

const LINEAGE_ID = 5;
const NUDGE = { toolNames: ["web_search"] };

function makeContext(isNaturalNudge: boolean, threadParentId?: string): ChatTurnContext {
  const channel = {
    id: `channel_${Math.random().toString(36).slice(2)}`,
    isThread: () => threadParentId !== undefined,
    parentId: threadParentId ?? null,
  };
  const message = { id: "message_1", channel, createdTimestamp: Date.now() };
  const incoming = {
    client: { channels: { fetch: async () => null } },
    message,
    isFromQueue: false,
    isManuallyTriggered: isNaturalNudge,
    retryCount: 0,
    skipLock: false,
    isPersonaJob: false,
    isUserImpersonation: false,
    textQuotaSource: isNaturalNudge ? "system" : "user",
    naturalNudge: isNaturalNudge ? NUDGE : undefined,
    borrowsTriggerMessage: isNaturalNudge || undefined,
  } as unknown as ChatIncoming;
  const tomoriState = createPersona({
    server_id: 7,
    persona_lineage_id: LINEAGE_ID,
    config: { thought_log_channel_disc_id: null, private_channel_ids: [] },
  });
  return {
    client: incoming.client,
    message,
    channel,
    guild: { id: "123456789012345678" },
    locale: "en-US",
    turn: { lockedTurn: { admission: { incoming } }, triggeredPersonaIds: [] },
    currentPersona: { ...tomoriState, persona_id: 3, persona_nickname: "Mirri" },
    tomoriState,
    triggererUserId: 42,
    contextItems: [],
    shouldSurfaceUserErrors: false,
    isUserImpersonation: false,
    isDMChannel: false,
    isFromQueue: false,
    isPersonaJob: false,
    shouldApplyTextQuota: false,
    simplifiedMessages: [],
    isStopResponse: false,
    reunionPresence: null,
    textQuotaTriggerKey: "nudge:7:message_1",
    expressionDelivery: { delivered: null },
  } as unknown as ChatTurnContext;
}

const completed: GenerationTurnResult = {
  status: "completed",
  streamResults: [{ status: "completed", accumulatedText: "hello" }],
  personaResponses: [{ text: "hello", personaName: "Mirri", personaId: 3, personaLineageId: LINEAGE_ID }],
};

function metrics(): string[] {
  return recorded.map((entry) => entry.metric);
}

describe("Natural Nudges turns stay out of engagement stats", () => {
  it("refreshes dormant eligibility only after a direct chat's stats and any older flush have persisted", async () => {
    let finishOlderFlush: (success: boolean) => void = () => undefined;
    const olderFlush = new Promise<boolean>((resolve) => {
      finishOlderFlush = resolve;
    });
    const flush = spyOn(statRepository, "flush").mockReturnValueOnce(olderFlush).mockResolvedValue(true);
    const invalidate = spyOn(nudgeCache, "invalidateInactiveNaturalNudgeGates").mockImplementation(() => undefined);
    const context = makeContext(false);
    context.turn.lockedTurn.admission.incoming.isDirectChat = true;
    try {
      await runPostTurnEffects(context, completed);
      await Bun.sleep(0);
      expect(invalidate).not.toHaveBeenCalled();
      finishOlderFlush(true);
      await Bun.sleep(0);
      expect(flush).toHaveBeenCalledTimes(2);
      expect(invalidate).toHaveBeenCalledWith(context.tomoriState.server_id);
      invalidate.mockClear();
      flush.mockResolvedValue(false);
      await runPostTurnEffects(context, completed);
      await Bun.sleep(0);
      expect(invalidate).not.toHaveBeenCalled();
      context.turn.lockedTurn.admission.incoming.isDirectChat = false;
      flush.mockClear();
      await runPostTurnEffects(context, completed);
      await Bun.sleep(0);
      expect(flush).not.toHaveBeenCalled();
    } finally {
      finishOlderFlush(true);
      flush.mockRestore();
      invalidate.mockRestore();
    }
  });

  beforeAll(async () => {
    await initializeLocalizer();
  });

  afterAll(() => {
    recordStatSpy.mockRestore();
  });

  beforeEach(() => {
    recorded.length = 0;
  });

  it("records neither message_sent nor active_hour for a nudge, but still records usage", async () => {
    await runPostTurnEffects(makeContext(true), completed);
    await Bun.sleep(0);

    expect(metrics()).not.toContain("message_sent");
    expect(metrics()).not.toContain("active_hour");
    expect(metrics()).not.toContain("channel_turn");
    expect(metrics()).toContain("model_used");
    expect(metrics()).toContain("text_generated");
  });

  it("records human conditioning once and tags its heat source", async () => {
    for (const type of ["reward", "punish"] as const) {
      recorded.length = 0;
      const context = makeContext(false);
      context.turn.lockedTurn.admission.incoming = normalizeChatInvocation({
        ...context.turn.lockedTurn.admission.incoming,
        conditioningInteraction: { actorType: "user", type },
      });
      await runPostTurnEffects(context, completed);
      await Bun.sleep(0);

      expect(recorded.filter((entry) => entry.metric === "message_sent")).toEqual([
        { serverId: 7, userId: 42, lineageId: LINEAGE_ID, metric: "message_sent", metricKey: type },
      ]);
      expect(metrics()).toContain("active_hour");
      expect(metrics()).toContain("channel_turn");
    }
  });

  it("excludes persona reactions from engagement while retaining usage", async () => {
    for (const type of ["reward", "punish"] as const) {
      recorded.length = 0;
      const context = makeContext(false);
      context.turn.lockedTurn.admission.incoming = normalizeChatInvocation({
        ...context.turn.lockedTurn.admission.incoming,
        conditioningInteraction: { actorType: "persona", type },
      });
      await runPostTurnEffects(context, completed);
      await Bun.sleep(0);

      expect(metrics()).not.toContain("message_sent");
      expect(metrics()).not.toContain("active_hour");
      expect(metrics()).not.toContain("channel_turn");
      expect(metrics()).toContain("model_used");
      expect(metrics()).toContain("text_generated");
    }
  });

  it("records all three for an ordinary turn", async () => {
    const context = makeContext(false);
    await runPostTurnEffects(context, completed);
    await Bun.sleep(0);

    expect(metrics()).toContain("message_sent");
    expect(metrics()).toContain("active_hour");
    expect(recorded.filter((entry) => entry.metric === "channel_turn").map((entry) => entry.metricKey)).toEqual([
      context.channel.id,
    ]);
  });

  it("records a thread turn under its parent channel", async () => {
    await runPostTurnEffects(makeContext(false, "1400000000000000001"), completed);
    await Bun.sleep(0);

    expect(recorded.filter((entry) => entry.metric === "channel_turn").map((entry) => entry.metricKey)).toEqual([
      "1400000000000000001",
    ]);
  });

  it("stores short-term memory for human turns without treating generated exchanges as human relationships", async () => {
    const stored: string[] = [];
    const storeSpy = spyOn(shortTermMemoryCache, "storeShortTermMemory").mockImplementation(((userDiscId: string) => {
      stored.push(userDiscId);
    }) as typeof shortTermMemoryCache.storeShortTermMemory);
    const withHistory = (isNaturalNudge: boolean) => {
      const context = makeContext(isNaturalNudge);
      Object.assign(context, {
        userDiscId: "fixture-juno",
        simplifiedMessages: [{ authorType: "user", authorName: "Juno", content: "bye" }],
      });
      Object.assign(context.turn, { requestSnapshot: { triggererPrivacyLevel: 0 } });
      return context;
    };
    try {
      await runPostTurnEffects(withHistory(false), completed);
      await runPostTurnEffects(withHistory(true), completed);
      const personaReaction = withHistory(false);
      personaReaction.turn.lockedTurn.admission.incoming.conditioningInteraction = {
        actorType: "persona",
        type: "reward",
      };
      await runPostTurnEffects(personaReaction, completed);
      await Bun.sleep(0);
      expect(stored).toEqual(["fixture-juno"]);
    } finally {
      storeSpy.mockRestore();
    }
  });

  it("preserves conditioning heat sources on empty-response retries", async () => {
    const calls: TomoriChatInput[] = [];
    const chatSpy = spyOn(tomoriChatModule, "tomoriChat").mockImplementation(async (input) => {
      calls.push(input);
      return "run";
    });
    try {
      for (const actorType of ["user", "persona"] as const) {
        for (const type of ["reward", "punish"] as const) {
          const context = makeContext(false);
          context.turn.lockedTurn.admission.incoming.conditioningInteraction = { actorType, type };
          await runPostTurnEffects(context, { status: "empty_response", streamResults: [], personaResponses: [] });
          expect(calls.at(-1)?.conditioningInteraction).toEqual({ actorType, type });
        }
      }
      expect(metrics()).not.toContain("message_sent");
    } finally {
      chatSpy.mockRestore();
    }
  });

  it("keeps nudge and direct-chat activity semantics on empty-response retries", async () => {
    const calls: TomoriChatInput[] = [];
    const chatSpy = spyOn(tomoriChatModule, "tomoriChat").mockImplementation(async (input) => {
      calls.push(input);
      return "run";
    });
    try {
      await runPostTurnEffects(makeContext(true), {
        status: "empty_response",
        streamResults: [],
        personaResponses: [],
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.naturalNudge).toEqual(NUDGE);
      expect(calls[0]?.borrowsTriggerMessage).toBe(true);
      expect(calls[0]?.skipLock).toBe(true);
      const direct = makeContext(false);
      direct.turn.lockedTurn.admission.incoming.isDirectChat = true;
      await runPostTurnEffects(direct, { status: "empty_response", streamResults: [], personaResponses: [] });
      expect(calls[1]?.isDirectChat).toBe(true);
      expect(calls[1]?.naturalNudge).toBeUndefined();
    } finally {
      chatSpy.mockRestore();
    }
  });
});
