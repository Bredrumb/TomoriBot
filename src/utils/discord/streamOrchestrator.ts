/**
 * Universal Discord streaming orchestrator
 *
 * This class coordinates the universal Discord streaming pipeline extracted from
 * the original streamGeminiToDiscord function. It works with any StreamProvider
 * implementation and delegates buffer decisions plus Discord delivery to stream
 * helper modules.
 *
 * Key responsibilities:
 * - Provider chunk routing and tool-call interruption
 * - Stream buffer coordination and final flushes
 * - Function call routing to ToolRegistry
 * - Stream timeout management
 * - Result and thought-log assembly
 */

import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  type Message,
  type Client,
  type ColorResolvable,
} from "discord.js";
import { HumanizerDegree } from "../../types/db/schema";
import { sendStandardEmbed } from "./embedHelper";
import { ColorCode, log } from "../misc/logger";
import { localizer } from "../text/localizer";
import {
  chunkMessage,
  cleanLLMOutput,
  humanizeString,
  replaceMentionHandles,
  truncateBeforeGenericSpeakerLine,
  extractMarkdownTableSegments,
  MARKDOWN_TABLE_ATTACHMENT_PREFIX,
} from "../text/stringHelper";
import { filterDuplicateCustomEmojis } from "../text/emojiPenalty";
import { renderMarkdownTableToPng } from "@/utils/image/markdownTableRenderer";
import { setCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";

import type {
  StreamResult,
  StreamStopReason,
  ThoughtLogEntry,
  ThoughtLogPayload,
} from "../../types/provider/interfaces";
import { ContextItemTag, type StructuredContextItem } from "../../types/misc/context";
import type {
  StreamOrchestrator as IStreamOrchestrator,
  ProcessedChunk,
  ProviderError,
  StreamConfig,
  StreamContext,
  StreamProvider,
} from "../../types/stream/interfaces";
import {
  type ChunkProcessingResult,
  DISCORD_STREAMING_CONSTANTS,
  type StreamMetrics,
  type StreamState,
  type TextProcessingConfig,
  type TypingSimulationConfig,
  createDefaultStreamMetrics,
  createDefaultStreamState,
  getVisibleDeliveryMode,
  createTypingSimulationConfig,
  VisibleDeliveryMode,
} from "../../types/stream/types";
import {
  autoCloseIncompleteMarkers as autoCloseStreamBufferMarkers,
  drainDetailsBlocksFromBuffer,
  drainThinkBlocksFromBuffer,
  findRegularOverflowFlushIndex,
  processBufferContent as processStreamBufferContent,
  stripSummaryTag,
} from "./stream/bufferManager";
import { isUserImpersonationStreamContext, type StreamSendPayload, StreamUiUpdater } from "./stream/uiUpdater";

// Empty response handling is now done at the tomoriChat level for fresh context

type BufferedDeliveryBoundary = ChunkProcessingResult["breakType"] | "attachment" | "final" | "tool_call";

/**
 * Universal Discord streaming orchestrator implementation
 * Handles all Discord-specific logic while delegating LLM API calls to providers
 */
export class StreamOrchestrator implements IStreamOrchestrator {
  // Static stop request management system
  private static readonly PREFILL_WHITESPACE_SENTINEL = "\uE000";
  private static readonly STREAM_CHUNK_DEDUP_TAIL_CHARS = 4096;
  private static readonly STREAM_CHUNK_DEDUP_MIN_CHARS = 8;
  /**
   * Matches segments that consist entirely of sentence-ending punctuation
   * (ASCII + full-width + unicode horizontal ellipsis). Used by the orphan
   * punctuation hold-and-prepend logic in `sendBufferSegment` so that lone
   * punctuation flushes (e.g. "..." on its own line) attach to the next
   * non-empty segment instead of being sent as standalone Discord messages.
   */
  private static readonly ORPHAN_PUNCTUATION_REGEX = /^[.,!?;。！？、，…]+$/;

  private readonly uiUpdater = new StreamUiUpdater({
    hasStopRequest: (channelId) => StreamOrchestrator.hasStopRequest(channelId),
    requestStop: (channelId, requesterId) => StreamOrchestrator.requestStop(channelId, requesterId),
    notifyStreamProgress: (context) => this.notifyStreamProgress(context),
  });

  private static isSilentSpeakerGuardStop(requesterId: string | undefined, state: StreamState): boolean {
    return requesterId === "speaker_guard" && state.messageSentCount === 0 && !state.accumulatedText.trim();
  }

  private static getStopReasonFromRequesterId(requesterId?: string): StreamStopReason {
    switch (requesterId) {
      case undefined:
        return "system_request";
      case "system":
        return "system_request";
      case "speaker_guard":
        return "speaker_guard";
      case "send_message_limit":
        return "send_message_limit";
      case "flush_limit":
        return "flush_limit";
      default:
        return "user_request";
    }
  }

  private static getStopReason(
    stopRequest:
      | {
          requesterId: string;
          type: "stop" | "follow_up";
        }
      | undefined,
  ): StreamStopReason {
    if (!stopRequest || stopRequest.type !== "stop") {
      return "unknown";
    }

    return StreamOrchestrator.getStopReasonFromRequesterId(stopRequest.requesterId);
  }

  private static activeStopRequests = new Map<
    string,
    {
      channelId: string;
      timestamp: number;
      requesterId: string;
      type: "stop" | "follow_up";
      stopContext?: {
        originalStopMessage: Message;
        client: Client;
      };
    }
  >();

  /**
   * Request a graceful stop of the current stream in a channel
   * @param channelId - The Discord channel ID where streaming should stop
   * @param requesterId - The ID of the user requesting the stop (optional)
   * @param stopContext - Context for creating the stop response (optional)
   * @returns True if the stop request was registered
   */
  public static requestStop(
    channelId: string,
    requesterId?: string,
    stopContext?: { originalStopMessage: Message; client: Client },
  ): boolean {
    const stopReason = StreamOrchestrator.getStopReasonFromRequesterId(requesterId);
    log.info(
      `Stop request received for channel ${channelId} (reason: ${stopReason}, requester: ${requesterId || "system"})`,
    );

    StreamOrchestrator.activeStopRequests.set(channelId, {
      channelId,
      timestamp: Date.now(),
      requesterId: requesterId || "system",
      type: "stop",
      stopContext,
    });

    return true;
  }

  /**
   * Check if there's an active stop request for a channel
   * @param channelId - The Discord channel ID to check
   * @returns True if there's an active stop request
   */
  public static hasStopRequest(channelId: string): boolean {
    return StreamOrchestrator.activeStopRequests.has(channelId);
  }

  /**
   * Clear stop request for a channel (called when stream completes or fails)
   * @param channelId - The Discord channel ID to clear
   */
  public static clearStopRequest(channelId: string): void {
    const stopRequest = StreamOrchestrator.activeStopRequests.get(channelId);
    if (!stopRequest) return;

    // If we have stop context, preserve it so tomoriChat can craft a stop response later.
    if (stopRequest.stopContext) {
      log.info(`Stop request acknowledged for channel ${channelId}; preserving context for follow-up response.`);
      return;
    }

    StreamOrchestrator.activeStopRequests.delete(channelId);
    log.info(`Cleared stop request for channel ${channelId}`);
  }

  /**
   * Get and clear stop context for a channel (when stream stops)
   * @param channelId - The Discord channel ID to get context for
   * @returns Stop context if it exists, null otherwise
   */
  public static getAndClearStopContext(channelId: string): { originalStopMessage: Message; client: Client } | null {
    const stopRequest = StreamOrchestrator.activeStopRequests.get(channelId);
    if (stopRequest?.stopContext) {
      const context = stopRequest.stopContext;
      StreamOrchestrator.activeStopRequests.delete(channelId);
      log.info(`Retrieved and cleared stop context for channel ${channelId}`);
      return context;
    }
    return null;
  }

  /**
   * Request a follow-up interrupt for the current stream in a channel.
   * If a "stop" request already exists, it takes priority and is not overridden.
   * @param channelId - The Discord channel ID where the follow-up should trigger a regeneration
   * @param requesterId - The ID of the user who sent the follow-up message
   * @returns True if the follow-up request was registered, false if a stop request already exists
   */
  public static requestFollowUp(channelId: string, requesterId: string): boolean {
    // 1. Don't override an existing stop request — stop always takes priority
    const existing = StreamOrchestrator.activeStopRequests.get(channelId);
    if (existing?.type === "stop") {
      log.info(`Follow-up request for channel ${channelId} ignored — stop request already active.`);
      return false;
    }

    // 2. Register the follow-up interrupt request
    StreamOrchestrator.activeStopRequests.set(channelId, {
      channelId,
      timestamp: Date.now(),
      requesterId,
      type: "follow_up",
    });

    log.info(`Follow-up interrupt request registered for channel ${channelId} by user ${requesterId}.`);
    return true;
  }

  /**
   * Check if the active stop request for a channel is a follow-up interrupt
   * @param channelId - The Discord channel ID to check
   * @returns True if the pending request is a follow-up (not a regular stop)
   */
  public static isFollowUpRequest(channelId: string): boolean {
    return StreamOrchestrator.activeStopRequests.get(channelId)?.type === "follow_up";
  }

  /**
   * Clean up old stop requests (called periodically to prevent memory leaks)
   * @param maxAgeMs - Maximum age of stop requests in milliseconds (default: 5 minutes)
   */
  public static cleanupOldStopRequests(maxAgeMs: number = 5 * 60 * 1000): void {
    const now = Date.now();
    for (const [channelId, stopRequest] of StreamOrchestrator.activeStopRequests.entries()) {
      if (now - stopRequest.timestamp > maxAgeMs) {
        StreamOrchestrator.activeStopRequests.delete(channelId);
        log.info(`Cleaned up old stop request for channel ${channelId}`);
      }
    }
  }

  private appendChunkThoughts(state: StreamState, thoughts?: ThoughtLogEntry[]): void {
    if (!thoughts || thoughts.length === 0) {
      return;
    }

    for (const thought of thoughts) {
      const content = thought.content;
      if (typeof content !== "string" || content.length === 0) {
        continue;
      }

      if (thought.kind === "summary") {
        state.thoughtSummarySegments.push(content);
        continue;
      }

      state.thoughtRawSegments.push(content);
    }
  }

  private notifyStreamProgress(context: StreamContext): void {
    context.onStreamProgress?.();
  }

  private buildThoughtLogPayload(state: StreamState, generationDurationMs?: number): ThoughtLogPayload | undefined {
    const summary = state.thoughtSummarySegments.join("").trim();
    const raw = state.thoughtRawSegments.join("").trim();
    const normalizedDurationMs =
      typeof generationDurationMs === "number" && Number.isFinite(generationDurationMs) && generationDurationMs >= 0
        ? Math.round(generationDurationMs)
        : undefined;

    if (!summary && !raw && !state.firstReplyUrl && normalizedDurationMs === undefined) {
      return undefined;
    }

    return {
      summary: summary || undefined,
      raw: raw || undefined,
      firstReplyUrl: state.firstReplyUrl,
      generationDurationMs: normalizedDurationMs,
    };
  }

  /**
   * Stream an LLM response to Discord using a provider-specific adapter
   * This replaces the massive streamGeminiToDiscord function with modular architecture
   * Empty response handling is now done at the tomoriChat level for fresh context
   */
  async streamToDiscord(provider: StreamProvider, config: StreamConfig, context: StreamContext): Promise<StreamResult> {
    log.section("Universal Stream Orchestrator Started");

    log.info(
      `Starting stream to channel ${context.channel.id} (server: ${"guild" in context.channel ? context.channel.guild.id : "DM"}) using provider: ${provider.getProviderInfo().name}`,
    );

    const result = await this.executeStream(provider, config, context);

    // Check if we got an empty response and return special status
    if (result.status === "completed" && this.wasEmptyResponse(result)) {
      log.info("Empty response detected. Returning empty_response status for retry at tomoriChat level.");
      return {
        status: "empty_response",
        data: result.data,
        naiContinuationPrefill: result.naiContinuationPrefill,
      };
    }

    // Return result for non-empty responses or other statuses
    return result;
  }

  /**
   * Execute a single stream attempt without retry logic
   * Contains the core streaming logic extracted from the original streamToDiscord method
   */
  private async executeStream(
    provider: StreamProvider,
    config: StreamConfig,
    context: StreamContext,
  ): Promise<StreamResult & { messageSentCount?: number }> {
    // Initialize logging and metrics
    const metrics = createDefaultStreamMetrics();
    const state = createDefaultStreamState();

    // Create processing configurations
    const textConfig = this.createTextProcessingConfig(config, context);
    const typingConfig = createTypingSimulationConfig(config.humanizerDegree);
    let terminalDoneMetadata: Record<string, unknown> | undefined;

    let lastError: Error | undefined;

    try {
      // Initialize timeout management
      this.setupInactivityTimer(state, config, context);

      // Prepare optional prefill before streaming (hybrid prefix)
      await this.sendOutputPrefillIfNeeded(context, textConfig, state);

      // Begin provider streaming
      const streamGenerator = provider.startStream(config, context);

      // Pre-stream check: if a stop or follow-up arrived during context building, cancel before
      // the LLM API call starts — avoids wasting a full round-trip to the provider.
      if (StreamOrchestrator.hasStopRequest(context.channel.id)) {
        if (StreamOrchestrator.isFollowUpRequest(context.channel.id)) {
          log.info(
            `Follow-up interrupt detected before stream started for channel ${context.channel.id}. Returning immediately.`,
          );
          StreamOrchestrator.activeStopRequests.delete(context.channel.id);
          return { status: "follow_up_interrupt" };
        }

        // Regular kill — clear and return stopped before the stream begins
        log.info(`Kill request detected before stream started for channel ${context.channel.id}. Aborting stream.`);
        const preStreamStopRequest = StreamOrchestrator.activeStopRequests.get(context.channel.id);
        const preStreamStopReason = StreamOrchestrator.getStopReason(preStreamStopRequest);
        StreamOrchestrator.clearStopRequest(context.channel.id);
        return { status: "stopped_by_user", stopReason: preStreamStopReason };
      }

      // Process the stream
      for await (const rawChunk of streamGenerator) {
        // Check for stop/follow-up request first (highest priority)
        if (StreamOrchestrator.hasStopRequest(context.channel.id)) {
          // Follow-up interrupt: skip buffer flush, return immediately for regeneration
          if (StreamOrchestrator.isFollowUpRequest(context.channel.id)) {
            log.info(
              `Stream interrupted by follow-up message for channel ${context.channel.id}. Skipping buffer flush.`,
            );
            StreamOrchestrator.activeStopRequests.delete(context.channel.id);
            return { status: "follow_up_interrupt" };
          }

          log.info(`Stream loop breaking due to stop request for channel ${context.channel.id}.`);

          // 1. Get stop request details before clearing to determine if this is a flush limit stop
          const stopRequest = StreamOrchestrator.activeStopRequests.get(context.channel.id);
          const stopReason = StreamOrchestrator.getStopReason(stopRequest);
          const shouldSkipBufferFlush =
            (stopRequest?.requesterId === "flush_limit" || stopRequest?.requesterId === "speaker_guard") &&
            !stopRequest?.stopContext;

          // 2. Clear the stop request
          StreamOrchestrator.clearStopRequest(context.channel.id);

          // 3. Only flush buffer if this is NOT a flush limit stop
          // Flush limit stops shouldn't try to send more messages as they'd just hit the limit again
          // This prevents the duplicate "Response Length Limit Reached" embed
          if ((state.buffer.length > 0 || this.hasPendingAggregatedText(state)) && !shouldSkipBufferFlush) {
            await this.flushPendingBuffer(
              state,
              this.createTextProcessingConfig(config, context),
              createTypingSimulationConfig(config.humanizerDegree),
              context,
            );
          } else if (
            stopRequest?.requesterId === "speaker_guard" &&
            this.hasPendingAggregatedText(state) &&
            textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE
          ) {
            await this.flushAggregatedTextBuffer(textConfig, context, state);
          } else if (shouldSkipBufferFlush) {
            log.info("Stream: Skipping buffer flush due to internal no-flush stop");
          }

          if (StreamOrchestrator.isSilentSpeakerGuardStop(stopRequest?.requesterId, state)) {
            log.warn("Stream: Silent speaker-guard stop produced no user-visible output; treating as empty response.");
            return {
              status: "empty_response",
              data: {
                emptyResponseReason: "speaker_guard",
              },
            };
          }

          return {
            status: "stopped_by_user",
            stopReason,
          };
        }

        // Check for external abort signal (SDK call timeout fired)
        if (context.abortSignal?.aborted) {
          log.warn(`Stream loop breaking due to external abort signal for channel ${context.channel.id}.`);
          this.clearInactivityTimer(state);
          return {
            status: "error",
            data: new Error("Stream aborted by SDK call timeout"),
          };
        }

        // Check for timeout
        if (this.isStreamTimedOut(state)) {
          log.warn(`Stream loop breaking due to timeout for channel ${context.channel.id}.`);
          break;
        }

        // Reset inactivity timer on each chunk
        this.resetInactivityTimer(state, config, context);
        this.notifyStreamProgress(context);
        metrics.totalChunks++;

        // Convert raw chunk to normalized format
        const processedChunk = provider.processChunk(rawChunk);
        this.appendChunkThoughts(state, processedChunk.thoughts);
        if (processedChunk.type === "done" && processedChunk.metadata) {
          terminalDoneMetadata = processedChunk.metadata;
        }

        // Handle different chunk types
        const result = await this.handleProcessedChunk(
          processedChunk,
          provider,
          config,
          context,
          textConfig,
          typingConfig,
          state,
          metrics,
        );

        // If function call or error, return immediately
        if (result.status !== "continue") {
          this.clearInactivityTimer(state);
          return result;
        }
      }

      // Clear timeout timer
      this.clearInactivityTimer(state);

      // Check if stream timed out
      if (this.isStreamTimedOut(state)) {
        if (!isUserImpersonationStreamContext(context)) {
          // Send user-facing embed to notify about the timeout
          await sendStandardEmbed(context.channel, context.locale, {
            titleKey: "genai.stream.inactivity_timeout_title",
            descriptionKey: "genai.stream.inactivity_timeout_description",
            color: ColorCode.WARN,
          }).catch((embedError) => {
            log.warn(
              "Failed to send inactivity timeout embed",
              embedError instanceof Error ? embedError : new Error(String(embedError)),
            );
          });
        }

        return {
          status: "timeout",
          data: new Error("Stream timed out due to inactivity."),
        };
      }

      await this.flushFinalBuffer(state, textConfig, typingConfig, context);

      if (StreamOrchestrator.activeStopRequests.get(context.channel.id)?.requesterId === "speaker_guard") {
        StreamOrchestrator.clearStopRequest(context.channel.id);
      }

      // Complete metrics and return success with message count for empty response detection
      metrics.endTime = Date.now();

      // Don't clear stop request here - let the finally block handle it after lock release

      log.success(
        `Stream to channel ${context.channel.id} completed. Messages sent: ${state.messageSentCount}, Duration: ${metrics.endTime - metrics.startTime}ms`,
      );

      return {
        status: "completed",
        messageSentCount: state.messageSentCount,
        accumulatedText: state.accumulatedText, // Return accumulated text for short-term memory
        detailsContent: state.detailsSegments.length > 0 ? state.detailsSegments.join("\n\n") : undefined,
        thoughtLog: this.buildThoughtLogPayload(state, metrics.endTime - metrics.startTime),
        data: terminalDoneMetadata,
      };
    } catch (error) {
      this.clearInactivityTimer(state);
      lastError = error as Error;

      // Clean up stop request on error
      StreamOrchestrator.clearStopRequest(context.channel.id);

      // Log error with context
      const errorContext = {
        serverId: context.tomoriState.server_id,
        errorType: "StreamOrchestrator",
        metadata: {
          channelId: context.channel.id,
          provider: provider.getProviderInfo().name,
        },
      };

      log.error(`Stream orchestrator failed: ${lastError.message}`, lastError, errorContext);

      // Send error to Discord unless suppressed for key-rotation retries
      if (!context.suppressUserErrors && !isUserImpersonationStreamContext(context)) {
        await this.handleStreamError(lastError, context);
      } else {
        log.warn("Stream: Suppressing stream error embed due to retryable failure", lastError);
      }

      return { status: "error", data: lastError };
    }
  }

  /**
   * Handle a processed chunk from the provider
   */
  private async handleProcessedChunk(
    chunk: ProcessedChunk,
    _provider: StreamProvider,
    config: StreamConfig,
    context: StreamContext,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    state: StreamState,
    metrics: StreamMetrics,
  ): Promise<StreamResult | { status: "continue" }> {
    switch (chunk.type) {
      case "error":
        if (chunk.error) {
          // Flush any pending buffer before handling error
          // This preserves text the model generated before encountering the error
          // (e.g., text generated before a malformed tool call)
          if (state.buffer.length > 0 || this.hasPendingAggregatedText(state)) {
            log.info(
              `Stream: Flushing ${state.buffer.length} chars of buffered text before error handling` +
                `${this.hasPendingAggregatedText(state) ? ` (queued aggregate: ${state.pendingAggregatedText.length})` : ""}`,
            );
            await this.flushPendingBuffer(state, textConfig, typingConfig, context);
            if (StreamOrchestrator.hasStopRequest(context.channel.id)) {
              return {
                status: "stopped_by_user",
                stopReason: StreamOrchestrator.getStopReason(
                  StreamOrchestrator.activeStopRequests.get(context.channel.id),
                ),
              };
            }
          }
          if (!context.suppressUserErrors && !isUserImpersonationStreamContext(context)) {
            await this.handleProviderError(chunk.error, _provider, context);
          } else {
            log.warn("Stream: Suppressing provider error embed due to retryable failure", chunk.error);
          }
          return { status: "error", data: chunk.error };
        }
        break;

      case "function_call":
        if (chunk.functionCall) {
          // Flush any pending buffer before function call
          if (state.buffer.length > 0 || this.hasPendingAggregatedText(state)) {
            await this.flushPendingBuffer(state, textConfig, typingConfig, context, true);
            if (StreamOrchestrator.hasStopRequest(context.channel.id)) {
              return {
                status: "stopped_by_user",
                stopReason: StreamOrchestrator.getStopReason(
                  StreamOrchestrator.activeStopRequests.get(context.channel.id),
                ),
              };
            }
          }
          return {
            status: "function_call",
            data: chunk.functionCall,
            accumulatedText: state.accumulatedText,
            detailsContent: state.detailsSegments.length > 0 ? state.detailsSegments.join("\n\n") : undefined,
            thoughtLog: this.buildThoughtLogPayload(state, Date.now() - metrics.startTime),
          };
        }
        break;

      case "text":
        if (chunk.content) {
          await this.processTextChunk(chunk.content, config, context, textConfig, typingConfig, state, metrics);
        }
        break;

      case "done":
        {
          const terminalFinishReason =
            typeof chunk.metadata?.finishReason === "string" ? chunk.metadata.finishReason : null;
          if (terminalFinishReason === "length") {
            log.warn(
              `Stream ended with finish_reason=length (output token cap). ` +
                `messageSentCount=${state.messageSentCount}, bufferChars=${state.buffer.length}, accumulatedChars=${state.accumulatedText.length}`,
            );
          }
        }
        // Stream finished, continue to final buffer flush
        // Don't return immediately - let the loop exit naturally to flush remaining buffer
        break;
    }

    return { status: "continue" };
  }

  /**
   * Process a text chunk and manage the stream buffer
   */
  private async processTextChunk(
    textContent: string,
    config: StreamConfig,
    context: StreamContext,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    state: StreamState,
    metrics: StreamMetrics,
  ): Promise<void> {
    log.info(`Stream API: Raw chunk received: "${textContent}"`);

    const normalizedTextContent = this.deduplicateIncomingTextChunk(textContent, state);
    if (normalizedTextContent !== textContent) {
      log.info(`Stream API: Trimmed overlapping chunk (${textContent.length} -> ${normalizedTextContent.length})`);
    }
    if (!normalizedTextContent) {
      return;
    }

    // Add to current turn model parts for API continuity
    if (normalizedTextContent.trim() && context.currentTurnModelParts) {
      context.currentTurnModelParts.push({ text: normalizedTextContent });
    }

    // Suppress text output if flagged (NAI tool retry mode — model state is kept coherent above but nothing reaches Discord)
    if (context.suppressTextOutput) {
      return;
    }

    // Route content to the correct buffer: while inside a think or details block, new chunks
    // belong in the respective accumulator — NOT the main output buffer. This prevents content
    // from leaking into Discord when the model streams tags split across multiple tiny SSE chunks.
    if (state.isInsideThinkBlock) {
      state.thinkBlockBuffer += normalizedTextContent;
    } else if (state.isInsideDetailsBlock) {
      state.detailsBlockBuffer += normalizedTextContent;
    } else {
      state.buffer += normalizedTextContent;
    }
    metrics.totalCharacters += normalizedTextContent.length;

    // Extract any <think> blocks arriving in the buffer, routing them to the thought log.
    // This handles think tags that arrive split across multiple tiny SSE chunks.
    drainThinkBlocksFromBuffer(state);

    // Extract any <details> blocks arriving in the buffer, routing body text to detailsSegments.
    // Same split-tag handling pattern as think blocks.
    drainDetailsBlocksFromBuffer(state);

    // Collapse orphaned Discord subtext markers ("-#\n") so they stay attached to the next line.
    // LLMs sometimes place "-#" alone on a line, which splits into a bare "-#" message.
    // Replacing "-#\n" with "-# " keeps the marker with its content for proper subtext rendering.
    state.buffer = state.buffer.replace(/(^|\n)-#[ \t]*\n+/g, "$1-# ");

    // Process buffer iteratively
    let processedSomething: boolean;
    do {
      processedSomething = false;
      const processingResult = processStreamBufferContent(state, config);

      if (processingResult.shouldFlush && processingResult.segmentToFlush) {
        await this.sendBufferSegment(
          processingResult.segmentToFlush,
          processingResult.breakType,
          textConfig,
          typingConfig,
          context,
          state,
        );

        state.buffer = processingResult.updatedBuffer;
        if (StreamOrchestrator.hasStopRequest(context.channel.id)) {
          return;
        }
        processedSomething = true;
      }

      // Update code block state regardless of whether we flushed or not
      // This ensures we properly track when we enter/exit code blocks
      if (processingResult.newCodeBlockState !== undefined) {
        state.isInsideCodeBlock = processingResult.newCodeBlockState;
      }
    } while (
      processedSomething &&
      state.buffer.length > 0 &&
      !state.isInsideCodeBlock &&
      !state.isInsideThinkBlock &&
      !state.isInsideDetailsBlock &&
      !state.hasSemanticMarkers
    );

    // Handle oversized regular buffer (not in code block and no semantic markers)
    while (
      !state.isInsideCodeBlock &&
      !state.isInsideThinkBlock &&
      !state.isInsideDetailsBlock &&
      !state.hasSemanticMarkers &&
      state.buffer.length >= DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_REGULAR
    ) {
      const flushIndex = findRegularOverflowFlushIndex(
        state.buffer,
        DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_REGULAR,
      );
      const segmentToFlush = state.buffer.substring(0, flushIndex);
      const updatedBuffer = state.buffer.substring(flushIndex);

      log.info(
        `Stream Seg: Flushing oversized regular buffer at safe breakpoint (total: ${state.buffer.length}, flush: ${segmentToFlush.length}, retain: ${updatedBuffer.length})`,
      );

      await this.sendBufferSegment(segmentToFlush, "overflow", textConfig, typingConfig, context, state);
      state.buffer = updatedBuffer;
      if (StreamOrchestrator.hasStopRequest(context.channel.id)) {
        return;
      }
    }
  }

  private deduplicateIncomingTextChunk(textContent: string, state: StreamState): string {
    if (!textContent || textContent.length < StreamOrchestrator.STREAM_CHUNK_DEDUP_MIN_CHARS) {
      return textContent;
    }

    const recentText = this.getRecentStreamTextTail(state);
    if (!recentText) {
      return textContent;
    }

    if (recentText.endsWith(textContent)) {
      return "";
    }

    const maxOverlap = Math.min(recentText.length, textContent.length);
    for (let overlap = maxOverlap; overlap >= StreamOrchestrator.STREAM_CHUNK_DEDUP_MIN_CHARS; overlap--) {
      if (recentText.slice(recentText.length - overlap) === textContent.slice(0, overlap)) {
        return textContent.slice(overlap);
      }
    }

    return textContent;
  }

  private getRecentStreamTextTail(state: StreamState): string {
    const combined = `${state.accumulatedText}${state.pendingAggregatedText}${state.buffer}`;
    if (!combined) {
      return "";
    }

    if (combined.length <= StreamOrchestrator.STREAM_CHUNK_DEDUP_TAIL_CHARS) {
      return combined;
    }

    return combined.slice(-StreamOrchestrator.STREAM_CHUNK_DEDUP_TAIL_CHARS);
  }

  /**
   * Send a buffer segment to Discord with proper message handling
   * This is the extracted and enhanced sendSegment function
   */
  private async sendBufferSegment(
    segment: string,
    boundary: BufferedDeliveryBoundary | undefined,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    if (!segment.trim()) return;

    const trimmedGuard = segment.trim();

    // 1. Hold deliberate orphan-punctuation segments (e.g. a lone "..." or "…")
    // across flush boundaries so they can prepend the next non-empty segment
    // instead of shipping as standalone Discord messages. Length ≥ 3 OR contains
    // "…" filters in expressive ellipses while leaving the singleton-drop guards
    // below intact for hallucinated "." and ".." fragments.
    if (
      StreamOrchestrator.ORPHAN_PUNCTUATION_REGEX.test(trimmedGuard) &&
      (trimmedGuard.length >= 3 || trimmedGuard.includes("…"))
    ) {
      state.pendingOrphanPunctuation = (state.pendingOrphanPunctuation ?? "") + trimmedGuard;
      log.info(
        `Stream Orphan: Holding "${trimmedGuard}" (pending="${state.pendingOrphanPunctuation}") for next segment`,
      );
      return;
    }

    // 2. Discard lone single-character punctuation/symbol fragments that models
    // sometimes hallucinate (e.g. ".", "]", ")"). These look unnatural when
    // sent as standalone Discord messages or line-leading fragments.
    // Also discard ".." — a degenerate ellipsis fragment produced when streaming
    // chunks split "..." across chunk boundaries mid-delivery.
    if (trimmedGuard.length === 1 && !/\w/u.test(trimmedGuard)) return;
    if (trimmedGuard === "..") return;

    // 3. Prepend any held orphan punctuation so it ships inline with this segment.
    let workingSegment = segment;
    if (state.pendingOrphanPunctuation) {
      log.info(`Stream Orphan: Prepending held "${state.pendingOrphanPunctuation}" to next segment`);
      workingSegment = `${state.pendingOrphanPunctuation}${segment}`;
      state.pendingOrphanPunctuation = undefined;
    }

    const wasPrefillInjected = state.prefillInjected;

    const leadingWhitespaceMatch = workingSegment.match(/^\s+/);
    const leadingWhitespace = leadingWhitespaceMatch?.[0] ?? "";
    const normalizedLeadingWhitespace = textConfig.uncensorUnicodeSpacesEnabled
      ? leadingWhitespace.replace(/\u2800/g, " ")
      : leadingWhitespace;

    // Filter duplicate custom emojis BEFORE transformation (while still in :name: format)
    const filteredSegment = filterDuplicateCustomEmojis(workingSegment, context.contextItems);

    // Clean the segment (transforms :emoji: to Discord format)
    const cleanedSegment = cleanLLMOutput(
      filteredSegment,
      textConfig.botName,
      textConfig.emojiStrings,
      textConfig.emojiUsageEnabled,
      textConfig.mentionMap,
      textConfig.mentionIdSet,
      {
        unicodeSpacesEnabled: textConfig.uncensorUnicodeSpacesEnabled,
        sanitizeEnabled: textConfig.uncensorSanitizeEnabled,
      },
    );

    let resolvedSegment = await this.resolveGuildMentions(cleanedSegment, context, textConfig);

    if (
      normalizedLeadingWhitespace &&
      resolvedSegment.length > 0 &&
      !resolvedSegment.startsWith(normalizedLeadingWhitespace)
    ) {
      resolvedSegment = normalizedLeadingWhitespace + resolvedSegment;
    }

    const strippedSegment = this.stripPrefillFromSegment(resolvedSegment, state);
    const prefixedSegment = this.applyPrefillToSegment(strippedSegment, state, context);
    let segmentToSend = prefixedSegment;
    const injectedPrefillThisSegment = !wasPrefillInjected && state.prefillInjected;
    if (injectedPrefillThisSegment && state.prefillTarget && /^\s+/.test(strippedSegment)) {
      segmentToSend = `${state.prefillTarget}${StreamOrchestrator.PREFILL_WHITESPACE_SENTINEL}${strippedSegment}`;
    }
    let shouldStopForSpeakerGuard = false;
    if (context.tomoriState.config.llm_stop_speaker_pattern_enabled ?? false) {
      const speakerGuardResult = truncateBeforeGenericSpeakerLine(segmentToSend, {
        includeStart: Boolean(state.accumulatedText.trim() || state.pendingAggregatedText.trim()),
      });
      if (speakerGuardResult.stopTriggered) {
        log.warn(
          `Stream speaker guard: stopping before speaker label "${speakerGuardResult.matchedSpeaker ?? "unknown"}"`,
        );
        segmentToSend = speakerGuardResult.text;
        shouldStopForSpeakerGuard = true;
      }
    }

    if (!segmentToSend.trim()) {
      if (shouldStopForSpeakerGuard) {
        StreamOrchestrator.requestStop(context.channel.id, "speaker_guard");
      }
      return;
    }

    const segmentedParts = extractMarkdownTableSegments(segmentToSend);
    const hasRenderedTable = segmentedParts.some((part) => part.type === "table");

    if (!hasRenderedTable) {
      await this.sendSegment(segmentToSend, boundary, textConfig, typingConfig, context, state);
    } else {
      let isFirstTextPart = true;
      for (const part of segmentedParts) {
        if (part.type === "text") {
          if (!part.content.trim()) continue;
          await this.sendSegment(
            part.content,
            isFirstTextPart ? boundary : undefined,
            textConfig,
            typingConfig,
            context,
            state,
          );
          isFirstTextPart = false;
          continue;
        }

        await this.sendRenderedMarkdownTable(part.content, part.table.source, textConfig, typingConfig, context, state);
        isFirstTextPart = false;
      }
    }

    if (shouldStopForSpeakerGuard) {
      StreamOrchestrator.requestStop(context.channel.id, "speaker_guard");
    }
  }

  private async sendOutputPrefillIfNeeded(
    context: StreamContext,
    textConfig: TextProcessingConfig,
    state: StreamState,
  ): Promise<void> {
    const rawPrefill = context.outputPrefill?.trim();
    if (!rawPrefill) return;

    // Filter duplicate custom emojis BEFORE transformation (while still in :name: format)
    const filteredPrefill = filterDuplicateCustomEmojis(rawPrefill, context.contextItems);

    // Clean prefill (same pipeline as streamed output)
    const cleanedPrefill = cleanLLMOutput(
      filteredPrefill,
      textConfig.botName,
      textConfig.emojiStrings,
      textConfig.emojiUsageEnabled,
      textConfig.mentionMap,
      textConfig.mentionIdSet,
      {
        unicodeSpacesEnabled: textConfig.uncensorUnicodeSpacesEnabled,
        sanitizeEnabled: textConfig.uncensorSanitizeEnabled,
      },
    );

    const resolvedPrefill = await this.resolveGuildMentions(cleanedPrefill, context, textConfig);

    if (!resolvedPrefill.trim()) return;

    // Track prefix for stripping from subsequent streamed output
    state.prefillTarget = resolvedPrefill;
    state.prefillMatched = 0;
    state.prefillMatchFailed = false;
    state.prefillInjected = Boolean(context.outputPrefillState?.sent);

    log.info(`Stream Prefill: Prepared output prefill (${resolvedPrefill.length} chars).`);
  }

  private applyPrefillToSegment(segment: string, state: StreamState, context: StreamContext): string {
    if (!state.prefillTarget) return segment;

    if (!state.prefillInjected) {
      if (!segment.trim()) return "";
      state.prefillInjected = true;
      if (context.outputPrefillState) {
        context.outputPrefillState.sent = true;
      }
      return state.prefillTarget + segment;
    }

    return segment;
  }

  private stripPrefillFromSegment(segment: string, state: StreamState): string {
    const target = state.prefillTarget;
    if (!target || state.prefillMatchFailed || state.prefillMatched >= target.length) {
      return segment;
    }

    let index = 0;
    while (index < segment.length && state.prefillMatched < target.length) {
      const expected = target[state.prefillMatched];
      const actual = segment[index];

      if (actual === expected) {
        state.prefillMatched += 1;
        index += 1;
        continue;
      }
      state.prefillMatchFailed = true;
      state.prefillMatched = target.length;
      return segment;
    }

    if (state.prefillMatched >= target.length) {
      return segment.slice(index);
    }

    // Still matching prefix; wait for more text
    return "";
  }

  private extractMentionCandidates(text: string): {
    handles: Set<string>;
    idCandidates: Set<string>;
  } {
    const handles = new Set<string>();
    const idCandidates = new Set<string>();

    if (!text.includes("@")) {
      return { handles, idCandidates };
    }

    let codeBlockIndex = 0;
    let inlineCodeIndex = 0;

    let processedText = text.replace(/```[\s\S]*?```/g, () => `__CODE_BLOCK_${codeBlockIndex++}__`);

    processedText = processedText.replace(/`[^`]*`/g, () => `__INLINE_CODE_${inlineCodeIndex++}__`);

    processedText.replace(/@\{([^}]+)\}/g, (_match, rawHandle) => {
      const handle = (rawHandle as string).trim();
      if (!handle) return _match;

      const pipeIndex = handle.lastIndexOf("|");
      if (pipeIndex > -1) {
        const idPart = handle.slice(pipeIndex + 1).trim();
        const namePart = handle.slice(0, pipeIndex).trim();
        if (/^\d{17,20}$/.test(idPart)) {
          idCandidates.add(idPart);
        } else if (namePart) {
          handles.add(namePart);
        }
        return _match;
      }

      if (/^\d{17,20}$/.test(handle)) {
        idCandidates.add(handle);
        return _match;
      }

      handles.add(handle);
      return _match;
    });

    processedText.replace(
      /(^|[^\p{L}\p{N}_<])@(?!(?:\{|everyone\b|here\b))([\p{L}\p{N}_][\p{L}\p{N}_-]{0,31})/giu,
      (_match, _prefix, rawHandle) => {
        const handle = (rawHandle as string).trim();
        if (handle) handles.add(handle);
        return _match;
      },
    );

    return { handles, idCandidates };
  }

  private async resolveGuildMentions(
    text: string,
    context: StreamContext,
    textConfig: TextProcessingConfig,
  ): Promise<string> {
    if (!text.includes("@")) return text;
    if (!("guild" in context.channel)) return text;

    const guild = context.channel.guild;
    const mentionMap = textConfig.mentionMap ?? new Map<string, string[]>();
    const mentionIdSet = textConfig.mentionIdSet ?? new Set<string>();
    textConfig.mentionMap = mentionMap;
    textConfig.mentionIdSet = mentionIdSet;

    const { handles, idCandidates } = this.extractMentionCandidates(text);
    if (handles.size === 0 && idCandidates.size === 0) return text;

    for (const idCandidate of idCandidates) {
      if (mentionIdSet.has(idCandidate)) continue;
      const member = guild.members.cache.get(idCandidate) || (await guild.members.fetch(idCandidate).catch(() => null));
      if (member) {
        mentionIdSet.add(member.id);
      }
    }

    for (const handle of handles) {
      const normalizedHandle = handle.toLowerCase();
      const existing = mentionMap.get(normalizedHandle);
      if (existing?.length === 1) continue;
      if (existing && existing.length > 1) continue;

      const results = await guild.members.search({ query: handle, limit: 5 }).catch(() => null);
      if (!results || results.size === 0) continue;

      const exactUsernameMatches = results.filter((member) => member.user.username.toLowerCase() === normalizedHandle);
      if (exactUsernameMatches.size === 1) {
        const member = exactUsernameMatches.first();
        if (member) {
          mentionMap.set(normalizedHandle, [member.id]);
          mentionIdSet.add(member.id);
        }
        continue;
      }

      const exactGlobalMatches = results.filter((member) => member.user.globalName?.toLowerCase() === normalizedHandle);
      if (exactGlobalMatches.size === 1) {
        const member = exactGlobalMatches.first();
        if (member) {
          mentionMap.set(normalizedHandle, [member.id]);
          mentionIdSet.add(member.id);
        }
        continue;
      }

      const exactNicknameMatches = results.filter((member) => member.nickname?.toLowerCase() === normalizedHandle);
      if (exactNicknameMatches.size === 1) {
        const member = exactNicknameMatches.first();
        if (member) {
          mentionMap.set(normalizedHandle, [member.id]);
          mentionIdSet.add(member.id);
        }
      }
    }

    return replaceMentionHandles(text, mentionMap, mentionIdSet);
  }

  /**
   * Core message sending logic with chunking and humanization
   * Extracted from the original sendSegment function
   */
  private async sendSegment(
    segment: string,
    boundary: BufferedDeliveryBoundary | undefined,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    if (!segment.trim()) return;

    if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE) {
      this.queueAggregatedSegment(segment, boundary, state);
      return;
    }

    // Chunk the message
    const rawMessageChunks = chunkMessage(segment, textConfig.humanizerDegree, textConfig.maxMessageLength).map(
      (chunk) => chunk.replaceAll(StreamOrchestrator.PREFILL_WHITESPACE_SENTINEL, ""),
    );
    if (!rawMessageChunks.length) return;

    // Process chunks with humanization
    const finalMessageChunks: string[] = [];
    for (let chunk of rawMessageChunks) {
      const originalChunk = chunk;
      if (textConfig.humanizerDegree === HumanizerDegree.HEAVY) {
        chunk = humanizeString(chunk);
        if (chunk !== originalChunk) {
          log.info(`Stream Send: Humanized (D3) from "${originalChunk}" to "${chunk}"`);
        }
      }
      if (chunk.trim()) {
        finalMessageChunks.push(chunk);
      }
    }
    if (!finalMessageChunks.length) return;

    // Send chunks with appropriate timing
    if (typingConfig.enabled) {
      await this.sendChunksWithTyping(finalMessageChunks, typingConfig, context, state);
    } else {
      await this.sendChunksImmediate(finalMessageChunks, context, state);
    }
  }

  private hasPendingAggregatedText(state: StreamState): boolean {
    return Boolean(state.pendingAggregatedText.trim());
  }

  private queueAggregatedSegment(
    segment: string,
    boundary: BufferedDeliveryBoundary | undefined,
    state: StreamState,
  ): void {
    const joinWithBlankLine = state.pendingAggregateJoinNextWithBlankLine && state.pendingAggregatedText.length > 0;
    if (joinWithBlankLine) {
      const trimmedExisting = state.pendingAggregatedText.replace(/\n+$/u, "");
      const trimmedIncoming = segment.replace(/^\n+/u, "");
      state.pendingAggregatedText = `${trimmedExisting}\n\n${trimmedIncoming}`;
    } else {
      state.pendingAggregatedText += segment;
    }

    state.pendingAggregateJoinNextWithBlankLine = boundary === "newline";
    log.info(
      `Stream Aggregate: Queued ${segment.length} chars (boundary=${boundary ?? "none"}, total=${state.pendingAggregatedText.length})`,
    );
  }

  private async flushAggregatedTextBuffer(
    textConfig: TextProcessingConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    if (!this.hasPendingAggregatedText(state)) {
      state.pendingAggregatedText = "";
      state.pendingAggregateJoinNextWithBlankLine = false;
      return;
    }

    const aggregatedText = state.pendingAggregatedText;
    state.pendingAggregatedText = "";
    state.pendingAggregateJoinNextWithBlankLine = false;

    const messageChunks = chunkMessage(aggregatedText, HumanizerDegree.NONE, textConfig.maxMessageLength).map((chunk) =>
      chunk.replaceAll(StreamOrchestrator.PREFILL_WHITESPACE_SENTINEL, ""),
    );
    const finalMessageChunks = messageChunks.filter((chunk) => chunk.trim());
    if (!finalMessageChunks.length) {
      return;
    }

    log.info(
      `Stream Aggregate: Flushing ${aggregatedText.length} chars as ${finalMessageChunks.length} Discord message(s)`,
    );
    await this.sendChunksImmediate(finalMessageChunks, context, state);
  }

  private async flushHeldOrphanPunctuation(
    boundary: BufferedDeliveryBoundary,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    if (!state.pendingOrphanPunctuation) {
      return;
    }

    const orphan = state.pendingOrphanPunctuation;
    state.pendingOrphanPunctuation = undefined;
    log.info(`Stream Orphan: Releasing held "${orphan}" at ${boundary} boundary.`);
    await this.sendSegment(orphan, boundary, textConfig, typingConfig, context, state);
  }

  private async sendRenderedMarkdownTable(
    tableMarkdown: string,
    fallbackText: string,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    const tableSegments = extractMarkdownTableSegments(tableMarkdown);
    const firstTableSegment = tableSegments.find((segment) => segment.type === "table");
    if (!firstTableSegment || firstTableSegment.type !== "table") {
      await this.sendSegment(fallbackText, undefined, textConfig, typingConfig, context, state);
      return;
    }

    const renderedBuffer = await renderMarkdownTableToPng(firstTableSegment.table);
    if (!renderedBuffer) {
      await this.sendSegment(fallbackText, undefined, textConfig, typingConfig, context, state);
      return;
    }

    await this.flushHeldOrphanPunctuation("attachment", textConfig, typingConfig, context, state);
    if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE) {
      await this.flushAggregatedTextBuffer(textConfig, context, state);
    }

    const attachment = new AttachmentBuilder(renderedBuffer, {
      name: `${MARKDOWN_TABLE_ATTACHMENT_PREFIX}${Date.now()}.png`,
    });

    const sentMessage = await this.sendSinglePayload(
      {
        files: [attachment],
        allowedMentions: {
          parse: [],
          repliedUser: false,
        },
      },
      tableMarkdown,
      context,
      state,
    );

    if (sentMessage) {
      setCachedRenderedMarkdownTable(sentMessage.id, tableMarkdown.trim());
    }
  }

  /**
   * Send message chunks with typing simulation
   */
  private async sendChunksWithTyping(
    chunks: string[],
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    // Check for stop before starting
    if (StreamOrchestrator.hasStopRequest(context.channel.id)) {
      log.info("Stream Send: Stop request detected before sending chunks with typing");
      return;
    }

    // Send first chunk immediately
    const firstChunk = chunks[0];
    await this.sendSingleMessage(firstChunk, context, state);

    // Send remaining chunks with typing simulation
    for (let i = 1; i < chunks.length; i++) {
      // Check for stop before each message
      if (StreamOrchestrator.hasStopRequest(context.channel.id)) {
        log.info(`Stream Send: Stop request detected before sending chunk ${i + 1}/${chunks.length}`);
        return;
      }

      const chunkToSend = chunks[i];

      // Calculate typing time
      let typingTime = Math.min(chunkToSend.length * typingConfig.baseSpeedMsPerChar, typingConfig.maxTypingTimeMs);
      typingTime = Math.max(typingTime, typingConfig.minVisibleDurationMs);

      // Extra time for code blocks
      if (chunkToSend.includes("```")) {
        typingTime = Math.max(typingTime, typingConfig.minVisibleDurationMs * 1.25);
      }

      log.info(`Stream Sim: Typing for ${Math.round(typingTime)}ms`);

      // Use interruptible typing delay
      const cancelled = await this.interruptibleDelay(typingTime, context.channel.id);
      if (cancelled) {
        log.info("Stream Send: Stop request detected during typing simulation");
        return;
      }

      await this.sendSingleMessage(chunkToSend, context, state);

      // Add thinking pause between chunks
      if (i < chunks.length - 1 && typingConfig.randomPauseEnabled) {
        const pauseCancelled = await this.addThinkingPauseInterruptible(typingConfig, context);
        if (pauseCancelled) {
          log.info("Stream Send: Stop request detected during thinking pause");
          return;
        }
      }
    }
  }

  /**
   * Send message chunks immediately without typing simulation
   */
  private async sendChunksImmediate(chunks: string[], context: StreamContext, state: StreamState): Promise<void> {
    for (const chunk of chunks) {
      // Check for stop request before each message
      if (StreamOrchestrator.hasStopRequest(context.channel.id)) {
        log.info(`Stream Send: Stop request detected before sending chunk in immediate mode`);
        return;
      }

      await this.sendSingleMessage(chunk, context, state);
    }
  }

  /**
   * Send a single message to Discord with proper error handling
   * Supports webhook-based sending for alter personas with custom avatars/usernames
   * @param content - The message content to send
   * @param context - The stream context containing Discord channel and reply information
   * @param state - The current stream state to track message count
   * @throws Error if Discord API call fails
   */
  private async sendSingleMessage(content: string, context: StreamContext, state: StreamState): Promise<void> {
    await this.sendSinglePayload(
      {
        content,
      },
      content,
      context,
      state,
    );
  }

  private async sendSinglePayload(
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
  ): Promise<Message | null> {
    return await this.uiUpdater.sendSinglePayload(payload, textForState, context, state);
  }
  /**
   * Interruptible thinking pause that can be cancelled by stop requests
   * @param typingConfig - Typing simulation configuration
   * @param context - Stream context
   * @returns True if cancelled by stop request, false if completed normally
   */
  private async addThinkingPauseInterruptible(
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
  ): Promise<boolean> {
    const isThinkingPause = Math.random() < typingConfig.thinkingPauseChance;
    let pauseTime = Math.floor(
      DISCORD_STREAMING_CONSTANTS.MIN_RANDOM_PAUSE_MS +
        Math.random() *
          (DISCORD_STREAMING_CONSTANTS.MAX_RANDOM_PAUSE_MS - DISCORD_STREAMING_CONSTANTS.MIN_RANDOM_PAUSE_MS),
    );

    if (isThinkingPause) {
      pauseTime = Math.max(pauseTime * 1.5, typingConfig.minVisibleDurationMs);
    }

    log.info(`Stream Sim: Pausing for ${Math.round(pauseTime)}ms${isThinkingPause ? " (thinking pause)" : ""}`);

    return await this.interruptibleDelay(pauseTime, context.channel.id);
  }

  /**
   * Create an interruptible delay that can be cancelled by stop requests
   * @param delayMs - Delay time in milliseconds
   * @param channelId - Channel ID to check for stop requests
   * @returns True if cancelled by stop request, false if completed normally
   */
  private async interruptibleDelay(delayMs: number, channelId: string): Promise<boolean> {
    const checkInterval = Math.min(250, delayMs / 4); // Check every 250ms or 1/4 of delay, whichever is smaller
    const endTime = Date.now() + delayMs;

    while (Date.now() < endTime) {
      // Check for stop request
      if (StreamOrchestrator.hasStopRequest(channelId)) {
        return true; // Cancelled
      }

      // Wait for the check interval or remaining time, whichever is smaller
      const timeLeft = endTime - Date.now();
      const waitTime = Math.min(checkInterval, timeLeft);

      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    return false; // Completed normally
  }

  /**
   * Flush any remaining buffer content at the end of streaming
   */
  private async flushFinalBuffer(
    state: StreamState,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
  ): Promise<void> {
    if (state.buffer.length > 0) {
      const blockStatus = state.isInsideCodeBlock
        ? "still in code block"
        : state.hasSemanticMarkers
          ? "contains semantic markers"
          : "regular";

      log.info(`Stream Seg: Flushing final buffer content (${blockStatus}): "${state.buffer}"`);

      if (state.isInsideCodeBlock) {
        log.warn("Stream Seg: Final flush occurred while still inside a code block. The block might be incomplete.");
      }

      if (state.hasSemanticMarkers) {
        log.info("Stream Seg: Final flush has incomplete semantic markers. Auto-closing them to prevent message loss.");
        // Auto-close incomplete markers to prevent message loss
        state.buffer = autoCloseStreamBufferMarkers(state.buffer);
      }

      await this.sendBufferSegment(state.buffer, "final", textConfig, typingConfig, context, state);
      state.buffer = "";
      state.isInsideCodeBlock = false;
      state.hasSemanticMarkers = false;
    }

    // Release any held orphan punctuation that never found a following segment to
    // attach to before final delivery.
    await this.flushHeldOrphanPunctuation("final", textConfig, typingConfig, context, state);
    if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE) {
      await this.flushAggregatedTextBuffer(textConfig, context, state);
    }

    // Route any think block content that was still accumulating when the stream ended.
    // Never send incomplete think content to Discord — discard or route to thought log.
    if (state.isInsideThinkBlock && state.thinkBlockBuffer.trim()) {
      const thinkContent = state.thinkBlockBuffer.trim();
      state.thoughtRawSegments.push(thinkContent);
      log.info(
        `Stream Seg: Captured ${thinkContent.length} chars of unterminated think block to thought log on final flush`,
      );
      state.thinkBlockBuffer = "";
      state.isInsideThinkBlock = false;
    }

    // Route any details block content that was still accumulating when the stream ended.
    // Never send incomplete details content to Discord — route to detailsSegments for STM.
    if (state.isInsideDetailsBlock && state.detailsBlockBuffer.trim()) {
      const detailsContent = stripSummaryTag(state.detailsBlockBuffer);
      if (detailsContent) {
        state.detailsSegments.push(detailsContent);
        log.info(
          `Stream Seg: Captured ${detailsContent.length} chars of unterminated details block to STM on final flush`,
        );
      }
      state.detailsBlockBuffer = "";
      state.isInsideDetailsBlock = false;
    }
  }

  /**
   * Flush pending buffer before function calls
   */
  private async flushPendingBuffer(
    state: StreamState,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    trimTrailingIncompleteClause: boolean = false,
  ): Promise<void> {
    if (state.isInsideThinkBlock) {
      const thinkContent = state.thinkBlockBuffer.trim();
      if (thinkContent) {
        state.thoughtRawSegments.push(thinkContent);
        log.info(`Stream Seg: Captured ${thinkContent.length} chars of think block to thought log before flush`);
      }
      state.thinkBlockBuffer = "";
      state.isInsideThinkBlock = false;
    }

    if (state.isInsideDetailsBlock) {
      const detailsContent = stripSummaryTag(state.detailsBlockBuffer);
      if (detailsContent) {
        state.detailsSegments.push(detailsContent);
        log.info(`Stream Seg: Captured ${detailsContent.length} chars of details block to STM before flush`);
      }
      state.detailsBlockBuffer = "";
      state.isInsideDetailsBlock = false;
    }

    if (state.isInsideCodeBlock) {
      log.warn("Stream Seg: Function call received while inside a code block. Flushing incomplete block.");
      state.isInsideCodeBlock = false;
    }

    if (state.hasSemanticMarkers) {
      log.info(
        "Stream Seg: Function call received with incomplete semantic markers. Auto-closing them before flushing.",
      );
      // Auto-close incomplete markers before function call
      state.buffer = autoCloseStreamBufferMarkers(state.buffer);
      state.hasSemanticMarkers = false;
    }

    let segmentToProcess = state.buffer;
    if (trimTrailingIncompleteClause) {
      const trimmedSegment = this.trimTrailingIncompleteClause(segmentToProcess);
      if (trimmedSegment !== segmentToProcess) {
        log.info(
          `Stream Seg: Removed trailing incomplete clause before function call (kept: ${trimmedSegment.length}, removed: ${segmentToProcess.length - trimmedSegment.length})`,
        );
        segmentToProcess = trimmedSegment;
      }
    }
    log.info(`Stream Seg: Flushing buffer for function call: "${segmentToProcess}"`);

    await this.sendBufferSegment(segmentToProcess, "tool_call", textConfig, typingConfig, context, state);
    await this.flushHeldOrphanPunctuation("tool_call", textConfig, typingConfig, context, state);
    if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE) {
      await this.flushAggregatedTextBuffer(textConfig, context, state);
    }
    state.buffer = "";
  }

  private trimTrailingIncompleteClause(text: string): string {
    if (!text) {
      return text;
    }

    const textWithoutTrailingWhitespace = text.replace(/\s+$/u, "");
    if (!textWithoutTrailingWhitespace) {
      return text;
    }

    // If text already ends at a sentence boundary, keep it as-is.
    if (/[.!?。！？…](?:[)"'\]\u300d\u300f\u300b\u3011]+)?$/u.test(textWithoutTrailingWhitespace)) {
      return text;
    }

    let lastBoundaryIndex = -1;
    for (let i = textWithoutTrailingWhitespace.length - 1; i >= 0; i--) {
      const ch = textWithoutTrailingWhitespace[i];
      if (/[.!?。！？…\n]/u.test(ch)) {
        lastBoundaryIndex = i;
        break;
      }
    }

    // No boundary found: avoid dropping the whole sentence.
    if (lastBoundaryIndex === -1) {
      return text;
    }

    const trimmedCore = textWithoutTrailingWhitespace.slice(0, lastBoundaryIndex + 1);
    const originalTrailingWhitespace = text.slice(textWithoutTrailingWhitespace.length);
    return `${trimmedCore}${originalTrailingWhitespace}`;
  }

  /**
   * Handle provider-specific errors
   */
  private async handleProviderError(error: unknown, provider: StreamProvider, context: StreamContext): Promise<void> {
    const providerError = error as ProviderError;
    // Use user's locale from context (prioritizes user language preference)
    const locale = context.locale;

    // Try to get provider-specific detailed error description first
    const providerDescription = provider.createErrorDescription(providerError, locale);

    // Fallback to generic localized error message if no provider description
    const errorMessage =
      providerDescription ||
      localizer(locale, "genai.stream.provider_error_interaction", {
        reason: providerError.type || "unknown",
      });

    log.warn(`Stream error: ${errorMessage}`, error);

    if (context.initialInteraction) {
      if (!context.initialInteraction.replied && !context.initialInteraction.deferred) {
        await context.initialInteraction
          .reply({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to reply to initial interaction with error", e));
      } else {
        await context.initialInteraction
          .followUp({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to followUp initial interaction with error", e));
      }
    } else {
      // Use provider-specific error description (already fetched above)
      if (providerDescription) {
        // Determine universal title and tip based on error type
        let titleKey: string;
        let tipKey: string;
        let color: ColorResolvable;

        switch (providerError.type) {
          case "rate_limit":
            titleKey = context.rotationKeyRetriesUsed
              ? "genai.stream.rate_limit_title_all_rotation_keys"
              : "genai.stream.rate_limit_title";
            tipKey = "genai.stream.rate_limit_tip";
            color = ColorCode.WARN;
            break;
          case "content_blocked":
            titleKey = "genai.stream.content_blocked_title";
            tipKey = "genai.stream.content_blocked_tip";
            color = ColorCode.ERROR;
            break;
          case "timeout":
            titleKey = "genai.stream.timeout_title";
            tipKey = "genai.stream.timeout_tip";
            color = ColorCode.WARN;
            break;
          case "provider_overloaded":
            titleKey = "genai.stream.provider_overloaded_title";
            tipKey = "genai.stream.provider_overloaded_tip";
            color = ColorCode.WARN;
            break;
          default:
            titleKey = "genai.stream.api_error_title";
            tipKey = "genai.stream.api_error_tip";
            color = providerError.retryable ? ColorCode.WARN : ColorCode.ERROR;
            break;
        }

        const hasFallbackModels = (context.tomoriState.fallback_llms?.length ?? 0) > 0;
        const shouldShowModelFallbackHint =
          !hasFallbackModels &&
          (providerError.type === "rate_limit" ||
            providerError.type === "provider_overloaded" ||
            providerError.code === "503");
        const footerText = shouldShowModelFallbackHint
          ? `${localizer(locale, tipKey)}\n${localizer(locale, "genai.stream.model_fallback_hint")}`
          : localizer(locale, tipKey);

        // Create provider-specific error embed manually since we have a direct description
        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle(localizer(locale, titleKey))
          .setDescription(providerDescription)
          .setFooter({
            text: footerText,
          });

        await context.channel
          .send({ embeds: [embed] })
          .catch((e) => log.warn("Stream: Failed to send provider error embed to channel", e));
        return;
      }

      // Fallback to generic error handling if provider returns null
      await sendStandardEmbed(context.channel, locale, {
        titleKey: "genai.stream.response_stopped_title",
        descriptionKey: "genai.stream.response_stopped_description",
        descriptionVars: {
          reason: providerError.type || "unknown",
        },
        color: ColorCode.ERROR,
      }).catch((e) => log.warn("Stream: Failed to send error embed to channel", e));
    }
  }

  /**
   * Handle general streaming errors
   */
  private async handleStreamError(error: Error, context: StreamContext): Promise<void> {
    const errorMessage = `An error occurred while streaming: ${error.message}`;

    if (context.initialInteraction) {
      if (!context.initialInteraction.replied && !context.initialInteraction.deferred) {
        await context.initialInteraction
          .reply({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to reply to initial interaction with error", e));
      } else {
        await context.initialInteraction
          .followUp({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to followUp initial interaction with error", e));
      }
    } else {
      await sendStandardEmbed(
        context.channel,
        "guild" in context.channel ? context.channel.guild.preferredLocale : "en-US",
        {
          titleKey: "genai.generic_error_title",
          descriptionKey: "genai.generic_error_description",
          descriptionVars: { error_message: error.message },
          color: ColorCode.ERROR,
        },
      ).catch((e) => log.warn("Stream: Failed to send generic error embed to channel", e));
    }
  }

  /**
   * Setup inactivity timer for stream timeout detection
   */
  private setupInactivityTimer(state: StreamState, config: StreamConfig, context: StreamContext): void {
    this.resetInactivityTimer(state, config, context);
  }

  /**
   * Reset the inactivity timer
   */
  private resetInactivityTimer(state: StreamState, config: StreamConfig, context: StreamContext): void {
    state.lastChunkTime = Date.now();
    state.timedOut = false;
    if (state.inactivityTimer) clearTimeout(state.inactivityTimer);

    state.inactivityTimer = setTimeout(() => {
      log.warn(`Stream to ${context.channel.id} timed out due to inactivity.`);
      state.timedOut = true;
      state.inactivityTimer = null;
    }, config.inactivityTimeoutMs);
  }

  /**
   * Clear the inactivity timer
   */
  private clearInactivityTimer(state: StreamState): void {
    if (state.inactivityTimer) {
      clearTimeout(state.inactivityTimer);
      state.inactivityTimer = null;
    }
  }

  /**
   * Check if stream has timed out
   */
  private isStreamTimedOut(state: StreamState): boolean {
    return state.timedOut;
  }

  /**
   * Create text processing configuration from stream config and context
   */
  private createTextProcessingConfig(config: StreamConfig, context: StreamContext): TextProcessingConfig {
    const { mentionMap, mentionIdSet } = this.buildMentionLookup(context.contextItems);
    this.applyForcedMentions(mentionMap, mentionIdSet, context.forcedMentions);
    const botName = context.prefixStrippingName ?? context.personaUsername ?? context.tomoriState.tomori_nickname;

    return {
      humanizerDegree: config.humanizerDegree,
      visibleDeliveryMode: getVisibleDeliveryMode(config.humanizerDegree),
      emojiUsageEnabled: config.emojiUsageEnabled,
      emojiStrings: context.emojiStrings || [],
      mentionMap,
      mentionIdSet,
      // Use prefixStrippingName for prefix stripping if provided (e.g., database nickname for user impersonation)
      // Falls back to personaUsername (webhook display name), then bot's nickname
      botName,
      registeredSpeakerNamesLower: this.collectRegisteredSpeakerNames(context.contextItems, botName),
      maxMessageLength: config.maxMessageLength,
      uncensorUnicodeSpacesEnabled: context.tomoriState.config.uncensor_unicode_space_enabled ?? false,
      uncensorSanitizeEnabled: context.tomoriState.config.uncensor_sanitize_enabled ?? false,
    };
  }

  private collectRegisteredSpeakerNames(
    contextItems: StructuredContextItem[],
    activeSpeakerName?: string,
  ): Set<string> {
    const registeredSpeakerNamesLower = new Set<string>();
    const activeSpeakerNameLower = activeSpeakerName?.trim().toLowerCase();

    for (const item of contextItems) {
      if (item.role !== "user" && item.role !== "model") {
        continue;
      }

      for (const part of item.parts) {
        if (part.type !== "text") {
          continue;
        }

        const lines = part.text.split("\n");
        for (const line of lines) {
          const match = line.match(/^\s*([^\n:]{1,64}):\s*/);
          if (!match?.[1]) {
            continue;
          }

          const rawName = match[1].trim();
          if (!rawName) {
            continue;
          }

          if (rawName.startsWith("[") || rawName.startsWith("<")) {
            continue;
          }

          const normalizedName = rawName.toLowerCase();
          if (activeSpeakerNameLower && normalizedName === activeSpeakerNameLower) {
            continue;
          }

          registeredSpeakerNamesLower.add(normalizedName);
        }
      }
    }

    return registeredSpeakerNamesLower;
  }

  private applyForcedMentions(
    mentionMap: Map<string, string[]>,
    mentionIdSet: Set<string>,
    forcedMentions?: Array<{ handle: string; userId: string }>,
  ): void {
    if (!forcedMentions || forcedMentions.length === 0) return;

    for (const mention of forcedMentions) {
      const handle = mention.handle?.trim();
      const userId = mention.userId?.trim();
      if (!handle || !userId) continue;

      mentionIdSet.add(userId);
      const normalizedHandle = handle.toLowerCase();
      const existing = mentionMap.get(normalizedHandle) ?? [];
      if (!existing.includes(userId)) {
        existing.push(userId);
        mentionMap.set(normalizedHandle, existing);
      }
    }
  }

  private buildMentionLookup(contextItems: StructuredContextItem[]): {
    mentionMap: Map<string, string[]>;
    mentionIdSet: Set<string>;
  } {
    const mentionMap = new Map<string, string[]>();
    const mentionIdSet = new Set<string>();

    for (const item of contextItems) {
      if (
        item.metadataTag !== ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION ||
        !item.conversationUsers ||
        item.conversationUsers.length === 0
      ) {
        continue;
      }

      for (const conversationUser of item.conversationUsers) {
        if (!conversationUser.mentionable || !/^\d{17,20}$/.test(conversationUser.targetId)) {
          continue;
        }

        mentionIdSet.add(conversationUser.targetId);

        for (const alias of conversationUser.aliases) {
          const normalizedHandle = alias.trim().toLowerCase();
          if (!normalizedHandle) {
            continue;
          }

          const existing = mentionMap.get(normalizedHandle) ?? [];
          if (!existing.includes(conversationUser.targetId)) {
            existing.push(conversationUser.targetId);
          }
          mentionMap.set(normalizedHandle, existing);
        }
      }
    }

    return { mentionMap, mentionIdSet };
  }

  /**
   * Check if a completed stream result represents an empty response
   * @param result - The stream result to check
   * @returns True if the result indicates no messages were sent
   */
  private wasEmptyResponse(result: StreamResult & { messageSentCount?: number }): boolean {
    // If the result has a messageSentCount property and it's 0, it's empty
    if ("messageSentCount" in result && typeof result.messageSentCount === "number") {
      return result.messageSentCount === 0;
    }

    // Fallback: assume non-empty if we can't determine
    return false;
  }
}
