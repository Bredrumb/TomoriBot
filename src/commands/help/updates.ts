import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";

/** GitHub repository in owner/repo format for the releases API */
const GITHUB_REPO = process.env.GITHUB_REPO || "Bredrumb/TomoriBot";

/** Timeout in milliseconds for the GitHub API fetch */
const GITHUB_API_TIMEOUT_MS = Number.parseInt(
	process.env.GITHUB_API_TIMEOUT_MS || "10000",
	10,
);

/** Discord embed description character limit */
const EMBED_DESCRIPTION_LIMIT = 4096;

/**
 * Minimal fields used from the GitHub Release API response.
 * Full schema: https://docs.github.com/en/rest/releases/releases
 */
interface GitHubRelease {
	tag_name: string;
	body: string | null;
	created_at: string;
	html_url: string;
}

/**
 * Configure the /help updates subcommand.
 * Posts the latest TomoriBot release notes as a public embed.
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("updates")
		.setDescription(localizer("en-US", "commands.help.updates.description"));

/**
 * Extracts the first markdown image URL from release notes.
 * Matches the pattern: ![alt text](url)
 * @param text - Raw release notes markdown
 * @returns The image URL if found, otherwise null
 */
function extractImageUrl(text: string): string | null {
	const match = text.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
	return match ? match[1] : null;
}

/**
 * Cleans release notes for Discord embed display:
 * 1. Strips all markdown image syntax (![alt](url))
 * 2. Collapses consecutive blank lines into a single blank line
 * 3. Trims leading and trailing whitespace
 * 4. Truncates to Discord's embed description limit with ellipsis
 * @param body - Raw release notes markdown from the GitHub API
 * @returns Cleaned text ready for an embed description
 */
function cleanReleaseNotes(body: string): string {
	let cleaned = body
		.replace(/!\[.*?\]\([^)]*\)/g, "") // Strip markdown image syntax
		.replace(/\n{3,}/g, "\n\n") // Collapse consecutive blank lines
		.trim();

	if (cleaned.length > EMBED_DESCRIPTION_LIMIT) {
		cleaned = `${cleaned.slice(0, EMBED_DESCRIPTION_LIMIT - 3)}...`;
	}

	return cleaned;
}

/**
 * Execute the /help updates command.
 * Fetches the latest release from GitHub's public API and posts it as a
 * public embed in the current channel — mirroring the Discord webhook
 * notification sent by the CI/CD pipeline on deploy.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	// Defer publicly — the release embed is intended for the channel, not just the user
	await interaction.deferReply();

	try {
		// 1. Fetch the latest release from GitHub's public REST API (no auth required)
		const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
		const response = await fetch(apiUrl, {
			headers: { Accept: "application/vnd.github.v3+json" },
			signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
		});

		// 2. Surface API errors (404 = no releases yet, 429 = rate limited, etc.)
		if (!response.ok) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.help.updates.fetch_error_title",
				descriptionKey: "commands.help.updates.fetch_error_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		const release = (await response.json()) as GitHubRelease;

		// 3. Extract image URL from the release notes before stripping image markdown.
		//    Release images are referenced inline as ![alt](url) by the release workflow.
		const imageUrl = release.body
			? extractImageUrl(release.body)
			: null;

		// 4. Clean the release notes for embed display
		const description = release.body
			? cleanReleaseNotes(release.body)
			: localizer(locale, "commands.help.updates.no_notes");

		// 5. Build embed — matches the structure posted by the CI/CD webhook notification
		const embed = new EmbedBuilder()
			.setTitle(
				localizer(locale, "commands.help.updates.title", {
					version: release.tag_name,
				}),
			)
			.setDescription(description)
			.setColor(ColorCode.SUCCESS)
			.setTimestamp(new Date(release.created_at))
			.setURL(release.html_url); // Title becomes a clickable link to the release

		// 6. Attach the release image if one was found in the notes
		if (imageUrl) {
			embed.setImage(imageUrl);
		}

		// 7. Post the embed publicly to the channel
		await interaction.editReply({ embeds: [embed] });
	} catch (error) {
		const context: ErrorContext = {
			userId: userData.user_id,
			errorType: "CommandExecutionError",
			metadata: {
				commandName: "/help updates",
				guildDiscordId: interaction.guild?.id,
			},
		};
		await log.error(
			"Error executing /help updates command",
			error as Error,
			context,
		);

		// replyInfoEmbed detects the deferred state and uses editReply automatically
		try {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
			});
		} catch (replyError) {
			log.error(
				"Failed to send error reply for /help updates",
				replyError,
				context,
			);
		}
	}
}
