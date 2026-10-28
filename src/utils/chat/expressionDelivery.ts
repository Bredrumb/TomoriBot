import type { SendableChannel } from "@/utils/discord/resolveSendableChannel";
import {
  AttachmentBuilder,
  DiscordAPIError,
  type Message,
  type MessageCreateOptions,
  type Sticker,
  type Webhook,
} from "discord.js";
import type { StickerSelection } from "@/types/discord/stickerSelection";
import type { ToolResult } from "@/types/tool/interfaces";
import type { ChatTurnContext } from "@/utils/chat/types";
import { statRepository } from "@/utils/db/repositories";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { isStickerUnusableError, markStickerRejected } from "@/utils/discord/stickerAvailability";
import { customExpressionIsEligible, nativeStickerIsEligible } from "@/utils/discord/stickerCandidates";
import {
  recordPersonaDelivery,
  resolvePersonaPostAuthor,
  type PersonaPostAuthor,
} from "@/utils/discord/webhook/personaPost";
import { buildChatPersonaPostContext } from "@/utils/chat/responseEmitter";
import { sendChannelMessageOnce } from "@/utils/discord/webhook/singleAttemptMessage";
import { classifyDiscordDeliveryFailure, DiscordDeliveryError } from "@/utils/discord/webhook/deliveryOutcome";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { sendWebhookMessageOnce } from "@/utils/discord/webhook/webhookCore";
import { log } from "@/utils/misc/logger";
import { EXPRESSION_MEDIA_MAX_BYTES } from "@/utils/storage/expressionMedia";
import { loadExpressionMedia } from "@/utils/storage/expressionStorage";

/** Discord acceptance of one expression message. Internal only: the model sees the name alone. */
interface ExpressionDeliveryReceipt {
  /** Native sticker id or custom expression id, which is what a repeated call is compared by. */
  expressionKey: string;
  name: string;
  messageId: string;
}

/**
 * The one-expression-per-turn allowance. It lives on the persona turn rather than the stream state,
 * because the stream state is rebuilt for every SDK request and the allowance must survive tool-loop
 * continuations, context restarts, model fallbacks, and the empty-response retry.
 *
 * The single-expression ceiling is a product choice, not a Discord limit. A demonstrated need for
 * several distinct reactions in one reply is what would justify a bounded multi-delivery policy.
 */
export interface ExpressionDeliveryState {
  delivered: ExpressionDeliveryReceipt | null;
  /**
   * Set while a send is in flight and kept when Discord never confirmed the outcome. It blocks every
   * later send this turn, since the earlier message may already be visible and a resend would double it.
   */
  unconfirmedKey: string | null;
}

export type SettledExpressionDelivery =
  | { status: "delivered" | "already_delivered" | "limit_reached"; receipt: ExpressionDeliveryReceipt }
  | { status: "unconfirmed" | "unavailable" | "rejected" };

export type ExpressionDeliveryOutcome = SettledExpressionDelivery | { status: "cancelled" };

type PreparedExpression =
  | { kind: "native"; sticker: Sticker }
  | { kind: "custom"; serverId: number; id: string; payload: MessageCreateOptions };

type DeliveryRoute = PersonaPostAuthor & { reply: boolean };

/** A stop observed immediately before a POST, so nothing was posted. */
class ExpressionSendCancelled extends Error {}

/** The fields delivery reads from either transport's created message. */
type SentExpressionMessage = Pick<Message, "id" | "webhookId"> & { channelId?: string };

export function createExpressionDeliveryState(): ExpressionDeliveryState {
  return { delivered: null, unconfirmedKey: null };
}

/**
 * Sends the resolved expression as its own message and records the turn's receipt.
 *
 * Eligibility, whitelist, and stored media are rechecked here because
 * resolution happened earlier and an edit can land in between.
 *
 * @param isCancelled - Checked immediately before each outbound POST, after webhook resolution and any
 *   avatar update, so a stop raised while those are in flight prevents the send instead of racing it
 */
export async function deliverExpression(
  context: ChatTurnContext,
  selection: StickerSelection,
  name: string,
  isCancelled: () => boolean,
): Promise<ExpressionDeliveryOutcome> {
  const state = context.expressionDelivery;
  const expressionKey = selection.kind === "native" ? selection.sticker.id : selection.expressionId;
  if (state.delivered) {
    return {
      status: state.delivered.expressionKey === expressionKey ? "already_delivered" : "limit_reached",
      receipt: state.delivered,
    };
  }
  if (state.unconfirmedKey) return { status: "unconfirmed" };

  const prepared = await prepareExpression(context, selection);
  if (!prepared) return { status: "unavailable" };
  let route: DeliveryRoute;
  const assertNotCancelled = () => {
    if (
      isCancelled() ||
      context.streamingContext.abortSignal?.aborted ||
      context.streamingContext.deliveryState?.unconfirmed
    )
      throw new ExpressionSendCancelled();
  };

  state.unconfirmedKey = expressionKey;
  let message: SentExpressionMessage;
  let deliveredRoute: DeliveryRoute;
  try {
    assertNotCancelled();
    route = await resolveDeliveryRoute(context);
    assertNotCancelled();
    ({ message, route: deliveredRoute } = await sendPreparedExpression(context, prepared, route, assertNotCancelled));
  } catch (error) {
    if (!(error instanceof ExpressionSendCancelled)) return recordFailedSend(context, prepared, error);
    state.unconfirmedKey = null;
    return { status: "cancelled" };
  }

  state.unconfirmedKey = null;
  state.delivered = { expressionKey, name, messageId: message.id };
  recordDeliveryContinuity(context, deliveredRoute, message);
  recordExpressionUsage(context, prepared);
  log.info(`Delivered expression '${name}' at tool invocation (${deliveredRoute.route}).`);
  return { status: "delivered", receipt: state.delivered };
}

/**
 * Translates a delivery outcome into the tool result the model reads. Only the ordinary name and
 * the outcome are exposed: never the media kind, storage reference, source link, or ids.
 */
export function buildExpressionToolResult(outcome: SettledExpressionDelivery, requestedName: string): ToolResult {
  switch (outcome.status) {
    case "delivered":
      return {
        success: true,
        responseDelivered: true,
        message: "Sticker sent",
        data: {
          status: "sticker_sent",
          sticker_name: outcome.receipt.name,
          note: "The sticker is now posted as its own message after any text you already wrote. Continue your reply if you have more to say, without describing the sticker.",
        },
      };
    case "already_delivered":
      return {
        success: true,
        responseDelivered: true,
        message: "Sticker already sent",
        data: {
          status: "sticker_already_sent",
          sticker_name: outcome.receipt.name,
          note: "This sticker was already sent in this reply, so it was not sent again.",
        },
      };
    case "limit_reached":
      return {
        success: false,
        error: "Sticker limit reached",
        message: `This reply already sent the sticker "${outcome.receipt.name}". Only one sticker can be sent per reply, and the sent one cannot be replaced, so "${requestedName}" was not sent. Continue without another sticker.`,
      };
    case "unconfirmed":
      return {
        success: false,
        error: "Sticker delivery unconfirmed",
        message:
          "Discord did not confirm whether the sticker was sent, so it may already be visible. Do not call select_sticker_for_response again in this reply.",
      };
    case "unavailable":
      return {
        success: false,
        error: "Sticker unavailable",
        message: `"${requestedName}" can no longer be sent, so nothing was posted. Choose another sticker or continue without one.`,
      };
    case "rejected":
      return {
        success: false,
        error: "Sticker send rejected",
        message: `Discord rejected "${requestedName}", so nothing was posted. Choose another sticker or continue without one.`,
      };
  }
}

async function prepareExpression(
  context: ChatTurnContext,
  selection: StickerSelection,
): Promise<PreparedExpression | null> {
  if (selection.kind === "native") {
    const canUseExternal =
      !!context.client.user &&
      "permissionsFor" in context.channel &&
      !!context.channel.permissionsFor(context.client.user)?.has("UseExternalStickers");
    if (!context.guild || !nativeStickerIsEligible(selection.sticker, context.guild, canUseExternal)) return null;
    return { kind: "native", sticker: selection.sticker };
  }

  const { serverId, expressionId: id } = selection;
  const personaId = context.currentPersona.persona_id;
  if (context.isDMChannel || serverId !== context.tomoriState.server_id || !personaId) return null;
  try {
    const row = await serverRepository.loadCustomExpression(serverId, id);
    if (!row || !customExpressionIsEligible(row, personaId)) return null;
    const payload: MessageCreateOptions = { allowedMentions: { parse: [] } };
    if (row.delivery_kind === "link") {
      if (!row.original_link) return null;
      payload.content = row.original_link;
    } else {
      if (!row.storage_reference || !row.extension) return null;
      const buffer = await loadExpressionMedia(row.storage_reference, serverId, id);
      if (buffer.length !== row.byte_size || buffer.length > EXPRESSION_MEDIA_MAX_BYTES) {
        log.warn("Stored expression exceeds its validated delivery size", { serverId, metadata: { expressionId: id } });
        return null;
      }
      payload.files = [new AttachmentBuilder(buffer, { name: `expression-${id}.${row.extension}` })];
    }
    // Storage reads can outlive an edit or whitelist change, so the row is rechecked after them.
    const current = await serverRepository.loadCustomExpression(serverId, id);
    if (!current || current.revision !== row.revision || !customExpressionIsEligible(current, personaId)) return null;
    return { kind: "custom", serverId, id, payload };
  } catch (error) {
    log.warn("Custom expression preparation failed", {
      serverId,
      errorType: "CustomExpressionDeliveryError",
      metadata: { expressionId: id, errorName: error instanceof Error ? error.name : "unknown" },
    });
    return null;
  }
}

async function resolveDeliveryRoute(context: ChatTurnContext): Promise<DeliveryRoute> {
  let author: PersonaPostAuthor;
  try {
    author = await resolvePersonaPostAuthor(buildChatPersonaPostContext(context));
  } catch (error) {
    throw new DiscordDeliveryError("pre_dispatch", error);
  }
  const incoming = context.turn.lockedTurn.admission.incoming;
  return {
    ...author,
    reply:
      context.isFromQueue &&
      !incoming.sceneTurn &&
      !(context.streamingContext.deliveryReceipts?.length || context.streamingContext.deliveredMessageRefs?.length),
  };
}

async function sendPreparedExpression(
  context: ChatTurnContext,
  prepared: PreparedExpression,
  route: DeliveryRoute,
  beforePost: () => void,
): Promise<{ message: SentExpressionMessage; route: DeliveryRoute }> {
  if (route.route === "webhook" && route.webhook) {
    try {
      const message = await sendViaWebhook(context, route.webhook, prepared, route.identity, beforePost);
      return { message, route: { ...route, identity: message.identity } };
    } catch (error) {
      if (
        prepared.kind === "custom" ||
        !(error instanceof DiscordAPIError) ||
        classifyDiscordDeliveryFailure(error) !== "definite_refusal" ||
        route.speaker.kind === "copied"
      )
        throw error;
      log.warn("Webhook sticker send was rejected, falling back to a bot sticker send", {
        code: (error as { code?: unknown }).code,
      });
    }
  }
  beforePost();
  const message = await sendViaBot(context, prepared, route.reply, beforePost);
  return {
    message,
    route: {
      route: "bot",
      reply: route.reply,
      identity: {
        username: message.member?.displayName ?? message.author?.username,
        avatarUrl: message.member?.displayAvatarURL?.() ?? message.author?.displayAvatarURL?.(),
      },
      speaker: {
        personaId: context.currentPersona.is_alter ? null : (context.currentPersona.persona_id ?? null),
        kind: "appearance",
      },
    },
  };
}

function sendViaWebhook(
  context: ChatTurnContext,
  webhook: Webhook,
  prepared: PreparedExpression,
  identity: ResolvedWebhookIdentity,
  beforePost: () => void,
): ReturnType<typeof sendWebhookMessageOnce> {
  // Webhooks cannot attach native stickers, so a native sticker goes out as its media link.
  const payload = prepared.kind === "native" ? { content: prepared.sticker.url } : prepared.payload;
  return sendWebhookMessageOnce(
    webhook,
    {
      ...(payload.content ? { content: payload.content } : {}),
      ...(payload.files ? { files: payload.files } : {}),
      allowedMentions: { parse: [] },
      ...(context.channel.isThread() ? { threadId: context.channel.id } : {}),
    },
    identity,
    beforePost,
  );
}

async function sendViaBot(
  context: ChatTurnContext,
  prepared: PreparedExpression,
  reply: boolean,
  beforePost: () => void,
): Promise<Message> {
  const payload: MessageCreateOptions =
    prepared.kind === "native" ? { stickers: [prepared.sticker.id] } : { ...prepared.payload };
  payload.allowedMentions = { parse: [], repliedUser: false };
  if (reply) payload.reply = { messageReference: context.message.id, failIfNotExists: false };
  return sendChannelMessageOnce(context.channel as SendableChannel, payload, beforePost);
}

function recordFailedSend(
  context: ChatTurnContext,
  prepared: PreparedExpression,
  error: unknown,
): SettledExpressionDelivery {
  const unsendable = error instanceof DiscordDeliveryError && error.outcome === "pre_dispatch";
  const definite = unsendable || classifyDiscordDeliveryFailure(error) !== "unconfirmed";
  if (!definite && context.streamingContext.deliveryState) context.streamingContext.deliveryState.unconfirmed = true;
  if (definite) context.expressionDelivery.unconfirmedKey = null;
  const discordCode = error instanceof DiscordAPIError && typeof error.code === "number" ? error.code : undefined;
  if (prepared.kind === "native") {
    // A 50081 refusal is permanent for that sticker id, so retiring it stops the model reselecting it.
    if (isStickerUnusableError(error)) {
      markStickerRejected(prepared.sticker.id);
      log.warn(`Discord rejected sticker '${prepared.sticker.name}' (${prepared.sticker.id}) as unusable.`);
    } else {
      log.warn(`Sticker '${prepared.sticker.name}' was not delivered`, error);
    }
  } else {
    // Discord errors can echo the submitted content, including signed media links, so only metadata is logged.
    log.warn("Custom expression delivery failed", {
      serverId: prepared.serverId,
      errorType: discordCode === 40005 ? "CustomExpressionUploadRejected" : "CustomExpressionDeliveryError",
      metadata: {
        expressionId: prepared.id,
        discordCode,
        definite,
        errorName: error instanceof Error ? error.name : "unknown",
      },
    });
  }
  return { status: unsendable ? "unavailable" : definite ? "rejected" : "unconfirmed" };
}

function recordDeliveryContinuity(
  context: ChatTurnContext,
  route: DeliveryRoute,
  message: SentExpressionMessage,
): void {
  const receipt = {
    messageId: message.id,
    channelId: message.channelId ?? context.channel.id,
    route: route.route,
    webhookId: message.webhookId,
    identity: route.identity,
    speaker: route.speaker,
    sprite: route.sprite,
    serverDiscId: context.guild?.id,
  };
  recordPersonaDelivery(receipt);
  context.streamingContext.deliveryReceipts?.push(receipt);
}

/**
 * Records one verified use at acceptance, so a later stop or failed model request does not erase a
 * reaction that stays visible. DMs are skipped because `stat_counters.server_id` is a NOT NULL FK.
 */
function recordExpressionUsage(context: ChatTurnContext, prepared: PreparedExpression): void {
  const serverId = context.tomoriState.server_id;
  const userId = context.triggererUserId;
  if (context.isDMChannel || !serverId || !userId) return;
  try {
    statRepository.recordStat({
      serverId,
      userId,
      lineageId: context.currentPersona.persona_lineage_id ?? context.tomoriState.persona_lineage_id ?? 0,
      metric: prepared.kind === "native" ? "sticker_used" : "custom_expression_used",
      // `sticker_used` keys on the name because getEmotionBreakdown joins on `server_stickers.sticker_name`.
      metricKey: prepared.kind === "native" ? prepared.sticker.name : prepared.id,
    });
  } catch (error) {
    log.warn("Failed to record expression usage", error);
  }
}
