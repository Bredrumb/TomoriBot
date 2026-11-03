import type { ThoughtLogEntry } from "@/types/provider/interfaces";
import { log } from "@/utils/misc/logger";
import {
  formatProviderErrorCodeForDisplay,
  isProviderTimeoutMessage,
} from "@/utils/provider/providerErrorClassification";
import { localizer } from "@/utils/text/localizer";
import { BaseStreamAdapter } from "@/types/stream/interfaces";
import type {
  ProcessedChunk,
  ProviderError,
  RawStreamChunk,
  StreamConfig,
  StreamContext,
} from "@/types/stream/interfaces";
import {
  novelaiGenerateStream,
  isNovelAIApiKeyError,
  isNovelAICreditsError,
  isNovelAIRateLimitError,
  type NovelAIGenerationRequest,
  type NovelAIStreamChunk,
} from "./novelaiService";
import { NovelAISpeakerGuard } from "@/providers/novelai/speakerBoundaries";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import { prepareNovelAIRequest } from "@/providers/novelai/promptFitting";
import { NovelAIPreparationError } from "@/providers/novelai/preparationError";
import { createNovelAITokenizerEncoder } from "@/utils/provider/localTokenizerRegistry";

// Two continuations bound added latency until production cutoff traces justify a different limit.
const MAX_CONTINUATION_ATTEMPTS = 2;
const PREPARATION_ERROR_KEYS: Record<NovelAIPreparationError["code"], string> = {
  tokenizer_setup: "genai.novelai.tokenizer_setup",
  input_complexity: "genai.novelai.input_complexity",
  context_overflow: "genai.novelai.context_overflow",
  subscription_unavailable: "genai.novelai.subscription_unavailable",
  subscription_inactive: "genai.novelai.subscription_inactive",
  model_tier: "genai.novelai.model_tier",
  xialong_opus: "genai.novelai.xialong_opus",
  continuation_exhausted: "genai.novelai.continuation_exhausted",
};

export class NovelaiStreamAdapter extends BaseStreamAdapter {
  private insideThinkBlock = false;
  private pendingThinkBlockThoughtText = "";

  private speakerGuard = new NovelAISpeakerGuard({ ownNames: [], foreignNames: [] });

  private isGlmModel = false;

  private sentenceTrailingBuffer = "";

  private visibleOutputCommitted = false;

  constructor() {
    super({
      name: "novelai",
      version: "1.0",
      supportsFunctionCalling: false,
    });
  }

  private static readonly SENTENCE_BOUNDARY_PATTERN = /[.!?*~)\]"\u300D\u2026\u2014]\s*$/;

  async *startStream(config: StreamConfig, context: StreamContext): AsyncGenerator<RawStreamChunk, void, unknown> {
    log.info("NovelAIStreamAdapter: Initializing NovelAI streaming");

    this.visibleOutputCommitted = false;
    this.sentenceTrailingBuffer = "";
    this.speakerBoundaryStopPending = false;
    this.pendingThinkBlockThoughtText = "";
    this.insideThinkBlock = false;
    try {
      if (!config.model) {
        throw new Error("Model must be specified in config. Use NovelAIProvider.getDefaultModel() if needed.");
      }

      this.isGlmModel = getNovelAIProfile(config.model).sentenceBuffering;

      const prepared = await prepareNovelAIRequest({
        contextItems: context.contextItems,
        tomoriState: {
          ...context.tomoriState,
          config: {
            ...context.tomoriState.config,
            llm_temperature: config.temperature ?? context.tomoriState.config.llm_temperature,
            llm_disabled_params: config.disabledParams ?? context.tomoriState.config.llm_disabled_params,
          },
        },
        model: config.model,
        apiKey: config.apiKey,
        maxOutputTokens: config.maxOutputTokens,
        outputPrefill: context.outputPrefill,
        forceReason: config.forceReason,
        triggerMessageId: context.triggerMessageId,
      });
      const { prompt, parameters } = prepared;
      log.section("NovelAI Full Prompt");
      if (!context.holdResponseText) log.info(prompt);

      this.speakerGuard = new NovelAISpeakerGuard(prepared.speakers);
      const request: NovelAIGenerationRequest = {
        input: prompt,
        model: config.model,
        parameters,
        openAIStopStrings: prepared.stopStrings,
      };

      this.logSanitizedRequest(request, prompt.length);

      yield* this.streamWithContinuation(request, config, context);
    } catch (error) {
      yield this.createProviderErrorChunk(error, context);
    }
  }

  private async *streamWithContinuation(
    request: NovelAIGenerationRequest,
    config: StreamConfig,
    context: StreamContext,
  ): AsyncGenerator<RawStreamChunk, void, unknown> {
    const profile = getNovelAIProfile(config.model);
    const encode = createNovelAITokenizerEncoder(profile.tokenizer);
    const totalBudget = request.parameters.max_length ?? profile.defaultOutputTokens;
    let generated = "";
    let used = 0;
    for (let attempt = 0; ; attempt++) {
      let termination: NovelAIStreamChunk | undefined;
      let attemptText = "";
      for await (const chunk of novelaiGenerateStream(request, {
        apiKey: config.apiKey,
        timeout: config.inactivityTimeoutMs,
        signal: context.abortSignal,
      })) {
        if (chunk.token) {
          generated += chunk.token;
          attemptText += chunk.token;
          yield { data: { ...chunk, final: false }, provider: "novelai" };
          if (this.speakerBoundaryStopPending) return;
        }
        if (chunk.final) {
          termination = chunk;
          break;
        }
      }
      termination ??= { final: true, termination: "eof" };
      used += encode(attemptText).length;
      const interrupted = termination.termination === "eof" || termination.termination === "inactivity";
      const remaining = totalBudget - used;
      if (
        profile.sentenceBuffering &&
        interrupted &&
        this.sentenceTrailingBuffer.trim() &&
        attempt < MAX_CONTINUATION_ATTEMPTS &&
        remaining > 0 &&
        !context.abortSignal?.aborted &&
        !this.speakerBoundaryStopPending
      ) {
        const prepared = await prepareNovelAIRequest({
          contextItems: context.contextItems,
          tomoriState: context.tomoriState,
          model: config.model,
          apiKey: config.apiKey,
          maxOutputTokens: remaining,
          outputPrefill: context.outputPrefill,
          forceReason: config.forceReason,
          continuationPrefill: generated,
          triggerMessageId: context.triggerMessageId,
        });
        request = {
          ...request,
          input: prepared.prompt,
          parameters: {
            ...request.parameters,
            max_length: prepared.parameters.max_length,
            min_length: prepared.parameters.min_length,
          },
        };
        continue;
      }
      if (
        profile.sentenceBuffering &&
        !this.visibleOutputCommitted &&
        (interrupted || termination.finishReason === "length")
      ) {
        yield this.createProviderErrorChunk(new NovelAIPreparationError("continuation_exhausted"), context);
        return;
      }
      yield { data: termination, provider: "novelai" };
      return;
    }
  }

  private speakerBoundaryStopPending = false;

  processChunk(chunk: RawStreamChunk): ProcessedChunk {
    const novelaiChunk = chunk.data as NovelAIStreamChunk & {
      error?: ProviderError;
    };
    const withThoughts = (result: ProcessedChunk): ProcessedChunk => this.attachPendingThoughts(result);

    if (novelaiChunk.error) {
      if (typeof novelaiChunk.error === "object" && "type" in novelaiChunk.error) {
        return withThoughts({
          type: "error",
          error: novelaiChunk.error as ProviderError,
        });
      }

      return withThoughts({
        type: "error",
        error: this.handleProviderError(novelaiChunk.error),
      });
    }

    if (novelaiChunk.final && novelaiChunk.token) {
      const token = this.processChunk({ ...chunk, data: { ...novelaiChunk, final: false } });
      const final = this.processChunk({ ...chunk, data: { ...novelaiChunk, token: undefined } });
      if (token.type === "done" || token.type === "error") return token;
      return {
        ...final,
        type: token.content || final.content ? "text" : final.type,
        content: (token.content ?? "") + (final.content ?? ""),
        thoughts: [...(token.thoughts ?? []), ...(final.thoughts ?? [])],
      };
    }

    if (novelaiChunk.final) {
      const guardTail = this.speakerGuard.flush();
      if (guardTail.stopped) this.speakerBoundaryStopPending = true;
      if (this.isGlmModel) this.sentenceTrailingBuffer += guardTail.text;
      let finalFlush = "";
      if (this.isGlmModel && this.sentenceTrailingBuffer.trim()) {
        if (
          novelaiChunk.termination === "stop" ||
          guardTail.stopped ||
          NovelaiStreamAdapter.SENTENCE_BOUNDARY_PATTERN.test(this.sentenceTrailingBuffer)
        ) {
          finalFlush = this.sentenceTrailingBuffer;
        }
      }

      this.sentenceTrailingBuffer = "";
      this.insideThinkBlock = false;

      const flushContent = this.isGlmModel ? finalFlush : guardTail.text;
      if (flushContent) {
        return withThoughts({
          type: "text",
          content: flushContent,
        });
      }

      return withThoughts({
        type: "done",
      });
    }

    if (novelaiChunk.token) {
      if (this.isGlmModel) {
        const stripped = this.stripThinkBlocks(novelaiChunk.token);
        if (!stripped) {
          return withThoughts({ type: "text", content: "" });
        }
        return withThoughts(this.processVisibleText(stripped));
      }

      return withThoughts(this.processVisibleText(novelaiChunk.token));
    }

    return withThoughts({
      type: "text",
      content: "",
    });
  }

  private processVisibleText(text: string): ProcessedChunk {
    if (this.speakerBoundaryStopPending) return { type: "done" };
    const guarded = this.speakerGuard.push(text);
    if (guarded.stopped) {
      this.speakerBoundaryStopPending = true;
      const content = this.sentenceTrailingBuffer + guarded.text;
      this.sentenceTrailingBuffer = "";
      return content ? { type: "text", content } : { type: "done" };
    }
    if (!this.isGlmModel) return { type: "text", content: guarded.text };
    this.sentenceTrailingBuffer += guarded.text;
    const lastBoundaryIndex = this.findLastSentenceBoundary(this.sentenceTrailingBuffer);
    if (lastBoundaryIndex === -1) return { type: "text", content: "" };
    const content = this.sentenceTrailingBuffer.slice(0, lastBoundaryIndex + 1);
    this.sentenceTrailingBuffer = this.sentenceTrailingBuffer.slice(lastBoundaryIndex + 1);
    return { type: "text", content };
  }
  private findLastSentenceBoundary(text: string): number {
    for (let i = text.length - 1; i >= 0; i--) {
      const char = text[i];
      if (
        char === "." ||
        char === "!" ||
        char === "?" ||
        char === "*" ||
        char === "~" ||
        char === ")" ||
        char === "]" ||
        char === '"' ||
        char === "\u300D" || // 」
        char === "\u2026" || // …
        char === "\u2014" || // —
        char === "\n"
      ) {
        return i;
      }
    }

    return -1;
  }

  private stripThinkBlocks(text: string): string {
    if (!text) return "";

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
    if (!text) {
      return;
    }

    this.pendingThinkBlockThoughtText += text;
  }

  private consumePendingThinkBlockThoughts(): ThoughtLogEntry[] {
    if (!this.pendingThinkBlockThoughtText) {
      return [];
    }

    const content = this.pendingThinkBlockThoughtText;
    this.pendingThinkBlockThoughtText = "";
    return [
      {
        kind: "raw",
        content,
      },
    ];
  }

  private attachPendingThoughts(chunk: ProcessedChunk): ProcessedChunk {
    if (chunk.type === "text" && chunk.content?.trim()) this.visibleOutputCommitted = true;
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

  protected override onProviderError(error: unknown, providerError: ProviderError, context?: StreamContext): void {
    super.onProviderError(error, providerError, context);
    log.warn(
      `NovelAI provider error (${providerError.code ?? "unknown"}, ${providerError.type}, retryable: ${providerError.retryable}): ${providerError.message.slice(0, 500)}`,
      undefined,
      { serverId: context?.tomoriState?.server_id ?? null },
    );
  }

  handleProviderError(error: unknown): ProviderError {
    if (error instanceof NovelAIPreparationError) {
      return { type: "api_error", code: error.code, message: error.message, retryable: false, originalError: error };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);

    let statusCode: number | undefined;

    if (error && typeof error === "object") {
      if ("statusCode" in error && typeof error.statusCode === "number") {
        statusCode = error.statusCode;
      } else if ("status" in error && typeof error.status === "number") {
        statusCode = error.status;
      }
    }

    if (!statusCode) {
      const statusMatch = errorMessage.match(/(?:\bstatus(?:\s+code)?\s*[:=]?\s*|\bhttp\s+|\()(\d{3})(?!\d)/i);
      if (statusMatch) {
        statusCode = Number.parseInt(statusMatch[1], 10);
      }
    }

    let errorType: ProviderError["type"];
    let retryable: boolean;

    if (
      (statusCode === 400 || statusCode === 403) &&
      /model\s+['"]xialong-v1['"]\s+not allowed for current user tier/i.test(errorMessage)
    ) {
      return { type: "api_error", code: "xialong_opus", message: errorMessage, retryable: false, originalError: error };
    }

    if (statusCode === 400) {
      errorType = "api_error";
      retryable = false;
    } else if (statusCode === 401 || (!statusCode && isNovelAIApiKeyError(errorMessage))) {
      errorType = "api_error";
      retryable = false;
    } else if (statusCode === 402 || (!statusCode && isNovelAICreditsError(errorMessage))) {
      errorType = "api_error";
      retryable = false;
    } else if (statusCode === 429 || (!statusCode && isNovelAIRateLimitError(errorMessage))) {
      errorType = "rate_limit";
      retryable = true;
    } else if (statusCode === 408) {
      errorType = "timeout";
      retryable = true;
    } else if (statusCode === 500 || statusCode === 502) {
      errorType = "api_error";
      retryable = true;
    } else if (statusCode === 503) {
      errorType = "provider_overloaded";
      retryable = true;
    } else if (statusCode === 504 || (!statusCode && isProviderTimeoutMessage(errorMessage))) {
      errorType = "timeout";
      retryable = true;
    } else {
      errorType = "api_error";
      retryable = false;
    }

    const formattedMessage = errorMessage.startsWith("NovelAI API error")
      ? errorMessage
      : `NovelAI API error${statusCode ? ` (${statusCode})` : ""}: ${errorMessage}`;

    return {
      type: errorType,
      message: formattedMessage,
      code: statusCode?.toString() || "unknown",
      retryable,
      originalError: error,
    };
  }

  createErrorDescription(error: ProviderError, locale: string): string | null {
    const errorCode = error.code;
    if (errorCode === "xialong_opus") return localizer(locale, PREPARATION_ERROR_KEYS.xialong_opus);
    if (error.originalError instanceof NovelAIPreparationError) {
      return localizer(locale, PREPARATION_ERROR_KEYS[error.originalError.code]);
    }
    let messageKey: string;

    const errorMessage = error.message.toLowerCase();
    if (errorCode === "400" && (errorMessage.includes("recaptcha") || errorMessage.includes("trial generation"))) {
      messageKey = "genai.novelai.400_trial_message";
    } else {
      switch (error.type) {
        case "rate_limit":
          messageKey = "genai.novelai.429_default_message";
          break;
        case "timeout":
          messageKey = "genai.novelai.504_default_message";
          break;
        case "provider_overloaded":
          messageKey = "genai.novelai.503_default_message";
          break;
        case "api_error":
          if (errorCode === "400") {
            messageKey = "genai.novelai.400_default_message";
          } else if (errorCode === "401") {
            messageKey = "genai.novelai.401_default_message";
          } else if (errorCode === "402") {
            messageKey = "genai.novelai.402_default_message";
          } else {
            messageKey = "genai.novelai.unknown_default_message";
          }
          break;
        default:
          messageKey = "genai.novelai.unknown_default_message";
          break;
      }
    }

    return `Error Code ${formatProviderErrorCodeForDisplay(errorCode)}: ${localizer(locale, messageKey)}`;
  }

  private logSanitizedRequest(request: NovelAIGenerationRequest, promptLength: number): void {
    log.section("NovelAIStreamAdapter: Request Details");

    log.info(`Model: ${request.model}`);
    log.info(`Prompt Length: ${promptLength} characters`);
    log.info(`Parameters: temperature=${request.parameters.temperature}, max_length=${request.parameters.max_length}`);
  }
}
