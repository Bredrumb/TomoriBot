import type { HumanizerSettings } from "@/constants/humanizer";
import type { ProviderUsageContext } from "@/utils/provider/providerUsage";
import type { PersonaDeliveryMode, PersonaDeliveryReceipt } from "@/utils/discord/webhook/personaPost";

import type {
  BaseGuildTextChannel,
  BaseGuildVoiceChannel,
  Client,
  CommandInteraction,
  Message,
  DMChannel,
  NewsChannel,
  TextChannel,
  AnyThreadChannel,
} from "discord.js";
import type {
  FunctionCall,
  FunctionResponseImageMetadata,
  ProviderConfig,
  StreamResult,
  ThoughtLogEntry,
} from "../provider/interfaces";
import type { TomoriState } from "../db/schema";
import type { StructuredContextItem } from "../misc/context";
import type { DeliveredStreamMessage } from "../tool/interfaces";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import { recordProviderErrorStat } from "@/utils/provider/providerErrorMetrics";

export interface ProcessedChunk {
  type: "text" | "function_call" | "error" | "done";
  content?: string;
  functionCall?: FunctionCall;
  error?: ProviderError;
  thoughts?: ThoughtLogEntry[];
  // OpenRouter-only: identifies the upstream backend (such as "minimax-cn") because only OpenRouter routes across
  // third-party backends.
  servingProvider?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderError {
  type: "api_error" | "rate_limit" | "content_blocked" | "timeout" | "provider_overloaded" | "model_error" | "unknown";
  message: string;
  code?: string;
  retryable: boolean;
  originalError?: unknown;

  userMessage?: string;
}

export interface StreamConfig extends ProviderConfig {
  maxMessageLength: number;
  flushBufferSize: number;
  flushBufferSizeCodeBlock: number;

  inactivityTimeoutMs: number;
  baseTypeSpeedMsPerChar: number;
  maxTypingTimeMs: number;
  minVisibleTypingDurationMs: number;

  humanizer: HumanizerSettings;
  emojiUsageEnabled: boolean;

  modelOverride?: string;
  forceReason?: boolean;
  isManuallyTriggered?: boolean;
}

export interface StreamContext {
  videoRequestDiagnostics?: {
    model: string;
    attempt: string;
    omittedVideos: number;
    httpStatus?: number;
    requestId?: string;
    generationId?: string;
    servingProvider?: string;
    videos: Array<{
      source: "discord_cdn" | "youtube" | "remote_url" | "inline_data" | "invalid_url";
      scheme: "http" | "https" | "data" | "invalid";
      mimeType: string;
      encodedBytes?: number;
      expiresAtUnixSeconds?: number;
    }>;
  };
  requestDiagnostics?: {
    model: string;
    contextItemCount: number;
    contentsCount: number;
    tailRoles: Array<"user" | "model" | "unknown">;
    lastTurn: {
      textParts: number;
      inlineDataParts: number;
      fileDataParts: number;
      functionCallParts: number;
      functionResponseParts: number;
    };
    functionHistoryCount: number;
    currentTurnModelPartCount: number;
    prefillPresent: boolean;
    manuallyTriggered: boolean;
    toolCount: number;
    chunksReceived: number;
    elapsedMs: number;
    imageFallbackRemoved?: number;
  };
  deliveryMode?: PersonaDeliveryMode;
  deliveryReceipts?: PersonaDeliveryReceipt[];
  deliveryState?: { unconfirmed: boolean };
  usageContext?: ProviderUsageContext;
  channel: BaseGuildTextChannel | BaseGuildVoiceChannel | DMChannel | NewsChannel | TextChannel | AnyThreadChannel;
  client: Client;
  initialInteraction?: CommandInteraction;
  replyToMessage?: Message;

  tomoriState: TomoriState;
  contextItems: StructuredContextItem[];
  currentTurnModelParts: Array<Record<string, unknown>>;
  emojiStrings?: string[];
  functionInteractionHistory?: Array<{
    functionCall: FunctionCall;
    functionResponse: Record<string, unknown>;
    imageMetadata?: FunctionResponseImageMetadata;
    // Preserved across tool-call turns because re-sending pre-tool-call text parts prevents the model from repeating
    // them on continuation.
    preToolCallTextParts?: Array<Record<string, unknown>>;
  }>;

  provider: string;
  locale: string;
  suppressUserErrors?: boolean; // Suppress user-facing error embeds during retries or non-deliberate chat turns
  // Credential ownership selects the provider error tips that can repair the failing configuration.
  textCredentialSource?: "server" | "personal" | "supporter";
  rotationKeyRetriesUsed?: boolean; // True if one or more rotation-key retries were attempted
  // The generation turn retries an interrupted stream on the same key, so its error stays unsurfaced.
  retryStreamInterruption?: boolean;
  // Shared across tool-call stream retries so the alter reply notice posts only once.
  replyNoticeState?: { attempted: boolean; sent: boolean };

  disableYouTubeProcessing?: boolean;

  webhook?: import("discord.js").Webhook;
  personaAvatarUrl?: string;
  personaUsername?: string;
  prefixStrippingName?: string;
  impersonatedSpeakerLabel?: string;

  forcedMentions?: Array<{
    handle: string;
    userId: string;
  }>;
  // When set, delivered text may ping only these user IDs: no roles, no everyone mentions, and nobody else.
  mentionableUserIds?: readonly string[];

  // Holds the attempt's `{bot}: {text}` prefill so echoed prefixes are stripped and never shown.
  outputPrefill?: string;
  triggerMessageId?: string;

  holdResponseText?: boolean;
  pendingResponseLimit?: import("@/types/stream/pendingResponse").PendingResponseLimit;
  suppressTextOutput?: boolean;

  abortSignal?: AbortSignal;

  // Empty-response retry count for this turn so the opening-label leak guard retries until budget runs out.
  emptyResponseRetryCount?: number;

  onStreamProgress?: () => void;

  messageIdMap?: MessageIdMap;

  // Internal `users` table foreign key (not a Discord ID) because provider-failure telemetry scopes by database user.
  triggererUserId?: number;
  triggererDiscId?: string;

  // Shared sink (reference threaded from StreamingContext) that the orchestrator appends to on
  // every successful send, so sends from an abandoned timed-out stream still reach the turn.
  deliveredMessageRefs?: DeliveredStreamMessage[];
}

export interface RawStreamChunk {
  data: unknown;
  provider: string;
  metadata?: Record<string, unknown>;
}

export interface StreamProvider {
  startStream(config: StreamConfig, context: StreamContext): AsyncGenerator<RawStreamChunk, void, unknown>;

  processChunk(chunk: RawStreamChunk): ProcessedChunk;

  handleProviderError(error: unknown): ProviderError;

  // Sentinel return: `null` instructs the caller to fall back to the default embed error description.
  createErrorDescription(error: ProviderError, locale: string): string | null;

  getProviderInfo(): {
    name: string;
    version: string;
    supportsStreaming: boolean;
    supportsFunctionCalling: boolean;
  };
}

export interface StreamAdapterInfo {
  name: string;
  version: string;
  supportsStreaming?: boolean;
  supportsFunctionCalling: boolean;
}

export abstract class BaseStreamAdapter implements StreamProvider {
  protected constructor(private readonly adapterInfo: StreamAdapterInfo) {}

  abstract startStream(config: StreamConfig, context: StreamContext): AsyncGenerator<RawStreamChunk, void, unknown>;

  abstract processChunk(chunk: RawStreamChunk): ProcessedChunk;

  abstract handleProviderError(error: unknown): ProviderError;

  abstract createErrorDescription(error: ProviderError, locale: string): string | null;

  protected onRawChunk(_chunk: RawStreamChunk): void {}

  // Subclasses overriding this hook must call `super.onProviderError()` before yielding the error chunk because
  // `provider_error` is the only failure metric.
  protected onProviderError(_error: unknown, providerError: ProviderError, context?: StreamContext): void {
    recordProviderErrorStat(this.adapterInfo.name, providerError, context);
  }

  getProviderInfo(): {
    name: string;
    version: string;
    supportsStreaming: boolean;
    supportsFunctionCalling: boolean;
  } {
    return {
      name: this.adapterInfo.name,
      version: this.adapterInfo.version,
      supportsStreaming: this.adapterInfo.supportsStreaming ?? true,
      supportsFunctionCalling: this.adapterInfo.supportsFunctionCalling,
    };
  }

  protected createRawChunk(
    data: unknown,
    metadata?: Record<string, unknown>,
    providerName = this.adapterInfo.name,
  ): RawStreamChunk {
    const chunk = {
      data,
      provider: providerName,
      metadata: {
        timestamp: Date.now(),
        ...metadata,
      },
    };
    this.onRawChunk(chunk);
    return chunk;
  }

  // Passing `context` is required whenever one is in scope because omitting it leaves the failure unscoped and
  // unrecorded.
  protected createProviderErrorChunk(
    error: unknown,
    context?: StreamContext,
    metadata?: Record<string, unknown>,
    providerName = this.adapterInfo.name,
  ): RawStreamChunk {
    const providerError = this.handleProviderError(error);
    this.onProviderError(error, providerError, context);
    return this.createRawChunk(
      {
        error: providerError,
      },
      {
        error: true,
        ...metadata,
      },
      providerName,
    );
  }
}

export interface StreamOrchestrator {
  streamToDiscord(provider: StreamProvider, config: StreamConfig, context: StreamContext): Promise<StreamResult>;
}
