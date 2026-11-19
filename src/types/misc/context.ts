export type ContextPart =
  | { type: "text"; text: string }
  | { type: "image"; uri: string; mimeType: string; fallbackUri?: string }
  | { type: "video"; uri: string; mimeType: string; isYouTubeLink?: boolean };

export interface MediaDescriptor {
  kind: "image" | "video";
  uri: string;
  mimeType: string | null;
  fallbackUri?: string;
  mediaId: string;
  isEmoji?: boolean;
  withinWindow: boolean;
  isYouTubeLink?: boolean;
  filename?: string;
}

export interface ConversationUserReference {
  // Discord snowflake or bridge user ID (not always numeric).
  targetId: string;
  displayLabel: string;
  aliases: string[];
  mentionable: boolean;
}

interface ContextItemSender {
  id: string;
  name: string;
  type: "user" | "persona";
}

export enum ContextItemTag {
  SYSTEM_INSTRUCTION_BLOCK = "system_instruction_block",
  SYSTEM_PERSONALITY = "system_personality",
  SYSTEM_HUMANIZER_RULES = "system_humanizer_rules",
  // Injected after SYSTEM_HUMANIZER_RULES when using append mode.
  SYSTEM_CHANNEL_PROMPT = "system_channel_prompt",
  SYSTEM_PERSONA_PROMPT = "system_persona_prompt",
  SYSTEM_FUNCTION_GUIDE = "system_function_guide",

  KNOWLEDGE_SERVER_INFO = "knowledge_server_info",
  KNOWLEDGE_SERVER_EMOJIS = "knowledge_server_emojis",
  KNOWLEDGE_SERVER_STICKERS = "knowledge_server_stickers",
  KNOWLEDGE_PERSONA_SPRITES = "knowledge_persona_sprites",
  KNOWLEDGE_SERVER_MEMORIES = "knowledge_server_memories",
  KNOWLEDGE_SERVER_DOCUMENTS = "knowledge_server_documents",
  KNOWLEDGE_RECALLED_MEMORIES = "knowledge_recalled_memories",
  KNOWLEDGE_LOREBOOK_BEFORE = "knowledge_lorebook_before",
  KNOWLEDGE_LOREBOOK_AFTER = "knowledge_lorebook_after",
  KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS = "knowledge_verbatim_tool_definitions",
  KNOWLEDGE_SERVER_CONDITIONING = "knowledge_server_conditioning",
  KNOWLEDGE_PERSONA_USER_BLOCKS = "knowledge_persona_user_blocks",
  KNOWLEDGE_USER_MEMORIES = "knowledge_user_memories",
  KNOWLEDGE_USER_STATUS = "knowledge_user_status",
  KNOWLEDGE_CURRENT_CONTEXT = "knowledge_current_context",
  KNOWLEDGE_USERS_IN_CONVERSATION = "knowledge_users_in_conversation",
  KNOWLEDGE_SHORT_TERM_MEMORY = "knowledge_short_term_memory",

  DIALOGUE_SAMPLE = "dialogue_sample",
  DIALOGUE_HISTORY = "dialogue_history",
  CONTEXT_NOTE_INJECTION = "context_note_injection",
}

export interface ContextMemoryEntry {
  id: string;
  text: string;
  createdAt?: number;
}

export type StructuredContextItem = {
  personaSprites?: { personaId: number; spriteKeys: string[] };
  completionText?: string;
  boomerangTranscript?: boolean;
  memoryEntries?: ContextMemoryEntry[];
  personalMemoryItems?: StructuredContextItem[];
  role: "system" | "user" | "model";
  parts: ContextPart[];
  mediaDescriptors?: MediaDescriptor[];
  metadataTag?: ContextItemTag;
  messageId?: string;
  // All Discord message IDs folded into a merged turn (`messageId` holds only the first), so replies to later split
  // chunks still resolve.
  combinedMessageIds?: string[];
  sender?: ContextItemSender;
  participantReviewEvidence?: {
    participants: Array<{ name: string; fields: string[] }>;
    channel: string;
    currentTime: string;
    timezone: string;
  };
  conversationUsers?: ConversationUserReference[];
  participantTargetIndex?: import("@/utils/text/participants/targetIndex").ParticipantTargetIndex;
  personaMentionMap?: Map<string, string>;
  // Built only when the context model can call tools, so a generation attempt that sends no tools drops it.
  requiresToolCalling?: true;
};

// Scoped to one request and reused across context rebuilds, not shared globally, so mid-request DB reads stay
// consistent without extra queries.
export interface RequestSnapshot {
  tomoriState?: import("@/types/db/schema").TomoriState;

  triggererUserRow?: import("@/types/db/schema").UserRow | null;

  isTriggererBlacklisted?: boolean;

  isTriggererOptedOut?: boolean;

  triggererPrivacyLevel?: import("@/types/db/schema").PrivacyLevel;

  preloadedMember?: import("discord.js").GuildMember | null;
}
