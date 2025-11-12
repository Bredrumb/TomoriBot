import type { SlashCommandSubcommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { ColorCode } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import type { UserRow } from "../../types/db/schema";

// Define how the subcommand is configured
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("ping")
		.setDescription(localizer("en-US", "commands.tool.ping.description"));

// Command logic with the UserRow parameter
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	// Defer reply for timing measurement
	await interaction.deferReply();

	const reply = await interaction.fetchReply();
	const responseTime = reply.createdTimestamp - interaction.createdTimestamp;

	// Determine if response is slow
	const isLaggy = responseTime > 250;

	const embed = new EmbedBuilder()
		.setColor(isLaggy ? ColorCode.WARN : ColorCode.SUCCESS)
		.setTitle(localizer(locale, "commands.tool.ping.title"))
		.setDescription(
			localizer(
				locale,
				isLaggy
					? "commands.tool.ping.response_slow"
					: "commands.tool.ping.response_fast",
				{
					response_time: responseTime,
				},
			),
		);

	await interaction.editReply({ embeds: [embed] });
}
