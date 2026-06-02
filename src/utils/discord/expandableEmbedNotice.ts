/**
 * Expandable embed notification helper.
 *
 * Wraps a standard notification embed with an optional "Expand" button. The
 * button is appended only when the underlying content exceeds the embed
 * truncation threshold (default 200 chars). Clicking it replies ephemerally
 * with the full, un-truncated content so users can read everything without
 * cluttering the channel.
 *
 * The generic `sendEmbedWithExpand` is reused by both memory-learning embeds
 * (`sendMemoryEmbedWithExpand`) and scheduled-task embeds
 * (`sendTaskEmbedWithExpand`); each wrapper supplies its own locale keys,
 * button custom ID, and collector timeout.
 *
 * Mirrors the lifecycle of `fallbackModelNotice.ts`: 24h collector, disable
 * the button on collector end (via webhook token when the message was sent
 * through a persona webhook, otherwise via the bot token).
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
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
  type Webhook,
} from "discord.js";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import { createStandardEmbed, sendStandardEmbed, type WebhookEmbedContext } from "@/utils/discord/embedHelper";
import { sendWebhookMessageWithIdentity } from "@/utils/discord/webhook/webhookCore";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

type SupportedChannel =
  | TextChannel
  | NewsChannel
  | DMChannel
  | BaseGuildTextChannel
  | AnyThreadChannel
  | BaseGuildVoiceChannel;

// Default character count above which the "Expand" button is attached. Matches
// the 200-char truncation applied by the memory and task embed callers.
const DEFAULT_TRUNCATION_THRESHOLD = 200;
// Shared 24h fallback used when a caller does not provide its own timeout.
const DEFAULT_EXPAND_BUTTON_TIMEOUT_MS = 86_400_000;

// Per-notice-type collector timeouts, each independently configurable via env.
const MEMORY_EXPAND_BUTTON_TIMEOUT_MS = parsePositiveIntegerEnv(
  process.env.MEMORY_EXPAND_BUTTON_TIMEOUT_MS,
  DEFAULT_EXPAND_BUTTON_TIMEOUT_MS,
);
const TASK_EXPAND_BUTTON_TIMEOUT_MS = parsePositiveIntegerEnv(
  process.env.TASK_EXPAND_BUTTON_TIMEOUT_MS,
  DEFAULT_EXPAND_BUTTON_TIMEOUT_MS,
);

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Per-notice configuration for {@link sendEmbedWithExpand}. Each notice type
 * (memory, task, …) supplies its own locale keys and a unique button custom ID.
 */
interface ExpandableNoticeConfig {
  /** Discord component custom ID for the expand button (must be unique per notice type). */
  customId: string;
  /** Locale key for the button label. */
  buttonLabelKey: string;
  /** Locale key for the ephemeral expand-popup embed title. */
  expandTitleKey: string;
  /** Character count above which the button is attached. Defaults to {@link DEFAULT_TRUNCATION_THRESHOLD}. */
  truncationThreshold?: number;
  /** Collector lifetime in ms before the button is disabled. */
  timeoutMs: number;
}

// Mirrors the private helper in embedHelper.ts — webhooks targeting threads
// reference the parent channel, so a thread is only usable when its parent
// matches the webhook channel.
function canUseWebhookForChannel(channel: SupportedChannel, webhook: Webhook): boolean {
  if ("isThread" in channel && typeof channel.isThread === "function" && channel.isThread()) {
    return channel.parentId === webhook.channelId;
  }
  return webhook.channelId === channel.id;
}

function buildExpandButtonRow(
  locale: string,
  config: ExpandableNoticeConfig,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(config.customId)
      .setLabel(localizer(locale, config.buttonLabelKey))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

/**
 * Sends a notification embed, attaching an "Expand" button when the full
 * content exceeds the embed truncation threshold. The button shows the full
 * content as an ephemeral reply when clicked. Callers normally use one of the
 * thin wrappers (`sendMemoryEmbedWithExpand`, `sendTaskEmbedWithExpand`) which
 * pre-fill the notice-specific {@link ExpandableNoticeConfig}.
 *
 * @param channel - Destination channel (supports the same channel types as `sendStandardEmbed`).
 * @param locale - Locale used for the button label, expand-popup title, and embed strings.
 * @param embedOptions - Pre-built `StandardEmbedOptions` for the visible embed.
 *   The caller is responsible for placing the already-truncated content into `descriptionVars` —
 *   this helper does not modify the embed body.
 * @param fullContent - The full, already-processed content (e.g. post-{user}/{bot} substitution).
 *   Used both to decide whether to show the button and as the body of the ephemeral expand reply.
 * @param config - Notice-specific locale keys, button custom ID, threshold, and collector timeout.
 * @param webhookContext - Optional persona webhook identity, identical to `sendStandardEmbed`.
 */
export async function sendEmbedWithExpand(
  channel: SupportedChannel,
  locale: string,
  embedOptions: StandardEmbedOptions,
  fullContent: string,
  config: ExpandableNoticeConfig,
  webhookContext?: WebhookEmbedContext,
): Promise<void> {
  const truncationThreshold = config.truncationThreshold ?? DEFAULT_TRUNCATION_THRESHOLD;

  // 1. Short content was not truncated — fall back to the standard sender unchanged.
  //    This keeps the embed byte-for-byte identical for the common case and avoids
  //    paying collector setup cost when there is nothing extra to reveal.
  if (fullContent.length <= truncationThreshold) {
    await sendStandardEmbed(channel, locale, embedOptions, webhookContext);
    return;
  }

  // 2. Build the visible embed and the Expand button row.
  const visibleEmbed = createStandardEmbed(locale, embedOptions);
  const expandRow = buildExpandButtonRow(locale, config);
  const disabledRow = buildExpandButtonRow(locale, config, true);

  // 3. Resolve thread ID — persona webhooks live on the parent channel and need
  //    `threadId` to post into a thread.
  const threadId =
    "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() ? channel.id : undefined;

  // 4. Try webhook-persona delivery first so the notice appears under the same
  //    identity as the AI response, then fall back to a plain bot message.
  const webhook = webhookContext?.webhook;
  const useWebhook = Boolean(webhook && webhookContext?.personaUsername && canUseWebhookForChannel(channel, webhook));

  let noticeMessage: Message | null = null;
  let sentViaWebhook = false;

  if (useWebhook && webhook && webhookContext) {
    try {
      noticeMessage = await sendWebhookMessageWithIdentity(
        webhook,
        {
          embeds: [visibleEmbed],
          components: [expandRow],
          ...(threadId ? { threadId } : {}),
        },
        {
          username: webhookContext.personaUsername,
          avatarUrl: webhookContext.personaAvatarUrl,
          avatarDataUri: webhookContext.personaAvatarUrl?.startsWith("data:image/")
            ? webhookContext.personaAvatarUrl
            : undefined,
        },
      );
      sentViaWebhook = true;
    } catch (error) {
      log.warn("Expand embed: webhook send failed, falling back to plain bot message", error as Error);
    }
  }

  if (!noticeMessage) {
    try {
      noticeMessage = await channel.send({ embeds: [visibleEmbed], components: [expandRow] });
    } catch (error) {
      log.warn("Expand embed: channel send failed", error as Error);
      return;
    }
  }

  // 5. Build the ephemeral "full content" embed once — reused for every click.
  //    Wrap the content in a fenced code block so newlines and any markdown
  //    inside the content are preserved without being interpreted.
  const fullEmbed = createStandardEmbed(locale, {
    color: embedOptions.color ?? ColorCode.INFO,
    titleKey: config.expandTitleKey,
    description: `\`\`\`\n${fullContent}\n\`\`\``,
  });

  // 6. Wire the button collector. Any non-bot user may click — the full content
  //    is already shown to everyone in the channel (truncated), so ephemeral
  //    expansion is not a privacy escalation.
  const collector = noticeMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: config.timeoutMs,
    filter: (interaction) => interaction.customId === config.customId && !interaction.user.bot,
  });

  collector.on("collect", async (interaction) => {
    try {
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
    if (sentViaWebhook && webhook) {
      await webhook
        .editMessage(noticeMessage.id, {
          components: [disabledRow],
          ...(threadId ? { threadId } : {}),
        })
        .catch((err: unknown) =>
          log.warn("[ExpandEmbed] Failed to disable expand button via webhook after collector end", err),
        );
    } else {
      await noticeMessage
        .edit({ components: [disabledRow] })
        .catch((err: unknown) => log.warn("[ExpandEmbed] Failed to disable expand button after collector end", err));
    }
  });
}

/**
 * Memory-learning wrapper for {@link sendEmbedWithExpand}. Attaches a
 * "Show Full Memory" button when the processed memory content exceeds the
 * truncation threshold.
 *
 * @param channel - Destination channel.
 * @param locale - Locale for button label, expand title, and embed strings.
 * @param embedOptions - Pre-built embed options with the already-truncated content.
 * @param fullMemoryContent - Full, processed (post-{user}/{bot}) memory content.
 * @param webhookContext - Optional persona webhook identity.
 */
export async function sendMemoryEmbedWithExpand(
  channel: SupportedChannel,
  locale: string,
  embedOptions: StandardEmbedOptions,
  fullMemoryContent: string,
  webhookContext?: WebhookEmbedContext,
): Promise<void> {
  await sendEmbedWithExpand(
    channel,
    locale,
    embedOptions,
    fullMemoryContent,
    {
      customId: "memory_notice_expand",
      buttonLabelKey: "genai.self_teach.expand_memory_button",
      expandTitleKey: "genai.self_teach.expand_memory_title",
      timeoutMs: MEMORY_EXPAND_BUTTON_TIMEOUT_MS,
    },
    webhookContext,
  );
}

/**
 * Scheduled-task wrapper for {@link sendEmbedWithExpand}. Attaches a
 * "Show Full Task" button when the task/reminder purpose exceeds the
 * truncation threshold (created, updated, and deleted task embeds).
 *
 * @param channel - Destination channel.
 * @param locale - Locale for button label, expand title, and embed strings.
 * @param embedOptions - Pre-built embed options with the already-truncated purpose.
 * @param fullReminderPurpose - Full, un-truncated reminder/task purpose.
 * @param webhookContext - Optional persona webhook identity.
 */
export async function sendTaskEmbedWithExpand(
  channel: SupportedChannel,
  locale: string,
  embedOptions: StandardEmbedOptions,
  fullReminderPurpose: string,
  webhookContext?: WebhookEmbedContext,
): Promise<void> {
  await sendEmbedWithExpand(
    channel,
    locale,
    embedOptions,
    fullReminderPurpose,
    {
      customId: "task_notice_expand",
      buttonLabelKey: "reminders.expand_task_button",
      expandTitleKey: "reminders.expand_task_title",
      timeoutMs: TASK_EXPAND_BUTTON_TIMEOUT_MS,
    },
    webhookContext,
  );
}
