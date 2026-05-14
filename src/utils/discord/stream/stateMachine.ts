import type { Client, Message } from "discord.js";
import type { StreamResult } from "@/types/provider/interfaces";
import type {
  StreamOrchestrator as IStreamOrchestrator,
  ProcessedChunk,
  StreamConfig,
  StreamContext,
  StreamProvider,
} from "@/types/stream/interfaces";
import {
  type StreamMetrics,
  type StreamState,
  type TextProcessingConfig,
  type TypingSimulationConfig,
  createDefaultStreamMetrics,
  createDefaultStreamState,
  createTypingSimulationConfig,
  VisibleDeliveryMode,
} from "@/types/stream/types";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { StreamBufferFlusher } from "@/utils/discord/stream/bufferFlusher";
import { StreamErrorUi } from "@/utils/discord/stream/errorUi";
import { StreamMessageDelivery } from "@/utils/discord/stream/messageDelivery";
import { StreamSegmentProcessor } from "@/utils/discord/stream/segmentProcessor";
import {
  cleanupOldStopRequests,
  clearStopRequest,
  deleteStopRequest,
  getAndClearStopContext,
  getStopReason,
  hasStopRequest,
  isFollowUpRequest,
  isSilentSpeakerGuardStop,
  peekStopRequest,
  requestFollowUp,
  requestStop,
  type StreamStopContext,
} from "@/utils/discord/stream/stopRequests";
import { isUserImpersonationStreamContext, StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import { createStreamTextProcessingConfig } from "@/utils/discord/stream/textConfig";
import { appendChunkThoughts, buildThoughtLogPayload, wasEmptyStreamResponse } from "@/utils/discord/stream/thoughtLog";
import { ColorCode, log } from "@/utils/misc/logger";

/**
 * Coordinates provider streaming as a state machine while delegating buffer, stop, UI, and error responsibilities.
 */
export class StreamOrchestrator implements IStreamOrchestrator {
  private readonly uiUpdater = new StreamUiUpdater({
    hasStopRequest: (channelId) => hasStopRequest(channelId),
    requestStop: (channelId, requesterId) => requestStop(channelId, requesterId),
    notifyStreamProgress: (context) => this.notifyStreamProgress(context),
  });

  private readonly delivery = new StreamMessageDelivery({
    hasStopRequest: (channelId) => hasStopRequest(channelId),
    uiUpdater: this.uiUpdater,
  });

  private readonly segmentProcessor = new StreamSegmentProcessor({
    delivery: this.delivery,
    requestStop: (channelId, requesterId) => requestStop(channelId, requesterId),
  });

  private readonly bufferFlusher = new StreamBufferFlusher({
    hasStopRequest: (channelId) => hasStopRequest(channelId),
    delivery: this.delivery,
    segmentProcessor: this.segmentProcessor,
  });

  private readonly errorUi = new StreamErrorUi();

  public static requestStop(channelId: string, requesterId?: string, stopContext?: StreamStopContext): boolean {
    return requestStop(channelId, requesterId, stopContext);
  }

  public static hasStopRequest(channelId: string): boolean {
    return hasStopRequest(channelId);
  }

  public static clearStopRequest(channelId: string): void {
    clearStopRequest(channelId);
  }

  public static getAndClearStopContext(channelId: string): { originalStopMessage: Message; client: Client } | null {
    return getAndClearStopContext(channelId);
  }

  public static requestFollowUp(channelId: string, requesterId: string): boolean {
    return requestFollowUp(channelId, requesterId);
  }

  public static isFollowUpRequest(channelId: string): boolean {
    return isFollowUpRequest(channelId);
  }

  public static cleanupOldStopRequests(maxAgeMs?: number): void {
    cleanupOldStopRequests(maxAgeMs);
  }

  async streamToDiscord(provider: StreamProvider, config: StreamConfig, context: StreamContext): Promise<StreamResult> {
    log.section("Universal Stream Orchestrator Started");
    log.info(
      `Starting stream to channel ${context.channel.id} (server: ${"guild" in context.channel ? context.channel.guild.id : "DM"}) using provider: ${provider.getProviderInfo().name}`,
    );

    const result = await this.executeStream(provider, config, context);
    if (result.status === "completed" && wasEmptyStreamResponse(result)) {
      log.info("Empty response detected. Returning empty_response status for retry at tomoriChat level.");
      return {
        status: "empty_response",
        data: result.data,
        naiContinuationPrefill: result.naiContinuationPrefill,
      };
    }

    return result;
  }

  private async executeStream(
    provider: StreamProvider,
    config: StreamConfig,
    context: StreamContext,
  ): Promise<StreamResult & { messageSentCount?: number }> {
    const metrics = createDefaultStreamMetrics();
    const state = createDefaultStreamState();
    const textConfig = createStreamTextProcessingConfig(config, context);
    const typingConfig = createTypingSimulationConfig(config.humanizerDegree);
    let terminalDoneMetadata: Record<string, unknown> | undefined;
    let lastError: Error | undefined;

    try {
      this.setupInactivityTimer(state, config, context);
      await this.segmentProcessor.prepareOutputPrefill(context, textConfig, state);

      const streamGenerator = provider.startStream(config, context);
      const preStreamStop = await this.tryResolvePreStreamStop(context);
      if (preStreamStop) {
        return preStreamStop;
      }

      for await (const rawChunk of streamGenerator) {
        const stopResult = await this.tryResolveLoopStop(state, config, context, textConfig);
        if (stopResult) {
          return stopResult;
        }

        if (context.abortSignal?.aborted) {
          log.warn(`Stream loop breaking due to external abort signal for channel ${context.channel.id}.`);
          this.clearInactivityTimer(state);
          return { status: "error", data: new Error("Stream aborted by SDK call timeout") };
        }

        if (this.isStreamTimedOut(state)) {
          log.warn(`Stream loop breaking due to timeout for channel ${context.channel.id}.`);
          break;
        }

        this.resetInactivityTimer(state, config, context);
        this.notifyStreamProgress(context);
        metrics.totalChunks++;

        const processedChunk = provider.processChunk(rawChunk);
        appendChunkThoughts(state, processedChunk.thoughts);
        if (processedChunk.type === "done" && processedChunk.metadata) {
          terminalDoneMetadata = processedChunk.metadata;
        }

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

        if (result.status !== "continue") {
          this.clearInactivityTimer(state);
          return result;
        }
      }

      return await this.completeStreamAfterProviderEnd(
        state,
        textConfig,
        typingConfig,
        context,
        metrics,
        terminalDoneMetadata,
      );
    } catch (error) {
      this.clearInactivityTimer(state);
      lastError = error as Error;
      clearStopRequest(context.channel.id);
      log.error(`Stream orchestrator failed: ${lastError.message}`, lastError, {
        serverId: context.tomoriState.server_id,
        errorType: "StreamOrchestrator",
        metadata: {
          channelId: context.channel.id,
          provider: provider.getProviderInfo().name,
        },
      });

      if (!context.suppressUserErrors && !isUserImpersonationStreamContext(context)) {
        await this.errorUi.handleStreamError(lastError, context);
      } else {
        log.warn("Stream: Suppressing stream error embed due to retryable failure", lastError);
      }

      return { status: "error", data: lastError };
    }
  }

  private async tryResolvePreStreamStop(context: StreamContext): Promise<StreamResult | null> {
    if (!hasStopRequest(context.channel.id)) {
      return null;
    }

    if (isFollowUpRequest(context.channel.id)) {
      log.info(
        `Follow-up interrupt detected before stream started for channel ${context.channel.id}. Returning immediately.`,
      );
      deleteStopRequest(context.channel.id);
      return { status: "follow_up_interrupt" };
    }

    log.info(`Kill request detected before stream started for channel ${context.channel.id}. Aborting stream.`);
    const preStreamStopRequest = peekStopRequest(context.channel.id);
    const preStreamStopReason = getStopReason(preStreamStopRequest);
    clearStopRequest(context.channel.id);
    return { status: "stopped_by_user", stopReason: preStreamStopReason };
  }

  private async tryResolveLoopStop(
    state: StreamState,
    config: StreamConfig,
    context: StreamContext,
    textConfig: TextProcessingConfig,
  ): Promise<StreamResult | null> {
    if (!hasStopRequest(context.channel.id)) {
      return null;
    }

    if (isFollowUpRequest(context.channel.id)) {
      log.info(`Stream interrupted by follow-up message for channel ${context.channel.id}. Skipping buffer flush.`);
      deleteStopRequest(context.channel.id);
      return { status: "follow_up_interrupt" };
    }

    log.info(`Stream loop breaking due to stop request for channel ${context.channel.id}.`);
    const stopRequest = peekStopRequest(context.channel.id);
    const stopReason = getStopReason(stopRequest);
    const shouldSkipBufferFlush =
      (stopRequest?.requesterId === "flush_limit" || stopRequest?.requesterId === "speaker_guard") &&
      !stopRequest?.stopContext;

    clearStopRequest(context.channel.id);
    if ((state.buffer.length > 0 || this.delivery.hasPendingAggregatedText(state)) && !shouldSkipBufferFlush) {
      await this.bufferFlusher.flushPendingBuffer(
        state,
        createStreamTextProcessingConfig(config, context),
        createTypingSimulationConfig(config.humanizerDegree),
        context,
      );
    } else if (
      stopRequest?.requesterId === "speaker_guard" &&
      this.delivery.hasPendingAggregatedText(state) &&
      textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE
    ) {
      await this.delivery.flushAggregatedTextBuffer(textConfig, context, state);
    } else if (shouldSkipBufferFlush) {
      log.info("Stream: Skipping buffer flush due to internal no-flush stop");
    }

    if (isSilentSpeakerGuardStop(stopRequest?.requesterId, state)) {
      log.warn("Stream: Silent speaker-guard stop produced no user-visible output; treating as empty response.");
      return { status: "empty_response", data: { emptyResponseReason: "speaker_guard" } };
    }

    return { status: "stopped_by_user", stopReason };
  }

  private async handleProcessedChunk(
    chunk: ProcessedChunk,
    provider: StreamProvider,
    config: StreamConfig,
    context: StreamContext,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    state: StreamState,
    metrics: StreamMetrics,
  ): Promise<StreamResult | { status: "continue" }> {
    switch (chunk.type) {
      case "error":
        return await this.handleChunkError(chunk, provider, context, textConfig, typingConfig, state);
      case "function_call":
        if (chunk.functionCall) {
          if (state.buffer.length > 0 || this.delivery.hasPendingAggregatedText(state)) {
            await this.bufferFlusher.flushPendingBuffer(state, textConfig, typingConfig, context, true);
            if (hasStopRequest(context.channel.id)) {
              return {
                status: "stopped_by_user",
                stopReason: getStopReason(peekStopRequest(context.channel.id)),
              };
            }
          }
          return {
            status: "function_call",
            data: chunk.functionCall,
            accumulatedText: state.accumulatedText,
            detailsContent: state.detailsSegments.length > 0 ? state.detailsSegments.join("\n\n") : undefined,
            thoughtLog: buildThoughtLogPayload(state, Date.now() - metrics.startTime),
          };
        }
        break;
      case "text":
        if (chunk.content) {
          await this.bufferFlusher.processTextChunk(
            chunk.content,
            config,
            context,
            textConfig,
            typingConfig,
            state,
            metrics,
          );
        }
        break;
      case "done": {
        const terminalFinishReason =
          typeof chunk.metadata?.finishReason === "string" ? chunk.metadata.finishReason : null;
        if (terminalFinishReason === "length") {
          log.warn(
            `Stream ended with finish_reason=length (output token cap). messageSentCount=${state.messageSentCount}, bufferChars=${state.buffer.length}, accumulatedChars=${state.accumulatedText.length}`,
          );
        }
        break;
      }
    }

    return { status: "continue" };
  }

  private async handleChunkError(
    chunk: ProcessedChunk,
    provider: StreamProvider,
    context: StreamContext,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    state: StreamState,
  ): Promise<StreamResult | { status: "continue" }> {
    if (!chunk.error) {
      return { status: "continue" };
    }

    if (state.buffer.length > 0 || this.delivery.hasPendingAggregatedText(state)) {
      log.info(
        `Stream: Flushing ${state.buffer.length} chars of buffered text before error handling` +
          `${this.delivery.hasPendingAggregatedText(state) ? ` (queued aggregate: ${state.pendingAggregatedText.length})` : ""}`,
      );
      await this.bufferFlusher.flushPendingBuffer(state, textConfig, typingConfig, context);
      if (hasStopRequest(context.channel.id)) {
        return {
          status: "stopped_by_user",
          stopReason: getStopReason(peekStopRequest(context.channel.id)),
        };
      }
    }

    if (!context.suppressUserErrors && !isUserImpersonationStreamContext(context)) {
      await this.errorUi.handleProviderError(chunk.error, provider, context);
    } else {
      log.warn("Stream: Suppressing provider error embed due to retryable failure", chunk.error);
    }
    return { status: "error", data: chunk.error };
  }

  private async completeStreamAfterProviderEnd(
    state: StreamState,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    metrics: StreamMetrics,
    terminalDoneMetadata: Record<string, unknown> | undefined,
  ): Promise<StreamResult & { messageSentCount?: number }> {
    this.clearInactivityTimer(state);
    if (this.isStreamTimedOut(state)) {
      if (!isUserImpersonationStreamContext(context)) {
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

      return { status: "timeout", data: new Error("Stream timed out due to inactivity.") };
    }

    await this.bufferFlusher.flushFinalBuffer(state, textConfig, typingConfig, context);
    if (peekStopRequest(context.channel.id)?.requesterId === "speaker_guard") {
      clearStopRequest(context.channel.id);
    }

    metrics.endTime = Date.now();
    log.success(
      `Stream to channel ${context.channel.id} completed. Messages sent: ${state.messageSentCount}, Duration: ${metrics.endTime - metrics.startTime}ms`,
    );

    return {
      status: "completed",
      messageSentCount: state.messageSentCount,
      accumulatedText: state.accumulatedText,
      detailsContent: state.detailsSegments.length > 0 ? state.detailsSegments.join("\n\n") : undefined,
      thoughtLog: buildThoughtLogPayload(state, metrics.endTime - metrics.startTime),
      data: terminalDoneMetadata,
    };
  }

  private notifyStreamProgress(context: StreamContext): void {
    context.onStreamProgress?.();
  }

  private setupInactivityTimer(state: StreamState, config: StreamConfig, context: StreamContext): void {
    this.resetInactivityTimer(state, config, context);
  }

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

  private clearInactivityTimer(state: StreamState): void {
    if (state.inactivityTimer) {
      clearTimeout(state.inactivityTimer);
      state.inactivityTimer = null;
    }
  }

  private isStreamTimedOut(state: StreamState): boolean {
    return state.timedOut;
  }
}
