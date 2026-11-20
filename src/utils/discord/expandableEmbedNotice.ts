import {
  AttachmentBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type AnyThreadChannel,
  type BaseGuildTextChannel,
  type BaseGuildVoiceChannel,
  type DMChannel,
  type Message,
  type NewsChannel,
  type TextChannel,
  type TopLevelComponentData,
} from "discord.js";
import type { ToolNoticeKey } from "@/constants/toolNotices";
import type { MinimalNoticeRef } from "@/types/db/schema";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import type { ToolContext } from "@/types/tool/interfaces";
import { createStandardEmbed, type WebhookEmbedContext } from "@/utils/discord/embedHelper";
import { resolveUserLocale } from "@/utils/discord/interactionLocale";
import { recordMinimalNoticeRef } from "@/utils/discord/minimalNoticeBodies";
import type { SendableChannel } from "@/utils/discord/resolveSendableChannel";
import {
  isMinimalNotice,
  isNoticeEmbedVisible,
  resolveHiddenNoticeTarget,
  withThoughtLogSource,
} from "@/utils/discord/toolProgressNotice";
import { buildNoticeContainer } from "@/utils/discord/ui/statusComponents";
import { validateAndFallbackPanelPayload } from "@/utils/discord/ui/interactionCore";
import { ColorCode, log } from "@/utils/misc/logger";
import { buildTextPreview } from "@/utils/text/textPreview";
import { recordPersonaDelivery, sendPersonaPost } from "@/utils/discord/webhook/personaPost";
import { buildToolPersonaPostContext } from "@/utils/discord/webhook/toolPersonaDelivery";
import { resolveAuthoringWebhook } from "@/utils/discord/webhook/fallback";

type SupportedChannel =
  | TextChannel
  | NewsChannel
  | DMChannel
  | BaseGuildTextChannel
  | AnyThreadChannel
  | BaseGuildVoiceChannel;

// Matches the truncation threshold used by task embed callers so Expand attaches whenever previews truncate.
const DEFAULT_TRUNCATION_THRESHOLD = 200;
// Both notice types offer their expand button for a day: long enough that the button
// outlives the message it was attached to in the channel's scrollback.
const EXPAND_BUTTON_TIMEOUT_MS = 86_400_000;
// Discord limits an embed description to 4096 characters.
const MAX_EXPANDED_DESCRIPTION_LENGTH = 4096;

// Capped at 600 so it stays below MAX_MEMORY_LENGTH (1000) to keep Expand useful while leaving room under Discord's
// 4000-char cap for framing.
export const MEMORY_NOTICE_PREVIEW_LIMIT = 600;

interface ExpandableNoticeConfig {
  customId: string;
  buttonLabelKey: string;
  expandTitleKey: string;
  truncationThreshold?: number;
  timeoutMs: number;
}

// Initial sends and disabled-button edits both call this full builder because Discord Components V2 notices cannot
// use partial component updates.
function buildNoticeComponents(
  locale: string,
  embedOptions: StandardEmbedOptions,
  config: ExpandableNoticeConfig,
  includeExpandButton: boolean,
  expandButtonDisabled = false,
): TopLevelComponentData[] {
  return buildNoticeContainer({
    locale,
    color: embedOptions.color ?? ColorCode.INFO,
    titleKey: embedOptions.titleKey,
    titleVars: embedOptions.titleVars,
    descriptionKey: embedOptions.descriptionKey,
    description: embedOptions.description,
    descriptionVars: embedOptions.descriptionVars,
    footerKey: embedOptions.footerKey,
    footerVars: embedOptions.footerVars,
    configHint: embedOptions.configHint,
    minimal: embedOptions.minimal,
    button: includeExpandButton
      ? {
          customId: config.customId,
          labelKey: config.buttonLabelKey,
          style: ButtonStyle.Secondary,
          disabled: expandButtonDisabled,
        }
      : undefined,
  });
}

async function deliverNoticeComponents(
  channel: SupportedChannel,
  components: TopLevelComponentData[],
  webhookContext: WebhookEmbedContext | undefined,
  locale: string,
): Promise<{ message: Message | null; sentViaWebhook: boolean; threadId: string | undefined }> {
  const payload = validateAndFallbackPanelPayload({ components, flags: MessageFlags.IsComponentsV2 as const }, locale);
  // Persona webhooks live on the parent channel and need `threadId` to post
  // into a thread.
  const threadId =
    "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() ? channel.id : undefined;

  if (webhookContext?.persona) {
    const outcome = await sendPersonaPost(
      {
        channel: channel as unknown as SendableChannel,
        persona: webhookContext.persona,
        deliveryMode: webhookContext.deliveryMode,
        webhook: webhookContext.webhook,
        impersonatedIdentity: webhookContext.impersonatedIdentity,
        abortSignal: webhookContext.abortSignal,
        isExecutionCancelled: webhookContext.isExecutionCancelled,
        deliveryReceipts: webhookContext.deliveryReceipts,
        deliveryState: webhookContext.deliveryState,
        holdResponseText: webhookContext.holdResponseText,
      },
      { ...payload, withComponents: true },
    );
    if (outcome.status !== "sent") {
      log.warn("CV2 notice: persona delivery failed", outcome.error, {
        metadata: { outcome: outcome.status, channelId: channel.id },
      });
      return { message: null, sentViaWebhook: false, threadId };
    }
    return { message: outcome.message, sentViaWebhook: outcome.receipt.route === "webhook", threadId };
  }

  try {
    const message = await channel.send(payload);
    recordPersonaDelivery({
      messageId: message.id,
      channelId: message.channelId,
      route: "bot",
      webhookId: null,
      identity: {
        username: message.member?.displayName ?? message.author?.username,
        avatarUrl: message.member?.displayAvatarURL?.() ?? message.author?.displayAvatarURL?.(),
      },
      speaker: null,
    });
    return { message, sentViaWebhook: false, threadId };
  } catch (error) {
    log.warn("CV2 notice: channel send failed", error as Error);
    return { message: null, sentViaWebhook: false, threadId };
  }
}

// Components V2 container is used instead of sendStandardEmbed because legacy embeds lack a divider primitive before
// the footer.
async function sendNoticeContainerMessage(
  channel: SupportedChannel,
  locale: string,
  embedOptions: StandardEmbedOptions,
  webhookContext?: WebhookEmbedContext,
): Promise<Message | null> {
  const components = buildNoticeContainer({
    locale,
    color: embedOptions.color ?? ColorCode.INFO,
    titleKey: embedOptions.titleKey,
    titleVars: embedOptions.titleVars,
    descriptionKey: embedOptions.descriptionKey,
    description: embedOptions.description,
    descriptionVars: embedOptions.descriptionVars,
    footerKey: embedOptions.footerKey,
    footerVars: embedOptions.footerVars,
    configHint: embedOptions.configHint,
    minimal: embedOptions.minimal,
  });
  return (await deliverNoticeComponents(channel, components, webhookContext, locale)).message;
}

async function sendEmbedWithExpand(
  channel: SupportedChannel,
  locale: string,
  embedOptions: StandardEmbedOptions,
  fullContent: string,
  config: ExpandableNoticeConfig,
  webhookContext?: WebhookEmbedContext,
): Promise<Message | null> {
  const truncationThreshold = config.truncationThreshold ?? DEFAULT_TRUNCATION_THRESHOLD;
  const thresholdPreview = buildTextPreview(fullContent, truncationThreshold);
  const fenceSafeContent = buildTextPreview(fullContent, Number.MAX_SAFE_INTEGER).text;
  // A Minimal card shows none of the content, so there is no truncated tail for a button to reveal.
  const shouldAttachExpandButton = thresholdPreview.truncated && !embedOptions.minimal;

  const activeComponents = buildNoticeComponents(locale, embedOptions, config, shouldAttachExpandButton);
  const disabledComponents = shouldAttachExpandButton
    ? buildNoticeComponents(locale, embedOptions, config, true, true)
    : activeComponents;
  const disabledPayload = validateAndFallbackPanelPayload(
    { components: disabledComponents, flags: MessageFlags.IsComponentsV2 as const },
    locale,
  );

  const {
    message: noticeMessage,
    sentViaWebhook,
    threadId,
  } = await deliverNoticeComponents(channel, activeComponents, webhookContext, locale);
  const webhook = webhookContext?.webhook;

  if (!noticeMessage || !shouldAttachExpandButton) {
    return noticeMessage;
  }

  // Any non-bot user may click because the channel already shows the truncated preview, avoiding a privacy escalation.
  const collector = noticeMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: config.timeoutMs,
    filter: (interaction) => interaction.customId === config.customId && !interaction.user.bot,
  });

  collector.on("collect", async (interaction) => {
    try {
      const description = `\`\`\`\n${fenceSafeContent}\n\`\`\``;
      if (description.length > MAX_EXPANDED_DESCRIPTION_LENGTH) {
        await interaction.reply({
          files: [new AttachmentBuilder(Buffer.from(fullContent, "utf8"), { name: "notice.txt" })],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      // Fenced so markdown inside stored content renders literally instead of formatting the reply.
      const fullEmbed = createStandardEmbed(await resolveUserLocale(interaction), {
        color: embedOptions.color ?? ColorCode.INFO,
        titleKey: config.expandTitleKey,
        description,
      });
      await interaction.reply({
        embeds: [fullEmbed],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      log.warn("Expand button reply failed", error as Error);
    }
  });

  collector.on("end", async () => {
    if (!noticeMessage) return;
    // Webhook-sent messages can only be edited through the webhook token.
    if (sentViaWebhook) {
      const author = await resolveAuthoringWebhook(channel, noticeMessage.webhookId, webhook);
      if (!author) return;
      await author
        .editMessage(noticeMessage.id, {
          ...disabledPayload,
          withComponents: true,
          ...(threadId ? { threadId } : {}),
        })
        .catch((err: unknown) =>
          log.warn("[ExpandEmbed] Failed to disable expand button via webhook after collector end", err),
        );
    } else {
      await noticeMessage
        .edit({
          ...disabledPayload,
        })
        .catch((err: unknown) => log.warn("[ExpandEmbed] Failed to disable expand button after collector end", err));
    }
  });

  return noticeMessage;
}

type NoticeDelivery = (
  channel: SupportedChannel,
  options: StandardEmbedOptions,
  webhookContext: WebhookEmbedContext | undefined,
) => Promise<Message | null>;

// Minimal cards record ref because Discord-rebuilt context sees only titles, and suppressProgressNotices is ignored
// since these confirm committed changes.
async function routeHideableNotice(
  context: ToolContext,
  noticeKey: ToolNoticeKey,
  embedOptions: StandardEmbedOptions,
  deliver: NoticeDelivery,
  ref?: MinimalNoticeRef,
): Promise<void> {
  const { config } = context.tomoriState;
  const hintedOptions: StandardEmbedOptions = { ...embedOptions, configHint: true };
  const isVisible = isNoticeEmbedVisible(config, noticeKey);
  const isMinimal = isVisible && isMinimalNotice(config, noticeKey);

  if (isVisible) {
    const visibleOptions = isMinimal ? { ...embedOptions, minimal: true } : hintedOptions;
    const message = await deliver(
      context.channel,
      visibleOptions,
      buildToolPersonaPostContext(context, context.tomoriState),
    );
    if (!isMinimal) {
      return;
    }
    if (message && ref) {
      await recordMinimalNoticeRef(message.id, ref);
    }
  }

  const logLabel = `${isVisible ? "Minimal" : "Hidden"} ${noticeKey} notice`;
  try {
    const target = await resolveHiddenNoticeTarget(context, logLabel);
    if (!target) return;
    await deliver(target.channel, withThoughtLogSource(context, hintedOptions), target.webhookContext);
  } catch (error) {
    log.warn(`${logLabel}: Failed to route to the thought log`, error as Error);
  }
}

function sendToolEmbedWithExpand(
  context: ToolContext,
  noticeKey: ToolNoticeKey,
  embedOptions: StandardEmbedOptions,
  fullContent: string,
  config: ExpandableNoticeConfig,
  ref: MinimalNoticeRef | undefined,
): Promise<void> {
  return routeHideableNotice(
    context,
    noticeKey,
    embedOptions,
    (channel, options, webhookContext) =>
      sendEmbedWithExpand(channel, context.locale, options, fullContent, config, webhookContext),
    ref,
  );
}

export async function sendMemoryEmbedWithExpand(
  context: ToolContext,
  embedOptions: StandardEmbedOptions,
  fullMemoryContent: string,
  ref?: MinimalNoticeRef,
): Promise<void> {
  const config: ExpandableNoticeConfig = {
    customId: "memory_notice_expand",
    buttonLabelKey: "genai.self_teach.expand_memory_button",
    expandTitleKey: "genai.self_teach.expand_memory_title",
    truncationThreshold: MEMORY_NOTICE_PREVIEW_LIMIT,
    timeoutMs: EXPAND_BUTTON_TIMEOUT_MS,
  };
  await sendToolEmbedWithExpand(context, "memory_update", embedOptions, fullMemoryContent, config, ref);
}

export async function sendTaskEmbedWithExpand(
  context: ToolContext,
  embedOptions: StandardEmbedOptions,
  fullReminderPurpose: string,
  ref?: MinimalNoticeRef,
): Promise<void> {
  await sendToolEmbedWithExpand(
    context,
    "task_update",
    embedOptions,
    fullReminderPurpose,
    {
      customId: "task_notice_expand",
      buttonLabelKey: "reminders.expand_task_button",
      expandTitleKey: "reminders.expand_task_title",
      timeoutMs: EXPAND_BUTTON_TIMEOUT_MS,
    },
    ref,
  );
}

export function sendToolNoticeContainer(
  context: ToolContext,
  noticeKey: ToolNoticeKey,
  embedOptions: StandardEmbedOptions,
): Promise<void> {
  return routeHideableNotice(context, noticeKey, embedOptions, (channel, options, webhookContext) =>
    sendNoticeContainerMessage(channel, context.locale, options, webhookContext),
  );
}
