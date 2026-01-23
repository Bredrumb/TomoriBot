/**
 * Command: /config prompt clear
 * Clears the custom system prompt, reverting to default DEFAULT_SYSTEM_PROMPT
 */

import type { ChatInputCommandInteraction, Client } from "discord.js";
import { MessageFlags, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import {
	getCachedTomoriState,
	invalidateTomoriStateCache,
} from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { log, ColorCode } from "@/utils/misc/logger";
import { DEFAULT_SYSTEM_PROMPT } from "@/utils/text/contextBuilder";

/**
 * Configure the slash command subcommand metadata
 * @returns Configured SlashCommandSubcommandBuilder
 */
export function configureSubcommand(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName("clear")
		.setDescription(
			"Remove custom system prompt and use default humanizer instruction",
		)
		.setDescriptionLocalizations({
			// Add localizations as needed
		});
}

/**
 * Execute the /config prompt clear command
 * @param _client - Discord client (unused)
 * @param interaction - Chat input command interaction
 * @param userData - User data from database
 * @param locale - User's locale for localization
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	try {
		// 1. Determine server context (guild or DM)
		const serverId = interaction.guildId ?? interaction.user.id;
		const tomoriState = await getCachedTomoriState(serverId);

		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 2. Check if there's a custom prompt set
		if (!tomoriState.config.system_prompt) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.prompt.clear.no_custom_prompt_title",
				descriptionKey:
					"commands.config.prompt.clear.no_custom_prompt_description",
				descriptionVars: { defaultPrompt: DEFAULT_SYSTEM_PROMPT.trim() },
				color: ColorCode.INFO,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 3. Clear the system prompt (set to NULL)
		await sql`
			UPDATE tomori_configs
			SET system_prompt = NULL
			WHERE server_id = ${tomoriState.server_id}
		`;

		// 4. Invalidate cache so next message gets fresh config
		invalidateTomoriStateCache(serverId);

		// 5. Success response
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.prompt.clear.success_title",
			descriptionKey: "commands.config.prompt.clear.success_description",
			descriptionVars: { defaultPrompt: DEFAULT_SYSTEM_PROMPT.trim() },
			color: ColorCode.SUCCESS,
			flags: MessageFlags.Ephemeral,
		});

		log.info(`System prompt cleared for server ${serverId}`);
	} catch (error) {
		log.error("Failed to clear custom system prompt:", error as Error);

		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
	}
}
