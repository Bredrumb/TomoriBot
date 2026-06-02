import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { ChatTurnContext } from "@/utils/chat/types";
import type { TomoriState } from "@/types/db/schema";
import type { ToolResult } from "@/types/tool/interfaces";
import type { ToolLoopParams } from "@/utils/chat/toolLoop";

// Set env vars before any lazy import so module-level constants pick them up.
process.env.BOT_MAX_FUNCTION_CALL_ITERATIONS = "10";
process.env.BOT_MAX_CONSECUTIVE_TOOL_ERRORS = "3";

// --- per-test mutable state -----------------------------------------------

let toolExecuteCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let toolExecuteQueue: ToolResult[] = [];

// --------------------------------------------------------------------------
// Module mocks — all must appear before the first lazy import of toolLoop.ts
// --------------------------------------------------------------------------

mock.module("@/utils/misc/logger", () => ({
  ColorCode: { WARN: "WARN", ERROR: "ERROR", INFO: "INFO" },
  log: {
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    success: () => undefined,
    section: () => undefined,
  },
}));

mock.module("@/utils/discord/embedHelper", () => ({
  sendStandardEmbed: async () => undefined,
  // Stub additional exports so modules imported by other test files can satisfy
  // their static import bindings when this mock is in effect globally.
  createStandardEmbed: () => ({ setTitle: () => ({}), setDescription: () => ({}) }),
  createSummaryEmbed: () => ({ setTitle: () => ({}), setDescription: () => ({}) }),
  sendTranslationEmbed: async () => undefined,
}));

mock.module("@/utils/discord/toolProgressNotice", () => ({
  routeHiddenToolNotice: async () => undefined,
}));

mock.module("@/utils/discord/streamOrchestrator", () => ({
  StreamOrchestrator: {
    hasStopRequest: (_channelId: string) => false,
    getAndClearStopContext: (_channelId: string) => null,
  },
}));

mock.module("@/utils/provider/providerInfoRegistry", () => ({
  providerUsesApiFamily: (providerName: string, apiFamily: string) => {
    const families: Record<string, string> = {
      google: "google-genai",
      novelai: "novelai",
      openrouter: "openai-compatible",
    };
    return families[providerName.toLowerCase()] === apiFamily;
  },
}));

mock.module("@/utils/tools/deliberateToolMode", () => ({
  getDeliberateToolAllowedNames: (
    content: string | null | undefined,
    customTriggers?: Record<string, Array<string | { type: "literal" | "regex"; value: string }>> | null,
  ) => {
    const text = content ?? "";
    const allowedNames: string[] = [];
    if (/\b(search|look\s+up|latest|today|current|news)\b/i.test(text)) {
      allowedNames.push("web_search");
    }

    for (const [triggerKey, triggers] of Object.entries(customTriggers ?? {})) {
      const toolName = triggerKey === "image" ? "generate_image" : triggerKey;
      if (
        triggers.some((trigger) => {
          if (typeof trigger === "string") return trigger === "^" || text.toLowerCase().includes(trigger.toLowerCase());
          return trigger.type === "regex"
            ? new RegExp(trigger.value, "i").test(text)
            : text.toLowerCase().includes(trigger.value.toLowerCase());
        })
      ) {
        allowedNames.push(toolName);
      }
    }

    return [...new Set(allowedNames)];
  },
  applyDeliberateToolAllowlist: <T extends { name: string }>(params: {
    builtInTools: T[];
    mcpFunctionNames: string[];
    allowedToolNames?: string[] | null;
  }) => {
    if (!params.allowedToolNames?.length) {
      return { builtInTools: params.builtInTools, mcpFunctionNames: params.mcpFunctionNames };
    }
    const allowed = new Set(params.allowedToolNames);
    return {
      builtInTools: params.builtInTools.filter((tool) => allowed.has(tool.name)),
      mcpFunctionNames: params.mcpFunctionNames.filter((name) => allowed.has(name)),
    };
  },
  retainSuccessfulToolAffordance: () => undefined,
}));

mock.module("@/utils/chat/channelQueue", () => ({
  channelLocks: new Map(),
  setChannelStreamKill: () => undefined,
  setChannelToolCallChainActive: () => undefined,
  getChannelTurnAbortSignal: () => undefined,
  incrementChannelFollowUpCount: () => undefined,
  resetChannelFollowUpCount: () => undefined,
  queueStopResponseAtFront: () => undefined,
}));

mock.module("@/utils/chat/contextAnnotations", () => ({
  annotateRecentMessageMetadataInContext: () => ({ annotatedCount: 0, patchedReplyReferenceCount: 0 }),
  buildTailDirectiveMessage: () => null,
  buildRevealedMessageMetadataTailDirective: () => "",
}));

// The ToolRegistry singleton — executeTool drains toolExecuteQueue.
mock.module("@/tools/toolRegistry", () => ({
  ToolRegistry: {
    executeTool: async (name: string, args: Record<string, unknown>) => {
      toolExecuteCalls.push({ name, args });
      const next = toolExecuteQueue.shift();
      return next ?? { success: true, data: { result: "ok" } };
    },
  },
}));

// --------------------------------------------------------------------------
// Test helpers
// --------------------------------------------------------------------------

function makeTomoriState(): TomoriState {
  return {
    server_id: 1,
    persona_id: 42,
    persona_lineage_id: 420,
    persona_nickname: "TestBot",
    is_alter: false,
    llm: {
      llm_codename: "test-model",
      has_tools: true,
      sees_images: false,
      sees_videos: false,
      sees_youtube: false,
      supports_structoutput: false,
    },
    config: {
      api_key: "test-key",
      key_version: 1,
      llm_temperature: 0.7,
      private_channel_ids: [],
      tool_notice_hidden_keys: [],
    },
  } as unknown as TomoriState;
}

function makeContext(): ChatTurnContext {
  const channel = { id: "ch_test" };
  const tomoriState = makeTomoriState();
  return {
    channel,
    client: {},
    guild: null,
    locale: "en-US",
    message: { id: "msg_1", channel },
    contextItems: [],
    simplifiedMessages: [],
    messageIdMap: new Map(),
    emojiStrings: [],
    loadedEmojis: null,
    loadedStickers: null,
    channelName: "test-channel",
    channelDescription: null,
    serverDiscId: "server_1",
    serverName: "Test Server",
    serverDescription: null,
    userDiscId: "user_1",
    triggererName: "TestUser",
    textCredentialSource: "server",
    personalRoutingUserId: null,
    personalTextProvider: null,
    shouldApplyTextQuota: false,
    textQuotaTriggerKey: "turn_1",
    textQuotaState: null,
    // Disable user-facing embeds so sendStandardEmbed is never called for routing issues.
    shouldSurfaceUserErrors: false,
    isDMChannel: false,
    isFromQueue: true,
    isStopResponse: false,
    isPersonaJob: false,
    isSelfMessage: false,
    isUserImpersonation: false,
    allPersonas: [],
    currentPersona: tomoriState,
    tomoriState,
    requestSnapshot: {},
    streamingContext: { disableYouTubeProcessing: false },
    deliberateToolModeActive: false,
    deliberateToolContextTurns: 0,
    deliberateToolTriggerMatchByToolName: new Map(),
    responseTarget: undefined,
    turn: {
      lockedTurn: {
        channelId: "ch_test",
        admission: { incoming: { retryCount: 0 } },
        lockedAt: Date.now(),
        queueDepth: 0,
        skipLock: false,
      },
    },
  } as unknown as ChatTurnContext;
}

function makeProviderConfig(): ProviderConfig {
  return { model: "test-model", apiKey: "test-key", temperature: 0.7 };
}

/** Function-call stream result — simulates the provider requesting a tool. */
function makeFunctionCallResult(name: string, args: Record<string, unknown> = {}): StreamResult {
  return { status: "function_call", data: { name, args } };
}

/**
 * Creates a fake LLMProvider whose streamToDiscord pops from a result queue.
 * Returns the provider and an array that accumulates every functionInteractionHistory
 * array passed to each call, so tests can verify what the provider sees.
 */
function makeProvider(results: StreamResult[]): {
  provider: LLMProvider;
  capturedHistories: Array<unknown[]>;
} {
  const capturedHistories: Array<unknown[]> = [];
  const queue = [...results];

  const provider = {
    getInfo: () => ({
      name: "test-provider",
      displayName: "Test Provider",
      supportedModels: ["test-model"],
      requiresApiKey: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsImages: false,
      supportsVideos: false,
      apiFamily: "openai-compatible",
      supportedParams: [],
      featureSupport: {
        imageGeneration: "none",
        videoGeneration: "none",
        embeddings: false,
        structuredOutput: false,
        presetGeneration: false,
        expressionInitialization: false,
        liveTokenCounting: false,
        conversationCompaction: false,
        historyExtraction: false,
      },
    }),
    streamToDiscord: async (
      _ch: unknown,
      _cl: unknown,
      _ts: unknown,
      _cfg: unknown,
      _ctx: unknown,
      _parts: unknown,
      _emoji: unknown,
      functionHistory: unknown[] | undefined,
    ) => {
      capturedHistories.push(functionHistory ? [...functionHistory] : []);
      const next = queue.shift();
      if (!next) throw new Error("Fake provider: no more queued stream results");
      return next;
    },
    validateApiKey: async () => ({ valid: true }),
    formatErrorDescription: () => null,
    getTools: async () => [],
    getDefaultModel: async () => "test-model",
    createConfig: async () => makeProviderConfig(),
  } as unknown as LLMProvider;

  return { provider, capturedHistories };
}

/** Convenience: build ToolLoopParams from a context and provider. */
function makeParams(context: ChatTurnContext, provider: LLMProvider): ToolLoopParams {
  return { context, provider, providerConfig: makeProviderConfig(), tomoriState: context.tomoriState };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("runToolLoop — contract tests", () => {
  beforeEach(() => {
    toolExecuteCalls = [];
    toolExecuteQueue = [];
  });

  // -------------------------------------------------------------------------
  // 1. Successful tool call
  // -------------------------------------------------------------------------

  it("executes tool with correct args and delivers result to next provider call", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("echo_tool", { text: "hello" }),
      { status: "completed", accumulatedText: "I echoed: hello" },
    ]);
    toolExecuteQueue.push({ success: true, data: { echoed: "hello" } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    // Final result carries the completed text.
    expect(result.status).toBe("completed");
    expect(result.personaResponses).toHaveLength(1);
    expect(result.personaResponses[0]?.text).toBe("I echoed: hello");

    // Tool received the correct name and arguments.
    expect(toolExecuteCalls).toHaveLength(1);
    expect(toolExecuteCalls[0]?.name).toBe("echo_tool");
    expect(toolExecuteCalls[0]?.args).toEqual({ text: "hello" });

    // Provider called twice: once for the tool call, once for the final answer.
    expect(capturedHistories).toHaveLength(2);

    // First call had no history (initial turn).
    expect(capturedHistories[0]).toHaveLength(0);

    // Second call had one history entry with the paired call/response.
    const secondHistory = capturedHistories[1] as Array<{
      functionCall: { name: string };
      functionResponse: { functionResponse: { name: string; response: { result: unknown } } };
    }>;
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory[0]?.functionCall?.name).toBe("echo_tool");
    expect(secondHistory[0]?.functionResponse?.functionResponse?.name).toBe("echo_tool");

    // Tool result data is embedded in the function response.
    const resultData = secondHistory[0]?.functionResponse?.functionResponse?.response?.result as {
      echoed: string;
    };
    expect(resultData?.echoed).toBe("hello");

    // streamResults accumulates both iterations.
    expect(result.streamResults).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 2. Tool failure — loop continues, error represented in history
  // -------------------------------------------------------------------------

  it("tool failure: error is represented in the history entry and the loop continues", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("bad_tool", {}),
      { status: "completed", accumulatedText: "sorry about that" },
    ]);
    // One failure — below the consecutive-error cap (3).
    toolExecuteQueue.push({ success: false, error: "something broke" });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    // Loop survived the single failure and completed.
    expect(result.status).toBe("completed");
    expect(result.personaResponses[0]?.text).toBe("sorry about that");

    // Tool was invoked once.
    expect(toolExecuteCalls).toHaveLength(1);

    // History entry for the failed call uses the standardized failure shape.
    const secondHistory = capturedHistories[1] as Array<{
      functionCall: { name: string };
      functionResponse: { functionResponse: { response: { result: { status: string; tool_name: string } } } };
    }>;
    expect(secondHistory).toHaveLength(1);
    const failResult = secondHistory[0]?.functionResponse?.functionResponse?.response?.result;
    expect(failResult?.status).toBe("tool_execution_failed");
    expect(failResult?.tool_name).toBe("bad_tool");

    // The raw internal error string is not surfaced as the final response text.
    expect(result.personaResponses[0]?.text).not.toContain("something broke");
  });

  // -------------------------------------------------------------------------
  // 3. Consecutive error cap
  // -------------------------------------------------------------------------

  it("consecutive tool errors: loop exits with 'error' after MAX_CONSECUTIVE_TOOL_ERRORS failures", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    // Provide more function_call results than the cap so iteration count isn't the limiter.
    const { provider } = makeProvider(Array.from({ length: 20 }, () => makeFunctionCallResult("fail_tool", {})));
    for (let i = 0; i < 20; i++) {
      toolExecuteQueue.push({ success: false, error: "always broken" });
    }

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    // Cap is BOT_MAX_CONSECUTIVE_TOOL_ERRORS = 3 (set at the top of this file).
    expect(result.status).toBe("error");
    expect(toolExecuteCalls).toHaveLength(3);

    // No user-visible text (shouldSurfaceUserErrors is false in makeContext).
    expect(result.personaResponses).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 4. Deliberate tool exposure guard
  // -------------------------------------------------------------------------

  it("deliberate tool mode: blocked tool is NOT dispatched and gets synthetic failure in history", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("blocked_tool", { q: "test" }),
      { status: "completed", accumulatedText: "ok got it" },
    ]);

    const context = makeContext();
    // Deliberate mode is on; only "allowed_tool" is exposed.
    context.deliberateToolModeActive = true;
    context.streamingContext.deliberateToolAllowedNames = ["allowed_tool"];

    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");

    // ToolRegistry.executeTool must NOT have been called for the blocked tool.
    expect(toolExecuteCalls).toHaveLength(0);

    // The history entry given to the provider must carry the standardized failure shape.
    // Note: toolResult.data has `blocked_by_deliberate_tool_mode` but since success===false,
    // executeToolCall routes through the generic failure path → status="tool_execution_failed".
    const secondHistory = capturedHistories[1] as Array<{
      functionCall: { name: string };
      functionResponse: {
        functionResponse: {
          response: { result: { status: string; tool_name: string; reason: string } };
        };
      };
    }>;
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory[0]?.functionCall?.name).toBe("blocked_tool");
    const syntheticResult = secondHistory[0]?.functionResponse?.functionResponse?.response?.result;
    expect(syntheticResult?.status).toBe("tool_execution_failed");
    expect(syntheticResult?.tool_name).toBe("blocked_tool");
    // Reason must mention that the tool was not exposed (not a generic failure).
    expect(syntheticResult?.reason).toContain("not exposed");
  });

  // -------------------------------------------------------------------------
  // 5. Loop iteration bound
  // -------------------------------------------------------------------------

  it("loop bound: exits with 'timeout' after MAX_FUNCTION_CALL_ITERATIONS with no final answer", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    // Provider never produces a terminal result — always requests another tool.
    const limit = 10; // matches BOT_MAX_FUNCTION_CALL_ITERATIONS set above
    const { provider } = makeProvider(
      Array.from({ length: limit + 5 }, () => makeFunctionCallResult("infinite_tool", {})),
    );
    // Tool always succeeds so consecutive-error cap is never triggered.
    for (let i = 0; i < limit + 5; i++) {
      toolExecuteQueue.push({ success: true, data: { ok: true } });
    }

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("timeout");
    // Exactly limit iterations ran (one tool call per iteration).
    expect(toolExecuteCalls).toHaveLength(limit);
    // All iterations' stream results are collected.
    expect(result.streamResults).toHaveLength(limit);
  });

  // -------------------------------------------------------------------------
  // 6. Empty function-call payload aborts immediately
  // -------------------------------------------------------------------------

  it("malformed function-call (missing name) aborts with 'error' without dispatching any tool", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    // data has no `name` field — should trigger the validation abort path.
    const { provider } = makeProvider([{ status: "function_call", data: {} }]);

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("error");
    expect(toolExecuteCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 7. Context-restart signal: injected into contextItems, not into history
  // -------------------------------------------------------------------------

  it("context-restart response: enriched item injected into contextItems, no history entry for that tool call", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      // 1st call: provider requests the context-restart tool
      makeFunctionCallResult("reveal_tool", {}),
      // 2nd call: provider now sees the enriched context and answers
      { status: "completed", accumulatedText: "here you go" },
    ]);

    // Tool returns a context_restart_youtube signal with an enhanced_context_item.
    const fakeContextItem = { role: "user", parts: [{ text: "YouTube transcript: ..." }] };
    toolExecuteQueue.push({
      success: true,
      data: {
        type: "context_restart_youtube",
        enhanced_context_item: fakeContextItem,
      },
    });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(result.personaResponses[0]?.text).toBe("here you go");

    // The enriched item must be appended to contextItems.
    expect(context.contextItems).toContain(fakeContextItem);

    // The streaming-context disable flag must have been set.
    expect(context.streamingContext.disableYouTubeProcessing).toBe(true);

    // The context-restart call must NOT appear in the function history
    // passed to the second provider call (restart replaces it with enriched context).
    expect(capturedHistories).toHaveLength(2);
    expect(capturedHistories[1]).toHaveLength(0); // no history entry for the restart call
  });
});
