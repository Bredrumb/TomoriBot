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
 * Configure the 'license' subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("license")
		.setDescription(localizer("en-US", "commands.legal.license.description"));

/**
 * Executes the 'license' command
 * Shows a link to the AGPLv3 LICENSE file on GitHub
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
	// 1. Build GitHub URL to LICENSE file (always in root, no locale variation)
	const githubUrl = "https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE";

	// 2. Create embed with title, description, and link
	const embed = new EmbedBuilder()
		.setTitle(localizer(locale, "commands.legal.license.title"))
		.setDescription(
			localizer(locale, "commands.legal.license.description_text"),
		)
		.addFields({
			name: localizer(locale, "commands.legal.license.link_title"),
			value: githubUrl,
		})
		.setColor(ColorCode.INFO)
		.setTimestamp();

	// 3. Send ephemeral reply
	await interaction.reply({
		embeds: [embed],
		flags: MessageFlags.Ephemeral,
	});
}
