import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import {
	type UserRow,
	type ErrorContext,
	tomoriConfigSchema,
} from "../../types/db/schema";
import { sql } from "@/utils/db/client";

export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("uncensors")
		.setDescription(localizer("en-US", "commands.config.uncensors.description"))
		.addStringOption((option) =>
			option
				.setName("uncensor")
				.setDescription(
					localizer("en-US", "commands.config.uncensors.option_description"),
				)
				.setRequired(true)
				.addChoices(
					{
						name: localizer(
							"en-US",
							"commands.config.uncensors.injection_option",
						),
						value: "injection",
						name_localizations: {
							ja: localizer("ja", "commands.config.uncensors.injection_option"),
						},
					},
					{
						name: localizer(
							"en-US",
							"commands.config.uncensors.unicode_spaces_option",
						),
						value: "unicode_spaces",
						name_localizations: {
							ja: localizer(
								"ja",
								"commands.config.uncensors.unicode_spaces_option",
							),
						},
					},
					{
						name: localizer(
							"en-US",
							"commands.config.uncensors.sanitize_option",
						),
						value: "sanitize",
						name_localizations: {
							ja: localizer("ja", "commands.config.uncensors.sanitize_option"),
						},
					},
				),
		)
		.addStringOption((option) =>
			option
				.setName("set")
				.setDescription(
					localizer("en-US", "commands.config.uncensors.set_description"),
				)
				.setRequired(true)
				.addChoices(
					{
						name: localizer("en-US", "commands.config.options.enable"),
						value: "enable",
					},
					{
						name: localizer("en-US", "commands.config.options.disable"),
						value: "disable",
					},
				),
		);

export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, userData.language_pref, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	try {
		const uncensorChoice = interaction.options.getString("uncensor", true);
		const setAction = interaction.options.getString("set", true);
		const isEnabled = setAction === "enable";

		const tomoriState = await getCachedTomoriState(
			interaction.guild?.id ?? interaction.user.id,
		);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		let dbColumnName = "";
		let uncensorTypeKey = "";
		let currentSetting: boolean | undefined;

		switch (uncensorChoice) {
			case "injection":
				dbColumnName = "uncensor_injection_enabled";
				uncensorTypeKey = "commands.config.uncensors.injection_option";
				currentSetting = tomoriState.config.uncensor_injection_enabled;
				break;
			case "unicode_spaces":
				dbColumnName = "uncensor_unicode_space_enabled";
				uncensorTypeKey = "commands.config.uncensors.unicode_spaces_option";
				currentSetting = tomoriState.config.uncensor_unicode_space_enabled;
				break;
			case "sanitize":
				dbColumnName = "uncensor_sanitize_enabled";
				uncensorTypeKey = "commands.config.uncensors.sanitize_option";
				currentSetting = tomoriState.config.uncensor_sanitize_enabled;
				break;
			default:
				log.error(
					`Invalid uncensorChoice received in /config uncensors: ${uncensorChoice}`,
				);
				await replyInfoEmbed(interaction, locale, {
					titleKey: "general.errors.invalid_option_title",
					descriptionKey: "general.errors.invalid_option_description",
					color: ColorCode.ERROR,
				});
				return;
		}

		if (currentSetting === isEnabled) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.uncensors.already_set_title",
				descriptionKey: isEnabled
					? "commands.config.uncensors.already_enabled_description"
					: "commands.config.uncensors.already_disabled_description",
				descriptionVars: {
					uncensor_type: localizer(locale, uncensorTypeKey),
				},
				color: ColorCode.WARN,
			});
			return;
		}

		const [updatedRow] = await sql`
            UPDATE tomori_configs
            SET ${sql.unsafe(dbColumnName)} = ${isEnabled}
            WHERE server_id = ${tomoriState.server_id}
            RETURNING *
        `;

		const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);
		if (!validatedConfig.success || !updatedRow) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "DatabaseUpdateError",
				metadata: {
					command: "config uncensors",
					guildId: interaction.guild?.id ?? interaction.user.id,
					uncensorChoice,
					dbColumnName,
					isEnabled,
					validationErrors: validatedConfig.success
						? null
						: validatedConfig.error.flatten(),
				},
			};
			await log.error(
				"Failed to update or validate Tomori uncensor config",
				validatedConfig.success
					? new Error("Database update returned no rows or unexpected data")
					: new Error("Updated config data failed validation"),
				context,
			);

			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.update_failed_title",
				descriptionKey: "general.errors.update_failed_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

		const descriptionKey = isEnabled
			? "commands.config.uncensors.enabled_success"
			: "commands.config.uncensors.disabled_success";
		let description = localizer(locale, descriptionKey, {
			uncensor_type: localizer(locale, uncensorTypeKey),
		});

		if (uncensorChoice === "injection" && isEnabled) {
			description += `\n\n${localizer(
				locale,
				"commands.config.uncensors.injection_ack_notice",
			)}`;
		}

		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.uncensors.success_title",
			description,
			color: isEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
		});
	} catch (error) {
		let serverIdForError: number | null = null;
		let tomoriIdForError: number | null = null;
		if (interaction.guild?.id) {
			const state = await getCachedTomoriState(interaction.guild.id);
			serverIdForError = state?.server_id ?? null;
			tomoriIdForError = state?.tomori_id ?? null;
		}

		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: serverIdForError,
			tomoriId: tomoriIdForError,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config uncensors",
				guildId: interaction.guild?.id ?? interaction.user.id,
				executorDiscordId: interaction.user.id,
				uncensorAttempted: interaction.options.getString("uncensor"),
				actionAttempted: interaction.options.getString("set"),
			},
		};
		await log.error(
			`Error executing /config uncensors for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		if (!interaction.replied && !interaction.deferred) {
			await interaction.reply({
				content: localizer(locale, "general.errors.unknown_error_description"),
				flags: MessageFlags.Ephemeral,
			});
		} else {
			await interaction.followUp({
				content: localizer(locale, "general.errors.unknown_error_description"),
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
