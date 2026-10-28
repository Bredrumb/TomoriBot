import { invalidateWebhookCache } from "@/utils/discord/webhook/cache";
import type {
  BaseGuildTextChannel,
  Message,
  MessageCreateOptions,
  Webhook,
  WebhookMessageCreateOptions,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { SpriteMessageRecordInfo } from "@/types/stream/types";
import {
  commitPersonaAppearance,
  getPersonaAppearance,
  invalidatePersonaAppearance,
} from "@/utils/cache/personaAppearanceCacheStore";
import { getCachedPersonaSprites } from "@/utils/cache/personaSpriteCache";
import { recordPersonaSpriteMessage } from "@/utils/cache/personaSpriteMessageCache";
import {
  type DeliveredSpeaker,
  getAdjacentPersonaIdentity,
  recordChannelDeliveredBotMessage,
  recordChannelDeliveredWebhookIdentity,
  resolveChannelBaseAppearanceIdentity,
  resolveChannelGroupBreakIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import { resolveSpriteIdentity } from "@/utils/discord/renderModifierResolver";
import { formatRenderModifierWebhookName } from "@/utils/discord/renderModifierParser";
import type { SendableChannel } from "@/utils/discord/resolveSendableChannel";
import {
  GENERIC_WEBHOOK_AVATAR_URL,
  resolvePersonaWebhookIdentity,
  type ResolvedWebhookIdentity,
} from "@/utils/discord/webhook/identity";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { resolveManagedWebhookForChannel } from "@/utils/discord/webhook/fallback";
import { buildWebhookReplyNoticePayload } from "@/utils/discord/webhookReply";
import { dispatchWebhookWithIdentity } from "@/utils/discord/webhook/personaDispatch";
import { sendChannelMessageOnce, sendSelectedWebhookMessageOnce } from "@/utils/discord/webhook/singleAttemptMessage";
import {
  classifyDiscordDeliveryFailure,
  isInvalidWebhookError,
  DiscordDeliveryError,
  type DiscordDeliveryFailureKind,
} from "@/utils/discord/webhook/deliveryOutcome";
import { log } from "@/utils/misc/logger";

export type PersonaDeliveryMode = "persona" | "user_impersonation";

export interface PersonaDeliveryReceipt {
  messageId: string;
  channelId: string;
  route: "bot" | "webhook";
  webhookId: string | null;
  identity: ResolvedWebhookIdentity;
  speaker: DeliveredSpeaker | null;
  sprite?: SpriteMessageRecordInfo;
  serverDiscId?: string;
}

export interface PersonaPostContext {
  channel: SendableChannel;
  persona: TomoriState;
  deliveryMode?: PersonaDeliveryMode;
  webhook?: Webhook;
  impersonatedIdentity?: ResolvedWebhookIdentity;
  abortSignal?: AbortSignal;
  isExecutionCancelled?: () => boolean;
  holdResponseText?: boolean;
  replyToMessage?: Message;
  locale?: string;
  replyNoticeState?: { attempted: boolean; sent: boolean };
  deliveryReceipts?: PersonaDeliveryReceipt[];
  deliveryState?: { unconfirmed: boolean };
}

export interface PersonaPostAuthor {
  route: "bot" | "webhook";
  webhook?: Webhook;
  identity: ResolvedWebhookIdentity;
  speaker: DeliveredSpeaker;
  sprite?: SpriteMessageRecordInfo;
}

export type PersonaPostOutcome =
  | { status: "sent"; message: Message; receipt: PersonaDeliveryReceipt }
  | { status: DiscordDeliveryFailureKind; error: unknown };

interface PersonaPostChannel {
  id: string;
  lastMessageId: string | null;
}

export function recordPersonaDelivery(receipt: PersonaDeliveryReceipt): void {
  if (receipt.route === "webhook" && receipt.webhookId) {
    recordChannelDeliveredWebhookIdentity(
      receipt.channelId,
      receipt.identity,
      receipt.messageId,
      receipt.speaker,
      receipt.webhookId,
    );
  } else {
    recordChannelDeliveredBotMessage(receipt.channelId, receipt.speaker);
  }
  const personaId = receipt.speaker?.personaId;
  if (
    personaId != null &&
    receipt.speaker?.kind !== "copied" &&
    (receipt.speaker?.kind !== "identity_sprite" || receipt.sprite)
  ) {
    commitPersonaAppearance({
      channelId: receipt.channelId,
      personaId,
      serverDiscId: receipt.serverDiscId ?? getPersonaAppearance(receipt.channelId, personaId)?.serverDiscId,
      sprite: receipt.sprite,
      genericAvatar: receipt.identity.avatarUrl === GENERIC_WEBHOOK_AVATAR_URL,
    });
  }
  if (receipt.route === "webhook" && receipt.sprite) {
    void recordPersonaSpriteMessage({
      messageDiscId: receipt.messageId,
      personaId: receipt.sprite.personaId,
      spriteName: receipt.sprite.spriteName,
      channelDiscId: receipt.channelId,
    }).catch((error) => log.warn("Failed to record persona post sprite mapping", error));
  }
}

async function resolveOwnAppearance(
  channel: PersonaPostChannel,
  baseIdentity: ResolvedWebhookIdentity & { username: string },
  personaId?: number,
): Promise<{ identity: ResolvedWebhookIdentity; sprite?: SpriteMessageRecordInfo }> {
  const remembered = personaId == null ? undefined : getPersonaAppearance(channel.id, personaId);
  const adjacent = getAdjacentPersonaIdentity(channel.id, personaId ?? null, channel.lastMessageId);
  if (remembered && adjacent) return { identity: adjacent, sprite: remembered.sprite };
  if (!remembered?.sprite) {
    const identity = remembered?.genericAvatar
      ? { username: baseIdentity.username, avatarUrl: GENERIC_WEBHOOK_AVATAR_URL }
      : baseIdentity;
    return {
      identity: resolveChannelBaseAppearanceIdentity(
        channel.id,
        identity,
        baseIdentity.username,
        channel.lastMessageId,
      ),
    };
  }
  const sprites = await getCachedPersonaSprites(remembered.personaId);
  const sprite = sprites.find((candidate) => candidate.sprite_name === remembered.sprite?.spriteName);
  if (!sprite) {
    invalidatePersonaAppearance(remembered.personaId);
    return {
      identity: resolveChannelBaseAppearanceIdentity(
        channel.id,
        baseIdentity,
        baseIdentity.username,
        channel.lastMessageId,
      ),
    };
  }
  const username = sprite.is_identity
    ? formatRenderModifierWebhookName(sprite.sprite_name, baseIdentity.username)
    : baseIdentity.username;
  let identity = await resolveSpriteIdentity(sprite, username);
  if (!identity)
    return {
      identity: resolveChannelBaseAppearanceIdentity(
        channel.id,
        baseIdentity,
        baseIdentity.username,
        channel.lastMessageId,
      ),
    };
  if (remembered.genericAvatar) identity = { username, avatarUrl: GENERIC_WEBHOOK_AVATAR_URL };
  if (!sprite.is_identity) {
    identity = resolveChannelGroupBreakIdentity(
      channel.id,
      identity,
      formatRenderModifierWebhookName(baseIdentity.username, sprite.sprite_name),
      sprite.sprite_name,
      channel.lastMessageId,
    );
  }
  return {
    identity,
    sprite: { personaId: remembered.personaId, spriteName: sprite.sprite_name, isIdentity: sprite.is_identity },
  };
}

export async function resolvePersonaPostAuthor(context: PersonaPostContext): Promise<PersonaPostAuthor> {
  const personaId = context.persona.persona_id ?? null;
  if (context.deliveryMode === "user_impersonation") {
    if (!context.webhook || !context.impersonatedIdentity)
      throw new DiscordDeliveryError(
        "pre_dispatch",
        new Error("User impersonation requires an explicit webhook identity"),
      );
    const parentId = context.channel.isThread() ? context.channel.parentId : context.channel.id;
    if (context.webhook.channelId !== parentId)
      throw new DiscordDeliveryError("pre_dispatch", new Error("Impersonation webhook belongs to another destination"));
    return {
      route: "webhook",
      webhook: context.webhook,
      identity: context.impersonatedIdentity,
      speaker: { personaId, kind: "copied" },
    };
  }
  const guild = "guild" in context.channel ? context.channel.guild : null;
  const base = await resolvePersonaWebhookIdentity(context.persona, guild);
  const own = await resolveOwnAppearance(
    context.channel,
    { ...base, username: base.username ?? context.persona.persona_nickname },
    personaId ?? undefined,
  );
  const speaker: DeliveredSpeaker = { personaId, kind: own.sprite?.isIdentity ? "identity_sprite" : "appearance" };
  if (!context.persona.is_alter && !own.sprite && own.identity.avatarUrl !== GENERIC_WEBHOOK_AVATAR_URL)
    return { route: "bot", identity: base, speaker };
  const parent = context.channel.isThread() ? context.channel.parent : context.channel;
  if (!parent || !("fetchWebhooks" in parent) || !("createWebhook" in parent)) {
    if (!context.persona.is_alter) return { route: "bot", identity: base, speaker: { personaId, kind: "appearance" } };
    throw new DiscordDeliveryError("pre_dispatch", new Error("Destination does not support persona webhooks"));
  }
  const webhook =
    (context.webhook
      ? await resolveManagedWebhookForChannel(parent as BaseGuildTextChannel, context.webhook.id)
      : null) ?? (await getOrCreateWebhook(parent as BaseGuildTextChannel)).webhook;
  if (!webhook) throw new DiscordDeliveryError("pre_dispatch", new Error("Persona webhook unavailable"));
  return { route: "webhook", webhook, identity: own.identity, speaker, sprite: own.sprite };
}

function assertCanDispatch(context: PersonaPostContext): void {
  if (
    context.deliveryState?.unconfirmed ||
    context.holdResponseText ||
    context.abortSignal?.aborted ||
    context.isExecutionCancelled?.()
  )
    throw new DiscordDeliveryError("pre_dispatch", new Error("Persona delivery withheld or cancelled"));
}

export type PersonaPostPayload = Omit<
  MessageCreateOptions & WebhookMessageCreateOptions,
  "username" | "avatarURL" | "threadId"
>;

export async function sendPersonaPost(
  context: PersonaPostContext,
  payload: PersonaPostPayload,
): Promise<PersonaPostOutcome> {
  return sendPersonaPostAttempt(
    { ...context, replyNoticeState: context.replyNoticeState ?? { attempted: false, sent: false } },
    payload,
    true,
  );
}

async function sendPersonaPostAttempt(
  context: PersonaPostContext,
  payload: PersonaPostPayload,
  recoverInvalidWebhook: boolean,
): Promise<PersonaPostOutcome> {
  let dispatched = false;
  try {
    assertCanDispatch(context);
    const author = await resolvePersonaPostAuthor(context);
    let message: Message;
    let identity = author.identity;
    let webhookId: string | null = null;
    const threadId = context.channel.isThread() ? context.channel.id : undefined;
    const allowedMentions = payload.allowedMentions ?? { parse: [], repliedUser: false };
    const serverDiscId = "guildId" in context.channel ? context.channel.guildId : undefined;
    if (author.route === "webhook" && author.webhook) {
      const notice =
        context.replyToMessage && context.deliveryMode !== "user_impersonation" && !context.replyNoticeState?.attempted
          ? await buildWebhookReplyNoticePayload(context.replyToMessage, context.locale ?? "en-US", {
              threadId,
              botUserId: context.channel.client.user?.id,
              botName: context.persona.persona_nickname,
            })
          : undefined;
      const delivery = await dispatchWebhookWithIdentity(author.webhook, identity, async (selected) => {
        assertCanDispatch(context);
        let noticeMessage: Message | undefined;
        if (notice) {
          if (context.replyNoticeState) context.replyNoticeState.attempted = true;
          dispatched = true;
          const posted = await sendSelectedWebhookMessageOnce(selected, notice, () => assertCanDispatch(context));
          noticeMessage = posted;
          const receipt: PersonaDeliveryReceipt = {
            messageId: posted.id,
            channelId: posted.channelId,
            route: "webhook",
            webhookId: selected.webhookId,
            identity: selected.identity,
            speaker: author.speaker,
            sprite: author.sprite,
            serverDiscId,
          };
          recordPersonaDelivery(receipt);
          context.deliveryReceipts?.push(receipt);
          if (context.replyNoticeState) context.replyNoticeState.sent = true;
        }
        assertCanDispatch(context);
        dispatched = true;
        const { reply: _reply, ...webhookPayload } = payload;
        try {
          return await sendSelectedWebhookMessageOnce(selected, { ...webhookPayload, allowedMentions, threadId }, () =>
            assertCanDispatch(context),
          );
        } catch (error) {
          if (noticeMessage && classifyDiscordDeliveryFailure(error) === "definite_refusal") {
            await selected.webhook
              .deleteMessage(noticeMessage.id, threadId)
              .then(() => {
                if (context.replyNoticeState) {
                  context.replyNoticeState.attempted = false;
                  context.replyNoticeState.sent = false;
                }
              })
              .catch(() => undefined);
          }
          throw error;
        }
      });
      message = delivery.result;
      identity = delivery.identity;
      webhookId = delivery.webhookId;
    } else {
      assertCanDispatch(context);
      dispatched = true;
      const reply =
        payload.reply ??
        (context.replyToMessage?.channelId === context.channel.id
          ? { messageReference: context.replyToMessage.id, failIfNotExists: false }
          : undefined);
      message = await sendChannelMessageOnce(context.channel, { ...payload, allowedMentions, reply }, () =>
        assertCanDispatch(context),
      );
      identity = {
        username: message.member?.displayName ?? message.author?.username,
        avatarUrl: message.member?.displayAvatarURL?.() ?? message.author?.displayAvatarURL?.(),
      };
    }
    const receipt: PersonaDeliveryReceipt = {
      messageId: message.id,
      channelId: message.channelId,
      route: author.route,
      webhookId,
      identity,
      speaker: author.speaker,
      sprite: author.sprite,
      serverDiscId,
    };
    recordPersonaDelivery(receipt);
    context.deliveryReceipts?.push(receipt);
    return { status: "sent", message, receipt };
  } catch (error) {
    const status = dispatched ? classifyDiscordDeliveryFailure(error) : "pre_dispatch";
    if (
      recoverInvalidWebhook &&
      status === "definite_refusal" &&
      isInvalidWebhookError(error) &&
      context.deliveryMode !== "user_impersonation"
    ) {
      const parentId = context.channel.isThread() ? context.channel.parentId : context.channel.id;
      if (parentId) {
        invalidateWebhookCache(parentId);
        if (context.replyNoticeState && !context.replyNoticeState.sent) context.replyNoticeState.attempted = false;
        return sendPersonaPostAttempt({ ...context, webhook: undefined }, payload, false);
      }
    }
    if (status === "unconfirmed" && context.deliveryState) context.deliveryState.unconfirmed = true;
    log.warn("Persona post was not confirmed", {
      outcome: status,
      channelId: context.channel.id,
      code: (error as { code?: number | string } | null)?.code,
    });
    return { status, error };
  }
}
