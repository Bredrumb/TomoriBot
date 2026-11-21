import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  DiscordAPIError,
  RESTJSONErrorCodes,
  type Message,
  type MessageEditOptions,
} from "discord.js";
import type { ChatTurn, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { getChannelTurnAbortSignal } from "@/utils/chat/channelQueue";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { getCachedMainPersona } from "@/utils/cache/tomoriStateCache";
import { findLastPersonaTurnBlock } from "@/utils/discord/personaTurnDetection";
import { deletePersonaTurnMessages, tryAcquirePersonaTurnDeletion } from "@/utils/discord/personaTurnDeletion";
import { log } from "@/utils/misc/logger";

import { buildInteractionRouteId } from "@/utils/discord/interactions/routeRegistry";
import { MAX_MESSAGE_FETCH_LIMIT } from "@/utils/discord/messageFetchLimit";
import { resolveAuthoringWebhook } from "@/utils/discord/webhook/fallback";
import { captureDiscordOwnership } from "@/utils/discord/webhook/webhookCore";
import { sendChannelMessageOnce } from "@/utils/discord/webhook/singleAttemptMessage";

export const REPLY_CONTROLS_NAMESPACE = "reply-controls";
export const REPLY_CONTROLS_VERSION = "v1";
const ACTIONS = ["retry", "continue"] as const;
type Action = (typeof ACTIONS)[number];
export type FastRegenerationDecline = "unavailable" | "newer-messages";

export interface FastRegenerationRequest {
  action: Action;
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
  replyId: string;
  trigger: Message;
  userId: string;
  personaId: number;
  messageIds: string[];
  relatedDeliveryIds: string[];
  actions: readonly Action[];
  publication: Promise<ControlSurface | undefined>;
}

const replyControlsByChannel = new Map<string, ReplyControls>();

function removeControls(channelId: string, entry: ReplyControls): boolean {
  if (replyControlsByChannel.get(channelId) !== entry) return false;
  replyControlsByChannel.delete(channelId);
  void entry.publication
    .then((surface) => surface?.remove())
    .catch((error) => {
      if (!(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage)) {
        log.warn(`[fastRegeneration] Could not remove controls for messageId=${entry.replyId}`, error);
      }
    });
  return true;
}

export async function resolveFastRegeneration(
  channelId: string,
  controlsMessageId: string,
  userId: string,
  action: Action,
): Promise<
  | { status: "denied" | "stale" }
  | { status: "ready"; trigger: Message; reply: Message; personaId: number; request: FastRegenerationRequest }
> {
  const entry = replyControlsByChannel.get(channelId);
  if (!entry?.actions.includes(action)) return { status: "stale" };
  const surface = await entry.publication;
  if (surface?.messageId !== controlsMessageId || replyControlsByChannel.get(channelId) !== entry) {
    return { status: "stale" };
  }
  if (entry.userId !== userId) return { status: "denied" };
  const relatedDeliveryIds = new Set(entry.relatedDeliveryIds);
  if (surface.messageId !== entry.replyId) relatedDeliveryIds.add(surface.messageId);
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
      consume: () => removeControls(channelId, entry),
    },
  };
}

async function publishControls(context: ChatTurnContext, entry: ReplyControls): Promise<ControlSurface | undefined> {
  const { channel, locale } = context;
  const assertOwned = captureDiscordOwnership(context.message.guildId);
  const reply = await channel.messages.fetch(entry.replyId);
  const isCurrent = () => replyControlsByChannel.get(channel.id) === entry;
  if (!isCurrent()) return;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    entry.actions.map((action) =>
      new ButtonBuilder()
        .setCustomId(buildInteractionRouteId(REPLY_CONTROLS_NAMESPACE, REPLY_CONTROLS_VERSION, action, locale))
        .setLabel(action === "retry" ? "↻" : "→")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  const ownsRow = (component: Message["components"][number]) =>
    component.type === ComponentType.ActionRow &&
    component.components.some((child) => child.customId?.startsWith(`${REPLY_CONTROLS_NAMESPACE}:`));
  const existing = reply.components.filter((component) => !ownsRow(component));

  let edit: ((components: NonNullable<MessageEditOptions["components"]>) => Promise<Message>) | undefined;
  if (reply.webhookId) {
    const author = await resolveAuthoringWebhook(channel, reply.webhookId, context.responseTarget?.webhook);
    if (author && (!author.applicationId || author.applicationId === context.client.user?.id)) {
      edit = (components) =>
        author.editMessage(reply.id, {
          components,
          withComponents: true,
          ...(channel.isThread() ? { threadId: channel.id } : {}),
        });
    }
  } else if (reply.author.id === context.client.user?.id) {
    edit = (components) => reply.edit({ components });
  }

  if (!isCurrent()) return;
  if (edit) {
    const editReply = edit;
    try {
      assertOwned();
      const edited = await editReply([...existing, row]);
      if (edited.components.some(ownsRow)) {
        return {
          messageId: reply.id,
          reply,
          remove: async () => {
            const current = await channel.messages.fetch({ message: reply.id, cache: false, force: true });
            const remaining = current.components.filter((component) => !ownsRow(component));
            if (remaining.length === current.components.length) return;
            assertOwned();
            await editReply(remaining);
          },
        };
      }
    } catch (error) {
      if (
        !reply.webhookId ||
        !(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.InvalidFormBodyOrContentType)
      )
        throw error;
    }
  }

  if (channel.isDMBased() || !channel.isSendable() || !isCurrent()) return;
  const controlsMessage = await sendChannelMessageOnce(
    channel,
    {
      reply: { messageReference: reply.id, failIfNotExists: true },
      components: [row],
      allowedMentions: { repliedUser: false },
    },
    () => {
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

  const incoming = context.turn.lockedTurn.admission.incoming;
  const personaId = currentPersona.persona_id;
  if (
    result.status !== "completed" ||
    result.personaResponses.length === 0 ||
    !message.guildId ||
    personaId === undefined ||
    incoming.textQuotaSource !== "user" ||
    incoming.isPersonaJob ||
    incoming.isUserImpersonation ||
    incoming.isStopResponse ||
    incoming.naturalNudge ||
    incoming.sceneTurn ||
    incoming.reminderRecipientID ||
    incoming.reminderData ||
    incoming.borrowsTriggerMessage ||
    (!incoming.manualTriggerInvoker && (message.author.bot || message.author.id !== userDiscId))
  )
    return;

  const config = currentPersona.config;
  const actions = ACTIONS.filter((action) =>
    action === "retry" ? config.fast_regeneration_retry_enabled : config.fast_regeneration_continue_enabled,
  );
  if (actions.length === 0) return;

  const messageIds = [...new Set(refs.map((ref) => ref.messageId))];
  const entry: ReplyControls = {
    replyId: reply.messageId,
    trigger: message,
    userId: userDiscId,
    personaId,
    messageIds,
    relatedDeliveryIds: (context.streamingContext.deliveryReceipts ?? [])
      .filter((receipt) => receipt.channelId === channel.id && BigInt(receipt.messageId) > BigInt(reply.messageId))
      .map((receipt) => receipt.messageId),
    actions,
    publication: Promise.resolve()
      .then(() => publishControls(context, entry))
      .catch((error) => {
        if (replyControlsByChannel.get(channel.id) === entry) {
          log.warn(`[fastRegeneration] Could not add controls to messageId=${reply.messageId}`, error);
        }
        return undefined;
      }),
  };
  replyControlsByChannel.set(channel.id, entry);
  if (!(await entry.publication) && replyControlsByChannel.get(channel.id) === entry) {
    removeControls(channel.id, entry);
  }
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
      await channel.messages.fetch({ message: request.replyId, cache: false, force: true });
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
    const latest = await channel.messages.fetch({
      limit: Math.min(MAX_MESSAGE_FETCH_LIMIT, request.relatedDeliveryIds.size + 1),
      cache: false,
    });
    if (latest.find((message) => !request.relatedDeliveryIds.has(message.id))?.id !== request.replyId) {
      return "newer-messages";
    }
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
