import type { BaseGuildTextChannel, Message } from "discord.js";
import type { StreamContext } from "@/types/stream/interfaces";
import type { StreamState } from "@/types/stream/types";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { invalidateWebhookCache } from "@/utils/discord/webhook/cache";
import { sendWebhookMessageWithIdentity } from "@/utils/discord/webhook/personaDispatch";
import { sendWebhookReplyNotice } from "@/utils/discord/webhookReply";
import { ColorCode, log } from "@/utils/misc/logger";
import { STREAMING_LIMITS } from "@/utils/security/rateLimiter";

export type StreamSendPayload = {
  content?: string;
  files?: import("discord.js").AttachmentBuilder[];
  allowedMentions?: {
    parse?: Array<"users" | "roles" | "everyone">;
    repliedUser?: boolean;
  };
};

type StreamUiUpdaterDependencies = {
  hasStopRequest: (channelId: string) => boolean;
  requestStop: (channelId: string, requesterId?: string) => boolean;
  notifyStreamProgress: (context: StreamContext) => void;
};

function isInvalidWebhookError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  return code === 10015 || code === "10015" || code === 50027 || code === "50027";
}

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

export function isUserImpersonationStreamContext(context: StreamContext): boolean {
  return Boolean(context.personaUsername && !context.tomoriState.is_alter);
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

    const strictUserImpersonation = isUserImpersonationStreamContext(context);
    let replyNoticeMessage: Message | null = null;
    const threadId = resolveWebhookThreadId(context.channel);
    const webhookAllowedMentions = payload.allowedMentions ?? {
      parse: ["users", "roles"] as Array<"users" | "roles">,
      repliedUser: false,
    };
    const regularAllowedMentions = payload.allowedMentions ?? {
      repliedUser: false,
    };

    if (this.deps.hasStopRequest(context.channel.id)) {
      log.info("Stream Send: Stop request detected before Discord API call, skipping message send");
      return null;
    }

    const sendMessageLimit = context.tomoriState.config.send_message_limit ?? 0;
    if (sendMessageLimit > 0 && state.messageSentCount >= sendMessageLimit) {
      log.info(
        `Send message limit reached: ${state.messageSentCount} messages sent (server limit: ${sendMessageLimit})`,
      );
      if (strictUserImpersonation) {
        throw new Error(
          "User impersonation stopped because the server message limit was reached before a reply could be sent.",
        );
      }
      this.deps.requestStop(context.channel.id, "send_message_limit");
      return null;
    }

    if (state.messageSentCount >= STREAMING_LIMITS.MAX_FLUSH_COUNT) {
      log.warn(
        `Flush limit exceeded: ${state.messageSentCount} messages sent (limit: ${STREAMING_LIMITS.MAX_FLUSH_COUNT})`,
      );

      if (strictUserImpersonation) {
        throw new Error("User impersonation stopped because the response exceeded the streaming message limit.");
      }

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

      this.deps.requestStop(context.channel.id, "flush_limit");
      return null;
    }

    try {
      if (strictUserImpersonation && !context.webhook) {
        throw new Error("User impersonation requires a temporary webhook, but none is available.");
      }

      let sentMessage: Message | null = null;
      if (context.webhook && context.personaUsername) {
        log.info(
          `Stream Send: Using webhook for persona "${context.personaUsername}"${context.personaAvatarUrl ? " with custom avatar" : " (default avatar)"}`,
        );

        const identity = {
          username: context.personaUsername,
          avatarUrl: context.personaAvatarUrl,
          avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
        };

        if (
          !strictUserImpersonation &&
          context.tomoriState.is_alter &&
          context.replyToMessage &&
          context.replyNoticeState &&
          !context.replyNoticeState.attempted &&
          state.messageSentCount === 0
        ) {
          context.replyNoticeState.attempted = true;
          try {
            replyNoticeMessage = await sendWebhookReplyNotice(
              context.webhook,
              context.replyToMessage,
              context.locale,
              identity,
              {
                threadId,
                botUserId: context.client.user?.id,
                botName: context.tomoriState.tomori_nickname,
              },
            );
            context.replyNoticeState.sent = true;
          } catch (noticeError) {
            log.warn("Stream Send: Failed to send standalone alter reply notice", noticeError as Error);
          }
        }

        sentMessage = await sendWebhookMessageWithIdentity(
          context.webhook,
          {
            ...(payload.content !== undefined ? { content: payload.content } : {}),
            ...(payload.files?.length ? { files: payload.files } : {}),
            allowedMentions: webhookAllowedMentions,
            ...(threadId ? { threadId } : {}),
          },
          identity,
        );

        state.hasRepliedToOriginalMessage = true;
      } else if (!state.hasRepliedToOriginalMessage && context.replyToMessage) {
        sentMessage = await context.replyToMessage.reply({
          ...(payload.content !== undefined ? { content: payload.content } : {}),
          ...(payload.files?.length ? { files: payload.files } : {}),
          allowedMentions: regularAllowedMentions,
        });
        state.hasRepliedToOriginalMessage = true;
      } else {
        sentMessage = await context.channel.send({
          ...(payload.content !== undefined ? { content: payload.content } : {}),
          ...(payload.files?.length ? { files: payload.files } : {}),
          allowedMentions: regularAllowedMentions,
        });
      }

      this.recordSuccessfulSend(payload, textForState, context, state, sentMessage);
      return sentMessage;
    } catch (discordError) {
      const recoveredMessage = await this.tryRecoverWebhookSend(
        discordError,
        payload,
        textForState,
        context,
        state,
        webhookAllowedMentions,
      );
      if (recoveredMessage) {
        return recoveredMessage;
      }

      if (
        !strictUserImpersonation &&
        context.webhook &&
        context.personaUsername &&
        !state.hasRepliedToOriginalMessage
      ) {
        const fallbackMessage = await this.tryFallbackBotSend(
          discordError,
          replyNoticeMessage,
          threadId,
          payload,
          textForState,
          context,
          state,
          regularAllowedMentions,
        );
        if (fallbackMessage) {
          return fallbackMessage;
        }
      }

      if (strictUserImpersonation) {
        log.warn(
          "Stream Send: User impersonation webhook send failed; not falling back to a regular bot message",
          discordError as Error,
        );
      }

      log.error("Stream Send: Discord API error when sending message", discordError, {
        serverId: context.tomoriState?.server_id,
        errorType: "StreamOrchestrator",
        metadata: {
          channelId: context.channel.id,
          contentLength: textForState.length,
          contentPreview: textForState.substring(0, 200),
          usingWebhook: !!context.webhook,
        },
      });

      throw new Error(
        `Discord send failed: ${discordError instanceof Error ? discordError.message : String(discordError)}`,
      );
    }
  }

  private recordSuccessfulSend(
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
    sentMessage: Message | null,
  ): void {
    if (!state.firstReplyUrl && sentMessage?.url) {
      state.firstReplyUrl = sentMessage.url;
    }
    state.messageSentCount++;
    if (textForState) {
      state.accumulatedText += textForState;
    }
    this.deps.notifyStreamProgress(context);
    const logPreview = textForState
      ? textForState.length > 100
        ? `${textForState.substring(0, 100)}...`
        : textForState
      : `[attachment payload: ${payload.files?.length ?? 0} file(s)]`;
    log.info(`Stream Send: Sent message (${state.messageSentCount}): "${logPreview}"`);
  }

  private async tryRecoverWebhookSend(
    discordError: unknown,
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
    webhookAllowedMentions: NonNullable<StreamSendPayload["allowedMentions"]>,
  ): Promise<Message | null> {
    const shouldRecoverWebhook =
      context.webhook &&
      context.personaUsername &&
      context.tomoriState.is_alter &&
      context.personaUsername === context.tomoriState.tomori_nickname &&
      isInvalidWebhookError(discordError);

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
      const recoveredIdentity = {
        username: context.personaUsername,
        avatarUrl: context.personaAvatarUrl,
        avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
      };

      const recoveredReplyMessage = await sendWebhookMessageWithIdentity(
        recreatedWebhook,
        {
          ...(payload.content !== undefined ? { content: payload.content } : {}),
          ...(payload.files?.length ? { files: payload.files } : {}),
          allowedMentions: webhookAllowedMentions,
          ...(recoveredThreadId ? { threadId: recoveredThreadId } : {}),
        },
        recoveredIdentity,
      );

      context.webhook = recreatedWebhook;
      state.hasRepliedToOriginalMessage = true;
      this.recordSuccessfulSend(payload, textForState, context, state, recoveredReplyMessage);
      log.info("Stream Send: Recreated webhook after invalid webhook error and resumed persona sending");
      return recoveredReplyMessage;
    } catch (recoveryError) {
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
  ): Promise<Message | null> {
    log.warn("Stream Send: Webhook send failed, falling back to regular bot message", discordError);

    try {
      if (replyNoticeMessage && context.webhook) {
        await context.webhook.deleteMessage(replyNoticeMessage.id, threadId).catch((deleteError) => {
          log.warn("Stream Send: Failed to delete standalone alter reply notice after webhook fallback", deleteError);
        });
      }

      const fallbackMessage = context.replyToMessage
        ? await context.replyToMessage.reply({
            ...(payload.content !== undefined ? { content: payload.content } : {}),
            ...(payload.files?.length ? { files: payload.files } : {}),
            allowedMentions: regularAllowedMentions,
          })
        : await context.channel.send({
            ...(payload.content !== undefined ? { content: payload.content } : {}),
            ...(payload.files?.length ? { files: payload.files } : {}),
            allowedMentions: regularAllowedMentions,
          });

      state.hasRepliedToOriginalMessage = true;
      this.recordSuccessfulSend(payload, textForState, context, state, fallbackMessage);
      log.info("Stream Send: Successfully sent message via fallback after webhook failure");
      return fallbackMessage;
    } catch (fallbackError) {
      log.error("Stream Send: Both webhook and fallback failed", fallbackError, {
        serverId: context.tomoriState?.server_id,
        errorType: "StreamOrchestrator",
        metadata: {
          channelId: context.channel.id,
          webhookError: String(discordError),
          fallbackError: String(fallbackError),
        },
      });
      return null;
    }
  }
}
