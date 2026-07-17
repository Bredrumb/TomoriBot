import { beforeEach, describe, expect, it, mock } from "bun:test";
// Captured BEFORE the `mock.module` calls below run. Static imports are
// evaluated at link time, ahead of any top-level statement, so this binds the
// REAL deliberateToolMode module; we re-register it in afterAll to undo the
// simplified stub for files loaded later in the monolithic run.
import * as realDeliberateToolMode from "@/utils/tools/deliberateToolMode";
import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { ChatTurnContext } from "@/utils/chat/types";
import type { TomoriState } from "@/types/db/schema";
import type { ToolResult } from "@/types/tool/interfaces";
import type { ToolLoopParams } from "@/utils/chat/toolLoop";

// Set env vars before any lazy import so module-level constants pick them up.
process.env.BOT_MAX_FUNCTION_CALL_ITERATIONS = "10";
process.env.BOT_MAX_CONSECUTIVE_TOOL_ERRORS = "5";
process.env.NAI_TOOL_FAILURE_RETRY_THRESHOLD = "3";

// --- per-test mutable state -----------------------------------------------

let toolExecuteCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let toolExecuteQueue: ToolResult[] = [];
let requiresFollowUp = false;
let requiresFollowUpCalls: Array<{ name: string; provider: string; serverId?: number }> = [];
let hasStopRequest = false;
let isFollowUpRequest = false;
let clearStopRequestCalls = 0;
let standardEmbedCalls: Array<{ titleKey?: string; descriptionKey?: string }> = [];

// --------------------------------------------------------------------------
// Module mocks — all must appear before the first lazy import of toolLoop.ts
// --------------------------------------------------------------------------

mock.module("@/utils/misc/logger", () => ({
  // Values must stay hex STRINGS mirroring the real enum: modules evaluated
  // while this global mock is in effect call string methods on them at load
  // time (e.g. contextEmbeds.ts does ColorCode.ERROR.replace("#", "")).
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
    warn: () => undefined,
    success: () => undefined,
    section: () => undefined,
  },
}));

mock.module("@/utils/discord/embedHelper", () => ({
  sendStandardEmbed: async (
    _channel: unknown,
    _locale: string,
    options: { titleKey?: string; descriptionKey?: string },
  ) => {
    standardEmbedCalls.push(options);
  },
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
    hasStopRequest: (_channelId: string) => hasStopRequest,
    isFollowUpRequest: (_channelId: string) => isFollowUpRequest,
    clearStopRequest: (_channelId: string) => {
      clearStopRequestCalls += 1;
      hasStopRequest = false;
    },
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

// Pass through to the REAL deliberateToolMode (captured at link time above).
// toolLoop.ts never calls these functions — it reads deliberate-mode data from
// `context` — so the loop tests don't need a behavioral stub here; the mock
// exists only to satisfy transitive linking. Returning the real exports keeps
// the mock harmless if it leaks into a later file in the monolithic `bun test`
// (e.g. deliberateToolMode.test.ts, which asserts the real behavior). Spreading
// a statically-captured namespace is safe — unlike `await import()` inside a
// factory, it was evaluated before any mock.module call took effect.
mock.module("@/utils/tools/deliberateToolMode", () => ({ ...realDeliberateToolMode }));

mock.module("@/utils/chat/channelQueue", () => ({
  channelLocks: new Map(),
  setChannelStreamKill: () => undefined,
  setChannelToolCallChainActive: () => undefined,
  getChannelTurnAbortSignal: () => undefined,
  incrementChannelFollowUpCount: () => undefined,
  resetChannelFollowUpCount: () => undefined,
  queueStopResponseAtFront: () => undefined,
}));

// This mock must stub the module's COMPLETE export surface: bun module mocks
// are process-wide for the rest of the test run, so any test file loaded later
// that imports an omitted named export (e.g. contextMedia ->
// formatInlineSystemContent) fails module linking. Only the first three stubs
// carry behavior this test depends on; the rest exist to satisfy linking and
// mirror the real signatures inertly.
mock.module("@/utils/chat/contextAnnotations", () => ({
  annotateRecentMessageMetadataInContext: () => ({ annotatedCount: 0, patchedReplyReferenceCount: 0 }),
  buildTailDirectiveMessage: () => null,
  buildRevealedMessageMetadataTailDirective: () => "",
  buildCombinedTailDirectiveMessage: () => null,
  buildSpeakerGuardRetryDirective: () => null,
  buildReplyReferenceContextAnnotation: async () => null,
  buildReactionContextAnnotation: async () => null,
  createReactionContextBudgetState: () => ({}),
  findReplyContextTargetInMessage: () => null,
  mergeForcedMentions: () => [],
  mergeInjectedContextItems: (items: unknown) => items,
  appendInjectedContextItems: () => undefined,
  insertBeforeLatestDialoguePair: () => undefined,
  stripAtPersonaTriggers: (content: string) => content,
  formatInlineSystemContent: (content: string | null | undefined) =>
    content?.replace(/\s+/g, " ").trim() || "[System: No text content was included]",
}));

// The ToolRegistry singleton — executeTool drains toolExecuteQueue.
mock.module("@/tools/toolRegistry", () => ({
  ToolRegistry: {
    executeTool: async (name: string, args: Record<string, unknown>) => {
      toolExecuteCalls.push({ name, args });
      const next = toolExecuteQueue.shift();
      return next ?? { success: true, data: { result: "ok" } };
    },
    requiresFollowUp: async (name: string, provider: string, serverId?: number) => {
      requiresFollowUpCalls.push({ name, provider, serverId });
      return requiresFollowUp;
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
function makeFunctionCallResult(
  name: string,
  args: Record<string, unknown> = {},
  accumulatedText?: string,
): StreamResult {
  return { status: "function_call", data: { name, args }, accumulatedText };
}

/**
 * Creates a fake LLMProvider whose streamToDiscord pops from a result queue.
 * Returns the provider and an array that accumulates every functionInteractionHistory
 * array passed to each call, so tests can verify what the provider sees.
 */
function makeProvider(
  results: StreamResult[],
  providerName = "test-provider",
): {
  provider: LLMProvider;
  capturedHistories: Array<unknown[]>;
} {
  const capturedHistories: Array<unknown[]> = [];
  const queue = [...results];

  const provider = {
    getInfo: () => ({
      name: providerName,
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
    requiresFollowUp = false;
    requiresFollowUpCalls = [];
    hasStopRequest = false;
    isFollowUpRequest = false;
    clearStopRequestCalls = 0;
    standardEmbedCalls = [];
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

    // Cap is BOT_MAX_CONSECUTIVE_TOOL_ERRORS = 5 (set at the top of this file).
    expect(result.status).toBe("error");
    expect(toolExecuteCalls).toHaveLength(5);

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

  // -------------------------------------------------------------------------
  // 8. Pre-tool text preservation (post-tool-call amnesia regression)
  // -------------------------------------------------------------------------

  it("pre-tool text is preserved in the history entry passed to the follow-up provider call", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      // Model streams visible text, THEN calls a tool that continues after its result.
      makeFunctionCallResult("create_long_term_memory", { content: "likes cats" }, "Yeah, let me remember that."),
      { status: "completed", accumulatedText: "Saved! Anything else?" },
    ]);
    toolExecuteQueue.push({ success: true, data: { saved: true } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    // The loop continued to a follow-up provider call — long-term memory
    // must NOT behave as an end-turn tool.
    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(2);
    expect(result.personaResponses[0]?.text).toBe("Saved! Anything else?");

    // The follow-up call's history entry carries the already-sent text so the
    // model knows not to repeat it (the amnesia fix contract).
    const secondHistory = capturedHistories[1] as Array<{
      functionCall: { name: string };
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>;
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory[0]?.preToolCallTextParts).toEqual([{ type: "text", text: "Yeah, let me remember that." }]);
  });

  it("no pre-tool text: history entry omits preToolCallTextParts", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      // Whitespace-only accumulated text must not produce text parts.
      makeFunctionCallResult("echo_tool", {}, "   "),
      { status: "completed", accumulatedText: "done" },
    ]);
    toolExecuteQueue.push({ success: true, data: { ok: true } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    const secondHistory = capturedHistories[1] as Array<{
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>;
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory[0]?.preToolCallTextParts).toBeUndefined();
  });

  it("multi-tool chain: each history entry carries only its own iteration's pre-tool text", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("tool_one", {}, "First, let me check something."),
      makeFunctionCallResult("tool_two", {}, "Now one more thing."),
      { status: "completed", accumulatedText: "All done!" },
    ]);
    toolExecuteQueue.push({ success: true, data: { ok: 1 } });
    toolExecuteQueue.push({ success: true, data: { ok: 2 } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(3);

    // The third provider call sees both entries, each with its own text —
    // no duplication across iterations (fresh stream state per streamOnce).
    const thirdHistory = capturedHistories[2] as Array<{
      functionCall: { name: string };
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>;
    expect(thirdHistory).toHaveLength(2);
    expect(thirdHistory[0]?.preToolCallTextParts).toEqual([{ type: "text", text: "First, let me check something." }]);
    expect(thirdHistory[1]?.preToolCallTextParts).toEqual([{ type: "text", text: "Now one more thing." }]);
  });

  // -------------------------------------------------------------------------
  // 9. Pre-tool text early-exit policy is unchanged
  // -------------------------------------------------------------------------

  it("update_short_term_memory with pre-tool text still ends the turn without a follow-up call", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("update_short_term_memory", { content: "note" }, "Got it, noting that down."),
      // No second result queued — a follow-up call would throw in the fake provider.
    ]);
    toolExecuteQueue.push({ success: true, data: { saved: true } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    // Suppress-set tool ends the turn after pre-tool text; the visible text is the response.
    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(1);
    expect(result.personaResponses[0]?.text).toBe("Got it, noting that down.");
    expect(requiresFollowUpCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 10. Sticker selection is carried only through completed turns
  // -------------------------------------------------------------------------

  it("successful sticker selection is carried on the completed result", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const sticker = { id: "sticker_1", name: "Wave", url: "https://cdn.example/sticker.png" };
    const { provider } = makeProvider([
      makeFunctionCallResult("select_sticker_for_response", { sticker_name: "Wave" }),
      { status: "completed", accumulatedText: "Hello!" },
    ]);
    toolExecuteQueue.push({
      success: true,
      data: { status: "sticker_selected_successfully", sticker_id: sticker.id, sticker_name: sticker.name },
    });

    const context = makeContext();
    context.guild = { stickers: { cache: new Map([[sticker.id, sticker]]) } } as unknown as ChatTurnContext["guild"];
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(result.selectedSticker).toBe(sticker);
  });

  it("a later failed sticker selection clears an earlier selection", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const sticker = { id: "sticker_1", name: "Wave", url: "https://cdn.example/sticker.png" };
    const { provider } = makeProvider([
      makeFunctionCallResult("select_sticker_for_response", { sticker_name: "Wave" }),
      makeFunctionCallResult("select_sticker_for_response", { sticker_name: "Missing" }),
      { status: "completed", accumulatedText: "No sticker this time." },
    ]);
    toolExecuteQueue.push({
      success: true,
      data: { status: "sticker_selected_successfully", sticker_id: sticker.id, sticker_name: sticker.name },
    });
    toolExecuteQueue.push({ success: false, data: { status: "sticker_not_found" }, error: "not found" });

    const context = makeContext();
    context.guild = { stickers: { cache: new Map([[sticker.id, sticker]]) } } as unknown as ChatTurnContext["guild"];
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(result.selectedSticker).toBeUndefined();
  });

  it("max-iterations timeout clears a selected sticker", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const sticker = { id: "sticker_1", name: "Wave", url: "https://cdn.example/sticker.png" };
    const { provider } = makeProvider([
      makeFunctionCallResult("select_sticker_for_response", { sticker_name: "Wave" }),
      ...Array.from({ length: 9 }, () => makeFunctionCallResult("infinite_tool")),
    ]);
    toolExecuteQueue.push({
      success: true,
      data: { status: "sticker_selected_successfully", sticker_id: sticker.id, sticker_name: sticker.name },
    });
    for (let i = 0; i < 9; i++) {
      toolExecuteQueue.push({ success: true, data: { ok: true } });
    }

    const context = makeContext();
    context.guild = { stickers: { cache: new Map([[sticker.id, sticker]]) } } as unknown as ChatTurnContext["guild"];
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("timeout");
    expect(result.selectedSticker).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 11. NovelAI follow-up policy
  // -------------------------------------------------------------------------

  it("NovelAI continues after pre-tool text when the successful tool requires follow-up", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    requiresFollowUp = true;
    const { provider, capturedHistories } = makeProvider(
      [
        makeFunctionCallResult("web_search", { query: "news" }, "Let me check."),
        { status: "completed", accumulatedText: "Here is what I found." },
      ],
      "novelai",
    );
    toolExecuteQueue.push({ success: true, data: { results: ["result"] } });

    const context = makeContext();
    context.streamingContext.suppressTextOutput = true;
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(2);
    expect(result.personaResponses[0]?.text).toBe("Here is what I found.");
    expect(context.streamingContext.suppressTextOutput).toBe(false);
    expect(requiresFollowUpCalls).toEqual([{ name: "web_search", provider: "novelai", serverId: 1 }]);
  });

  it("NovelAI ends after pre-tool text when the successful tool does not require follow-up", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider, capturedHistories } = makeProvider(
      [makeFunctionCallResult("non_follow_up_tool", {}, "That is done.")],
      "novelai",
    );
    toolExecuteQueue.push({ success: true, data: { ok: true } });

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(1);
    expect(result.personaResponses[0]?.text).toBe("That is done.");
    expect(requiresFollowUpCalls).toEqual([{ name: "non_follow_up_tool", provider: "novelai", serverId: 1 }]);
  });

  // -------------------------------------------------------------------------
  // 12. NovelAI tool-failure retry
  // -------------------------------------------------------------------------

  it("NovelAI suppresses repeated text and retries a tool failure after pre-tool text", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider, capturedHistories } = makeProvider(
      [
        makeFunctionCallResult("web_search", {}, "Let me try that."),
        { status: "completed", accumulatedText: "Recovered." },
      ],
      "novelai",
    );
    toolExecuteQueue.push({ success: false, error: "temporary failure" });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(2);
    expect(context.streamingContext.suppressTextOutput).toBe(true);
    expect(standardEmbedCalls).toHaveLength(0);
  });

  it("NovelAI ends with the localized retry-exhausted embed at the configured threshold", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider, capturedHistories } = makeProvider(
      Array.from({ length: 4 }, () => makeFunctionCallResult("web_search", {}, "Still trying.")),
      "novelai",
    );
    for (let i = 0; i < 4; i++) {
      toolExecuteQueue.push({ success: false, error: "always fails" });
    }

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(3);
    expect(toolExecuteCalls).toHaveLength(3);
    expect(standardEmbedCalls).toContainEqual({
      titleKey: "genai.nai_tool_retry_exhausted_title",
      descriptionKey: "genai.nai_tool_retry_exhausted_description",
      color: "#E74C3C",
    });
  });

  // -------------------------------------------------------------------------
  // 13. STM single-update guard
  // -------------------------------------------------------------------------

  it("successful STM update without pre-tool text disables further STM calls and continues", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("update_short_term_memory", { content: "note" }),
      { status: "completed", accumulatedText: "Done." },
    ]);
    toolExecuteQueue.push({ success: true, data: { saved: true } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(2);
    expect(context.streamingContext.disableShortTermMemoryUpdate).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 14. Follow-up interrupts do not kill an active tool chain
  // -------------------------------------------------------------------------

  it("clears a stale follow-up interrupt and lets the tool chain continue", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    hasStopRequest = true;
    isFollowUpRequest = true;
    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("echo_tool"),
      { status: "completed", accumulatedText: "Done." },
    ]);
    toolExecuteQueue.push({ success: true, data: { ok: true } });

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("completed");
    expect(toolExecuteCalls).toHaveLength(1);
    expect(capturedHistories).toHaveLength(2);
    expect(clearStopRequestCalls).toBe(1);
  });

  it("a plain stop request still aborts before tool execution", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    hasStopRequest = true;
    isFollowUpRequest = false;
    const { provider } = makeProvider([makeFunctionCallResult("echo_tool")]);

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("stopped_by_user");
    expect(toolExecuteCalls).toHaveLength(0);
    expect(clearStopRequestCalls).toBe(0);
  });
});
