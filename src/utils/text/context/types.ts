import type { Client } from "discord.js";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import type { RequestSnapshot } from "@/types/misc/context";
import type {
  AssembledServerConfig,
  PersonaUserBlockRow,
  ServerEmojiRow,
  ServerStickerRow,
  UserRow,
} from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";

/**
 * Simplified message structure received from tomoriChat.ts.
 * This is an internal representation before converting to StructuredContextItem.
 */
export type SimplifiedMessageForContext = {
  id: string;
  authorId: string;
  authorName: string;
  authorType: "user" | "persona";
  personaName?: string | null;
  content: string | null;
  createdAt?: number;
  mediaSourceMessageIds?: string[];
  remoteMediaSourceKind?: "reply" | "forwarded";
  combinedMessageIds?: string[];
  individualContents?: string[];
  /** Per-constituent send timestamps, parallel to `combinedMessageIds`. Lets
   * reveal_message_metadata surface an accurate sent time for each original
   * message folded into a merged turn. */
  combinedCreatedAts?: number[];
  imageAttachments: Array<{
    url: string;
    proxyUrl: string;
    mimeType: string | null;
    filename: string;
    isEmoji?: boolean;
    /** Discord message that media-reference tools should fetch for this attachment. */
    sourceMessageId?: string;
  }>;
  videoAttachments: Array<{
    url: string;
    proxyUrl: string;
    mimeType: string | null;
    filename: string;
    isYouTubeLink: boolean;
    /** Discord message that media-reference tools should fetch for this attachment. */
    sourceMessageId?: string;
  }>;
};

export type PublicPersonaProfile = {
  personaId: number;
  personaName: string;
  attributes: string[];
  imageAppearanceTags: string[];
};

/** Shared parameter type for both the routing wrapper and native context builder. */
export interface BuildContextParams {
  guildId: string;
  serverName: string;
  serverDescription: string | null;
  simplifiedMessageHistory: SimplifiedMessageForContext[];
  userList: string[];
  channelDesc: string | null;
  channelName: string;
  channelId: string;
  /** Parent channel ID when `channelId` is a thread — used for private/RP channel inheritance. */
  parentChannelId?: string | null;
  client: Client;
  triggererName: string;
  triggererUserId?: number;
  emojiStrings?: string[];
  tomoriNickname: string;
  tomoriAttributes: string[];
  publicPersonaProfiles?: PublicPersonaProfile[];
  /** Eligible reference-discovered users already loaded by the shared resolver. */
  preloadedReferencedUserRows?: Map<string, UserRow>;
  /** Reference-discovered IDs must never take the participant auto-registration path. */
  referencedUserIds?: ReadonlySet<string>;
  tomoriConfig: AssembledServerConfig;
  /**
   * Per-channel system prompt override resolved at the call site (null when none).
   * `append` injects the prompt as a distinct SYSTEM_CHANNEL_PROMPT block after the
   * server system prompt; `replace` substitutes the channel prompt for the server
   * system prompt's content. Persona prompt and persona attributes are never affected.
   */
  channelPromptOverride?: { prompt: string; mode: import("@/types/db/schema").ChannelPromptMode } | null;
  /**
   * Per-channel context note resolved at the call site (null when none).
   * Injected into the dialogue history at the given depth alongside any active
   * persona-scoped note (additive). The global note from server_chat_configs is
   * only used when neither persona nor channel has one set.
   */
  channelContextNote?: { note: string; depth: number } | null;
  /**
   * Precomputed persona-reunion note bodies (raw text — the dialogue-history
   * stage wraps them in `[System: ...]`). One entry per returning person the
   * chat pipeline resolved: the triggerer and/or others present in the window.
   */
  reunionNotes?: string[] | null;
  personaPrompt?: string | null;
  personaLineageId?: number;
  isDMChannel?: boolean;
  mediaContextWindow?: number;
  snapshot?: RequestSnapshot;
  preloadedEmojis?: ServerEmojiRow[] | null;
  preloadedStickers?: ServerStickerRow[] | null;
  isUserImpersonation?: boolean;
  impersonatedUserId?: string;
  impersonatedUserNickname?: string;
  impersonatedUserPrompt?: string | null;
  /** Matrix bridge users: Matrix user ID -> stripped display name. */
  matrixUsers?: Map<string, string>;
  /** Synthetic participants surfaced as user-like entries. */
  syntheticUsers?: Map<string, { displayName: string; type: "persona" | "webhook" }>;
  /** Active persona-scoped user mutes/blocks for the responding persona. */
  personaUserBlocks?: PersonaUserBlockRow[];
  includeTimestamps?: boolean;
  explicitLongTermMemoryIntent?: boolean;
  /**
   * When `true`, skips the `DEFAULT_SYSTEM_PROMPT` fallback in the humanizer block.
   * Set by the routing wrapper when a SillyTavern preset is active and no custom
   * `/sysprompt` has been configured — the preset fully controls the system prompt.
   */
  suppressDefaultSystemPrompt?: boolean;
  /** Opaque message ID map — caller creates, context builder populates. */
  messageIdMap?: MessageIdMap;
}

/** Return type for both buildContext variants. */
export type BuildContextResult = {
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
  /** Populated map of opaque keys -> real Discord message IDs. */
  messageIdMap: MessageIdMap;
};
