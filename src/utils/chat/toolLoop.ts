import { buildFailedToolResponse } from "@/utils/tools/toolResult";
import { buildChatPersonaPostContext } from "@/utils/chat/responseEmitter";
import { expandDeliberateToolAllowedNames, isToolAllowedByDeliberateMode } from "@/utils/tools/deliberateToolMode";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import {
  MAX_RESPONSE_REVISIONS,
  reviewResponseCandidate,
  recordResponseReviewUsage,
  remainingPendingResponseLimit,
  reviewToolCandidate,
  toolRequestIdentity,
  responseReviewCancelled,
  responseRevisionInstruction,
} from "@/utils/chat/responseReview";
import { charsToTokensText, estimateContextItemsTokens } from "@/utils/text/tokenEstimate";
import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { ToolRegistry } from "@/tools/toolRegistry";
import { getToolSpriteRoster } from "@/tools/spriteSelection";
import { statRepository } from "@/utils/db/repositories";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { withProviderOptionCopy } from "@/utils/provider/providerOptionRegistry";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { isDirectMessageChannel, resolveProviderErrorFooter } from "@/utils/discord/stream/errorUi";
import { mergeThoughtLogPayloads } from "@/utils/discord/stream/thoughtLog";
import { routeHiddenToolNotice } from "@/utils/discord/toolProgressNotice";
import { ColorCode, log } from "@/utils/misc/logger";
import { providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";
import {
  channelLocks,
  getChannelTurnAbortSignal,
  incrementChannelFollowUpCount,
  queueStopResponseAtFront,
  resetChannelFollowUpCount,
  setChannelActiveToolName,
  setChannelStreamKill,
  setChannelToolCallChainActive,
  runUnderWatchdog,
  touchChannelLock,
} from "@/utils/chat/channelQueue";
import {
  annotateRecentMessageMetadataInContext,
  fetchReactionUserSummaries,
  buildRevealedMessageMetadataTailDirective,
  buildTailDirectiveMessage,
} from "@/utils/chat/contextAnnotations";
import { answersQueuedTriggerMessage } from "@/utils/chat/contextDirectives";
import { takeEnhancedContextItem } from "@/utils/chat/pendingEnhancedContext";
import { foldPrefillIntoToolHistory, insertBeforeNativePrefill } from "@/utils/chat/assistantPrefill";
import { buildExpressionToolResult, deliverExpression } from "@/utils/chat/expressionDelivery";
import { recordChatDiagnostic, runWithChatDiagnosticStage } from "@/utils/chat/diagnosticTimeline";
import { recordChatProviderDispatch } from "@/utils/chat/turnLatency";
import { parseIntegerEnvFlag } from "@/utils/misc/envFlags";
import type { ChatTurnContext, GenerationTurnResult, ToolHistoryEntry } from "@/utils/chat/types";
import { DISCORD_STREAMING_CONSTANTS } from "@/types/stream/types";
import { neutralizeFenceRuns } from "@/utils/text/discordTextLimits";
import { redactToolParametersForStorage } from "@/utils/tools/toolParameterRedaction";
import { getActionSelector } from "@/utils/tools/toolActions";

export const MAX_FUNCTION_CALL_ITERATIONS = 100;
const SOFT_WARN_ITERATION_THRESHOLD = 20;
export const MAX_CONSECUTIVE_TOOL_ERRORS = 5;
const STREAM_SDK_CALL_TIMEOUT_MS = parseIntegerEnvFlag(process.env.STREAM_SDK_CALL_TIMEOUT_MS, 120000, 10000);
const STREAM_FIRST_TOKEN_TIMEOUT_MS = Math.max(
  STREAM_SDK_CALL_TIMEOUT_MS,
  DISCORD_STREAMING_CONSTANTS.FIRST_TOKEN_TIMEOUT_MS,
);
// Bounded wait after watchdog abort so in-flight Discord sends land in `accumulatedText` before fallback builds a
// continuation prefill.
const STREAM_ABANDONED_SETTLE_TIMEOUT_MS = 5000;
const TOOL_EXECUTION_TIMEOUT_MS = parseIntegerEnvFlag(process.env.TOOL_EXECUTION_TIMEOUT_MS, 300000, 10000);
const TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT = new Set(["update_short_term_memory"]);
const TOOL_FAILURE_NOTICE_LIMIT = 1800;
const TOOL_ARGUMENTS_TRUNCATED_REASON =
  "The provider truncated this tool call's arguments mid-payload, so the call was not executed and nothing was updated. Reissue the call with the complete arguments in one message.";

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
  const review = params.context.responseReview;
  const functionHistory: ToolHistoryEntry[] = review?.functionHistory ?? [];
  params.context.streamingContext.deliveryState ??= { unconfirmed: false };
  params.context.completedToolCalls ??= new Map();
  const completedToolCalls = params.context.completedToolCalls;
  // Off keeps ordinary same-invocation replays, so only calls an earlier invocation finished are
  // reused, and the model is told about them because its own history starts empty.
  const reusableToolCalls = review ? completedToolCalls : new Map(completedToolCalls);
  const earlierToolNames = review ? [] : [...new Set([...reusableToolCalls.values()].map((e) => e.functionCall.name))];
  const accumulatedModelParts: Array<Record<string, unknown>> = [];
  let finalText = "";
  let detailsText = "";
  let consecutiveToolErrors = 0;
  let thoughtLog: GenerationTurnResult["thoughtLog"];
  // An expression an earlier attempt of this turn delivered is still visible, so it still counts.
  let toolResponseDelivered = params.context.expressionDelivery.delivered !== null;
  let lastToolName: string | undefined;
  if (params.context.streamingContext.deliveryState.unconfirmed)
    return buildResult(
      "error",
      params.context,
      streamResults,
      finalText,
      detailsText,
      thoughtLog,
      toolResponseDelivered,
    );

  const completeResponse = async (): Promise<GenerationTurnResult | null> => {
    // The send limit is deliberate operator config and stays silent, as it does when streaming.
    const cutByLengthLimit = review?.pending.some(
      (part) => part.truncation === "flush_limit" || part.truncation === "retention_limit",
    );
    if (!review?.pending.some((part) => part.text.trim())) {
      if (cutByLengthLimit) await emitHeldResponseLimitNotice(params.context);
      params.context.streamingContext.holdResponseText = false;
      return buildResult(
        "completed",
        params.context,
        streamResults,
        finalText,
        detailsText,
        thoughtLog,
        toolResponseDelivered,
      );
    }
    if (params.context.streamingContext.deliveryState?.unconfirmed)
      return buildResult(
        "error",
        params.context,
        streamResults,
        finalText,
        detailsText,
        thoughtLog,
        toolResponseDelivered,
      );
    const verdict = await reviewResponseCandidate(params.context, params.provider, params.providerConfig);
    if (verdict.status === "cancelled" || responseReviewCancelled(params.context)) {
      review.pending = [];
      const followUp = StreamOrchestrator.isFollowUpRequest(params.context.channel.id);
      if (followUp) incrementChannelFollowUpCount(params.context.channel.id);
      queueStopResponseIfPresent(params.context);
      return buildResult(
        followUp ? "follow_up_interrupt" : "stopped_by_user",
        params.context,
        streamResults,
        "",
        "",
        thoughtLog,
        toolResponseDelivered,
      );
    }
    if (verdict.status === "revise" && review.revisions < MAX_RESPONSE_REVISIONS) {
      review.feedback = verdict;
      review.revisionDraft = review.pending.map((part) => part.text).join("\n");
      review.revisions++;
      review.pending = [];
      accumulatedModelParts.length = 0;
      detailsText = "";
      return null;
    }
    if (verdict.status === "revise")
      log.info(
        `Response review exhausted ${JSON.stringify({ reviews: review.responseReviews, revisions: review.revisions })}`,
      );
    const delivered: string[] = [];
    let deliveryStatus: GenerationTurnResult["status"] | undefined;
    let replayStopReason: StreamResult["stopReason"];
    for (const pending of review.pending) {
      if (responseReviewCancelled(params.context)) break;
      const presentation = await pending.deliver(getChannelTurnAbortSignal(params.context.channel.id));
      streamResults.push(presentation);
      if (presentation.accumulatedText) delivered.push(presentation.accumulatedText);
      if (presentation.status !== "completed") {
        deliveryStatus = presentation.status;
        replayStopReason = presentation.stopReason;
        break;
      }
    }
    review.pending = [];
    if (responseReviewCancelled(params.context)) {
      const followUp = StreamOrchestrator.isFollowUpRequest(params.context.channel.id);
      deliveryStatus = followUp ? "follow_up_interrupt" : "stopped_by_user";
      if (followUp) incrementChannelFollowUpCount(params.context.channel.id);
      queueStopResponseIfPresent(params.context);
    } else if (cutByLengthLimit && replayStopReason !== "flush_limit") {
      // A replay that reaches the flush cap already posted this notice through ordinary delivery.
      await emitHeldResponseLimitNotice(params.context);
    }
    if (!deliveryStatus && !responseReviewCancelled(params.context))
      params.context.streamingContext.holdResponseText = false;
    finalText = delivered.join("\n");
    return buildResult(
      deliveryStatus ??
        (responseReviewCancelled(params.context)
          ? "stopped_by_user"
          : finalText.trim()
            ? "completed"
            : "empty_response"),
      params.context,
      streamResults,
      finalText,
      finalText.trim() ? detailsText : "",
      thoughtLog,
      toolResponseDelivered,
    );
  };

  for (let iteration = 0; iteration < MAX_FUNCTION_CALL_ITERATIONS; iteration++) {
    if (iteration > 0) {
      recordChatDiagnostic({
        kind: "tool_continuation",
        iteration: iteration + 1,
        historyEntries: functionHistory.length,
        contextItems: params.context.contextItems.length,
      });
    }
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

    const streamResult = await runWithChatDiagnosticStage({ toolIteration: iteration + 1 }, () =>
      streamOnce(params, accumulatedModelParts, functionHistory, earlierToolNames),
    );
    streamResults.push(streamResult);
    if (params.context.streamingContext.deliveryState.unconfirmed) {
      if (review) review.pending = [];
      return buildResult(
        "error",
        params.context,
        streamResults,
        finalText,
        detailsText,
        thoughtLog,
        toolResponseDelivered,
      );
    }

    if (review) {
      // Stopping at the held ceiling skips trailing provider usage, so estimate it here instead of recording the
      // cut pass as free.
      const usage =
        streamResult.usage ??
        (streamResult.pendingResponse?.truncation
          ? {
              inputTokens: estimateContextItemsTokens(params.context.contextItems),
              outputTokens: charsToTokensText(streamResult.pendingResponse.text.length),
            }
          : undefined);
      if (usage)
        recordResponseReviewUsage(review, {
          kind: "author",
          model: params.tomoriState.llm.llm_codename,
          source: streamResult.usage ? "measured" : "estimated",
          usage,
        });
      if (streamResult.pendingResponse) review.pending.push(streamResult.pendingResponse);
    }
    thoughtLog = mergeThoughtLogPayloads(thoughtLog, streamResult.thoughtLog);

    switch (streamResult.status) {
      case "completed":
        resetChannelFollowUpCount(params.context.channel.id);
        finalText = streamResult.accumulatedText ?? finalText;
        detailsText = mergeDetails(detailsText, streamResult.detailsContent);
        {
          const completed = await completeResponse();
          if (completed) return completed;
          continue;
        }
      case "error":
      case "timeout":
        resetChannelFollowUpCount(params.context.channel.id);
        // Partial text stays in the channel for a fallback to continue, so short-term memory keeps it.
        return buildResult(
          streamResult.status,
          params.context,
          streamResults,
          joinDeliveredText(streamResults),
          mergeDetails(detailsText, streamResult.detailsContent),
          thoughtLog,
          toolResponseDelivered,
        );
      case "empty_response": {
        if (review?.pending.some((part) => part.text.trim())) {
          const completed = await completeResponse();
          if (completed) return completed;
          continue;
        }
        // After delivered text, skip the turn-level retry only when the empty follow-up means nothing remains to
        // add (avoiding a duplicate reply).
        const deliveredText = streamResults.findLast((result) => result.accumulatedText?.trim())?.accumulatedText;
        if (
          (deliveredText || toolResponseDelivered) &&
          (await isSettledAfterTool(params, streamResult, lastToolName))
        ) {
          resetChannelFollowUpCount(params.context.channel.id);
          return buildResult(
            "completed",
            params.context,
            streamResults,
            deliveredText ?? finalText,
            detailsText,
            thoughtLog,
            toolResponseDelivered,
          );
        }
        return buildResult(
          "empty_response",
          params.context,
          streamResults,
          finalText,
          detailsText,
          thoughtLog,
          toolResponseDelivered,
        );
      }
      case "stopped_by_user":
        queueStopResponseIfPresent(params.context);
        resetChannelFollowUpCount(params.context.channel.id);
        // Text already delivered before the stop still has to reach short-term memory, or Tomori
        // forgets what it just said in the channel whenever a turn is cut short.
        finalText = streamResult.accumulatedText ?? finalText;
        detailsText = mergeDetails(detailsText, streamResult.detailsContent);
        return buildResult(
          "stopped_by_user",
          params.context,
          streamResults,
          finalText,
          detailsText,
          thoughtLog,
          toolResponseDelivered,
        );
      case "follow_up_interrupt":
        incrementChannelFollowUpCount(params.context.channel.id);
        return buildResult(
          "follow_up_interrupt",
          params.context,
          streamResults,
          finalText,
          detailsText,
          thoughtLog,
          toolResponseDelivered,
        );
      case "function_call": {
        detailsText = mergeDetails(detailsText, streamResult.detailsContent);
        setChannelToolCallChainActive(channelLocks.get(params.context.turn.lockedTurn.channelId), true);
        const toolOutcome = await executeToolCall(params, streamResult, iteration, reusableToolCalls);
        if (params.context.streamingContext.deliveryState.unconfirmed) {
          if (review) review.pending = [];
          return buildResult(
            "error",
            params.context,
            streamResults,
            finalText,
            detailsText,
            thoughtLog,
            toolResponseDelivered,
          );
        }

        recordChatDiagnostic({
          kind: "tool_outcome",
          outcome: toolOutcome.kind,
          ...(toolOutcome.kind === "history"
            ? { success: toolOutcome.success, reviewStatus: toolOutcome.reviewStatus }
            : {}),
        });
        if (toolOutcome.kind === "restart") {
          consecutiveToolErrors = 0;
          continue;
        }
        if (toolOutcome.kind === "abort") {
          if (review) review.pending = [];
          if (toolOutcome.status === "follow_up_interrupt") incrementChannelFollowUpCount(params.context.channel.id);
          if (toolOutcome.status === "stopped_by_user") {
            // A /kill that exits here was never consumed by the stream's own stop check, and an
            // unconsumed request aborts the channel's next turn at its pre-stream check.
            queueStopResponseIfPresent(params.context);
            resetChannelFollowUpCount(params.context.channel.id);
          }
          return buildResult(
            toolOutcome.status,
            params.context,
            streamResults,
            finalText,
            detailsText,
            thoughtLog,
            toolResponseDelivered,
          );
        }

        functionHistory.push(toolOutcome.historyEntry);
        lastToolName = toolOutcome.functionName;
        toolResponseDelivered ||= toolOutcome.responseDelivered;
        // Clear buffered parts already saved on the history entry so providers do not receive pre-tool text twice.
        accumulatedModelParts.length = 0;
        if (toolOutcome.success) {
          consecutiveToolErrors = 0;
        } else if (toolOutcome.reviewStatus !== "rejected") {
          consecutiveToolErrors += 1;
          if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
            await emitToolErrorLoop(params.context);
            return buildResult(
              "error",
              params.context,
              streamResults,
              finalText,
              detailsText,
              thoughtLog,
              toolResponseDelivered,
            );
          }
        }

        if (toolOutcome.endTurn) {
          if (review) {
            const completed = await completeResponse();
            if (completed) return completed;
            continue;
          }
          return buildResult(
            "completed",
            params.context,
            streamResults,
            streamResult.accumulatedText ?? finalText,
            detailsText,
            thoughtLog,
            toolResponseDelivered,
          );
        }

        if (
          toolOutcome.success &&
          (await shouldEndAfterPreToolText(streamResult, toolOutcome.functionName, params.tomoriState.server_id))
        ) {
          if (review) {
            const completed = await completeResponse();
            if (completed) return completed;
            continue;
          }
          return buildResult(
            "completed",
            params.context,
            streamResults,
            streamResult.accumulatedText ?? finalText,
            detailsText,
            thoughtLog,
            toolResponseDelivered,
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
      tipKeys: await withProviderOptionCopy(["genai.tips.refresh_context"], {
        surface: "recovery",
        managedProvider: params.context.usageContext?.credentialProvider ?? null,
        userDiscId: params.context.userDiscId,
        serverId: params.context.tomoriState.server_id,
        credentialScope:
          params.context.usageContext?.credentialScope ??
          (params.context.textCredentialSource === "personal"
            ? "personal"
            : params.context.textCredentialSource === "server"
              ? "server"
              : undefined),
      }),
    });
  }
  return buildResult(
    "timeout",
    params.context,
    streamResults,
    finalText,
    detailsText,
    thoughtLog,
    toolResponseDelivered,
  );
}

// Suppressed attempts defer this notice to the generation-turn loop because only it knows whether the model fallback
// ever materialized.
export async function sendStreamTimeoutNotice(params: {
  channel: Parameters<typeof sendStandardEmbed>[0];
  locale: string;
  providerName: string;
  textCredentialSource: ChatTurnContext["textCredentialSource"] | undefined;
  sawStreamProgress: boolean;
  managedProvider: string | null;
  credentialScope: "server" | "personal" | undefined;
  userDiscId: string;
  serverId: number | undefined;
}): Promise<void> {
  await sendStandardEmbed(params.channel, params.locale, {
    titleKey: "genai.stream.inactivity_timeout_title",
    descriptionKey: params.sawStreamProgress
      ? "genai.stream.inactivity_timeout_description"
      : "genai.stream.first_token_timeout_description",
    color: ColorCode.WARN,
    tipKeys: await withProviderOptionCopy(
      params.providerName === "nvidia"
        ? [
            params.textCredentialSource === "personal"
              ? "genai.tips.nvidia_register_free_model_personal"
              : "genai.tips.nvidia_register_free_model",
          ]
        : [],
      {
        surface: "recovery",
        managedProvider: params.managedProvider,
        userDiscId: params.userDiscId,
        serverId: params.serverId,
        credentialScope: params.credentialScope,
      },
    ),
    ...resolveProviderErrorFooter({
      providerName: params.providerName,
      textCredentialSource: params.textCredentialSource,
      isDM: isDirectMessageChannel(params.channel),
    }),
  }).catch((embedError) => {
    log.warn(
      "Failed to send SDK call timeout embed",
      embedError instanceof Error ? embedError : new Error(String(embedError)),
    );
  });
}

async function streamOnce(
  params: ToolLoopParams,
  accumulatedModelParts: Array<Record<string, unknown>>,
  functionHistory: ToolHistoryEntry[],
  earlierToolNames: string[],
): Promise<StreamResult> {
  const channelId = params.context.channel.id;
  const abortController = new AbortController();
  params.context.streamingContext.abortSignal = abortController.signal;
  // A notice held by an earlier attempt describes that attempt, not this one.
  params.context.streamingContext.deferredTimeoutNotice = undefined;
  params.context.streamingContext.pendingResponseLimit = params.context.responseReview
    ? remainingPendingResponseLimit(params.context.responseReview)
    : undefined;
  let timeoutId: NodeJS.Timeout | null = null;

  // Aborts the HTTP request and rejects Promise.race so /kill and stale-lock release stop stalled streams externally.
  let killStream: ((reason: Error) => void) | null = null;

  const armTimeout = (budgetMs: number) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      killStream?.(new Error("SDK_CALL_TIMEOUT: provider streamToDiscord call timed out."));
    }, budgetMs);
    touchChannelLock(channelId);
  };
  let sawStreamProgress = false;
  let recordFirstChunk: (() => void) | undefined;
  params.context.streamingContext.onStreamProgress = () => {
    if (!sawStreamProgress) {
      recordFirstChunk?.();
      recordChatDiagnostic({ kind: "provider_first_chunk" });
    }
    sawStreamProgress = true;
    armTimeout(STREAM_SDK_CALL_TIMEOUT_MS);
  };
  armTimeout(STREAM_FIRST_TOKEN_TIMEOUT_MS);

  const replyToMessage = answersQueuedTriggerMessage(params.context.turn.lockedTurn.admission.incoming)
    ? params.context.message
    : undefined;

  const correction = params.context.responseReview && responseRevisionInstruction(params.context.responseReview);
  const preToolNarration = functionHistory.some((entry) => entry.preToolCallTextParts?.length)
    ? {
        role: "user" as const,
        parts: [
          {
            type: "text" as const,
            text: params.context.responseReview
              ? "[System: The text you wrote before calling a tool has not been sent yet. It will be posted together with what you write next, so continue without repeating it.]"
              : "[System: Your text before the tool call has already been sent to the conversation. Continue from where it ended without repeating it. If your reply is complete, finish without additional text.]",
          },
        ],
      }
    : undefined;
  const earlierToolNotice =
    earlierToolNames.length > 0
      ? {
          role: "user" as const,
          parts: [
            {
              type: "text" as const,
              text: `[System: An earlier attempt at this turn already completed these tool calls, so their effects have happened: ${earlierToolNames.join(", ")}. Do not repeat them; an identical call returns its recorded result.]`,
            },
          ],
        }
      : undefined;
  const outputPrefill = params.context.streamingContext.outputPrefill;
  let requestItems = params.context.contextItems;
  for (const item of [earlierToolNotice, preToolNarration, correction]) {
    if (item) requestItems = insertBeforeNativePrefill(requestItems, outputPrefill, item);
  }
  const request = foldPrefillIntoToolHistory(requestItems, outputPrefill, functionHistory);
  params.context.streamingContext.personaSprites = getToolSpriteRoster(
    request.contextItems,
    params.tomoriState.persona_id,
  );
  recordFirstChunk = recordChatProviderDispatch(params.tomoriState.llm.llm_provider);
  // Hold `streamPromise` so timeout recovery can await its settle; Promise.race still observes any rejection.
  const streamPromise = params.provider.streamToDiscord(
    params.context.channel as Parameters<LLMProvider["streamToDiscord"]>[0],
    params.context.client,
    params.tomoriState,
    params.providerConfig,
    request.contextItems,
    accumulatedModelParts,
    params.context.emojiStrings,
    request.functionHistory.length > 0 ? request.functionHistory : undefined,
    undefined,
    replyToMessage,
    params.context.streamingContext,
    params.context.locale,
    params.context.responseTarget?.webhook,
    params.context.responseTarget?.personaAvatarUrl,
    params.context.responseTarget?.personaUsername,
    params.context.responseTarget?.prefixStrippingName,
  );

  try {
    const result = await runUnderWatchdog(channelId, () =>
      Promise.race([
        streamPromise,
        new Promise<never>((_, reject) => {
          killStream = (reason: Error) => {
            abortController.abort();
            reject(reason);
          };
          setChannelStreamKill(channelId, killStream);
        }),
      ]),
    );
    // Leaving the chunk loop closes the provider generator, but an adapter that does not cancel its
    // reader on early return would keep the request generating text nobody can deliver.
    if (result.stopReason === "pending_response_limit") abortController.abort();
    return result.status === "stopped_by_user" && sawStreamProgress ? { ...result, answeredBeforeStop: true } : result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SDK_CALL_TIMEOUT:")) {
      // Return immediately on a pending stop (such as /kill) because no fallback runs to continue in-flight
      // sends.
      if (StreamOrchestrator.hasStopRequest(channelId)) {
        const settled = params.context.responseReview ? await settleAbandonedStream(streamPromise) : undefined;
        return {
          status: "stopped_by_user",
          usage: settled?.usage,
          ...(sawStreamProgress ? { answeredBeforeStop: true } : {}),
        };
      }

      const providerName = params.tomoriState.llm.llm_provider;
      const phase = sawStreamProgress ? "idle" : "first_token";
      log.metric("stream_sdk_timeout", { provider: providerName, phase });
      log.warn(
        `Stream SDK call timed out (${providerName}, ${phase}): ${error.message.slice("SDK_CALL_TIMEOUT:".length).trim()}`,
      );

      // Genuine timeout, so a fallback may continue this stream's text: wait (bounded) for the
      // aborted stream to settle so a send it already dispatched is in the `accumulatedText` it reads.
      const settled = await settleAbandonedStream(streamPromise);
      if (params.context.streamingContext.deliveryState?.unconfirmed) return settled ?? { status: "error" };

      if (!params.context.streamingContext.suppressUserErrors) {
        await sendStreamTimeoutNotice({
          channel: params.context.channel as Parameters<typeof sendStandardEmbed>[0],
          locale: params.context.locale,
          providerName,
          textCredentialSource: params.context.streamingContext.textCredentialSource,
          sawStreamProgress,
          managedProvider: params.context.usageContext?.credentialProvider ?? null,
          credentialScope:
            params.context.usageContext?.credentialScope ??
            (params.context.textCredentialSource === "personal"
              ? "personal"
              : params.context.textCredentialSource === "server"
                ? "server"
                : undefined),
          userDiscId: params.context.userDiscId,
          serverId: params.context.tomoriState.server_id,
        });
      } else {
        // The notice is held for the caller: this attempt was suppressed because a later model may
        // still answer, and only the caller knows whether one did.
        params.context.streamingContext.deferredTimeoutNotice = { providerName, sawStreamProgress };
      }
      return {
        status: "timeout",
        data: error,
        accumulatedText: settled?.accumulatedText,
        detailsContent: settled?.detailsContent,
        spritesShown: settled?.spritesShown,
        usage: settled?.usage,
      };
    }
    if (params.context.responseReview && StreamOrchestrator.hasStopRequest(channelId)) {
      const settled = await settleAbandonedStream(streamPromise);
      return {
        status: "stopped_by_user",
        usage: settled?.usage,
        ...(sawStreamProgress ? { answeredBeforeStop: true } : {}),
      };
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    params.context.streamingContext.onStreamProgress = undefined;
    setChannelStreamKill(channelId, null);
  }
}

// A bounded settle wait is required so mid-flight Discord sends join delivered text for fallback continuation without
// blocking on hung sends.
async function settleAbandonedStream(streamPromise: Promise<StreamResult>): Promise<StreamResult | undefined> {
  if (STREAM_ABANDONED_SETTLE_TIMEOUT_MS <= 0) {
    return;
  }
  let guardTimer: ReturnType<typeof setTimeout> | null = null;
  const settleGuard = new Promise<undefined>((resolve) => {
    guardTimer = setTimeout(() => resolve(undefined), STREAM_ABANDONED_SETTLE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      streamPromise.then(
        (result) => result,
        () => undefined,
      ),
      settleGuard,
    ]);
  } finally {
    if (guardTimer) clearTimeout(guardTimer);
  }
}

async function executeToolCall(
  params: ToolLoopParams,
  streamResult: StreamResult,
  iteration: number,
  reusableToolCalls: Map<string, ToolHistoryEntry>,
): Promise<
  | { kind: "restart" }
  | { kind: "abort"; status: GenerationTurnResult["status"] }
  | {
      kind: "history";
      functionName: string;
      success: boolean;
      reviewStatus?: "rejected" | "reused";
      endTurn: boolean;
      responseDelivered: boolean;
      historyEntry: ToolHistoryEntry;
    }
> {
  if (!streamResult.data || typeof streamResult.data !== "object" || !("name" in streamResult.data)) {
    log.error("Function call status received without function-call data", streamResult);
    return { kind: "abort", status: "error" };
  }

  const rawCall = streamResult.data as ToolHistoryEntry["functionCall"];
  const functionCall = params.context.responseReview ? structuredClone(rawCall) : rawCall;
  let functionName = functionCall.name?.trim() ?? "";
  if (!functionName) {
    return { kind: "abort", status: "error" };
  }

  const cancelReviewedCall = () => {
    if (params.context.responseReview) params.context.responseReview.pending = [];
    return {
      kind: "abort" as const,
      status: StreamOrchestrator.isFollowUpRequest(params.context.channel.id)
        ? ("follow_up_interrupt" as const)
        : ("stopped_by_user" as const),
    };
  };
  if (params.context.responseReview && responseReviewCancelled(params.context)) return cancelReviewedCall();
  if (shouldAbortToolCallForStopRequest(params.context.channel.id)) {
    return { kind: "abort", status: "stopped_by_user" };
  }

  const turnAbortSignal = getChannelTurnAbortSignal(params.context.channel.id);
  const toolContext: ToolContext = {
    memoryEmbeddingResolved: params.context.memoryRecall?.embeddingResolved,
    channel: params.context.channel as ToolContext["channel"],
    client: params.context.client,
    message: params.context.message,
    // A Ping User's tools act for the member it addresses, so a reminder or memory defaults to them.
    userId:
      params.context.turn.lockedTurn.admission.incoming.naturalNudge?.targetUserDiscId ?? params.context.userDiscId,
    internalUserId: params.context.personalRoutingUserId ?? undefined,
    borrowsTriggerMessage: params.context.turn.lockedTurn.admission.incoming.borrowsTriggerMessage,
    guildId: params.context.guild?.id,
    tomoriState: params.tomoriState,
    locale: params.context.locale,
    provider: params.provider.getInfo().name,
    usageContext: params.context.usageContext,
    streamContext: params.context.streamingContext,
    webhook: params.context.responseTarget?.webhook,
    personaUsername: params.context.responseTarget?.personaUsername,
    personaAvatarUrl: params.context.responseTarget?.personaAvatarUrl,
    activePersonaId: params.context.currentPersona.persona_id ?? undefined,
    isUserImpersonation: params.context.isUserImpersonation,
    impersonatedUserId: params.context.impersonatedUserId,
    suppressProgressNotices: !params.context.shouldSurfaceUserErrors || undefined,
    mirrorSuppressedProgressNotices: true,
    contextItems: params.context.contextItems,
    messageIdMap: params.context.messageIdMap,
    showKillHint: iteration >= SOFT_WARN_ITERATION_THRESHOLD,
    abortSignal: turnAbortSignal,
    isExecutionCancelled: params.context.responseReview ? () => responseReviewCancelled(params.context) : undefined,
  };

  const families: Record<string, string> = {};
  const requestedNames = params.context.streamingContext.deliberateToolAllowedNames;
  if (
    params.context.deliberateToolModeActive &&
    requestedNames?.some((name) => name === "fetch_url" || name === "web_search") &&
    params.tomoriState.server_id
  ) {
    try {
      const { routes } = await getGuildMcpManager().getGuildMCPRouting(params.tomoriState.server_id);
      for (const [name, route] of routes) families[name] = route.config.server_type ?? "general";
    } catch {
      // Execution refuses unreadable registrations; an unavailable service grants no extra intent.
    }
  }
  const allowedNames = expandDeliberateToolAllowedNames(requestedNames, families);
  const isBlockedByDeliberateAllowlist =
    params.context.deliberateToolModeActive && !isToolAllowedByDeliberateMode(functionName, allowedNames);

  // Never dispatch truncated args because partial subsets on state-replacing tools silently drop omitted keys.
  if (functionCall.argumentsTruncated) {
    // Log at error level because `log.warn` is suppressed when RUN_ENV=production, where argument truncation
    // occurs.
    await log.error(
      `Tool call "${functionName}" was not dispatched: the provider truncated its argument payload`,
      undefined,
      {
        serverId: params.tomoriState.server_id,
        errorType: "TOOL_ARGUMENTS_TRUNCATED",
        metadata: {
          channelId: params.context.channel.id,
          recoveredKeys: Object.keys(functionCall.args ?? {}).length,
        },
      },
    );
    // The recovered subset is not a meaningful call, so it is dropped from the replayed
    // assistant turn rather than shown to the model as the arguments it produced.
    functionCall.args = undefined;
    const refusal: ToolResult = { success: false, error: TOOL_ARGUMENTS_TRUNCATED_REASON };
    // The ordinary failure path emits this notice, and a refusal that returns before it
    // would otherwise leave the truncation invisible in the thought log.
    await emitFailedToolCallThoughtLog(toolContext, functionName, {}, refusal);
    return {
      kind: "history",
      functionName,
      success: false,
      endTurn: false,
      responseDelivered: false,
      historyEntry: {
        functionCall,
        functionResponse: {
          functionResponse: {
            name: functionName,
            response: {
              result: {
                status: "tool_execution_failed",
                tool_name: functionName,
                reason: TOOL_ARGUMENTS_TRUNCATED_REASON,
              },
            },
          },
        },
        preToolCallTextParts: buildPreToolCallTextParts(streamResult),
      },
    };
  }

  let executionArgs = functionCall.args ?? {};
  let requestIdentity: string | undefined;
  const review = params.context.responseReview;
  const reusedOutcome = (completed: ToolHistoryEntry) => ({
    kind: "history" as const,
    functionName,
    success: true,
    reviewStatus: "reused" as const,
    endTurn: false,
    responseDelivered: false,
    historyEntry: {
      ...completed,
      functionCall,
      functionResponse: {
        functionResponse: {
          ...(completed.functionResponse.functionResponse as Record<string, unknown>),
          name: functionCall.name,
        },
      },
      preToolCallTextParts: buildPreToolCallTextParts(streamResult),
    },
  });
  if (!review && !isBlockedByDeliberateAllowlist) {
    // Only the identity is taken: Off still executes the call as the model wrote it.
    const prepared = await ToolRegistry.prepareToolRequest(functionName, executionArgs, toolContext);
    requestIdentity = toolRequestIdentity(prepared);
    const completed = reusableToolCalls.get(requestIdentity);
    if (completed) return reusedOutcome(completed);
  }
  if (review && !isBlockedByDeliberateAllowlist) {
    const prepared = await runUnderWatchdog(params.context.channel.id, () =>
      ToolRegistry.prepareToolRequest(functionName, executionArgs, toolContext),
    );
    if (responseReviewCancelled(params.context)) return cancelReviewedCall();
    functionName = prepared.name;
    executionArgs = prepared.args;
    toolContext.preparedToolRequest = prepared;
    requestIdentity = toolRequestIdentity(prepared);
    const completed = reusableToolCalls.get(requestIdentity);
    if (completed) return reusedOutcome(completed);
    const tool = ToolRegistry.getTool(functionName);
    const available =
      !tool ||
      ToolRegistry.getAvailableTools(toolContext.provider, toolContext).some(
        (entry) =>
          entry.name === functionName &&
          (!entry.withActions ||
            (typeof executionArgs.action === "string" &&
              entry.parameters.properties.action?.enum?.includes(executionArgs.action))),
      );
    if (available && review.reviewItems.includes("tools")) {
      const verdict = await reviewToolCandidate(params.context, params.provider, params.providerConfig, prepared);
      if (verdict.status === "cancelled" || responseReviewCancelled(params.context)) return cancelReviewedCall();
      if (verdict.status === "revise") {
        return {
          kind: "history",
          functionName,
          success: false,
          reviewStatus: "rejected",
          endTurn: verdict.futile,
          responseDelivered: false,
          historyEntry: {
            functionCall,
            functionResponse: {
              functionResponse: {
                name: functionCall.name,
                response: {
                  result: {
                    status: "review_rejected",
                    findings: verdict.findings,
                    actionExecuted: false,
                    correctionAllowed: verdict.correctionAllowed,
                    reason: verdict.correctionAllowed
                      ? "The action has not happened. Correct the proposal once or continue using available results. Identical rejected requests will not execute."
                      : "The action has not happened and no correction remains for it. Do not propose it again in any form; repeating it ends your turn. Other actions, including different calls of this tool, remain available.",
                  },
                },
              },
            },
            preToolCallTextParts: buildPreToolCallTextParts(streamResult),
          },
        };
      }
    }
  }
  if (review && responseReviewCancelled(params.context)) return cancelReviewedCall();

  const startedAt = Date.now();

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

  const executedResult: ToolResult = isBlockedByDeliberateAllowlist
    ? {
        success: false,
        error: `Tool "${functionName}" was not exposed for this deliberate tool mode turn.`,
        data: {
          status: "blocked_by_deliberate_tool_mode",
          functionName,
          allowedToolNames: allowedNames ?? [],
        },
      }
    : await runUnderWatchdog(params.context.channel.id, () => {
        setChannelActiveToolName(params.context.channel.id, functionName);
        return Promise.race([
          ToolRegistry.executeTool(functionName, executionArgs, toolContext),
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
        ]).finally(() => setChannelActiveToolName(params.context.channel.id, undefined));
      });

  if (review && responseReviewCancelled(params.context)) return cancelReviewedCall();

  // If /kill fired, exit the turn immediately; don't feed the failed result back to the model.
  if (shouldAbortToolCallForStopRequest(params.context.channel.id)) {
    return { kind: "abort", status: "stopped_by_user" };
  }

  // The send is awaited outside the timeout and kill race above, so Discord's verdict is always
  // known before history is built and a stop can never leave an accepted send unrecorded.
  let toolResult = executedResult;
  const stickerSelection = executedResult.success ? executedResult.stickerSelection : undefined;
  if (stickerSelection) {
    const stickerName = (executedResult.data as { sticker_name?: string } | undefined)?.sticker_name ?? "";
    const delivery = await runUnderWatchdog(params.context.channel.id, () =>
      deliverExpression(
        params.context,
        stickerSelection,
        stickerName,
        () => turnAbortSignal?.aborted === true || shouldAbortToolCallForStopRequest(params.context.channel.id),
      ),
    );
    if (delivery.status === "cancelled") return { kind: "abort", status: "stopped_by_user" };
    toolResult = buildExpressionToolResult(delivery, stickerName);
  }

  if (
    !toolResult.success &&
    (toolResult.data as { deliveryStatus?: unknown } | undefined)?.deliveryStatus === "unconfirmed"
  ) {
    params.context.streamingContext.deliveryState ??= { unconfirmed: false };
    params.context.streamingContext.deliveryState.unconfirmed = true;
  }
  if (params.context.streamingContext.deliveryState?.unconfirmed) return { kind: "abort", status: "error" };

  if (isBlockedByDeliberateAllowlist) {
    log.warn(
      `Deliberate tool mode blocked unexposed tool call "${functionName}" in channel ${params.context.channel.id}. Allowed: ${
        allowedNames?.join(", ") ?? ""
      }`,
    );
  }
  log.info(`Function call completed: ${functionName} (${Date.now() - startedAt}ms)`);

  // Record tool_used fire-and-forget here for all built-in/REST/MCP tools, skipping DMs because
  // stat_counters.server_id is NOT NULL.
  if (toolResult.success && !isBlockedByDeliberateAllowlist && !params.context.isDMChannel) {
    const serverId = params.tomoriState.server_id;
    const userId = params.context.triggererUserId;
    if (serverId && userId) {
      const lineageId = params.context.currentPersona.persona_lineage_id ?? params.tomoriState.persona_lineage_id ?? 0;
      // `sticker_used` is recorded in `deliverExpression` at Discord acceptance rather than here because a repeat
      // call can send nothing.
      try {
        statRepository.recordStat({
          serverId,
          userId,
          lineageId,
          metric: "tool_used",
          metricKey: functionName,
        });
      } catch (statError) {
        log.warn(`Failed to record tool_used stat for ${functionName}: ${statError}`);
      }
    }
  }

  if (!toolResult.success) {
    await emitFailedToolCallThoughtLog(
      toolContext,
      functionName,
      redactToolParametersForStorage(functionName, functionCall.args ?? {}),
      toolResult,
    );
  }

  const action = executionArgs.action;
  const deliberateToolTriggerMatch =
    params.context.deliberateToolModeActive && !isBlockedByDeliberateAllowlist
      ? Array.from(params.context.deliberateToolTriggerMatchByToolName.values()).find(({ toolName }) => {
          const selector = getActionSelector(toolName);
          if (!selector) return toolName === functionName;
          return selector.name === functionName && typeof action === "string" && selector.actions.includes(action);
        })
      : undefined;
  if (deliberateToolTriggerMatch) {
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

  if (toolResult.success && (await handleEnhancedContextRestart(params, toolResult.data))) {
    if (params.context.responseReview)
      params.context.responseReview.functionHistory.push({
        functionCall,
        functionResponse: buildSuccessfulFunctionResponse(toolResult, functionCall.name),
        preToolCallTextParts: buildPreToolCallTextParts(streamResult),
      });
    return { kind: "restart" };
  }

  // Recorded after the restart guard: a restart result only means something while its injected media
  // is in context, and a replacement attempt rebuilds context without it.
  if (requestIdentity && toolResult.success)
    params.context.completedToolCalls?.set(requestIdentity, {
      functionCall,
      functionResponse: buildSuccessfulFunctionResponse(toolResult, functionCall.name),
      imageMetadata: toolResult.imageMetadata,
    });

  if (functionName === "update_short_term_memory" && toolResult.success) {
    params.context.streamingContext.disableShortTermMemoryUpdate = true;
    log.info("Short-term memory updated; disabling further STM calls for this turn");
  }

  const functionResponse = toolResult.success
    ? buildSuccessfulFunctionResponse(toolResult, functionCall.name)
    : {
        functionResponse: {
          name: functionCall.name,
          response: {
            result: buildFailedToolResponse(toolResult, functionName),
          },
        },
      };

  const preToolCallTextParts = buildPreToolCallTextParts(streamResult);
  if (preToolCallTextParts) {
    log.info(
      `Preserving ${preToolCallTextParts.length} pre-tool-call text part(s) in function history to prevent repetition`,
    );
  }

  return {
    kind: "history",
    functionName,
    success: toolResult.success,
    endTurn: toolResult.endTurn === true,
    responseDelivered: toolResult.success && toolResult.responseDelivered === true,
    historyEntry: {
      functionCall,
      functionResponse,
      imageMetadata: toolResult.imageMetadata,
      preToolCallTextParts,
    },
  };
}

function buildSuccessfulFunctionResponse(toolResult: ToolResult, functionName: string): Record<string, unknown> {
  const response: Record<string, unknown> = { result: toolResult.data ?? { status: "completed" } };
  if (toolResult.message) response.message = toolResult.message;
  return { functionResponse: { name: functionName, response } };
}

function buildPreToolCallTextParts(streamResult: StreamResult): Array<Record<string, unknown>> | undefined {
  const text = streamResult.pendingResponse?.text ?? streamResult.accumulatedText;
  return text?.trim() ? [{ type: "text", text }] : undefined;
}

async function emitFailedToolCallThoughtLog(
  context: ToolContext,
  functionName: string,
  args: Record<string, unknown>,
  toolResult: ToolResult,
): Promise<void> {
  await routeHiddenToolNotice(
    context,
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
  return `\`\`\`json\n${neutralizeFenceRuns(value)}\n\`\`\``;
}

async function handleEnhancedContextRestart(params: ToolLoopParams, data: unknown): Promise<boolean> {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (!type.startsWith("context_restart_")) return false;

  if (type.includes("message_metadata")) {
    const { turn } = params.context;
    const reactionUsersByMessageId = await fetchReactionUserSummaries(params.context.reactedMessages, {
      clientUserId: params.context.client.user?.id,
      mainPersonaNickname: turn.mainPersona?.persona_nickname ?? turn.persona.persona_nickname,
    });
    const { annotatedCount, patchedReplyReferenceCount } = annotateRecentMessageMetadataInContext({
      simplifiedMessages: params.context.simplifiedMessages,
      contextSegments: params.context.contextItems,
      messageIdMap: params.context.messageIdMap,
      reactionUsersByMessageId,
    });
    const metadataActionHint = buildTailDirectiveMessage(buildRevealedMessageMetadataTailDirective());
    if (metadataActionHint) {
      params.context.contextItems.push(metadataActionHint);
    }
    log.info(
      `Recent message metadata reveal annotated ${annotatedCount} message(s), named reactors on ${reactionUsersByMessageId.size}, and patched ${patchedReplyReferenceCount} reply reference(s).`,
    );
  }

  const enhancedContextItem = resolveEnhancedContextItem(record, type);
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

function resolveEnhancedContextItem(record: Record<string, unknown>, type: string): unknown {
  const pendingContextKey = typeof record.pending_context_key === "string" ? record.pending_context_key : undefined;
  if (!pendingContextKey) return record.enhanced_context_item;

  const stashedItem = takeEnhancedContextItem(pendingContextKey);
  if (!stashedItem) {
    log.warn(
      `Enhanced-context restart '${type}' referenced pending key ${pendingContextKey}, but no payload was stashed. The enriched media will be missing from this turn.`,
    );
  }
  return stashedItem ?? record.enhanced_context_item;
}

async function shouldEndAfterPreToolText(
  streamResult: StreamResult,
  functionName: string,
  serverId: number | undefined,
): Promise<boolean> {
  const hasPreToolText = (streamResult.accumulatedText ?? "").trim().length > 0;
  if (!hasPreToolText) return false;
  if (!TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT.has(functionName)) return false;
  if (functionName === "update_short_term_memory") return true;
  return !(await ToolRegistry.requiresFollowUp(functionName, serverId));
}

// Held NovelAI fragments, token-cap truncations, speaker-guard discards, and follow-up tools return false because a
// retry or follow-up must recover them.
async function isSettledAfterTool(
  params: ToolLoopParams,
  emptyResult: StreamResult,
  lastToolName: string | undefined,
): Promise<boolean> {
  if (!lastToolName) return false;
  const data = emptyResult.data as { finishReason?: unknown; emptyResponseReason?: unknown } | undefined;
  if (data?.finishReason === "length" || data?.emptyResponseReason) return false;
  return !(await ToolRegistry.requiresFollowUp(lastToolName, params.tomoriState.server_id));
}

function shouldAbortToolCallForStopRequest(channelId: string): boolean {
  if (!StreamOrchestrator.hasStopRequest(channelId)) return false;
  if (!StreamOrchestrator.isFollowUpRequest(channelId)) return true;

  log.info(
    `Follow-up request found during tool execution for channel ${channelId}. Clearing interrupt to preserve tool chain progress — follow-up is queued.`,
  );
  StreamOrchestrator.clearStopRequest(channelId);
  return false;
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
      tipKeys: await withProviderOptionCopy(["genai.tips.refresh_context"], {
        surface: "recovery",
        managedProvider: context.usageContext?.credentialProvider ?? null,
        userDiscId: context.userDiscId,
        serverId: context.tomoriState.server_id,
        credentialScope:
          context.usageContext?.credentialScope ??
          (context.textCredentialSource === "personal"
            ? "personal"
            : context.textCredentialSource === "server"
              ? "server"
              : undefined),
      }),
    },
    buildChatPersonaPostContext(context),
  );
}

async function emitHeldResponseLimitNotice(context: ChatTurnContext): Promise<void> {
  if (!context.shouldSurfaceUserErrors) return;
  await sendStandardEmbed(
    context.channel as Parameters<typeof sendStandardEmbed>[0],
    context.locale,
    {
      color: ColorCode.WARN,
      titleKey: "genai.stream.flush_limit_title",
      descriptionKey: "genai.stream.flush_limit_description",
    },
    buildChatPersonaPostContext(context),
  ).catch((embedError) => {
    log.warn(
      "Failed to send held response limit notice",
      embedError instanceof Error ? embedError : new Error(String(embedError)),
    );
  });
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

// Exact separator that prependDeliveredOutput splits composed responses on, so changing this string breaks response
// splitting.
const SCENE_METADATA_SEPARATOR = "\n\n[Scene Metadata]\n";

function buildResult(
  status: GenerationTurnResult["status"],
  context: ChatTurnContext,
  streamResults: StreamResult[],
  responseText: string,
  detailsText: string,
  thoughtLog: GenerationTurnResult["thoughtLog"],
  toolResponseDelivered = false,
): GenerationTurnResult {
  return {
    status,
    streamResults,
    usageEntries: context.responseReview?.usage,
    personaResponses: buildPersonaResponses(
      context,
      composeResponseText(
        context,
        context.responseReview ? responseText : joinDeliveredText(streamResults),
        detailsText,
      ),
    ),
    toolResponseDelivered: toolResponseDelivered || undefined,
    firstDeliveredMessageId: streamResults.find((result) => result.firstMessageId)?.firstMessageId,
    thoughtLog,
    thoughtLogOwner: thoughtLog ? resolveThoughtLogOwner(context) : undefined,
  };
}

function composeResponseText(context: ChatTurnContext, responseText: string, detailsText: string): string {
  return detailsText.trim() && (!context.responseReview || responseText.trim())
    ? `${responseText.trim()}${SCENE_METADATA_SEPARATOR}${detailsText.trim()}`
    : responseText.trim();
}

function buildPersonaResponses(context: ChatTurnContext, text: string): GenerationTurnResult["personaResponses"] {
  return text.length > 0
    ? [
        {
          personaName: context.currentPersona.persona_nickname,
          text,
          personaId: context.currentPersona.persona_id,
          personaLineageId: context.currentPersona.persona_lineage_id,
        },
      ]
    : [];
}

export interface DeliveredTurnOutput {
  text: string;
  details: string;
  streamResults: StreamResult[];
}

function joinDeliveredText(streamResults: StreamResult[]): string {
  return streamResults
    .map((result) => result.accumulatedText?.trim())
    .filter(Boolean)
    .join("\n");
}

// Superseded stream results stay so post-turn stats count stayed emoji and sprites, while their usage is dropped
// because finishing models own all usage.
export function carryDeliveredOutput(carried: DeliveredTurnOutput, superseded: GenerationTurnResult): void {
  const text = joinDeliveredText(superseded.streamResults);
  if (!text) return;
  carried.text = carried.text ? `${carried.text}\n${text}` : text;
  for (const result of superseded.streamResults) {
    carried.details = mergeDetails(carried.details, result.detailsContent);
    if (result.accumulatedText?.trim() || result.spritesShown?.length) {
      carried.streamResults.push({ ...result, usage: undefined });
    }
  }
}

export function prependDeliveredOutput(
  result: GenerationTurnResult,
  context: ChatTurnContext,
  carried: DeliveredTurnOutput,
): GenerationTurnResult {
  if (!carried.text) return result;
  const [current, ...otherResponses] = result.personaResponses;
  const currentText = current?.text ?? "";
  const separatorAt = currentText.indexOf(SCENE_METADATA_SEPARATOR);
  const body = separatorAt >= 0 ? currentText.slice(0, separatorAt) : currentText;
  const details = separatorAt >= 0 ? currentText.slice(separatorAt + SCENE_METADATA_SEPARATOR.length) : "";
  const text = composeResponseText(
    context,
    body.trim() ? `${carried.text}\n${body.trim()}` : carried.text,
    mergeDetails(carried.details, details),
  );
  return {
    ...result,
    streamResults: [...carried.streamResults, ...result.streamResults],
    personaResponses: [...buildPersonaResponses(context, text), ...otherResponses],
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
