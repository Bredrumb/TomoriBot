/**
 * Command: /config prompt change
 * Allows users to set a custom system prompt up to 8000 characters
 * using a 4-part modal (2000 chars each, first part required)
 */

import type {
	ChatInputCommandInteraction,
	Client,
	ModalSubmitInteraction,
} from "discord.js";
import {
	MessageFlags,
	SlashCommandSubcommandBuilder,
	TextInputStyle,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import {
	getCachedTomoriState,
	invalidateTomoriStateCache,
} from "@/utils/cache/tomoriStateCache";
import {
	replyInfoEmbed,
	promptWithRawModal,
} from "@/utils/discord/interactionHelper";
import { log, ColorCode } from "@/utils/misc/logger";

const MODAL_CUSTOM_ID = "config_prompt_change_modal";

/**
 * Configure the slash command subcommand metadata
 * @returns Configured SlashCommandSubcommandBuilder
 */
export function configureSubcommand(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName("change")
		.setDescription("Set a custom system prompt to guide my behavior")
		.setDescriptionLocalizations({
			// Add localizations as needed
		});
}

/**
 * Execute the /config prompt change command
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
	// 1. ALL validation BEFORE try-catch block (CLAUDE.md pattern)
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 2. Determine server context (guild or DM)
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

	// 3. Declare modalSubmitInteraction outside try-catch for error handling
	let modalSubmitInteraction: ModalSubmitInteraction | undefined;

	try {
		// 4. Show modal with 4 text fields (first required, others optional)
		const modalResult = await promptWithRawModal(
			interaction,
			locale,
			{
				modalCustomId: MODAL_CUSTOM_ID,
				modalTitleKey: "commands.config.prompt.change.modal_title",
				components: [
					{
						customId: "prompt_part1",
						style: TextInputStyle.Paragraph,
						labelKey: "commands.config.prompt.change.part1_label",
						placeholder: "commands.config.prompt.change.part1_placeholder",
						required: true,
						maxLength: 2000,
					},
					{
						customId: "prompt_part2",
						style: TextInputStyle.Paragraph,
						labelKey: "commands.config.prompt.change.part2_label",
						placeholder: "commands.config.prompt.change.part2_placeholder",
						required: false,
						maxLength: 2000,
					},
					{
						customId: "prompt_part3",
						style: TextInputStyle.Paragraph,
						labelKey: "commands.config.prompt.change.part3_label",
						placeholder: "commands.config.prompt.change.part3_placeholder",
						required: false,
						maxLength: 2000,
					},
					{
						customId: "prompt_part4",
						style: TextInputStyle.Paragraph,
						labelKey: "commands.config.prompt.change.part4_label",
						placeholder: "commands.config.prompt.change.part4_placeholder",
						required: false,
						maxLength: 2000,
					},
				],
			},
			MessageFlags.Ephemeral,
		);

		if (modalResult.outcome !== "submit") {
			log.info(`Modal ${modalResult.outcome}`);
			return;
		}

		// 5. ASSIGN (not declare) modalSubmitInteraction
		modalSubmitInteraction = modalResult.interaction;

		// 6. Safety check for modalSubmitInteraction
		if (!modalSubmitInteraction) {
			log.error("Modal submit interaction is undefined after successful submit");
			return;
		}

		// 7. Extract and concatenate all parts
		const part1 = modalResult.values?.prompt_part1 || "";
		const part2 = modalResult.values?.prompt_part2 || "";
		const part3 = modalResult.values?.prompt_part3 || "";
		const part4 = modalResult.values?.prompt_part4 || "";
		const systemPrompt = (part1 + part2 + part3 + part4).trim();

		// 8. Validate non-empty
		if (!systemPrompt) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.prompt.change.empty_prompt_title",
				descriptionKey:
					"commands.config.prompt.change.empty_prompt_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 9. Update database
		await sql`
			UPDATE tomori_configs
			SET system_prompt = ${systemPrompt}
			WHERE tomori_id = ${tomoriState.tomori_id}
		`;

		// 10. Invalidate cache so next message gets fresh config
		invalidateTomoriStateCache(serverId);

		// 11. Success response with preview
		const preview = systemPrompt.substring(0, 200);
		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: "commands.config.prompt.change.success_title",
			descriptionKey: "commands.config.prompt.change.success_description",
			descriptionVars: { preview },
			color: ColorCode.SUCCESS,
			flags: MessageFlags.Ephemeral,
		});

		log.info(
			`System prompt updated for server ${serverId} (${systemPrompt.length} chars)`,
		);
	} catch (error) {
		log.error("Failed to set custom system prompt:", error as Error);

		// 11. Use correct interaction for error reply (fallback pattern)
		const replyTarget = modalSubmitInteraction ?? interaction;

		await replyInfoEmbed(replyTarget, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
	}
}
