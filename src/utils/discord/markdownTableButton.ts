import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ComponentType,
  type Message,
  MessageFlags,
  type Webhook,
} from "discord.js";
import { getCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { ColorCode, log } from "@/utils/misc/logger";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { resolveAuthoringWebhook } from "@/utils/discord/webhook/fallback";
import { localizer } from "@/utils/text/localizer";

const SHOW_MARKDOWN_BUTTON_ID = "markdown_table_show_source";

// Two hours, matching the markdown-table cache TTL: a live button whose cache entry already
// expired would only ever return the expired notice.
const SHOW_MARKDOWN_BUTTON_TIMEOUT_MS = 7_200_000;

const MARKDOWN_FENCE_OVERHEAD = 32;
const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;

export function createShowMarkdownButtonRow(locale: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SHOW_MARKDOWN_BUTTON_ID)
      .setLabel(localizer(locale, "genai.markdown_table.show_button"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function buildFencedMarkdown(markdown: string): string {
  return `\`\`\`markdown\n${markdown}\n\`\`\``;
}

// Oversized tables attach as `.md` instead of truncating because partial markdown tables break copy/paste.
async function replyWithMarkdownSource(
  interaction: ButtonInteraction,
  locale: string,
  markdown: string | null,
): Promise<void> {
  if (!markdown) {
    await interaction.reply({
      embeds: [
        createStandardEmbed(locale, {
          titleKey: "genai.markdown_table.source_expired_title",
          descriptionKey: "genai.markdown_table.source_expired",
          color: ColorCode.WARN,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const fenced = buildFencedMarkdown(markdown);
  if (fenced.length <= DISCORD_MESSAGE_CONTENT_LIMIT - MARKDOWN_FENCE_OVERHEAD) {
    await interaction.reply({
      content: fenced,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: localizer(locale, "genai.markdown_table.source_attached"),
    files: [new AttachmentBuilder(Buffer.from(markdown, "utf8"), { name: "table.md" })],
    flags: MessageFlags.Ephemeral,
  });
}

async function disableShowMarkdownButton(
  message: Message,
  locale: string,
  webhook?: Webhook,
  threadId?: string,
): Promise<void> {
  const disabledRow = createShowMarkdownButtonRow(locale, true);

  if (message.webhookId) {
    try {
      const author = await resolveAuthoringWebhook(message.channel, message.webhookId, webhook);
      if (!author) throw new Error("Authoring webhook unavailable for markdown button edit");
      await author.editMessage(message.id, {
        components: [disabledRow],
        ...(threadId ? { threadId } : {}),
      });
    } catch (error) {
      log.warn("[MarkdownTable] Failed to disable Show Markdown button via webhook", error);
    }
    return;
  }

  await message
    .edit({ components: [disabledRow] })
    .catch((error: unknown) => log.warn("[MarkdownTable] Failed to disable Show Markdown button", error));
}

// Table source is fetched from cache per press rather than captured in the closure, so expired entries show a notice
// without pinning table text in memory for 2h.
export function attachShowMarkdownCollector(
  message: Message,
  locale: string,
  webhook?: Webhook,
  threadId?: string,
): void {
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: SHOW_MARKDOWN_BUTTON_TIMEOUT_MS,
    filter: (interaction) => interaction.customId === SHOW_MARKDOWN_BUTTON_ID && !interaction.user.bot,
  });

  collector.on("collect", async (interaction) => {
    try {
      await replyWithMarkdownSource(interaction, locale, getCachedRenderedMarkdownTable(message.id));
    } catch (error) {
      log.warn("[MarkdownTable] Show Markdown button reply failed", error as Error);
    }
  });

  collector.on("end", async () => {
    await disableShowMarkdownButton(message, locale, webhook, threadId);
  });
}
