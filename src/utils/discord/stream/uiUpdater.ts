import { sendChannelMessageOnce, sendSelectedWebhookMessageOnce } from "@/utils/discord/webhook/singleAttemptMessage";
import type { BaseGuildTextChannel, Message, ReplyOptions } from "discord.js";
import type { StreamContext } from "@/types/stream/interfaces";
import type { SpriteMessageRecordInfo, StreamState } from "@/types/stream/types";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import {
  isChannelGoneError,
  isMissingChannelAccessError,
  MissingChannelAccessError,
  resolveSendableChannel,
  resolveReplyChannel,
  type ChannelUnreachableReason,
  type SendableChannel,
} from "@/utils/discord/resolveSendableChannel";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { invalidateWebhookCache } from "@/utils/discord/webhook/cache";
import { dispatchWebhookWithIdentity } from "@/utils/discord/webhook/personaDispatch";
import { resolveAuthoringWebhook } from "@/utils/discord/webhook/fallback";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { recordPersonaDelivery, type PersonaDeliveryReceipt } from "@/utils/discord/webhook/personaPost";
import {
  classifyDiscordDeliveryFailure,
  DiscordDeliveryError,
  isInvalidWebhookError,
} from "@/utils/discord/webhook/deliveryOutcome";
import { buildWebhookReplyNoticePayload } from "@/utils/discord/webhookReply";
import {
  classifySendFailure,
  clearSendFailure,
  markSendFailureLogged,
  noteSendFailure,
} from "@/utils/discord/stream/sendFailureCache";
import type { DeliveredSpeaker } from "@/utils/discord/stream/channelDeliveryContinuity";
import { ColorCode, log } from "@/utils/misc/logger";
import { STREAMING_LIMITS } from "@/utils/security/rateLimiter";
import { recordChatDiagnostic, recordChatMessageSent } from "@/utils/chat/diagnosticTimeline";
import type { ChatSendReason } from "@/utils/chat/diagnosticTimeline";

export type StreamSendPayload = {
  content?: string;
  files?: import("discord.js").AttachmentBuilder[];
  components?: import("discord.js").ActionRowBuilder<import("discord.js").ButtonBuilder>[];
  identityOverride?: ResolvedWebhookIdentity;
  accumulatedTextPrefix?: string;
  spriteRecord?: SpriteMessageRecordInfo;
  isNeutralAppearance?: boolean;
  allowedMentions?: {
    users?: string[];
    parse?: Array<"users" | "roles" | "everyone">;
    repliedUser?: boolean;
  };
  diagnosticReason?: ChatSendReason;
};

type StreamUiUpdaterDependencies = {
  hasStopRequest: (channelId: string) => boolean;
  requestStop: (channelId: string, requesterId?: string) => boolean;
  notifyStreamProgress: (context: StreamContext) => void;
};

function resolveWebhookTargetChannel(channel: StreamContext["channel"]): BaseGuildTextChannel | null {
  const isThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
  if (isThread) {
    return channel.parent && "fetchWebhooks" in channel.parent ? (channel.parent as BaseGuildTextChannel) : null;
  }
  return "fetchWebhooks" in channel && "createWebhook" in channel ? (channel as BaseGuildTextChannel) : null;
}

function resolveWebhookThreadId(channel: StreamContext["channel"]): string | undefined {
  return "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() ? channel.id : undefined;
}

// Code 10003 matches Discord's deleted-channel REST error so the send catch routes pre-send absence through the quiet
// teardown path.
class ChannelGoneError extends Error {
  public readonly code = 10003;

  public constructor(channelId: string | undefined) {
    super(`Destination channel ${channelId ?? "unknown"} is gone`);
    this.name = "ChannelGoneError";
  }
}

// Error code rather than instanceof decides here because REST sends and the local resolver both surface 50001, and
// only one uses the local class.
function unreachableReasonFor(error: unknown): ChannelUnreachableReason {
  return isMissingChannelAccessError(error) ? "missing_access" : "channel_deleted";
}

function unreachableChannelError(
  reason: ChannelUnreachableReason,
  channelId: string | undefined,
): ChannelGoneError | MissingChannelAccessError {
  return reason === "missing_access"
    ? new MissingChannelAccessError(channelId ?? "unknown")
    : new ChannelGoneError(channelId);
}

// Requesting a stop on missing access or deletion tears down the stream quietly so key rotation and fallback models
// do not emit per-arm errors.
function stopForUnreachableChannel(
  deps: StreamUiUpdaterDependencies,
  channelId: string,
  reason: ChannelUnreachableReason,
  cause: unknown,
): void {
  const described = reason === "missing_access" ? "is not accessible to the bot" : "is gone";
  log.warn(`Stream Send: destination channel ${channelId} ${described}, stopping the stream`, cause);
  deps.requestStop(channelId, reason);
}

// Direct id resolution avoids Message#reply cache eviction errors, and writing context.channel back is required
// because later chunks skip this helper.
async function resolveReplyTarget(
  context: StreamContext,
): Promise<
  | { channel: SendableChannel; reply: ReplyOptions | undefined; failed?: undefined }
  | { channel?: undefined; reply?: undefined; failed: ChannelUnreachableReason }
> {
  // Captured channel objects survive cache eviction, so only partials lacking send() fall through to REST
  // resolution.
  const captured = context.channel;
  if (typeof (captured as { send?: unknown }).send === "function") {
    return { channel: captured as SendableChannel, reply: buildReplyReference(context, captured.id) };
  }

  const resolved = await resolveReplyChannel(context.client, context.replyToMessage, captured.id);
  if (!resolved.channel) return { failed: resolved.failed };

  context.channel = resolved.channel;
  return { channel: resolved.channel, reply: buildReplyReference(context, resolved.channel.id) };
}

// Cross-channel reply references are omitted because Discord rejects them with 10008 when a turn falls back to
// another reachable channel.
function buildReplyReference(context: StreamContext, targetChannelId: string): ReplyOptions | undefined {
  const source = context.replyToMessage;
  if (!source || source.system || source.channelId !== targetChannelId) return undefined;

  return { messageReference: source.id, failIfNotExists: false };
}

export function isUserImpersonationStreamContext(context: StreamContext): boolean {
  return context.deliveryMode === "user_impersonation";
}

function classifyWebhookSpeaker(
  payload: Pick<StreamSendPayload, "identityOverride" | "spriteRecord" | "isNeutralAppearance">,
  context: StreamContext,
  strictUserImpersonation: boolean,
): DeliveredSpeaker {
  const personaId = context.tomoriState.persona_id ?? null;
  if (strictUserImpersonation) return { personaId, kind: "copied" };
  if (payload.spriteRecord) {
    return {
      personaId: payload.spriteRecord.personaId,
      kind: payload.spriteRecord.isIdentity ? "identity_sprite" : "appearance",
    };
  }
  if (payload.identityOverride && !payload.isNeutralAppearance) return { personaId, kind: "copied" };
  return { personaId, kind: "appearance" };
}

// Bot-user messages show the main bot identity, so an alter landing here on webhook fallback is recorded with a null
// personaId rather than misattributed.
function classifyBotSpeaker(context: StreamContext): DeliveredSpeaker {
  return {
    personaId: context.tomoriState.is_alter ? null : (context.tomoriState.persona_id ?? null),
    kind: "appearance",
  };
}

export class StreamUiUpdater {
  public constructor(private readonly deps: StreamUiUpdaterDependencies) {}

  public async sendSinglePayload(
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
  ): Promise<Message | null> {
    if (!payload.content?.trim() && (!payload.files || payload.files.length === 0)) {
      return null;
    }

    const {
      identityOverride,
      accumulatedTextPrefix,
      spriteRecord: _spriteRecord,
      isNeutralAppearance: _isNeutralAppearance,
      diagnosticReason: _diagnosticReason,
      ...discordPayload
    } = payload;
    const textForAccumulation = `${accumulatedTextPrefix ?? ""}${textForState}`;
    const strictUserImpersonation = isUserImpersonationStreamContext(context);
    let replyNoticeMessage: Message | null = null;
    const threadId = resolveWebhookThreadId(context.channel);
    const restrictedMentions = context.mentionableUserIds
      ? { users: [...context.mentionableUserIds], parse: [], repliedUser: false }
      : null;
    const webhookAllowedMentions = payload.allowedMentions ??
      restrictedMentions ?? {
        parse: ["users", "roles"] as Array<"users" | "roles">,
        repliedUser: false,
      };
    const regularAllowedMentions = payload.allowedMentions ??
      restrictedMentions ?? {
        repliedUser: false,
      };

    if (
      context.deliveryState?.unconfirmed ||
      context.holdResponseText ||
      context.abortSignal?.aborted ||
      this.deps.hasStopRequest(context.channel.id)
    ) {
      log.info("Stream Send: Stop request detected before Discord API call, skipping message send");
      return null;
    }

    const sendMessageLimit = context.tomoriState.config.send_message_limit ?? 0;
    if (sendMessageLimit > 0 && state.messageSentCount >= sendMessageLimit) {
      log.info(
        `Send message limit reached: ${state.messageSentCount} messages sent (server limit: ${sendMessageLimit})`,
      );
      // Request a stop rather than throwing so generationTurn does not retry across fallback arms on an operator
      // send cap.
      this.deps.requestStop(context.channel.id, "send_message_limit");
      return null;
    }

    if (state.messageSentCount >= STREAMING_LIMITS.MAX_FLUSH_COUNT) {
      log.warn(
        `Flush limit exceeded: ${state.messageSentCount} messages sent (limit: ${STREAMING_LIMITS.MAX_FLUSH_COUNT})`,
      );

      // Suppress the warning embed during impersonation to avoid breaking disguise, and stop instead of throwing
      // to prevent pointless fallback retries.
      if (!context.suppressUserErrors && !strictUserImpersonation) {
        await sendStandardEmbed(context.channel, context.locale, {
          titleKey: "genai.stream.flush_limit_title",
          descriptionKey: "genai.stream.flush_limit_description",
          color: ColorCode.WARN,
        }).catch((embedError) => {
          log.warn(
            "Failed to send flush limit warning embed",
            embedError instanceof Error ? embedError : new Error(String(embedError)),
          );
        });
      }

      this.deps.requestStop(context.channel.id, "flush_limit");
      return null;
    }

    try {
      if (strictUserImpersonation && !context.webhook) {
        throw new Error("User impersonation requires a temporary webhook, but none is available.");
      }

      let sentMessage: Message | null = null;
      // Captured so recordSuccessfulSend can remember exactly which identity Discord saw:
      // including the decorated group-break username: for later sends to reuse.
      let deliveredWebhookIdentity: ResolvedWebhookIdentity | undefined;
      let deliveredWebhookId: string | undefined;
      let deliveredSpeaker: DeliveredSpeaker | undefined;
      const webhookForIdentity = identityOverride
        ? await this.resolveWebhookForIdentityOverride(context)
        : context.webhook;
      const shouldUseWebhook =
        Boolean(identityOverride && webhookForIdentity) || Boolean(context.webhook && context.personaUsername);

      if (shouldUseWebhook && webhookForIdentity) {
        // Upgrade a partial context.channel here (not replyToMessage's channel) so later non-webhook chunks can
        // still send without retargeting the stream.
        if (typeof (context.channel as { send?: unknown }).send !== "function") {
          try {
            const resolvedChannel = await resolveSendableChannel(context.client, context.channel.id);
            if (resolvedChannel.channel) {
              context.channel = resolvedChannel.channel;
            } else {
              stopForUnreachableChannel(this.deps, context.channel.id, resolvedChannel.failed, undefined);
              return null;
            }
          } catch (resolveError) {
            // Ignore transient channel-resolution errors here because the webhook below still delivers this chunk.
            log.warn(
              `Stream Send: could not resolve channel ${context.channel.id} before a webhook send; continuing with the captured channel`,
              resolveError as Error,
            );
          }
        }

        const identity =
          identityOverride ??
          ({
            username: context.personaUsername,
            avatarUrl: context.personaAvatarUrl,
            avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
          } satisfies ResolvedWebhookIdentity);
        const speaker = classifyWebhookSpeaker(payload, context, strictUserImpersonation);
        log.info(
          `Stream Send: Using webhook for persona "${identity.username ?? context.personaUsername ?? "unknown"}"${
            identity.avatarUrl || identity.avatarDataUri ? " with custom avatar" : " (default avatar)"
          }`,
        );

        // Webhooks cannot use native replies, so send a reply notice for own/sprite turns (marked by
        // spriteRecord) while staying silent for copied identities.
        const isSpriteIdentity = Boolean(payload.spriteRecord);
        let noticePayload: Awaited<ReturnType<typeof buildWebhookReplyNoticePayload>> | undefined;
        if (
          (!identityOverride || isSpriteIdentity) &&
          !strictUserImpersonation &&
          context.replyToMessage &&
          context.replyNoticeState &&
          !context.replyNoticeState.attempted &&
          state.messageSentCount === 0
        ) {
          context.replyNoticeState.attempted = true;
          const replyToMessage = context.replyToMessage;
          try {
            noticePayload = await buildWebhookReplyNoticePayload(replyToMessage, context.locale, {
              threadId,
              botUserId: context.client.user?.id,
              botName: context.tomoriState.persona_nickname,
            });
          } catch (noticeError) {
            log.warn("Stream Send: Failed to send standalone alter reply notice", noticeError as Error);
          }
        }

        const webhookSend = await dispatchWebhookWithIdentity(webhookForIdentity, identity, async (selected) => {
          this.assertCanDispatch(context);
          if (noticePayload) {
            try {
              replyNoticeMessage = await sendSelectedWebhookMessageOnce(selected, noticePayload, () =>
                this.assertCanDispatch(context),
              );
              this.commitDelivery(
                context,
                replyNoticeMessage,
                selected.identity,
                speaker,
                payload.spriteRecord,
                selected.webhookId,
              );
              if (context.replyNoticeState) context.replyNoticeState.sent = true;
            } catch (noticeError) {
              if (classifyDiscordDeliveryFailure(noticeError) === "unconfirmed") throw noticeError;
              log.warn("Stream Send: Failed to send standalone alter reply notice", noticeError as Error);
            }
          }
          this.assertCanDispatch(context);
          return await sendSelectedWebhookMessageOnce(
            selected,
            {
              ...(discordPayload.content !== undefined ? { content: discordPayload.content } : {}),
              ...(discordPayload.files?.length ? { files: discordPayload.files } : {}),
              ...(discordPayload.components?.length ? { components: discordPayload.components } : {}),
              allowedMentions: webhookAllowedMentions,
              ...(threadId ? { threadId } : {}),
            },
            () => this.assertCanDispatch(context),
          );
        });

        sentMessage = webhookSend.result;
        // Record webhookSend.identity (actual Discord avatar after fallback) while keeping the intended sprite in
        // activeRenderModifier for next-line retries.
        deliveredWebhookIdentity = webhookSend.identity;
        deliveredWebhookId = webhookSend.webhookId;
        deliveredSpeaker = speaker;
        state.hasRepliedToOriginalMessage = true;
      } else if (!state.hasRepliedToOriginalMessage && context.replyToMessage) {
        const target = await resolveReplyTarget(context);
        if (!target.channel) {
          throw unreachableChannelError(target.failed, context.replyToMessage.channelId);
        }

        this.assertCanDispatch(context);
        sentMessage = await sendChannelMessageOnce(
          target.channel,
          {
            ...(discordPayload.content !== undefined ? { content: discordPayload.content } : {}),
            ...(discordPayload.files?.length ? { files: discordPayload.files } : {}),
            ...(discordPayload.components?.length ? { components: discordPayload.components } : {}),
            ...(target.reply ? { reply: target.reply } : {}),
            allowedMentions: regularAllowedMentions,
          },
          () => this.assertCanDispatch(context),
        );
        state.hasRepliedToOriginalMessage = true;
      } else {
        this.assertCanDispatch(context);
        sentMessage = await sendChannelMessageOnce(
          context.channel,
          {
            ...(discordPayload.content !== undefined ? { content: discordPayload.content } : {}),
            ...(discordPayload.files?.length ? { files: discordPayload.files } : {}),
            ...(discordPayload.components?.length ? { components: discordPayload.components } : {}),
            allowedMentions: regularAllowedMentions,
          },
          () => this.assertCanDispatch(context),
        );
      }

      // Clears any cached refusal so a lifted timeout or a granted permission takes effect at
      // once, rather than after the remainder of the TTL.
      clearSendFailure(context.channel.id);
      this.recordSuccessfulSend(
        payload,
        textForAccumulation,
        context,
        state,
        sentMessage,
        deliveredWebhookIdentity,
        "normal",
        deliveredSpeaker,
        deliveredWebhookId,
      );
      return sentMessage;
    } catch (discordError) {
      if (classifyDiscordDeliveryFailure(discordError) === "unconfirmed" && context.deliveryState)
        context.deliveryState.unconfirmed = true;
      if (context.abortSignal?.aborted || this.deps.hasStopRequest(context.channel.id)) return null;
      // Stop quietly before webhook recovery or bot fallback when the channel is gone so deletion does not
      // cascade error logs.
      if (isChannelGoneError(discordError)) {
        stopForUnreachableChannel(this.deps, context.channel.id, unreachableReasonFor(discordError), discordError);
        return null;
      }

      const recoveredMessage = await this.tryRecoverWebhookSend(
        discordError,
        payload,
        textForAccumulation,
        context,
        state,
        webhookAllowedMentions,
        identityOverride,
      );
      if (recoveredMessage) {
        return recoveredMessage;
      }

      let terminalError: unknown = discordError;
      if (
        !strictUserImpersonation &&
        classifyDiscordDeliveryFailure(discordError) !== "unconfirmed" &&
        ((context.webhook && context.personaUsername) || identityOverride) &&
        !state.hasRepliedToOriginalMessage
      ) {
        const fallback = await this.tryFallbackBotSend(
          discordError,
          replyNoticeMessage,
          threadId,
          payload,
          textForAccumulation,
          context,
          state,
          regularAllowedMentions,
        );
        if (fallback.outcome === "sent") {
          return fallback.message;
        }
        if (fallback.outcome === "stopped") {
          return null;
        }
        terminalError = fallback.error;
      }

      if (strictUserImpersonation) {
        log.warn(
          "Stream Send: User impersonation webhook send failed; not falling back to a regular bot message",
          discordError as Error,
        );
      }

      // Cache refused sends for the admission gate and track isFirstOfEpisode so repeat refusals downgrade
      // their warning detail.
      const sendFailureReason = classifySendFailure(terminalError);
      recordChatDiagnostic({ kind: "send_failed", reason: sendFailureReason ?? "other" });
      const isFirstOfEpisode = sendFailureReason
        ? noteSendFailure(context.channel.id, sendFailureReason).isFirstOfEpisode
        : true;

      const sendErrorMetadata = {
        serverId: context.tomoriState?.server_id,
        errorType: "StreamOrchestrator",
        metadata: {
          channelId: context.channel.id,
          contentLength: textForAccumulation.length,
          usingWebhook: !!context.webhook || !!identityOverride,
          ...(sendFailureReason ? { sendFailureReason } : {}),
        },
      };

      if (sendFailureReason) {
        log.metric("discord_send_failure", {
          reason: sendFailureReason,
          route: context.webhook || identityOverride ? "webhook" : "bot",
        });
        log.warn(
          isFirstOfEpisode
            ? "Stream Send: Discord API error when sending message"
            : `Stream Send: suppressed repeat ${sendFailureReason} for channel ${context.channel.id}`,
          terminalError as Error,
          sendErrorMetadata,
        );
      } else {
        log.error("Stream Send: Discord API error when sending message", terminalError, sendErrorMetadata);
      }

      if (classifyDiscordDeliveryFailure(terminalError) === "unconfirmed" && context.deliveryState)
        context.deliveryState.unconfirmed = true;
      throw markSendFailureLogged(
        new DiscordDeliveryError(classifyDiscordDeliveryFailure(terminalError), terminalError),
      );
    }
  }

  private recordSuccessfulSend(
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
    sentMessage: Message | null,
    deliveredWebhookIdentity?: ResolvedWebhookIdentity,
    route: "normal" | "webhook_recovery" | "bot_fallback" = "normal",
    deliveredSpeaker?: DeliveredSpeaker,
    deliveredWebhookId?: string,
  ): void {
    if (!state.firstReplyUrl && sentMessage?.url) {
      state.firstReplyUrl = sentMessage.url;
    }
    if (!state.firstMessageId && sentMessage) {
      state.firstMessageId = sentMessage.id;
    }

    if (sentMessage) {
      this.commitDelivery(
        context,
        sentMessage,
        deliveredWebhookIdentity,
        deliveredSpeaker,
        payload.spriteRecord,
        deliveredWebhookId,
      );
    }
    if (payload.spriteRecord && sentMessage?.webhookId) {
      // Record delivered sprites with isIdentity for post-turn stats because identity sprites count toward
      // sprite_shown without counting as emotion sprites.
      state.spritesShown.push({
        name: payload.spriteRecord.spriteName,
        isIdentity: payload.spriteRecord.isIdentity,
      });
    }
    state.messageSentCount++;
    if (sentMessage) {
      recordChatMessageSent(
        sentMessage.id,
        sentMessage.webhookId ? "webhook" : "bot",
        payload.diagnosticReason,
        state.messageSentCount,
        route,
      );
    }
    if (textForState) {
      // Each send is its own Discord message, so the record keeps the line break the channel shows;
      // a continuation prefill and short-term memory read this text back.
      const separator =
        state.accumulatedText && !/\s$/u.test(state.accumulatedText) && !/^\s/u.test(textForState) ? "\n" : "";
      state.accumulatedText += separator + textForState;
    }
    // The array is a shared reference off StreamingContext, so appends survive an abandoned
    // (timed-out) stream promise.
    if (context.deliveredMessageRefs && sentMessage) {
      context.deliveredMessageRefs.push({
        messageId: sentMessage.id,
        channelId: sentMessage.channelId,
        webhookId: sentMessage.webhookId,
      });
    }
    this.deps.notifyStreamProgress(context);
    const logPreview = textForState
      ? textForState.length > 100
        ? `${textForState.substring(0, 100)}...`
        : textForState
      : `[attachment payload: ${payload.files?.length ?? 0} file(s)]`;
    log.info(`Stream Send: Sent message (${state.messageSentCount}): "${logPreview}"`);
  }

  private async resolveWebhookForIdentityOverride(
    context: StreamContext,
  ): Promise<import("discord.js").Webhook | null> {
    if (context.webhook) {
      return context.webhook;
    }

    const webhookTargetChannel = resolveWebhookTargetChannel(context.channel);
    if (!webhookTargetChannel) {
      return null;
    }

    const webhookResult = await getOrCreateWebhook(webhookTargetChannel);
    if (!webhookResult.webhook) {
      return null;
    }

    context.webhook = webhookResult.webhook;
    return webhookResult.webhook;
  }

  private assertCanDispatch(context: StreamContext): void {
    if (
      context.deliveryState?.unconfirmed ||
      context.holdResponseText ||
      context.abortSignal?.aborted ||
      this.deps.hasStopRequest(context.channel.id)
    ) {
      throw new DiscordDeliveryError("pre_dispatch", new Error("Stream delivery withheld or cancelled"));
    }
  }

  private commitDelivery(
    context: StreamContext,
    message: Message,
    identity?: ResolvedWebhookIdentity,
    speaker?: DeliveredSpeaker,
    sprite?: SpriteMessageRecordInfo,
    webhookId?: string,
  ): void {
    const actualWebhookId = webhookId ?? message.webhookId;
    const viaWebhook = Boolean(identity && actualWebhookId);
    const receipt: PersonaDeliveryReceipt = {
      messageId: message.id,
      channelId: message.channelId,
      route: viaWebhook ? "webhook" : "bot",
      webhookId: viaWebhook ? (actualWebhookId ?? null) : null,
      identity: viaWebhook
        ? (identity ?? {})
        : {
            username: message.member?.displayName ?? message.author?.username ?? context.client.user?.username,
            avatarUrl: message.member?.displayAvatarURL?.() ?? message.author?.displayAvatarURL?.(),
          },
      speaker: viaWebhook ? (speaker ?? null) : classifyBotSpeaker(context),
      sprite: viaWebhook ? sprite : undefined,
      serverDiscId: "guildId" in context.channel ? context.channel.guildId : undefined,
    };
    recordPersonaDelivery(receipt, message);
    context.deliveryReceipts?.push(receipt);
  }

  private async tryRecoverWebhookSend(
    discordError: unknown,
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
    webhookAllowedMentions: NonNullable<StreamSendPayload["allowedMentions"]>,
    identityOverride?: ResolvedWebhookIdentity,
  ): Promise<Message | null> {
    const shouldRecoverWebhook =
      context.webhook && (context.personaUsername || identityOverride) && isInvalidWebhookError(discordError);

    if (!shouldRecoverWebhook) {
      return null;
    }

    const webhookTargetChannel = resolveWebhookTargetChannel(context.channel);
    if (!webhookTargetChannel) {
      return null;
    }

    try {
      invalidateWebhookCache(webhookTargetChannel.id);
      const recreatedWebhookResult = await getOrCreateWebhook(webhookTargetChannel);
      const recreatedWebhook = recreatedWebhookResult.webhook;
      if (!recreatedWebhook) {
        return null;
      }

      const recoveredThreadId = resolveWebhookThreadId(context.channel);
      const recoveredIdentity =
        identityOverride ??
        ({
          username: context.personaUsername,
          avatarUrl: context.personaAvatarUrl,
          avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
        } satisfies ResolvedWebhookIdentity);

      const delivery = await dispatchWebhookWithIdentity(recreatedWebhook, recoveredIdentity, (selected) => {
        this.assertCanDispatch(context);
        return sendSelectedWebhookMessageOnce(
          selected,
          {
            ...(payload.content !== undefined ? { content: payload.content } : {}),
            ...(payload.files?.length ? { files: payload.files } : {}),
            ...(payload.components?.length ? { components: payload.components } : {}),
            allowedMentions: webhookAllowedMentions,
            ...(recoveredThreadId ? { threadId: recoveredThreadId } : {}),
          },
          () => this.assertCanDispatch(context),
        );
      });
      const recoveredReplyMessage = delivery.result;

      context.webhook = recreatedWebhook;
      state.hasRepliedToOriginalMessage = true;
      this.recordSuccessfulSend(
        payload,
        textForState,
        context,
        state,
        recoveredReplyMessage,
        delivery.identity,
        "webhook_recovery",
        classifyWebhookSpeaker(payload, context, isUserImpersonationStreamContext(context)),
        delivery.webhookId,
      );
      log.info("Stream Send: Recreated webhook after invalid webhook error and resumed persona sending");
      return recoveredReplyMessage;
    } catch (recoveryError) {
      if (classifyDiscordDeliveryFailure(recoveryError) === "unconfirmed") {
        if (context.deliveryState) context.deliveryState.unconfirmed = true;
        throw recoveryError;
      }
      log.warn(
        "Stream Send: Webhook recovery attempt failed, falling back to regular bot message",
        recoveryError as Error,
      );
      return null;
    }
  }

  private async tryFallbackBotSend(
    discordError: unknown,
    replyNoticeMessage: Message | null,
    threadId: string | undefined,
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
    regularAllowedMentions: NonNullable<StreamSendPayload["allowedMentions"]>,
  ): Promise<{ outcome: "sent"; message: Message } | { outcome: "stopped" } | { outcome: "failed"; error: unknown }> {
    log.warn("Stream Send: Webhook send failed, falling back to regular bot message", discordError);

    try {
      if (replyNoticeMessage) {
        const notice = replyNoticeMessage;
        try {
          const author = await resolveAuthoringWebhook(context.channel, notice.webhookId, context.webhook);
          if (!author) throw new Error("Authoring webhook unavailable for reply notice cleanup");
          await author.deleteMessage(notice.id, threadId);
        } catch (deleteError) {
          log.warn("Stream Send: Failed to delete standalone alter reply notice after webhook fallback", deleteError);
        }
      }

      const target = await resolveReplyTarget(context);
      if (!target.channel) {
        throw unreachableChannelError(target.failed, context.replyToMessage?.channelId ?? context.channel.id);
      }

      this.assertCanDispatch(context);
      const fallbackMessage = await sendChannelMessageOnce(
        target.channel,
        {
          ...(payload.content !== undefined ? { content: payload.content } : {}),
          ...(payload.files?.length ? { files: payload.files } : {}),
          ...(payload.components?.length ? { components: payload.components } : {}),
          ...(target.reply ? { reply: target.reply } : {}),
          allowedMentions: regularAllowedMentions,
        },
        () => this.assertCanDispatch(context),
      );

      state.hasRepliedToOriginalMessage = true;
      this.recordSuccessfulSend(payload, textForState, context, state, fallbackMessage, undefined, "bot_fallback");
      log.info("Stream Send: Successfully sent message via fallback after webhook failure");
      return { outcome: "sent", message: fallbackMessage };
    } catch (fallbackError) {
      // Return "stopped" when fallback hits a gone channel so the caller ends quietly instead of logging an
      // error and keeping generation alive.
      if (isChannelGoneError(fallbackError)) {
        stopForUnreachableChannel(this.deps, context.channel.id, unreachableReasonFor(fallbackError), fallbackError);
        return { outcome: "stopped" };
      }

      const fallbackMetadata = {
        serverId: context.tomoriState?.server_id,
        errorType: "StreamOrchestrator",
        metadata: {
          channelId: context.channel.id,
          webhookError: String(discordError),
          fallbackError: String(fallbackError),
        },
      };
      if (classifySendFailure(fallbackError)) {
        log.warn("Stream Send: Both webhook and fallback failed", fallbackError, fallbackMetadata);
      } else {
        log.error("Stream Send: Both webhook and fallback failed", fallbackError, fallbackMetadata);
      }
      return { outcome: "failed", error: fallbackError };
    }
  }
}
