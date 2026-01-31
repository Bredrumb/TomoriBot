/**
 * /personal cache - Configure short-term memory settings
 *
 * Phase 4: User Controls & Privacy
 *
 * Allows users to:
 * 1. Toggle cross-server memory sharing (opt-in)
 * 2. Clear all short-term memories
 */

import type {
	Client,
	ChatInputCommandInteraction,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { toggleCrossServerShortTermMemoryOptIn } from "@/utils/db/dbWrite";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { clearShortTermMemoryForUser } from "@/utils/cache/shortTermMemoryCache";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { ColorCode, log } from "@/utils/misc/logger";

/**
 * Configure the subcommand structure
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("cache")
		.setDescription("Configure short-term memory settings")
		.addStringOption((option) =>
			option
				.setName("setting")
				.setDescription("Which setting to configure")
				.setRequired(true)
				.addChoices(
					{
						name: "Cross-server memory sharing",
						value: "crossserver",
					},
					{ name: "Clear all short-term memories", value: "clear" },
				),
		);

/**
 * Execute the /personal cache command
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	const setting = interaction.options.getString("setting", true);

	// Defer before async work (Pattern 2: Commands with Async Work)
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	try {
		if (setting === "crossserver") {
			// Toggle cross-server opt-in
			const newValue = await toggleCrossServerShortTermMemoryOptIn(
				interaction.user.id,
			);

			// Invalidate user cache to ensure fresh data on next access
			invalidateUserCache(interaction.user.id);

			log.success(
				`[personalCacheCommand] Toggled cross-server short-term memory opt-in - userId=${interaction.user.id}, newValue=${newValue}`,
			);

			// Reply with status
			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.SUCCESS,
				titleKey: "commands.personal.cache.crossserver.title",
				descriptionKey: newValue
					? "commands.personal.cache.crossserver.enabled"
					: "commands.personal.cache.crossserver.disabled",
			});
		} else if (setting === "clear") {
			// Clear all short-term memories for user
			clearShortTermMemoryForUser(interaction.user.id);

			log.success(
				`[personalCacheCommand] Cleared all short-term memories for user - userId=${interaction.user.id}`,
			);

			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.SUCCESS,
				titleKey: "commands.personal.cache.clear.title",
				descriptionKey: "commands.personal.cache.clear.success",
			});
		} else {
			// Unknown setting (should not happen due to choices validation)
			log.warn(
				`[personalCacheCommand] Unknown setting value - setting=${setting}, userId=${interaction.user.id}`,
			);

			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.ERROR,
				titleKey: "general.errors.invalid_option_title",
				descriptionKey: "general.errors.invalid_option_description",
			});
		}
	} catch (error) {
		await log.error(
			`[personalCacheCommand] Failed to execute cache command - setting=${setting}, userId=${interaction.user.id}`,
			error,
			{
				errorType: "CACHE_COMMAND_ERROR",
				metadata: { userDiscId: interaction.user.id, setting },
			},
		);

		await replyInfoEmbed(interaction, locale, {
			color: ColorCode.ERROR,
			titleKey: "general.errors.critical_error_title",
			descriptionKey: "general.errors.critical_error_description",
			footerKey: "genai.generic_error_footer",
		});
	}
}
