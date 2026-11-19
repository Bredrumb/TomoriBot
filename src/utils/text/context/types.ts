import type { Client } from "discord.js";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import type { RequestSnapshot } from "@/types/misc/context";
import type {
  CustomExpressionRow,
  AssembledServerConfig,
  PersonaUserBlockRow,
  ServerEmojiRow,
  ServerStickerRow,
} from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import type { PreparedParticipantContext } from "@/utils/text/participants/preparation";

export type MessageProxyConversationUser = {
  serviceId: string;
  displayName: string;
  senderDiscId: string;
};

export type SimplifiedMessageForContext = {
  id: string;
  authorId: string;
  authorName: string;
  authorType: "user" | "persona";
  isSystemNotice?: boolean;
  personaName?: string | null;
  authorPersonaId?: number | null;
  authorPersonaLineageId?: number | null;
  content: string | null;
  completionContent?: string;
  completionSpeaker?: false;
  createdAt?: number;
  mediaSourceMessageIds?: string[];
  remoteMediaSourceKind?: "reply" | "forwarded";
  combinedMessageIds?: string[];
  individualContents?: string[];
  // Timestamps parallel to combinedMessageIds so reveal_message_metadata reports accurate send times for each message
  // folded into a merged turn.
  combinedCreatedAts?: number[];
  imageAttachments: Array<{
    url: string;
    proxyUrl: string;
    mimeType: string | null;
    filename: string;
    isEmoji?: boolean;
    sourceMessageId?: string;
  }>;
  videoAttachments: Array<{
    url: string;
    proxyUrl: string;
    mimeType: string | null;
    filename: string;
    isYouTubeLink: boolean;
    sourceMessageId?: string;
  }>;
  // Kept structured rather than baked into content because the read_file hint depends on the turn's tool list, which
  // is resolved after history simplification.
  documentAttachments?: Array<{
    filename: string;
    sourceMessageId?: string;
  }>;
};

export type PublicPersonaProfile = {
  personaId: number;
  personaName: string;
  attributes: string[];
  imageAppearanceTags: string[];
};

export interface BuildContextParams {
  guildId: string;
  serverName: string;
  serverDescription: string | null;
  simplifiedMessageHistory: SimplifiedMessageForContext[];
  preparedParticipantContext: PreparedParticipantContext;
  channelDesc: string | null;
  channelName: string;
  channelId: string;
  // Thread parent channel ID only (never a category ID), because channelScopeCandidates uses it for private and RP
  // channel inheritance.
  parentChannelId?: string | null;
  client: Client;
  triggererName: string;
  triggererFormattedName: string;
  triggererAddressTerm: string;
  historyUserLabels?: Map<string, string>;
  historyPersonaMentionLabels?: Map<string, string>;
  triggererUserId?: number;
  emojiStrings?: string[];
  tomoriNickname: string;
  tomoriAttributes: string[];
  tomoriConfig: AssembledServerConfig;
  // Mode "append" adds a block after the server system prompt while "replace" swaps only the server prompt, so
  // persona prompt and attributes stay intact.
  channelPromptOverride?: { prompt: string; mode: import("@/types/db/schema").ChannelPromptMode } | null;
  // Additive with any persona note: both inject at their depths, whereas the global server note runs only when
  // neither persona nor channel defines one.
  channelContextNote?: { note: string; depth: number } | null;
  reunionNote?: string | null;
  personaPrompt?: string | null;
  personaLineageId?: number;
  isDMChannel?: boolean;
  snapshot?: RequestSnapshot;
  preloadedEmojis?: ServerEmojiRow[] | null;
  preloadedStickers?: ServerStickerRow[] | null;
  preloadedCustomExpressions?: CustomExpressionRow[] | null;
  isUserImpersonation?: boolean;
  impersonatedUserId?: string;
  shortTermMemoryUserId?: string;
  impersonatedUserNickname?: string;
  impersonatedUserPrompt?: string | null;
  personaUserBlocks?: PersonaUserBlockRow[];
  includeTimestamps?: boolean;
  explicitLongTermMemoryIntent?: boolean;
  // Sentinel value: undefined or null disables scoped filtering, whereas an empty array blocks all Deliberate Tool
  // Mode tools.
  deliberateToolAllowedNames?: readonly string[] | null;
  // Active presets skip server system_prompt and DEFAULT_SYSTEM_PROMPT so the preset owns the system prompt, while a
  // replace-mode channel prompt still wins.
  presetOwnsSystemPrompt?: boolean;
  messageIdMap?: MessageIdMap;
}

export type BuildContextResult = {
  memoryRecall?: import("@/utils/text/context/memoryRecall").MemoryRecallOutcome;
  nativeContextItems?: StructuredContextItem[];
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
  nudgeItem?: StructuredContextItem;
  // Depth from the end of dialogue history for `nudgeItem` injection: `0` inserts at the tail.
  nudgeInjectionDepth?: number;
  // Deferred STM block used only when server content depth is >= 0, since negative depths inline it in
  // `contextItems`.
  memoryInjectionItems?: StructuredContextItem[];
  // Depth from the end of dialogue history for `memoryInjectionItems` injection: `0` inserts at the tail.
  memoryInjectionDepth?: number;
  messageIdMap: MessageIdMap;
};
