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
 * Configure the headpat subcommand
 * @param subcommand - The slash command subcommand builder
 * @returns The configured subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("headpat")
		.setDescription(localizer("en-US", "commands.reward.headpat.description"));

/**
 * Execute the headpat command - reward the bot and trigger a response
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
			modalCustomId: "reward_headpat_persona_select",
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
				`Headpat persona selection ${modalResult.outcome} for user ${interaction.user.id}`,
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
			`User ${interaction.user.id} selected persona ${selectedPersona.tomori_nickname} (ID: ${selectedPersona.tomori_id}) for headpat reward`,
		);
	}

	try {
		const botName =
			selectedPersona?.tomori_nickname ??
			tomoriState.tomori_nickname ??
			process.env.DEFAULT_BOTNAME ??
			"Tomori";

		// 5. Build headpat embed (always public)
		const headpatEmbed = new EmbedBuilder()
			.setTitle(localizer(locale, "commands.reward.headpat.embed_title"))
			.setDescription(
				localizer(locale, "commands.reward.headpat.embed_description", {
					user: `<@${interaction.user.id}>`,
					bot: botName,
				}),
			)
			.setColor(ColorCode.SUCCESS);

		// 6. Send response (always public, suppress notifications)
		await replyInteraction.reply({
			embeds: [headpatEmbed],
			flags: MessageFlags.SuppressNotifications,
		});

		// 7. Get the latest message in the channel (includes the headpat embed)
		const messages = await interaction.channel.messages.fetch({ limit: 1 });
		const latestMessage = messages.first();

		if (!latestMessage) {
			log.warn(
				`No messages found in channel ${interaction.channel.id} for headpat reward command.`,
			);
			return;
		}

		// 8. Manually trigger tomoriChat (embed already injects headpat context)
		log.info(
			`Headpat reward triggered by ${interaction.user.id} in channel ${interaction.channel.id} for message ${latestMessage.id}`,
		);

		await tomoriChat(
			client,
			latestMessage as Message,
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
			undefined, // isPersonaJob
			undefined, // isUserImpersonation
			undefined, // impersonatedUserId
			undefined, // manualSystemPrompt
		);
	} catch (error) {
		log.error("Error in reward headpat command:", error, {
			errorType: "RewardHeadpatCommandError",
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
				"Failed to send error followup for reward headpat command:",
				followUpError,
			);
		}
	}
}
