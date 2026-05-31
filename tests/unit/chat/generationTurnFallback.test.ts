import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Client, Message } from "discord.js";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import type { ProviderConfig } from "@/types/provider/interfaces";
import type { FallbackNoticeAttempt } from "@/utils/discord/fallbackModelNotice";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import type { ToolLoopParams } from "@/utils/chat/toolLoop";

const queuedResults: GenerationTurnResult[] = [];
const toolLoopCalls: Array<{ model: string; suppressUserErrors: boolean | undefined }> = [];
const fallbackNoticeCalls: Array<{ failures: FallbackNoticeAttempt[]; successModel: LlmRow }> = [];
const testStopRequests = new Map<string, { type: "stop" | "follow_up"; stopContext?: TestStopContext }>();

type TestStopContext = {
  originalStopMessage: Message;
  client: Client;
};

mock.module("@/utils/misc/logger", () => ({
  log: {
    error: () => undefined,
    info: () => undefined,
    section: () => undefined,
    success: () => undefined,
    warn: () => undefined,
  },
}));

mock.module("@/utils/cache/channelLlmCache", () => ({
  getCachedChannelLlm: async () => null,
}));

mock.module("@/utils/cache/geminiCapabilityCache", () => ({
  getGeminiTokenLimits: () => undefined,
}));

mock.module("@/utils/cache/novelaiCapabilityCache", () => ({
  getNovelAITokenLimits: () => undefined,
}));

mock.module("@/utils/cache/novelaiSubscriptionCache", () => ({
  getCachedContextTokens: () => undefined,
  refreshNovelAISubscription: async () => undefined,
}));

mock.module("@/utils/cache/openrouterCapabilityCache", () => ({
  getOpenRouterTokenLimits: () => undefined,
  isOpenRouterCapabilityCacheReady: () => false,
}));

mock.module("@/utils/db/repositories", () => ({
  llmProviderRepo: {
    loadSavedProviderConfig: async () => null,
  },
}));

mock.module("@/utils/discord/fallbackModelNotice", () => ({
  sendFallbackModelUsageNotice: async (args: { failures: FallbackNoticeAttempt[]; successModel: LlmRow }) => {
    fallbackNoticeCalls.push({ failures: args.failures, successModel: args.successModel });
  },
}));

mock.module("@/utils/discord/streamOrchestrator", () => ({
  StreamOrchestrator: {
    requestStop(channelId: string, requesterId?: string, stopContext?: TestStopContext): boolean {
      void requesterId;
      testStopRequests.set(channelId, { type: "stop", stopContext });
      return true;
    },

    requestFollowUp(channelId: string, requesterId: string): boolean {
      void requesterId;
      testStopRequests.set(channelId, { type: "follow_up" });
      return true;
    },

    hasStopRequest(channelId: string): boolean {
      return testStopRequests.has(channelId);
    },

    clearStopRequest(channelId: string): void {
      const request = testStopRequests.get(channelId);
      if (!request?.stopContext) {
        testStopRequests.delete(channelId);
      }
    },

    getAndClearStopContext(channelId: string): TestStopContext | null {
      const request = testStopRequests.get(channelId);
      if (!request?.stopContext) {
        return null;
      }
      testStopRequests.delete(channelId);
      return request.stopContext;
    },
  },
}));

mock.module("@/utils/provider/personalProviderRuntime", () => ({
  applyPersonalProviderSelectionsToTomoriState: async (tomoriState: TomoriState) => ({
    tomoriState,
    activeConfigs: {},
  }),
}));

mock.module("@/utils/provider/providerFactory", () => ({
  getProviderForTomori: async () => fakeProvider,
  ProviderFactory: {
    getProviderByName: async () => fakeProvider,
  },
}));

mock.module("@/utils/security/crypto", () => ({
  decryptApiKey: async () => "decrypted-key",
}));

mock.module("@/utils/security/keyRotation", () => ({
  MAX_KEY_ATTEMPTS: 3,
  hasAvailableRotationKey: async () => false,
  recordKeyError: async () => undefined,
  recordKeySuccess: async () => undefined,
  selectApiKey: async () => null,
}));

mock.module("@/utils/chat/toolLoop", () => ({
  providerIsApiFamily: () => false,
  runToolLoop: async (params: ToolLoopParams) => {
    toolLoopCalls.push({
      model: params.tomoriState.llm.llm_codename,
      suppressUserErrors: params.context.streamingContext.suppressUserErrors,
    });
    const next = queuedResults.shift();
    if (!next) {
      throw new Error("No queued generation result for test");
    }
    return next;
  },
}));

const fakeProvider = {
  createConfig: async (tomoriState: TomoriState, apiKey: string): Promise<ProviderConfig> => ({
    apiKey,
    model: tomoriState.llm.llm_codename,
    temperature: tomoriState.config.llm_temperature ?? 0.7,
  }),
  getInfo: () => ({ name: "google" }),
};

function makeLlm(id: number, codename: string): LlmRow {
  return {
    llm_id: id,
    llm_codename: codename,
    llm_provider: "google",
    has_tools: false,
    sees_images: false,
    sees_videos: false,
    supports_structoutput: false,
  } as unknown as LlmRow;
}

function makeContext(primaryModel: LlmRow, fallbackModel: LlmRow): ChatTurnContext {
  const channel = {
    id: "channel_1",
    isThread: () => false,
  };
  const state = {
    server_id: 1,
    persona_id: 10,
    persona_lineage_id: 100,
    persona_nickname: "Tomori",
    is_alter: false,
    llm: primaryModel,
    fallback_chain: [{ kind: "llm", model: fallbackModel }],
    config: {
      api_key: "encrypted-key",
      key_version: 1,
      llm_temperature: 0.7,
      private_channel_ids: [],
      tool_notice_hidden_keys: [],
    },
  } as unknown as TomoriState;

  return {
    channel,
    client: {},
    contextItems: [],
    currentPersona: state,
    emojiStrings: [],
    guild: null,
    isDMChannel: false,
    isFromQueue: true,
    isPersonaJob: false,
    isSelfMessage: false,
    isStopResponse: false,
    isUserImpersonation: false,
    loadedEmojis: null,
    loadedStickers: null,
    locale: "en-US",
    message: { id: "message_1", channel },
    messageIdMap: new Map(),
    personalRoutingUserId: null,
    personalTextProvider: null,
    requestSnapshot: {},
    serverDiscId: "server_1",
    shouldApplyTextQuota: false,
    shouldSurfaceUserErrors: true,
    simplifiedMessages: [],
    streamingContext: {
      disableYouTubeProcessing: false,
    },
    textCredentialSource: "server",
    textQuotaState: null,
    textQuotaTriggerKey: "trigger_1",
    tomoriState: state,
    turn: {
      lockedTurn: {
        admission: {
          incoming: {
            retryCount: 0,
          },
        },
        channelId: "channel_1",
        lockedAt: Date.now(),
        queueDepth: 0,
        skipLock: false,
      },
    },
    userDiscId: "user_1",
  } as unknown as ChatTurnContext;
}

describe("runGenerationTurn fallback behavior", () => {
  beforeEach(async () => {
    queuedResults.length = 0;
    toolLoopCalls.length = 0;
    fallbackNoticeCalls.length = 0;

    const { StreamOrchestrator } = await import("@/utils/discord/streamOrchestrator");
    StreamOrchestrator.clearStopRequest("channel_1");
    StreamOrchestrator.getAndClearStopContext("channel_1");
  });

  it("suppresses primary errors and posts compact fallback notice when a fallback succeeds", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const emittedErrors: unknown[] = [];
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async (result) => {
        emittedErrors.push(result);
      },
      emitError: async (error) => {
        emittedErrors.push(error);
      },
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const fallbackSuccess: GenerationTurnResult = {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "ok" }],
      personaResponses: [
        {
          personaName: "Tomori",
          text: "ok",
          personaId: 10,
          personaLineageId: 100,
        },
      ],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      fallbackSuccess,
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(fallbackSuccess);
    expect(toolLoopCalls).toEqual([
      { model: "primary-model", suppressUserErrors: true },
      { model: "fallback-model", suppressUserErrors: false },
    ]);
    expect(emittedErrors).toHaveLength(0);
    expect(finalizedResults).toEqual([fallbackSuccess]);
    expect(fallbackNoticeCalls).toHaveLength(1);
    expect(fallbackNoticeCalls[0]?.failures).toEqual([{ modelCodename: "primary-model", errorCode: "429" }]);
    expect(fallbackNoticeCalls[0]?.successModel.llm_codename).toBe("fallback-model");
    expect(context.streamingContext.suppressUserErrors).toBe(false);
    expect(context.streamingContext.forceModelFallback).toBe(false);
  });

  it("does not post fallback notice when fallback is interrupted by a follow-up", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const interruptedResult: GenerationTurnResult = {
      status: "follow_up_interrupt",
      streamResults: [{ status: "follow_up_interrupt" }],
      personaResponses: [],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      interruptedResult,
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(interruptedResult);
    expect(finalizedResults).toEqual([interruptedResult]);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("does not post fallback notice when fallback is stopped by a natural stop", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const stoppedResult: GenerationTurnResult = {
      status: "stopped_by_user",
      streamResults: [{ status: "stopped_by_user", stopReason: "user_request" }],
      personaResponses: [],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      stoppedResult,
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(stoppedResult);
    expect(finalizedResults).toEqual([stoppedResult]);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("suppresses completed fallback notice when a follow-up request is already pending", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const fallbackSuccess: GenerationTurnResult = {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "ok" }],
      personaResponses: [
        {
          personaName: "Tomori",
          text: "ok",
          personaId: 10,
          personaLineageId: 100,
        },
      ],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      fallbackSuccess,
    );

    const { StreamOrchestrator } = await import("@/utils/discord/streamOrchestrator");
    StreamOrchestrator.requestFollowUp(context.channel.id, context.userDiscId);

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(fallbackSuccess);
    expect(finalizedResults).toEqual([fallbackSuccess]);
    expect(fallbackNoticeCalls).toHaveLength(0);
    expect(StreamOrchestrator.hasStopRequest(context.channel.id)).toBe(false);
  });

  it("suppresses completed fallback notice while preserving a pending stop response context", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const fallbackSuccess: GenerationTurnResult = {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "ok" }],
      personaResponses: [
        {
          personaName: "Tomori",
          text: "ok",
          personaId: 10,
          personaLineageId: 100,
        },
      ],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      fallbackSuccess,
    );

    const { StreamOrchestrator } = await import("@/utils/discord/streamOrchestrator");
    StreamOrchestrator.requestStop(context.channel.id, context.userDiscId, {
      originalStopMessage: context.message as unknown as Message,
      client: context.client as unknown as Client,
    });

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(fallbackSuccess);
    expect(finalizedResults).toEqual([fallbackSuccess]);
    expect(fallbackNoticeCalls).toHaveLength(0);
    expect(StreamOrchestrator.getAndClearStopContext(context.channel.id)).not.toBeNull();
  });
});
