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
  disableYouTubeProcessing: boolean;
  disableProfilePictureProcessing?: boolean;
  disableGifProcessing?: boolean;
  disableShortTermMemoryUpdate?: boolean;
  disableConditioningInteraction?: boolean;
  disableCrossChannelMessage?: boolean; // Flag to prevent nested cross-channel dispatch during tool-driven cross-channel turns
  explicitLongTermMemoryIntent?: boolean; // Flag to suppress STM tool nudges when the current user message explicitly asks for persistent memory
  disableMessageMetadataContext?: boolean; // Flag to prevent reveal_message_metadata from being called more than once per turn
  disableRecentMessageReplyTool?: boolean; // Allow reactions but block tool-sent replies when the stream is already replying
  forceReason?: boolean; // Flag to indicate reasoning mode for enhanced AI responses
  isManuallyTriggered?: boolean; // Flag to indicate this stream was triggered by a manual command
  suppressUserErrors?: boolean; // Suppress user-facing error embeds during retries or non-deliberate chat turns
  // Error recovery relies on credential scope because different scopes can share a provider.
  textCredentialSource?: "server" | "personal" | "supporter";
  forceModelFallback?: boolean; // Force suppress errors regardless of key availability (model fallback retries)
  // Each fallback attempt clears this held timeout notice, so the generation loop emits it only if no later attempt
  // replaces it.
  deferredTimeoutNotice?: { providerName: string; sawStreamProgress: boolean };
  rotationKeyRetriesUsed?: boolean;
  // The generation turn retries an interrupted stream on the same key when set, so its error stays unsurfaced.
  retryStreamInterruption?: boolean;
  disableAllTools?: boolean;
  deliberateToolAllowedNames?: string[];
  disableReminderTool?: boolean;
  disableTaskCreation?: boolean;
  // Written per attempt by applyAssistantPrefill, so the stream layer can strip any echoed prefix instead of
  // displaying it.
  outputPrefill?: string;
  triggerMessageId?: string;
  // Tracks the alter reply notice across tool-call stream retries so it posts once.
  replyNoticeState?: { attempted: boolean; sent: boolean };
  // This dedup flag prevents duplicate failure rows for one message because a failed turn reaches the emitter via
  // both the stream result and catch block.
  generationErrorReported?: boolean;
  forcedMentions?: Array<{
    handle: string;
    userId: string;
  }>;
  // Impersonation prompts can tell the model a speaker label that differs from the Discord webhook name, so the
  // output cleaner must strip both.
  impersonatedSpeakerLabel?: string;
  holdResponseText?: boolean;
  pendingResponseLimit?: import("@/types/stream/pendingResponse").PendingResponseLimit;
  // Hides Discord output during NAI tool retries so repeated text stays hidden while model state stays coherent.
  suppressTextOutput?: boolean;
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
  streamContext?: StreamingContext;

  webhook?: Webhook;
  personaUsername?: string;
  personaAvatarUrl?: string;
  activePersonaId?: number;
  isUserImpersonation?: boolean;
  impersonatedUserId?: string;
  suppressProgressNotices?: boolean;
  mirrorSuppressedProgressNotices?: boolean;
  suppressFailureNotices?: boolean;
  // Shared mutable state across search-engine attempts so fallback notices are deduplicated without hiding error
  // embeds.
  progressNoticeState?: { attempted: boolean };
  showKillHint?: boolean;
  contextItems?: StructuredContextItem[];

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
    // Required (not optional): an optional field silently falls back to enabled in the mapper with no compile
    // error.
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
  withActions?(actions: string[]): Tool;

  requiredModelCapabilities?: ToolModelCapabilityRequirements;
  requiresPermissions?: string[];
  requiresFeatureFlag?: string;
  requiresFollowUp?: boolean;
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
