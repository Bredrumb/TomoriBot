import type { Client, Guild, GuildMember, Message } from "discord.js";
import type { ForcedMention } from "@/types/discord/mentions";
import type { TomoriState, UserRow } from "@/types/db/schema";
import type { RequestSnapshot, StructuredContextItem } from "@/types/misc/context";
import type { StreamResult, ThoughtLogPayload } from "@/types/provider/interfaces";
import type { StreamingContext } from "@/types/tool/interfaces";
import type { ThoughtLogOwner } from "@/utils/discord/thoughtLog";
import type { MessageIdMap } from "@/utils/text/messageIdMap";

export type TextQuotaSource = "user" | "system";

export interface ChatReminderData {
  reminder_purpose: string;
  reminder_lateness?: string | null;
  self_reminder?: boolean;
}

export interface ManualTriggerInvoker {
  userDiscId: string;
  username: string;
  locale?: string;
  member?: GuildMember | null;
}

export interface ChatIncoming {
  client: Client;
  message: Message;
  isFromQueue: boolean;
  isManuallyTriggered?: boolean;
  forceReason?: boolean;
  reasoningQuery?: string;
  llmOverrideCodename?: string;
  isStopResponse?: boolean;
  retryCount: number;
  skipLock: boolean;
  reminderRecipientID?: string;
  reminderData?: ChatReminderData;
  selectedPersonaId?: number;
  isPersonaJob: boolean;
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
  textQuotaSource: TextQuotaSource;
  textQuotaTriggerKey?: string;
  textQuotaUserDiscId?: string;
  manualSystemPrompt?: string;
  manualPrefill?: string;
  naiContinuationPrefill?: string;
  emptyResponseFinishReason?: string;
  injectedContextItems?: StructuredContextItem[];
  forcedMentions?: ForcedMention[];
  manualTriggerInvoker?: ManualTriggerInvoker;
  manualStreamingContextOverrides?: Partial<StreamingContext>;
}

export type ChatAdmissionDisposition = "run" | "ignore" | "queued" | "blocked" | "error";

export interface ChatAdmissionBase {
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
}

export interface ChatTurnPlan {
  lockedTurn: LockedChatTurn;
  turns: ChatTurn[];
}

export interface ChatTurn {
  lockedTurn: LockedChatTurn;
  persona?: TomoriState;
  personaIndex: number;
  totalPersonas: number;
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
}

export interface ChatTurnContext {
  turn: ChatTurn;
  client: Client;
  message: Message;
  channel: Message["channel"];
  locale: string;
  tomoriState?: TomoriState;
  allPersonas: TomoriState[];
  currentPersona?: TomoriState;
  contextItems: StructuredContextItem[];
  requestSnapshot?: RequestSnapshot;
  streamingContext?: StreamingContext;
  messageIdMap?: MessageIdMap;
}

export interface ChatResponseSink {
  emitStreamResult(result: StreamResult): Promise<void>;
  emitError(error: unknown): Promise<void>;
  finalize(result: GenerationTurnResult): Promise<void>;
}

export interface ChatPersonaResponse {
  text: string;
  personaName: string;
  tomoriId?: number;
  personaLineageId?: number | null;
}

export interface GenerationTurnResult {
  status: StreamResult["status"] | "skipped";
  streamResults: StreamResult[];
  personaResponses: ChatPersonaResponse[];
  thoughtLog?: ThoughtLogPayload;
  thoughtLogOwner?: ThoughtLogOwner;
}
