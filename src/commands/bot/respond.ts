import type { SlashCommandSubcommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client, Message } from "discord.js";
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";
import {
	promptWithPaginatedModal,
	replyInfoEmbed,
	safeSelectOptionText,
} from "../../utils/discord/interactionHelper";
import { ColorCode, log } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import type { UserRow } from "../../types/db/schema";
import type { SelectOption } from "../../types/discord/modal";
import tomoriChat from "../../events/messageCreate/tomoriChat";
import {
	loadAllPersonasForServer,
	loadTomoriState,
} from "../../utils/db/dbRead";

/**
 * Configure the respond subcommand
 * @param subcommand - The slash command subcommand builder
 * @returns The configured subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("respond")
		.setDescription(localizer("en-US", "commands.bot.respond.description"));

/**
 * Execute the respond command - manually trigger Tomori to respond to the latest message
 * @param client - Discord client instance
 * @param interaction - Command interaction
 * @param _userData - User data from database (not used)
 * @param locale - Locale of the interaction
 */
export async function execute(
	client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	// 1. Ensure command is run in a guild text channel - let helper functions manage interaction state
	if (!interaction.channel || !("messages" in interaction.channel)) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.guild_only_title",
			descriptionKey: "general.errors.guild_only_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	// 2. Check if bot has required permissions to read message history
	const botMember = interaction.guild?.members.me;
	if (!botMember || !interaction.guild) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	// Get the guild channel (we know it exists from check above, but need type narrowing)
	// Check both regular channels and threads
	const guildChannel = interaction.guild.channels.cache.get(interaction.channel.id)
		?? interaction.channel;

	// Verify it's a guild-based channel with permissions
	if (!("permissionsFor" in guildChannel)) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	const permissions = guildChannel.permissionsFor(botMember);
	if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.ReadMessageHistory)) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.bot.respond.missing_permissions_title",
			descriptionKey: "commands.bot.respond.missing_permissions_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 3. Load tomori state for this server
	const tomoriState = await loadTomoriState(interaction.guild.id);
	if (!tomoriState) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	// 4. Load all personas and check if alters exist
	const allPersonas = await loadAllPersonasForServer(interaction.guild.id);
	const alterPersonas = allPersonas.filter((p) => p.is_alter);
	const mainPersona = allPersonas.find((p) => !p.is_alter);

	let selectedPersona = mainPersona;
	let replyInteraction:
		| ChatInputCommandInteraction
		| import("discord.js").ModalSubmitInteraction = interaction;

	// If alters exist, show selection modal
	if (alterPersonas.length > 0 && mainPersona) {
		// Build select options: main first, then alters
		const personaOptions: SelectOption[] = [
			{
				label: safeSelectOptionText(mainPersona.tomori_nickname),
				value: "0", // main is index 0
				description: localizer(locale, "commands.bot.respond.main_persona_description"),
			},
			...alterPersonas.map((persona, index) => ({
				label: safeSelectOptionText(persona.tomori_nickname),
				value: (index + 1).toString(), // alters start at index 1
				description: localizer(locale, "commands.bot.respond.alter_persona_description"),
			})),
		];

		// Show modal
		const modalResult = await promptWithPaginatedModal(interaction, locale, {
			modalCustomId: "respond_persona_select",
			modalTitleKey: "commands.bot.respond.select_persona_title",
			components: [
				{
					customId: "persona_choice",
					labelKey: "commands.bot.respond.select_persona_label",
					placeholder: "commands.bot.respond.select_persona_placeholder",
					required: true,
					options: personaOptions,
				},
			],
		});

		// Handle modal result
		if (modalResult.outcome !== "submit") {
			log.info(
				`Respond persona selection ${modalResult.outcome} for user ${interaction.user.id}`,
			);
			return;
		}

		// Update the interaction to use for replying
		if (modalResult.interaction) {
			replyInteraction = modalResult.interaction;
		}

		// Extract selected persona
		const selectedIndex = Number.parseInt(
			modalResult.values?.persona_choice ?? "0",
			10,
		);
		selectedPersona =
			selectedIndex === 0 ? mainPersona : alterPersonas[selectedIndex - 1];

		log.info(
			`User ${interaction.user.id} selected persona ${selectedPersona.tomori_nickname} (ID: ${selectedPersona.tomori_id}) for manual respond`,
		);
	}

	try {
		// 5. Get embed visibility setting
		const hideEmbed = tomoriState.config.hide_respond_embed;

		// 6. Build success embed
		const successEmbed = new EmbedBuilder()
			.setTitle(localizer(locale, "commands.bot.respond.success_title"))
			.setDescription(
				localizer(locale, "commands.bot.respond.success_description"),
			)
			.setColor(ColorCode.SUCCESS);

		// Add footer notice if embed is visible
		if (!hideEmbed) {
			successEmbed.setFooter({
				text: localizer(locale, "commands.bot.respond.embed_hide_notice"),
			});
		}

		// 7. Send response (ephemeral if hide_respond_embed is true)
		await replyInteraction.reply({
			embeds: [successEmbed],
			flags: hideEmbed
				? MessageFlags.Ephemeral | MessageFlags.SuppressNotifications
				: MessageFlags.SuppressNotifications,
		});

		// 8. Get the latest message in the channel (excluding the interaction itself)
		const messages = await interaction.channel.messages.fetch({ limit: 1 });
		const latestMessage = messages.first();

		if (!latestMessage) {
			log.warn(
				`No messages found in channel ${interaction.channel.id} for manual respond command.`,
			);
			return;
		}

		// 5. Create a "passport" message that will trigger tomoriChat
		// We need to ensure this message will pass the trigger checks
		// NOTE: tomoriChat has built-in logic (lines 2004-2040) that injects a
		// "[Continue your last message]" prompt when isManuallyTriggered=true
		// and the last message in history is from the bot
		const passportMessage = latestMessage;

		// 6. Manually trigger tomoriChat with command flags
		log.info(
			`Manual respond command triggered by ${interaction.user.id} in channel ${interaction.channel.id} for message ${latestMessage.id}`,
		);

		await tomoriChat(
			client,
			passportMessage as Message,
			false, // isFromQueue
			true, // isManuallyTriggered - this bypasses normal trigger logic
			undefined, // forceReason
			undefined, // reasoningQuery
			undefined, // llmOverrideCodename
			undefined, // isStopResponse
			0, // retryCount
			false, // skipLock
			undefined, // reminderRecipientID
			undefined, // reminderData
			selectedPersona?.tomori_id, // selectedPersonaId
		);
	} catch (error) {
		log.error("Error in bot respond command:", error, {
			errorType: "BotRespondCommandError",
			metadata: {
				userId: interaction.user.id,
				guildId: interaction.guild?.id ?? interaction.user.id,
				channelId: interaction.channel?.id,
			},
		});

		// Try to send error feedback if possible
		try {
			await replyInteraction.followUp({
				content: localizer(locale, "general.errors.unknown_error_description"),
				flags: MessageFlags.Ephemeral,
			});
		} catch (followUpError) {
			log.error(
				"Failed to send error followup for bot respond command:",
				followUpError,
			);
		}
	}
}
