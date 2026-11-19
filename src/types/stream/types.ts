import type { HumanizerSettings } from "@/constants/humanizer";
import type { MessageSplitMode } from "@/utils/text/processors/chunkProcessor";
import type { TokenUsage } from "@/utils/text/tokenEstimate";

export const DISCORD_STREAMING_CONSTANTS = {
  MAX_SINGLE_MESSAGE_LENGTH: 1950,

  FLUSH_BUFFER_SIZE_REGULAR: 1000,
  FLUSH_BUFFER_SIZE_CODE_BLOCK: 15000,

  BASE_TYPE_SPEED_MS_PER_CHAR: 10,
  MAX_TYPING_TIME_MS: 4000,
  MIN_VISIBLE_TYPING_DURATION_MS: 750,

  MIN_RANDOM_PAUSE_MS: 250,
  MAX_RANDOM_PAUSE_MS: 1500,
  THINKING_PAUSE_CHANCE: 0.25,

  INACTIVITY_TIMEOUT_MS: 120000,
  // Hosted queues can stall for minutes before token 1, so every stall detector must honor this longer budget or the
  // shortest timeout wins.
  FIRST_TOKEN_TIMEOUT_MS: 300000,
} as const;

export enum VisibleDeliveryMode {
  AGGREGATED_PHASE = "aggregated_phase",
  STREAMING = "streaming",
}

// Persisted after webhook sends because Discord displays only the clean persona name, so context rebuilding needs
// this to recover `Name (sprite):` labels.
export interface SpriteMessageRecordInfo {
  personaId: number;
  spriteName: string;
  // In-memory routing flag (not persisted in `persona_sprite_messages`) so post-turn stats exclude identity sprites
  // from `sprite_emotion`.
  isIdentity: boolean;
}

export interface SpriteShownEntry {
  // Stat metric constraint: stores the user-given sprite tag directly as the `metric_key`.
  name: string;
  // Excluded from `sprite_emotion` while still counted in `sprite_shown` because this marks a DID-alter identity
  // sprite.
  isIdentity: boolean;
}

interface StreamRenderModifierState {
  identity: {
    username?: string;
    avatarUrl?: string;
    avatarDataUri?: string;
  };
  spriteRecord?: SpriteMessageRecordInfo;
  // Held under `Persona (neutral)` after a plain-label revert so consecutive base lines keep one webhook username and
  // group in Discord.
  isNeutralAppearance?: boolean;
}

export interface StreamState {
  pendingResponseText?: string;
  pendingResponseSegments?: Array<{
    text: string;
    boundary?: import("@/utils/discord/stream/messageDelivery").BufferedDeliveryBoundary;
    codeBlock: boolean;
  }>;
  pendingResponseBytes?: number;
  pendingResponseTruncation?: import("@/types/stream/pendingResponse").PendingResponseTruncation;
  buffer: string;
  isInsideCodeBlock: boolean;
  isInsideThinkBlock: boolean;
  thinkBlockBuffer: string;
  isInsideDetailsBlock: boolean;
  detailsBlockBuffer: string;
  // Completed `<details>` bodies with `<summary>` stripped, retained here because they route to STM after the stream
  // ends.
  detailsSegments: string[];
  hasSemanticMarkers: boolean;
  messageSentCount: number;
  hasRepliedToOriginalMessage: boolean;
  // Delivered Discord text only (feeds short-term memory).
  accumulatedText: string;
  prefillTarget?: string;
  prefillMatched: number;
  prefillMatchFailed: boolean;
  // Text withheld while a partial prefill-echo match spans segments.
  prefillHeld: string;
  thoughtSummarySegments: string[];
  thoughtRawSegments: string[];
  // OpenRouter-only: tracks the upstream serving endpoint (such as `"minimax-cn"`) for thought-log attribution.
  servingProvider?: string;
  firstReplyUrl?: string;
  firstMessageId?: string;
  // Held across flush boundaries until the next non-empty segment or final flush so lone punctuation is not sent as
  // standalone Discord messages.
  pendingOrphanPunctuation?: string;
  // Degree-0 delivery buffer: queues visible text until a tool call, final flush, or attachment boundary.
  pendingAggregatedText: string;
  // Degree-0 join flag: replaces the prior newline flush boundary with exactly one blank line before the next queued
  // segment.
  pendingAggregateJoinNextWithBlankLine: boolean;
  activeRenderModifier?: StreamRenderModifierState;
  // Mid-line sentence and overflow flushes clear this so a plain own-name label there stays prose instead of
  // reverting to the base persona.
  nextSegmentOpensLine?: boolean;
  // Keeps one entry per delivered sprite message in render order (including repeats) so post-turn stats count every
  // display.
  spritesShown: SpriteShownEntry[];
  // Captured across all chunks (not just `done`) because OpenAI emits trailing usage chunks and Anthropic clobbers
  // `done` metadata.
  usage?: TokenUsage;
}

export interface TextProcessingConfig {
  humanizer: HumanizerSettings;
  visibleDeliveryMode: VisibleDeliveryMode;
  emojiUsageEnabled: boolean;
  emojiStrings: string[];
  mentionMap?: Map<string, string[]>;
  mentionIdSet?: Set<string>;
  personaMentionMap?: Map<string, string>;
  botName: string;
  // Includes lore, default, and trigger names so leaked multi-name opening label chains (such as `Tomori: Lilya:`)
  // can be stripped.
  botNameAliases: string[];
  registeredSpeakerNamesLower: Set<string>;
  maxMessageLength: number;
  uncensorUnicodeSpacesEnabled?: boolean;
  uncensorSanitizeEnabled?: boolean;
}

export interface TypingSimulationConfig {
  enabled: boolean;
  baseSpeedMsPerChar: number;
  maxTypingTimeMs: number;
  minVisibleDurationMs: number;
  randomPauseEnabled: boolean;
  thinkingPauseChance: number;
}

export interface StreamMetrics {
  startTime: number;
  endTime?: number;
  totalChunks: number;
  totalCharacters: number;
  messagesSent: number;
  functionCalls: number;
  errors: number;
  timeouts: number;
}

export interface ChunkProcessingResult {
  shouldFlush: boolean;
  segmentToFlush?: string;
  updatedBuffer: string;
  newCodeBlockState: boolean | undefined;
  breakType?: "newline" | "period" | "code_open" | "code_close" | "overflow";
}

export function createDefaultStreamState(): StreamState {
  return {
    buffer: "",
    isInsideCodeBlock: false,
    isInsideThinkBlock: false,
    thinkBlockBuffer: "",
    isInsideDetailsBlock: false,
    detailsBlockBuffer: "",
    detailsSegments: [],
    hasSemanticMarkers: false,
    messageSentCount: 0,
    hasRepliedToOriginalMessage: false,
    accumulatedText: "",
    prefillTarget: undefined,
    prefillMatched: 0,
    prefillMatchFailed: false,
    prefillHeld: "",
    thoughtSummarySegments: [],
    thoughtRawSegments: [],
    firstReplyUrl: undefined,
    firstMessageId: undefined,
    pendingOrphanPunctuation: undefined,
    pendingAggregatedText: "",
    pendingAggregateJoinNextWithBlankLine: false,
    activeRenderModifier: undefined,
    nextSegmentOpensLine: true,
    spritesShown: [],
    usage: undefined,
  };
}

export function createDefaultStreamMetrics(): StreamMetrics {
  return {
    startTime: Date.now(),
    totalChunks: 0,
    totalCharacters: 0,
    messagesSent: 0,
    functionCalls: 0,
    errors: 0,
    timeouts: 0,
  };
}

export function createTypingSimulationConfig(
  humanizer: HumanizerSettings,
  customConfig?: Partial<TypingSimulationConfig>,
): TypingSimulationConfig {
  return {
    enabled: humanizer.humanizer_pacing_enabled,
    baseSpeedMsPerChar: DISCORD_STREAMING_CONSTANTS.BASE_TYPE_SPEED_MS_PER_CHAR,
    maxTypingTimeMs: DISCORD_STREAMING_CONSTANTS.MAX_TYPING_TIME_MS,
    minVisibleDurationMs: DISCORD_STREAMING_CONSTANTS.MIN_VISIBLE_TYPING_DURATION_MS,
    randomPauseEnabled: humanizer.humanizer_pacing_enabled,
    thinkingPauseChance: DISCORD_STREAMING_CONSTANTS.THINKING_PAUSE_CHANCE,
    ...customConfig,
  };
}

export function getVisibleDeliveryMode(humanizer: HumanizerSettings): VisibleDeliveryMode {
  return humanizer.humanizer_streaming_enabled ? VisibleDeliveryMode.STREAMING : VisibleDeliveryMode.AGGREGATED_PHASE;
}

export function getMessageSplitMode(humanizer: HumanizerSettings): MessageSplitMode {
  if (!humanizer.humanizer_streaming_enabled) return "lines";
  return humanizer.humanizer_sentence_split_enabled ? "sentences" : "paragraphs";
}
