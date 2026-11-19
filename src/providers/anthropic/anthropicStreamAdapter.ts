import { applyAnthropicCacheBreakpoints, relocateCacheContextItems } from "@/providers/utils/anthropicCache";
import { buildTargetedAttempt, extractRejectedParams } from "@/providers/utils/paramDegradation";
import { mapWithConcurrency } from "@/utils/async/bounded";
import { resolveToolCallId } from "@/providers/utils/toolCallIds";
import type { FunctionCall, FunctionResponseImageMetadata, ThoughtLogEntry } from "../../types/provider/interfaces";
import type { StructuredContextItem } from "../../types/misc/context";
import { log } from "../../utils/misc/logger";
import {
  formatProviderErrorCodeForDisplay,
  isProviderTimeoutMessage,
} from "@/utils/provider/providerErrorClassification";
import { localizer } from "../../utils/text/localizer";
import { fetchAndOptimizeImage } from "../../utils/image/imageProcessor";
import { isParamDisabled, selectAnthropicSamplingParams } from "@/utils/provider/samplingControl";
import { buildAnthropicThinkingRequest } from "@/utils/provider/thinkingControl";
import {
  assistantMediaRelocationNotice,
  CONVERSATION_START_USER_TEXT,
  ensureLeadingUserTurn,
  isSystemInstructionContextItem,
  mergeConsecutiveSameRole,
  type NormalizableMessage,
  providerRequiresAlternation,
} from "../utils/strictChatCompat";
import { buildProviderStopStrings } from "../utils/stopStrings";
import { parseAccumulatedToolArguments } from "../utils/toolCallArguments";
import { BaseStreamAdapter } from "../../types/stream/interfaces";
import type {
  ProcessedChunk,
  ProviderError,
  RawStreamChunk,
  StreamConfig,
  StreamContext,
} from "../../types/stream/interfaces";

export interface AnthropicStreamConfig extends StreamConfig {
  seesImages?: boolean;
  topP?: number;
  topK?: number;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AccumulatedToolCall {
  id?: string;
  name: string;
  argumentsJson: string;
}

type AnthropicSseEventType =
  | "message_start"
  | "content_block_start"
  | "content_block_delta"
  | "content_block_stop"
  | "message_delta"
  | "message_stop"
  | "ping"
  | "error";

interface ParsedSseEvent {
  eventType: AnthropicSseEventType;
  data: unknown;
}

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

export class AnthropicStreamAdapter extends BaseStreamAdapter {
  private toolCallAccumulator: Map<number, AccumulatedToolCall> = new Map();
  private thinkingAccumulator = "";
  private currentContentBlockIndex = -1;
  private stopReason: string | null = null;
  private usage: Record<string, unknown> = {};

  constructor() {
    super({
      name: "anthropic",
      version: "1.0.0",
      supportsFunctionCalling: true,
    });
  }

  async *startStream(config: StreamConfig, context: StreamContext): AsyncGenerator<RawStreamChunk, void, unknown> {
    this.toolCallAccumulator.clear();
    this.thinkingAccumulator = "";
    this.currentContentBlockIndex = -1;
    this.stopReason = null;
    this.usage = {};

    const anthropicConfig = config as AnthropicStreamConfig;

    // Keep providerRequiresAlternation as a request-time safety net so a mis-seeded row never emits an invalid body.
    const enforceAlternation =
      providerRequiresAlternation("anthropic") || (context.tomoriState.llm?.strict_role_alternation ?? false);
    const { systemPrompt, messages } = await this.assembleAnthropicContext(
      context.contextItems,
      context.currentTurnModelParts,
      context.functionInteractionHistory,
      anthropicConfig.seesImages ?? true,
      enforceAlternation,
      config.model,
    );

    log.info(
      `AnthropicStreamAdapter: Assembled ${messages.length} messages, system prompt: ${systemPrompt?.length ?? 0} chars`,
    );

    const requestBody: Record<string, unknown> = {
      model: config.model,
      max_tokens: config.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS,
      stream: true,
      messages,
    };

    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }

    if (config.tools && Array.isArray(config.tools) && config.tools.length > 0) {
      requestBody.tools = config.tools;
    }

    const thinkingRequest = buildAnthropicThinkingRequest(
      config.model,
      context.tomoriState.config.thinking_level,
      config.forceReason,
    );
    if (thinkingRequest.thinking) {
      requestBody.thinking = thinkingRequest.thinking;
    }
    if (thinkingRequest.output_config) {
      requestBody.output_config = thinkingRequest.output_config;
    }

    if (!thinkingRequest.omitSampling) {
      const samplingSelection = selectAnthropicSamplingParams({
        temperature: config.temperature,
        topP: anthropicConfig.topP,
        disabledParams: config.disabledParams ?? [],
      });
      if (samplingSelection.logMessage) {
        const logger = samplingSelection.logLevel === "warn" ? log.warn : log.info;
        logger(samplingSelection.logMessage);
      }
      if (samplingSelection.temperature !== undefined) {
        requestBody.temperature = samplingSelection.temperature;
      }
      if (samplingSelection.topP !== undefined) {
        requestBody.top_p = samplingSelection.topP;
      }

      if (
        anthropicConfig.topK !== undefined &&
        anthropicConfig.topK > 0 &&
        !isParamDisabled(config.disabledParams ?? [], "topK")
      ) {
        requestBody.top_k = anthropicConfig.topK;
      }
    }

    const stopSequences = buildProviderStopStrings({
      providerName: "anthropic",
      model: config.model,
      personaName: context.prefixStrippingName ?? context.personaUsername,
      configuredStops: context.tomoriState.config.llm_stop_strings,
      includePersonaSpeakerStop: context.tomoriState.config.llm_stop_speaker_pattern_enabled ?? false,
    });
    if (stopSequences) {
      requestBody.stop_sequences = stopSequences;
      log.info(`AnthropicStreamAdapter: Added stop sequences`);
    }

    log.info(`AnthropicStreamAdapter: Starting stream for model ${config.model}, max_tokens ${requestBody.max_tokens}`);

    if (!context.holdResponseText) this.logSanitizedRequest(requestBody);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    };

    let activeBody = requestBody;
    let cacheDegraded = false;
    const degradeCache = (message: string, status?: number): boolean => {
      if (cacheDegraded || !extractRejectedParams(message, activeBody).includes("cache_control")) return false;
      const attempt = buildTargetedAttempt(activeBody, ["cache_control"]);
      log.warn("Anthropic request retry with degraded payload", { label: attempt.label, status });
      activeBody = attempt.body;
      cacheDegraded = true;
      return true;
    };
    requestLoop: while (true) {
      const response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(activeBody),
        signal: context.abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (degradeCache(errorText, response.status)) continue;
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }

        log.warn(`AnthropicStreamAdapter: HTTP ${response.status} error: ${errorText}`);

        const anthropicError = new Error(JSON.stringify({ error: errorData }));
        Object.assign(anthropicError, { statusCode: response.status });
        yield this.createProviderErrorChunk(anthropicError, context);
        return;
      }

      if (!response.body) {
        throw new Error("Anthropic response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let pendingEventType: string | null = null;
      let completed = false;
      let committed = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            completed = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();

            if (!trimmedLine || trimmedLine.startsWith(":")) {
              continue;
            }

            if (trimmedLine.startsWith("event:")) {
              pendingEventType = trimmedLine.slice(6).trim();
              continue;
            }

            if (trimmedLine.startsWith("data:")) {
              const dataStr = trimmedLine.slice(5).trim();
              if (!dataStr) {
                continue;
              }

              try {
                const parsed = JSON.parse(dataStr);
                const sseEvent: ParsedSseEvent = {
                  eventType: (pendingEventType || parsed.type) as AnthropicSseEventType,
                  data: parsed,
                };
                pendingEventType = null;
                if (sseEvent.eventType === "error" && !committed && degradeCache(dataStr)) continue requestLoop;
                if (sseEvent.eventType !== "ping" && sseEvent.eventType !== "error") committed = true;

                yield {
                  data: sseEvent,
                  provider: "anthropic",
                };
              } catch (_parseErr) {
                log.warn(`AnthropicStreamAdapter: Failed to parse SSE data: ${dataStr.substring(0, 100)}`);
              }
            }
          }
        }

        if (buffer.trim()) {
          const remaining = buffer.trim();
          if (remaining.startsWith("data:")) {
            const dataStr = remaining.slice(5).trim();
            try {
              const parsed = JSON.parse(dataStr);
              const eventType = (pendingEventType || parsed.type) as AnthropicSseEventType;
              if (eventType === "error" && !committed && degradeCache(dataStr)) continue;
              yield {
                data: {
                  eventType,
                  data: parsed,
                } satisfies ParsedSseEvent,
                provider: "anthropic",
              };
            } catch {}
          }
        }
      } finally {
        // Cancel rather than releaseLock on early exit because releaseLock leaves the response body, buffers, and socket open.
        if (!completed) {
          await reader.cancel().catch(() => undefined);
        }
      }
      return;
    }
  }

  processChunk(chunk: RawStreamChunk): ProcessedChunk {
    if (
      typeof chunk.data === "object" &&
      chunk.data !== null &&
      "error" in chunk.data &&
      (chunk.data as { error?: unknown }).error
    ) {
      return {
        type: "error",
        error: (chunk.data as { error: ProviderError }).error,
      };
    }

    const sseEvent = chunk.data as ParsedSseEvent;
    const { eventType, data } = sseEvent;
    const thoughts: ThoughtLogEntry[] = [];
    const metadata: Record<string, unknown> = {};

    switch (eventType) {
      case "message_start": {
        const msgData = data as { message?: { usage?: Record<string, unknown> } };
        if (msgData.message?.usage) {
          this.usage = { ...msgData.message.usage };
          metadata.inputTokens = this.usage.input_tokens;
          metadata.usage = { ...this.usage };
        }
        return { type: "text", content: "", thoughts: [], metadata };
      }

      case "content_block_start": {
        const blockData = data as {
          index?: number;
          content_block?: { type?: string; id?: string; name?: string; text?: string; thinking?: string };
        };
        this.currentContentBlockIndex = blockData.index ?? -1;

        if (blockData.content_block?.type === "tool_use") {
          this.toolCallAccumulator.set(this.currentContentBlockIndex, {
            id: typeof blockData.content_block.id === "string" ? blockData.content_block.id : undefined,
            name: blockData.content_block.name || "",
            argumentsJson: "",
          });
          log.info(
            `AnthropicStreamAdapter: Tool use block started: ${blockData.content_block.name} (index ${this.currentContentBlockIndex})`,
          );
        } else if (blockData.content_block?.type === "thinking") {
          this.thinkingAccumulator = blockData.content_block.thinking || "";
        }

        return { type: "text", content: "", thoughts: [], metadata };
      }

      case "content_block_delta": {
        const deltaData = data as {
          index?: number;
          delta?: {
            type?: string;
            text?: string;
            partial_json?: string;
            thinking?: string;
            stop_reason?: string;
          };
        };

        if (!deltaData.delta) {
          return { type: "text", content: "", thoughts: [], metadata };
        }

        const delta = deltaData.delta;

        if (delta.type === "text_delta" && delta.text) {
          return { type: "text", content: delta.text, thoughts: [], metadata };
        }

        if (delta.type === "input_json_delta" && delta.partial_json) {
          const blockIdx = deltaData.index ?? this.currentContentBlockIndex;
          const accumulated = this.toolCallAccumulator.get(blockIdx);
          if (accumulated) {
            accumulated.argumentsJson += delta.partial_json;
          }
          return { type: "text", content: "", thoughts: [], metadata };
        }

        if (delta.type === "thinking_delta" && delta.thinking) {
          this.thinkingAccumulator += delta.thinking;
          thoughts.push({ kind: "raw", content: delta.thinking });
          return { type: "text", content: "", thoughts, metadata };
        }

        return { type: "text", content: "", thoughts: [], metadata };
      }

      case "content_block_stop": {
        const blockStopData = data as { index?: number };
        const blockIdx = blockStopData.index ?? this.currentContentBlockIndex;
        const accumulated = this.toolCallAccumulator.get(blockIdx);

        if (accumulated?.name) {
          const { args: parsedArgs, truncated: argumentsTruncated } = parseAccumulatedToolArguments({
            adapterName: "AnthropicStreamAdapter",
            toolName: accumulated.name,
            rawArguments: accumulated.argumentsJson,
          });

          const functionCall: FunctionCall = {
            id: accumulated.id,
            name: accumulated.name,
            args: parsedArgs,
          };
          if (argumentsTruncated) {
            functionCall.argumentsTruncated = true;
          }

          log.info(
            `AnthropicStreamAdapter: Tool call finalized: ${accumulated.name} (id: ${accumulated.id}) args: ${JSON.stringify(parsedArgs)}`,
          );

          return {
            type: "function_call",
            functionCall,
            thoughts: [],
            metadata: { toolCallId: accumulated.id },
          };
        }

        return { type: "text", content: "", thoughts: [], metadata };
      }

      case "message_delta": {
        const msgDelta = data as {
          delta?: { stop_reason?: string; stop_sequence?: string };
          usage?: Record<string, unknown>;
        };

        if (msgDelta.delta?.stop_reason) {
          this.stopReason = msgDelta.delta.stop_reason;
          metadata.stopReason = this.stopReason;
        }

        if (msgDelta.usage) {
          // Preserve start counts because delta usage is cumulative and may omit input or cache fields.
          this.usage = { ...this.usage, ...msgDelta.usage };
          metadata.outputTokens = this.usage.output_tokens;
          metadata.usage = { ...this.usage };
        }

        if (this.stopReason === "tool_use") {
          return { type: "done", thoughts: [], metadata };
        }

        if (this.stopReason === "end_turn" || this.stopReason === "stop_sequence") {
          return { type: "done", thoughts: [], metadata };
        }

        if (this.stopReason === "max_tokens") {
          log.warn("AnthropicStreamAdapter: Response hit max_tokens limit");
          return { type: "done", thoughts: [], metadata };
        }

        return { type: "text", content: "", thoughts: [], metadata };
      }

      case "message_stop": {
        return { type: "done", thoughts: [], metadata: { streamComplete: true } };
      }

      case "ping": {
        return { type: "text", content: "", thoughts: [], metadata };
      }

      case "error": {
        const errorData = data as { error?: { type?: string; message?: string } };
        const error = errorData.error;

        log.warn(`AnthropicStreamAdapter: Stream error: ${error?.type} - ${error?.message}`);

        return {
          type: "error",
          error: {
            type: "api_error",
            message: error?.message || "Unknown Anthropic stream error",
            code: error?.type,
            retryable: error?.type === "overloaded_error",
            userMessage: error?.message,
          },
          thoughts: [],
          metadata,
        };
      }

      default: {
        log.warn(`AnthropicStreamAdapter: Unknown SSE event type: ${eventType}`);
        return { type: "text", content: "", thoughts: [], metadata };
      }
    }
  }

  handleProviderError(error: unknown): ProviderError {
    const errorMessage = error instanceof Error ? error.message : String(error);

    let anthropicError: { type?: string; message?: string } | null = null;
    let statusCode: number | undefined;

    if (errorMessage.includes("{")) {
      try {
        const jsonMatch = errorMessage.match(/\{.*\}/s);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.error?.type && parsed.error?.message) {
            anthropicError = parsed.error;
          } else if (parsed.type && parsed.message) {
            anthropicError = parsed;
          }
        }
      } catch {}
    }

    const httpError = error as { statusCode?: number; status?: number };
    statusCode = httpError.statusCode ?? httpError.status;

    const errorType = anthropicError?.type;
    let providerErrorType: ProviderError["type"] = "api_error";
    let retryable = false;

    switch (errorType) {
      case "authentication_error":
        providerErrorType = "api_error";
        retryable = false;
        break;
      case "permission_error":
        providerErrorType = "api_error";
        retryable = false;
        break;
      case "invalid_request_error":
        providerErrorType = "api_error";
        retryable = false;
        break;
      case "not_found_error":
        providerErrorType = "api_error";
        retryable = false;
        break;
      case "rate_limit_error":
        providerErrorType = "rate_limit";
        retryable = true;
        break;
      case "api_error":
        providerErrorType = "api_error";
        retryable = true;
        break;
      case "overloaded_error":
        providerErrorType = "provider_overloaded";
        retryable = true;
        break;
      default:
        if (statusCode === 401 || statusCode === 403) {
          providerErrorType = "api_error";
          retryable = false;
        } else if (statusCode === 429) {
          providerErrorType = "rate_limit";
          retryable = true;
        } else if (statusCode === 503) {
          providerErrorType = "provider_overloaded";
          retryable = true;
        } else if (statusCode === 504 || statusCode === 408 || isProviderTimeoutMessage(errorMessage)) {
          providerErrorType = "timeout";
          retryable = true;
        }
        break;
    }

    return {
      type: providerErrorType,
      message: errorMessage,
      code: errorType ?? statusCode?.toString(),
      retryable,
      originalError: error,
      userMessage: anthropicError?.message,
    };
  }

  createErrorDescription(error: ProviderError, locale: string): string | null {
    const errorCode = formatProviderErrorCodeForDisplay(error.code);
    const isTemperatureTopPConflict =
      error.code === "invalid_request_error" &&
      typeof error.userMessage === "string" &&
      error.userMessage.includes("`temperature` and `top_p` cannot both be specified");

    let message: string;
    if (isTemperatureTopPConflict) {
      message = localizer(locale, "genai.anthropic.temperature_top_p_conflict_message");
    } else {
      const messageKey = `genai.anthropic.${errorCode}_default_message`;
      message = localizer(locale, messageKey);
      if (message === messageKey) message = localizer(locale, "genai.anthropic.unknown_default_message");
    }

    return error.code ? `Error Code ${errorCode}: ${message}` : message;
  }

  private async assembleAnthropicContext(
    contextItems: StructuredContextItem[],
    currentTurnModelParts: Array<Record<string, unknown>>,
    functionInteractionHistory?: Array<{
      functionCall: FunctionCall;
      functionResponse: Record<string, unknown>;
      imageMetadata?: FunctionResponseImageMetadata;
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>,
    seesImages: boolean = true,
    enforceAlternation: boolean = true,
    model?: string,
  ): Promise<{ systemPrompt: string | AnthropicTextBlock[] | null; messages: AnthropicMessage[] }> {
    const messages: AnthropicMessage[] = [];
    const { items: relocatedContextItems, boundaryIndex } = relocateCacheContextItems(contextItems);
    const systemParts: string[] = [];
    let boundaryMessage: AnthropicMessage | undefined;

    for (const [itemIndex, item] of relocatedContextItems.entries()) {
      if (itemIndex === boundaryIndex + 1 && boundaryIndex >= 0) boundaryMessage = messages.at(-1);
      let itemTextContent = "";
      if (item.parts.some((p) => p.type === "text")) {
        itemTextContent = item.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("\n");
      }

      if (isSystemInstructionContextItem(item)) {
        if (itemTextContent) {
          systemParts.push(itemTextContent);
        }
      } else if (item.role === "user" || item.role === "model") {
        const role = item.role === "user" ? ("user" as const) : ("assistant" as const);
        const partsByInput = await mapWithConcurrency(item.parts, 4, async (part) => {
          const contentBlocks: AnthropicContentBlock[] = [];
          const pendingBotImageBlocks: AnthropicImageBlock[] = [];
          if (part.type === "text") {
            contentBlocks.push({
              type: "text",
              text: part.text,
            });
          } else if (part.type === "image") {
            const imageTargetBlocks = role === "assistant" ? pendingBotImageBlocks : contentBlocks;

            if (!seesImages) {
              log.info(`AnthropicStreamAdapter: Skipping image (model doesn't support images)`);
              return { contentBlocks, pendingBotImageBlocks };
            }

            if ("inlineData" in part && part.inlineData) {
              const inlineData = part.inlineData as { mimeType: string; data: string };
              if (inlineData.mimeType && inlineData.data) {
                imageTargetBlocks.push({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: inlineData.mimeType,
                    data: inlineData.data,
                  },
                });
              }
              return { contentBlocks, pendingBotImageBlocks };
            }

            if (part.uri && part.mimeType) {
              try {
                let base64Data: string;
                let finalMimeType = part.mimeType;

                if (part.uri.startsWith("data:")) {
                  const dataUriMatch = part.uri.match(/^data:([^;]+);base64,(.+)$/);
                  if (dataUriMatch) {
                    finalMimeType = dataUriMatch[1];
                    base64Data = dataUriMatch[2];
                  } else {
                    return { contentBlocks, pendingBotImageBlocks };
                  }
                } else {
                  const optimized = await fetchAndOptimizeImage(part.uri, part.mimeType);
                  base64Data = optimized.data;
                  finalMimeType = optimized.mimeType;
                }

                imageTargetBlocks.push({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: finalMimeType,
                    data: base64Data,
                  },
                });

                log.info(`AnthropicStreamAdapter: Added image to ${role} message`);
              } catch (imgErr) {
                log.warn(`AnthropicStreamAdapter: Failed to process image`, {
                  error: imgErr instanceof Error ? imgErr.message : String(imgErr),
                });
              }
            }
          }
          // Anthropic Messages API rejects video inputs, so video parts are skipped.
          return { contentBlocks, pendingBotImageBlocks };
        });
        const contentBlocks = partsByInput.flatMap((parts) => parts.contentBlocks);
        const pendingBotImageBlocks = partsByInput.flatMap((parts) => parts.pendingBotImageBlocks);

        if (contentBlocks.length > 0 || pendingBotImageBlocks.length > 0) {
          if (role === "assistant") {
            const textContent = contentBlocks
              .filter((b) => b.type === "text")
              .map((b) => (b as AnthropicTextBlock).text)
              .join("\n");

            if (textContent) {
              messages.push({ role: "assistant", content: textContent });
            }

            if (pendingBotImageBlocks.length > 0) {
              // Anthropic forbids media on assistant turns, so relocate it into a synthetic user turn.
              messages.push({
                role: "user",
                content: [
                  {
                    type: "text",
                    text: assistantMediaRelocationNotice(pendingBotImageBlocks.length, item.sender?.name),
                  },
                  ...pendingBotImageBlocks,
                ],
              });
            }
          } else {
            const allTextOnly = contentBlocks.every((b) => b.type === "text");
            if (allTextOnly && pendingBotImageBlocks.length === 0) {
              const textContent = contentBlocks.map((b) => (b as AnthropicTextBlock).text).join("\n");
              messages.push({ role: "user", content: textContent });
            } else {
              messages.push({
                role: "user",
                content: [...contentBlocks, ...pendingBotImageBlocks],
              });
            }
          }
        }
      }
    }

    if (boundaryIndex === relocatedContextItems.length - 1) boundaryMessage = messages.at(-1);
    const systemMessage = { role: "system", content: systemParts.length > 0 ? systemParts.join("\n\n") : "" };
    if (model) applyAnthropicCacheBreakpoints(model, systemMessage, messages, boundaryMessage);

    if (functionInteractionHistory && functionInteractionHistory.length > 0) {
      const usedToolCallIds = new Set<string>();
      for (const [index, interaction] of functionInteractionHistory.entries()) {
        const toolUseId = resolveToolCallId(interaction.functionCall.id, index, "toolu", usedToolCallIds);

        const assistantContentBlocks: AnthropicContentBlock[] = [];

        if (interaction.preToolCallTextParts && interaction.preToolCallTextParts.length > 0) {
          const preText = interaction.preToolCallTextParts
            .map((part) => (part as { text?: string }).text)
            .filter((text): text is string => typeof text === "string" && text.length > 0)
            .join("");

          if (preText) {
            assistantContentBlocks.push({ type: "text", text: preText });
          }
        }

        assistantContentBlocks.push({
          type: "tool_use",
          id: toolUseId,
          name: interaction.functionCall.name,
          input: (interaction.functionCall.args || {}) as Record<string, unknown>,
        });

        messages.push({
          role: "assistant",
          content: assistantContentBlocks,
        });

        const userContentBlocks: AnthropicContentBlock[] = [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: JSON.stringify(interaction.functionResponse),
          },
        ];

        if (interaction.imageMetadata?.imageUrls && interaction.imageMetadata.imageUrls.length > 0 && seesImages) {
          for (const img of interaction.imageMetadata.imageUrls) {
            try {
              const sourceUrl = img.originalUrl || img.url;
              const optimized = await fetchAndOptimizeImage(sourceUrl, img.mimeType || "image/png");

              userContentBlocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: optimized.mimeType,
                  data: optimized.data,
                },
              });
            } catch (imgErr) {
              log.warn("AnthropicStreamAdapter: Failed to add tool result image", {
                error: imgErr instanceof Error ? imgErr.message : String(imgErr),
              });
            }
          }
        }

        messages.push({
          role: "user",
          content: userContentBlocks,
        });
      }
    }

    if (currentTurnModelParts.length > 0) {
      const prefillText = currentTurnModelParts
        .map((part) => (part as { text?: string }).text)
        .filter((text): text is string => typeof text === "string" && text.length > 0)
        .join("");

      if (prefillText) {
        messages.push({ role: "assistant", content: prefillText });
        log.info(`AnthropicStreamAdapter: Appended prefill assistant message (${prefillText.length} chars)`);
      }
    }

    const mergedMessages = enforceAlternation ? this.enforceStrictAlternation(messages) : messages;

    log.info(`AnthropicStreamAdapter: Assembled ${mergedMessages.length} messages (after alternation merge)`);

    return {
      systemPrompt: (systemMessage.content || null) as string | AnthropicTextBlock[] | null,
      messages: mergedMessages,
    };
  }

  // Anthropic rejects consecutive same-role turns and leading assistant turns.
  private enforceStrictAlternation(messages: AnthropicMessage[]): AnthropicMessage[] {
    const merged = mergeConsecutiveSameRole(messages as unknown as NormalizableMessage[]);

    const withLeading = ensureLeadingUserTurn(merged, () => ({
      role: "user",
      content: CONVERSATION_START_USER_TEXT,
    }));
    if (withLeading.length > merged.length) {
      log.info("AnthropicStreamAdapter: Prepended user message to satisfy alternation requirement");
    }

    return withLeading as unknown as AnthropicMessage[];
  }

  private logSanitizedRequest(requestBody: Record<string, unknown>): void {
    log.section("AnthropicStreamAdapter: Request Details");

    const sanitizedMessages = (requestBody.messages as Array<Record<string, unknown>> | undefined)?.map((msg) => {
      const content = msg.content;
      if (typeof content === "string") return msg;

      const sanitizedContent = (content as Array<Record<string, unknown>>).map((block) => {
        if (
          block.type === "image" &&
          block.source &&
          typeof (block.source as Record<string, unknown>).data === "string"
        ) {
          return {
            ...block,
            source: { ...(block.source as Record<string, unknown>), data: "[BASE64_HIDDEN]" },
          };
        }
        return block;
      });

      return { ...msg, content: sanitizedContent };
    });

    const { tools, system, messages: _messages, ...configParams } = requestBody;
    const sanitizedBody = {
      ...configParams,
      ...(tools !== undefined && { tools }),
      ...(system !== undefined && { system }),
      messages: sanitizedMessages,
    };
    log.info(`Request Body: ${JSON.stringify(sanitizedBody, null, 2)}`);
  }

  async buildProbeMessages(
    contextItems: StructuredContextItem[],
    seesImages: boolean,
  ): Promise<{ system: string; messages: Array<Record<string, unknown>> }> {
    const { systemPrompt, messages } = await this.assembleAnthropicContext(
      contextItems,
      [],
      undefined,
      seesImages,
      providerRequiresAlternation("anthropic"),
    );
    return {
      system: typeof systemPrompt === "string" ? systemPrompt : "",
      messages: messages as unknown as Array<Record<string, unknown>>,
    };
  }
}
