import type {
  BaseGuildTextChannel,
  BaseGuildVoiceChannel,
  Client,
  CommandInteraction,
  Message,
  DMChannel,
  AnyThreadChannel,
} from "discord.js";
import type { SupportedParamValue } from "@/constants/supportedParams";
import type { TomoriState } from "../db/schema";
import type { StructuredContextItem } from "../misc/context";
import type { StreamingContext } from "../tool/interfaces";
import type { ProviderError } from "../stream/interfaces";
import type { SpriteShownEntry } from "../stream/types";
import type { TokenUsage } from "@/utils/text/tokenEstimate";

export type ProviderApiFamily = "google-genai" | "openrouter" | "novelai" | "openai-compatible" | "anthropic";

export type SupportedParam = SupportedParamValue;

type ImageGenerationStyle = "chat-completion" | "nai-pipeline" | "none";

type VideoGenerationStyle = "chat-completion" | "none";

interface ProviderFeatureSupport {
  decisions: boolean;
  imageGeneration: ImageGenerationStyle;
  videoGeneration: VideoGenerationStyle;
  embeddings: boolean;
  structuredOutput: boolean;
  presetGeneration: boolean;
  expressionInitialization: boolean;
  liveTokenCounting: boolean;
  conversationCompaction: boolean;
  historyExtraction: boolean;
}

export type ProviderFeatureName = keyof ProviderFeatureSupport;

// Kept as string rather than a central union, because each provider declares its feature keys in providerInfo.ts to
// avoid core coupling.
export type ProviderFeatureImplementation = string;

export interface ApiKeyValidationResult {
  valid: boolean;
  error?: ProviderError;
}

export type StreamStopReason =
  | "user_request"
  | "system_request"
  | "speaker_guard"
  | "send_message_limit"
  | "flush_limit"
  | "channel_deleted"
  | "missing_access"
  | "pending_response_limit"
  | "unknown";

type ThoughtLogKind = "summary" | "raw";

export interface ThoughtLogEntry {
  kind: ThoughtLogKind;
  content: string;
}

export interface ThoughtLogPayload {
  summary?: string;
  raw?: string;
  iterations?: Array<{ summary?: string; raw?: string }>;
  fetchedContent?: string;
  firstReplyUrl?: string;
  generationDurationMs?: number;
  // OpenRouter-only: holds OpenRouter's upstream serving backend (such as "minimax-cn") for footer display, not
  // Tomori's provider key.
  servingProvider?: string;
}

export interface StreamResult {
  status:
    | "completed"
    | "function_call"
    | "error"
    | "timeout"
    | "stopped_by_user"
    | "empty_response"
    | "follow_up_interrupt";
  data?: unknown | Error;
  providerFailureReported?: boolean;
  pendingResponse?: import("@/types/stream/pendingResponse").PendingStreamResponse;
  // Delivered Discord text only (feeds short-term memory).
  accumulatedText?: string;
  firstMessageId?: string;
  // Stores <details> block body with <summary> stripped rather than full tag markup, because it feeds directly into
  // STM.
  detailsContent?: string;
  stopReason?: StreamStopReason;
  thoughtLog?: ThoughtLogPayload;
  // Keeps render-ordered repeats (one per delivered sprite) because post-turn stats attribute counts to the triggerer
  // and exclude isIdentity from sprite_emotion.
  spritesShown?: SpriteShownEntry[];
  // Scoped to one tool-loop request so turn totals must sum across segments, while omission signals
  // character-estimate fallback when providers omit usage.
  usage?: TokenUsage;
  // A stop that lands after the provider began answering still leaves a billed call, so quota keeps the unit.
  answeredBeforeStop?: boolean;
}

export interface ProviderConfig {
  model: string;
  apiKey: string;
  temperature: number;
  disabledParams?: SupportedParam[];
  maxOutputTokens?: number;
  tools?: Array<Record<string, unknown>>;
  logitBias?: Record<string, number>;
}

export interface ProviderInfo {
  name: string;
  displayName: string;
  aliases?: string[];
  supportedModels: string[];
  defaultVisionModel?: string;
  requiresApiKey: boolean;
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsImages: boolean;
  supportsVideos: boolean;
  apiFamily: ProviderApiFamily;
  featureSupport: ProviderFeatureSupport;
  featureImplementations?: Partial<Record<ProviderFeatureName, ProviderFeatureImplementation>>;
  usageCostMode?: "metered" | "none" | "unknown";
  supportedParams: readonly SupportedParam[];
}

export interface FunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  // Signals args were recovered from a truncated stream with only complete keys, so dispatchers must not execute this
  // as the model's intended call.
  argumentsTruncated?: boolean;
  // Base64-encoded when present, because providers such as Gemini require this thought signature on function calls.
  thoughtSignature?: string;
  // Must be preserved when returning tool results to OpenRouter reasoning models, so reasoning continuity holds
  // across turns.
  // biome-ignore lint/suspicious/noExplicitAny: reasoning_details has complex nested structure that varies by provider
  reasoning_details?: any[];
  // Must be replayed on the assistant message when a DeepSeek thinking response issues a tool call, so the same turn
  // can continue.
  deepseekReasoningContent?: string;
}

export interface FunctionResponseImageMetadata {
  imageUrls: Array<{
    url: string;
    mimeType?: string;
    wasCompressed?: boolean;
    originalUrl?: string;
  }>;
  totalSent: number;
  totalValidated: number;
  messageIds?: string[];
}

export interface LLMProvider {
  getInfo(): ProviderInfo;

  // Optional ownerDiscordId carries the guild ID (or user ID for DMs and personal keys), because some providers gate
  // keys by owner.
  validateApiKey(apiKey: string, ownerDiscordId?: string): Promise<ApiKeyValidationResult>;

  // False means the provider explicitly rejected codename, whereas null signals an inconclusive lookup so
  // registration treats it as unchecked.
  checkTextModel?(apiKey: string, codename: string): Promise<boolean | null>;

  // Optional because providers implement this only when their catalog also serves image models, using the same false
  // vs null contract as checkTextModel.
  checkImageModel?(apiKey: string, codename: string): Promise<boolean | null>;

  formatErrorDescription(error: ProviderError, locale: string): string | null;

  getTools(tomoriState: TomoriState, streamingContext?: StreamingContext): Promise<Array<Record<string, unknown>>>;

  // prefixStrippingName stays separate from personaUsername because user impersonation requires stripping a different
  // prefix than the persona display name.
  streamToDiscord(
    channel: BaseGuildTextChannel | BaseGuildVoiceChannel | DMChannel | AnyThreadChannel,
    client: Client,
    tomoriState: TomoriState,
    config: ProviderConfig,
    contextItems: StructuredContextItem[],
    currentTurnModelParts: Array<Record<string, unknown>>,
    emojiStrings?: string[],
    functionInteractionHistory?: Array<{
      functionCall: FunctionCall;
      functionResponse: Record<string, unknown>;
      imageMetadata?: FunctionResponseImageMetadata;
      // Replayed alongside the tool call because omitting pre-tool text causes models to repeat it on continuation.
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>,
    initialInteraction?: CommandInteraction,
    replyToMessage?: Message,
    streamingContext?: StreamingContext,
    userLocale?: string,
    webhook?: import("discord.js").Webhook,
    personaAvatarUrl?: string,
    personaUsername?: string,
    prefixStrippingName?: string,
  ): Promise<StreamResult>;

  getDefaultModel(): Promise<string>;

  createConfig(tomoriState: TomoriState, apiKey: string): Promise<ProviderConfig>;
}

export abstract class BaseLLMProvider implements LLMProvider {
  abstract getInfo(): ProviderInfo;
  abstract validateApiKey(apiKey: string, ownerDiscordId?: string): Promise<ApiKeyValidationResult>;
  abstract formatErrorDescription(error: ProviderError, locale: string): string | null;
  abstract getTools(
    tomoriState: TomoriState,
    streamingContext?: StreamingContext,
  ): Promise<Array<Record<string, unknown>>>;
  abstract streamToDiscord(
    channel: BaseGuildTextChannel | BaseGuildVoiceChannel | DMChannel | AnyThreadChannel,
    client: Client,
    tomoriState: TomoriState,
    config: ProviderConfig,
    contextItems: StructuredContextItem[],
    currentTurnModelParts: Array<Record<string, unknown>>,
    emojiStrings?: string[],
    functionInteractionHistory?: Array<{
      functionCall: FunctionCall;
      functionResponse: Record<string, unknown>;
      imageMetadata?: FunctionResponseImageMetadata;
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>,
    initialInteraction?: CommandInteraction,
    replyToMessage?: Message,
    streamingContext?: StreamingContext,
    userLocale?: string,
    webhook?: import("discord.js").Webhook,
    personaAvatarUrl?: string,
    personaUsername?: string,
    prefixStrippingName?: string,
  ): Promise<StreamResult>;
  abstract getDefaultModel(): Promise<string>;
  abstract createConfig(tomoriState: TomoriState, apiKey: string): Promise<ProviderConfig>;

  protected supportsModel(modelCodename: string): boolean {
    return this.getInfo().supportedModels.includes(modelCodename);
  }
}
