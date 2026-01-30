import type {
	Client,
	ChatInputCommandInteraction,
	TextChannel,
} from "discord.js";
import {
	MessageFlags,
	type SlashCommandSubcommandBuilder,
	EmbedBuilder,
	ChannelType,
} from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { ColorCode, log } from "@/utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithPaginatedModal,
	safeSelectOptionText,
} from "@/utils/discord/interactionHelper";
import { loadAllPersonasForServer } from "@/utils/db/dbRead";
import {
	getOrCreateWebhook,
	sendAsPersona,
} from "@/utils/discord/webhookManager";
import type { SelectOption } from "@/types/discord/modal";
import type { UserRow } from "@/types/db/schema";
import tomoriChat from "@/events/messageCreate/tomoriChat";

/**
 * Configures the /bot impersonate subcommand
 * @param subcommand - The slash command subcommand builder
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) => {
	return subcommand
		.setName("impersonate")
		.setDescription(localizer("en-US", "commands.bot.impersonate.description"))
		.addStringOption((option) =>
			option
				.setName("target")
				.setDescription(
					localizer("en-US", "commands.bot.impersonate.target_description"),
				)
				.setRequired(true)
				.addChoices(
					{
						name: localizer("en-US", "commands.bot.impersonate.target_persona"),
						value: "persona",
						name_localizations: {
							ja: localizer("ja", "commands.bot.impersonate.target_persona"),
						},
					},
					{
						name: localizer("en-US", "commands.bot.impersonate.target_me"),
						value: "me",
						name_localizations: {
							ja: localizer("ja", "commands.bot.impersonate.target_me"),
						},
					},
					{
						name: localizer("en-US", "commands.bot.impersonate.target_system"),
						value: "system",
						name_localizations: {
							ja: localizer("ja", "commands.bot.impersonate.target_system"),
						},
					},
				),
		);
};

/**
 * Handles persona impersonation - user sends messages as bot personas
 * @param client - Discord client
 * @param interaction - Command interaction
 * @param locale - User's locale
 */
async function handlePersonaImpersonation(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	locale: string,
): Promise<void> {
	if (!interaction.guild || !interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.bot.impersonate.missing_permissions_title",
			descriptionKey:
				"commands.bot.impersonate.missing_permissions_description",
			color: ColorCode.WARN,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Narrow channel type to TextChannel
	if (interaction.channel.type !== ChannelType.GuildText) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.bot.impersonate.missing_permissions_title",
			descriptionKey:
				"commands.bot.impersonate.missing_permissions_description",
			color: ColorCode.WARN,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const serverId = interaction.guild.id;
	const channel = interaction.channel as TextChannel;

	// 1. Load all personas (main + alters) - keep this under 3 seconds
	const allPersonas = await loadAllPersonasForServer(serverId);
	if (!allPersonas || allPersonas.length === 0) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.bot.impersonate.no_personas_title",
			descriptionKey: "commands.bot.impersonate.no_personas_description",
			color: ColorCode.WARN,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 2. Build select options for modal
	const personaSelectOptions: SelectOption[] = allPersonas.map(
		(persona, index) => ({
			label: safeSelectOptionText(persona.tomori_nickname),
			value: index.toString(), // Use index to avoid ID truncation issues
			description: persona.is_alter ? "Alter Persona" : "Main Persona",
		}),
	);

	// 3. Show modal with persona select + message text area
	// DO NOT defer before modal - Pattern 3
	const modalResult = await promptWithPaginatedModal(interaction, locale, {
		modalCustomId: "impersonate_persona_modal",
		modalTitleKey: "commands.bot.impersonate.persona_modal_title",
		components: [
			{
				customId: "persona_select",
				labelKey: "commands.bot.impersonate.persona_select_label",
				placeholder: localizer(
					locale,
					"commands.bot.impersonate.persona_select_placeholder",
				),
				required: true,
				options: personaSelectOptions,
			},
			{
				customId: "message_content",
				labelKey: "commands.bot.impersonate.persona_message_label",
				placeholder: localizer(
					locale,
					"commands.bot.impersonate.persona_message_placeholder",
				),
				required: true,
				minLength: 1,
				maxLength: 2000,
				style: 2, // TextInputStyle.Paragraph
			},
		],
	});

	// 4. Process modal submission
	if (
		modalResult.outcome !== "submit" ||
		!modalResult.values ||
		!modalResult.interaction
	) {
		return;
	}

	// Ensure submission is deferred
	if (!modalResult.interaction.deferred && !modalResult.interaction.replied) {
		await modalResult.interaction.deferReply({ flags: MessageFlags.Ephemeral });
	}

	const selectedIndex = Number.parseInt(
		modalResult.values.persona_select || "0",
		10,
	);
	const messageContent = modalResult.values.message_content || "";

	const selectedPersona = allPersonas[selectedIndex];
	if (!selectedPersona || !selectedPersona.tomori_id) {
		log.error(
			`Selected persona at index ${selectedIndex} not found in persona list`,
		);
		await replyInfoEmbed(modalResult.interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	try {
		// 5. Check hide_impersonation_embeds permission
		const tomoriState = allPersonas[0]; // Main persona has config
		const shouldHideEmbed =
			tomoriState?.config?.hide_impersonation_embeds ?? false;

		// 6. Build impersonation notice embed if needed
		const embeds: EmbedBuilder[] = [];
		if (!shouldHideEmbed) {
			const noticeEmbed = new EmbedBuilder()
				.setTitle(
					localizer(
						locale,
						"commands.bot.impersonate.impersonation_notice_title",
						{ user: interaction.user.username },
					),
				)
				.setFooter({
					text: localizer(
						locale,
						"commands.bot.impersonate.impersonation_notice_footer",
					),
				})
				.setColor(ColorCode.INFO);
			embeds.push(noticeEmbed);
		}

		// 7. Send message based on persona type
		if (!selectedPersona.is_alter) {
			// Main persona: Send as bot directly with embeds
			await channel.send({
				content: messageContent,
				embeds,
			});
		} else {
			// Alter persona: Send via webhook with embeds
			const { webhook, errorReason } = await getOrCreateWebhook(channel);
			if (!webhook) {
				await replyInfoEmbed(modalResult.interaction, locale, {
					titleKey: "commands.bot.impersonate.webhook_error_title",
					descriptionKey: "commands.bot.impersonate.webhook_error_description",
					descriptionVars: { error: errorReason || "Failed to create webhook" },
					color: ColorCode.ERROR,
				});
				return;
			}

			await sendAsPersona(webhook, selectedPersona, messageContent, {
				embeds,
			});
		}

		// 8. Send success confirmation to user
		await replyInfoEmbed(modalResult.interaction, locale, {
			titleKey: "commands.bot.impersonate.persona_success_title",
			descriptionKey: "commands.bot.impersonate.persona_success_description",
			descriptionVars: { persona: selectedPersona.tomori_nickname },
			color: ColorCode.SUCCESS,
		});
	} catch (error) {
		log.error("Failed to send impersonated message", {
			error,
			personaId: selectedPersona.tomori_id,
			serverId,
		});
		await replyInfoEmbed(modalResult.interaction, locale, {
			titleKey: "commands.bot.impersonate.webhook_error_title",
			descriptionKey: "commands.bot.impersonate.webhook_error_description",
			descriptionVars: {
				error: error instanceof Error ? error.message : "Unknown error",
			},
			color: ColorCode.ERROR,
		});
	}
}

/**
 * Handles user impersonation - bot mimics the user through webhook
 * @param client - Discord client
 * @param interaction - Command interaction
 * @param locale - User's locale
 */
async function handleUserImpersonation(
	client: Client,
	interaction: ChatInputCommandInteraction,
	locale: string,
): Promise<void> {
	if (!interaction.guild || !interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.bot.impersonate.missing_permissions_title",
			descriptionKey:
				"commands.bot.impersonate.missing_permissions_description",
			color: ColorCode.WARN,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Narrow channel type to TextChannel
	if (interaction.channel.type !== ChannelType.GuildText) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.bot.impersonate.missing_permissions_title",
			descriptionKey:
				"commands.bot.impersonate.missing_permissions_description",
			color: ColorCode.WARN,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const channel = interaction.channel as TextChannel;

	// 1. Defer the interaction immediately (Pattern 2 - async work ahead)
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	try {
		// 2. Get the latest message in the channel to use as a "passport"
		// Same pattern as /bot respond - no placeholder message needed
		const messages = await channel.messages.fetch({ limit: 1 });
		const latestMessage = messages.first();

		if (!latestMessage) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.bot.impersonate.no_messages_title",
				descriptionKey: "commands.bot.impersonate.no_messages_description",
				color: ColorCode.WARN,
			});
			return;
		}

		// 3. Call tomoriChat with user impersonation enabled
		// tomoriChat will handle everything: context building, refresh embeds, provider call, webhook, etc.
		await tomoriChat(
			client,
			latestMessage,
			false, // Not from queue
			true, // isManuallyTriggered - bypasses bot author check
			undefined, // No forced reasoning
			undefined, // No reasoning query
			undefined, // No LLM override
			false, // Not a stop response
			0, // No retry count
			false, // Don't skip lock
			undefined, // No reminder recipient
			undefined, // No reminder data
			undefined, // No selected persona
			false, // Not a persona job
			true, // isUserImpersonation - enables role reversal
			interaction.user.id, // impersonatedUserId - the user to mimic
		);

		// 4. Send success confirmation
		const member = interaction.guild.members.cache.get(interaction.user.id);
		const displayName =
			member?.displayName || member?.user.displayName || "User";

		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(
						localizer(locale, "commands.bot.impersonate.me_success_title"),
					)
					.setDescription(
						localizer(
							locale,
							"commands.bot.impersonate.me_success_description",
							{ user: displayName },
						),
					)
					.setColor(ColorCode.SUCCESS),
			],
		});
	} catch (error) {
		log.error("Failed to handle user impersonation", {
			error,
			userId: interaction.user.id,
			guildId: interaction.guild?.id,
		});

		// Check if interaction is still valid before replying
		if (interaction.deferred || interaction.replied) {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "commands.bot.impersonate.webhook_error_title"),
						)
						.setDescription(
							localizer(
								locale,
								"commands.bot.impersonate.webhook_error_description",
								{
									error:
										error instanceof Error ? error.message : "Unknown error",
								},
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
		}
	}
}

/**
 * Handles system impersonation - user injects system prompts as embeds
 * @param interaction - Command interaction
 * @param locale - User's locale
 */
async function handleSystemImpersonation(
	interaction: ChatInputCommandInteraction,
	locale: string,
): Promise<void> {
	if (!interaction.guild || !interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.bot.impersonate.missing_permissions_title",
			descriptionKey:
				"commands.bot.impersonate.missing_permissions_description",
			color: ColorCode.WARN,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Narrow channel type to TextChannel
	if (interaction.channel.type !== ChannelType.GuildText) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.bot.impersonate.missing_permissions_title",
			descriptionKey:
				"commands.bot.impersonate.missing_permissions_description",
			color: ColorCode.WARN,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const channel = interaction.channel as TextChannel;

	// 1. Show modal for system prompt content
	// DO NOT defer before modal - Pattern 3
	const modalResult = await promptWithPaginatedModal(interaction, locale, {
		modalCustomId: "impersonate_system_modal",
		modalTitleKey: "commands.bot.impersonate.system_modal_title",
		components: [
			{
				customId: "system_content",
				labelKey: "commands.bot.impersonate.system_content_label",
				placeholder: localizer(
					locale,
					"commands.bot.impersonate.system_content_placeholder",
				),
				required: true,
				minLength: 1,
				maxLength: 4000,
				style: 2, // TextInputStyle.Paragraph
			},
		],
	});

	// 2. Process modal submission
	if (
		modalResult.outcome !== "submit" ||
		!modalResult.values ||
		!modalResult.interaction
	) {
		return;
	}

	// Ensure submission is deferred
	if (!modalResult.interaction.deferred && !modalResult.interaction.replied) {
		await modalResult.interaction.deferReply({ flags: MessageFlags.Ephemeral });
	}

	const systemContent = modalResult.values.system_content || "";

	// 3. Create embed with "System Message" title (triggers detection in tomoriChat)
	const embed = new EmbedBuilder()
		.setTitle(localizer(locale, "commands.bot.impersonate.system_title"))
		.setDescription(systemContent)
		.setColor(ColorCode.SECTION);

	// Add footer showing who injected the prompt
	embed.setFooter({
		text: localizer(locale, "commands.bot.impersonate.system_injected_footer", {
			user: interaction.user.username,
		}),
	});

	// 4. Send as public message in the channel (not ephemeral - this is the injection)
	await channel.send({
		embeds: [embed],
	});

	// 5. Send confirmation to user
	await replyInfoEmbed(modalResult.interaction, locale, {
		titleKey: "commands.bot.impersonate.system_success_title",
		descriptionKey: "commands.bot.impersonate.system_success_description",
		color: ColorCode.SUCCESS,
	});
}

/**
 * Executes the /bot impersonate command
 * @param client - Discord client
 * @param interaction - Command interaction
 * @param userData - User data from database (unused)
 * @param locale - User's locale
 */
export async function execute(
	client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	// 1. Fast validation
	if (!interaction.guild) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.guild_only_title",
			descriptionKey: "general.errors.guild_only_description",
			color: ColorCode.WARN,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 2. Get target option
	const target = interaction.options.getString("target", true);

	// 3. Route to appropriate handler
	switch (target) {
		case "persona":
			await handlePersonaImpersonation(client, interaction, locale);
			break;
		case "me":
			await handleUserImpersonation(client, interaction, locale);
			break;
		case "system":
			await handleSystemImpersonation(interaction, locale);
			break;
		default:
			log.error(`Invalid target option: ${target}`);
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.WARN,
				flags: MessageFlags.Ephemeral,
			});
	}
}
