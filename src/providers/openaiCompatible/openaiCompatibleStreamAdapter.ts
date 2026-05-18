import {
  buildOpenAICompatibleMessages,
  logSanitizedOpenAICompatibleRequest,
} from "@/providers/openaiCompatible/openaiCompatibleMessageBuilder";
import {
  createOpenAICompatibleErrorDescription,
  createOpenAICompatibleHttpError,
  normalizeOpenAICompatibleProviderError,
} from "@/providers/openaiCompatible/openaiCompatibleErrorFormatter";
import { streamOpenAICompatibleSseChunks } from "@/providers/openaiCompatible/openaiCompatibleSse";
import type {
  OpenAICompatibleAccumulatedToolCall,
  OpenAICompatibleStreamAdapterOptions,
  OpenAICompatibleStreamChunk,
  OpenAICompatibleStreamConfig,
  OpenAICompatibleToolCallDelta,
} from "@/providers/openaiCompatible/openaiCompatibleTypes";
import type { FunctionCall, ThoughtLogEntry } from "@/types/provider/interfaces";
import type {
  ProcessedChunk,
  ProviderError,
  RawStreamChunk,
  StreamConfig,
  StreamContext,
} from "@/types/stream/interfaces";
import { BaseStreamAdapter } from "@/types/stream/interfaces";
import { log } from "@/utils/misc/logger";
import { isParamDisabled } from "@/utils/provider/samplingControl";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { localizer } from "@/utils/text/localizer";
import { truncateBeforeGenericSpeakerLine } from "@/utils/text/processors/llmOutputProcessor";
import { buildProviderStopStrings } from "@/providers/utils/stopStrings";

export class OpenAICompatibleStreamAdapter extends BaseStreamAdapter {
  private static readonly SPEAKER_GUARD_HOLDBACK_CHARS = 32;
  private static readonly STREAM_TEXT_TAIL_CHARS = 4096;
  private static readonly STREAM_TEXT_MIN_DEDUP_CHARS = 8;

  private readonly toolCallAccumulator = new Map<number, OpenAICompatibleAccumulatedToolCall>();
  private speakerGuardPendingTail = "";
  private streamedTextTail = "";
  private accumulatedReasoningContent = "";
  private insideThinkBlock = false;
  private pendingThinkBlockThoughtText = "";
  private speakerGuardEnabled = false;

  constructor(private readonly options: OpenAICompatibleStreamAdapterOptions) {
    super({
      name: options.providerName,
      version: options.version ?? "1.0.0",
      supportsFunctionCalling: true,
    });
  }

  async *startStream(config: StreamConfig, context: StreamContext): AsyncGenerator<RawStreamChunk, void, unknown> {
    const openAICompatibleConfig = config as OpenAICompatibleStreamConfig;
    log.info(`${this.options.adapterName}: Initializing OpenAI-compatible streaming`);

    this.toolCallAccumulator.clear();
    this.streamedTextTail = "";
    this.accumulatedReasoningContent = "";
    this.insideThinkBlock = false;
    this.pendingThinkBlockThoughtText = "";

    const apiUrl = this.options.resolveApiUrl(openAICompatibleConfig);
    if (!apiUrl) {
      throw new Error("OpenAI-compatible endpoint URL is required");
    }

    log.info(`${this.options.adapterName}: Using API URL: ${apiUrl}`);

    this.speakerGuardPendingTail = "";

    // Determine whether the resolved endpoint accepts system-role messages.
    // The supportsSystemRole callback receives the final API URL and model so
    // that adapters (e.g. Custom/Chatmock) can opt out of the system role on
    // a per-request basis.  Defaults to true when not provided.
    const supportsSystemRole = this.options.supportsSystemRole?.(apiUrl, config.model ?? "") ?? true;

    const messages = await buildOpenAICompatibleMessages({
      adapterName: this.options.adapterName,
      contextItems: context.contextItems,
      currentTurnModelParts: context.currentTurnModelParts,
      functionInteractionHistory: context.functionInteractionHistory,
      seesImages: openAICompatibleConfig.seesImages ?? false,
      supportsSystemRole,
    });

    if (!config.model) {
      throw new Error("Model must be specified in config");
    }

    log.info(`${this.options.adapterName}: Using model ${config.model}`);
    if (config.tools && Array.isArray(config.tools) && config.tools.length > 0) {
      log.info(`${this.options.adapterName}: Tools:\n${JSON.stringify(config.tools, null, 2)}`);
    }

    logSanitizedOpenAICompatibleRequest(this.options.adapterName, messages);

    try {
      const disabledParams = config.disabledParams ?? [];
      const requestBody: Record<string, unknown> = {
        model: config.model,
        messages,
        stream: true,
      };
      if (!isParamDisabled(disabledParams, "temperature")) {
        requestBody.temperature = config.temperature;
      }

      const speakerStopPatternEnabled = context.tomoriState.config.llm_stop_speaker_pattern_enabled ?? false;
      const includePersonaSpeakerStop = speakerStopPatternEnabled && this.options.includePersonaSpeakerStop !== false;
      this.speakerGuardEnabled = speakerStopPatternEnabled && this.options.enableSpeakerGuard !== false;
      if (this.speakerGuardEnabled) {
        log.info(`${this.options.adapterName}: Speaker-boundary fallback guard enabled`);
      }
      const stopStrings = buildProviderStopStrings({
        providerName: this.options.providerName,
        model: config.model,
        personaName: context.tomoriState.persona_nickname,
        configuredStops: context.tomoriState.config.llm_stop_strings,
        includePersonaSpeakerStop,
      });
      if (stopStrings) {
        requestBody.stop = stopStrings;
      }

      if (config.maxOutputTokens !== undefined) {
        requestBody.max_tokens = config.maxOutputTokens;
      }
      if (config.tools && config.tools.length > 0) {
        requestBody.tools = config.tools;
      }
      if (openAICompatibleConfig.topP !== undefined && !isParamDisabled(disabledParams, "topP")) {
        requestBody.top_p = openAICompatibleConfig.topP;
      }
      if (openAICompatibleConfig.topK !== undefined && !isParamDisabled(disabledParams, "topK")) {
        requestBody.top_k = openAICompatibleConfig.topK;
      }
      if (
        openAICompatibleConfig.frequencyPenalty !== undefined &&
        !isParamDisabled(disabledParams, "frequencyPenalty")
      ) {
        requestBody.frequency_penalty = openAICompatibleConfig.frequencyPenalty;
      }
      if (openAICompatibleConfig.presencePenalty !== undefined && !isParamDisabled(disabledParams, "presencePenalty")) {
        requestBody.presence_penalty = openAICompatibleConfig.presencePenalty;
      }
      if (openAICompatibleConfig.repetitionPenalty !== undefined) {
        requestBody.repetition_penalty = openAICompatibleConfig.repetitionPenalty;
      }
      if (openAICompatibleConfig.minP !== undefined && !isParamDisabled(disabledParams, "minP")) {
        requestBody.min_p = openAICompatibleConfig.minP;
      }
      if (openAICompatibleConfig.logitBias !== undefined) {
        requestBody.logit_bias = openAICompatibleConfig.logitBias;
      }

      await this.options.mutateRequestBody?.({
        requestBody,
        config: openAICompatibleConfig,
        context,
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      if (config.apiKey && config.apiKey.trim() !== "" && config.apiKey !== this.options.placeholderApiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
      }

      await this.options.mutateHeaders?.({
        headers,
        config: openAICompatibleConfig,
        context,
      });

      const effectiveTemperatureLabel = "temperature" in requestBody ? String(config.temperature) : "omitted";
      const effectiveTopPLabel =
        openAICompatibleConfig.topP !== undefined && "top_p" in requestBody
          ? String(openAICompatibleConfig.topP)
          : "omitted";
      const effectiveTopKLabel =
        openAICompatibleConfig.topK !== undefined && "top_k" in requestBody
          ? String(openAICompatibleConfig.topK)
          : "omitted";
      const effectiveFrequencyPenaltyLabel =
        openAICompatibleConfig.frequencyPenalty !== undefined && "frequency_penalty" in requestBody
          ? String(openAICompatibleConfig.frequencyPenalty)
          : "omitted";
      const effectivePresencePenaltyLabel =
        openAICompatibleConfig.presencePenalty !== undefined && "presence_penalty" in requestBody
          ? String(openAICompatibleConfig.presencePenalty)
          : "omitted";
      const effectiveMinPLabel =
        openAICompatibleConfig.minP !== undefined && "min_p" in requestBody
          ? String(openAICompatibleConfig.minP)
          : "omitted";
      log.info(
        `${this.options.adapterName}: Sampling params - temp: ${effectiveTemperatureLabel}, top_p: ${effectiveTopPLabel}, top_k: ${effectiveTopKLabel}, freq_penalty: ${effectiveFrequencyPenaltyLabel}, pres_penalty: ${effectivePresencePenaltyLabel}, rep_penalty: ${openAICompatibleConfig.repetitionPenalty ?? "default"}, min_p: ${effectiveMinPLabel}, logit_bias: ${Object.keys(openAICompatibleConfig.logitBias ?? {}).length}`,
      );

      // Create AbortController and link to external abort signal (SDK call timeout)
      const controller = new AbortController();
      if (context.abortSignal) {
        if (context.abortSignal.aborted) {
          controller.abort();
        } else {
          context.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
        }
      }

      const fetchImpl = this.options.providerName === "custom" ? fetchUserRemoteUrl : fetch;

      let response = await fetchImpl(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      let responseErrorText: string | null = null;
      if (!response.ok) {
        responseErrorText = await response.text();

        if (requestBody.stop && this.options.shouldRetryWithoutStop?.(response.status, responseErrorText)) {
          log.warn(`${this.options.adapterName}: Endpoint rejected stop parameter; retrying request without stop`);

          const retryBody = { ...requestBody };
          delete retryBody.stop;

          response = await fetchImpl(apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(retryBody),
            signal: controller.signal,
          });

          responseErrorText = response.ok ? null : await response.text();
        }
      }

      if (!response.ok) {
        throw createOpenAICompatibleHttpError(response.status, response.statusText, responseErrorText ?? "");
      }

      for await (const chunk of streamOpenAICompatibleSseChunks(response)) {
        const sanitizedChunk = this.stripThinkBlocksFromChunkContent(chunk);
        const chunksToEmit = this.splitChunkWithTextAndToolSignals(sanitizedChunk);

        for (const chunkToEmit of chunksToEmit) {
          const deduplicatedChunk = this.deduplicateChunkTextAgainstRecentStream(chunkToEmit);
          const guardResult = this.applySpeakerBoundaryFallbackGuard(deduplicatedChunk);

          if (this.shouldFlushSpeakerGuardTailBeforeNonTextChunk(guardResult.chunk)) {
            yield this.wrapChunk(
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: this.speakerGuardPendingTail,
                    },
                  },
                ],
              },
              config.model,
            );
            this.speakerGuardPendingTail = "";
          }

          const hasMeaningfulData = Boolean(
            guardResult.chunk.error ||
              guardResult.chunk.usage ||
              (guardResult.chunk.choices && guardResult.chunk.choices.length > 0),
          );
          if (!hasMeaningfulData) {
            if (guardResult.stopTriggered) {
              log.warn(
                `${this.options.adapterName}: Speaker guard stopped generation at "${guardResult.matchedSpeaker ?? "unknown"}"`,
              );
              return;
            }
            continue;
          }

          yield this.wrapChunk(guardResult.chunk, config.model);

          if (guardResult.stopTriggered) {
            log.warn(
              `${this.options.adapterName}: Speaker guard stopped generation at "${guardResult.matchedSpeaker ?? "unknown"}"`,
            );
            return;
          }
        }
      }

      if (this.speakerGuardEnabled && this.speakerGuardPendingTail.length > 0) {
        yield this.wrapChunk(
          {
            choices: [
              {
                index: 0,
                delta: {
                  content: this.speakerGuardPendingTail,
                },
              },
            ],
          },
          config.model,
        );
        this.speakerGuardPendingTail = "";
      }
    } catch (error) {
      if (this.speakerGuardEnabled && this.speakerGuardPendingTail.length > 0) {
        yield this.wrapChunk(
          {
            choices: [
              {
                index: 0,
                delta: {
                  content: this.speakerGuardPendingTail,
                },
              },
            ],
          },
          config.model,
        );
        this.speakerGuardPendingTail = "";
      }

      yield this.createProviderErrorChunk(error);
    }
  }

  processChunk(chunk: RawStreamChunk): ProcessedChunk {
    const openAIChunk = chunk.data as OpenAICompatibleStreamChunk;

    if ("error" in openAIChunk && openAIChunk.error) {
      return this.attachPendingThoughts({
        type: "error",
        error: {
          type: "api_error",
          message: openAIChunk.error.message || `${this.options.errorMessagePrefix}: provider API error`,
          code: openAIChunk.error.code !== undefined ? String(openAIChunk.error.code) : "unknown",
          retryable: false,
          originalError: openAIChunk.error,
        },
      });
    }

    const choice = openAIChunk.choices?.[0];
    if (!choice) {
      return this.attachPendingThoughts({
        type: "text",
        content: "",
      });
    }

    const metadata: Record<string, unknown> = {};
    const thoughts: ThoughtLogEntry[] = [];
    if (openAIChunk.usage) {
      metadata.usage = openAIChunk.usage;
      log.info(`${this.options.adapterName}: Usage ${openAIChunk.usage.total_tokens ?? "unknown"} total tokens`);
    }

    const reasoningContent = choice.delta?.reasoning_content;
    if (typeof reasoningContent === "string" && reasoningContent.length > 0) {
      thoughts.push({
        kind: "raw",
        content: reasoningContent,
      });
      if (this.options.preserveReasoningContent) {
        this.accumulatedReasoningContent += reasoningContent;
      }
    }
    thoughts.push(...this.consumePendingThinkBlockThoughts());

    if (choice.finish_reason === "tool_calls") {
      if (choice.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
        this.accumulateToolCalls(choice.delta.tool_calls);
      }

      const accumulated = this.toolCallAccumulator.get(0);
      if (!accumulated?.functionName) {
        log.warn(`${this.options.adapterName}: finish_reason was 'tool_calls' but no tool call was accumulated`);
        return this.attachPendingThoughts({
          type: "done",
          thoughts,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        });
      }

      let parsedArgs: Record<string, unknown> = {};
      if (accumulated.functionArguments) {
        try {
          parsedArgs = JSON.parse(accumulated.functionArguments);
        } catch (parseError) {
          log.error(
            `${this.options.adapterName}: Failed to parse tool arguments "${accumulated.functionArguments}"`,
            parseError as Error,
          );
        }
      }

      const functionCall: FunctionCall = {
        name: accumulated.functionName,
        args: parsedArgs,
      };
      if (this.options.preserveReasoningContent && this.accumulatedReasoningContent.length > 0) {
        functionCall.deepseekReasoningContent = this.accumulatedReasoningContent;
        log.info(
          `${this.options.adapterName}: Preserving ${this.accumulatedReasoningContent.length} chars of reasoning_content for tool continuation`,
        );
      }

      this.toolCallAccumulator.clear();
      this.accumulatedReasoningContent = "";
      return this.attachPendingThoughts({
        type: "function_call",
        functionCall,
        thoughts,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
    }

    if (choice.finish_reason === "stop") {
      if (choice.delta?.content) {
        return this.attachPendingThoughts({
          type: "text",
          content: choice.delta.content,
          thoughts,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        });
      }
      return this.attachPendingThoughts({
        type: "done",
        thoughts,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
    }

    if (choice.finish_reason === "length") {
      log.warn(`${this.options.adapterName}: Response truncated due to max_tokens`);
      return this.attachPendingThoughts({
        type: "done",
        thoughts,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
    }

    if (choice.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
      this.accumulateToolCalls(choice.delta.tool_calls);
      return this.attachPendingThoughts({
        type: "text",
        content: "",
        thoughts,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
    }

    if (choice.delta?.content) {
      return this.attachPendingThoughts({
        type: "text",
        content: choice.delta.content,
        thoughts,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
    }

    return this.attachPendingThoughts({
      type: "text",
      content: "",
      thoughts,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  }

  extractFunctionCall(chunk: RawStreamChunk): FunctionCall | null {
    const openAIChunk = chunk.data as OpenAICompatibleStreamChunk;
    const choice = openAIChunk.choices?.[0];
    if (!choice?.delta?.tool_calls || choice.delta.tool_calls.length === 0) {
      return null;
    }

    const toolCall = choice.delta.tool_calls[0];
    if (!toolCall.function) {
      return null;
    }

    return {
      name: toolCall.function.name || "",
      args: toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {},
    };
  }

  handleProviderError(error: unknown): ProviderError {
    log.error(`${this.options.adapterName}: Provider error`, error as Error);
    return normalizeOpenAICompatibleProviderError(error, {
      errorMessagePrefix: this.options.errorMessagePrefix,
    });
  }

  createErrorDescription(error: ProviderError, locale: string): string | null {
    return createOpenAICompatibleErrorDescription(error, locale, {
      localeNamespace: this.options.localeNamespace,
      fallbackMessage: localizer(locale, `${this.options.localeNamespace}.unknown_default_message`),
      connectionRefusedMessage: localizer(locale, `${this.options.localeNamespace}.connection_refused`),
    });
  }

  private wrapChunk(chunk: OpenAICompatibleStreamChunk, model: string): RawStreamChunk {
    return this.createRawChunk(chunk, { model });
  }

  private stripThinkBlocksFromChunkContent(chunk: OpenAICompatibleStreamChunk): OpenAICompatibleStreamChunk {
    if (this.options.stripThinkBlocksFromContent === false) {
      return chunk;
    }

    const firstChoice = chunk.choices?.[0];
    const content = firstChoice?.delta?.content;
    if (!firstChoice?.delta || typeof content !== "string" || content.length === 0) {
      return chunk;
    }

    const strippedContent = this.stripThinkBlocks(content);
    if (strippedContent === content) {
      return chunk;
    }

    return {
      ...chunk,
      choices: [
        {
          ...firstChoice,
          delta: {
            ...firstChoice.delta,
            content: strippedContent,
          },
        },
        ...(chunk.choices?.slice(1) ?? []),
      ],
    };
  }

  private stripThinkBlocks(text: string): string {
    if (!text) {
      return "";
    }

    let output = "";
    let cursor = 0;

    while (cursor < text.length) {
      if (!this.insideThinkBlock) {
        const startIdx = text.indexOf("<think>", cursor);
        const endIdx = text.indexOf("</think>", cursor);

        if (startIdx === -1 && endIdx === -1) {
          output += text.slice(cursor);
          break;
        }

        if (endIdx !== -1 && (startIdx === -1 || endIdx < startIdx)) {
          output += text.slice(cursor, endIdx);
          cursor = endIdx + "</think>".length;
          continue;
        }

        if (startIdx !== -1) {
          output += text.slice(cursor, startIdx);
          this.insideThinkBlock = true;
          cursor = startIdx + "<think>".length;
        }
      } else {
        const endIdx = text.indexOf("</think>", cursor);
        if (endIdx === -1) {
          this.captureThinkBlockThoughtText(text.slice(cursor));
          cursor = text.length;
          break;
        }

        this.captureThinkBlockThoughtText(text.slice(cursor, endIdx));
        this.insideThinkBlock = false;
        cursor = endIdx + "</think>".length;
      }
    }

    return output;
  }

  private captureThinkBlockThoughtText(text: string): void {
    if (this.options.captureThinkBlocksAsThoughts === false || !text) {
      return;
    }

    this.pendingThinkBlockThoughtText += text;
  }

  private consumePendingThinkBlockThoughts(): ThoughtLogEntry[] {
    if (!this.pendingThinkBlockThoughtText) {
      return [];
    }

    const thoughtText = this.pendingThinkBlockThoughtText;
    this.pendingThinkBlockThoughtText = "";
    return [
      {
        kind: "raw",
        content: thoughtText,
      },
    ];
  }

  private attachPendingThoughts(chunk: ProcessedChunk): ProcessedChunk {
    const pendingThoughts = this.consumePendingThinkBlockThoughts();
    const chunkThoughts = chunk.thoughts ?? [];
    const thoughts =
      chunkThoughts.length > 0 || pendingThoughts.length > 0 ? [...chunkThoughts, ...pendingThoughts] : undefined;

    if (!thoughts) {
      return chunk;
    }

    return {
      ...chunk,
      thoughts,
    };
  }

  private deduplicateChunkTextAgainstRecentStream(chunk: OpenAICompatibleStreamChunk): OpenAICompatibleStreamChunk {
    const firstChoice = chunk.choices?.[0];
    const content = firstChoice?.delta?.content;
    if (!firstChoice?.delta || typeof content !== "string" || content.length === 0) {
      return chunk;
    }

    const deduplicatedText = this.getTextDelta(content);
    if (deduplicatedText !== content) {
      log.info(
        `${this.options.adapterName}: Trimmed overlapping streamed text (${content.length} -> ${deduplicatedText.length})`,
      );
    }

    if (deduplicatedText.length > 0) {
      this.appendToStreamedTextTail(deduplicatedText);
    }

    if (deduplicatedText === content) {
      return chunk;
    }

    return {
      ...chunk,
      choices: [
        {
          ...firstChoice,
          delta: {
            ...firstChoice.delta,
            content: deduplicatedText,
          },
        },
        ...(chunk.choices?.slice(1) ?? []),
      ],
    };
  }

  private getTextDelta(chunkText: string): string {
    if (
      !chunkText ||
      chunkText.length < OpenAICompatibleStreamAdapter.STREAM_TEXT_MIN_DEDUP_CHARS ||
      !this.streamedTextTail
    ) {
      return chunkText;
    }

    const seenTail = this.streamedTextTail;
    if (seenTail.endsWith(chunkText)) {
      return "";
    }

    const maxOverlap = Math.min(seenTail.length, chunkText.length);
    for (let overlap = maxOverlap; overlap >= OpenAICompatibleStreamAdapter.STREAM_TEXT_MIN_DEDUP_CHARS; overlap--) {
      if (seenTail.slice(seenTail.length - overlap) === chunkText.slice(0, overlap)) {
        return chunkText.slice(overlap);
      }
    }

    return chunkText;
  }

  private appendToStreamedTextTail(text: string): void {
    if (!text) {
      return;
    }

    this.streamedTextTail += text;
    if (this.streamedTextTail.length > OpenAICompatibleStreamAdapter.STREAM_TEXT_TAIL_CHARS) {
      this.streamedTextTail = this.streamedTextTail.slice(-OpenAICompatibleStreamAdapter.STREAM_TEXT_TAIL_CHARS);
    }
  }

  private applySpeakerBoundaryFallbackGuard(chunk: OpenAICompatibleStreamChunk): {
    chunk: OpenAICompatibleStreamChunk;
    stopTriggered: boolean;
    matchedSpeaker?: string;
  } {
    if (!this.speakerGuardEnabled) {
      return { chunk, stopTriggered: false };
    }

    const firstChoice = chunk.choices?.[0];
    const content = firstChoice?.delta?.content;
    if (!firstChoice?.delta || !content) {
      return { chunk, stopTriggered: false };
    }

    const combined = `${this.speakerGuardPendingTail}${String(content)}`;
    const speakerGuardResult = truncateBeforeGenericSpeakerLine(combined);
    const transitionIndex = speakerGuardResult.stopTriggered ? speakerGuardResult.text.length : -1;

    if (transitionIndex === -1) {
      const holdback = OpenAICompatibleStreamAdapter.SPEAKER_GUARD_HOLDBACK_CHARS;
      if (combined.length <= holdback) {
        this.speakerGuardPendingTail = combined;
        firstChoice.delta.content = "";
        return { chunk, stopTriggered: false };
      }

      const emitEnd = combined.length - holdback;
      firstChoice.delta.content = combined.slice(0, emitEnd);
      this.speakerGuardPendingTail = combined.slice(emitEnd);
      return { chunk, stopTriggered: false };
    }

    firstChoice.delta.content = combined.slice(0, transitionIndex);
    this.speakerGuardPendingTail = "";
    return {
      chunk,
      stopTriggered: true,
      matchedSpeaker: speakerGuardResult.matchedSpeaker,
    };
  }

  private splitChunkWithTextAndToolSignals(chunk: OpenAICompatibleStreamChunk): OpenAICompatibleStreamChunk[] {
    const firstChoice = chunk.choices?.[0];
    if (!firstChoice?.delta) {
      return [chunk];
    }

    const content = firstChoice.delta.content;
    const hasTextContent = typeof content === "string" && content.length > 0;
    if (!hasTextContent) {
      return [chunk];
    }

    const hasToolSignal =
      Boolean(firstChoice.delta.tool_calls && firstChoice.delta.tool_calls.length > 0) ||
      firstChoice.finish_reason === "tool_calls";
    if (!hasToolSignal) {
      return [chunk];
    }

    return [
      {
        ...chunk,
        usage: undefined,
        choices: [
          {
            ...firstChoice,
            delta: {
              role: firstChoice.delta.role,
              content,
            },
            finish_reason: null,
          },
        ],
      },
      {
        ...chunk,
        choices: [
          {
            ...firstChoice,
            delta: {
              ...firstChoice.delta,
              content: undefined,
            },
          },
        ],
      },
    ];
  }

  private shouldFlushSpeakerGuardTailBeforeNonTextChunk(chunk: OpenAICompatibleStreamChunk): boolean {
    if (!this.speakerGuardEnabled || this.speakerGuardPendingTail.length === 0) {
      return false;
    }

    const firstChoice = chunk.choices?.[0];
    const content = firstChoice?.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      return false;
    }

    if (chunk.error || chunk.usage) {
      return true;
    }

    if (firstChoice?.delta?.tool_calls && firstChoice.delta.tool_calls.length > 0) {
      return true;
    }

    return Boolean(firstChoice?.finish_reason);
  }

  private accumulateToolCalls(toolCalls: OpenAICompatibleToolCallDelta[] | undefined): void {
    for (const deltaToolCall of toolCalls ?? []) {
      const index = deltaToolCall.index ?? 0;
      let accumulated = this.toolCallAccumulator.get(index);
      if (!accumulated) {
        accumulated = {
          functionName: "",
          functionArguments: "",
        };
        this.toolCallAccumulator.set(index, accumulated);
      }

      if (deltaToolCall.id) {
        accumulated.id = deltaToolCall.id;
      }
      if (deltaToolCall.type) {
        accumulated.type = deltaToolCall.type;
      }
      if (deltaToolCall.function?.name) {
        accumulated.functionName += deltaToolCall.function.name;
      }
      if (deltaToolCall.function?.arguments) {
        accumulated.functionArguments += deltaToolCall.function.arguments;
      }
    }
  }
}
