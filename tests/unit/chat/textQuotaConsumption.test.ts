import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { ChatIncoming, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import type { TextQuotaTriggerState } from "@/utils/chat/textQuotaState";
import * as realTextQuotaManager from "@/utils/quota/textQuotaManager";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

/**
 * A personal turn that fell back to the server's model reaches the post-turn effects with the
 * server's text quota admitted and unconsumed. Consumption is the only thing that charges the
 * server for that answer, so it has to follow the reply rather than the admission.
 *
 * The quota manager is mocked here because `incrementTextQuota` writes usage rows: this verifies
 * which outcomes charge the account, not what the increment statement does.
 */
const incrementCalls: Array<{ serverId: number; userDiscId: string }> = [];

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/quota/textQuotaManager": realTextQuotaManager,
});

scopedMock.module("@/utils/quota/textQuotaManager", () => ({
  ...realTextQuotaManager,
  incrementTextQuota: async (serverId: number, userDiscId: string) => {
    incrementCalls.push({ serverId, userDiscId });
  },
}));

function makeArmedContext(): ChatTurnContext & { textQuotaState: TextQuotaTriggerState } {
  const channel = { id: "channel_1", send: async () => undefined, isThread: () => false };
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
  const tomoriState = { config: { thought_log_channel_disc_id: null, private_channel_ids: [] } };

  const context = {
    client: incoming.client,
    message,
    channel,
    locale: "en-US",
    turn: { lockedTurn: { admission: { incoming } } },
    currentPersona: tomoriState,
    tomoriState,
    shouldSurfaceUserErrors: true,
    isUserImpersonation: false,
    simplifiedMessages: [],
    isStopResponse: false,
    isDMChannel: false,
    reunionPresence: null,
    shouldApplyTextQuota: true,
    textQuotaTriggerKey: "trigger_1",
    textQuotaState: { serverId: 1, userDiscId: "user_1", consumed: false, createdAt: Date.now() },
  } as unknown as ChatTurnContext & { textQuotaState: TextQuotaTriggerState };

  return context;
}

function completedReply(): GenerationTurnResult {
  return {
    status: "completed",
    streamResults: [{ status: "completed", accumulatedText: "ok" }],
    personaResponses: [{ personaName: "Tomori", text: "ok", personaId: 10, personaLineageId: 100 }],
  };
}

function failedReply(): GenerationTurnResult {
  return {
    status: "error",
    streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
    personaResponses: [],
  };
}

describe("text quota consumption after a server model fallback", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("charges the admitted quota once for a server-backed reply", async () => {
    incrementCalls.length = 0;
    const context = makeArmedContext();
    const { runPostTurnEffects } = await import("@/utils/chat/postTurnEffects");

    await runPostTurnEffects(context, completedReply());

    expect(incrementCalls).toEqual([{ serverId: 1, userDiscId: "user_1" }]);
    expect(context.textQuotaState.consumed).toBe(true);
  });

  it("charges nothing when the server model answered with no reply text", async () => {
    incrementCalls.length = 0;
    const context = makeArmedContext();
    const { runPostTurnEffects } = await import("@/utils/chat/postTurnEffects");

    await runPostTurnEffects(context, failedReply());

    expect(incrementCalls).toEqual([]);
    expect(context.textQuotaState.consumed).toBe(false);
  });

  it("charges an already-consumed trigger group nothing more", async () => {
    incrementCalls.length = 0;
    const context = makeArmedContext();
    context.textQuotaState.consumed = true;
    const { runPostTurnEffects } = await import("@/utils/chat/postTurnEffects");

    await runPostTurnEffects(context, completedReply());

    expect(incrementCalls).toEqual([]);
  });
});
