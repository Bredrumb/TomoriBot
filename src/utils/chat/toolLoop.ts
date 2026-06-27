import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { ToolRegistry } from "@/tools/toolRegistry";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { routeHiddenToolNotice } from "@/utils/discord/toolProgressNotice";
import { ColorCode, log } from "@/utils/misc/logger";
import { providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";
import {
  channelLocks,
  getChannelTurnAbortSignal,
  incrementChannelFollowUpCount,
  queueStopResponseAtFront,
  resetChannelFollowUpCount,
  setChannelStreamKill,
  setChannelToolCallChainActive,
} from "@/utils/chat/channelQueue";
import {
  annotateRecentMessageMetadataInContext,
  buildRevealedMessageMetadataTailDirective,
  buildTailDirectiveMessage,
} from "@/utils/chat/contextAnnotations";
import type { ChatTurnContext, GenerationTurnResult, ToolHistoryEntry } from "@/utils/chat/types";

const MAX_FUNCTION_CALL_ITERATIONS = parseIntegerEnvFlag(process.env.BOT_MAX_FUNCTION_CALL_ITERATIONS, 100, 1);
const SOFT_WARN_ITERATION_THRESHOLD = 20;
const MAX_CONSECUTIVE_TOOL_ERRORS = parseIntegerEnvFlag(process.env.BOT_MAX_CONSECUTIVE_TOOL_ERRORS, 5, 1);
const STREAM_SDK_CALL_TIMEOUT_MS = parseIntegerEnvFlag(process.env.STREAM_SDK_CALL_TIMEOUT_MS, 120000, 10000);
const TOOL_EXECUTION_TIMEOUT_MS = parseIntegerEnvFlag(process.env.TOOL_EXECUTION_TIMEOUT_MS, 300000, 10000);
const TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT = new Set(["update_short_term_memory"]);
const TOOL_FAILURE_NOTICE_LIMIT = 1800;

export interface ToolLoopParams {
  context: ChatTurnContext;
  provider: LLMProvider;
  providerConfig: ProviderConfig;
  tomoriState: ChatTurnContext["tomoriState"];
}

export function providerIsApiFamily(
  providerName: string,
  apiFamily: Parameters<typeof providerUsesApiFamily>[1],
): boolean {
  return providerUsesApiFamily(providerName, apiFamily);
}

export async function runToolLoop(params: ToolLoopParams): Promise<GenerationTurnResult> {
  const streamResults: StreamResult[] = [];
  const functionHistory: ToolHistoryEntry[] = [];
  const accumulatedModelParts: Array<Record<string, unknown>> = [];
  let finalText = "";
  let detailsText = "";
  let consecutiveToolErrors = 0;
  let thoughtLog: GenerationTurnResult["thoughtLog"];

  for (let iteration = 0; iteration < MAX_FUNCTION_CALL_ITERATIONS; iteration++) {
    if (iteration === SOFT_WARN_ITERATION_THRESHOLD && params.context.shouldSurfaceUserErrors) {
      await sendStandardEmbed(
        params.context.channel as Parameters<typeof sendStandardEmbed>[0],
        params.context.locale,
        {
          color: ColorCode.WARN,
          titleKey: "genai.still_working_title",
          descriptionKey: "genai.still_working_description",
        },
      );
    }

    const streamResult = await streamOnce(params, accumulatedModelParts, functionHistory);
    streamResults.push(streamResult);
    thoughtLog = streamResult.thoughtLog ?? thoughtLog;

    switch (streamResult.status) {
      case "completed":
        resetChannelFollowUpCount(params.context.channel.id);
        finalText = streamResult.accumulatedText ?? finalText;
        detailsText = mergeDetails(detailsText, streamResult.detailsContent);
        return buildResult("completed", params.context, streamResults, finalText, detailsText, thoughtLog);
      case "error":
      case "timeout":
        resetChannelFollowUpCount(params.context.channel.id);
        return buildResult(streamResult.status, params.context, streamResults, finalText, detailsText, thoughtLog);
      case "empty_response":
        return buildResult("empty_response", params.context, streamResults, finalText, detailsText, thoughtLog);
      case "stopped_by_user":
        queueStopResponseIfPresent(params.context);
        resetChannelFollowUpCount(params.context.channel.id);
        return buildResult("stopped_by_user", params.context, streamResults, finalText, detailsText, thoughtLog);
      case "follow_up_interrupt":
        incrementChannelFollowUpCount(params.context.channel.id);
        return buildResult("follow_up_interrupt", params.context, streamResults, finalText, detailsText, thoughtLog);
      case "function_call": {
        detailsText = mergeDetails(detailsText, streamResult.detailsContent);
        setChannelToolCallChainActive(channelLocks.get(params.context.turn.lockedTurn.channelId), true);
        const toolOutcome = await executeToolCall(params, streamResult, iteration);
        if (toolOutcome.kind === "restart") {
          consecutiveToolErrors = 0;
          continue;
        }
        if (toolOutcome.kind === "abort") {
          return buildResult(toolOutcome.status, params.context, streamResults, finalText, detailsText, thoughtLog);
        }

        functionHistory.push(toolOutcome.historyEntry);
        if (toolOutcome.success) {
          consecutiveToolErrors = 0;
        } else {
          consecutiveToolErrors += 1;
          if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
            await emitToolErrorLoop(params.context);
            return buildResult("error", params.context, streamResults, finalText, detailsText, thoughtLog);
          }
        }

        if (toolOutcome.endTurn || shouldEndAfterPreToolText(params.provider, streamResult, toolOutcome.functionName)) {
          return buildResult(
            "completed",
            params.context,
            streamResults,
            streamResult.accumulatedText ?? finalText,
            detailsText,
            thoughtLog,
          );
        }
        break;
      }
      default: {
        const exhaustive: never = streamResult.status;
        throw new Error(`Unhandled stream status: ${String(exhaustive)}`);
      }
    }
  }

  if (params.context.shouldSurfaceUserErrors) {
    await sendStandardEmbed(params.context.channel as Parameters<typeof sendStandardEmbed>[0], params.context.locale, {
      color: ColorCode.WARN,
      titleKey: "genai.max_iterations_title",
      descriptionKey: "genai.max_iterations_streaming_description",
      footerKey: "genai.generic_error_footer",
    });
  }
  return buildResult("timeout", params.context, streamResults, finalText, detailsText, thoughtLog);
}

async function streamOnce(
  params: ToolLoopParams,
  accumulatedModelParts: Array<Record<string, unknown>>,
  functionHistory: ToolHistoryEntry[],
): Promise<StreamResult> {
  const channelId = params.context.channel.id;
  const abortController = new AbortController();
  params.context.streamingContext.abortSignal = abortController.signal;
  let timeoutId: NodeJS.Timeout | null = null;

  // Unified kill: aborts the HTTP request AND rejects the Promise.race.
  // Stored on the lock entry so /bot kill and stale-lock release can trigger it externally.
  let killStream: ((reason: Error) => void) | null = null;

  const refreshTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      killStream?.(new Error("SDK_CALL_TIMEOUT: provider streamToDiscord call timed out."));
    }, STREAM_SDK_CALL_TIMEOUT_MS);
  };
  params.context.streamingContext.onStreamProgress = refreshTimeout;
  refreshTimeout();

  // Scene turns are queued (isFromQueue=true) but all share the same trigger
  // message. Replying to it would make every queued persona render "replying to"
  // the very same message, so suppress the reply reference for scene turns and let
  // them read as a free-standing back-and-forth dialogue instead.
  const isSceneTurn = Boolean(params.context.turn.lockedTurn.admission.incoming.sceneTurn);
  const replyToMessage = params.context.isFromQueue && !isSceneTurn ? params.context.message : undefined;

  try {
    return await Promise.race([
      params.provider.streamToDiscord(
        params.context.channel as Parameters<LLMProvider["streamToDiscord"]>[0],
        params.context.client,
        params.tomoriState,
        params.providerConfig,
        params.context.contextItems,
        accumulatedModelParts,
        params.context.emojiStrings,
        functionHistory.length > 0 ? functionHistory : undefined,
        undefined,
        replyToMessage,
        params.context.streamingContext,
        params.context.locale,
        params.context.responseTarget?.webhook,
        params.context.responseTarget?.personaAvatarUrl,
        params.context.responseTarget?.personaUsername,
        params.context.responseTarget?.prefixStrippingName,
      ),
      new Promise<never>((_, reject) => {
        // Register the kill callback with the lock entry so external callers can trigger it.
        killStream = (reason: Error) => {
          abortController.abort();
          reject(reason);
        };
        setChannelStreamKill(channelId, killStream);
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SDK_CALL_TIMEOUT:")) {
      if (StreamOrchestrator.hasStopRequest(channelId)) {
        return { status: "stopped_by_user" };
      }

      if (!params.context.streamingContext.suppressUserErrors) {
        await sendStandardEmbed(
          params.context.channel as Parameters<typeof sendStandardEmbed>[0],
          params.context.locale,
          {
            titleKey: "genai.stream.inactivity_timeout_title",
            descriptionKey: "genai.stream.inactivity_timeout_description",
            color: ColorCode.WARN,
          },
        ).catch((embedError) => {
          log.warn(
            "Failed to send SDK call timeout embed",
            embedError instanceof Error ? embedError : new Error(String(embedError)),
          );
        });
      }
      return { status: "timeout", data: error };
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    params.context.streamingContext.onStreamProgress = undefined;
    setChannelStreamKill(channelId, null);
  }
}

async function executeToolCall(
  params: ToolLoopParams,
  streamResult: StreamResult,
  iteration: number,
): Promise<
  | { kind: "restart" }
  | { kind: "abort"; status: GenerationTurnResult["status"] }
  | {
      kind: "history";
      functionName: string;
      success: boolean;
      endTurn: boolean;
      historyEntry: ToolHistoryEntry;
    }
> {
  if (!streamResult.data || typeof streamResult.data !== "object" || !("name" in streamResult.data)) {
    log.error("Function call status received without function-call data", streamResult);
    return { kind: "abort", status: "error" };
  }

  const functionCall = streamResult.data as ToolHistoryEntry["functionCall"];
  const functionName = functionCall.name?.trim() ?? "";
  if (!functionName) {
    return { kind: "abort", status: "error" };
  }

  if (StreamOrchestrator.hasStopRequest(params.context.channel.id)) {
    return { kind: "abort", status: "stopped_by_user" };
  }

  const turnAbortSignal = getChannelTurnAbortSignal(params.context.channel.id);
  const toolContext: ToolContext = {
    channel: params.context.channel as ToolContext["channel"],
    client: params.context.client,
    message: params.context.message,
    userId: params.context.userDiscId,
    internalUserId: params.context.personalRoutingUserId ?? undefined,
    guildId: params.context.guild?.id,
    tomoriState: params.tomoriState,
    locale: params.context.locale,
    provider: params.provider.getInfo().name,
    streamContext: params.context.streamingContext,
    webhook: params.context.responseTarget?.webhook,
    personaUsername: params.context.responseTarget?.personaUsername,
    personaAvatarUrl: params.context.responseTarget?.personaAvatarUrl,
    activePersonaId: params.context.currentPersona.persona_id ?? undefined,
    isUserImpersonation: params.context.isUserImpersonation,
    impersonatedUserId: params.context.impersonatedUserId,
    suppressProgressNotices: !params.context.shouldSurfaceUserErrors || undefined,
    contextItems: params.context.contextItems,
    messageIdMap: params.context.messageIdMap,
    showKillHint: iteration >= SOFT_WARN_ITERATION_THRESHOLD,
    abortSignal: turnAbortSignal,
  };

  // 1. Deliberate-tool-mode allowlist enforcement. When mode is active and
  // the model attempts a tool that wasn't exposed for this turn, short-circuit
  // with a synthetic failure response (visible to the model) so it can adapt.
  const allowedNames = params.context.streamingContext.deliberateToolAllowedNames;
  const deliberateAllowedSet = allowedNames?.length ? new Set(allowedNames) : null;
  const isBlockedByDeliberateAllowlist =
    params.context.deliberateToolModeActive && deliberateAllowedSet !== null && !deliberateAllowedSet.has(functionName);

  const startedAt = Date.now();

  // Build a promise that resolves immediately if /bot kill fires (turn abort signal).
  const killPromise: Promise<ToolResult> | null = turnAbortSignal
    ? new Promise<ToolResult>((resolve) => {
        if (turnAbortSignal.aborted) {
          resolve({ success: false, error: `Tool "${functionName}" was killed.` });
          return;
        }
        turnAbortSignal.addEventListener(
          "abort",
          () => resolve({ success: false, error: `Tool "${functionName}" was killed.` }),
          { once: true },
        );
      })
    : null;

  const toolResult = isBlockedByDeliberateAllowlist
    ? {
        success: false,
        error: `Tool "${functionName}" was not exposed for this deliberate tool mode turn.`,
        data: {
          status: "blocked_by_deliberate_tool_mode",
          functionName,
          allowedToolNames: deliberateAllowedSet ? [...deliberateAllowedSet] : [],
        },
      }
    : await Promise.race([
        ToolRegistry.executeTool(functionName, functionCall.args ?? {}, toolContext),
        new Promise<ToolResult>((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: false,
                error: `Tool "${functionName}" timed out after ${TOOL_EXECUTION_TIMEOUT_MS / 1000}s.`,
              }),
            TOOL_EXECUTION_TIMEOUT_MS,
          ),
        ),
        ...(killPromise ? [killPromise] : []),
      ]);

  // If /bot kill fired, exit the turn immediately — don't feed the failed result back to the model.
  if (StreamOrchestrator.hasStopRequest(params.context.channel.id)) {
    return { kind: "abort", status: "stopped_by_user" };
  }

  if (isBlockedByDeliberateAllowlist) {
    log.warn(
      `Deliberate tool mode blocked unexposed tool call "${functionName}" in channel ${params.context.channel.id}. Allowed: ${
        deliberateAllowedSet ? [...deliberateAllowedSet].join(", ") : ""
      }`,
    );
  }
  log.info(`Function call completed: ${functionName} (${Date.now() - startedAt}ms)`);

  if (!toolResult.success) {
    await emitFailedToolCallThoughtLog(toolContext, functionName, functionCall.args ?? {}, toolResult);
  }

  // 2. When deliberate-tool-mode admitted the tool via a specific trigger,
  // post a hidden notice (thought-log only) explaining why it fired.
  const deliberateToolTriggerMatch = params.context.deliberateToolTriggerMatchByToolName.get(functionName);
  if (params.context.deliberateToolModeActive && deliberateToolTriggerMatch && !isBlockedByDeliberateAllowlist) {
    const safeTrigger = deliberateToolTriggerMatch.trigger.replace(/`/g, "'");
    await routeHiddenToolNotice(
      toolContext,
      {
        color: ColorCode.INFO,
        titleKey: "genai.thought_log.title",
        description:
          `Tool \`${functionName}\` was used after deliberate tool mode exposed it.\n` +
          `Trigger: \`${safeTrigger}\`\n` +
          `Source: ${deliberateToolTriggerMatch.source}`,
      },
      "Deliberate tool trigger log",
    );
  }

  if (toolResult.success && handleEnhancedContextRestart(params, toolResult.data)) {
    return { kind: "restart" };
  }

  const functionResponse = toolResult.success
    ? ((toolResult.data as Record<string, unknown>) ?? { status: "completed" })
    : {
        status: "tool_execution_failed",
        reason: toolResult.message || toolResult.error || "Tool execution failed without specific error",
        tool_name: functionName,
      };

  return {
    kind: "history",
    functionName,
    success: toolResult.success,
    endTurn: toolResult.endTurn === true,
    historyEntry: {
      functionCall,
      functionResponse: {
        functionResponse: {
          name: functionName,
          response: { result: functionResponse },
        },
      },
      imageMetadata: toolResult.imageMetadata,
    },
  };
}

async function emitFailedToolCallThoughtLog(
  context: ToolContext,
  functionName: string,
  args: Record<string, unknown>,
  toolResult: ToolResult,
): Promise<void> {
  const noticeContext: ToolContext = {
    ...context,
    suppressProgressNotices: false,
  };

  await routeHiddenToolNotice(
    noticeContext,
    {
      color: ColorCode.ERROR,
      titleKey: "genai.thought_log.title",
      description: buildFailedToolCallDescription(functionName, args, toolResult),
    },
    "Failed tool call thought-log notice",
  );
}

function buildFailedToolCallDescription(
  functionName: string,
  args: Record<string, unknown>,
  toolResult: ToolResult,
): string {
  const reason = toolResult.message || toolResult.error || "Tool execution failed without specific error.";
  const details = safeStringifyToolFailureDetails({
    args,
    data: toolResult.data,
  });
  const lines = [`Tool \`${functionName}\` failed.`, `Reason: ${reason}`];
  if (details) {
    lines.push("", "Details:", codeBlock(truncateToolFailureNotice(details)));
  }

  return lines.join("\n");
}

function safeStringifyToolFailureDetails(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value, null, 2);
    return json === undefined || json === "{}" ? undefined : json;
  } catch {
    return String(value);
  }
}

function truncateToolFailureNotice(value: string): string {
  if (value.length <= TOOL_FAILURE_NOTICE_LIMIT) {
    return value;
  }
  return `${value.slice(0, TOOL_FAILURE_NOTICE_LIMIT - 3)}...`;
}

function codeBlock(value: string): string {
  return `\`\`\`json\n${value.replace(/```/g, "`\u200b``")}\n\`\`\``;
}

function handleEnhancedContextRestart(params: ToolLoopParams, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (!type.startsWith("context_restart_")) return false;

  if (type.includes("message_metadata")) {
    const { annotatedCount, patchedReplyReferenceCount } = annotateRecentMessageMetadataInContext({
      simplifiedMessages: params.context.simplifiedMessages,
      contextSegments: params.context.contextItems,
      messageIdMap: params.context.messageIdMap,
    });
    const metadataActionHint = buildTailDirectiveMessage(buildRevealedMessageMetadataTailDirective());
    if (metadataActionHint) {
      params.context.contextItems.push(metadataActionHint);
    }
    log.info(
      `Recent message metadata reveal annotated ${annotatedCount} message(s) and patched ${patchedReplyReferenceCount} reply reference(s).`,
    );
  }

  const enhancedContextItem = record.enhanced_context_item;
  if (enhancedContextItem && typeof enhancedContextItem === "object") {
    params.context.contextItems.push(enhancedContextItem as ChatTurnContext["contextItems"][number]);
  }
  if (type.includes("youtube")) params.context.streamingContext.disableYouTubeProcessing = true;
  if (type.includes("image")) params.context.streamingContext.disableProfilePictureProcessing = true;
  if (type.includes("gif")) params.context.streamingContext.disableGifProcessing = true;
  if (type.includes("message_metadata")) params.context.streamingContext.disableMessageMetadataContext = true;
  log.info(`Tool requested enhanced-context restart: ${type}`);
  return true;
}

function shouldEndAfterPreToolText(provider: LLMProvider, streamResult: StreamResult, functionName: string): boolean {
  const hasPreToolText = (streamResult.accumulatedText ?? "").trim().length > 0;
  if (!hasPreToolText) return false;
  const providerName = provider.getInfo().name;
  return providerIsApiFamily(providerName, "novelai") || TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT.has(functionName);
}

async function emitToolErrorLoop(context: ChatTurnContext): Promise<void> {
  if (context.isUserImpersonation) {
    throw new Error("User impersonation aborted: model failed too many tool calls in a row.");
  }
  if (!context.shouldSurfaceUserErrors) {
    log.warn(`Suppressing tool error loop embed for non-deliberate chat turn ${context.message.id}`);
    return;
  }
  await sendStandardEmbed(
    context.channel as Parameters<typeof sendStandardEmbed>[0],
    context.locale,
    {
      color: ColorCode.ERROR,
      titleKey: "genai.tool_error_loop_title",
      descriptionKey: "genai.tool_error_loop_description",
      footerKey: "genai.generic_error_footer",
    },
    {
      webhook: context.responseTarget?.webhook,
      personaUsername: context.responseTarget?.personaUsername,
      personaAvatarUrl: context.responseTarget?.personaAvatarUrl,
    },
  );
}

function queueStopResponseIfPresent(context: ChatTurnContext): void {
  const stopContext = StreamOrchestrator.getAndClearStopContext(context.channel.id);
  if (!stopContext) {
    StreamOrchestrator.clearStopRequest(context.channel.id);
    return;
  }

  queueStopResponseAtFront({
    channelId: context.channel.id,
    message: stopContext.originalStopMessage,
    llmOverrideCodename: context.turn.lockedTurn.admission.incoming.llmOverrideCodename,
    selectedPersonaId: context.currentPersona.persona_id ?? undefined,
    textQuotaTriggerKey: context.textQuotaTriggerKey,
    shouldSurfaceUserErrors: true,
  });
}

function buildResult(
  status: GenerationTurnResult["status"],
  context: ChatTurnContext,
  streamResults: StreamResult[],
  responseText: string,
  detailsText: string,
  thoughtLog: GenerationTurnResult["thoughtLog"],
): GenerationTurnResult {
  const text = detailsText.trim()
    ? `${responseText.trim()}\n\n[Scene Metadata]\n${detailsText.trim()}`
    : responseText.trim();
  return {
    status,
    streamResults,
    personaResponses:
      text.length > 0
        ? [
            {
              personaName: context.currentPersona.persona_nickname,
              text,
              personaId: context.currentPersona.persona_id,
              personaLineageId: context.currentPersona.persona_lineage_id,
            },
          ]
        : [],
    thoughtLog,
    thoughtLogOwner: thoughtLog ? resolveThoughtLogOwner(context) : undefined,
  };
}

function resolveThoughtLogOwner(context: ChatTurnContext): GenerationTurnResult["thoughtLogOwner"] {
  if (context.isUserImpersonation) {
    return {
      type: "user_impersonation",
      username: context.responseTarget?.personaUsername ?? "User",
      avatarUrl: context.responseTarget?.personaAvatarUrl,
    };
  }
  return context.currentPersona.is_alter ? { type: "persona", persona: context.currentPersona } : { type: "default" };
}

function mergeDetails(existing: string, incoming: string | undefined): string {
  if (!incoming?.trim()) return existing;
  return existing ? `${existing}\n\n${incoming}` : incoming;
}

function parseIntegerEnvFlag(value: string | undefined, defaultValue: number, minimum: number): number {
  if (typeof value !== "string") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(minimum, parsed);
}
