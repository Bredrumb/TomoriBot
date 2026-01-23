import {
	TextInputStyle,
	type ChatInputCommandInteraction,
	type Client,
	type ModalSubmitInteraction,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import {
	invalidateTomoriStateCache,
} from "../../../utils/cache/tomoriStateCache";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import {
	promptWithRawModal,
	replyInfoEmbed,
	safeSelectOptionText,
} from "../../../utils/discord/interactionHelper";
import type {
	ErrorContext,
	TomoriState,
	UserRow,
} from "../../../types/db/schema";
import { tomoriConfigSchema, tomoriSchema } from "../../../types/db/schema";
import { sql } from "@/utils/db/client";
import {
	validateMemoryContent,
	getMemoryLimits,
} from "../../../utils/db/memoryLimits";
import type { SelectOption } from "../../../types/discord/modal";
import { loadAllPersonasForServer } from "../../../utils/db/dbRead";

// Get memory limits from environment variables
const memoryLimits = getMemoryLimits();

// Rule 20: Constants for modal configuration
const MODAL_CUSTOM_ID = "server_triggeradd_modal";
const PERSONA_SELECT_ID = "persona_select";
const TRIGGERS_INPUT_ID = "triggers_input";

const MAX_TEXT_INPUT_LENGTH = Math.min(
	4000,
	Math.max(1, memoryLimits.maxTriggerWords * (memoryLimits.maxMemoryLength + 1)),
);

const formatTextArrayLiteral = (items: string[]): string =>
	`{${items.map((item) => `"${item.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;

const formatTriggerList = (triggers: string[]): string =>
	triggers.map((trigger) => `\`${trigger}\``).join(", ");

// Configure the subcommand
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("add")
		.setDescription(
			localizer("en-US", "commands.server.trigger.add.description"),
		);

/**
 * Adds trigger words that will make a selected persona respond automatically when mentioned in chat
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	// Ensure command is run in a guild
	if (!interaction.guild || !interaction.channel) {
		await replyInfoEmbed(interaction, userData.language_pref, {
			titleKey: "general.errors.guild_only_title",
			descriptionKey: "general.errors.guild_only_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	let modalSubmitInteraction: ModalSubmitInteraction | null = null;
	let selectedPersona: TomoriState | null = null;

	try {
		const allPersonas = await loadAllPersonasForServer(interaction.guild.id);
		if (allPersonas.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		const mainSuffix = localizer(
			locale,
			"commands.server.trigger.add.main_suffix",
		);
		const personaSelectOptions: SelectOption[] = allPersonas
			.filter((persona) => persona.tomori_id !== undefined)
			.map((persona) => {
				const personaLabel = persona.is_alter
					? persona.tomori_nickname
					: `${persona.tomori_nickname} ${mainSuffix}`;
				return {
					label: safeSelectOptionText(personaLabel),
					value: persona.tomori_id?.toString() ?? "",
				};
			})
			.filter((option) => option.value !== "");
		if (personaSelectOptions.length === 0) {
			log.error(
				"No selectable personas found while building trigger add modal options",
			);
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		const modalResult = await promptWithRawModal(interaction, locale, {
			modalCustomId: MODAL_CUSTOM_ID,
			modalTitleKey: "commands.server.trigger.add.modal_title",
			components: [
				{
					customId: PERSONA_SELECT_ID,
					labelKey: "commands.server.trigger.add.persona_select_label",
					descriptionKey:
						"commands.server.trigger.add.persona_select_description",
					placeholder: "commands.server.trigger.add.persona_select_placeholder",
					required: true,
					options: personaSelectOptions,
				},
				{
					customId: TRIGGERS_INPUT_ID,
					labelKey: "commands.server.trigger.add.triggers_input_label",
					descriptionKey:
						"commands.server.trigger.add.triggers_input_description",
					placeholder: "commands.server.trigger.add.triggers_input_placeholder",
					style: TextInputStyle.Paragraph,
					required: true,
					maxLength: MAX_TEXT_INPUT_LENGTH,
				},
			],
		});

		if (modalResult.outcome !== "submit") {
			log.info(
				`Trigger word add modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees interaction exists
		modalSubmitInteraction = modalResult.interaction!;
		const selectedPersonaId = modalResult.values?.[PERSONA_SELECT_ID];
		const triggerInput = modalResult.values?.[TRIGGERS_INPUT_ID];

		if (!selectedPersonaId || triggerInput === undefined) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		selectedPersona =
			allPersonas.find(
				(persona) => persona.tomori_id?.toString() === selectedPersonaId,
			) ?? null;

		if (!selectedPersona) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		const currentTriggerWords = selectedPersona.is_alter
			? selectedPersona.alter_triggers ?? []
			: selectedPersona.config?.trigger_words ?? [];

		const parsedTriggers = triggerInput
			.split(/[,\u3001]/)
			.map((trigger) => trigger.trim().toLowerCase())
			.filter((trigger) => trigger.length > 0);

		const uniqueTriggers: string[] = [];
		const seenTriggers = new Set<string>();
		for (const trigger of parsedTriggers) {
			if (!seenTriggers.has(trigger)) {
				seenTriggers.add(trigger);
				uniqueTriggers.push(trigger);
			}
		}

		if (uniqueTriggers.length === 0) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.server.trigger.add.no_triggers_title",
				descriptionKey: "commands.server.trigger.add.no_triggers_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		for (const trigger of uniqueTriggers) {
			if (trigger.length < 2) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "commands.server.trigger.add.too_short_title",
					descriptionKey: "commands.server.trigger.add.too_short_description",
					color: ColorCode.ERROR,
				});
				return;
			}

			const contentValidation = validateMemoryContent(trigger);
			if (!contentValidation.isValid) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "commands.server.trigger.add.content_too_long_title",
					descriptionKey:
						"commands.server.trigger.add.content_too_long_description",
					descriptionVars: { max_length: memoryLimits.maxMemoryLength },
					color: ColorCode.ERROR,
				});
				return;
			}
		}

		const existingTriggers = new Set(
			currentTriggerWords.map((trigger) => trigger.toLowerCase()),
		);
		const newTriggers = uniqueTriggers.filter(
			(trigger) => !existingTriggers.has(trigger),
		);

		if (newTriggers.length === 0) {
			const descriptionKey =
				uniqueTriggers.length === 1
					? "commands.server.trigger.add.already_exists_description"
					: "commands.server.trigger.add.already_exists_multiple_description";
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.server.trigger.add.already_exists_title",
				descriptionKey,
				descriptionVars:
					uniqueTriggers.length === 1
						? { word: uniqueTriggers[0] }
						: { words: formatTriggerList(uniqueTriggers) },
				color: ColorCode.WARN,
			});
			return;
		}

		const updatedTriggerCount = currentTriggerWords.length + newTriggers.length;
		if (updatedTriggerCount > memoryLimits.maxTriggerWords) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.server.trigger.add.limit_exceeded_title",
				descriptionKey:
					"commands.server.trigger.add.limit_exceeded_description",
				descriptionVars: {
					current_count: currentTriggerWords.length.toString(),
					max_allowed: memoryLimits.maxTriggerWords.toString(),
				},
				color: ColorCode.ERROR,
			});
			return;
		}

		const triggerArrayLiteral = formatTextArrayLiteral(newTriggers);
		const personaId = selectedPersona.tomori_id ?? null;
		if (!personaId) {
			log.error("Selected persona missing tomori_id - this should never happen");
			return;
		}

		if (selectedPersona.is_alter) {
			const [updatedPersona] = await sql`
				UPDATE tomoris
				SET alter_triggers = array_cat(alter_triggers, ${triggerArrayLiteral}::text[])
				WHERE tomori_id = ${personaId}
				RETURNING *
			`;

			const validatedPersona = tomoriSchema.safeParse(updatedPersona);
			if (!validatedPersona.success || !updatedPersona) {
				const context: ErrorContext = {
					tomoriId: personaId,
					userId: userData.user_id,
					serverId: selectedPersona.server_id,
					errorType: "DatabaseUpdateError",
					metadata: {
						command: "config triggeradd",
						guildId: interaction.guild.id,
						wordAdded: newTriggers,
						updatedField: "alter_triggers",
						targetTable: "tomoris",
						validationErrors: validatedPersona.success
							? null
							: validatedPersona.error.flatten(),
					},
				};
				await log.error(
					"Failed to update or validate alter_triggers in tomoris table",
					validatedPersona.success
						? new Error("Database UPDATE failed to return updated row")
						: new Error("Updated tomori data failed validation"),
					context,
				);

				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.update_failed_title",
					descriptionKey: "general.errors.update_failed_description",
					color: ColorCode.ERROR,
				});
				return;
			}
		} else {
			const [updatedConfig] = await sql`
				UPDATE tomori_configs
				SET trigger_words = array_cat(trigger_words, ${triggerArrayLiteral}::text[])
				WHERE server_id = ${selectedPersona.server_id}
				RETURNING *
			`;

			const validatedConfig = tomoriConfigSchema.safeParse(updatedConfig);
			if (!validatedConfig.success || !updatedConfig) {
				const context: ErrorContext = {
					tomoriId: personaId,
					userId: userData.user_id,
					serverId: selectedPersona.server_id,
					errorType: "DatabaseUpdateError",
					metadata: {
						command: "config triggeradd",
						guildId: interaction.guild.id,
						wordAdded: newTriggers,
						updatedField: "trigger_words",
						targetTable: "tomori_configs",
						validationErrors: validatedConfig.success
							? null
							: validatedConfig.error.flatten(),
					},
				};
				await log.error(
					"Failed to update or validate trigger_words in tomori_configs table",
					validatedConfig.success
						? new Error("Database UPDATE failed to return updated row")
						: new Error("Updated config data failed validation"),
					context,
				);

				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.update_failed_title",
					descriptionKey: "general.errors.update_failed_description",
					color: ColorCode.ERROR,
				});
				return;
			}
		}

		// Invalidate cache so next message gets fresh config
		invalidateTomoriStateCache(interaction.guild.id);

		const personaDisplayName = selectedPersona.is_alter
			? selectedPersona.tomori_nickname
			: `${selectedPersona.tomori_nickname} ${mainSuffix}`;

		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: "commands.server.trigger.add.success_title",
			descriptionKey: "commands.server.trigger.add.success_description",
			descriptionVars: {
				persona_name: personaDisplayName,
				added_words: formatTriggerList(newTriggers),
				added_count: newTriggers.length.toString(),
				word_count: updatedTriggerCount.toString(),
			},
			color: ColorCode.SUCCESS,
		});
	} catch (error) {
		const context: ErrorContext = {
			errorType: "CommandExecutionError",
			metadata: {
				command: "config triggeradd",
				guildId: interaction.guild.id,
				personaId: selectedPersona?.tomori_id ?? null,
			},
		};
		await log.error("Error in /config triggeradd command", error, context);

		const errorReplyInteraction = modalSubmitInteraction ?? interaction;

		await replyInfoEmbed(errorReplyInteraction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
		});
	}
}
