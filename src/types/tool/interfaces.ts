import type { GenerationModelSelection } from "@/types/provider/generationModels";
import type { ProviderUsageContext } from "@/utils/provider/providerUsage";

import type { LlmRow, TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "../misc/context";
import type {
  BaseGuildTextChannel,
  BaseGuildVoiceChannel,
  Client,
  Message,
  DMChannel,
  NewsChannel,
  TextChannel,
  AnyThreadChannel,
  Webhook,
} from "discord.js";
import type { FunctionResponseImageMetadata } from "../provider/interfaces";
import type { MessageIdMap } from "@/utils/text/messageIdMap";

export type ToolParameterType = "string" | "number" | "boolean" | "array" | "object";

interface ToolParameterSchemaBase {
  type: ToolParameterType;
  description?: string;
  enum?: string[];
}

export interface ToolStringParameterSchema extends ToolParameterSchemaBase {
  type: "string";
}

interface ToolNumberParameterSchema extends ToolParameterSchemaBase {
  type: "number";
}

interface ToolBooleanParameterSchema extends ToolParameterSchemaBase {
  type: "boolean";
}

interface ToolArrayParameterSchema extends ToolParameterSchemaBase {
  type: "array";
  items: ToolParameterPropertySchema;
}

interface ToolObjectParameterSchema extends ToolParameterSchemaBase {
  type: "object";
  properties: Record<string, ToolParameterPropertySchema>;
  required?: string[];
}

export type ToolParameterPropertySchema =
  | ToolStringParameterSchema
  | ToolNumberParameterSchema
  | ToolBooleanParameterSchema
  | ToolArrayParameterSchema
  | ToolObjectParameterSchema;

export interface ToolParameterSchema extends ToolObjectParameterSchema {
  type: "object";
  properties: Record<string, ToolParameterPropertySchema>;
  required: string[];
}

export interface DeliveredStreamMessage {
  messageId: string;
  channelId: string;
  webhookId: string | null;
}

export interface StreamingContext {
  personaSprites?: StructuredContextItem["personaSprites"];
  deliveryMode?: import("@/utils/discord/webhook/personaPost").PersonaDeliveryMode;
  deliveryReceipts?: import("@/utils/discord/webhook/personaPost").PersonaDeliveryReceipt[];
  deliveryState?: { unconfirmed: boolean };
  imageModelSelection?: GenerationModelSelection;
  // Setting this restricts Discord allowedMentions strictly to these user IDs, so roles, everyone, and unlisted users
  // cannot be pinged.
  mentionableUserIds?: readonly string[];
  usageContext?: ProviderUsageContext;
  speechToolState?: { userId?: number; selection?: string };
  disableYouTubeProcessing: boolean; // Flag to temporarily disable YouTube function during enhanced context restart
  disableProfilePictureProcessing?: boolean; // Flag to temporarily disable profile picture processing during enhanced context restart
  disableGifProcessing?: boolean; // Flag to temporarily disable GIF processing during enhanced context restart
  disableShortTermMemoryUpdate?: boolean; // Flag to prevent update_short_term_memory from being called more than once per turn
  disableConditioningInteraction?: boolean;
  disableCrossChannelMessage?: boolean; // Flag to prevent nested cross-channel dispatch during tool-driven cross-channel turns
  explicitLongTermMemoryIntent?: boolean; // Flag to suppress STM tool nudges when the current user message explicitly asks for persistent memory
  disableMessageMetadataContext?: boolean; // Flag to prevent reveal_message_metadata from being called more than once per turn
  disableRecentMessageReplyTool?: boolean; // Allow reactions but block tool-sent replies when the stream is already replying
  forceReason?: boolean; // Flag to indicate reasoning mode for enhanced AI responses
  isManuallyTriggered?: boolean; // Flag to indicate this stream was triggered by a manual command
  suppressUserErrors?: boolean; // Suppress user-facing error embeds during retries or non-deliberate chat turns
  // Error recovery relies on this scope because server and personal keys can share a provider; omit only for non-chat
  // calls without user routing.
  textCredentialSource?: "server" | "personal";
  forceModelFallback?: boolean; // Force suppress errors regardless of key availability (model fallback retries)
  // Each fallback attempt clears this held timeout notice, so the generation loop emits it only if no later attempt
  // replaces it.
  deferredTimeoutNotice?: { providerName: string; sawStreamProgress: boolean };
  rotationKeyRetriesUsed?: boolean; // True if one or more rotation-key retries were attempted
  // The generation turn retries an interrupted stream on the same key when set, so its error stays unsurfaced.
  retryStreamInterruption?: boolean;
  disableAllTools?: boolean; // Flag to disable all tool calling (e.g., during user impersonation)
  deliberateToolAllowedNames?: string[]; // Optional per-turn allowlist when deliberate tool mode detects scoped intent
  disableReminderTool?: boolean; // Flag to prevent create_task from being called during a reminder-triggered turn
  // Written per attempt by applyAssistantPrefill, so the stream layer can strip any echoed prefix instead of
  // displaying it.
  outputPrefill?: string;
  triggerMessageId?: string;
  replyNoticeState?: { attempted: boolean; sent: boolean }; // Tracks the standalone alter reply notice across tool-call stream retries
  // This dedup flag prevents duplicate failure rows for one message because a failed turn reaches the emitter via
  // both the stream result and catch block.
  generationErrorReported?: boolean;
  forcedMentions?: Array<{
    handle: string;
    userId: string;
  }>; // Additional mention handles to force-resolve (e.g., reminder recipients)
  // Impersonation prompts can tell the model a speaker label that differs from the Discord webhook name, so the
  // output cleaner must strip both.
  impersonatedSpeakerLabel?: string;
  holdResponseText?: boolean;
  pendingResponseLimit?: import("@/types/stream/pendingResponse").PendingResponseLimit;
  suppressTextOutput?: boolean; // Suppress text output to Discord (NAI tool retry mode : keeps model state coherent but hides repeated text)
  // Provider adapters forward this signal to the underlying HTTP request so an SDK call timeout aborts the in-flight
  // stream.
  abortSignal?: AbortSignal;
  // The opening-label leak guard reads this retry count so it discards and retries while budget remains, then strips
  // and delivers when exhausted.
  emptyResponseRetryCount?: number;
  // Adapters invoke this on visible or provider-side stream progress, so outer watchdogs can refresh their timers.
  onStreamProgress?: () => void;
  // Listed tools end the turn on success without hardcoding a mode, so hidden agent turns stop the streaming loop
  // after their target tool finishes.
  endTurnAfterTools?: string[];

  messageIdMap?: MessageIdMap;

  // Carried to scope streaming telemetry without a hot-path DB lookup; absent on scheduler or manual turns, which
  // simply record nothing.
  triggererUserId?: number;

  // Security gate: only the Discord user matching this triggerer ID may open the raw error details of their own
  // personal key.
  triggererDiscId?: string;

  // Shared mutable sink threaded across attempts so sent refs survive timed-out streams and expression delivery knows
  // whether text already posted.
  deliveredMessageRefs?: DeliveredStreamMessage[];
}

export interface ToolContext {
  memoryEmbeddingResolved?: boolean;
  deliveryMode?: import("@/utils/discord/webhook/personaPost").PersonaDeliveryMode;
  usageContext?: ProviderUsageContext;
  channel: BaseGuildTextChannel | BaseGuildVoiceChannel | DMChannel | NewsChannel | TextChannel | AnyThreadChannel;
  client: Client;
  message?: Message;

  tomoriState: TomoriState;
  locale: string;

  provider: string;

  emojiStrings?: string[];
  userId?: string;
  internalUserId?: number;
  // The turn's trigger message is a bystander's anchor, so `userId` names no requester and `internalUserId` is who
  // pays.
  borrowsTriggerMessage?: boolean;
  guildId?: string;
  streamContext?: StreamingContext; // Optional streaming context for enhanced functionality

  webhook?: Webhook;
  personaUsername?: string;
  personaAvatarUrl?: string; // URL or data URI for the active persona/user identity
  activePersonaId?: number; // Active responding persona for tool-driven follow-up turns
  isUserImpersonation?: boolean; // True when the active turn is a user impersonation session
  impersonatedUserId?: string; // Discord user ID currently being impersonated, if any
  suppressProgressNotices?: boolean;
  mirrorSuppressedProgressNotices?: boolean;
  suppressFailureNotices?: boolean;
  // Shared mutable state across search-engine attempts so fallback notices are deduplicated without hiding error
  // embeds.
  progressNoticeState?: { attempted: boolean };
  showKillHint?: boolean; // When true, tool notice footers include the /kill hint (set after SOFT_WARN_ITERATION_THRESHOLD)
  contextItems?: StructuredContextItem[]; // Current LLM context for tools that need hidden resolution metadata

  messageIdMap?: MessageIdMap;

  // Tools should forward this turn-level AbortSignal to their HTTP calls so /kill cancels in-flight requests.
  abortSignal?: AbortSignal;
  // Pre-dispatch review sets this reference so executeTool skips duplicate normalization, while internal calls still
  // normalize.
  preparedToolRequest?: { name: string; args: Record<string, unknown> };
  // Callers recheck this predicate after async routing and right before invoking a transport so cancelled turns do
  // not dispatch.
  isExecutionCancelled?: () => boolean;
}

export interface ToolFailure {
  code: string;
  reason: string;
  suggestedActions: string[];
}

export interface ToolResult {
  success: boolean;
  failure?: ToolFailure;
  // Sent by the tool loop before building history so the sticker renders to Discord without ever being exposed to the
  // model.
  stickerSelection?: StickerSelection;
  data?: unknown;
  // Returned to the model as context, so exclude raw provider error bodies and log them instead because endpoints can
  // echo credentials.
  error?: string;
  message?: string;
  imageMetadata?: FunctionResponseImageMetadata;
  responseDelivered?: boolean;
  // When true, the streaming loop ends immediately after processing this tool result so async follow-up tools such as
  // boomerang can hand off cleanly.
  endTurn?: boolean;
}

export type ToolCategory = "discord" | "search" | "memory" | "utility" | "mcp";

type ToolModelCapabilityKey = "has_tools" | "sees_images" | "sees_videos" | "sees_youtube" | "supports_structoutput";

export type ToolModelCapabilityRequirements = Partial<Pick<LlmRow, ToolModelCapabilityKey>>;

export type ToolAvailabilityLlmState = Pick<LlmRow, "llm_codename" | ToolModelCapabilityKey>;

export interface ToolAssemblyState {
  speechToolState?: { userId?: number; selection?: string };
  server_id: string;
  // Despite the legacy Elevenlabs name, this flag covers either a local voice sample or a provider-hosted voice so
  // voice-sample personas still expose speech.
  activePersonaHasElevenlabsVoice: boolean;
  activePersonaVoiceDesignPrompt?: string | null;
  activePersonaVoiceSampleId?: number | null;
  activePersonaVoiceId?: string | null;
  activePersonaVoiceSourcePriority?: "design" | "clone";
  llm: ToolAvailabilityLlmState;
  diffusion_model_id?: number | null;
  nai_diffusion_model_id?: number | null;
  video_model_id?: number | null;
  config: {
    emoji_usage_enabled: boolean;
    sticker_usage_enabled: boolean;
    web_search_enabled: boolean;
    self_teaching_enabled: boolean;
    manage_message_enabled: boolean;
    imagegen_enabled: boolean;
    videogen_enabled: boolean;
    voice_message_enabled: boolean;
    user_blocking_enabled: boolean;
    // Required, not optional: every construction site copies these fields by hand, and an
    // optional flag here silently reads as enabled through the mapper's fallback, leaving
    // the capability toggle with no effect and no compile error.
    user_info_updates_enabled: boolean;
    thread_creation_enabled: boolean;
    conditioning_interactions_enabled: boolean;
    dice_rolling_enabled: boolean;
    danbooru_enabled: boolean;
  };
}

export interface ToolAssemblyContext {
  provider: string;
  state: ToolAssemblyState;
  // Pre-assembly tool names passed into assembleForContext so schema builders can inspect sibling availability
  // without circular dependencies.
  availableToolNames?: ReadonlySet<string>;
}

export interface Tool {
  name: string;
  description: string;
  category: ToolCategory;
  supportsSpriteSelection?: boolean;

  parameters: ToolParameterSchema;

  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;

  isAvailableFor(provider: string): boolean;

  // A false result here means unavailable right now rather than unsupported by the provider, so callers must report
  // those two rejections differently.
  isAvailableForContext?(provider: string, context: ToolContext): boolean;

  assembleForContext?(context: ToolAssemblyContext): Tool | null | Promise<Tool | null>;

  requiredModelCapabilities?: ToolModelCapabilityRequirements;
  requiresPermissions?: string[];
  requiresFeatureFlag?: string;
  requiresFollowUp?: boolean; // If true, always allow follow-up generation after tool execution (e.g., search/fetch tools)
}

export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract category: ToolCategory;
  abstract parameters: ToolParameterSchema;
  requiredModelCapabilities?: ToolModelCapabilityRequirements;

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  abstract execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;

  protected validateParameters(args: Record<string, unknown>): {
    isValid: boolean;
    missingParams?: string[];
    errors?: string[];
  } {
    const missingParams: string[] = [];
    const errors: string[] = [];

    for (const requiredParam of this.parameters.required) {
      if (!(requiredParam in args) || args[requiredParam] === undefined || args[requiredParam] === null) {
        missingParams.push(requiredParam);
      }
    }

    for (const [paramName, paramValue] of Object.entries(args)) {
      if (paramValue === undefined || paramValue === null) continue;

      const paramSchema = this.parameters.properties[paramName];
      if (paramSchema) {
        errors.push(...this.validateParameterValue(paramValue, paramSchema, paramName));
      }
    }

    return {
      isValid: missingParams.length === 0 && errors.length === 0,
      missingParams: missingParams.length > 0 ? missingParams : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private validateParameterValue(value: unknown, schema: ToolParameterPropertySchema, path: string): string[] {
    const errors: string[] = [];
    const actualType = Array.isArray(value) ? "array" : typeof value;

    if (schema.type !== actualType) {
      errors.push(`Parameter '${path}' expected type '${schema.type}' but got '${actualType}'`);
      return errors;
    }

    if (schema.enum && typeof value === "string") {
      if (!schema.enum.includes(value)) {
        errors.push(`Parameter '${path}' must be one of: ${schema.enum.join(", ")}`);
      }
    }

    if (schema.type === "array") {
      for (const [index, item] of (value as unknown[]).entries()) {
        errors.push(...this.validateParameterValue(item, schema.items, `${path}[${index}]`));
      }
      return errors;
    }

    if (schema.type === "object") {
      const objectValue = value as Record<string, unknown>;

      for (const requiredParam of schema.required ?? []) {
        if (
          !(requiredParam in objectValue) ||
          objectValue[requiredParam] === undefined ||
          objectValue[requiredParam] === null
        ) {
          errors.push(`Parameter '${path}.${requiredParam}' is required`);
        }
      }

      for (const [key, nestedValue] of Object.entries(objectValue)) {
        const nestedSchema = schema.properties[key];
        if (!nestedSchema || nestedValue === undefined || nestedValue === null) {
          continue;
        }

        errors.push(...this.validateParameterValue(nestedValue, nestedSchema, `${path}.${key}`));
      }
    }

    return errors;
  }

  protected isEnabled(_context: ToolContext): boolean {
    return true;
  }
}

interface ToolAdapter {
  convertTool(tool: Tool): Record<string, unknown>;

  convertResult(result: ToolResult): Record<string, unknown>;

  getProviderName(): string;
}

export interface MCPCapableToolAdapter extends ToolAdapter {
  getAllToolsInProviderFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>>;
}

export interface ToolExecutionEvent {
  toolName: string;
  provider: string;
  serverId: string;
  userId?: string;
  parameters: Record<string, unknown>;
  result: ToolResult;
  executionTime: number;
  timestamp: Date;
}

export interface ToolRegistryInterface {
  registerTool(tool: Tool): void;

  getTool(name: string): Tool | undefined;

  getAvailableTools(provider: string, context: ToolContext): Tool[];

  getAllTools(): Tool[];

  executeTool(toolName: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
import type { StickerSelection } from "@/types/discord/stickerSelection";
