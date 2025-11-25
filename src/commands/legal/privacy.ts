import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { ColorCode } from "@/utils/misc/logger";
import type { UserRow } from "@/types/db/schema";

/**
 * Configure the 'privacy' subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("privacy")
		.setDescription(localizer("en-US", "commands.legal.privacy.description"));

/**
 * Executes the 'privacy' command
 * Shows a link to the Privacy Policy on GitHub with dynamic locale support
 * @param client - The Discord client instance
 * @param interaction - The chat input command interaction
 * @param userData - The user data for the invoking user
 * @param locale - The user's preferred locale
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	// 1. Build GitHub URL dynamically based on user's locale
	// Since language_pref only contains officially supported locales,
	// we can directly use it without availability checks
	const githubUrl = `https://github.com/Bredrumb/TomoriBot/blob/main/legal/${locale}/privacy-policy.md`;

	// 2. Create embed with title, description, and link
	const embed = new EmbedBuilder()
		.setTitle(localizer(locale, "commands.legal.privacy.title"))
		.setDescription(
			localizer(locale, "commands.legal.privacy.description_text"),
		)
		.addFields({
			name: localizer(locale, "commands.legal.privacy.link_title"),
			value: githubUrl,
		})
		.setColor(ColorCode.INFO)
		.setTimestamp();

	// 5. Send ephemeral reply
	await interaction.reply({
		embeds: [embed],
		flags: MessageFlags.Ephemeral,
	});
}
