import { createHash } from "node:crypto";
import {
  applyAnthropicCacheBreakpoints,
  isOpenRouterAnthropicModel,
  relocateCacheContextItems,
} from "@/providers/utils/anthropicCache";
import { mapWithConcurrency } from "@/utils/async/bounded";
import { resolveToolCallId } from "@/providers/utils/toolCallIds";
import type { FunctionCall, FunctionResponseImageMetadata, ThoughtLogEntry } from "../../types/provider/interfaces";
import type { ContextPart, StructuredContextItem } from "@/types/misc/context";
import { log } from "../../utils/misc/logger";
import {
  formatProviderErrorCodeForDisplay,
  isProviderTimeoutMessage,
} from "@/utils/provider/providerErrorClassification";
import { localizer } from "../../utils/text/localizer";
import { truncateBeforeGenericSpeakerLine } from "@/utils/text/processors/llmOutputProcessor";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import {
  collectRenderModifierSourceNames,
  isAllowedRenderModifierSpeakerLabel,
} from "@/utils/discord/renderModifierParser";
import { collectPersonaNameAliases } from "@/utils/discord/stream/textConfig";
import {
  getOpenRouterCapabilities,
  getOpenRouterSupportedParameters,
  getOpenRouterTokenLimits,
  isOpenRouterCapabilityCacheReady,
} from "../../utils/cache/openrouterCapabilityCache";
import { buildProviderStopStrings } from "../utils/stopStrings";
import { fetchAndOptimizeImage } from "../../utils/image/imageProcessor";
import {
  buildGifToolHint,
  buildGifUrlPlaceholder,
  buildInlineGifPlaceholder,
} from "@/providers/utils/gifContextPlaceholders";
import { inlineToolResponseImage } from "@/providers/utils/toolImageContent";
import { buildOpenrouterProviderRouting } from "./providerRouting";
import { buildOpenRouterReasoningRequest } from "@/utils/provider/thinkingControl";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { BaseStreamAdapter } from "../../types/stream/interfaces";
import { DISCORD_STREAMING_CONSTANTS } from "../../types/stream/types";
import { ReasoningContentSpillGuard } from "@/providers/utils/reasoningContentSpillGuard";
import {
  applyAssistantPrefixCompletion,
  assistantMediaRelocationNotice,
  CONVERSATION_START_USER_TEXT,
  ensureLeadingUserTurn,
  isSystemInstructionContextItem,
  mergeConsecutiveSameRole,
  type NormalizableMessage,
} from "@/providers/utils/strictChatCompat";
import { ThinkBlockContentStripper } from "@/providers/utils/thinkBlockContentStripper";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { parseAccumulatedToolArguments } from "@/providers/utils/toolCallArguments";
import {
  beginProviderRequest,
  hasProviderRequestHook,
  type ProviderRequestHold,
} from "@/utils/provider/providerRequestHook";
import {
  areDegradationBodiesEqual,
  createDegradationQueue,
  buildImageStripAttempt,
  buildTargetedAttempt,
  classifyDegradableError,
  extractRejectedParams,
  isMultimodalRejectionError,
  MAX_TARGETED_DEGRADATION_ATTEMPTS,
  planDegradationRetry,
  stripImageBlocksWithNotice,
  type DegradableErrorInput,
} from "@/providers/utils/paramDegradation";
import type {
  ProcessedChunk,
  ProviderError,
  RawStreamChunk,
  StreamConfig,
  StreamContext,
} from "../../types/stream/interfaces";

export interface OpenrouterStreamConfig extends StreamConfig {
  seesImages?: boolean;
  seesYoutube?: boolean;
  seesVideos?: boolean;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  minP?: number;
  logitBias?: Record<string, number>;
}

interface OpenrouterStreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  provider?: string;
  choices?: Array<{
    index: number;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning?: string | null;
      toolCalls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        thought_signature?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        thought_signature?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
      // biome-ignore lint/suspicious/noExplicitAny: reasoning_details has complex nested structure that varies by provider
      reasoning_details?: any[];
      // biome-ignore lint/suspicious/noExplicitAny: reasoningDetails has complex nested structure that varies by provider
      reasoningDetails?: any[];
    };
    finishReason?: string | null;
    finish_reason?: string | null;
    logprobs?: unknown | null;
  }>;
  usage?: {
    promptTokens?: number;
    prompt_tokens?: number;
    completionTokens?: number;
    completion_tokens?: number;
    totalTokens?: number;
    total_tokens?: number;
    completionTokensDetails?: unknown;
    completion_tokens_details?: unknown;
    promptTokensDetails?: unknown;
    prompt_tokens_details?: unknown;
    cost?: number;
  };
  error?:
    | {
        code?: string | number;
        message?: string;
      }
    | ProviderError;
}

interface AccumulatedToolCall {
  id?: string;
  type?: string;
  thought_signature?: string;
  functionName: string;
  functionArguments: string;
}

// Keep off unless debugging because Bun's verbose fetch logs unredacted Authorization headers and hooked request
// bodies.
const OPENROUTER_VERBOSE_FETCH = (process.env.OPENROUTER_VERBOSE_FETCH ?? "false").trim().toLowerCase() === "true";

// The 10% margin absorbs token-estimate error because OpenRouter rejects window-overshooting requests outright
// instead of trimming.
const OPENROUTER_OUTPUT_SAFETY_FACTOR = 0.9;

// Floor for the output safety cap so a nearly full window still allows a usable reply when remaining context fits.
const OPENROUTER_MIN_OUTPUT_TOKENS = 256;

export class OpenrouterStreamAdapter extends BaseStreamAdapter {
  private static readonly TEMPERATURE_OMIT_MODELS = new Set<string>([]);

  private static readonly SPEAKER_GUARD_HOLDBACK_CHARS = 32;
  private static readonly STREAM_TEXT_TAIL_CHARS = 4096;
  private static readonly STREAM_TEXT_MIN_DEDUP_CHARS = 8;

  private toolCallAccumulator: Map<number, AccumulatedToolCall> = new Map();

  // biome-ignore lint/suspicious/noExplicitAny: reasoning_details has complex nested structure that varies by provider
  private reasoningDetailsAccumulator: any[] = [];
  private readonly thinkBlockStripper = new ThinkBlockContentStripper({ loggerName: "OpenRouter" });
  private readonly reasoningContentSpillGuard = new ReasoningContentSpillGuard("OpenRouter");
  private speakerGuardPendingTail = "";
  private streamedTextTail = "";
  private servingProvider?: string;
  private speakerGuardEnabled = false;
  private speakerGuardAllowedSourceNames: string[] = [];

  constructor() {
    super({
      name: "openrouter",
      version: "1.0.0",
      supportsFunctionCalling: true,
    });
  }

  public async buildProbeMessages(
    contextItems: StructuredContextItem[],
    seesImages = true,
    seesVideos = false,
    seesYoutube = false,
  ): Promise<Array<Record<string, unknown>>> {
    return this.assembleOpenrouterContext(
      contextItems,
      [],
      undefined,
      seesImages,
      "Assistant",
      seesVideos,
      undefined,
      undefined,
      undefined,
      seesYoutube,
    );
  }

  private isOpenRouterParamSupported(
    supportedParameters: ReadonlySet<string> | null,
    param: string,
    aliases: string[] = [],
  ): boolean {
    if (!supportedParameters) return true;
    return supportedParameters.has(param) || aliases.some((alias) => supportedParameters.has(alias));
  }

  private stripImagesFromMessages(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return stripImageBlocksWithNotice(messages);
  }

  // Inline base64 data-URI image payloads are excluded because their serialized length does not map to multimodal
  // token usage.
  private estimateInputTokensForSafetyCap(messages: Array<Record<string, unknown>>): number {
    const estimatedChars = messages.reduce((total, message) => total + this.estimateValueCharsForSafetyCap(message), 0);
    return Math.ceil(estimatedChars / 4);
  }

  private estimateValueCharsForSafetyCap(value: unknown, parentKey?: string): number {
    if (typeof value === "string") {
      if (parentKey === "url" && value.startsWith("data:") && value.includes(";base64,")) {
        return 0;
      }
      return value.length;
    }

    if (Array.isArray(value)) {
      return value.reduce((total, item) => total + this.estimateValueCharsForSafetyCap(item, parentKey), 0);
    }

    if (!value || typeof value !== "object") {
      return 0;
    }

    const record = value as Record<string, unknown>;
    if (parentKey === "image_url" || parentKey === "imageUrl") {
      const urlValue = record.url;
      if (typeof urlValue !== "string") {
        return 0;
      }
      if (urlValue.startsWith("data:") && urlValue.includes(";base64,")) {
        return 0;
      }
      return urlValue.length;
    }

    let totalChars = 0;
    for (const [key, childValue] of Object.entries(record)) {
      if (key === "image_url" || key === "imageUrl") {
        totalChars += this.estimateValueCharsForSafetyCap(childValue, key);
        continue;
      }
      totalChars += key.length;
      totalChars += this.estimateValueCharsForSafetyCap(childValue, key);
    }

    return totalChars;
  }

  private resetPerAttemptState(personaSpeakerLabelRegex: RegExp | null): void {
    this.toolCallAccumulator.clear();
    this.reasoningDetailsAccumulator = [];
    this.speakerGuardPendingTail = "";
    this.streamedTextTail = "";
    this.servingProvider = undefined;
    this.reasoningContentSpillGuard.reset();
    this.thinkBlockStripper.reset(personaSpeakerLabelRegex);
  }

  private getMidStreamError(chunk: OpenrouterStreamChunk): DegradableErrorInput | null {
    if (!chunk.error) return null;
    const code = chunk.error.code;
    const numericCode = typeof code === "number" ? code : Number(code);
    return {
      statusCode: Number.isFinite(numericCode) ? numericCode : null,
      message: chunk.error.message ?? "OpenRouter API error",
    };
  }

  private isMeaningfulCommitmentChunk(chunk: OpenrouterStreamChunk): boolean {
    if (chunk.usage) return true;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return false;
    return Boolean(
      (typeof delta.content === "string" && delta.content.length > 0) ||
        (typeof delta.reasoning === "string" && delta.reasoning.length > 0) ||
        (delta.toolCalls && delta.toolCalls.length > 0) ||
        (delta.tool_calls && delta.tool_calls.length > 0) ||
        (delta.reasoning_details && delta.reasoning_details.length > 0) ||
        (delta.reasoningDetails && delta.reasoningDetails.length > 0),
    );
  }

  private parseHttpErrorFromResponse(
    responseStatus: number,
    responseStatusText: string,
    responseHeaders: Headers,
    errorText: string,
    requestBody: Record<string, unknown>,
    model: string | undefined,
    attemptLabel: string,
    videoDiagnostics?: StreamContext["videoRequestDiagnostics"],
  ): { error: Error; errorMessage: string; statusCode: number } {
    let errorMessage = errorText || responseStatusText;
    let errorCode: string | undefined;
    let rawErrorBodyFromMetadata: string | undefined;

    try {
      const parsed: unknown = JSON.parse(errorText);
      if (videoDiagnostics) this.captureVideoResponseDiagnostics(videoDiagnostics, parsed);
      const errorData = parsed as {
        error?: {
          message?: string;
          code?: string | number;
          metadata?: { raw?: string };
        };
        message?: string;
        detail?: unknown;
      };
      errorCode = errorData?.error?.code !== undefined ? String(errorData.error.code) : undefined;
      rawErrorBodyFromMetadata = errorData?.error?.metadata?.raw;
      errorMessage =
        errorData?.error?.metadata?.raw ||
        errorData?.error?.message ||
        errorData?.message ||
        // Some upstream backends relay their own FastAPI-style `{"detail": "..."}` body unwrapped.
        (typeof errorData?.detail === "string" ? errorData.detail : "") ||
        errorText ||
        responseStatusText;
    } catch {
      errorMessage = errorText || responseStatusText;
    }

    const statusLabel = errorCode ? `HTTP ${responseStatus} (${errorCode})` : `HTTP ${responseStatus}`;
    const requestParamKeys = Object.keys(requestBody).sort().join(", ");
    const rawErrorBody = rawErrorBodyFromMetadata || errorText;
    const rawErrorBodySnippet = rawErrorBody.length > 3000 ? `${rawErrorBody.substring(0, 3000)}...` : rawErrorBody;
    const shouldAppendRawBody =
      classifyDegradableError({ statusCode: 400, message: errorMessage }) === "generic_400" &&
      Boolean(rawErrorBodySnippet);

    return {
      error: new Error(
        `${statusLabel}: ${errorMessage}${shouldAppendRawBody ? ` | raw_response: ${rawErrorBodySnippet}` : ""} | model: ${model ?? "other-model"} | request_params: ${requestParamKeys} | request_attempt: ${attemptLabel}`,
        { cause: readOpenRouterLimitError(responseStatus, responseHeaders, errorText) ?? undefined },
      ),
      errorMessage,
      statusCode: responseStatus,
    };
  }

  private captureVideoResponseDiagnostics(
    diagnostics: NonNullable<StreamContext["videoRequestDiagnostics"]>,
    payload: unknown,
  ): void {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const envelope = payload as Record<string, unknown>;
    if (typeof envelope.id === "string" && /^[a-zA-Z0-9_.:-]{1,200}$/.test(envelope.id)) {
      diagnostics.generationId = envelope.id;
    }
    const error = envelope.error && typeof envelope.error === "object" ? envelope.error : undefined;
    const metadata = error && "metadata" in error ? error.metadata : undefined;
    const provider =
      envelope.provider ??
      (metadata && typeof metadata === "object" && "provider_name" in metadata ? metadata.provider_name : undefined);
    if (typeof provider === "string" && /^[a-zA-Z0-9_. -]{1,100}$/.test(provider)) {
      diagnostics.servingProvider = provider;
    }
  }

  private describeVideoInput(
    part: Extract<ContextPart, { type: "video" }>,
  ): NonNullable<StreamContext["videoRequestDiagnostics"]>["videos"][number] {
    const diagnostics: NonNullable<StreamContext["videoRequestDiagnostics"]>["videos"][number] = {
      source: "invalid_url",
      scheme: "invalid",
      mimeType: [
        "video/mp4",
        "video/webm",
        "video/mpeg",
        "video/mov",
        "video/quicktime",
        "video/youtube",
        "video/ogg",
        "video/x-msvideo",
        "video/x-matroska",
        "application/octet-stream",
      ].includes(part.mimeType)
        ? part.mimeType
        : "other",
    };
    if (part.uri.startsWith("data:")) {
      diagnostics.source = "inline_data";
      diagnostics.scheme = "data";
      diagnostics.encodedBytes = Buffer.byteLength(part.uri);
      return diagnostics;
    }
    try {
      const url = new URL(part.uri);
      if (url.protocol === "http:" || url.protocol === "https:") {
        diagnostics.scheme = url.protocol === "http:" ? "http" : "https";
      }
      if (["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)) {
        diagnostics.source = "discord_cdn";
        const expiry = url.searchParams.get("ex");
        if (expiry && /^[a-fA-F0-9]{1,12}$/.test(expiry)) {
          diagnostics.expiresAtUnixSeconds = Number.parseInt(expiry, 16);
        }
      } else if (["youtube.com", "youtu.be"].includes(url.hostname) || url.hostname.endsWith(".youtube.com")) {
        diagnostics.source = "youtube";
      } else {
        diagnostics.source = "remote_url";
      }
    } catch {
      diagnostics.source = "invalid_url";
    }
    return diagnostics;
  }

  async *startStream(config: StreamConfig, context: StreamContext): AsyncGenerator<RawStreamChunk, void, unknown> {
    log.info("OpenrouterStreamAdapter: Initializing OpenRouter streaming");

    this.toolCallAccumulator.clear();
    this.reasoningDetailsAccumulator = [];
    this.speakerGuardPendingTail = "";
    this.streamedTextTail = "";
    this.servingProvider = undefined;
    context.videoRequestDiagnostics = undefined;
    const botName = context.prefixStrippingName ?? context.personaUsername ?? context.tomoriState.persona_nickname;
    this.speakerGuardAllowedSourceNames = collectRenderModifierSourceNames(
      botName,
      collectPersonaNameAliases(context.tomoriState, botName, context.impersonatedSpeakerLabel),
    );
    this.speakerGuardEnabled = false;
    this.reasoningContentSpillGuard.reset();
    const personaNickname = context.tomoriState.persona_nickname?.trim();
    const personaSpeakerLabelRegex = personaNickname
      ? new RegExp(`(?:^|\\n)\\s*${escapeRegExp(personaNickname)}\\s*[:：]`, "i")
      : null;
    this.thinkBlockStripper.reset(personaSpeakerLabelRegex);

    const openrouterConfig = config as OpenrouterStreamConfig;

    const videoDiagnostics: NonNullable<StreamContext["videoRequestDiagnostics"]> = {
      model: config.model,
      attempt: "default",
      omittedVideos: 0,
      videos: [],
    };
    let messages = await this.assembleOpenrouterContext(
      context.contextItems,
      context.currentTurnModelParts,
      context.functionInteractionHistory,
      openrouterConfig.seesImages ?? true,
      context.tomoriState.persona_nickname ?? "Assistant",
      openrouterConfig.seesVideos ?? false,
      context.messageIdMap,
      config.model,
      videoDiagnostics,
      openrouterConfig.seesYoutube ?? false,
    );
    if (videoDiagnostics.videos.length > 0) context.videoRequestDiagnostics = videoDiagnostics;

    // Enforce role alternation only when strict_role_alternation is enabled so proxied backends accept history.
    if (context.tomoriState.llm?.strict_role_alternation) {
      const normalized = ensureLeadingUserTurn(
        mergeConsecutiveSameRole(messages as unknown as NormalizableMessage[]),
        () => ({ role: "user", content: CONVERSATION_START_USER_TEXT }),
      );
      messages = normalized as unknown as Array<Record<string, unknown>>;
      log.info(`OpenrouterStreamAdapter: Applied strict role alternation (${messages.length} messages)`);
    }

    if (!config.model) {
      throw new Error("Model must be specified in config. Use OpenrouterProvider.getDefaultModel() if needed.");
    }

    log.info(`Generating content with model ${config.model}`);

    if (config.tools && Array.isArray(config.tools) && config.tools.length > 0) {
      log.info(`Tools:\n${JSON.stringify(config.tools, null, 2)}`);
    }

    if (!context.holdResponseText) this.logSanitizedRequest(messages);

    let controller: AbortController | null = null;

    try {
      const supportedParameters =
        config.model && isOpenRouterCapabilityCacheReady()
          ? (getOpenRouterSupportedParameters(config.model) ?? null)
          : null;
      const skippedUnsupportedParams: string[] = [];
      const normalizedModel = (config.model ?? "").toLowerCase();
      const omitTemperatureByModelOverride = OpenrouterStreamAdapter.TEMPERATURE_OMIT_MODELS.has(normalizedModel);
      const speakerStopPatternEnabled = context.tomoriState.config.llm_stop_speaker_pattern_enabled ?? false;
      const stopStrings = buildProviderStopStrings({
        providerName: "openrouter",
        model: config.model,
        personaName: context.tomoriState.persona_nickname,
        configuredStops: context.tomoriState.config.llm_stop_strings,
        includePersonaSpeakerStop: speakerStopPatternEnabled,
      });
      let stopParamSupported = false;

      const requestBody: Record<string, unknown> = {
        model: config.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (isOpenRouterAnthropicModel(config.model)) {
        requestBody.session_id = createHash("sha256")
          .update(`${context.channel.id}:${context.tomoriState.persona_id}:${config.model}`)
          .digest("hex");
      }
      const reasoningRequest = buildOpenRouterReasoningRequest(
        context.tomoriState.config.thinking_level,
        config.forceReason,
      );
      if (reasoningRequest.reasoning) {
        requestBody.reasoning = reasoningRequest.reasoning;
      }

      if (
        config.temperature !== undefined &&
        !omitTemperatureByModelOverride &&
        this.isOpenRouterParamSupported(supportedParameters, "temperature")
      ) {
        requestBody.temperature = config.temperature;
      } else if (config.temperature !== undefined) {
        skippedUnsupportedParams.push("temperature");
      }

      // Clamp max_tokens to remaining context (with a best-effort floor) and skip when undefined so unknown models use
      // OpenRouter defaults.
      let effectiveMaxOutputTokens = config.maxOutputTokens;
      if (effectiveMaxOutputTokens !== undefined && config.model && isOpenRouterCapabilityCacheReady()) {
        const tokenLimits = getOpenRouterTokenLimits(config.model);
        if (tokenLimits && tokenLimits.contextLength > 0) {
          const minOutputTokensFloor = Math.min(OPENROUTER_MIN_OUTPUT_TOKENS, effectiveMaxOutputTokens);
          const estimatedInputTokens = this.estimateInputTokensForSafetyCap(messages);
          const remainingContextTokens = tokenLimits.contextLength - estimatedInputTokens;
          const rawSafeOutputBudget = Math.floor(remainingContextTokens * OPENROUTER_OUTPUT_SAFETY_FACTOR);
          let safeOutputBudget = Math.max(1, rawSafeOutputBudget);
          let minOutputFloorApplied = false;

          if (safeOutputBudget < minOutputTokensFloor && remainingContextTokens >= minOutputTokensFloor) {
            safeOutputBudget = minOutputTokensFloor;
            minOutputFloorApplied = true;
          }

          if (safeOutputBudget < effectiveMaxOutputTokens) {
            log.warn(
              `Context-window safety cap applied for ${config.model}: ` +
                `maxOutputTokens ${effectiveMaxOutputTokens} → ${safeOutputBudget} ` +
                `(contextLength=${tokenLimits.contextLength}, estimatedInput≈${estimatedInputTokens}, remaining=${remainingContextTokens}, rawBudget=${rawSafeOutputBudget}, safetyFactor=${OPENROUTER_OUTPUT_SAFETY_FACTOR}, minFloor=${minOutputTokensFloor}, minFloorApplied=${minOutputFloorApplied})`,
            );
            effectiveMaxOutputTokens = safeOutputBudget;
          } else if (minOutputFloorApplied) {
            log.info(
              `Context-window minimum output floor preserved for ${config.model}: ` +
                `maxOutputTokens remains ${effectiveMaxOutputTokens} ` +
                `(contextLength=${tokenLimits.contextLength}, estimatedInput≈${estimatedInputTokens}, remaining=${remainingContextTokens}, rawBudget=${rawSafeOutputBudget}, safetyFactor=${OPENROUTER_OUTPUT_SAFETY_FACTOR}, minFloor=${minOutputTokensFloor})`,
            );
          }
        }
      }
      if (effectiveMaxOutputTokens !== undefined) {
        if (this.isOpenRouterParamSupported(supportedParameters, "max_tokens", ["max_completion_tokens"])) {
          requestBody.max_tokens = effectiveMaxOutputTokens;
        } else {
          skippedUnsupportedParams.push("max_tokens");
        }
      }

      // Fall back to the capability cache when supported_parameters omits "tools" because some OpenRouter entries
      // misreport it.
      if (config.tools && config.tools.length > 0) {
        const capabilityAllowsTools =
          config.model !== "other-model" ? (getOpenRouterCapabilities(config.model)?.hasTools ?? false) : false;
        if (this.isOpenRouterParamSupported(supportedParameters, "tools") || capabilityAllowsTools) {
          requestBody.tools = config.tools;
          const providerRouting = buildOpenrouterProviderRouting({ requiresParameterSupport: true });
          if (providerRouting) {
            requestBody.provider = providerRouting;
          }
        } else {
          skippedUnsupportedParams.push("tools");
        }
      }

      if (openrouterConfig.topP !== undefined) {
        if (this.isOpenRouterParamSupported(supportedParameters, "top_p")) {
          requestBody.top_p = openrouterConfig.topP;
        } else {
          skippedUnsupportedParams.push("top_p");
        }
      }
      if (openrouterConfig.topK !== undefined) {
        if (this.isOpenRouterParamSupported(supportedParameters, "top_k")) {
          requestBody.top_k = openrouterConfig.topK;
        } else {
          skippedUnsupportedParams.push("top_k");
        }
      }
      if (openrouterConfig.frequencyPenalty !== undefined) {
        if (this.isOpenRouterParamSupported(supportedParameters, "frequency_penalty")) {
          requestBody.frequency_penalty = openrouterConfig.frequencyPenalty;
        } else {
          skippedUnsupportedParams.push("frequency_penalty");
        }
      }
      if (openrouterConfig.presencePenalty !== undefined) {
        if (this.isOpenRouterParamSupported(supportedParameters, "presence_penalty")) {
          requestBody.presence_penalty = openrouterConfig.presencePenalty;
        } else {
          skippedUnsupportedParams.push("presence_penalty");
        }
      }
      if (openrouterConfig.repetitionPenalty !== undefined) {
        if (this.isOpenRouterParamSupported(supportedParameters, "repetition_penalty")) {
          requestBody.repetition_penalty = openrouterConfig.repetitionPenalty;
        } else {
          skippedUnsupportedParams.push("repetition_penalty");
        }
      }
      if (openrouterConfig.minP !== undefined) {
        if (this.isOpenRouterParamSupported(supportedParameters, "min_p")) {
          requestBody.min_p = openrouterConfig.minP;
        } else {
          skippedUnsupportedParams.push("min_p");
        }
      }
      if (openrouterConfig.logitBias !== undefined) {
        if (this.isOpenRouterParamSupported(supportedParameters, "logit_bias")) {
          requestBody.logit_bias = openrouterConfig.logitBias;
        } else {
          skippedUnsupportedParams.push("logit_bias");
        }
      }

      if (stopStrings) {
        stopParamSupported = this.isOpenRouterParamSupported(supportedParameters, "stop");
        if (stopParamSupported) {
          requestBody.stop = stopStrings;
        } else {
          skippedUnsupportedParams.push("stop");
        }
      }

      this.speakerGuardEnabled = speakerStopPatternEnabled;
      if (this.speakerGuardEnabled) {
        log.info("OpenRouter: Speaker-boundary fallback guard enabled");
      }

      if (supportedParameters && skippedUnsupportedParams.length > 0) {
        log.info(`OpenRouter: Skipping unsupported params for ${config.model}: ${skippedUnsupportedParams.join(", ")}`);
      }
      if (omitTemperatureByModelOverride) {
        log.info(`OpenRouter: Temperature omitted due to model override for ${config.model}`);
      }

      const effectiveTemperatureLabel = "temperature" in requestBody ? String(config.temperature) : "omitted";

      log.info(
        `Sampling params - temp: ${effectiveTemperatureLabel}, top_p: ${openrouterConfig.topP ?? "default"}, top_k: ${openrouterConfig.topK ?? "default"}, freq_penalty: ${openrouterConfig.frequencyPenalty ?? "default"}, pres_penalty: ${openrouterConfig.presencePenalty ?? "default"}, rep_penalty: ${openrouterConfig.repetitionPenalty ?? "default"}, min_p: ${openrouterConfig.minP ?? "default"}, logit_bias: ${Object.keys(openrouterConfig.logitBias ?? {}).length}`,
      );

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...buildOpenRouterAttributionHeaders(),
      };

      if (config.apiKey && config.apiKey.trim() !== "") {
        headers.Authorization = `Bearer ${config.apiKey}`;
      }

      if (context.tomoriState.llm?.supports_prefix_completion) {
        applyAssistantPrefixCompletion(requestBody, context.outputPrefill?.trim());
      }

      const inactivityTimeoutMs = config.inactivityTimeoutMs ?? DISCORD_STREAMING_CONSTANTS.INACTIVITY_TIMEOUT_MS;
      // Keep firstTokenTimeoutMs at least FIRST_TOKEN_TIMEOUT_MS because ": OPENROUTER PROCESSING" comments do not
      // count as content.
      const firstTokenTimeoutMs = Math.max(inactivityTimeoutMs, DISCORD_STREAMING_CONSTANTS.FIRST_TOKEN_TIMEOUT_MS);
      const mandatoryKeys = new Set(["model", "messages", "stream"]);
      if (requestBody.session_id) mandatoryKeys.add("session_id");
      const { attempts, prepareAttempts } = createDegradationQueue(requestBody, {
        mandatoryKeys,
        stripImages: (attemptMessages) =>
          Array.isArray(attemptMessages)
            ? this.stripImagesFromMessages(attemptMessages as Array<Record<string, unknown>>)
            : attemptMessages,
      });
      const attemptedBodies: Record<string, unknown>[] = [];
      let targetedAttemptCount = 0;
      const queueTargetedAttempt = (
        currentIndex: number,
        currentBody: Record<string, unknown>,
        errorMessage: string,
      ): boolean => {
        if (targetedAttemptCount >= MAX_TARGETED_DEGRADATION_ATTEMPTS) {
          return false;
        }

        const rejectedParams = extractRejectedParams(errorMessage, currentBody);
        if (rejectedParams.length === 0) return false;

        const targetedAttempt = buildTargetedAttempt(currentBody, rejectedParams);
        if (attemptedBodies.some((body) => areDegradationBodiesEqual(body, targetedAttempt.body))) return false;

        const duplicateIndex = attempts.findIndex(
          (queuedAttempt, index) =>
            index > currentIndex && areDegradationBodiesEqual(queuedAttempt.body, targetedAttempt.body),
        );
        if (duplicateIndex !== -1) {
          attempts.splice(duplicateIndex, 1);
        }
        attempts.splice(currentIndex + 1, 0, targetedAttempt);
        targetedAttemptCount += 1;
        return true;
      };
      // Strip images immediately on multimodal rejections instead of probing samplers because text-only backends reject
      // every image payload.
      let imageStripAttemptQueued = false;
      const queueImageStripAttempt = (
        currentIndex: number,
        currentBody: Record<string, unknown>,
        errorMessage: string,
      ): boolean => {
        if (imageStripAttemptQueued || !isMultimodalRejectionError(errorMessage)) {
          return false;
        }

        const imageStripAttempt = buildImageStripAttempt(currentBody);
        if (!imageStripAttempt) return false;

        if (attemptedBodies.some((body) => areDegradationBodiesEqual(body, imageStripAttempt.body))) return false;

        const duplicateIndex = attempts.findIndex(
          (queuedAttempt, index) =>
            index > currentIndex && areDegradationBodiesEqual(queuedAttempt.body, imageStripAttempt.body),
        );
        if (duplicateIndex !== -1) {
          attempts.splice(duplicateIndex, 1);
        }
        attempts.splice(currentIndex + 1, 0, imageStripAttempt);
        imageStripAttemptQueued = true;
        return true;
      };

      let completedAttempt = false;
      attemptLoop: for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        if (context.videoRequestDiagnostics) {
          videoDiagnostics.attempt = attempt.label;
          videoDiagnostics.httpStatus = undefined;
          videoDiagnostics.requestId = undefined;
          videoDiagnostics.generationId = undefined;
          videoDiagnostics.servingProvider = undefined;
        }
        const isRetry = i > 0;
        attemptedBodies.push(attempt.body);

        if (isRetry) {
          log.warn(`OpenRouter request retry with degraded payload: ${attempt.label} (${config.model})`);
        }

        controller = new AbortController();
        const currentController = controller;
        const externalAbortListener = () => currentController.abort();
        if (context.abortSignal?.aborted) {
          currentController.abort();
        } else {
          context.abortSignal?.addEventListener("abort", externalAbortListener, { once: true });
        }

        const requestInit: RequestInit & { verbose?: boolean } = {
          method: "POST",
          headers,
          body: JSON.stringify(attempt.body),
          signal: currentController.signal,
        };

        if (OPENROUTER_VERBOSE_FETCH && !hasProviderRequestHook()) {
          requestInit.verbose = true;
        }

        let spendHold: ProviderRequestHold | undefined;
        let attemptCompleted = false;
        let attemptFailed = false;
        try {
          currentController.signal.throwIfAborted();
          spendHold = await beginProviderRequest({
            apiKey: config.apiKey ?? "",
            path: "/chat/completions",
            body: attempt.body,
          });
          if (currentController.signal.aborted) {
            spendHold?.reportCost(0);
            currentController.signal.throwIfAborted();
          }
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", requestInit);
          if (context.videoRequestDiagnostics) {
            videoDiagnostics.httpStatus = response.status;
            const requestId = response.headers.get("x-request-id");
            if (requestId && /^[a-zA-Z0-9_.:-]{1,200}$/.test(requestId)) videoDiagnostics.requestId = requestId;
          }

          if (!response.ok) {
            spendHold?.reportCost(0);
            const errorText = await response.text();
            const parsedError = this.parseHttpErrorFromResponse(
              response.status,
              response.statusText,
              response.headers,
              errorText,
              attempt.body,
              config.model,
              attempt.label,
              context.videoRequestDiagnostics,
            );

            const retryPlan = planDegradationRetry({
              prepareAttempts,
              attempts,
              attemptIndex: i,
              body: attempt.body,
              statusCode: parsedError.statusCode,
              message: parsedError.errorMessage,
              classifyOptions: { degradeOn502: true },
              queueTargetedAttempt,
              queueImageStripAttempt,
            });
            if (retryPlan) {
              log.warn(
                `OpenRouter returned ${retryPlan.trigger} on attempt '${attempt.label}', trying fallback payload`,
                { model: config.model, errorMessage: parsedError.errorMessage },
              );
              continue;
            }

            throw parsedError.error;
          }

          if (!response.body) {
            throw new Error("Response body is null");
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let lastMeaningfulAt = Date.now();
          let sawMeaningfulChunk = false;
          const currentIdleBudgetMs = () => (sawMeaningfulChunk ? inactivityTimeoutMs : firstTokenTimeoutMs);
          let committedToAttempt = false;
          let recoveryLogged = false;
          let pendingToolCallChunk: OpenrouterStreamChunk | undefined;
          // True once the body no longer needs cancelling: either the stream ended on its own,
          // or a retry path already cancelled it.
          let readerSettled = false;

          const logRecovery = () => {
            if (!isRetry || recoveryLogged) return;
            recoveryLogged = true;
            log.warn(`OpenRouter request recovered after retry: ${attempt.label} (${config.model})`);
            if (attempt.label.startsWith("probe_drop_") || attempt.label.startsWith("targeted_drop_")) {
              const droppedParams = attempt.label.replace(/^(?:probe|targeted)_drop_/, "");
              log.warn(
                `OpenRouter probe indicates likely incompatible parameter for ${config.model}: ${droppedParams}`,
              );
            }
          };

          const readWithTimeout = async () => {
            let timeoutId: NodeJS.Timeout | null = null;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                reject(new Error("OpenRouter stream timed out while waiting for data"));
              }, currentIdleBudgetMs());
            });

            try {
              return await Promise.race([reader.read(), timeoutPromise]);
            } finally {
              if (timeoutId) clearTimeout(timeoutId);
            }
          };

          try {
            responseLoop: while (true) {
              const readResult = (await readWithTimeout()) as {
                done: boolean;
                value?: Uint8Array;
              };

              if (readResult.done) {
                readerSettled = true;
                break;
              }
              if (!readResult.value) continue;

              buffer += decoder.decode(readResult.value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine || trimmedLine.startsWith(":") || !trimmedLine.startsWith("data:")) continue;

                const data = trimmedLine.slice(5).trim();
                if (!data) continue;
                if (data === "[DONE]") {
                  log.info("OpenrouterStreamAdapter: Stream completed [DONE]");
                  if (pendingToolCallChunk) break responseLoop;
                  continue;
                }

                let parsed: unknown;
                try {
                  parsed = JSON.parse(data);
                } catch (parseError) {
                  log.warn(`OpenrouterStreamAdapter: Failed to parse SSE data: ${data}`, {
                    error: parseError instanceof Error ? parseError.message : String(parseError),
                  });
                  continue;
                }

                if (context.videoRequestDiagnostics) this.captureVideoResponseDiagnostics(videoDiagnostics, parsed);
                const normalizedChunk = this.normalizeOpenrouterChunk(parsed);
                if (!normalizedChunk) continue;
                spendHold?.reportCost(normalizedChunk.usage?.cost);

                const midStreamError = this.getMidStreamError(normalizedChunk);
                if (
                  midStreamError ||
                  normalizedChunk.choices?.some((choice) => (choice.finishReason ?? choice.finish_reason) === "error")
                )
                  attemptFailed = true;
                if (midStreamError && !committedToAttempt) {
                  const retryPlan = planDegradationRetry({
                    prepareAttempts,
                    attempts,
                    attemptIndex: i,
                    body: attempt.body,
                    statusCode: midStreamError.statusCode,
                    message: midStreamError.message,
                    classifyOptions: { degradeOn502: true },
                    queueTargetedAttempt,
                    queueImageStripAttempt,
                  });
                  if (retryPlan) {
                    log.warn(
                      `OpenRouter received ${retryPlan.trigger} before stream commitment on attempt '${attempt.label}', trying fallback payload`,
                      { model: config.model, errorMessage: midStreamError.message },
                    );
                    // Cancel the reader before aborting so teardown exits gracefully instead of rejecting a read.
                    const cancelPromise = reader.cancel().catch(() => undefined);
                    readerSettled = true;
                    currentController.abort();
                    await cancelPromise;
                    this.resetPerAttemptState(personaSpeakerLabelRegex);
                    continue attemptLoop;
                  }
                }

                const chunksToEmit = this.splitChunkWithTextAndToolSignals(normalizedChunk);
                for (const chunkToEmit of chunksToEmit) {
                  const strippedChunk = this.stripThinkBlocksFromChunkContent(chunkToEmit);
                  const spillGuardedChunk = this.applyReasoningContentSpillGuard(strippedChunk);
                  const deduplicatedChunk = this.deduplicateChunkTextAgainstRecentStream(spillGuardedChunk);
                  const guardResult = this.applySpeakerBoundaryFallbackGuard(deduplicatedChunk);
                  const commitsStream = this.isMeaningfulCommitmentChunk(guardResult.chunk);
                  if (commitsStream && !committedToAttempt) {
                    committedToAttempt = true;
                    logRecovery();
                  }

                  if (this.shouldFlushSpeakerGuardTailBeforeNonTextChunk(guardResult.chunk)) {
                    yield {
                      data: {
                        choices: [{ index: 0, delta: { content: this.speakerGuardPendingTail } }],
                      } satisfies OpenrouterStreamChunk,
                      provider: "openrouter",
                      metadata: { timestamp: Date.now(), model: config.model },
                    };
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
                        `OpenRouter speaker guard: generation stopped at detected speaker label "${guardResult.matchedSpeaker ?? "unknown"}"`,
                      );
                      return;
                    }
                    continue;
                  }

                  lastMeaningfulAt = Date.now();
                  sawMeaningfulChunk = true;
                  const finishChoice = guardResult.chunk.choices?.[0];
                  if (
                    (finishChoice?.finishReason ?? finishChoice?.finish_reason) === "tool_calls" &&
                    !guardResult.chunk.usage
                  ) {
                    pendingToolCallChunk = guardResult.chunk;
                    continue;
                  }
                  const emittedChunk =
                    pendingToolCallChunk && guardResult.chunk.usage
                      ? { ...pendingToolCallChunk, usage: guardResult.chunk.usage }
                      : guardResult.chunk;
                  if (guardResult.chunk.usage) pendingToolCallChunk = undefined;
                  yield {
                    data: emittedChunk,
                    provider: "openrouter",
                    metadata: { timestamp: Date.now(), model: config.model },
                  };

                  if (guardResult.stopTriggered) {
                    log.warn(
                      `OpenRouter speaker guard: generation stopped at detected speaker label "${guardResult.matchedSpeaker ?? "unknown"}"`,
                    );
                    return;
                  }
                }
              }

              if (Date.now() - lastMeaningfulAt > currentIdleBudgetMs()) {
                currentController.abort();
                throw new Error("OpenRouter stream timed out due to inactivity");
              }
            }
            if (pendingToolCallChunk) {
              yield {
                data: pendingToolCallChunk,
                provider: "openrouter",
                metadata: { timestamp: Date.now(), model: config.model },
              };
            }
          } finally {
            // Cancel unfinished stream readers on any non-EOF exit so the response body, buffers, and socket do not
            // leak.
            if (!readerSettled) {
              await reader.cancel().catch(() => undefined);
            }
          }

          logRecovery();
          attemptCompleted = !attemptFailed;
          completedAttempt = true;
          break;
        } finally {
          spendHold?.release(attemptCompleted);
          context.abortSignal?.removeEventListener("abort", externalAbortListener);
        }
      }

      if (!completedAttempt) {
        throw new Error("OpenRouter request failed before completing a response stream");
      }

      const flushedSpillChunk = this.flushReasoningContentSpillGuardToChunk();
      if (flushedSpillChunk) {
        yield {
          data: flushedSpillChunk,
          provider: "openrouter",
          metadata: {
            timestamp: Date.now(),
            model: config.model,
          },
        };
      }

      const flushedThinkChunk = this.flushThinkStripperToChunk();
      if (flushedThinkChunk) {
        yield {
          data: flushedThinkChunk,
          provider: "openrouter",
          metadata: {
            timestamp: Date.now(),
            model: config.model,
          },
        };
      }

      if (this.speakerGuardEnabled && this.speakerGuardPendingTail.length > 0) {
        yield {
          data: {
            choices: [
              {
                index: 0,
                delta: {
                  content: this.speakerGuardPendingTail,
                },
              },
            ],
          } satisfies OpenrouterStreamChunk,
          provider: "openrouter",
          metadata: {
            timestamp: Date.now(),
            model: config.model,
          },
        };
        this.speakerGuardPendingTail = "";
      }
    } catch (error) {
      if (controller) {
        controller.abort();
      }
      const flushedSpillChunk = this.flushReasoningContentSpillGuardToChunk();
      if (flushedSpillChunk) {
        yield {
          data: flushedSpillChunk,
          provider: "openrouter",
          metadata: {
            timestamp: Date.now(),
            model: config.model,
          },
        };
      }
      if (this.speakerGuardEnabled && this.speakerGuardPendingTail.length > 0) {
        yield {
          data: {
            choices: [
              {
                index: 0,
                delta: {
                  content: this.speakerGuardPendingTail,
                },
              },
            ],
          } satisfies OpenrouterStreamChunk,
          provider: "openrouter",
          metadata: {
            timestamp: Date.now(),
            model: config.model,
          },
        };
        this.speakerGuardPendingTail = "";
      }
      const flushedThinkChunk = this.flushThinkStripperToChunk();
      if (flushedThinkChunk) {
        yield {
          data: flushedThinkChunk,
          provider: "openrouter",
          metadata: {
            timestamp: Date.now(),
            model: config.model,
          },
        };
      }
      yield this.createProviderErrorChunk(error, context);
    }
  }

  // Some backends leak <think> into delta.content, so this routes it to delta.reasoning using stray </think> or
  // line-start persona labels as implicit closers.
  private stripThinkBlocksFromChunkContent(chunk: OpenrouterStreamChunk): OpenrouterStreamChunk {
    const firstChoice = chunk.choices?.[0];
    const content = firstChoice?.delta?.content;
    if (!firstChoice?.delta || typeof content !== "string" || content.length === 0) {
      return chunk;
    }

    const stripped = this.thinkBlockStripper.strip(content);
    if (!stripped.changed) {
      return chunk;
    }

    const existingReasoning = typeof firstChoice.delta.reasoning === "string" ? firstChoice.delta.reasoning : "";
    const mergedReasoning =
      stripped.thoughtText.length > 0
        ? existingReasoning.length > 0
          ? `${existingReasoning}${stripped.thoughtText}`
          : stripped.thoughtText
        : (firstChoice.delta.reasoning ?? undefined);

    return {
      ...chunk,
      choices: [
        {
          ...firstChoice,
          delta: {
            ...firstChoice.delta,
            content: stripped.visibleText,
            reasoning: mergedReasoning,
          },
        },
        ...(chunk.choices?.slice(1) ?? []),
      ],
    };
  }

  private applyReasoningContentSpillGuard(chunk: OpenrouterStreamChunk): OpenrouterStreamChunk {
    const firstChoice = chunk.choices?.[0];
    if (!firstChoice?.delta) {
      return chunk;
    }

    this.reasoningContentSpillGuard.observeReasoning(firstChoice.delta.reasoning);

    const content = firstChoice.delta.content;
    if (typeof content !== "string" || content.length === 0) {
      return chunk;
    }

    const guardResult = this.reasoningContentSpillGuard.filterContent(content);
    if (!guardResult.changed) {
      return chunk;
    }

    const existingReasoning = typeof firstChoice.delta.reasoning === "string" ? firstChoice.delta.reasoning : "";
    const mergedReasoning = guardResult.spilledThought
      ? existingReasoning
        ? `${existingReasoning}${guardResult.spilledThought}`
        : guardResult.spilledThought
      : (firstChoice.delta.reasoning ?? undefined);

    return {
      ...chunk,
      choices: [
        {
          ...firstChoice,
          delta: {
            ...firstChoice.delta,
            content: guardResult.content,
            reasoning: mergedReasoning,
          },
        },
        ...(chunk.choices?.slice(1) ?? []),
      ],
    };
  }

  private flushReasoningContentSpillGuardToChunk(): OpenrouterStreamChunk | null {
    const guardResult = this.reasoningContentSpillGuard.flush();
    if (!guardResult.changed || !guardResult.content) {
      return null;
    }

    return {
      choices: [
        {
          index: 0,
          delta: {
            content: guardResult.content,
            reasoning: guardResult.spilledThought,
          },
        },
      ],
    };
  }

  private flushThinkStripperToChunk(): OpenrouterStreamChunk | null {
    const stripped = this.thinkBlockStripper.flush();
    if (!stripped.changed || (!stripped.visibleText && !stripped.thoughtText)) {
      return null;
    }

    return {
      choices: [
        {
          index: 0,
          delta: {
            content: stripped.visibleText,
            reasoning: stripped.thoughtText || undefined,
          },
        },
      ],
    };
  }

  private deduplicateChunkTextAgainstRecentStream(chunk: OpenrouterStreamChunk): OpenrouterStreamChunk {
    const firstChoice = chunk.choices?.[0];
    const content = firstChoice?.delta?.content;
    if (!firstChoice?.delta || typeof content !== "string" || content.length === 0) {
      return chunk;
    }

    const deduplicatedText = this.getTextDelta(content);
    if (deduplicatedText !== content) {
      log.info(`OpenRouter: Trimmed overlapping streamed text (${content.length} -> ${deduplicatedText.length})`);
    }

    if (deduplicatedText.length > 0) {
      this.appendToStreamedTextTail(deduplicatedText);
    }

    if (deduplicatedText === content) {
      return chunk;
    }

    const remainingChoices = chunk.choices?.slice(1) ?? [];
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
        ...remainingChoices,
      ],
    };
  }

  private getTextDelta(chunkText: string): string {
    if (
      !chunkText ||
      chunkText.length < OpenrouterStreamAdapter.STREAM_TEXT_MIN_DEDUP_CHARS ||
      !this.streamedTextTail
    ) {
      return chunkText;
    }

    const seenTail = this.streamedTextTail;
    if (seenTail.endsWith(chunkText)) {
      return "";
    }

    const maxOverlap = Math.min(seenTail.length, chunkText.length);
    for (let overlap = maxOverlap; overlap >= OpenrouterStreamAdapter.STREAM_TEXT_MIN_DEDUP_CHARS; overlap--) {
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
    if (this.streamedTextTail.length > OpenrouterStreamAdapter.STREAM_TEXT_TAIL_CHARS) {
      this.streamedTextTail = this.streamedTextTail.slice(-OpenrouterStreamAdapter.STREAM_TEXT_TAIL_CHARS);
    }
  }

  private applySpeakerBoundaryFallbackGuard(chunk: OpenrouterStreamChunk): {
    chunk: OpenrouterStreamChunk;
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

    const chunkText = String(content);
    const combined = `${this.speakerGuardPendingTail}${chunkText}`;
    const speakerGuardResult = truncateBeforeGenericSpeakerLine(combined, {
      isAllowedSpeakerLabel: (label) => isAllowedRenderModifierSpeakerLabel(label, this.speakerGuardAllowedSourceNames),
    });
    const transitionIndex = speakerGuardResult.stopTriggered ? speakerGuardResult.text.length : -1;

    if (transitionIndex === -1) {
      const holdback = OpenrouterStreamAdapter.SPEAKER_GUARD_HOLDBACK_CHARS;
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

    const safeText = combined.slice(0, transitionIndex);
    firstChoice.delta.content = safeText;
    this.speakerGuardPendingTail = "";
    return {
      chunk,
      stopTriggered: true,
      matchedSpeaker: speakerGuardResult.matchedSpeaker,
    };
  }

  private splitChunkWithTextAndToolSignals(chunk: OpenrouterStreamChunk): OpenrouterStreamChunk[] {
    const firstChoice = chunk.choices?.[0];
    if (!firstChoice?.delta) {
      return [chunk];
    }

    const content = firstChoice.delta.content;
    const hasTextContent = typeof content === "string" && content.length > 0;
    if (!hasTextContent) {
      return [chunk];
    }

    const toolCalls = firstChoice.delta.toolCalls ?? firstChoice.delta.tool_calls;
    const finishReason = firstChoice.finishReason ?? firstChoice.finish_reason;
    const hasToolSignal = Boolean(toolCalls && toolCalls.length > 0) || finishReason === "tool_calls";

    if (!hasToolSignal) {
      return [chunk];
    }

    const textOnlyChunk: OpenrouterStreamChunk = {
      ...chunk,
      usage: undefined,
      choices: [
        {
          ...firstChoice,
          delta: {
            role: firstChoice.delta.role,
            content,
            reasoning: firstChoice.delta.reasoning,
          },
          finishReason: null,
          finish_reason: null,
        },
      ],
    };

    const toolSignalChunk: OpenrouterStreamChunk = {
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
    };

    return [textOnlyChunk, toolSignalChunk];
  }

  private shouldFlushSpeakerGuardTailBeforeNonTextChunk(chunk: OpenrouterStreamChunk): boolean {
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

    const toolCalls = firstChoice?.delta?.toolCalls ?? firstChoice?.delta?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      return true;
    }

    const finishReason = firstChoice?.finishReason ?? firstChoice?.finish_reason;
    return Boolean(finishReason);
  }

  private normalizeOpenrouterChunk(raw: unknown): OpenrouterStreamChunk | null {
    if (!raw || typeof raw !== "object") return null;

    const rawObj = raw as Record<string, unknown>;

    if ("data" in rawObj) {
      const dataValue = rawObj.data;
      if (typeof dataValue === "string") {
        try {
          return this.normalizeOpenrouterChunk(JSON.parse(dataValue));
        } catch {
          return null;
        }
      }
      if (typeof dataValue === "object" && dataValue !== null) {
        return this.normalizeOpenrouterChunk(dataValue);
      }
    }

    const rawUsage =
      rawObj.usage && typeof rawObj.usage === "object" ? (rawObj.usage as Record<string, unknown>) : undefined;

    const normalizedUsage = rawUsage
      ? {
          promptTokens:
            typeof rawUsage.promptTokens === "number"
              ? rawUsage.promptTokens
              : typeof rawUsage.prompt_tokens === "number"
                ? rawUsage.prompt_tokens
                : undefined,
          completionTokens:
            typeof rawUsage.completionTokens === "number"
              ? rawUsage.completionTokens
              : typeof rawUsage.completion_tokens === "number"
                ? rawUsage.completion_tokens
                : undefined,
          totalTokens:
            typeof rawUsage.totalTokens === "number"
              ? rawUsage.totalTokens
              : typeof rawUsage.total_tokens === "number"
                ? rawUsage.total_tokens
                : undefined,
          completionTokensDetails: rawUsage.completionTokensDetails ?? rawUsage.completion_tokens_details,
          promptTokensDetails: rawUsage.promptTokensDetails ?? rawUsage.prompt_tokens_details,
          cost:
            typeof rawUsage.cost === "number" && Number.isFinite(rawUsage.cost) && rawUsage.cost >= 0
              ? rawUsage.cost
              : undefined,
        }
      : undefined;

    const hasUsage = normalizedUsage && Object.values(normalizedUsage).some((value) => value !== undefined);

    if (rawObj.error && typeof rawObj.error === "object") {
      const errorObj = rawObj.error as Record<string, unknown>;

      if (this.isProviderError(rawObj.error)) {
        return { error: rawObj.error, usage: normalizedUsage };
      }

      const metadata =
        errorObj.metadata && typeof errorObj.metadata === "object"
          ? (errorObj.metadata as Record<string, unknown>)
          : null;
      const message =
        (typeof metadata?.raw === "string" && metadata.raw) ||
        (typeof errorObj.message === "string" && errorObj.message) ||
        "OpenRouter API error";
      const codeValue = errorObj.code;
      return {
        usage: normalizedUsage,
        error: {
          code: typeof codeValue === "string" || typeof codeValue === "number" ? codeValue : "unknown",
          message,
        },
      };
    }

    if (typeof rawObj.message === "string" && ("code" in rawObj || "type" in rawObj)) {
      const codeValue = rawObj.code as string | number | undefined;
      return {
        usage: normalizedUsage,
        error: {
          code: typeof codeValue === "string" || typeof codeValue === "number" ? codeValue : "unknown",
          message: rawObj.message,
        },
      };
    }

    const rawChoices = Array.isArray(rawObj.choices) ? rawObj.choices : undefined;
    const normalizedChoices = rawChoices?.map((choice, index) => {
      const choiceObj = choice as Record<string, unknown>;
      const deltaObj =
        choiceObj.delta && typeof choiceObj.delta === "object"
          ? (choiceObj.delta as Record<string, unknown>)
          : undefined;

      const rawToolCalls = deltaObj?.toolCalls ?? (deltaObj?.tool_calls as unknown);

      const normalizedToolCalls = Array.isArray(rawToolCalls)
        ? rawToolCalls.map((toolCall) => {
            const toolObj = toolCall as Record<string, unknown>;
            const functionObj =
              toolObj.function && typeof toolObj.function === "object"
                ? (toolObj.function as Record<string, unknown>)
                : undefined;

            return {
              index: typeof toolObj.index === "number" ? toolObj.index : undefined,
              id: typeof toolObj.id === "string" ? toolObj.id : undefined,
              type: typeof toolObj.type === "string" ? toolObj.type : undefined,
              thought_signature: typeof toolObj.thought_signature === "string" ? toolObj.thought_signature : undefined,
              function: functionObj
                ? {
                    name: typeof functionObj.name === "string" ? functionObj.name : undefined,
                    arguments: typeof functionObj.arguments === "string" ? functionObj.arguments : undefined,
                  }
                : undefined,
            };
          })
        : undefined;

      const reasoningDetails = Array.isArray(deltaObj?.reasoning_details)
        ? deltaObj?.reasoning_details
        : Array.isArray(deltaObj?.reasoningDetails)
          ? deltaObj?.reasoningDetails
          : undefined;

      const finishReason =
        (typeof choiceObj.finishReason === "string" || choiceObj.finishReason === null
          ? choiceObj.finishReason
          : undefined) ??
        (typeof choiceObj.finish_reason === "string" || choiceObj.finish_reason === null
          ? choiceObj.finish_reason
          : undefined);

      return {
        index: typeof choiceObj.index === "number" ? choiceObj.index : index,
        delta: deltaObj
          ? {
              role: typeof deltaObj.role === "string" ? deltaObj.role : undefined,
              content:
                typeof deltaObj.content === "string" || deltaObj.content === null
                  ? (deltaObj.content as string | null)
                  : undefined,
              reasoning:
                typeof deltaObj.reasoning === "string" || deltaObj.reasoning === null
                  ? (deltaObj.reasoning as string | null)
                  : undefined,
              toolCalls: normalizedToolCalls,
              reasoning_details: reasoningDetails,
            }
          : undefined,
        finishReason,
        logprobs: (choiceObj.logprobs ?? null) as unknown,
      };
    });

    if (!normalizedChoices && !hasUsage) return null;

    const normalizedChunk: OpenrouterStreamChunk = {};

    if (typeof rawObj.id === "string") normalizedChunk.id = rawObj.id;
    if (typeof rawObj.object === "string") normalizedChunk.object = rawObj.object;
    if (typeof rawObj.created === "number") normalizedChunk.created = rawObj.created;
    if (typeof rawObj.model === "string") normalizedChunk.model = rawObj.model;
    if (typeof rawObj.provider === "string") normalizedChunk.provider = rawObj.provider;
    if (normalizedChoices) normalizedChunk.choices = normalizedChoices;
    if (hasUsage && normalizedUsage) normalizedChunk.usage = normalizedUsage;

    return normalizedChunk;
  }

  processChunk(chunk: RawStreamChunk): ProcessedChunk {
    const openrouterChunk = chunk.data as OpenrouterStreamChunk;

    // Persist the first serving backend on OpenRouter's top-level provider field so thought logs attribute leaks.
    if (typeof openrouterChunk.provider === "string" && openrouterChunk.provider.trim().length > 0) {
      this.servingProvider ??= openrouterChunk.provider.trim();
    }

    if ("error" in openrouterChunk && openrouterChunk.error) {
      const providerErrorCandidate = openrouterChunk.error as ProviderError;
      if (typeof providerErrorCandidate.type === "string" && typeof providerErrorCandidate.retryable === "boolean") {
        return {
          type: "error",
          error: providerErrorCandidate,
        };
      }

      const errorCode = (openrouterChunk.error as { code?: string | number }).code;
      const errorMessage = (openrouterChunk.error as { message?: string }).message || "OpenRouter API error";
      const normalizedCode =
        typeof errorCode === "string" || typeof errorCode === "number" ? String(errorCode) : "unknown";

      const isMalformedToolCallError =
        errorCode === "invalid_type" &&
        (errorMessage.includes("expected string, received null") ||
          errorMessage.includes("expected string") ||
          errorMessage.includes("invalid_type"));

      const hasPartialToolCall = this.toolCallAccumulator.size > 0;

      if (isMalformedToolCallError && hasPartialToolCall) {
        const accumulatedData = this.toolCallAccumulator.get(0);
        log.warn(
          `OpenRouter: Malformed tool call detected from model. ` +
            `Accumulated name: "${accumulatedData?.functionName || "none"}", ` +
            `args: "${accumulatedData?.functionArguments?.substring(0, 100) || "none"}". ` +
            `Error: ${errorMessage}`,
        );

        this.toolCallAccumulator.clear();
        this.reasoningDetailsAccumulator = [];

        // Return done instead of error on malformed tool calls (seen on models like GLM 4.7) to keep preceding text.
        return {
          type: "done",
          metadata: {
            malformedToolCall: true,
            originalError: errorMessage,
          },
        };
      }

      // Use the shared code→type mapper so SSE-injected errors get the same
      // type/retryable treatment as HTTP-level errors (e.g. 503 → provider_overloaded).
      const { type: errorType, retryable } = this.mapErrorCodeToType(normalizedCode, errorMessage);

      return {
        type: "error",
        error: {
          type: errorType,
          message: errorMessage,
          code: normalizedCode,
          retryable,
          originalError: openrouterChunk.error,
        } as ProviderError,
      };
    }

    const metadata: Record<string, unknown> = {};
    if (openrouterChunk.usage) {
      const usage = openrouterChunk.usage;
      const normalizedUsage = {
        promptTokens: usage.promptTokens ?? usage.prompt_tokens,
        completionTokens: usage.completionTokens ?? usage.completion_tokens,
        totalTokens: usage.totalTokens ?? usage.total_tokens,
        completionTokensDetails: usage.completionTokensDetails ?? usage.completion_tokens_details,
        promptTokensDetails: usage.promptTokensDetails ?? usage.prompt_tokens_details,
        cost: usage.cost,
      };

      metadata.usage = normalizedUsage;
      log.info(`OpenRouter usage: ${normalizedUsage.totalTokens ?? "unknown"} total tokens`);
    }

    const choice = openrouterChunk.choices?.[0];
    if (!choice) {
      return {
        type: "text",
        content: "",
        metadata: openrouterChunk.usage ? metadata : undefined,
      };
    }

    const finishReason = choice.finishReason ?? choice.finish_reason ?? null;
    const deltaToolCalls = choice.delta?.toolCalls ?? choice.delta?.tool_calls;
    const thoughts: ThoughtLogEntry[] = [];

    if (typeof choice.delta?.reasoning === "string" && choice.delta.reasoning.length > 0) {
      thoughts.push({
        kind: "raw",
        content: choice.delta.reasoning,
      });
    }

    if (deltaToolCalls || finishReason === "tool_calls") {
      log.info("OpenRouter: Chunk contains tool calls");
    }

    if (finishReason !== null && finishReason !== undefined)
      log.info(
        `Choice - finishReason: ${finishReason}, has delta: ${!!choice.delta}, delta.content: ${!!choice.delta?.content}, delta.toolCalls: ${!!deltaToolCalls}`,
      );

    if (finishReason === "error") {
      return {
        type: "error",
        error: {
          type: "api_error",
          message: "Stream terminated due to error",
          retryable: false,
          originalError: openrouterChunk,
        } as ProviderError,
      };
    }

    // Check finishReason before delta processing because OpenRouter often bundles both in the terminal chunk.
    if (finishReason === "tool_calls") {
      // Accumulate any trailing deltaToolCalls on this final chunk before finalizing the tool call.
      if (deltaToolCalls && deltaToolCalls.length > 0) {
        for (const deltaToolCall of deltaToolCalls) {
          const index = deltaToolCall.index ?? 0;

          let accumulated = this.toolCallAccumulator.get(index);
          if (!accumulated) {
            accumulated = {
              functionName: "",
              functionArguments: "",
            };
            this.toolCallAccumulator.set(index, accumulated);
          }

          log.info(`OpenRouter: Tool delta at index ${index}`);

          if (deltaToolCall.id) {
            accumulated.id = deltaToolCall.id;
            log.info(`OpenRouter: Captured tool call id: ${deltaToolCall.id}`);
          }
          if (deltaToolCall.type) {
            accumulated.type = deltaToolCall.type;
            log.info(`OpenRouter: Captured tool call type: ${deltaToolCall.type}`);
          }
          if (deltaToolCall.thought_signature) {
            accumulated.thought_signature = deltaToolCall.thought_signature;
            log.info(`OpenRouter: ✓ CAPTURED thought_signature from deltaToolCall: ${deltaToolCall.thought_signature}`);
          } else {
            log.info(`OpenRouter: ✗ No thought_signature in deltaToolCall [${index}]`);
          }

          if (deltaToolCall.function) {
            if (deltaToolCall.function.name) {
              accumulated.functionName += deltaToolCall.function.name;
            }
            if (deltaToolCall.function.arguments) {
              accumulated.functionArguments += deltaToolCall.function.arguments;
            }
          }

          log.info(
            `OpenRouter: Accumulated tool call [${index}] - name: "${accumulated.functionName}", args so far: "${accumulated.functionArguments.substring(0, 100)}${accumulated.functionArguments.length > 100 ? "..." : ""}"`,
          );
        }
      }

      // Capture final-chunk reasoning_details because Gemini models require them on tool-call replay.
      const finalReasoningDetails = choice.delta?.reasoning_details ?? choice.delta?.reasoningDetails;
      if (finalReasoningDetails && finalReasoningDetails.length > 0) {
        this.reasoningDetailsAccumulator.push(...finalReasoningDetails);
        log.info(
          `OpenRouter: Accumulated ${finalReasoningDetails.length} reasoning_details (total: ${this.reasoningDetailsAccumulator.length})`,
        );
      }

      log.info("OpenRouter: finish_reason is 'tool_calls' - parsing accumulated tool calls");

      const accumulated = this.toolCallAccumulator.get(0);

      if (!accumulated?.functionName) {
        log.warn("OpenRouter: finish_reason is 'tool_calls' but no tool call was accumulated!");
        return {
          type: "done",
          thoughts: thoughts.length > 0 ? thoughts : undefined,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        };
      }

      log.info(
        `OpenRouter: Accumulated state - id: ${accumulated.id}, type: ${accumulated.type}, thought_signature: ${accumulated.thought_signature || "NONE"}, name: ${accumulated.functionName}`,
      );

      const {
        args: parsedArgs,
        parsed: argumentsParsed,
        truncated: argumentsTruncated,
      } = parseAccumulatedToolArguments({
        adapterName: "OpenRouterStreamAdapter",
        toolName: accumulated.functionName,
        rawArguments: accumulated.functionArguments,
      });
      if (argumentsParsed) {
        log.info("OpenRouter: Parsed tool call arguments");
      }

      const functionCall: FunctionCall = {
        id: typeof accumulated.id === "string" ? accumulated.id : undefined,
        name: accumulated.functionName,
        args: parsedArgs,
      };
      if (argumentsTruncated) {
        functionCall.argumentsTruncated = true;
      }

      if (accumulated.thought_signature) {
        functionCall.thoughtSignature = accumulated.thought_signature;
        log.info(`OpenRouter: ✓ INCLUDED thought_signature in FunctionCall object: ${accumulated.thought_signature}`);
      } else {
        log.warn(`OpenRouter: ✗ MISSING thought_signature - functionCall will not have thoughtSignature field!`);
      }

      if (this.reasoningDetailsAccumulator.length > 0) {
        functionCall.reasoning_details = this.reasoningDetailsAccumulator;
        log.info(
          `OpenRouter: Including ${this.reasoningDetailsAccumulator.length} reasoning_details with function call`,
        );
      }

      log.info(`OpenRouter: Returning function_call - name: "${functionCall.name}"`);

      this.toolCallAccumulator.clear();
      this.reasoningDetailsAccumulator = [];

      return {
        type: "function_call",
        functionCall,
        thoughts: thoughts.length > 0 ? thoughts : undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };
    }

    if (finishReason === "stop") {
      // Emit delta.content before done on finishReason "stop" because Google models bundle final text with the stop
      // signal.
      if (choice.delta?.content) {
        return {
          type: "text",
          content: choice.delta.content,
          thoughts: thoughts.length > 0 ? thoughts : undefined,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        };
      }
      return {
        type: "done",
        thoughts: thoughts.length > 0 ? thoughts : undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };
    }

    if (finishReason === "length") {
      log.warn(
        `OpenRouter: finish_reason is 'length' (max output tokens reached). ` +
          `delta.content present: ${!!choice.delta?.content}`,
      );

      const lengthMetadata: Record<string, unknown> = {
        ...metadata,
        finishReason: "length",
        outputTruncated: true,
      };

      if (choice.delta?.content) {
        return {
          type: "text",
          content: choice.delta.content,
          thoughts: thoughts.length > 0 ? thoughts : undefined,
          metadata: lengthMetadata,
        };
      }

      return {
        type: "done",
        thoughts: thoughts.length > 0 ? thoughts : undefined,
        metadata: {
          ...lengthMetadata,
          emptyTerminalChunk: true,
        },
      };
    }

    if (deltaToolCalls && deltaToolCalls.length > 0) {
      for (const deltaToolCall of deltaToolCalls) {
        const index = deltaToolCall.index ?? 0;

        let accumulated = this.toolCallAccumulator.get(index);
        if (!accumulated) {
          accumulated = {
            functionName: "",
            functionArguments: "",
          };
          this.toolCallAccumulator.set(index, accumulated);
        }

        log.info(`OpenRouter: Intermediate tool delta at index ${index}`);

        if (deltaToolCall.id) {
          accumulated.id = deltaToolCall.id;
          log.info(`OpenRouter: [INTERMEDIATE] Captured id: ${deltaToolCall.id}`);
        }
        if (deltaToolCall.type) {
          accumulated.type = deltaToolCall.type;
          log.info(`OpenRouter: [INTERMEDIATE] Captured type: ${deltaToolCall.type}`);
        }
        if (deltaToolCall.thought_signature) {
          accumulated.thought_signature = deltaToolCall.thought_signature;
          log.info(`OpenRouter: [INTERMEDIATE] ✓ CAPTURED thought_signature: ${deltaToolCall.thought_signature}`);
        } else {
          log.info(`OpenRouter: [INTERMEDIATE] ✗ No thought_signature in this chunk`);
        }

        if (deltaToolCall.function) {
          if (deltaToolCall.function.name) {
            accumulated.functionName += deltaToolCall.function.name;
          }
          if (deltaToolCall.function.arguments) {
            accumulated.functionArguments += deltaToolCall.function.arguments;
          }
        }

        log.info(
          `OpenRouter: Accumulated tool call [${index}] - name: "${accumulated.functionName}", args so far: "${accumulated.functionArguments.substring(0, 100)}${accumulated.functionArguments.length > 100 ? "..." : ""}"`,
        );
      }

      return {
        type: "text",
        content: "",
        thoughts: thoughts.length > 0 ? thoughts : undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };
    }

    // Accumulate reasoning_details across intermediate chunks because Gemini sends them before tool_calls.
    const reasoningDetails = choice.delta?.reasoning_details ?? choice.delta?.reasoningDetails;
    if (reasoningDetails && reasoningDetails.length > 0) {
      this.reasoningDetailsAccumulator.push(...reasoningDetails);
      return {
        type: "text",
        content: "",
        thoughts: thoughts.length > 0 ? thoughts : undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };
    }

    if (choice.delta?.content) {
      return {
        type: "text",
        content: choice.delta.content,
        thoughts: thoughts.length > 0 ? thoughts : undefined,
        servingProvider: this.servingProvider,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };
    }

    return {
      type: "text",
      content: "",
      thoughts: thoughts.length > 0 ? thoughts : undefined,
      servingProvider: this.servingProvider,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  private isProviderError(value: unknown): value is ProviderError {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.type === "string" &&
      typeof candidate.message === "string" &&
      typeof candidate.retryable === "boolean"
    );
  }

  private mapErrorCodeToType(
    finalCode: string,
    finalMessage: string,
  ): { type: ProviderError["type"]; retryable: boolean } {
    if (finalCode.includes("400") || finalMessage.includes("400")) {
      return { type: "api_error", retryable: false };
    } else if (finalCode.includes("401") || finalMessage.includes("401")) {
      return { type: "api_error", retryable: false };
    } else if (finalCode.includes("402") || finalMessage.includes("402")) {
      // Classify 402 credits errors as non-retryable api_error so users see billing copy instead of rate-limit retry
      // advice.
      return { type: "api_error", retryable: false };
    } else if (finalCode.includes("413") || finalMessage.includes("413")) {
      return { type: "api_error", retryable: false };
    } else if (finalCode.includes("404") || finalMessage.includes("404")) {
      return { type: "api_error", retryable: false };
    } else if (finalCode.includes("408") || finalMessage.includes("408")) {
      return { type: "timeout", retryable: true };
    } else if (finalCode.includes("429") || finalMessage.includes("429")) {
      return { type: "rate_limit", retryable: true };
    } else if (
      finalCode.includes("502") ||
      finalCode.includes("503") ||
      finalMessage.includes("502") ||
      finalMessage.includes("503")
    ) {
      return { type: "provider_overloaded", retryable: true };
    } else if (isProviderTimeoutMessage(finalMessage)) {
      return { type: "timeout", retryable: true };
    } else if (finalMessage.toLowerCase().includes("content")) {
      return { type: "content_blocked", retryable: false };
    }
    return { type: "unknown", retryable: false };
  }

  handleProviderError(error: unknown): ProviderError {
    const errorMessage = error instanceof Error ? error.message : String(error);

    let errorCode: string | undefined;
    let extractedMessage: string | undefined;

    if (error && typeof error === "object") {
      const errorObj = error as Record<string, unknown>;

      if (errorObj.statusCode) {
        errorCode = String(errorObj.statusCode);
      }

      if (!errorCode && errorObj.error && typeof errorObj.error === "object") {
        const errorField = errorObj.error as Record<string, unknown>;
        if (errorField.code) {
          errorCode = String(errorField.code);
        }
      }

      if (!errorCode && errorObj.data$ && typeof errorObj.data$ === "object") {
        const data = errorObj.data$ as Record<string, unknown>;
        if (data.error && typeof data.error === "object") {
          const dataError = data.error as Record<string, unknown>;
          if (dataError.code) {
            errorCode = String(dataError.code);
          }
          if (dataError.message && typeof dataError.message === "string") {
            extractedMessage = dataError.message;
          }
        }
      }

      if (errorObj.body && typeof errorObj.body === "string") {
        try {
          const bodyParsed = JSON.parse(errorObj.body) as {
            error?: {
              code?: string | number;
              message?: string;
              metadata?: { raw?: string };
            };
            message?: string;
          };
          if (!errorCode && bodyParsed.error?.code !== undefined) {
            errorCode = String(bodyParsed.error.code);
          }
          if (!extractedMessage && bodyParsed.error?.metadata?.raw) {
            extractedMessage = bodyParsed.error.metadata.raw;
          }
          if (!extractedMessage && bodyParsed.error?.message) {
            extractedMessage = bodyParsed.error.message;
          }
          if (!extractedMessage && bodyParsed.message) {
            extractedMessage = bodyParsed.message;
          }
        } catch {}
      }
    }

    if (!errorCode) {
      const httpMatch = errorMessage.match(/HTTP\s+(\d{3})/i);
      if (httpMatch) {
        errorCode = httpMatch[1];
      }
    }

    if (!errorCode || !extractedMessage) {
      try {
        if (errorMessage.includes("{")) {
          const jsonMatch = errorMessage.match(/\{.*\}/s);
          if (jsonMatch) {
            const parsedError = JSON.parse(jsonMatch[0]);
            if (!errorCode) {
              errorCode = parsedError.error?.code || parsedError.code;
            }
            if (!extractedMessage) {
              extractedMessage = parsedError.error?.message || parsedError.message;
            }
          }
        }
      } catch {}
    }

    const finalMessage = String(extractedMessage || errorMessage || "Unknown error");
    const finalCode = errorCode || "unknown";

    if (
      finalMessage.includes("data policy") ||
      finalMessage.includes("Paid model training") ||
      finalMessage.includes("openrouter.ai/settings/privacy")
    ) {
      return {
        type: "api_error",
        message: `OpenRouter Privacy Policy Error: The selected model requires allowing data for paid model training, but your account privacy settings block this.\n\nOriginal error: ${finalMessage}`,
        code: finalCode,
        retryable: false,
        originalError: error,
        userMessage: extractedMessage,
      };
    }

    const { type: errorType, retryable } = this.mapErrorCodeToType(finalCode, finalMessage);

    return {
      type: errorType,
      message: `OpenRouter API error (${finalCode}): ${finalMessage}`,
      code: finalCode,
      retryable,
      originalError: error,
      userMessage: extractedMessage,
    };
  }

  createErrorDescription(error: ProviderError, locale: string): string | null {
    if (
      error.message?.includes("Privacy Policy Error") ||
      error.message?.includes("data policy") ||
      error.message?.includes("Paid model training")
    ) {
      return localizer(locale, "genai.openrouter.404_privacy_policy_error");
    }

    if (
      error.message?.includes("free-models-per-day") ||
      error.message?.includes("unlock 1000 free model requests per day")
    ) {
      return localizer(locale, "genai.openrouter.429_free_models_message");
    }

    // Upstream text (`userMessage`, `message`) stays in the operator log; see StreamErrorUi.
    const errorCode = formatProviderErrorCodeForDisplay(error.code);
    let messageKey: string;
    switch (error.type) {
      case "content_blocked":
        messageKey = "403_default_message";
        break;
      case "rate_limit":
        messageKey = "429_default_message";
        break;
      case "timeout":
        messageKey = "408_default_message";
        break;
      case "provider_overloaded":
        messageKey = errorCode === "502" ? "502_default_message" : "503_default_message";
        break;
      case "api_error":
        messageKey = `${errorCode}_default_message`;
        break;
      default:
        messageKey = "unknown_default_message";
        break;
    }

    const localeKey = `genai.openrouter.${messageKey}`;
    const localized = localizer(locale, localeKey);
    const openrouterMessage =
      localized === localeKey ? localizer(locale, "genai.openrouter.unknown_default_message") : localized;
    return `Error Code ${errorCode}: ${openrouterMessage}`;
  }

  private async assembleOpenrouterContext(
    contextItems: StructuredContextItem[],
    currentTurnModelParts: Array<Record<string, unknown>>,
    functionInteractionHistory?: Array<{
      functionCall: FunctionCall;
      functionResponse: Record<string, unknown>;
      imageMetadata?: FunctionResponseImageMetadata;
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>,
    seesImages: boolean = true,
    // Keep unused _botName positional parameter so existing callers do not need argument reordering.
    _botName: string = "Assistant",
    seesVideos: boolean = false,
    messageIdMap?: StreamContext["messageIdMap"],
    model?: string,
    videoDiagnostics?: StreamContext["videoRequestDiagnostics"],
    seesYoutube = false,
  ): Promise<Array<Record<string, unknown>>> {
    const messages: Array<Record<string, unknown>> = [];
    const { items: relocatedContextItems, boundaryIndex } = relocateCacheContextItems(contextItems);
    const systemInstructionParts: string[] = [];
    let boundaryMessage: Record<string, unknown> | undefined;
    let latestVideoItemIndex = -1;
    let latestVideoPartIndex = -1;

    // Some OpenRouter routes allow only one video per request, so keep the latest until per-model limits are available.
    for (const [itemIndex, item] of relocatedContextItems.entries()) {
      if (isSystemInstructionContextItem(item) || item.role === "system") continue;
      const partIndex = item.parts.findLastIndex(
        (part) =>
          seesVideos &&
          part.type === "video" &&
          (!part.isYouTubeLink || seesYoutube) &&
          /^(?:https?:\/\/|data:)/.test(part.uri),
      );
      if (partIndex >= 0) {
        latestVideoItemIndex = itemIndex;
        latestVideoPartIndex = partIndex;
      }
    }

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
        if (itemTextContent) systemInstructionParts.push(itemTextContent);
      } else if (item.role === "user" || item.role === "model") {
        const role = item.role === "user" ? "user" : "assistant";
        const partsByInput = await mapWithConcurrency(item.parts, 4, async (part, partIndex) => {
          const pendingBotImageParts: Array<Record<string, unknown>> = [];
          const contentParts: Array<Record<string, unknown>> = [];
          if (part.type === "text") {
            contentParts.push({
              type: "text",
              text: part.text,
            });
          } else if (part.type === "image") {
            const imageTargetParts = role === "assistant" ? pendingBotImageParts : contentParts;

            if (!seesImages) {
              log.info(`Skipping image (model doesn't support images)`);
              contentParts.push({
                type: "text",
                text: "[System: An image is attached to this message that this model cannot process.]",
              });
              return { pendingBotImageParts, contentParts };
            }

            if ("inlineData" in part && part.inlineData) {
              try {
                const inlineData = part.inlineData as {
                  mimeType: string;
                  data: string;
                };

                if (typeof inlineData === "object" && inlineData.mimeType && inlineData.data) {
                  if (inlineData.mimeType === "image/gif") {
                    if (process.env.RUN_ENV === "production") {
                      contentParts.push({ type: "text", text: buildInlineGifPlaceholder() });

                      log.info(
                        "OpenrouterStreamAdapter: Inline GIF detected in production mode, replaced with placeholder",
                      );
                    } else {
                      contentParts.push({
                        type: "text",
                        text: buildGifToolHint({
                          messageId: item.messageId,
                          messageIdMap,
                          subject: "inline GIF data",
                        }),
                      });

                      log.info(
                        `OpenrouterStreamAdapter: Inline GIF detected in dev mode, added process_gif hint for message: ${item.messageId}`,
                      );
                    }
                  } else {
                    imageTargetParts.push({
                      type: "image_url",
                      image_url: {
                        url: `data:${inlineData.mimeType};base64,${inlineData.data}`,
                      },
                    });

                    log.info("OpenrouterStreamAdapter: Processed image with existing inlineData");
                  }
                } else {
                  log.warn("OpenrouterStreamAdapter: Invalid inlineData structure for image part");
                }
              } catch (inlineErr) {
                log.warn("OpenrouterStreamAdapter: Error processing inlineData", {
                  error: inlineErr instanceof Error ? inlineErr.message : String(inlineErr),
                });
              }
              return { pendingBotImageParts, contentParts };
            }

            if (part.uri && part.mimeType) {
              try {
                let base64ImageData: string;
                let finalMimeType = part.mimeType;

                if (part.uri.startsWith("data:")) {
                  const dataUriMatch = part.uri.match(/^data:([^;]+);base64,(.+)$/);
                  if (dataUriMatch) {
                    finalMimeType = dataUriMatch[1];
                    base64ImageData = dataUriMatch[2];

                    log.info(`OpenrouterStreamAdapter: Parsed data URI (${finalMimeType})`);
                  } else {
                    log.warn(`OpenrouterStreamAdapter: Invalid data URI format: ${part.uri.substring(0, 50)}...`);
                    return { pendingBotImageParts, contentParts };
                  }
                } else {
                  if (part.mimeType === "image/gif") {
                    if (process.env.RUN_ENV === "production") {
                      contentParts.push({ type: "text", text: buildGifUrlPlaceholder(part.uri) });

                      log.info(`OpenrouterStreamAdapter: GIF detected in production mode, replaced with placeholder`);
                    } else {
                      contentParts.push({
                        type: "text",
                        text: buildGifToolHint({
                          messageId: item.messageId,
                          messageIdMap,
                          subject: "a GIF",
                        }),
                      });

                      log.info(
                        `OpenrouterStreamAdapter: GIF detected in dev mode, added process_gif hint for message: ${item.messageId}`,
                      );
                    }
                    return { pendingBotImageParts, contentParts };
                  }

                  const optimized = await fetchAndOptimizeImage(part.uri, part.mimeType);
                  base64ImageData = optimized.data;
                  finalMimeType = optimized.mimeType;

                  log.success(`Successfully fetched image`);
                }

                imageTargetParts.push({
                  type: "image_url",
                  image_url: {
                    url: `data:${finalMimeType};base64,${base64ImageData}`,
                  },
                });

                log.success(`Successfully added image to message`);
              } catch (imgErr) {
                const fallback = (part as { fallbackUri?: string }).fallbackUri;
                if (fallback && fallback !== part.uri) {
                  try {
                    const optimized = await fetchAndOptimizeImage(fallback, part.mimeType);
                    imageTargetParts.push({
                      type: "image_url",
                      image_url: { url: `data:${optimized.mimeType};base64,${optimized.data}` },
                    });
                    log.info(`OpenrouterStreamAdapter: Image loaded via fallback CDN`);
                  } catch (fallbackErr) {
                    log.warn(`OpenrouterStreamAdapter: Image processing error (proxy + CDN both failed)`, {
                      error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
                    });
                  }
                } else {
                  log.warn(`Error processing image`, {
                    error: imgErr instanceof Error ? imgErr.message : String(imgErr),
                  });
                }
              }
            }
          } else if (part.type === "video") {
            const videoTargetParts = role === "assistant" ? pendingBotImageParts : contentParts;

            if (!seesVideos || (part.isYouTubeLink && !seesYoutube)) {
              log.info(`Skipping video (model doesn't support videos): ${part.uri}`);
              videoTargetParts.push({
                type: "text",
                text: "[System: A video is attached to this message that this model cannot process.]",
              });
              return { pendingBotImageParts, contentParts };
            }

            try {
              const isHttpUrl = part.uri.startsWith("http://") || part.uri.startsWith("https://");
              const isDataUrl = part.uri.startsWith("data:");
              if (!isHttpUrl && !isDataUrl) {
                log.warn(`Skipping unsupported video URI format for OpenRouter: ${part.uri}`);
                return { pendingBotImageParts, contentParts };
              }

              if (itemIndex !== latestVideoItemIndex || partIndex !== latestVideoPartIndex) {
                if (videoDiagnostics) videoDiagnostics.omittedVideos++;
                videoTargetParts.push({
                  type: "text",
                  text: "[System: This video was omitted because only the latest video is included in this request. Do not guess its contents.]",
                });
                return { pendingBotImageParts, contentParts };
              }

              // Pass direct video URLs unchanged because OpenRouter accepts both public URLs and data URLs.
              videoTargetParts.push({
                type: "video_url",
                video_url: { url: part.uri },
              });
              videoDiagnostics?.videos.push(this.describeVideoInput(part));

              if (part.isYouTubeLink) {
                log.success(`Added YouTube video to message: ${part.uri}`);
              } else if (isHttpUrl) {
                log.success(`Added direct video URL to message: ${part.uri}`);
              } else {
                log.success(`Added video data URL to message`);
              }
            } catch (videoErr) {
              log.warn(`Error processing video: ${part.uri}`, {
                error: videoErr instanceof Error ? videoErr.message : String(videoErr),
              });
            }
          }
          return { pendingBotImageParts, contentParts };
        });
        const pendingBotImageParts = partsByInput.flatMap((parts) => parts.pendingBotImageParts);
        const contentParts = partsByInput.flatMap((parts) => parts.contentParts);

        if (contentParts.length > 0 || pendingBotImageParts.length > 0) {
          // Extract plain text for assistant turns because OpenRouter rejects media arrays on assistant messages.
          if (role === "assistant") {
            const assistantText = contentParts
              .filter((part) => part.type === "text")
              .map((part) => (part as { type: "text"; text: string }).text)
              .join("\n");

            if (!assistantText && pendingBotImageParts.length === 0) {
              continue;
            }

            if (assistantText) {
              messages.push({
                role,
                content: assistantText,
              });
            }

            // Emit staged assistant media in a synthetic user turn because OpenRouter only allows media on user turns.
            if (pendingBotImageParts.length > 0) {
              messages.push({
                role: "user",
                content: [
                  {
                    type: "text",
                    text: assistantMediaRelocationNotice(pendingBotImageParts.length, item.sender?.name),
                  },
                  ...pendingBotImageParts,
                ],
              });
            }

            continue;
          }

          // Flatten text-only user content to a plain string because strict models such as aion-2.0 reject array
          // parts with 400.
          const allTextOnly = contentParts.every((p) => p.type === "text");
          const content = allTextOnly
            ? contentParts.map((p) => (p as { type: "text"; text: string }).text).join("\n")
            : contentParts;

          messages.push({
            role,
            content,
          });
        }
      }
    }

    if (boundaryIndex === relocatedContextItems.length - 1) boundaryMessage = messages.at(-1);
    let systemMessage: { role: string; content: unknown } | undefined;
    if (systemInstructionParts.length > 0) {
      const systemContent = systemInstructionParts.join("\n\n");
      systemMessage = { role: "system", content: systemContent };
      messages.unshift(systemMessage);
      log.info(`Assembled system message. Length: ${systemContent.length} characters`);
    }

    if (model && isOpenRouterAnthropicModel(model)) {
      applyAnthropicCacheBreakpoints(
        model,
        systemMessage,
        messages.filter((message) => message !== systemMessage) as Array<{ role: string; content: unknown }>,
        boundaryMessage as { role: string; content: unknown } | undefined,
      );
    }

    if (functionInteractionHistory && functionInteractionHistory.length > 0) {
      const usedToolCallIds = new Set<string>();
      for (const [index, interaction] of functionInteractionHistory.entries()) {
        const toolCallId = resolveToolCallId(interaction.functionCall.id, index, "call", usedToolCallIds);

        // Preserve thought_signature and reasoning_details on tool calls because Gemini models reject replay without
        // them.
        const toolCallObject: Record<string, unknown> = {
          id: toolCallId,
          type: "function",
          function: {
            name: interaction.functionCall.name,
            arguments: JSON.stringify(interaction.functionCall.args || {}),
          },
        };

        const hasThoughtSignature = Boolean(interaction.functionCall.thoughtSignature);
        if (interaction.functionCall.thoughtSignature) {
          toolCallObject.thought_signature = interaction.functionCall.thoughtSignature;
          log.info(
            `OpenRouter: ✓ PRESERVING thought_signature in assistant message for tool '${interaction.functionCall.name}': ${interaction.functionCall.thoughtSignature}`,
          );
        } else {
          log.warn(
            `OpenRouter: ✗ NO thought_signature to preserve for tool '${interaction.functionCall.name}' - this will cause Gemini error!`,
          );
        }

        // Preserve pre-tool-call text on the assistant tool message so the model does not repeat itself.
        let preToolCallContent: string | null = null;
        if (interaction.preToolCallTextParts && interaction.preToolCallTextParts.length > 0) {
          preToolCallContent = interaction.preToolCallTextParts
            .map((part) => (part as { text?: string }).text)
            .filter((text): text is string => typeof text === "string" && text.length > 0)
            .join("");
          if (preToolCallContent.length > 0) {
            log.info(
              `OpenRouter: Including ${preToolCallContent.length} chars of pre-tool-call text in assistant message`,
            );
          } else {
            preToolCallContent = null;
          }
        }

        const assistantMessage: Record<string, unknown> = {
          role: "assistant",
          content: preToolCallContent,
          tool_calls: [toolCallObject],
        };

        // Gate reasoning_details on hasThoughtSignature because OpenRouter Gemini models reject orphaned reasoning
        // blocks.
        if (
          hasThoughtSignature &&
          interaction.functionCall.reasoning_details &&
          interaction.functionCall.reasoning_details.length > 0
        ) {
          assistantMessage.reasoning_details = interaction.functionCall.reasoning_details;
          log.info(
            `OpenRouter: Preserving ${interaction.functionCall.reasoning_details.length} reasoning_details in assistant message for tool '${interaction.functionCall.name}'`,
          );
        } else if (
          !hasThoughtSignature &&
          interaction.functionCall.reasoning_details &&
          interaction.functionCall.reasoning_details.length > 0
        ) {
          log.info(
            `OpenRouter: Skipping ${interaction.functionCall.reasoning_details.length} reasoning_details for tool '${interaction.functionCall.name}' because thought_signature is missing`,
          );
        }

        messages.push(assistantMessage);

        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify(interaction.functionResponse),
        });

        // Emit a follow-up user turn only for tool image metadata because the function response is in role=tool.
        const responseParts: Array<Record<string, unknown>> = [];

        if (interaction.imageMetadata?.imageUrls && interaction.imageMetadata.imageUrls.length > 0) {
          if (!seesImages) {
            log.info("OpenrouterStreamAdapter: Skipping tool images (model does not support images)");
          }

          for (const img of interaction.imageMetadata.imageUrls) {
            if (!seesImages) {
              continue;
            }
            responseParts.push(await inlineToolResponseImage(img, "OpenrouterStreamAdapter"));
          }
        }

        if (interaction.imageMetadata?.messageIds && interaction.imageMetadata.messageIds.length > 0) {
          responseParts.push({
            type: "text",
            text: `[System: Images were sent to Discord in message ID(s): ${interaction.imageMetadata.messageIds.map((id) => messageIdMap?.register(id, "media") ?? id).join(", ")}]`,
          });
        }

        if (responseParts.length > 0) {
          messages.push({
            role: "user",
            content: responseParts,
          });
        }
      }
    }

    if (currentTurnModelParts.length > 0) {
      const prefillText = currentTurnModelParts
        .map((part) => (part as { text?: string }).text)
        .filter((text): text is string => typeof text === "string" && text.length > 0)
        .join("");
      if (prefillText) {
        messages.push({
          role: "assistant",
          content: prefillText,
        });
        log.info(`OpenrouterStreamAdapter: Appended prefill assistant message (${prefillText.length} chars)`);
      }
    }

    log.info(`Assembled ${messages.length} messages for OpenRouter API`);
    return messages;
  }

  private logSanitizedRequest(messages: Array<Record<string, unknown>>): void {
    const sanitized = messages.map((msg) => {
      if (Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map((part: Record<string, unknown>) => {
            if (part.type === "image_url") {
              const imageUrlField =
                (part as { image_url?: { url?: string } }).image_url ||
                (part as { imageUrl?: { url?: string } }).imageUrl;
              if (imageUrlField?.url?.startsWith("data:")) {
                return {
                  type: "image_url",
                  image_url: {
                    ...imageUrlField,
                    url: "[BASE64_HIDDEN]",
                  },
                };
              }
            }
            return part;
          }),
        };
      }
      return msg;
    });

    log.info(`Full request structure:\n${JSON.stringify(sanitized, null, 2)}`);
  }
}
