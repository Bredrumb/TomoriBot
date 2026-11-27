import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
  type Message,
} from "discord.js";
import type { ChatTurn, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { getChannelTurnAbortSignal } from "@/utils/chat/channelQueue";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { getCachedMainPersona } from "@/utils/cache/tomoriStateCache";
import { findLastPersonaTurnBlock } from "@/utils/discord/personaTurnDetection";
import { deletePersonaTurnMessages, tryAcquirePersonaTurnDeletion } from "@/utils/discord/personaTurnDeletion";
import { log } from "@/utils/misc/logger";

import { buildInteractionRouteId } from "@/utils/discord/interactions/routeRegistry";
import type { FallbackNotice } from "@/utils/discord/fallbackModelNotice";
import { MAX_MESSAGE_FETCH_LIMIT } from "@/utils/discord/messageFetchLimit";
import { isReplyControlMessage, REPLY_CONTROLS_NAMESPACE } from "@/utils/discord/replyControlMessage";
import { type PersonaPostContext, sendPersonaPost } from "@/utils/discord/webhook/personaPost";
import { captureDiscordOwnership } from "@/utils/discord/webhook/webhookCore";
import { sendChannelMessageOnce } from "@/utils/discord/webhook/singleAttemptMessage";
import { localizer } from "@/utils/text/localizer";

export const REPLY_CONTROLS_VERSION = "v1";
const REGENERATION_LABELS = { retry: "↻", continue: "→" } as const;
type RegenerationAction = keyof typeof REGENERATION_LABELS;
type Action = RegenerationAction | "fallback";
export type FastRegenerationDecline = "unavailable" | "newer-messages";

export interface FastRegenerationRequest {
  action: RegenerationAction;
  replyId: string;
  messageIds: readonly string[];
  relatedDeliveryIds: ReadonlySet<string>;
  consume(): boolean;
  onDecline?(reason: FastRegenerationDecline): void;
}

interface ControlSurface {
  messageId: string;
  reply: Message;
  remove(): Promise<unknown>;
}

interface ReplyControls {
  postContext: PersonaPostContext;
  locale: string;
  botUserId: string | undefined;
  replyId: string;
  trigger: Message;
  userId: string;
  personaId: number | undefined;
  messageIds: string[];
  relatedDeliveryIds: Set<string>;
  actions: readonly Action[];
  fallback?: FallbackNotice;
  surface?: ControlSurface;
  visible: boolean;
  historyRevision: number;
  publication: Promise<void>;
}

const replyControlsByChannel = new Map<string, ReplyControls>();

async function isLatestReply(
  channel: Pick<PersonaPostContext["channel"] | Message["channel"], "messages">,
  replyId: string,
  relatedIds: ReadonlySet<string>,
) {
  const latest = await channel.messages.fetch({
    limit: Math.min(MAX_MESSAGE_FETCH_LIMIT, relatedIds.size + 1),
    cache: false,
  });
  return latest.find((message) => !relatedIds.has(message.id))?.id === replyId;
}

function setControlsVisible(entry: ReplyControls, visible: boolean): Promise<void> {
  if (entry.visible === visible) return entry.publication;
  entry.visible = visible;
  if (visible) entry.surface = undefined;
  entry.publication = entry.publication
    .then(async () => {
      if (visible) entry.surface = await publishControls(entry);
      else await entry.surface?.remove();
    })
    .catch((error) => {
      if (!(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage)) {
        log.warn(
          `[fastRegeneration] Could not ${visible ? "add" : "remove"} controls for messageId=${entry.replyId}`,
          error,
        );
      }
    });
  return entry.publication;
}

function removeControls(channelId: string, entry: ReplyControls): boolean {
  if (replyControlsByChannel.get(channelId) !== entry) return false;
  replyControlsByChannel.delete(channelId);
  void setControlsVisible(entry, false);
  return true;
}

export function clearReplyControls(channelId: string): void {
  const entry = replyControlsByChannel.get(channelId);
  if (entry) removeControls(channelId, entry);
}

async function reconcileLatestReply(entry: ReplyControls): Promise<void> {
  const { channel } = entry.postContext;
  const revision = ++entry.historyRevision;
  await entry.publication;
  if (entry.historyRevision !== revision || replyControlsByChannel.get(channel.id) !== entry) return;
  const relatedIds = new Set(entry.relatedDeliveryIds);
  if (entry.surface) relatedIds.add(entry.surface.messageId);
  try {
    const visible = await isLatestReply(channel, entry.replyId, relatedIds);
    if (entry.historyRevision === revision && replyControlsByChannel.get(channel.id) === entry) {
      await setControlsVisible(entry, visible);
    }
  } catch (error) {
    log.warn(`[fastRegeneration] Could not check channel history for messageId=${entry.replyId}`, error);
  }
}

export function observeReplyControlMessage(message: Message): void {
  const entry = replyControlsByChannel.get(message.channelId);
  if (
    !entry ||
    message.flags.has(MessageFlags.Ephemeral) ||
    BigInt(message.id) <= BigInt(entry.replyId) ||
    entry.relatedDeliveryIds.has(message.id) ||
    message.id === entry.surface?.messageId ||
    isReplyControlMessage(message, entry.botUserId)
  )
    return;

  entry.historyRevision++;
  void setControlsVisible(entry, false);
}

export async function observeReplyControlDeletions(channelId: string, messageIds: Iterable<string>): Promise<void> {
  const entry = replyControlsByChannel.get(channelId);
  if (!entry) return;
  let removedNewerMessage = false;
  for (const id of messageIds) {
    if (entry.messageIds.includes(id)) {
      removeControls(channelId, entry);
      return;
    }
    if (id !== entry.surface?.messageId && BigInt(id) > BigInt(entry.replyId)) removedNewerMessage = true;
  }
  if (removedNewerMessage) await reconcileLatestReply(entry);
}

export function resolveFallbackDetails(channelId: string, messageId: string): FallbackNotice | undefined {
  const entry = replyControlsByChannel.get(channelId);
  return entry?.visible && entry.surface?.messageId === messageId ? entry.fallback : undefined;
}

export function resolveFastRegeneration(
  channelId: string,
  controlsMessageId: string,
  userId: string,
  action: RegenerationAction,
):
  | { status: "denied" | "stale" }
  | { status: "ready"; trigger: Message; reply: Message; personaId: number; request: FastRegenerationRequest } {
  const entry = replyControlsByChannel.get(channelId);
  const surface = entry?.surface;
  if (
    !entry?.visible ||
    surface?.messageId !== controlsMessageId ||
    entry.personaId === undefined ||
    !entry.actions.includes(action)
  ) {
    return { status: "stale" };
  }
  if (entry.userId !== userId) return { status: "denied" };
  const relatedDeliveryIds = new Set(entry.relatedDeliveryIds);
  relatedDeliveryIds.add(surface.messageId);
  return {
    status: "ready",
    trigger: entry.trigger,
    reply: surface.reply,
    personaId: entry.personaId,
    request: {
      action,
      replyId: entry.replyId,
      messageIds: entry.messageIds,
      relatedDeliveryIds,
      consume: () => entry.visible && entry.surface === surface && removeControls(channelId, entry),
    },
  };
}

async function publishControls(entry: ReplyControls): Promise<ControlSurface | undefined> {
  const { channel } = entry.postContext;
  const isCurrent = () => entry.visible && replyControlsByChannel.get(channel.id) === entry;
  if (!isCurrent()) return;
  const guildId = entry.trigger.guildId;
  const assertOwned = captureDiscordOwnership(guildId ?? channel.id, !guildId);
  const reply = await channel.messages.fetch({ message: entry.replyId, cache: false, force: true });
  if (!isCurrent()) return;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    entry.actions.map((action) =>
      new ButtonBuilder()
        .setCustomId(buildInteractionRouteId(REPLY_CONTROLS_NAMESPACE, REPLY_CONTROLS_VERSION, action, entry.locale))
        .setLabel(
          action === "fallback"
            ? localizer(entry.locale, "genai.fallback_used_details_button")
            : REGENERATION_LABELS[action],
        )
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  const outcome = await sendPersonaPost(
    {
      ...entry.postContext,
      isExecutionCancelled: () => {
        assertOwned();
        return !isCurrent();
      },
    },
    { components: [row] },
  );
  if (outcome.status === "sent") {
    const { message, webhook } = outcome;
    return {
      messageId: message.id,
      reply,
      remove: () => {
        assertOwned();
        return webhook
          ? webhook.deleteMessage(message.id, channel.isThread() ? channel.id : undefined)
          : message.delete();
      },
    };
  }

  if (!reply.webhookId || outcome.status === "unconfirmed" || !isCurrent()) return;
  const controlsMessage = await sendChannelMessageOnce(
    channel,
    {
      reply: { messageReference: reply.id, failIfNotExists: true },
      components: [row],
      allowedMentions: { repliedUser: false },
    },
    () => {
      assertOwned();
      if (!isCurrent()) throw new DOMException("Reply controls were superseded", "AbortError");
    },
  );
  return {
    messageId: controlsMessage.id,
    reply,
    remove: () => {
      assertOwned();
      return controlsMessage.delete();
    },
  };
}

export async function offerFastRegeneration(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  const refs = context.streamingContext?.deliveredMessageRefs ?? [];
  const reply = refs.at(-1);
  if (!reply || refs.some((ref) => ref.channelId !== context.channel.id) || context.isUserImpersonation) return;

  const { channel, message, userDiscId, currentPersona } = context;
  const previous = replyControlsByChannel.get(channel.id);
  if (previous) {
    if (BigInt(previous.replyId) >= BigInt(reply.messageId)) return;
    removeControls(channel.id, previous);
  }

  if (result.status !== "completed" || !channel.isSendable() || channel.partial) return;
  const receipts = context.streamingContext.deliveryReceipts ?? [];
  const delivery = receipts.find((receipt) => receipt.messageId === reply.messageId);
  if (!delivery) return;

  const incoming = context.turn.lockedTurn.admission.incoming;
  const personaId = currentPersona.persona_id;
  const canRegenerate =
    result.personaResponses.length > 0 &&
    Boolean(message.guildId) &&
    personaId !== undefined &&
    incoming.textQuotaSource === "user" &&
    !incoming.isPersonaJob &&
    !incoming.isUserImpersonation &&
    !incoming.isStopResponse &&
    !incoming.naturalNudge &&
    !incoming.sceneTurn &&
    !incoming.reminderRecipientID &&
    !incoming.reminderData &&
    !incoming.borrowsTriggerMessage &&
    (incoming.manualTriggerInvoker || (!message.author.bot && message.author.id === userDiscId));

  const config = currentPersona.config;
  const actions: Action[] = [];
  if (canRegenerate && config.fast_regeneration_retry_enabled) actions.push("retry");
  if (canRegenerate && config.fast_regeneration_continue_enabled) actions.push("continue");
  if (result.fallbackNotice) actions.push("fallback");
  if (actions.length === 0) return;

  const messageIds = [...new Set(refs.map((ref) => ref.messageId))];
  const entry: ReplyControls = {
    postContext: {
      channel,
      persona: currentPersona,
      deliveryMode: context.streamingContext.deliveryMode,
      webhook: context.responseTarget?.webhook,
      followupTo: delivery,
    },
    locale: context.locale,
    botUserId: context.client.user?.id,
    replyId: reply.messageId,
    trigger: message,
    userId: userDiscId,
    personaId,
    messageIds,
    relatedDeliveryIds: new Set(
      receipts
        .filter((receipt) => receipt.channelId === channel.id && BigInt(receipt.messageId) > BigInt(reply.messageId))
        .map((receipt) => receipt.messageId),
    ),
    actions,
    fallback: result.fallbackNotice,
    visible: false,
    historyRevision: 0,
    publication: Promise.resolve(),
  };
  replyControlsByChannel.set(channel.id, entry);
  await reconcileLatestReply(entry);
}

export async function prepareFastRegeneration(
  turn: ChatTurn,
  request: FastRegenerationRequest,
): Promise<"ready" | FastRegenerationDecline> {
  const { client, channel, guild } = turn.lockedTurn.admission;
  const signal = getChannelTurnAbortSignal(channel.id);
  if (!guild || signal?.aborted) return "unavailable";
  const releaseDeletion = request.action === "retry" ? tryAcquirePersonaTurnDeletion(channel.id) : undefined;
  if (request.action === "retry" && !releaseDeletion) return "unavailable";
  try {
    const state = await getCachedMainPersona(guild.id);
    if (request.action === "continue") {
      if (!state?.config.fast_regeneration_continue_enabled) return "unavailable";
      if (!(await isLatestReply(channel, request.replyId, request.relatedDeliveryIds))) return "newer-messages";
      return !signal?.aborted && request.consume() ? "ready" : "unavailable";
    }
    if (!state?.config.fast_regeneration_retry_enabled) return "unavailable";

    const messages = await Promise.all(
      request.messageIds.map((message) => channel.messages.fetch({ message, cache: false, force: true })),
    );
    await Promise.all(messages.map(verifyMessageWebhook));
    const { blockMessages } = findLastPersonaTurnBlock({
      messages,
      allPersonas: turn.allPersonas,
      clientUserId: client.user?.id,
      targetPersonaId: turn.persona.persona_id,
    });
    if (blockMessages.length !== messages.length) return "unavailable";
    const botMember = guild.members.me;
    const canManageMessages = Boolean(
      botMember && "permissionsFor" in channel && channel.permissionsFor(botMember)?.has("ManageMessages"),
    );
    if (signal?.aborted || (!canManageMessages && blockMessages.some((message) => !message.webhookId)))
      return "unavailable";
    if (!(await isLatestReply(channel, request.replyId, request.relatedDeliveryIds))) return "newer-messages";
    if (signal?.aborted || !request.consume()) return "unavailable";
    const { failedCount } = await deletePersonaTurnMessages(channel, blockMessages, canManageMessages, signal);
    return failedCount === 0 ? "ready" : "unavailable";
  } catch (error) {
    log.warn(`[fastRegeneration] Could not prepare ${request.action} for messageId=${request.replyId}`, error);
    return "unavailable";
  } finally {
    releaseDeletion?.();
  }
}
