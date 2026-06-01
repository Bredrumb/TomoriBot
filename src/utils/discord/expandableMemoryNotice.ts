/**
 * Expandable memory notification helper.
 *
 * Wraps the standard memory-learning embed with an optional "Expand" button.
 * The button is appended only when the memory content exceeds the embed
 * truncation threshold (200 chars). Clicking it replies ephemerally with the
 * full, un-truncated memory content so the user can read everything without
 * cluttering the channel.
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

const EXPAND_BUTTON_ID = "memory_notice_expand";
const MEMORY_TRUNCATION_THRESHOLD = 200;
const DEFAULT_MEMORY_EXPAND_BUTTON_TIMEOUT_MS = 86_400_000;
const MEMORY_EXPAND_BUTTON_TIMEOUT_MS = parsePositiveIntegerEnv(
  process.env.MEMORY_EXPAND_BUTTON_TIMEOUT_MS,
  DEFAULT_MEMORY_EXPAND_BUTTON_TIMEOUT_MS,
);

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function buildExpandButtonRow(locale: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(EXPAND_BUTTON_ID)
      .setLabel(localizer(locale, "genai.self_teach.expand_memory_button"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

/**
 * Sends a memory notification embed, attaching an "Expand" button when the
 * full memory content exceeds the embed truncation threshold. The button
 * shows the full content as an ephemeral reply when clicked.
 *
 * @param channel - Destination channel (supports the same channel types as `sendStandardEmbed`).
 * @param locale - Locale used for the button label, expand-popup title, and embed strings.
 * @param embedOptions - Pre-built `StandardEmbedOptions` for the visible embed.
 *   The caller is responsible for placing the already-truncated content into `descriptionVars` —
 *   this helper does not modify the embed body.
 * @param fullMemoryContent - The full, processed (post-{user}/{bot} substitution) memory content.
 *   Used both to decide whether to show the button and as the body of the ephemeral expand reply.
 * @param webhookContext - Optional persona webhook identity, identical to `sendStandardEmbed`.
 */
export async function sendMemoryEmbedWithExpand(
  channel: SupportedChannel,
  locale: string,
  embedOptions: StandardEmbedOptions,
  fullMemoryContent: string,
  webhookContext?: WebhookEmbedContext,
): Promise<void> {
  // 1. Short content was not truncated — fall back to the standard sender unchanged.
  //    This keeps the embed byte-for-byte identical for the common case and avoids
  //    paying collector setup cost when there is nothing extra to reveal.
  if (fullMemoryContent.length <= MEMORY_TRUNCATION_THRESHOLD) {
    await sendStandardEmbed(channel, locale, embedOptions, webhookContext);
    return;
  }

  // 2. Build the visible embed and the Expand button row.
  const visibleEmbed = createStandardEmbed(locale, embedOptions);
  const expandRow = buildExpandButtonRow(locale);
  const disabledRow = buildExpandButtonRow(locale, true);

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
      log.warn("Memory expand embed: webhook send failed, falling back to plain bot message", error as Error);
    }
  }

  if (!noticeMessage) {
    try {
      noticeMessage = await channel.send({ embeds: [visibleEmbed], components: [expandRow] });
    } catch (error) {
      log.warn("Memory expand embed: channel send failed", error as Error);
      return;
    }
  }

  // 5. Build the ephemeral "full content" embed once — reused for every click.
  //    Wrap the content in a fenced code block so newlines and any markdown
  //    inside the memory are preserved without being interpreted.
  const fullEmbed = createStandardEmbed(locale, {
    color: embedOptions.color ?? ColorCode.INFO,
    titleKey: "genai.self_teach.expand_memory_title",
    description: `\`\`\`\n${fullMemoryContent}\n\`\`\``,
  });

  // 6. Wire the button collector. Any non-bot user may click — the full content
  //    is already shown to everyone in the channel (truncated), so ephemeral
  //    expansion is not a privacy escalation.
  const collector = noticeMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: MEMORY_EXPAND_BUTTON_TIMEOUT_MS,
    filter: (interaction) => interaction.customId === EXPAND_BUTTON_ID && !interaction.user.bot,
  });

  collector.on("collect", async (interaction) => {
    try {
      await interaction.reply({
        embeds: [fullEmbed],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      log.warn("Memory expand button reply failed", error as Error);
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
          log.warn("[MemoryExpand] Failed to disable expand button via webhook after collector end", err),
        );
    } else {
      await noticeMessage
        .edit({ components: [disabledRow] })
        .catch((err: unknown) => log.warn("[MemoryExpand] Failed to disable expand button after collector end", err));
    }
  });
}
