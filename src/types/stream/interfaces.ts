/**
 * Streaming interfaces for modular LLM provider architecture
 *
 * This module defines the core interfaces that enable separation of concerns between:
 * - Universal Discord integration logic (StreamOrchestrator)
 * - Provider-specific streaming logic (StreamProvider implementations)
 */

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
import type { MessageIdMap } from "@/utils/text/messageIdMap";

/**
 * Normalized chunk format that all providers convert their raw chunks to
 * This provides a consistent interface for the StreamOrchestrator
 */
export interface ProcessedChunk {
  type: "text" | "function_call" | "error" | "done";
  content?: string;
  functionCall?: FunctionCall;
  error?: ProviderError;
  thoughts?: ThoughtLogEntry[];
  metadata?: Record<string, unknown>;
}

/**
 * Provider-specific error with normalized format
 */
export interface ProviderError {
  type: "api_error" | "rate_limit" | "content_blocked" | "timeout" | "provider_overloaded" | "unknown";
  message: string;
  code?: string;
  retryable: boolean;
  originalError?: unknown;

  // Enhanced fields for provider-specific user-friendly error handling
  userMessage?: string; // User-friendly error message from provider
}

/**
 * Configuration for streaming operations
 * Extends the base ProviderConfig with streaming-specific options
 */
export interface StreamConfig extends ProviderConfig {
  // Discord-specific settings
  maxMessageLength: number;
  flushBufferSize: number;
  flushBufferSizeCodeBlock: number;

  // Timing settings
  inactivityTimeoutMs: number;
  baseTypeSpeedMsPerChar: number;
  maxTypingTimeMs: number;
  minVisibleTypingDurationMs: number;

  // Humanization settings
  humanizerDegree: number;
  emojiUsageEnabled: boolean;

  // Command-specific overrides
  modelOverride?: string;
  forceReason?: boolean;
  isManuallyTriggered?: boolean;
}

/**
 * Context passed to streaming operations
 * Contains all the Discord and application context needed for streaming
 */
export interface StreamContext {
  // Discord context
  channel: BaseGuildTextChannel | BaseGuildVoiceChannel | DMChannel | NewsChannel | TextChannel | AnyThreadChannel;
  client: Client;
  initialInteraction?: CommandInteraction;
  replyToMessage?: Message;

  // Application context
  tomoriState: TomoriState;
  contextItems: StructuredContextItem[];
  currentTurnModelParts: Array<Record<string, unknown>>;
  emojiStrings?: string[];
  functionInteractionHistory?: Array<{
    functionCall: FunctionCall;
    functionResponse: Record<string, unknown>;
    imageMetadata?: FunctionResponseImageMetadata;
    /** Text parts the model generated before the function call (prevents repetition on continuation) */
    preToolCallTextParts?: Array<Record<string, unknown>>;
  }>;

  // Provider context
  provider: string;
  locale: string;
  suppressUserErrors?: boolean; // Suppress user-facing error embeds during retries or non-deliberate chat turns
  rotationKeyRetriesUsed?: boolean; // True if one or more rotation-key retries were attempted
  replyNoticeState?: { attempted: boolean; sent: boolean }; // Tracks the standalone alter reply notice across tool-call stream retries

  // Tool availability flags
  disableYouTubeProcessing?: boolean; // Temporarily disable YouTube function during enhanced context restart

  // Multi-persona webhook support
  webhook?: import("discord.js").Webhook; // Webhook for alter persona responses
  personaAvatarUrl?: string; // Avatar URL or data URI for current persona
  personaUsername?: string; // Username override for current persona (shown in Discord UI)
  prefixStrippingName?: string; // Name used for prefix stripping (may differ from personaUsername for user impersonation)

  // Optional forced mention handles (e.g., reminder recipients)
  forcedMentions?: Array<{
    handle: string;
    userId: string;
  }>;

  // Optional output prefill for hybrid prefix streaming
  outputPrefill?: string;
  outputPrefillState?: { sent: boolean };

  // NAI text suppression: keeps model state coherent but suppresses Discord output during tool retries
  suppressTextOutput?: boolean;

  // NAI GLM-4.6 prompt continuation: incomplete trailing fragment from previous stream, appended to the
  // assembled prompt so the model continues mid-sentence rather than starting a new response
  naiContinuationPrefill?: string;

  // External abort signal — allows the SDK call timeout to cancel the underlying HTTP request
  abortSignal?: AbortSignal;

  // Progress callback for outer watchdog timers (provider chunk received or Discord send succeeded)
  onStreamProgress?: () => void;

  // Opaque message ID map for resolving media_N/ref_N keys back to Discord snowflake IDs
  messageIdMap?: MessageIdMap;
}

/**
 * Raw chunk from provider's streaming API
 * This is the provider-specific format that gets converted to ProcessedChunk
 */
export interface RawStreamChunk {
  data: unknown;
  provider: string;
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for stream buffer management
 */
export interface BufferConfig {
  maxSize: number;
  flushOnPunctuation: boolean;
  codeBlockHandling: boolean;
  punctuationPattern?: RegExp;
}

/**
 * Interface that provider-specific stream adapters must implement
 * This separates provider API logic from universal Discord logic
 */
export interface StreamProvider {
  /**
   * Initialize and start the streaming process with the provider's API
   * @param config - Provider-specific configuration
   * @param context - Streaming context with Discord and app state
   * @returns AsyncGenerator that yields raw chunks from the provider
   */
  startStream(config: StreamConfig, context: StreamContext): AsyncGenerator<RawStreamChunk, void, unknown>;

  /**
   * Convert a raw provider chunk into normalized ProcessedChunk format
   * @param chunk - Raw chunk from the provider's streaming API
   * @returns Normalized chunk that StreamOrchestrator can handle
   */
  processChunk(chunk: RawStreamChunk): ProcessedChunk;

  /**
   * Extract function call information from a raw chunk if present
   * @param chunk - Raw chunk from the provider's streaming API
   * @returns Function call data or null if no function call
   */
  extractFunctionCall(chunk: RawStreamChunk): FunctionCall | null;

  /**
   * Convert provider-specific errors into normalized ProviderError format
   * @param error - Raw error from the provider's API
   * @returns Normalized error with consistent structure
   */
  handleProviderError(error: unknown): ProviderError;

  /**
   * Create provider-specific error description for display in embeds
   * @param error - The normalized provider error
   * @param locale - The locale for localization
   * @returns Provider-specific error description string or null for fallback
   */
  createErrorDescription(error: ProviderError, locale: string): string | null;

  /**
   * Get provider-specific information for logging and debugging
   * @returns Provider identification and capabilities
   */
  getProviderInfo(): {
    name: string;
    version: string;
    supportsStreaming: boolean;
    supportsFunctionCalling: boolean;
  };
}

/**
 * Static identity and capability metadata shared by all stream adapters.
 */
export interface StreamAdapterInfo {
  name: string;
  version: string;
  supportsStreaming?: boolean;
  supportsFunctionCalling: boolean;
}

/**
 * Base class for provider stream adapters.
 *
 * Provider subclasses still own request construction, provider-native parsing,
 * and error normalization. The base class centralizes adapter lifecycle identity
 * and small lifecycle hooks/wrappers used when handing work to StreamOrchestrator.
 */
export abstract class BaseStreamAdapter implements StreamProvider {
  protected constructor(private readonly adapterInfo: StreamAdapterInfo) {}

  abstract startStream(config: StreamConfig, context: StreamContext): AsyncGenerator<RawStreamChunk, void, unknown>;

  abstract processChunk(chunk: RawStreamChunk): ProcessedChunk;

  abstract extractFunctionCall(chunk: RawStreamChunk): FunctionCall | null;

  abstract handleProviderError(error: unknown): ProviderError;

  abstract createErrorDescription(error: ProviderError, locale: string): string | null;

  protected onRawChunk(_chunk: RawStreamChunk): void {}

  protected onProviderError(_error: unknown): void {}

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

  protected createProviderErrorChunk(
    error: unknown,
    metadata?: Record<string, unknown>,
    providerName = this.adapterInfo.name,
  ): RawStreamChunk {
    this.onProviderError(error);
    return this.createRawChunk(
      {
        error: this.handleProviderError(error),
      },
      {
        error: true,
        ...metadata,
      },
      providerName,
    );
  }
}

/**
 * Interface for the universal Discord streaming orchestrator
 * This handles all Discord-specific logic that's common across providers
 */
export interface StreamOrchestrator {
  /**
   * Stream an LLM response to Discord using a provider-specific adapter
   * This is the main entry point that replaces the massive streamGeminiToDiscord function
   *
   * @param provider - Provider-specific streaming adapter
   * @param config - Streaming configuration
   * @param context - Discord and application context
   * @returns Promise<StreamResult> - Outcome of the streaming operation
   */
  streamToDiscord(provider: StreamProvider, config: StreamConfig, context: StreamContext): Promise<StreamResult>;
}

/**
 * Interface for creating provider-specific configurations
 * This allows each provider to convert TomoriState into their specific config format
 */
export interface StreamConfigFactory {
  /**
   * Create a streaming configuration for a specific provider
   * @param tomoriState - Current Tomori state with settings
   * @param apiKey - Decrypted API key for the provider
   * @param provider - Provider name for configuration customization
   * @returns Provider-specific streaming configuration
   */
  createStreamConfig(tomoriState: TomoriState, apiKey: string, provider: string): StreamConfig;
}
