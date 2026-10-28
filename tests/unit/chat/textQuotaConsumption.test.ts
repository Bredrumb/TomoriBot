import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { QuotaReservation } from "@/utils/db/repositories/QuotaRepository";
import type { ChatIncoming, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import type { TextQuotaTriggerState } from "@/utils/chat/textQuotaState";
import * as realTextQuotaManager from "@/utils/quota/textQuotaManager";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

/** A reply keeps the trigger's reserved unit; a turn with no reply gives it back. */
const releaseCalls: Array<{ serverId: number; userDiscId: string; reservation: QuotaReservation }> = [];

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/quota/textQuotaManager": realTextQuotaManager,
});

scopedMock.module("@/utils/quota/textQuotaManager", () => ({
  ...realTextQuotaManager,
  releaseTextQuota: async (serverId: number, userDiscId: string, reservation: QuotaReservation) => {
    releaseCalls.push({ serverId, userDiscId, reservation });
  },
}));

const RESERVATION: QuotaReservation = {
  quotaDate: "2026-10-28",
  userCounted: true,
  serverwidePeriodStart: null,
};

let textQuotaTriggerStates: Map<string, TextQuotaTriggerState>;

function makeArmedContext(options?: {
  personaIndex?: number;
  totalPersonas?: number;
  state?: TextQuotaTriggerState;
  triggerKey?: string;
}): ChatTurnContext & { textQuotaState: TextQuotaTriggerState } {
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
  const triggerKey = options?.triggerKey ?? `trigger_${Math.random().toString(36).slice(2)}`;
  const state = options?.state ?? {
    serverId: 1,
    userDiscId: "user_1",
    consumed: false,
    reservation: RESERVATION,
    reservationReleased: false,
    createdAt: Date.now(),
  };
  textQuotaTriggerStates.set(triggerKey, state);

  const context = {
    client: incoming.client,
    message,
    channel,
    locale: "en-US",
    turn: {
      lockedTurn: { admission: { incoming } },
      personaIndex: options?.personaIndex ?? 0,
      totalPersonas: options?.totalPersonas ?? 1,
    },
    currentPersona: tomoriState,
    tomoriState,
    shouldSurfaceUserErrors: true,
    isUserImpersonation: false,
    simplifiedMessages: [],
    isStopResponse: false,
    isDMChannel: false,
    reunionPresence: null,
    shouldApplyTextQuota: true,
    textQuotaTriggerKey: triggerKey,
    textQuotaState: state,
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

describe("text quota settlement after a turn", () => {
  beforeAll(async () => {
    await initializeLocalizer();
    textQuotaTriggerStates = (await import("@/utils/chat/textQuotaState")).textQuotaTriggerStates;
  });

  it("keeps the reservation for a reply instead of releasing it", async () => {
    releaseCalls.length = 0;
    const context = makeArmedContext();
    const { runPostTurnEffects } = await import("@/utils/chat/postTurnEffects");

    await runPostTurnEffects(context, completedReply());

    expect(releaseCalls).toEqual([]);
    expect(context.textQuotaState.consumed).toBe(true);
    expect(context.textQuotaState.reservation).toBeNull();
  });

  it("releases the reservation when the turn produced no reply", async () => {
    releaseCalls.length = 0;
    const context = makeArmedContext();
    const { runPostTurnEffects } = await import("@/utils/chat/postTurnEffects");

    await runPostTurnEffects(context, failedReply());

    expect(releaseCalls).toEqual([{ serverId: 1, userDiscId: "user_1", reservation: RESERVATION }]);
    expect(context.textQuotaState.consumed).toBe(false);
    expect(context.textQuotaState.reservation).toBeNull();
    expect(context.textQuotaState.reservationReleased).toBe(true);
  });

  it("does not release a trigger that already consumed its reservation", async () => {
    releaseCalls.length = 0;
    const context = makeArmedContext();
    context.textQuotaState.consumed = true;
    context.textQuotaState.reservation = null;
    const { runPostTurnEffects } = await import("@/utils/chat/postTurnEffects");

    await runPostTurnEffects(context, completedReply());

    expect(releaseCalls).toEqual([]);
  });

  it("waits for the last persona turn of the same plan before releasing", async () => {
    releaseCalls.length = 0;
    const state: TextQuotaTriggerState = {
      serverId: 1,
      userDiscId: "user_1",
      consumed: false,
      reservation: RESERVATION,
      reservationReleased: false,
      createdAt: Date.now(),
    };
    const triggerKey = "trigger_shared";
    const { runPostTurnEffects } = await import("@/utils/chat/postTurnEffects");

    const first = makeArmedContext({ personaIndex: 0, totalPersonas: 2, state, triggerKey });
    await runPostTurnEffects(first, failedReply());
    expect(releaseCalls).toEqual([]);
    expect(first.textQuotaState.reservation).toBe(RESERVATION);

    const second = makeArmedContext({ personaIndex: 1, totalPersonas: 2, state, triggerKey });
    await runPostTurnEffects(second, failedReply());
    expect(releaseCalls).toEqual([{ serverId: 1, userDiscId: "user_1", reservation: RESERVATION }]);
    expect(second.textQuotaState.reservation).toBeNull();
  });
});
