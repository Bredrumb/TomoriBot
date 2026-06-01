import { AttachmentBuilder, type Message } from "discord.js";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import type { StreamState, TextProcessingConfig, TypingSimulationConfig } from "@/types/stream/types";
import { VisibleDeliveryMode, DISCORD_STREAMING_CONSTANTS } from "@/types/stream/types";
import { log } from "@/utils/misc/logger";
import { renderMarkdownTableToPng } from "@/utils/image/markdownTableRenderer";
import { setCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { extractMarkdownTableSegments, MARKDOWN_TABLE_ATTACHMENT_PREFIX } from "@/utils/text/markdownTable";
import { chunkMessage } from "@/utils/text/processors/chunkProcessor";
import { humanizeString } from "@/utils/text/processors/formatters";
import { PREFILL_WHITESPACE_SENTINEL } from "@/utils/discord/stream/constants";
import type { StreamSendPayload, StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";

export type BufferedDeliveryBoundary =
  | "code_open"
  | "code_close"
  | "newline"
  | "period"
  | "overflow"
  | "attachment"
  | "final"
  | "tool_call";

type StreamMessageDeliveryDependencies = {
  hasStopRequest: (channelId: string) => boolean;
  uiUpdater: StreamUiUpdater;
};

/**
 * Owns Discord message delivery, typing simulation, aggregate-mode flushing, and table attachments.
 */
export class StreamMessageDelivery {
  public constructor(private readonly deps: StreamMessageDeliveryDependencies) {}

  public hasPendingAggregatedText(state: StreamState): boolean {
    return Boolean(state.pendingAggregatedText.trim());
  }

  public queueAggregatedSegment(
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

  public async flushAggregatedTextBuffer(
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
      chunk.replaceAll(PREFILL_WHITESPACE_SENTINEL, ""),
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

  public async flushHeldOrphanPunctuation(
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

  public async sendRenderedMarkdownTable(
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

  public async sendSegment(
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

    const rawMessageChunks = chunkMessage(segment, textConfig.humanizerDegree, textConfig.maxMessageLength).map(
      (chunk) => chunk.replaceAll(PREFILL_WHITESPACE_SENTINEL, ""),
    );
    if (!rawMessageChunks.length) return;

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

    if (typingConfig.enabled) {
      await this.sendChunksWithTyping(finalMessageChunks, typingConfig, context, state);
    } else {
      await this.sendChunksImmediate(finalMessageChunks, context, state);
    }
  }

  public async sendSinglePayload(
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
  ): Promise<Message | null> {
    return await this.deps.uiUpdater.sendSinglePayload(payload, textForState, context, state);
  }

  private async sendChunksWithTyping(
    chunks: string[],
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    if (this.deps.hasStopRequest(context.channel.id)) {
      log.info("Stream Send: Stop request detected before sending chunks with typing");
      return;
    }

    const firstChunk = chunks[0];
    await this.sendSingleMessage(firstChunk, context, state);

    for (let i = 1; i < chunks.length; i++) {
      if (this.deps.hasStopRequest(context.channel.id)) {
        log.info(`Stream Send: Stop request detected before sending chunk ${i + 1}/${chunks.length}`);
        return;
      }

      const chunkToSend = chunks[i];
      let typingTime = Math.min(chunkToSend.length * typingConfig.baseSpeedMsPerChar, typingConfig.maxTypingTimeMs);
      typingTime = Math.max(typingTime, typingConfig.minVisibleDurationMs);
      if (chunkToSend.includes("```")) {
        typingTime = Math.max(typingTime, typingConfig.minVisibleDurationMs * 1.25);
      }

      log.info(`Stream Sim: Typing for ${Math.round(typingTime)}ms`);
      const cancelled = await this.interruptibleDelay(typingTime, context.channel.id);
      if (cancelled) {
        log.info("Stream Send: Stop request detected during typing simulation");
        return;
      }

      await this.sendSingleMessage(chunkToSend, context, state);

      if (i < chunks.length - 1 && typingConfig.randomPauseEnabled) {
        const pauseCancelled = await this.addThinkingPauseInterruptible(typingConfig, context);
        if (pauseCancelled) {
          log.info("Stream Send: Stop request detected during thinking pause");
          return;
        }
      }
    }
  }

  private async sendChunksImmediate(chunks: string[], context: StreamContext, state: StreamState): Promise<void> {
    for (const chunk of chunks) {
      if (this.deps.hasStopRequest(context.channel.id)) {
        log.info("Stream Send: Stop request detected before sending chunk in immediate mode");
        return;
      }

      await this.sendSingleMessage(chunk, context, state);
    }
  }

  private async sendSingleMessage(content: string, context: StreamContext, state: StreamState): Promise<void> {
    await this.sendSinglePayload({ content }, content, context, state);
  }

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

  private async interruptibleDelay(delayMs: number, channelId: string): Promise<boolean> {
    const checkInterval = Math.min(250, delayMs / 4);
    const endTime = Date.now() + delayMs;

    while (Date.now() < endTime) {
      if (this.deps.hasStopRequest(channelId)) {
        return true;
      }

      const timeLeft = endTime - Date.now();
      const waitTime = Math.min(checkInterval, timeLeft);
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    return false;
  }
}
