import type { ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";

const GITHUB_REPO = process.env.GITHUB_REPO || "Bredrumb/TomoriBot";

const GITHUB_API_TIMEOUT_MS = Number.parseInt(process.env.GITHUB_API_TIMEOUT_MS || "10000", 10);

const EMBED_DESCRIPTION_LIMIT = 4096;

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  created_at: string;
  html_url: string;
}

export const configureCommand = (command: SlashCommandBuilder) =>
  command.setName("update").setDescription(localizer("en-US", "commands.update.description"));

function extractImageUrl(text: string): string | null {
  const match = text.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
  return match ? match[1] : null;
}

function cleanReleaseNotes(body: string, locale: string, htmlUrl: string): string {
  let cleaned = body
    .replace(/!\[.*?\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length > EMBED_DESCRIPTION_LIMIT) {
    const truncationMessage = localizer(locale, "commands.update.truncated_link", { url: htmlUrl });
    const availableLength = EMBED_DESCRIPTION_LIMIT - truncationMessage.length;
    cleaned = cleaned.slice(0, availableLength) + truncationMessage;
  }

  return cleaned;
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Ephemerality is fixed at defer time: the later editReply and error replies inherit it.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
    const response = await fetch(apiUrl, {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.update.fetch_error_title",
        descriptionKey: "commands.update.fetch_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const release = (await response.json()) as GitHubRelease;

    // Extracted before cleanReleaseNotes strips inline ![alt](url) release markdown.
    const imageUrl = release.body ? extractImageUrl(release.body) : null;

    const description = release.body
      ? cleanReleaseNotes(release.body, locale, release.html_url)
      : localizer(locale, "commands.update.no_notes");

    const embed = new EmbedBuilder()
      .setDescription(description)
      .setColor(ColorCode.SUCCESS)
      .setTimestamp(new Date(release.created_at))
      .setFooter({
        text: localizer(locale, "commands.update.footer"),
      });

    if (imageUrl) {
      embed.setImage(imageUrl);
    }

    const appliedEmbed = new EmbedBuilder()
      .setTitle(localizer(locale, "commands.update.applied_title"))
      .setDescription(localizer(locale, "commands.update.applied_description"))
      .setColor(ColorCode.INFO);

    await interaction.editReply({ embeds: [embed, appliedEmbed] });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/update",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /update command", error as Error, context);

    try {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    } catch (replyError) {
      log.error("Failed to send error reply for /update", replyError, context);
    }
  }
}
