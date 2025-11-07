import type { SlashCommandSubcommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { MessageFlags } from "discord.js";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";

/**
 * Configure the github subcommand for contribute category
 * @param subcommand - The slash command subcommand builder
 * @returns The configured subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("github")
		.setDescription(
			localizer("en-US", "commands.contribute.github.description"),
		);

/**
 * Execute the contribute github command - show GitHub repository link and contribution information
 * @param client - Discord client instance
 * @param interaction - Command interaction
 * @param _userData - User data from database (not used)
 * @param locale - Locale of the interaction
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	await replyInfoEmbed(
		interaction,
		locale,
		{
			titleKey: "commands.contribute.github.title",
			descriptionKey: "commands.contribute.github.description_text",
			color: ColorCode.INFO,
		},
		MessageFlags.SuppressNotifications,
	);
}
