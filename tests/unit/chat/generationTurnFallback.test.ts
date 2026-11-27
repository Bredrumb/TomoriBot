import * as retention from "@/utils/db/repositories/ApiKeyRetentionRepository";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { customEndpointSchema, personaSpriteSchema } from "@/types/db/schema";
import { GenerateVoiceMessageTool } from "@/tools/functionCalls/generateVoiceMessageTool";
import { ConditioningInteractionTool } from "@/tools/functionCalls/conditioningInteractionTool";
import { buildPersonaSpriteContextItem } from "@/utils/text/context/personaSprites";
import { clearPersonaSpriteCache, setPersonaSpriteCache } from "@/utils/cache/personaSpriteCacheStore";
import type { ToolParameterSchema } from "@/types/tool/interfaces";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import type { Client, Message } from "discord.js";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag } from "@/types/misc/context";
import type { ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { FallbackNoticeAttempt } from "@/utils/discord/fallbackModelNotice";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import type { ToolLoopParams } from "@/utils/chat/toolLoop";
import type { TextQuotaTriggerState } from "@/utils/chat/textQuotaState";
// Capture real modules before mock.module runs because Bun mocks are process-global and partial factories break
// linking in transitive imports or later test files.
import * as realRepositories from "@/utils/db/repositories";
import * as speechRepository from "@/utils/db/repositories/SpeechRepository";
import * as realChannelLlmCache from "@/utils/cache/channelLlmCache";
import * as realAdmissionGuards from "@/utils/chat/admissionGuards";
import * as realNovelaiSubscriptionCache from "@/utils/cache/novelaiSubscriptionCache";
import * as realOpenrouterCapabilityCache from "@/utils/cache/openrouterCapabilityCache";
import * as realToolLoop from "@/utils/chat/toolLoop";
import * as realFallbackModelNotice from "@/utils/discord/fallbackModelNotice";
import * as realStreamOrchestrator from "@/utils/discord/streamOrchestrator";
import * as realPersonalProviderRuntime from "@/utils/provider/personalProviderRuntime";
import * as realProviderFactory from "@/utils/provider/providerFactory";
import * as realCrypto from "@/utils/security/crypto";
import * as realKeyRotation from "@/utils/security/keyRotation";
import * as realToolRegistry from "@/tools/toolRegistry";
import { ManageTaskTool } from "@/tools/functionCalls/manageTaskTool";
import { createScopedModuleMocker, overrideMembers, stubLogMembers } from "../../helpers/mockSurface";
import { VERBATIM_TOOL_CALLING_NUDGE } from "@/utils/tools/verbatimToolCalling";
import { computeSafeInputBudget } from "@/utils/text/contextTruncator";
import { sumTurnUsage } from "@/utils/text/tokenEstimate";
import { STREAM_INTERRUPTED_CODE } from "@/utils/provider/providerErrorClassification";

const queuedResults: GenerationTurnResult[] = [];
// Parallel to queuedResults: delivered-message refs each attempt pushes into the sink before returning.
const queuedDeliveries: Array<Array<{ messageId: string; channelId: string; webhookId: string | null }> | undefined> =
  [];
const toolLoopCalls: Array<{
  model: string;
  outputPrefill: string | undefined;
  suppressUserErrors: boolean | undefined;
  retryStreamInterruption: boolean | undefined;
  contextItems: ToolLoopParams["context"]["contextItems"];
  numCtx: number | null | undefined;
  apiKey: string;
  credentialSource: ChatTurnContext["textCredentialSource"];
}> = [];
const rotationKeyQueue: realKeyRotation.SelectedKeyResult[] = [];
const subscriptionLimits = new Map<string, number>();
const subscriptionReads: string[] = [];
const providerConfigCalls: Array<{ model: string; apiKey: string }> = [];
const fallbackNoticeCalls: Array<{
  failures: FallbackNoticeAttempt[];
  successModel: LlmRow;
  offerPersonalFallbackOptOut: boolean | undefined;
}> = [];
const personalSavedConfigLoads: Array<{ userId: number; provider: string }> = [];
const serverSavedConfigLoads: Array<{ serverId: number; provider: string }> = [];
let personalKeyAvailable = true;
const textQuotaAdmissions: Array<{
  triggerKey: string;
  isPersonaJob: boolean;
  userDiscId: string;
  notifyUser: boolean | undefined;
}> = [];
let textQuotaAdmissionResult: { allowed: boolean; state: TextQuotaTriggerState | null } = {
  allowed: true,
  state: null,
};
let textQuotaAdmissionFailure: Error | null = null;
const cooldownAdmissions: Array<{ serverDiscId: string; cooldownUserDiscId: string; notifyUser: boolean | undefined }> =
  [];
let cooldownAdmissionResult = true;
const timeoutNotices: Array<{ providerName: string; sawStreamProgress: boolean }> = [];
const testStopRequests = new Map<string, { type: "stop" | "follow_up"; stopContext?: TestStopContext }>();
let personalOverlayState: TomoriState | null = null;
let rotationEnabled = false;
const rotationSelections: string[] = [];
const rotationChecks: string[] = [];
let fetchStub: ReturnType<typeof stubGlobalFetch>;

type TestStopContext = {
  originalStopMessage: Message;
  client: Client;
};

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/repositories/ApiKeyRetentionRepository": retention,
  "@/utils/cache/channelLlmCache": realChannelLlmCache,
  "@/utils/chat/admissionGuards": realAdmissionGuards,
  "@/utils/cache/novelaiSubscriptionCache": realNovelaiSubscriptionCache,
  "@/utils/cache/openrouterCapabilityCache": realOpenrouterCapabilityCache,
  "@/utils/db/repositories": realRepositories,
  "@/utils/discord/fallbackModelNotice": realFallbackModelNotice,
  "@/utils/discord/streamOrchestrator": realStreamOrchestrator,
  "@/utils/provider/personalProviderRuntime": realPersonalProviderRuntime,
  "@/utils/provider/providerFactory": realProviderFactory,
  "@/utils/security/crypto": realCrypto,
  "@/utils/security/keyRotation": realKeyRotation,
  "@/utils/chat/toolLoop": realToolLoop,
  "@/tools/toolRegistry": realToolRegistry,
});

scopedMock.module("@/utils/db/repositories/ApiKeyRetentionRepository", () => ({
  ...retention,
  loadCredentialActivityReferences: async () => [],
}));

stubLogMembers({
  error: () => undefined,
  info: () => undefined,
  section: () => undefined,
  success: () => undefined,
  warn: () => undefined,
});

scopedMock.module("@/utils/cache/channelLlmCache", () => ({
  ...realChannelLlmCache,
  getCachedChannelLlm: async () => null,
}));

scopedMock.module("@/utils/cache/novelaiSubscriptionCache", () => ({
  ...realNovelaiSubscriptionCache,
  getCachedNovelAISubscription: (apiKey: string) => {
    subscriptionReads.push(apiKey);
    return { tier: subscriptionLimits.get(apiKey) === 4096 ? 1 : 3, active: true };
  },
  refreshNovelAISubscription: async () => undefined,
}));

scopedMock.module("@/utils/cache/openrouterCapabilityCache", () => ({
  ...realOpenrouterCapabilityCache,
  getOpenRouterCapabilities: () => undefined,
  getOpenRouterCapabilityCacheSize: () => 0,
  getOpenRouterPricing: () => undefined,
  getOpenRouterSupportedParameters: () => undefined,
  getOpenRouterTokenizer: () => undefined,
  getOpenRouterTokenLimits: () => undefined,
  getOrFetchOpenRouterCapabilities: async () => undefined,
  initializeOpenRouterCapabilityCache: async () => undefined,
  isOpenRouterCapabilityCacheReady: () => false,
}));

scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  // Use overrideMembers because repository exports are class instances whose prototype methods spread drops.
  llmProviderRepo: overrideMembers(realRepositories.llmProviderRepo, {
    // A stored key for every provider, so a cross-provider fallback arm can be constructed here
    // instead of failing on `applySavedProviderConfig`'s missing-credentials throw.
    loadSavedProviderConfig: async (serverId: number, provider: string) => {
      serverSavedConfigLoads.push({ serverId, provider });
      return { api_key: Buffer.from("encrypted-key"), key_version: 1 };
    },
    loadUserSavedProviderConfig: async (userId: number, provider: string) => {
      personalSavedConfigLoads.push({ userId, provider });
      return personalKeyAvailable ? { api_key: Buffer.from("encrypted-key"), key_version: 1 } : null;
    },
  }),
  configRepository: overrideMembers(realRepositories.configRepository, {
    updateNsfwConfig: async () => true,
  }),
  personaRepository: overrideMembers(realRepositories.personaRepository, {
    loadAllForServer: async () => [],
  }),
  userRepository: overrideMembers(realRepositories.userRepository, {
    loadOrCreateUser: async () => null,
    updateLastSeen: async () => undefined,
  }),
  serverRepository: overrideMembers(realRepositories.serverRepository, {
    loadServerState: async () => null,
  }),
}));

scopedMock.module("@/utils/discord/fallbackModelNotice", () => ({
  ...realFallbackModelNotice,
  sendFallbackModelUsageNotice: async (args: {
    failures: FallbackNoticeAttempt[];
    successModel: LlmRow;
    offerPersonalFallbackOptOut?: boolean;
  }) => {
    fallbackNoticeCalls.push({
      failures: args.failures,
      successModel: args.successModel,
      offerPersonalFallbackOptOut: args.offerPersonalFallbackOptOut,
    });
  },
}));

scopedMock.module("@/utils/chat/admissionGuards", () => ({
  ...realAdmissionGuards,
  checkTextQuotaForAdmission: async (params: {
    triggerKey: string;
    isPersonaJob: boolean;
    userDiscId: string;
    shouldApplyTextQuota: boolean;
    notifyUser?: boolean;
  }) => {
    textQuotaAdmissions.push({
      triggerKey: params.triggerKey,
      isPersonaJob: params.isPersonaJob,
      userDiscId: params.userDiscId,
      notifyUser: params.notifyUser,
    });
    if (textQuotaAdmissionFailure) throw textQuotaAdmissionFailure;
    return textQuotaAdmissionResult;
  },
  enforceServerTriggerCooldownForAdmission: async (params: {
    serverDiscId: string;
    cooldownUserDiscId: string;
    notifyUser?: boolean;
  }) => {
    cooldownAdmissions.push({
      serverDiscId: params.serverDiscId,
      cooldownUserDiscId: params.cooldownUserDiscId,
      notifyUser: params.notifyUser,
    });
    return cooldownAdmissionResult;
  },
}));

scopedMock.module("@/utils/discord/streamOrchestrator", () => ({
  ...realStreamOrchestrator,
  StreamOrchestrator: overrideMembers(realStreamOrchestrator.StreamOrchestrator, {
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
  }),
}));

scopedMock.module("@/utils/provider/personalProviderRuntime", () => ({
  ...realPersonalProviderRuntime,
  applyPersonalProviderSelectionsToTomoriState: async (tomoriState: TomoriState) => ({
    tomoriState: personalOverlayState ?? tomoriState,
    activeConfigs: {},
  }),
}));

scopedMock.module("@/utils/provider/providerFactory", () => ({
  ...realProviderFactory,
  getProviderForTomori: async () => fakeProvider,
  ProviderFactory: overrideMembers(realProviderFactory.ProviderFactory, {
    getProviderByName: async () => fakeProvider,
  }),
}));

scopedMock.module("@/utils/security/crypto", () => ({
  ...realCrypto,
  decryptApiKey: async (key: Buffer) => (key.toString() === "personal-encrypted-key" ? "personal-key" : "server-key"),
  encryptApiKey: async () => ({ encrypted: Buffer.from(""), version: 1 }),
  storeOptApiKey: async () => true,
  getOptApiKey: async () => null,
  deleteOptApiKey: async () => true,
  hasOptApiKey: async () => false,
}));

scopedMock.module("@/utils/security/keyRotation", () => ({
  ...realKeyRotation,
  MAX_KEY_ATTEMPTS: 3,
  hasAvailableRotationKey: async (state: TomoriState, excluded: number[] = []) => {
    rotationChecks.push(state.llm.llm_codename);
    return rotationKeyQueue.length > 0 || (rotationEnabled && !excluded.includes(42));
  },
  recordKeyError: async () => undefined,
  recordKeySuccess: async () => undefined,
  selectApiKey: async (state: TomoriState, excluded: number[] = []) => {
    rotationSelections.push(state.llm.llm_codename);
    if (rotationKeyQueue.length > 0) return rotationKeyQueue.shift() ?? null;
    if (!rotationEnabled) return null;
    const rotationKeyId = excluded.includes(41) ? 42 : 41;
    return { apiKey: `server-pool-${rotationKeyId}`, rotationKeyId, isMainKey: false };
  },
}));

scopedMock.module("@/utils/chat/toolLoop", () => ({
  ...realToolLoop,
  providerIsApiFamily: (providerName: string, apiFamily: string) => {
    const families: Record<string, string> = {
      google: "google-genai",
      novelai: "novelai",
      openrouter: "openrouter",
    };
    return families[providerName.toLowerCase()] === apiFamily;
  },
  runToolLoop: runToolLoopMock,
  sendStreamTimeoutNotice: async (params: { providerName: string; sawStreamProgress: boolean }) => {
    timeoutNotices.push({ providerName: params.providerName, sawStreamProgress: params.sawStreamProgress });
  },
}));

scopedMock.module("@/tools/toolRegistry", () => ({
  ...realToolRegistry,
  getAvailableToolsWithMCP: async () => ({
    builtInTools: [new GenerateVoiceMessageTool(), new ConditioningInteractionTool(), new ManageTaskTool()],
    mcpFunctionNames: [],
    totalCount: 3,
  }),
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
    // Mirrors the real tool loop's per-attempt bookkeeping: a notice an earlier attempt held back
    // describes that attempt, not this one.
    params.context.streamingContext.deferredTimeoutNotice = undefined;
    toolLoopCalls.push({
      model: params.tomoriState.llm.llm_codename,
      outputPrefill: params.context.streamingContext.outputPrefill,
      suppressUserErrors: params.context.streamingContext.suppressUserErrors,
      retryStreamInterruption: params.context.streamingContext.retryStreamInterruption,
      contextItems: params.context.contextItems,
      numCtx: params.tomoriState.config.custom_num_ctx,
      apiKey: params.providerConfig.apiKey,
      credentialSource: params.context.textCredentialSource,
    });
    const deliveries = queuedDeliveries.shift();
    if (deliveries) {
      if (!params.context.streamingContext.deliveredMessageRefs) {
        params.context.streamingContext.deliveredMessageRefs = [];
      }
      params.context.streamingContext.deliveredMessageRefs.push(...deliveries);
    }
    const next = queuedResults.shift();
    if ((next?.streamResults[0]?.data as { deliveryStatus?: string } | undefined)?.deliveryStatus === "unconfirmed") {
      params.context.streamingContext.deliveryState ??= { unconfirmed: false };
      params.context.streamingContext.deliveryState.unconfirmed = true;
    }
    if (!next) {
      throw new Error("No queued generation result for test");
    }
    if (next.status === "timeout") {
      // Mirrors the real tool loop: an SDK-call timeout sends its notice inline when the user can
      // see errors, and otherwise leaves it for the caller that knows whether a fallback answered.
      const notice = { providerName: params.tomoriState.llm.llm_provider, sawStreamProgress: true };
      if (params.context.streamingContext.suppressUserErrors) {
        params.context.streamingContext.deferredTimeoutNotice = notice;
      } else {
        timeoutNotices.push(notice);
      }
    }
    return next;
  }

  return runToolLoopContractShim(params);
}

async function runToolLoopContractShim(params: ToolLoopParams): Promise<GenerationTurnResult> {
  // Read the bounds off the link-time capture of the real module: this shim stands in for
  // runToolLoop, so literals here would let it drift from the loop it models.
  const maxIterations = realToolLoop.MAX_FUNCTION_CALL_ITERATIONS;
  const maxConsecutiveToolErrors = realToolLoop.MAX_CONSECUTIVE_TOOL_ERRORS;
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
  createConfig: async (tomoriState: TomoriState, apiKey: string): Promise<ProviderConfig> => {
    providerConfigCalls.push({ model: tomoriState.llm.llm_codename, apiKey });
    return {
      apiKey,
      model: tomoriState.llm.llm_codename,
      temperature: tomoriState.config.llm_temperature ?? 0.7,
      ...(tomoriState.llm.has_tools && { tools: [{ name: "update_short_term_memory" }] }),
    };
  },
  getInfo: () => ({ name: "google" }),
};

function makeLlm(id: number, codename: string, provider = "google"): LlmRow {
  return {
    llm_id: id,
    llm_codename: codename,
    llm_provider: provider,
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
      user_byok_mode: false,
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
            textQuotaSource: "user",
          },
          cooldownUserDiscId: "user_1",
        },
        channelId: "channel_1",
        lockedAt: Date.now(),
        queueDepth: 0,
        skipLock: false,
      },
      userRow: { user_id: 4, user_disc_id: "user_1", personal_server_fallback_enabled: true },
    },
    userDiscId: "user_1",
  } as unknown as ChatTurnContext;
}

function makePersonalContext(serverPrimary: LlmRow, serverFallback: LlmRow, personalPrimary: LlmRow): ChatTurnContext {
  const context = makeContext(serverPrimary, serverFallback);
  context.textCredentialSource = "personal";
  context.streamingContext.textCredentialSource = "personal";
  context.personalRoutingUserId = 4;
  context.personalTextProvider = "openrouter";
  personalOverlayState = {
    ...context.currentPersona,
    llm: personalPrimary,
    fallback_chain: undefined,
    fallback_llms: undefined,
    config: { ...context.currentPersona.config, api_key: Buffer.from("personal-encrypted-key") },
  } as TomoriState;
  return context;
}

function personalRouteFailure(): GenerationTurnResult {
  return {
    status: "error",
    streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
    personaResponses: [],
  };
}

function partialFailure(status: "error" | "timeout", text: string): GenerationTurnResult {
  return {
    status,
    streamResults: [
      {
        status,
        data:
          status === "timeout"
            ? new Error("SDK_CALL_TIMEOUT: provider streamToDiscord call timed out.")
            : { type: "rate_limit", code: "429", message: "rate limited" },
        accumulatedText: text,
      },
    ],
    personaResponses: [{ personaName: "Tomori", text, personaId: 10, personaLineageId: 100 }],
  };
}

function interruptedStream(text: string): GenerationTurnResult {
  return {
    status: "error",
    streamResults: [
      {
        status: "error",
        data: {
          type: "provider_overloaded",
          code: STREAM_INTERRUPTED_CODE,
          message: "Stream interrupted: Incomplete JSON segment at the end",
          retryable: true,
        },
        accumulatedText: text,
      },
    ],
    personaResponses: [{ personaName: "Tomori", text, personaId: 10, personaLineageId: 100 }],
  };
}

function successfulReply(text = "ok"): GenerationTurnResult {
  return {
    status: "completed",
    streamResults: [{ status: "completed", accumulatedText: text }],
    personaResponses: [{ personaName: "Tomori", text, personaId: 10, personaLineageId: 100 }],
  };
}

function collectingSink(): ChatResponseSink & { emittedErrors: unknown[]; finalizedResults: GenerationTurnResult[] } {
  const emittedErrors: unknown[] = [];
  const finalizedResults: GenerationTurnResult[] = [];
  return {
    emittedErrors,
    finalizedResults,
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
}

async function runWithFixedRandom(leadFraction: number, run: () => Promise<void>): Promise<void> {
  const originalRandom = Math.random;
  Math.random = () => leadFraction;
  try {
    await run();
  } finally {
    Math.random = originalRandom;
  }
}

describe("runGenerationTurn fallback behavior", () => {
  afterEach(() => fetchStub.mockRestore());

  it("keeps personal success and failure outside an enabled server rotation pool", async () => {
    for (const outcome of [successfulReply(), personalRouteFailure()]) {
      rotationEnabled = true;
      const context = makePersonalContext(
        makeLlm(1, "server-primary"),
        makeLlm(2, "server-fallback"),
        makeLlm(3, "personal-primary"),
      );
      context.turn.userRow.personal_server_fallback_enabled = false;
      queuedResults.push(outcome);
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      expect((await runGenerationTurn(context, collectingSink())).status).toBe(outcome.status);
    }
    expect(toolLoopCalls.map((call) => call.apiKey)).toEqual(["personal-key", "personal-key"]);
    expect(rotationSelections).toHaveLength(0);
    expect(rotationChecks).toHaveLength(0);
  });

  it("admits server fallback separately and rotates only its attempts", async () => {
    rotationEnabled = true;
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), personalRouteFailure(), successfulReply());
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map(({ apiKey, credentialSource }) => ({ apiKey, credentialSource }))).toEqual([
      { apiKey: "personal-key", credentialSource: "personal" },
      { apiKey: "server-pool-41", credentialSource: "server" },
      { apiKey: "server-pool-42", credentialSource: "server" },
    ]);
    expect(rotationSelections).not.toContain("personal-primary");
    expect(rotationChecks).not.toContain("personal-primary");
    expect(textQuotaAdmissions).toHaveLength(1);
    expect(cooldownAdmissions).toHaveLength(1);
  });

  beforeEach(async () => {
    rotationKeyQueue.length = 0;
    subscriptionLimits.clear();
    subscriptionReads.length = 0;
    fetchStub = stubGlobalFetch(() => Response.json({ data: [] }));
    queuedResults.length = 0;
    queuedDeliveries.length = 0;
    toolLoopCalls.length = 0;
    providerConfigCalls.length = 0;
    fallbackNoticeCalls.length = 0;
    personalSavedConfigLoads.length = 0;
    serverSavedConfigLoads.length = 0;
    personalKeyAvailable = true;
    textQuotaAdmissions.length = 0;
    textQuotaAdmissionResult = {
      allowed: true,
      state: {
        serverId: 1,
        userDiscId: "user_1",
        consumed: false,
        reservation: null,
        reservationReleased: false,
        createdAt: Date.now(),
      },
    };
    textQuotaAdmissionFailure = null;
    cooldownAdmissions.length = 0;
    cooldownAdmissionResult = true;
    timeoutNotices.length = 0;
    personalOverlayState = null;
    rotationEnabled = false;
    rotationSelections.length = 0;
    rotationChecks.length = 0;

    const { StreamOrchestrator } = await import("@/utils/discord/streamOrchestrator");
    StreamOrchestrator.clearStopRequest("channel_1");
    StreamOrchestrator.getAndClearStopContext("channel_1");
  });

  it.each([
    [4096, 8192],
    [8192, 4096],
  ])("passes original NovelAI history and one prefill to each rotated credential (%i to %i)", async (firstLimit, nextLimit) => {
    const model = { ...makeLlm(1, "kayra-v1"), llm_provider: "novelai" };
    const context = makeContext(model, makeLlm(2, "unused"));
    context.tomoriState.fallback_chain = [];
    context.assistantPrefill = { text: "continue this fragment", source: "manual" };
    context.contextItems = Array.from({ length: 6 }, (_, pair) => [
      {
        role: "user" as const,
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        messageId: `user-${pair}`,
        parts: [{ type: "text" as const, text: `Mirri: ${"x".repeat(1500)}` }],
      },
      {
        role: "model" as const,
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        messageId: `model-${pair}`,
        parts: [{ type: "text" as const, text: `Tomori: ${"y".repeat(1500)}` }],
      },
    ]).flat();
    const originalItems = [...context.contextItems];
    const activity = {
      references: [],
      requestKeyDigest: Bun.CryptoHasher.hash("sha256", "next-key", "hex"),
    };
    rotationKeyQueue.push(
      { apiKey: "first-key", rotationKeyId: 11, isMainKey: false },
      {
        apiKey: "next-key",
        rotationKeyId: 12,
        isMainKey: false,
        usageContext: { storedCredentialActivity: activity },
      },
    );
    subscriptionLimits.set("first-key", firstLimit);
    subscriptionLimits.set("next-key", nextLimit);
    queuedResults.push(personalRouteFailure(), successfulReply());
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, collectingSink());
    expect(toolLoopCalls.map((call) => call.apiKey)).toEqual(["first-key", "next-key"]);
    expect(result.answeringAttempt).toMatchObject({
      providerConfig: { apiKey: "next-key", model: "kayra-v1" },
      activity,
      credentialSource: "server",
    });
    expect(subscriptionReads).toEqual([]);
    for (const call of toolLoopCalls) expect(call.contextItems.filter((item) => item.messageId)).toEqual(originalItems);
    for (const call of toolLoopCalls) {
      expect(call.outputPrefill).toBe("Tomori: continue this fragment");
      expect(
        call.contextItems.filter((item) =>
          item.parts.some((part) => part.type === "text" && part.text.includes("continue this fragment")),
        ),
      ).toHaveLength(1);
      expect(call.contextItems.at(-1)?.role).toBe("model");
    }
  });

  it("budgets personal and DM NovelAI turns with the selected personal credential", async () => {
    const nai = { ...makeLlm(3, "kayra-v1"), llm_provider: "novelai" };
    for (const isDMChannel of [false, true]) {
      const context = makePersonalContext(makeLlm(1, "server"), makeLlm(2, "fallback"), nai);
      context.personalTextProvider = "novelai";
      context.isDMChannel = isDMChannel;
      subscriptionLimits.set("personal-key", 4096);
      queuedResults.push(successfulReply());
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, collectingSink());
      expect(toolLoopCalls.at(-1)?.apiKey).toBe("personal-key");
      expect(subscriptionReads).toEqual([]);
    }
    expect(subscriptionReads).not.toContain("server-key");
  });

  it("selects native context for NovelAI primary, personal, and fallback attempts while preserving preset context for other providers", async () => {
    const nai = { ...makeLlm(3, "kayra-v1"), llm_provider: "novelai" };
    const ordinary = makeLlm(1, "ordinary-model");
    const contexts = [
      makeContext(nai, ordinary),
      makeContext(ordinary, nai),
      makePersonalContext(ordinary, ordinary, nai),
    ];
    const presetItem = {
      role: "user" as const,
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
      parts: [{ type: "text" as const, text: "preset-marker" }],
    };
    const nativeItem = {
      role: "user" as const,
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
      messageId: "trigger",
      completionText: "Mirri: native-marker",
      parts: [{ type: "text" as const, text: "Mirri: native-marker" }],
    };
    for (const [index, context] of contexts.entries()) {
      const firstCall = toolLoopCalls.length;
      context.contextItems = [presetItem];
      context.nativeContextItems = [nativeItem];
      if (index === 2) context.personalTextProvider = "novelai";
      queuedResults.push(personalRouteFailure(), successfulReply());
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, collectingSink());
      for (const call of toolLoopCalls.slice(firstCall)) {
        expect(call.contextItems).toContainEqual(call.model === "kayra-v1" ? nativeItem : presetItem);
        expect(call.contextItems).not.toContainEqual(call.model === "kayra-v1" ? presetItem : nativeItem);
      }
    }
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
        streamResults: [
          {
            status: "error",
            data: { type: "rate_limit", code: "429", message: "rate limited for key sk-live-CANARY0001 <@&42>" },
          },
        ],
        personaResponses: [],
      },
      fallbackSuccess,
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(fallbackSuccess);
    expect(toolLoopCalls.map(({ model, suppressUserErrors }) => ({ model, suppressUserErrors }))).toEqual([
      { model: "primary-model", suppressUserErrors: true },
      { model: "fallback-model", suppressUserErrors: false },
    ]);
    expect(emittedErrors).toHaveLength(0);
    expect(finalizedResults).toEqual([fallbackSuccess]);
    expect(fallbackNoticeCalls).toHaveLength(1);
    expect(fallbackNoticeCalls[0]?.failures).toEqual([
      { modelCodename: "primary-model", errorDetail: "rate_limit (429)" },
    ]);
    expect(fallbackNoticeCalls[0]?.successModel.llm_codename).toBe("fallback-model");
    expect(context.streamingContext.suppressUserErrors).toBe(false);
    expect(context.streamingContext.forceModelFallback).toBe(false);
  });

  it("retries an interrupted stream once on the same key, continuing the posted text", async () => {
    const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "unused"));
    context.tomoriState.fallback_chain = [];
    queuedResults.push(interruptedStream("First half."), successfulReply("second half."));

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, collectingSink());

    expect(result.status).toBe("completed");
    expect(result.personaResponses[0]?.text).toBe("First half.\nsecond half.");
    expect(toolLoopCalls.map(({ apiKey, retryStreamInterruption }) => ({ apiKey, retryStreamInterruption }))).toEqual([
      { apiKey: "server-key", retryStreamInterruption: true },
      { apiKey: "server-key", retryStreamInterruption: false },
    ]);
    const continuationText = (call: (typeof toolLoopCalls)[number] | undefined) =>
      call?.contextItems
        .at(-1)
        ?.parts.map((part) => (part.type === "text" ? part.text : ""))
        .join("") ?? "";
    expect(continuationText(toolLoopCalls[0])).not.toContain("First half.");
    expect(continuationText(toolLoopCalls[1])).toContain("First half.");
    expect(context.streamingContext.retryStreamInterruption).toBe(false);
  });

  it("surfaces a second interruption instead of retrying it again", async () => {
    const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "unused"));
    context.tomoriState.fallback_chain = [];
    const second = interruptedStream("");
    queuedResults.push(interruptedStream(""), second);

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, collectingSink());

    expect(result.status).toBe("error");
    expect(result.streamResults.at(-1)).toBe(second.streamResults[0]);
    expect(toolLoopCalls).toHaveLength(2);
    expect(toolLoopCalls[1]?.retryStreamInterruption).toBe(false);
  });

  it("does not rotate keys, try another model, or emit a notice after uncertain delivery", async () => {
    const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "fallback-model"));
    rotationEnabled = true;
    const uncertain: GenerationTurnResult = {
      status: "error",
      streamResults: [{ status: "error", data: { deliveryStatus: "unconfirmed" } }],
      personaResponses: [],
    };
    queuedResults.push(uncertain, { status: "completed", streamResults: [], personaResponses: [] });
    const sink: ChatResponseSink = {
      emitStreamResult: mock(async () => undefined),
      emitError: mock(async () => undefined),
      finalize: mock(async () => undefined),
    };
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect(await runGenerationTurn(context, sink)).toBe(uncertain);
    expect(toolLoopCalls).toHaveLength(1);
    expect(queuedResults).toHaveLength(1);
    expect(fallbackNoticeCalls).toEqual([]);
    expect(timeoutNotices).toEqual([]);
    expect(sink.emitStreamResult).not.toHaveBeenCalled();
    expect(sink.finalize).toHaveBeenCalledWith(uncertain);
  });

  it("re-resolves the prefill per attempt so a fallback that rejects it gets no trailing assistant turn", async () => {
    const primaryModel = {
      ...makeLlm(1, "claude-haiku-4-5"),
      llm_provider: "anthropic",
      supports_assistant_prefill: true,
    } as LlmRow;
    const fallbackModel = { ...makeLlm(2, "claude-sonnet-4-6"), llm_provider: "anthropic" } as LlmRow;
    const context = makeContext(primaryModel, fallbackModel);
    context.assistantPrefill = { text: "Sure, here", source: "manual" };
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      { status: "completed", streamResults: [{ status: "completed", accumulatedText: "ok" }], personaResponses: [] },
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    const [primaryCall, fallbackCall] = toolLoopCalls;
    expect(primaryCall?.contextItems.at(-1)?.role).toBe("model");
    expect(fallbackCall?.contextItems.some((item) => item.role === "model")).toBe(false);
    expect(context.streamingContext.outputPrefill).toBe("Tomori: Sure, here");
  });

  it("runs a user-scoped custom endpoint fallback on its own saved credentials and num_ctx", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const context = makeContext(primaryModel, makeLlm(2, "unused-fallback"));
    context.currentPersona.config.custom_num_ctx = 32_768;
    const endpoint = customEndpointSchema.parse({
      extra_config: {},
      custom_endpoint_id: 5,
      connection_id: 42,
      server_id: null,
      user_id: 4,
      label: "local",
      capability: "text",
      api_style: "openai-compatible",
      endpoint_url: "https://example.invalid/v1",
      model_name: "personal-fallback",
      model_ref_id: 9,
      num_ctx: 4_096,
      has_tools: false,
      sees_images: false,
      sees_videos: false,
      supports_structoutput: false,
      strict_role_alternation: false,
      supports_prefix_completion: false,
      supports_assistant_prefill: false,
    });
    context.currentPersona.fallback_chain = [{ kind: "custom_endpoint", endpoint }];
    context.textCredentialSource = "personal";
    context.personalRoutingUserId = 4;
    personalOverlayState = context.currentPersona;
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      {
        status: "completed",
        streamResults: [{ status: "completed", accumulatedText: "ok" }],
        personaResponses: [{ personaName: "Tomori", text: "ok", personaId: 10, personaLineageId: 100 }],
      },
    );
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map(({ model, numCtx }) => ({ model, numCtx }))).toEqual([
      { model: "primary-model", numCtx: 32_768 },
      { model: "personal-fallback", numCtx: 4_096 },
    ]);
    expect(personalSavedConfigLoads).toEqual([{ userId: 4, provider: "custom:42" }]);
  });

  for (const deferred of [false, true]) {
    it.each([
      { scope: "the owning server", serverId: 1, userId: null, allowed: true },
      { scope: "a personal account", serverId: null, userId: 4, allowed: false },
      { scope: "another server", serverId: 2, userId: null, allowed: false },
    ])(`${deferred ? "deferred" : "initial"} server fallback checks an endpoint owned by $scope before loading credentials`, async ({
      serverId,
      userId,
      allowed,
    }) => {
      const primary = makeLlm(1, "server-primary");
      const fallback = makeLlm(2, "unused-fallback");
      const context = deferred
        ? makePersonalContext(primary, fallback, makeLlm(3, "personal-primary"))
        : makeContext(primary, fallback);
      const endpoint = customEndpointSchema.parse({
        extra_config: {},
        custom_endpoint_id: 5,
        connection_id: 42,
        server_id: serverId,
        user_id: userId,
        label: "local",
        capability: "text",
        api_style: "openai-compatible",
        endpoint_url: "https://example.invalid/v1",
        model_name: "custom-fallback",
        model_ref_id: 9,
      });
      context.currentPersona.fallback_chain = [{ kind: "custom_endpoint", endpoint }];
      if (deferred) queuedResults.push(personalRouteFailure());
      queuedResults.push(personalRouteFailure(), successfulReply());

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, collectingSink());

      const expectedModels = deferred ? ["personal-primary", "server-primary"] : ["server-primary"];
      if (allowed) expectedModels.push("custom-fallback");
      expect(toolLoopCalls.map((call) => call.model)).toEqual(expectedModels);
      expect(personalSavedConfigLoads).toEqual([]);
      expect(serverSavedConfigLoads).toEqual(allowed ? [{ serverId: 1, provider: "custom:42" }] : []);
      expect(toolLoopCalls.filter((call) => call.model === "custom-fallback")).toEqual(
        allowed ? [expect.objectContaining({ credentialSource: "server", apiKey: "server-key" })] : [],
      );
    });
  }

  it("keeps an explicit scene model on its selected route when the personal default fails", async () => {
    const chosen = makeLlm(4, "chosen-scene-model");
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-default"),
    );
    context.currentPersona = {
      ...context.currentPersona,
      llm: chosen,
      config: {
        ...context.currentPersona.config,
        api_key: Buffer.from("personal-key"),
        model_randomizer_enabled: false,
        fallback_llm_ids: [],
      },
      fallback_chain: undefined,
      fallback_llms: undefined,
    };
    context.turn.lockedTurn.admission.incoming.sceneTurn = {
      commandId: "scene-command",
      sequence: [{ personaId: 1, personaName: "Mirri" }],
      totalTurns: 1,
      turnIndex: 0,
      modelSelection: { kind: "text", source: "personal", provider: chosen.llm_provider, modelId: 4 },
    };
    queuedResults.push(personalRouteFailure(), successfulReply());
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("error");
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["chosen-scene-model"]);
    expect(serverSavedConfigLoads).toEqual([]);
    expect(textQuotaAdmissions).toEqual([]);
  });

  it("falls back from a failed personal text model to the configured server model", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
    // The server route keeps the server's own credentials and the server's whole failover tail,
    // even though both routes name models from the same provider.
    expect(providerConfigCalls).toEqual([
      { model: "personal-primary", apiKey: "personal-key" },
      { model: "server-primary", apiKey: "server-key" },
      { model: "server-fallback", apiKey: "server-key" },
    ]);
    // The server's model spends the server's text quota, and only a later success may consume it.
    expect(textQuotaAdmissions).toEqual([
      { triggerKey: "trigger_1", isPersonaJob: false, userDiscId: "user_1", notifyUser: true },
    ]);
    expect(context.shouldApplyTextQuota).toBe(true);
    expect(context.textQuotaState?.consumed).toBe(false);
    expect(fallbackNoticeCalls).toHaveLength(1);
    expect(fallbackNoticeCalls[0]?.offerPersonalFallbackOptOut).toBe(true);
    expect(fallbackNoticeCalls[0]?.failures).toEqual([
      { modelCodename: "personal-primary", errorDetail: "rate_limit (429)" },
    ]);
  });

  it("keeps a successful personal text turn on its own route", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    // Building the server pool eagerly would resolve server provider config and take the server's
    // quota admission for a turn that never leaves the personal route.
    expect(providerConfigCalls).toEqual([{ model: "personal-primary", apiKey: "personal-key" }]);
    expect(textQuotaAdmissions).toHaveLength(0);
    expect(context.shouldApplyTextQuota).toBe(false);
    expect(context.textQuotaState).toBeNull();
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("resolves the server route from the persona's server model rather than the personal overlay", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.currentPersona.persona_llm = makeLlm(9, "persona-server-model");
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "persona-server-model"]);
  });

  it("withholds the server model fallback when the server requires personal providers", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.currentPersona.config.user_byok_mode = true;
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    expect(toolLoopCalls[0]?.suppressUserErrors).toBe(false);
    expect(textQuotaAdmissions).toHaveLength(0);
    expect(result.status).toBe("error");
    expect(sink.finalizedResults).toEqual([result]);
  });

  it("skips the server model fallback for an account that turned it off", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.turn.userRow.personal_server_fallback_enabled = false;
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    expect(providerConfigCalls).toEqual([{ model: "personal-primary", apiKey: "personal-key" }]);
    expect(textQuotaAdmissions).toHaveLength(0);
    expect(context.shouldApplyTextQuota).toBe(false);
    expect(result.status).toBe("error");
  });

  it("keeps the fallback for an account whose preference was never stored", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.turn.userRow.personal_server_fallback_enabled = undefined as unknown as boolean;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
  });

  it("reads the billed owner's opt-out, not the anchor author's, on a borrowed-trigger turn", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.personalRoutingUserId = 77;
    const policy = spyOn(speechRepository, "loadSpeechRoutingPolicy").mockResolvedValue({
      serverAllowed: true,
      fallbackEnabled: false,
    });
    queuedResults.push(personalRouteFailure());
    try {
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      const result = await runGenerationTurn(context, collectingSink());

      expect(policy.mock.calls[0]?.[1]).toBe(77);
      expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
      expect(result.status).toBe("error");
    } finally {
      policy.mockRestore();
    }
  });

  it("refuses the server model fallback when the server's text quota is exhausted", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    textQuotaAdmissionResult = { allowed: false, state: null };
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(textQuotaAdmissions).toHaveLength(1);
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    expect(context.shouldApplyTextQuota).toBe(false);
    expect(result.status).toBe("error");
  });

  it("leaves the personal failure as the outcome when the server route cannot be prepared", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    textQuotaAdmissionFailure = new Error("quota lookup unavailable");
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    expect(result.status).toBe("error");
    expect(sink.finalizedResults).toEqual([result]);
  });

  it("consumes no quota when the server model fails too", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), personalRouteFailure(), personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary", "server-fallback"]);
    expect(context.shouldApplyTextQuota).toBe(true);
    expect(context.textQuotaState?.consumed).toBe(false);
    expect(result.personaResponses).toHaveLength(0);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("refuses the server model fallback while the server's message cooldown is active", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    cooldownAdmissionResult = false;
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(cooldownAdmissions).toEqual([{ serverDiscId: "server_1", cooldownUserDiscId: "user_1", notifyUser: true }]);
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    // The refusal short-circuits the quota admission: nothing is answered, so nothing is charged.
    expect(textQuotaAdmissions).toHaveLength(0);
    expect(result.status).toBe("error");
  });

  it("admits the server route through the server's cooldown when it is clear", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(cooldownAdmissions).toHaveLength(1);
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
  });

  it("skips the server cooldown admission for a persona job that shares its group's", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.isPersonaJob = true;
    context.turn.lockedTurn.admission.incoming.isPersonaJob = true;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(cooldownAdmissions).toHaveLength(0);
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
  });

  it("hands the answering route to the rest of the turn once the server takes over", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    // The thought-log attribution and the error tips both read these: a server-paid reply must not
    // keep reporting the user's own provider as the payer.
    expect(context.textCredentialSource).toBe("server");
    expect(context.streamingContext.textCredentialSource).toBe("server");
  });

  it("leaves the credential source alone when the personal route answered", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(context.textCredentialSource).toBe("personal");
    expect(context.streamingContext.textCredentialSource).toBe("personal");
  });

  it("resends a suppressed timeout notice when the server route contributes nothing", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    textQuotaAdmissionResult = { allowed: false, state: null };
    queuedResults.push({
      status: "timeout",
      streamResults: [{ status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider call timed out.") }],
      personaResponses: [],
    });
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result.status).toBe("timeout");
    // Without this the turn ends in silence: no error result carries a timeout.
    expect(timeoutNotices).toEqual([{ providerName: "google", sawStreamProgress: true }]);
    expect(context.streamingContext.deferredTimeoutNotice).toBeUndefined();
  });

  it("keeps a timeout silent on a server turn that hides its errors", async () => {
    const context = makeContext(makeLlm(1, "server-primary"), makeLlm(2, "server-fallback"));
    context.shouldSurfaceUserErrors = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      queuedResults.push({
        status: "timeout",
        streamResults: [{ status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider call timed out.") }],
        personaResponses: [],
      });
    }

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, collectingSink());

    expect(result.status).toBe("timeout");
    expect(timeoutNotices).toHaveLength(0);
    expect(context.streamingContext.deferredTimeoutNotice).toBeUndefined();
  });

  it("keeps a timeout silent on a personal turn that hides its errors when the server route refuses", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.shouldSurfaceUserErrors = false;
    textQuotaAdmissionResult = { allowed: false, state: null };
    queuedResults.push({
      status: "timeout",
      streamResults: [{ status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider call timed out.") }],
      personaResponses: [],
    });

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, collectingSink());

    expect(result.status).toBe("timeout");
    expect(timeoutNotices).toHaveLength(0);
    expect(context.streamingContext.deferredTimeoutNotice).toBeUndefined();
  });

  it("keeps the deferred timeout notice for the attempt that the server route replaced", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(
      {
        status: "timeout",
        streamResults: [{ status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider call timed out.") }],
        personaResponses: [],
      },
      successfulReply(),
    );
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result.status).toBe("completed");
    expect(timeoutNotices).toHaveLength(0);
    expect(context.streamingContext.deferredTimeoutNotice).toBeUndefined();
  });

  it("reports one refused quota for a trigger that runs several persona turns", async () => {
    textQuotaAdmissionResult = { allowed: false, state: null };
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");

    const firstContext = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    firstContext.textQuotaTriggerKey = "trigger_dedupe";
    queuedResults.push(personalRouteFailure());
    await runGenerationTurn(firstContext, collectingSink());

    const secondContext = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    secondContext.textQuotaTriggerKey = "trigger_dedupe";
    queuedResults.push(personalRouteFailure());
    await runGenerationTurn(secondContext, collectingSink());

    expect(textQuotaAdmissions.map((admission) => admission.notifyUser)).toEqual([true, false]);
  });

  it("does not offer the personal fallback opt-out when a personal fallback answered", async () => {
    const primaryModel = makeLlm(1, "personal-primary");
    const fallbackModel = makeLlm(2, "personal-fallback");
    const context = makeContext(primaryModel, fallbackModel);
    context.textCredentialSource = "personal";
    context.personalRoutingUserId = 4;
    personalOverlayState = context.currentPersona;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "personal-fallback"]);
    expect(fallbackNoticeCalls).toHaveLength(1);
    expect(fallbackNoticeCalls[0]?.offerPersonalFallbackOptOut).toBe(false);
  });

  it("keeps the server route's model order when only the personal randomizer is on", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    personalOverlayState = {
      ...(personalOverlayState as TomoriState),
      config: { ...(personalOverlayState as TomoriState).config, model_randomizer_enabled: true },
    } as TomoriState;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    // The stub would send the server fallback first if the personal flag reached the server pool.
    await runWithFixedRandom(0.999, async () => {
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, sink);
    });

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
  });

  it("draws the server route's leading model from the server's randomizer setting", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.currentPersona.config.model_randomizer_enabled = true;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    await runWithFixedRandom(0.999, async () => {
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, sink);
    });

    // The draw lands on the last pool member, so only the server's own flag can reorder this pool.
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-fallback"]);
  });

  it("resolves a cross-provider fallback against the user's key on a personal-routed turn", async () => {
    const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "deepseek-fallback", "deepseek"));
    context.textCredentialSource = "personal";
    (context as unknown as { personalRoutingUserId: number }).personalRoutingUserId = 4;
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      {
        status: "completed",
        streamResults: [{ status: "completed", accumulatedText: "ok" }],
        personaResponses: [{ personaName: "Tomori", text: "ok", personaId: 10, personaLineageId: 100 }],
      },
    );
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["primary-model", "deepseek-fallback"]);
    // The server's saved DeepSeek config must never be consulted here, or the
    // user's chain would spend the server owner's key.
    expect(personalSavedConfigLoads).toEqual([{ userId: 4, provider: "deepseek" }]);
  });

  it("skips a cross-provider fallback the user has no personal key for", async () => {
    const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "deepseek-fallback", "deepseek"));
    context.textCredentialSource = "personal";
    (context as unknown as { personalRoutingUserId: number }).personalRoutingUserId = 4;
    personalKeyAvailable = false;
    const emittedErrors: unknown[] = [];
    queuedResults.push({
      status: "error",
      streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
      personaResponses: [],
    });
    const sink: ChatResponseSink = {
      emitStreamResult: async (result) => {
        emittedErrors.push(result);
      },
      emitError: async (error) => {
        emittedErrors.push(error);
      },
      finalize: async () => undefined,
    };

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["primary-model"]);
    expect(personalSavedConfigLoads).toEqual([{ userId: 4, provider: "deepseek" }]);
    expect(emittedErrors).toHaveLength(1);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("continues the timed-out primary's posted text on the fallback model instead of deleting it", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = {
      ...makeLlm(2, "claude-haiku-4-5", "anthropic"),
      supports_assistant_prefill: true,
    } as LlmRow;
    const context = makeContext(primaryModel, fallbackModel);
    const deleteMessage = mock(async () => undefined);
    (context as unknown as { responseTarget?: unknown }).responseTarget = {
      webhook: { id: "webhook_1", token: "synthetic_token", deleteMessage },
    };
    const sink = collectingSink();
    const primaryFailure = partialFailure("timeout", "First half.");
    primaryFailure.streamResults[0].usage = { inputTokens: 900, outputTokens: 30 };
    const fallbackReply = successfulReply("second half.");
    fallbackReply.streamResults[0].usage = { inputTokens: 950, outputTokens: 20 };
    queuedResults.push(primaryFailure, fallbackReply);
    queuedDeliveries.push(
      [{ messageId: "partial_1", channelId: "channel_1", webhookId: "webhook_1" }],
      [{ messageId: "fallback_1", channelId: "channel_1", webhookId: "webhook_1" }],
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls[0]?.contextItems.some((item) => item.role === "model")).toBe(false);
    expect(toolLoopCalls[1]?.contextItems.at(-1)).toMatchObject({
      role: "model",
      parts: [{ type: "text", text: "Tomori: First half." }],
    });
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(context.streamingContext.deliveredMessageRefs?.map((ref) => ref.messageId)).toEqual([
      "partial_1",
      "fallback_1",
    ]);
    expect(sink.finalizedResults).toEqual([result]);
    expect(result.status).toBe("completed");
    expect(result.personaResponses[0]?.text).toBe("First half.\nsecond half.");
    expect(result.streamResults.map((stream) => stream.accumulatedText)).toEqual(["First half.", "second half."]);
    // Post-turn stats record every usage entry under the final model, so the primary's must not ride along.
    expect(sumTurnUsage(result.streamResults)).toEqual({ inputTokens: 950, outputTokens: 20 });
  });

  it("trims history so the fallback request still fits its budget with the continuation added", async () => {
    const limitedModel = (id: number, codename: string) =>
      ({
        ...makeLlm(id, codename, "anthropic"),
        supports_assistant_prefill: true,
        context_window: 2000,
      }) as LlmRow;
    const context = makeContext(limitedModel(1, "claude-haiku-4-5"), limitedModel(2, "claude-haiku-4-5-fallback"));
    context.currentPersona.config.llm_max_output_tokens = 200;
    const historyLine = "Juno: ".padEnd(400, "a");
    context.contextItems = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("model" as const),
      parts: [{ type: "text" as const, text: `${index} ${historyLine}` }],
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    }));
    const trigger = { role: "user" as const, parts: [{ type: "text" as const, text: "Juno: keep going" }] };
    context.contextItems.push({ ...trigger, metadataTag: ContextItemTag.DIALOGUE_HISTORY });
    queuedResults.push(partialFailure("timeout", "b".repeat(2400)), successfulReply("done."));

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, collectingSink());

    const fallbackRequest = toolLoopCalls[1]?.contextItems ?? [];
    const estimatedTokens = Math.floor(
      fallbackRequest
        .flatMap((item) => item.parts)
        .reduce((chars, part) => chars + (part.type === "text" ? part.text.length : 0), 0) / 4,
    );
    expect(estimatedTokens).toBeLessThanOrEqual(computeSafeInputBudget(2000, 200));
    expect(fallbackRequest.at(-2)).toMatchObject(trigger);
    expect(fallbackRequest.at(-1)?.role).toBe("model");
  });

  it("continues a failed key's posted text on the rotated key, as an instruction when the model blocks prefill", async () => {
    rotationEnabled = true;
    const primaryModel = makeLlm(1, "claude-sonnet-4-6", "anthropic");
    const context = makeContext(primaryModel, makeLlm(2, "unused-fallback"));
    const sink = collectingSink();
    queuedResults.push(partialFailure("error", "First half."), successfulReply("second half."));

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => ({ model: call.model, apiKey: call.apiKey }))).toEqual([
      { model: "claude-sonnet-4-6", apiKey: "server-pool-41" },
      { model: "claude-sonnet-4-6", apiKey: "server-pool-42" },
    ]);
    const retryContext = toolLoopCalls[1]?.contextItems ?? [];
    expect(retryContext.some((item) => item.role === "model")).toBe(false);
    expect(JSON.stringify(retryContext.at(-1)?.parts)).toContain("First half.");
    expect(JSON.stringify(retryContext.at(-1)?.parts)).not.toContain("Tomori: First half.");
    expect(context.streamingContext.outputPrefill).toBe("Tomori: First half.");
    expect(sink.emittedErrors).toHaveLength(0);
    expect(result.personaResponses[0]?.text).toBe("First half.\nsecond half.");
  });

  it("completes with the posted text when the continuation has nothing to add", async () => {
    for (const [data, status] of [
      [undefined, "completed"],
      [{ finishReason: "length" }, "empty_response"],
    ] as const) {
      toolLoopCalls.length = 0;
      const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "fallback-model"));
      queuedResults.push(partialFailure("timeout", "Only half."), {
        status: "empty_response",
        streamResults: [{ status: "empty_response", data }],
        personaResponses: [],
      });

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      const result = await runGenerationTurn(context, collectingSink());

      expect(toolLoopCalls).toHaveLength(2);
      expect(result.status).toBe(status);
      expect(result.personaResponses[0]?.text).toBe("Only half.");
    }
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

  it("abandons the fallback chain when the destination refuses the send for missing access", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };

    const refusedResult: GenerationTurnResult = {
      status: "error",
      streamResults: [{ status: "error", data: Object.assign(new Error("Missing Access"), { code: 50001 }) }],
      personaResponses: [],
    };
    // Queued behind it so a consumed fallback attempt would be visible rather than silent.
    queuedResults.push(refusedResult, {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "fallback ran" }],
      personaResponses: [],
    });

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result.status).toBe("skipped");
    expect(queuedResults).toHaveLength(1);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("abandons the fallback chain when the destination is reported as deleted", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };

    const goneResult: GenerationTurnResult = {
      status: "error",
      streamResults: [{ status: "error", data: Object.assign(new Error("Unknown Channel"), { code: 10003 }) }],
      personaResponses: [],
    };
    queuedResults.push(goneResult, {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "fallback ran" }],
      personaResponses: [],
    });

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result.status).toBe("skipped");
    expect(queuedResults).toHaveLength(1);
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

  // Prompt scaffolding targets the primary model, so each fallback attempt must adapt verbatim schemas and nudges
  // to its own adapter.
  describe("verbatim tool-calling adaptation across the fallback chain", () => {
    const NUDGE_PROBE = "write the tool call as exactly one Markdown inline code span or fenced code block";

    function contextItemText(item: { parts: Array<{ type: string; text?: string }> }): string {
      return item.parts.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
    }

    const okSink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };

    const fallbackSuccess: GenerationTurnResult = {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "ok" }],
      personaResponses: [{ personaName: "Tomori", text: "ok", personaId: 10, personaLineageId: 100 }],
    };

    function enqueuePrimaryFailure(): void {
      queuedResults.push({
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      });
    }

    it.each([false, true])("injects fallback schemas matching the advertised sprite roster: %j", async (hasSprites) => {
      const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "unused-fallback"));
      context.streamingContext.deliberateToolAllowedNames = [
        "create_task",
        "generate_voice_message",
        "interact_with_target",
      ];
      context.currentPersona.fallback_chain = [
        {
          kind: "llm",
          model: {
            ...makeLlm(9, "local-model"),
            llm_provider: "custom:42",
            has_tools: true,
            verbatim_tool_calling: true,
          } as LlmRow,
        },
      ];
      context.contextItems = [
        { role: "user", parts: [{ type: "text", text: "hello" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
        { role: "model", parts: [{ type: "text", text: "hi" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ] as never;
      const personaId = context.currentPersona.persona_id ?? 10;
      setPersonaSpriteCache(
        personaId,
        hasSprites
          ? [
              personaSpriteSchema.parse({
                persona_id: personaId,
                sprite_name: "happy",
                sprite_key: "happy",
                avatar_url: "https://example.com/happy.png",
              }),
            ]
          : [],
      );
      try {
        const spriteItem = await buildPersonaSpriteContextItem({
          client: context.client,
          guildId: "guild",
          tomoriState: context.currentPersona,
          tomoriConfig: context.currentPersona.config,
          botName: context.currentPersona.persona_nickname,
          isUserImpersonation: false,
          convertMentions: async (text) => text,
        });
        if (spriteItem) context.contextItems.unshift(spriteItem);
      } finally {
        clearPersonaSpriteCache();
      }
      enqueuePrimaryFailure();
      queuedResults.push(fallbackSuccess);

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, okSink);

      expect(toolLoopCalls).toHaveLength(2);
      const fallbackItems = toolLoopCalls[1]?.contextItems ?? [];
      expect(
        fallbackItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS),
      ).toBe(true);
      expect(fallbackItems.some((item) => contextItemText(item).includes(NUDGE_PROBE))).toBe(true);
      const schemaItem = fallbackItems.find(
        (item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS,
      );
      const json = schemaItem ? contextItemText(schemaItem).match(/```json\n([\s\S]*?)\n```/)?.[1] : undefined;
      expect(json).toBeDefined();
      const schemas = JSON.parse(json ?? "[]") as Array<{
        function: { name: string; parameters: ToolParameterSchema };
      }>;
      for (const name of ["generate_voice_message", "interact_with_target"]) {
        const schema = schemas.find((tool) => tool.function.name === name);
        expect(schema).toBeDefined();
        expect(Boolean(schema?.function.parameters.properties.sprite)).toBe(hasSprites);
        expect(schema?.function.parameters.required).not.toContain("sprite");
      }
      const task = schemas.find((tool) => tool.function.name === "manage_task");
      expect(task?.function.parameters.properties.action.enum).toEqual(["create"]);
      expect(task?.function.parameters.properties.reminder_id).toBeUndefined();
      const primaryItems = toolLoopCalls[0]?.contextItems ?? [];
      expect(primaryItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS)).toBe(
        false,
      );
    });

    it("strips both verbatim halves when falling back from a verbatim custom model to a native one", async () => {
      const verbatimPrimary = {
        ...makeLlm(1, "primary-model"),
        llm_provider: "custom:42",
        has_tools: true,
        verbatim_tool_calling: true,
      } as LlmRow;
      const context = makeContext(verbatimPrimary, makeLlm(2, "native-fallback"));
      context.contextItems = [
        {
          role: "user",
          parts: [{ type: "text", text: "Available tools (JSON): []" }],
          metadataTag: ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS,
        },
        { role: "user", parts: [{ type: "text", text: "hello" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
        {
          role: "user",
          parts: [{ type: "text", text: `[System: ${VERBATIM_TOOL_CALLING_NUDGE}]` }],
          metadataTag: ContextItemTag.CONTEXT_NOTE_INJECTION,
        },
        { role: "model", parts: [{ type: "text", text: "hi" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ] as never;
      enqueuePrimaryFailure();
      queuedResults.push(fallbackSuccess);

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, okSink);

      const fallbackItems = toolLoopCalls[1]?.contextItems ?? [];
      expect(
        fallbackItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS),
      ).toBe(false);
      expect(fallbackItems.some((item) => contextItemText(item).includes(NUDGE_PROBE))).toBe(false);
      expect(fallbackItems.some((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY)).toBe(true);
    });

    it("strips a lone verbatim nudge on a native fallback when no schemas were emitted", async () => {
      // Stage 11 writes the verbatim nudge even when stage 07b drops the schema dump, so stripping cannot key on the
      // dump alone.
      const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "native-fallback"));
      context.contextItems = [
        { role: "user", parts: [{ type: "text", text: "hello" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
        {
          role: "user",
          parts: [{ type: "text", text: `[System: ${VERBATIM_TOOL_CALLING_NUDGE}]` }],
          metadataTag: ContextItemTag.CONTEXT_NOTE_INJECTION,
        },
        { role: "model", parts: [{ type: "text", text: "hi" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ] as never;
      enqueuePrimaryFailure();
      queuedResults.push(fallbackSuccess);

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, okSink);

      const fallbackItems = toolLoopCalls[1]?.contextItems ?? [];
      expect(fallbackItems.some((item) => contextItemText(item).includes(NUDGE_PROBE))).toBe(false);
      expect(fallbackItems.some((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY)).toBe(true);
    });

    it("adds the schema dump without duplicating a nudge the base context already carries", async () => {
      // Verbatim-to-verbatim fallback already carries the nudge in base context, so only the schema dump is injected
      // to avoid duplicating it.
      const verbatimPrimary = {
        ...makeLlm(1, "primary-model"),
        llm_provider: "custom:42",
        has_tools: true,
        verbatim_tool_calling: true,
      } as LlmRow;
      const context = makeContext(verbatimPrimary, makeLlm(2, "unused-fallback"));
      context.currentPersona.fallback_chain = [
        {
          kind: "llm",
          model: {
            ...makeLlm(9, "local-model"),
            llm_provider: "custom:43",
            has_tools: true,
            verbatim_tool_calling: true,
          } as LlmRow,
        },
      ];
      context.contextItems = [
        {
          role: "user",
          parts: [{ type: "text", text: `[System: ${VERBATIM_TOOL_CALLING_NUDGE}]` }],
          metadataTag: ContextItemTag.CONTEXT_NOTE_INJECTION,
        },
        { role: "user", parts: [{ type: "text", text: "hello" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
        { role: "model", parts: [{ type: "text", text: "hi" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ] as never;
      enqueuePrimaryFailure();
      queuedResults.push(fallbackSuccess);

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, okSink);

      const fallbackItems = toolLoopCalls[1]?.contextItems ?? [];
      expect(fallbackItems.filter((item) => contextItemText(item).includes(NUDGE_PROBE))).toHaveLength(1);
      expect(
        fallbackItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS),
      ).toBe(true);
    });

    it("drops the same-channel STM block and nudge on an attempt that sends no tools", async () => {
      const context = makeContext(
        { ...makeLlm(1, "primary-model"), has_tools: true } as LlmRow,
        makeLlm(2, "toolless-fallback"),
      );
      context.contextItems = [
        {
          role: "user",
          parts: [{ type: "text", text: "other channel" }],
          metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
        },
        {
          role: "user",
          parts: [{ type: "text", text: "this channel" }],
          metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
          requiresToolCalling: true,
        },
        { role: "user", parts: [{ type: "text", text: "hello" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ];
      enqueuePrimaryFailure();
      queuedResults.push(fallbackSuccess);

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, okSink);

      expect(
        toolLoopCalls.map((call) =>
          call.contextItems
            .filter((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY)
            .map(contextItemText),
        ),
      ).toEqual([["other channel", "this channel"], ["other channel"]]);
    });
  });
});
