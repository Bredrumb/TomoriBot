import type { ConditioningActionKey } from "@/utils/conditioning/conditioning";
import type { GenerationModelSelection } from "@/types/provider/generationModels";
import type { ProviderUsageContext } from "@/utils/provider/providerUsage";
import type { BaseGuildTextChannel, Client, Guild, GuildMember, Message, Webhook } from "discord.js";
import type { ForcedMention } from "@/types/discord/mentions";
import type { ConditioningType, ServerEmojiRow, ServerStickerRow, TomoriState, UserRow } from "@/types/db/schema";
import type { RequestSnapshot, StructuredContextItem } from "@/types/misc/context";
import type {
  FunctionCall,
  FunctionResponseImageMetadata,
  StreamResult,
  ThoughtLogPayload,
} from "@/types/provider/interfaces";
import type { StreamingContext } from "@/types/tool/interfaces";
import type { DeliberateToolIntentMatch } from "@/utils/tools/deliberateToolMode";
import type { ThoughtLogOwner } from "@/utils/discord/thoughtLog";
import type { ReunionPresenceScope } from "@/utils/chat/reunionPresence";
import type { FastRegenerationRequest } from "@/utils/discord/fastRegeneration";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import type { TextQuotaTriggerState } from "@/utils/chat/textQuotaState";
import type { TurnPrefill } from "@/utils/chat/assistantPrefill";
import type { ExpressionDeliveryState } from "@/utils/chat/expressionDelivery";

export type TextQuotaSource = "user" | "system";

export interface ChatReminderData {
  reminder_purpose: string;
  reminder_lateness?: string | null;
  self_reminder?: boolean;
  // Personal-key routing uses this ID instead of the borrowed trigger message's author, because that author is a
  // bystander.
  created_by_user_id?: number | null;
}

export type QueuedMessageDiscardReason =
  | "admission_rejected"
  | "channel_queue_cleared"
  | "queued_processing_failed"
  | "stale_lock_release"
  | "superseded_follow_up"
  | "self_reply_work_cleared"
  | "scene_interrupted";

export type ChatGenerationResultHandler = (
  result: GenerationTurnResult,
  deliveryReceipts?: readonly import("@/utils/discord/webhook/personaPost").PersonaDeliveryReceipt[],
) => void | Promise<void>;
export type QueuedMessageDiscardHandler = (reason: QueuedMessageDiscardReason) => void | Promise<void>;

export interface ManualTriggerInvoker {
  userDiscId: string;
  username: string;
  locale?: string;
  member?: GuildMember | null;
}

export interface SystemTriggerIdentity {
  serverDiscId: string;
  userDiscId: string;
}

export interface SceneTurnSpeaker {
  personaId: number;
  personaName: string;
}

export interface SceneTurnMetadata {
  modelSelection?: GenerationModelSelection;
  commandId: string;
  sequence: SceneTurnSpeaker[];
  turnIndex: number;
  totalTurns: number;
  additionalInstructions?: string;
  // Indexed context per queued turn replaces turn 0's injected items so one speaker never sees another's private
  // goal.
  turnContextItems?: StructuredContextItem[][];
}

// Expression allowance passed to an empty-response retry so it cannot emit a second expression, keyed by persona
// because one invocation plans multiple.
interface CarriedExpressionDelivery {
  personaId: number;
  state: ExpressionDeliveryState;
}

export interface NaturalNudgeTurn {
  // Deliberate Tool Mode admits these idle nudge tools because no human message carries their trigger words.
  toolNames: readonly string[];
  // Ping User target: restricts pings to this user and resolves {user} and triggerer name to them.
  targetUserDiscId?: string;
  opensIdleNudge?: true;
}

export interface TomoriChatInput {
  client: Client;
  message: Message;
  isFromQueue: boolean;
  isManuallyTriggered?: boolean;
  isDirectChat?: boolean;
  forceReason?: boolean;
  reasoningQuery?: string;
  llmOverrideCodename?: string;
  isStopResponse?: boolean;
  retryCount?: number;
  skipLock?: boolean;
  reminderRecipientID?: string;
  reminderData?: ChatReminderData;
  selectedPersonaId?: number;
  triggeredPersonaIds?: number[];
  isPersonaJob?: boolean;
  isUserImpersonation?: boolean;
  impersonatedUserId?: string;
  textQuotaSource?: TextQuotaSource;
  textQuotaTriggerKey?: string;
  textQuotaUserDiscId?: string;
  manualSystemPrompt?: string;
  manualPrefill?: string;
  emptyResponseFinishReason?: string;
  shouldSurfaceUserErrors?: boolean;
  injectedContextItems?: StructuredContextItem[];
  forcedMentions?: ForcedMention[];
  manualTriggerInvoker?: ManualTriggerInvoker;
  systemTriggerIdentity?: SystemTriggerIdentity;
  manualStreamingContextOverrides?: Partial<StreamingContext>;
  sceneTurn?: SceneTurnMetadata;
  // Unprompted Natural Nudges turn: never queues and never feeds engagement stats.
  naturalNudge?: NaturalNudgeTurn;
  conditioningInteraction?: { actorType: "user" | "persona"; type: ConditioningType; action: ConditioningActionKey };
  nudgeSceneCatcherPersonaId?: number;
  // Borrowed-trigger system turn treats the anchor message's author as a bystander, so personal keys, reunion clock,
  // and access gates never apply to them.
  borrowsTriggerMessage?: boolean;
  suppressSelfReply?: boolean;
  fastRegeneration?: FastRegenerationRequest;
  carriedExpressionDelivery?: CarriedExpressionDelivery;
  onGenerationResult?: ChatGenerationResultHandler;
  onQueueDiscard?: QueuedMessageDiscardHandler;
}

export interface ChatIncoming {
  client: Client;
  message: Message;
  isFromQueue: boolean;
  isManuallyTriggered?: boolean;
  isDirectChat?: boolean;
  forceReason?: boolean;
  reasoningQuery?: string;
  llmOverrideCodename?: string;
  isStopResponse?: boolean;
  retryCount: number;
  skipLock: boolean;
  reminderRecipientID?: string;
  reminderData?: ChatReminderData;
  selectedPersonaId?: number;
  triggeredPersonaIds?: number[];
  isPersonaJob: boolean;
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
  textQuotaSource: TextQuotaSource;
  textQuotaTriggerKey?: string;
  textQuotaUserDiscId?: string;
  manualSystemPrompt?: string;
  manualPrefill?: string;
  emptyResponseFinishReason?: string;
  shouldSurfaceUserErrors?: boolean;
  injectedContextItems?: StructuredContextItem[];
  forcedMentions?: ForcedMention[];
  manualTriggerInvoker?: ManualTriggerInvoker;
  systemTriggerIdentity?: SystemTriggerIdentity;
  manualStreamingContextOverrides?: Partial<StreamingContext>;
  sceneTurn?: SceneTurnMetadata;
  // Unprompted Natural Nudges turn: never queues and never feeds engagement stats.
  naturalNudge?: NaturalNudgeTurn;
  conditioningInteraction?: { actorType: "user" | "persona"; type: ConditioningType; action: ConditioningActionKey };
  nudgeSceneCatcherPersonaId?: number;
  // Same borrowed-trigger bystander semantics: see `TomoriChatInput.borrowsTriggerMessage`.
  borrowsTriggerMessage?: boolean;
  suppressSelfReply?: boolean;
  fastRegeneration?: FastRegenerationRequest;
  autochatCounterSnapshot?: { autoch_counter: number; autoch_next_target: number };
  carriedExpressionDelivery?: CarriedExpressionDelivery;
  onGenerationResult?: ChatGenerationResultHandler;
  onQueueDiscard?: QueuedMessageDiscardHandler;
}

export type ChatAdmissionDisposition = "run" | "ignore" | "queued" | "blocked" | "error";

interface ChatAdmissionBase {
  incoming: ChatIncoming;
  disposition: ChatAdmissionDisposition;
  locale: string;
  reason?: string;
}

export interface RunnableChatAdmission extends ChatAdmissionBase {
  disposition: "run";
  client: Client;
  message: Message;
  channel: Message["channel"];
  guild?: Guild | null;
  serverDiscId?: string;
  serverName?: string;
  channelName?: string;
  userDiscId?: string;
  cooldownUserDiscId?: string;
  isDMChannel?: boolean;
  tomoriState?: TomoriState;
  allPersonas?: TomoriState[];
  userRow?: UserRow | null;
  requestSnapshot?: RequestSnapshot;
  referencedMessage: Message | null;
}

export interface NonRunnableChatAdmission extends ChatAdmissionBase {
  disposition: Exclude<ChatAdmissionDisposition, "run">;
  reason: string;
  error?: unknown;
}

export type ChatAdmission = RunnableChatAdmission | NonRunnableChatAdmission;

export interface LockedChatTurn {
  admission: RunnableChatAdmission;
  channelId: string;
  lockedAt: number;
  queueDepth: number;
  skipLock: boolean;
}

export interface ChatTurnPlan {
  lockedTurn: LockedChatTurn;
  turns: ChatTurn[];
}

export interface ChatTurn {
  lockedTurn: LockedChatTurn;
  persona: TomoriState;
  personaIndex: number;
  totalPersonas: number;
  allPersonas: TomoriState[];
  tomoriState: TomoriState;
  mainPersona: TomoriState | null;
  userRow: UserRow;
  requestSnapshot: RequestSnapshot;
  serverDiscId: string;
  guild: Guild | null;
  isDMChannel: boolean;
  isSelfMessage: boolean;
  userDiscId: string;
  cooldownUserDiscId: string;
  triggererName: string;
  triggererFormattedName: string;
  triggererAddressTerm: string;
  channelName: string;
  channelDescription: string | null;
  serverName: string;
  serverDescription: string | null;
  textCredentialSource: "server" | "personal";
  personalRoutingUserId: number | null;
  personalTextProvider: string | null;
  shouldApplyTextQuota: boolean;
  textQuotaTriggerKey: string;
  textQuotaState: TextQuotaTriggerState | null;
  shouldSurfaceUserErrors: boolean;
  forcedMentions?: ForcedMention[];
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
  triggeredPersonaIds: number[];
}

export interface ChatTurnContext {
  memoryRecall?: import("@/utils/text/context/memoryRecall").MemoryRecallOutcome;
  usageContext?: ProviderUsageContext;
  responseReview?: import("@/utils/chat/responseReview").ResponseReviewState;
  // Map keyed by request identity so successful tool calls are preserved across key rotation and model fallback.
  completedToolCalls?: Map<string, ToolHistoryEntry>;
  turn: ChatTurn;
  client: Client;
  message: Message;
  channel: Message["channel"];
  guild: Guild | null;
  locale: string;
  serverDiscId: string;
  userDiscId: string;
  triggererUserId: number | undefined;
  isDMChannel: boolean;
  isFromQueue: boolean;
  isStopResponse: boolean;
  isPersonaJob: boolean;
  isSelfMessage: boolean;
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
  allPersonas: TomoriState[];
  reunionPresence: ReunionPresenceScope | null;
  currentPersona: TomoriState;
  tomoriState: TomoriState;
  requestSnapshot: RequestSnapshot;
  contextItems: StructuredContextItem[];
  nativeContextItems?: StructuredContextItem[];
  // Kept separate from contextItems because each attempt decides how its own model handles assistant prefill.
  assistantPrefill: TurnPrefill | null;
  // Shared by reference across every attempt of this persona turn so retries do not reset ExpressionDeliveryState.
  expressionDelivery: ExpressionDeliveryState;
  simplifiedMessages: SimplifiedMessageForContext[];
  reactedMessages: Message[];
  streamingContext: StreamingContext;
  messageIdMap: MessageIdMap;
  emojiStrings: string[];
  loadedEmojis: ServerEmojiRow[] | null;
  loadedStickers: ServerStickerRow[] | null;
  channelName: string;
  channelDescription: string | null;
  serverName: string;
  serverDescription: string | null;
  triggererName: string;
  triggererFormattedName: string;
  triggererAddressTerm: string;
  textCredentialSource: "server" | "personal";
  personalRoutingUserId: number | null;
  personalTextProvider: string | null;
  shouldApplyTextQuota: boolean;
  textQuotaTriggerKey: string;
  textQuotaState: TextQuotaTriggerState | null;
  shouldSurfaceUserErrors: boolean;
  responseTarget?: ChatResponseTarget;
  deliberateToolModeActive: boolean;
  deliberateToolContextTurns: number;
  deliberateToolTriggerMatchByToolName: Map<string, DeliberateToolIntentMatch>;
}

export interface ChatResponseTarget {
  deliveryMode?: import("@/utils/discord/webhook/personaPost").PersonaDeliveryMode;
  webhook?: Webhook;
  temporaryWebhook?: Webhook;
  personaUsername?: string;
  personaAvatarUrl?: string;
  prefixStrippingName?: string;
  webhookTargetChannel?: BaseGuildTextChannel;
}

export interface ChatResponseSink {
  prepare?(context: ChatTurnContext): Promise<ChatResponseTarget | undefined>;
  emitStreamResult(result: StreamResult): Promise<void>;
  emitError(error: unknown): Promise<void>;
  finalize(result: GenerationTurnResult): Promise<void>;
  // Must be idempotent because callers run it on every exit path, including throws that bypass
  // ChatResponseSink.finalize.
  cleanup?(): Promise<void>;
}

interface ChatPersonaResponse {
  text: string;
  personaName: string;
  personaId?: number;
  personaLineageId?: number | null;
}

export interface ToolHistoryEntry {
  functionCall: FunctionCall;
  functionResponse: Record<string, unknown>;
  imageMetadata?: FunctionResponseImageMetadata;
  preToolCallTextParts?: Array<Record<string, unknown>>;
}

export interface GenerationTurnResult {
  status: StreamResult["status"] | "skipped";
  streamResults: StreamResult[];
  usageEntries?: import("@/utils/chat/responseReview").TurnUsageEntry[];
  personaResponses: ChatPersonaResponse[];
  toolResponseDelivered?: boolean;
  firstDeliveredMessageId?: string;
  thoughtLog?: ThoughtLogPayload;
  thoughtLogOwner?: ThoughtLogOwner;
}
