import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { REST } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { ChatIncoming, ChatTurn, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { runPostTurnEffects, shouldRetryEmptyResponse } from "@/utils/chat/postTurnEffects";
import { recordReunionPresence, resolveReunionNote, type ReunionPresenceStore } from "@/utils/chat/reunionPresence";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { ColorCode } from "@/utils/misc/logger";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import {
  acquireChannelLockForTurn,
  channelLocks,
  getOrCreateChannelLockEntry,
  interruptNudgeScene,
} from "@/utils/chat/channelQueue";
import { getSelfReplyChainState } from "@/utils/chat/selfReplyState";
import { statRepository } from "@/utils/db/repositories";
import * as shortTermMemory from "@/utils/cache/shortTermMemoryCache";

const emptyResponseResult: GenerationTurnResult = {
  status: "empty_response",
  streamResults: [],
  personaResponses: [],
};

function makeContext(options: {
  shouldSurfaceUserErrors: boolean;
  isUserImpersonation?: boolean;
  textCredentialSource?: "server" | "personal";
}): {
  context: ChatTurnContext;
  send: ReturnType<typeof mock>;
} {
  const collector = {
    on: () => collector,
  };
  const send = mock(async (_payload: unknown) => ({
    id: "sent_msg_1",
    createMessageComponentCollector: () => collector,
  }));
  const channel = {
    id: `channel_${options.shouldSurfaceUserErrors ? "deliberate" : "passive"}`,
    send,
    client: { rest: new REST() },
    isThread: () => false,
  };
  const message = {
    id: `message_${options.shouldSurfaceUserErrors ? "deliberate" : "passive"}`,
    channel,
    createdTimestamp: Date.now(),
  };
  const incoming = {
    client: {
      channels: {
        fetch: async () => null,
      },
    },
    message,
    isFromQueue: false,
    retryCount: 2,
    skipLock: false,
    isPersonaJob: false,
    isUserImpersonation: options.isUserImpersonation ?? false,
    textQuotaSource: "user",
  } as unknown as ChatIncoming;
  const tomoriState = createPersona({
    llm: createLlmRow(),
    config: { thought_log_channel_disc_id: null, private_channel_ids: [] },
  });

  return {
    context: {
      client: incoming.client,
      message,
      channel,
      locale: "en-US",
      turn: {
        lockedTurn: {
          admission: {
            incoming,
          },
        },
      },
      currentPersona: tomoriState,
      tomoriState,
      shouldSurfaceUserErrors: options.shouldSurfaceUserErrors,
      isUserImpersonation: options.isUserImpersonation ?? false,
      textCredentialSource: options.textCredentialSource ?? "server",
      shouldApplyTextQuota: false,
      simplifiedMessages: [],
      isStopResponse: false,
      isDMChannel: false,
      reunionPresence: null,
      streamingContext: {},
    } as unknown as ChatTurnContext,
    send,
  };
}

describe("empty-response post-turn handling", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("allows two retries before exhausting the retry budget", () => {
    const incoming = { retryCount: 0 } as ChatIncoming;

    expect(shouldRetryEmptyResponse(incoming, emptyResponseResult)).toBe(true);
    incoming.retryCount = 1;
    expect(shouldRetryEmptyResponse(incoming, emptyResponseResult)).toBe(true);
    incoming.retryCount = 2;
    expect(shouldRetryEmptyResponse(incoming, emptyResponseResult)).toBe(false);
  });

  it("surfaces the localized terminal warning with recovery tips for a deliberate turn", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: true });

    await runPostTurnEffects(context, emptyResponseResult);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as
      | {
          embeds?: Array<{ toJSON: () => { title?: string; footer?: { text?: string } } }>;
          components?: Array<{ components?: Array<{ data?: { label?: string } }> }>;
        }
      | undefined;
    expect(payload?.embeds?.[0]?.toJSON().title).toBe(
      localizedStatusTitle("en-US", "genai.empty_response_title", ColorCode.WARN),
    );
    expect(payload?.embeds?.[0]?.toJSON().footer?.text).toBe(
      localizedCopy("en-US", "genai.stream.error_footer_server_provider", {
        provider: getProviderDisplayName(context.tomoriState.llm.llm_provider),
      }),
    );
    expect(payload?.components?.length).toBeGreaterThan(0);
    expect(payload?.components?.[0]?.components?.[0]?.data?.label).toBe(localizedCopy("en-US", "genai.tips.button"));
  });

  it("surfaces the terminal warning even when partial text was already delivered to Discord", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: true });
    const partiallyDeliveredResult: GenerationTurnResult = {
      ...emptyResponseResult,
      personaResponses: [
        {
          personaName: "Kamila",
          text: "you're a menace",
        },
      ],
    };

    await runPostTurnEffects(context, partiallyDeliveredResult);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as
      | {
          embeds?: Array<{ toJSON: () => { title?: string } }>;
        }
      | undefined;
    expect(payload?.embeds?.[0]?.toJSON().title).toBe(
      localizedStatusTitle("en-US", "genai.empty_response_title", ColorCode.WARN),
    );
  });

  it("attaches personal-provider recovery guidance when textCredentialSource is personal", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: true, textCredentialSource: "personal" });

    await runPostTurnEffects(context, emptyResponseResult);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as
      | {
          components?: Array<{ components?: Array<{ data?: { label?: string } }> }>;
        }
      | undefined;
    expect(payload?.components?.length).toBeGreaterThan(0);
  });

  it("keeps terminal exhaustion silent for a passive turn", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: false });

    await runPostTurnEffects(context, emptyResponseResult);

    expect(send).not.toHaveBeenCalled();
  });

  it("throws terminal exhaustion back to a user-impersonation flow", async () => {
    const { context, send } = makeContext({
      shouldSurfaceUserErrors: true,
      isUserImpersonation: true,
    });

    await expect(runPostTurnEffects(context, emptyResponseResult)).rejects.toThrow(
      "User impersonation returned an empty response.",
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("nudge persona mention handoffs", () => {
  const channelId = "nudge-handoff-channel";
  const restores: Array<{ mockRestore(): void }> = [];
  afterEach(() => {
    channelLocks.delete(channelId);
    for (const restore of restores.splice(0)) restore.mockRestore();
  });

  function nudgeTurn() {
    const { context } = makeContext({ shouldSurfaceUserErrors: false });
    Object.assign(context.channel, { id: channelId });
    const moo = createPersona({ persona_id: 1, persona_nickname: "Moo", trigger_words: ["moo"] });
    context.currentPersona = moo;
    context.tomoriState = moo;
    context.allPersonas = [
      moo,
      createPersona({ persona_id: 2, is_alter: true, persona_nickname: "Juno", trigger_words: ["juno"] }),
      createPersona({ persona_id: 3, is_alter: true, persona_nickname: "Mirri", trigger_words: ["mirri"] }),
      createPersona({ persona_id: 4, is_alter: true, persona_nickname: "Rye", trigger_words: ["rye"] }),
    ];
    context.userDiscId = "fixture-bystander";
    context.triggererUserId = 77;
    context.textQuotaTriggerKey = "fixture-nudge";
    context.simplifiedMessages = [{ content: "earlier human message" }] as ChatTurnContext["simplifiedMessages"];
    const incoming = context.turn.lockedTurn.admission.incoming;
    incoming.isManuallyTriggered = true;
    incoming.borrowsTriggerMessage = true;
    incoming.naturalNudge = { toolNames: ["web_search"], targetUserDiscId: "fixture-target" };
    const lockEntry = getOrCreateChannelLockEntry(channelId, "fixture-server");
    acquireChannelLockForTurn(lockEntry, {
      messageId: context.message.id,
      userDiscId: context.userDiscId,
      isPersonaJob: false,
      isCommandTriggered: true,
      naturalNudge: "single",
    });
    return { context, incoming, lockEntry };
  }

  function delivered(text: string, persona?: TomoriState): GenerationTurnResult {
    return {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: text }],
      personaResponses: [
        { personaName: persona?.persona_nickname ?? "Moo", personaId: persona?.persona_id ?? 1, text },
      ],
    };
  }

  it("queues explicit mentions once in text order and preserves system accounting without copying private goals", async () => {
    const { context, incoming, lockEntry } = nudgeTurn();
    const stats = spyOn(statRepository, "recordStat").mockImplementation(() => {});
    const stm = spyOn(shortTermMemory, "storeShortTermMemory").mockImplementation(() => {});
    restores.push(stats, stm);
    incoming.injectedContextItems = [{ role: "system", parts: [{ type: "text", text: "private opener goal" }] }];
    getSelfReplyChainState(channelId).triggerCount = 7;

    await runPostTurnEffects(context, delivered("@Mirri, Rye has a point. @Juno, @Mirri, @Moo, what do you think?"));

    expect(lockEntry.messageQueue.map((job) => job.selectedPersonaId)).toEqual([3, 2]);
    for (const job of lockEntry.messageQueue) {
      expect(job).toMatchObject({
        isPersonaJob: true,
        isManuallyTriggered: true,
        borrowsTriggerMessage: true,
        textQuotaSource: "system",
        naturalNudge: { toolNames: [], targetUserDiscId: "fixture-target" },
        shouldSurfaceUserErrors: false,
      });
      expect(job.injectedContextItems).toBeUndefined();
      expect(job.manualSystemPrompt).toBeTruthy();
    }
    expect(getSelfReplyChainState(channelId).triggerCount).toBe(1);
    expect(stm).not.toHaveBeenCalled();
    const metrics = stats.mock.calls.map(([stat]) => stat.metric);
    expect(metrics).toContain("model_used");
    expect(metrics).not.toContain("message_sent");
    expect(metrics).not.toContain("active_hour");
    expect(metrics).not.toContain("channel_turn");
  });

  it("caps explicit co-matches at the server's match limit", async () => {
    const { context, lockEntry } = nudgeTurn();
    context.tomoriState.config.match_limit = 1;
    await runPostTurnEffects(context, delivered("@Mirri and @Juno"));
    expect(lockEntry.messageQueue.map((job) => job.selectedPersonaId)).toEqual([3]);
  });

  it("lets a nudge reply mention another persona while consuming the existing cascade budget", async () => {
    const { context, incoming, lockEntry } = nudgeTurn();
    incoming.isPersonaJob = true;
    context.isPersonaJob = true;
    getSelfReplyChainState(channelId).triggerCount = 1;
    await runPostTurnEffects(context, delivered("@Juno, what do you think?"));
    expect(getSelfReplyChainState(channelId).triggerCount).toBe(2);
    expect(lockEntry.messageQueue.map((job) => job.selectedPersonaId)).toEqual([2]);
    expect(lockEntry.messageQueue[0].naturalNudge).toBeDefined();
  });

  it("does not duplicate pending nudge responders and applies the match limit to newly queued personas", async () => {
    const { context, incoming, lockEntry } = nudgeTurn();
    await runPostTurnEffects(context, delivered("@Juno and @Mirri, what do you think?"));
    expect(lockEntry.messageQueue.map((job) => job.selectedPersonaId)).toEqual([2, 3]);
    const firstReply = lockEntry.messageQueue.shift();
    const juno = context.allPersonas.find((persona) => persona.persona_id === firstReply?.selectedPersonaId);
    if (!juno) throw new Error("Expected the first queued responder");
    context.currentPersona = juno;
    incoming.isPersonaJob = true;
    context.isPersonaJob = true;
    context.tomoriState.config.match_limit = 1;

    await runPostTurnEffects(context, delivered("What about you, @Mirri? @Rye, any ideas?", juno));

    expect(lockEntry.messageQueue.map((job) => job.selectedPersonaId)).toEqual([4, 3]);
    expect(getSelfReplyChainState(channelId).triggerCount).toBe(2);
  });

  it("uses delivered dialogue, excluding scene metadata and unfinished turns", async () => {
    for (const status of ["completed", "empty_response", "stopped_by_user", "error"] as const) {
      const { context, lockEntry } = nudgeTurn();
      const result = delivered(status === "completed" ? "Juno, hello" : "@Juno, hello");
      result.status = status;
      result.personaResponses[0].text += "\n\n[Scene Metadata]\n@Mirri";
      result.streamResults[0].detailsContent = "@Mirri";
      await runPostTurnEffects(context, result);
      expect(lockEntry.messageQueue).toHaveLength(0);
    }
  });

  it("keeps scripted scenes on their planned sequence", async () => {
    const { context, incoming, lockEntry } = nudgeTurn();
    incoming.sceneTurn = { commandId: "fixture-scene", sequence: [], turnIndex: 0, totalTurns: 2 };
    await runPostTurnEffects(context, delivered("@Juno, hello"));
    expect(lockEntry.messageQueue).toHaveLength(0);
  });

  it("does not add replies after a member interrupts and drops pending nudge handoffs", async () => {
    const { context, lockEntry } = nudgeTurn();
    await runPostTurnEffects(context, delivered("@Juno, hello"));
    expect(lockEntry.messageQueue).toHaveLength(1);
    expect(interruptNudgeScene(channelId)).toBe(2);
    expect(lockEntry.messageQueue).toHaveLength(0);
    await runPostTurnEffects(context, delivered("@Mirri, hello"));
    expect(lockEntry.messageQueue).toHaveLength(0);
  });
});

describe("reunion presence post-turn phase", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  const presenceStore: ReunionPresenceStore = {
    isTrackingEnabled: true,
    getUserPersonaReunionInfo: async () => ({ lastPreviousDayAt: null, seenToday: false }),
    recordPresenceSeen: async () => true,
  };
  const resolveArgs = {
    turn: { userRow: { user_id: 4101, timezone_offset: 0 }, triggererName: "Alice" } as ChatTurn,
    effectivePersona: {
      server_id: 5,
      persona_lineage_id: 4101,
      config: { time_awareness_enabled: true, timezone_offset: 0 },
    } as TomoriState,
    isUserImpersonation: false,
  };

  it("releases the context-build claim when the turn ends without a response", async () => {
    const claimed = await resolveReunionNote(resolveArgs, presenceStore);
    expect(claimed.presence?.mode).toBe("claimed");

    const { context } = makeContext({ shouldSurfaceUserErrors: false });
    context.reunionPresence = claimed.presence;
    await runPostTurnEffects(context, emptyResponseResult);

    // Still held, the claim would defer this second build instead of letting it claim again.
    const retry = await resolveReunionNote(resolveArgs, presenceStore);
    expect(retry.presence?.mode).toBe("claimed");
    await recordReunionPresence(retry.presence, emptyResponseResult, presenceStore);
  });
});
