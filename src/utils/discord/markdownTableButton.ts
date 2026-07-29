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
import { log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/** Custom id carried by every rendered-table "Show Markdown" button. */
export const SHOW_MARKDOWN_BUTTON_ID = "markdown_table_show_source";

const DEFAULT_SHOW_MARKDOWN_BUTTON_TIMEOUT_MS = 7_200_000;

/** Discord's per-message content limit, minus room for the ```markdown fence and newlines. */
const MARKDOWN_FENCE_OVERHEAD = 32;
const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;

/**
 * Reads the button's active window from the environment.
 *
 * Defaults to two hours so it matches `MARKDOWN_TABLE_CACHE_TTL_MINUTES`' own default — a
 * live button whose cache entry already expired would only ever return the expired notice.
 *
 * @returns Collector lifetime in milliseconds
 */
function getShowMarkdownButtonTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.MARKDOWN_TABLE_BUTTON_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SHOW_MARKDOWN_BUTTON_TIMEOUT_MS;
}

/**
 * Builds the single-button row attached to a rendered markdown-table image.
 *
 * @param locale - Viewer locale for the button label
 * @param disabled - True to render the button greyed out (used after the collector ends)
 * @returns An action row holding the "Show Markdown" button
 */
export function createShowMarkdownButtonRow(locale: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SHOW_MARKDOWN_BUTTON_ID)
      .setLabel(localizer(locale, "genai.markdown_table.show_button"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

/**
 * Wraps table markdown in a fenced block for the ephemeral reply.
 *
 * @param markdown - Raw markdown table source
 * @returns The fenced block, ready to send as message content
 */
function buildFencedMarkdown(markdown: string): string {
  return `\`\`\`markdown\n${markdown}\n\`\`\``;
}

/**
 * Sends the raw table markdown back to whoever pressed the button, visible only to them.
 *
 * Tables wider than a Discord message go out as a `.md` attachment rather than being
 * truncated — a half table is useless for the copy/paste the button exists to enable.
 *
 * @param interaction - The button press to respond to
 * @param locale - Viewer locale for the expired notice
 * @param markdown - Cached table source, or null when the cache entry has expired
 */
async function replyWithMarkdownSource(
  interaction: ButtonInteraction,
  locale: string,
  markdown: string | null,
): Promise<void> {
  if (!markdown) {
    await interaction.reply({
      content: localizer(locale, "genai.markdown_table.source_expired"),
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

/**
 * Disables the button once its collector window closes.
 *
 * Webhook-authored messages cannot be edited with the bot token, so the send path's webhook
 * is reused when the table was delivered under a persona identity.
 *
 * @param locale - Viewer locale for the (disabled) button label
 * @param webhook - Webhook that authored the message, when there was one
 * @param threadId - Thread the message lives in, when applicable
 */
async function disableShowMarkdownButton(
  message: Message,
  locale: string,
  webhook?: Webhook,
  threadId?: string,
): Promise<void> {
  const disabledRow = createShowMarkdownButtonRow(locale, true);

  if (webhook && message.webhookId) {
    await webhook
      .editMessage(message.id, {
        components: [disabledRow],
        ...(threadId ? { threadId } : {}),
      })
      .catch((error: unknown) => log.warn("[MarkdownTable] Failed to disable Show Markdown button via webhook", error));
    return;
  }

  await message
    .edit({ components: [disabledRow] })
    .catch((error: unknown) => log.warn("[MarkdownTable] Failed to disable Show Markdown button", error));
}

/**
 * Attaches the collector that serves table markdown when the button is pressed.
 *
 * The source is read from the shared markdown-table cache on each press rather than being
 * captured here, so a press after the cache TTL degrades to a clear notice instead of
 * pinning every rendered table's source in memory for the collector's whole lifetime.
 *
 * @param message - The message carrying the rendered table and its button
 * @param locale - Viewer locale for button label and notices
 * @param webhook - Webhook that authored the message, when there was one
 * @param threadId - Thread the message lives in, when applicable
 */
export function attachShowMarkdownCollector(
  message: Message,
  locale: string,
  webhook?: Webhook,
  threadId?: string,
): void {
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: getShowMarkdownButtonTimeoutMs(),
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
