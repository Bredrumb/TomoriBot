import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Client, Message } from "discord.js";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import type { ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { FallbackNoticeAttempt } from "@/utils/discord/fallbackModelNotice";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import type { ToolLoopParams } from "@/utils/chat/toolLoop";
// Capture the REAL repository barrel before the mock below replaces it. Importing
// it is side-effect-free (the DB client connects lazily, not at import), and
// `mock.module` runs in source order (not hoisted), so this static import resolves
// to the real module. Spreading it into the mock keeps every repository export
// present, so command modules pulled into the SUT's dynamic-import graph can
// satisfy their static `import { ... }` bindings. Without this, running this file
// in its own process (per-file isolation in runTests.ts) fails to link exports
// like `serverScheduleRepository` that the graph imports but the stub omitted.
import * as realRepositories from "@/utils/db/repositories";

const queuedResults: GenerationTurnResult[] = [];
// Parallel to queuedResults: the delivered-message refs each runToolLoop call should push into the
// shared sink before returning its queued result, simulating messages the stream committed to
// Discord during that attempt. Undefined entries push nothing.
const queuedDeliveries: Array<Array<{ messageId: string; channelId: string; isWebhook: boolean }> | undefined> = [];
const toolLoopCalls: Array<{ model: string; suppressUserErrors: boolean | undefined }> = [];
const fallbackNoticeCalls: Array<{ failures: FallbackNoticeAttempt[]; successModel: LlmRow }> = [];
const testStopRequests = new Map<string, { type: "stop" | "follow_up"; stopContext?: TestStopContext }>();

type TestStopContext = {
  originalStopMessage: Message;
  client: Client;
};

mock.module("@/utils/misc/logger", () => ({
  // ColorCode must be included so that command modules imported by other test
  // files can satisfy their static `import { ColorCode }` bindings even when
  // this file's mock is the one in effect (bun applies mocks globally).
  // Values must stay hex STRINGS mirroring the real enum: modules evaluated
  // under this mock call string methods on them at load time (e.g.
  // contextEmbeds.ts does ColorCode.ERROR.replace("#", "")).
  ColorCode: {
    INFO: "#3498DB",
    SUCCESS: "#2ECC71",
    MEMORY_UPDATE: "#25d4da",
    WARN: "#F1C40F",
    ERROR: "#E74C3C",
    SECTION: "#E066FF",
    AFFECTION: "#ff10cb",
    RATE_LIMIT: "#FFA500",
  },
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
  clearOpenRouterOnDemandCapabilityCache: () => undefined,
  getOpenRouterCapabilities: () => undefined,
  getOpenRouterCapabilityCacheSize: () => 0,
  getOpenRouterOnDemandCapabilityCacheSize: () => 0,
  getOpenRouterPricing: () => undefined,
  getOpenRouterSupportedParameters: () => undefined,
  getOpenRouterTokenizer: () => undefined,
  getOpenRouterTokenLimits: () => undefined,
  getOrFetchOpenRouterCapabilities: async () => undefined,
  initializeOpenRouterCapabilityCache: async () => undefined,
  isOpenRouterCapabilityCacheReady: () => false,
  testAccountSettingModel: async () => ({ valid: false }),
}));

mock.module("@/utils/db/repositories", () => ({
  // Spread the real barrel first so every export the SUT graph imports is present,
  // then override only the repository methods this test's code path actually drives.
  ...realRepositories,
  llmProviderRepo: {
    loadSavedProviderConfig: async () => null,
  },
  configRepository: {
    updateNsfwConfig: async () => true,
  },
  personaRepository: {
    loadAllForServer: async () => [],
  },
  userRepository: {
    loadOrCreateUser: async () => null,
    updateLastSeen: async () => undefined,
  },
  serverRepository: {
    loadServerState: async () => null,
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

// Stub the FULL export surface of crypto. `mock.module` is process-wide and is
// never restored, so it replaces crypto.ts for every test file loaded after
// this one. If any real export is omitted here, later files that import it fail
// to link ("Export named X not found"), and which files become victims depends
// on module load order — making the suite fragile to unrelated import changes.
mock.module("@/utils/security/crypto", () => ({
  encryptApiKey: async () => ({ encrypted: Buffer.from(""), version: 1 }),
  decryptApiKey: async () => "decrypted-key",
  reencryptApiKey: async () => ({ encrypted: Buffer.from(""), version: 1 }),
  storeOptApiKey: async () => true,
  getOptApiKey: async () => null,
  getAllOptApiKeysForServer: async () => ({}),
  deleteOptApiKey: async () => true,
  hasOptApiKey: async () => false,
}));

mock.module("@/utils/security/keyRotation", () => ({
  MAX_KEY_ATTEMPTS: 3,
  hasAvailableRotationKey: async () => false,
  recordKeyError: async () => undefined,
  recordKeySuccess: async () => undefined,
  selectApiKey: async () => null,
}));

mock.module("@/utils/chat/toolLoop", () => ({
  providerIsApiFamily: (providerName: string, apiFamily: string) => {
    const families: Record<string, string> = {
      google: "google-genai",
      novelai: "novelai",
      openrouter: "openrouter",
    };
    return families[providerName.toLowerCase()] === apiFamily;
  },
  runToolLoop: runToolLoopMock,
}));

type ToolExecutionResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
};

type FunctionHistoryEntry = {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse: {
    functionResponse: {
      name: string;
      response: {
        result: unknown;
      };
    };
  };
};

async function runToolLoopMock(params: ToolLoopParams): Promise<GenerationTurnResult> {
  if (queuedResults.length > 0) {
    toolLoopCalls.push({
      model: params.tomoriState.llm.llm_codename,
      suppressUserErrors: params.context.streamingContext.suppressUserErrors,
    });
    // Simulate this attempt committing messages to the channel before it resolves, so the
    // supersede-cleanup path in runGenerationTurn has refs to act on.
    const deliveries = queuedDeliveries.shift();
    if (deliveries) {
      if (!params.context.streamingContext.deliveredMessageRefs) {
        params.context.streamingContext.deliveredMessageRefs = [];
      }
      params.context.streamingContext.deliveredMessageRefs.push(...deliveries);
    }
    const next = queuedResults.shift();
    if (!next) {
      throw new Error("No queued generation result for test");
    }
    return next;
  }

  return runToolLoopContractShim(params);
}

async function runToolLoopContractShim(params: ToolLoopParams): Promise<GenerationTurnResult> {
  const maxIterations = Number.parseInt(process.env.BOT_MAX_FUNCTION_CALL_ITERATIONS ?? "10", 10);
  const maxConsecutiveToolErrors = Number.parseInt(process.env.BOT_MAX_CONSECUTIVE_TOOL_ERRORS ?? "3", 10);
  const streamResults: StreamResult[] = [];
  const functionHistory: FunctionHistoryEntry[] = [];
  let consecutiveToolErrors = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const streamResult = await callProviderStream(params, functionHistory);
    streamResults.push(streamResult);

    if (streamResult.status === "completed") {
      return {
        status: "completed",
        streamResults,
        personaResponses: streamResult.accumulatedText
          ? [
              {
                personaName: params.tomoriState.persona_nickname,
                text: streamResult.accumulatedText,
                personaId: params.tomoriState.persona_id,
                personaLineageId: params.tomoriState.persona_lineage_id,
              },
            ]
          : [],
      };
    }

    if (streamResult.status !== "function_call") {
      return {
        status: streamResult.status === "timeout" ? "timeout" : "error",
        streamResults,
        personaResponses: [],
      };
    }

    const functionCall = parseFunctionCall(streamResult);
    if (!functionCall) {
      return { status: "error", streamResults, personaResponses: [] };
    }

    const toolResult = await executeToolForShim(params, functionCall);
    if (toolResult.success && handleContextRestartForShim(params, toolResult.data)) {
      continue;
    }

    if (!toolResult.success) {
      consecutiveToolErrors++;
    } else {
      consecutiveToolErrors = 0;
    }

    functionHistory.push({
      functionCall,
      functionResponse: {
        functionResponse: {
          name: functionCall.name,
          response: {
            result: toolResult.success
              ? (toolResult.data ?? { status: "completed" })
              : {
                  status: "tool_execution_failed",
                  reason: toolResult.message || toolResult.error || "Tool execution failed without specific error",
                  tool_name: functionCall.name,
                },
          },
        },
      },
    });

    if (consecutiveToolErrors >= maxConsecutiveToolErrors) {
      return { status: "error", streamResults, personaResponses: [] };
    }
  }

  return { status: "timeout", streamResults, personaResponses: [] };
}

async function callProviderStream(
  params: ToolLoopParams,
  functionHistory: FunctionHistoryEntry[],
): Promise<StreamResult> {
  const provider = params.provider as unknown as {
    streamToDiscord: (...args: unknown[]) => Promise<StreamResult>;
  };

  return provider.streamToDiscord(
    params.context.channel,
    params.context.client,
    params.tomoriState,
    params.providerConfig,
    params.context,
    [],
    params.context.emojiStrings,
    functionHistory,
  );
}

function parseFunctionCall(streamResult: StreamResult): { name: string; args: Record<string, unknown> } | null {
  const data = streamResult.data;
  if (!data || typeof data !== "object") return null;
  const candidate = data as { name?: unknown; args?: unknown };
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return null;
  return {
    name: candidate.name,
    args:
      candidate.args && typeof candidate.args === "object" && !Array.isArray(candidate.args)
        ? (candidate.args as Record<string, unknown>)
        : {},
  };
}

async function executeToolForShim(
  params: ToolLoopParams,
  functionCall: { name: string; args: Record<string, unknown> },
): Promise<ToolExecutionResult> {
  const allowedToolNames = params.context.streamingContext.deliberateToolAllowedNames;
  if (
    params.context.deliberateToolModeActive &&
    Array.isArray(allowedToolNames) &&
    !allowedToolNames.includes(functionCall.name)
  ) {
    return {
      success: false,
      error: `Tool "${functionCall.name}" was not exposed for this deliberate tool mode turn.`,
    };
  }

  const { ToolRegistry } = (await import("@/tools/toolRegistry")) as {
    ToolRegistry: {
      executeTool: (name: string, args: Record<string, unknown>, context?: unknown) => Promise<ToolExecutionResult>;
    };
  };

  return ToolRegistry.executeTool(functionCall.name, functionCall.args, params.context);
}

function handleContextRestartForShim(params: ToolLoopParams, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const result = data as { type?: unknown; enhanced_context_item?: unknown };
  if (typeof result.type !== "string" || !result.type.startsWith("context_restart")) return false;

  if (result.enhanced_context_item) {
    params.context.contextItems.push(result.enhanced_context_item as never);
  }
  if (result.type.includes("youtube")) {
    params.context.streamingContext.disableYouTubeProcessing = true;
  }
  return true;
}

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
    queuedDeliveries.length = 0;
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
    expect(fallbackNoticeCalls[0]?.failures).toEqual([{ modelCodename: "primary-model", errorDetail: "rate limited" }]);
    expect(fallbackNoticeCalls[0]?.successModel.llm_codename).toBe("fallback-model");
    expect(context.streamingContext.suppressUserErrors).toBe(false);
    expect(context.streamingContext.forceModelFallback).toBe(false);
  });

  it("deletes the timed-out primary's partial message when a fallback succeeds", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);

    const deletedWebhookMessageIds: string[] = [];
    (context as unknown as { responseTarget?: unknown }).responseTarget = {
      webhook: {
        deleteMessage: async (messageId: string) => {
          deletedWebhookMessageIds.push(messageId);
        },
      },
    };

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
    // Primary times out after flushing one partial webhook message; the fallback completes with its
    // own message. Only the fallback's message should remain in the channel (and the sink).
    queuedResults.push(
      {
        status: "timeout",
        streamResults: [
          { status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider streamToDiscord call timed out.") },
        ],
        personaResponses: [],
      },
      fallbackSuccess,
    );
    queuedDeliveries.push(
      [{ messageId: "partial_1", channelId: "channel_1", isWebhook: true }],
      [{ messageId: "fallback_1", channelId: "channel_1", isWebhook: true }],
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(fallbackSuccess);
    expect(finalizedResults).toEqual([fallbackSuccess]);
    expect(deletedWebhookMessageIds).toEqual(["partial_1"]);
    expect(context.streamingContext.deliveredMessageRefs?.map((ref) => ref.messageId)).toEqual(["fallback_1"]);
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
