import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
// Import sql
import { sql } from "@/utils/db/client";
import {
	getCachedTomoriState,
	invalidateTomoriStateCache,
} from "../../../utils/cache/tomoriStateCache";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithRawModal,
	safeSelectOptionText,
} from "../../../utils/discord/interactionHelper";
// Import types for validation
import {
	type UserRow,
	type ErrorContext,
	tomoriConfigSchema,
} from "../../../types/db/schema";
import type { SelectOption } from "../../../types/discord/modal";

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_model_image_modal";
const MODEL_SELECT_ID = "model_select";

/**
 * Type definition for image diffusion model row
 */
interface ImageDiffusionModelRow {
	diffusion_model_id: number;
	provider: string;
	codename: string;
	model_description: string | null;
	ja_description: string | null;
	is_default: boolean;
	is_deprecated: boolean;
	is_free: boolean;
	is_uncensored: boolean;
}

/**
 * Helper function to get localized image model description based on user's locale
 * @param model - Image diffusion model row from database
 * @param locale - User's preferred locale (e.g., "ja", "en-US")
 * @returns Localized description with flags prepended (e.g., "(FREE+UNCENSORED) Description")
 */
function getLocalizedDescription(
	model: ImageDiffusionModelRow,
	locale: string,
): string {
	// Normalize locale to handle variations (e.g., "ja-JP" -> "ja")
	const normalizedLocale = locale.toLowerCase().split("-")[0];

	// Select description based on locale
	let description: string | null | undefined;
	if (normalizedLocale === "ja") {
		description = model.ja_description;
	} else {
		description = model.model_description;
	}

	// Fallback chain: locale-specific -> default -> provider fallback
	const baseDescription =
		description || model.model_description || `${model.provider} model`;

	// Build flags array based on model capabilities
	const flags: string[] = [];
	if (model.is_free) flags.push("FREE");
	if (model.is_uncensored) flags.push("UNCENSORED");

	// Prepend flags with + connector if any exist
	const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
	return `${flagPrefix}${baseDescription}`;
}

// Configure the subcommand
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("image")
		.setDescription(
			localizer("en-US", "commands.config.model.image.description"),
		);

/**
 * Changes Tomori's image diffusion model
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
	// 1. Ensure command is run in a channel
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, userData.language_pref, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	// 2. Load the Tomori state for this server
	const tomoriState = await getCachedTomoriState(
		interaction.guild?.id ?? interaction.user.id,
	);
	if (!tomoriState) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.tomori_not_setup_title",
			descriptionKey: "general.errors.tomori_not_setup_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 3. Check if an API key is configured
	if (!tomoriState.config.api_key) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.model.image.no_api_key_title",
			descriptionKey: "commands.config.model.image.no_api_key_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 4. Get current LLM provider (for filtering compatible image models)
	const currentProvider = tomoriState.llm.llm_provider;

	// 5. Load available diffusion models filtered by current provider
	const availableModels = await sql<ImageDiffusionModelRow[]>`
        SELECT dm.diffusion_model_id, dm.provider, dm.codename,
               dm.model_description, dm.ja_description,
               dm.is_default, dm.is_deprecated, dm.is_free, dm.is_uncensored
        FROM image_diffusion_models dm
        WHERE dm.provider = ${currentProvider}
          AND dm.is_deprecated = false
        ORDER BY dm.is_default DESC, dm.codename
    `;

	if (!availableModels || availableModels.length === 0) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.model.image.no_models_title",
			descriptionKey: "commands.config.model.image.no_models_description",
			descriptionVars: {
				provider: currentProvider,
			},
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Track modal submit interaction and selected model for error handling in catch block
	let modalSubmitInteraction:
		| import("discord.js").ModalSubmitInteraction
		| undefined;
	let selectedModel: ImageDiffusionModelRow | null = null; // For error context and logic

	try {

		// 5. Create model options for the select menu using localized descriptions
		const modelSelectOptions: SelectOption[] = availableModels.map(
			(model) => ({
				label: safeSelectOptionText(model.codename), // Use codename as display label
				value: safeSelectOptionText(model.diffusion_model_id.toString()), // Use diffusion_model_id as value
				description: safeSelectOptionText(
					getLocalizedDescription(model, userData.language_pref),
				), // Use locale-specific description with flags
			}),
		);

		// 6. Show the modal with model selection
		const modalResult = await promptWithRawModal(
			interaction,
			locale,
			{
				modalCustomId: MODAL_CUSTOM_ID,
				modalTitleKey: "commands.config.model.image.modal_title",
				components: [
					{
						customId: MODEL_SELECT_ID,
						labelKey: "commands.config.model.image.select_label",
						descriptionKey: "commands.config.model.image.select_description",
						placeholder: "commands.config.model.image.select_placeholder",
						required: true,
						options: modelSelectOptions,
					},
				],
			},
			MessageFlags.Ephemeral, // Auto-defer with ephemeral flag
		);

		// 7. Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`Image model selection modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		// Extract values from the modal
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		modalSubmitInteraction = modalResult.interaction!;
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		const selectedModelIdStr = modalResult.values![MODEL_SELECT_ID];

		// 8. Find the selected model details by diffusion_model_id
		const selectedModelId = Number.parseInt(selectedModelIdStr, 10);
		selectedModel =
			availableModels.find(
				(model) => model.diffusion_model_id === selectedModelId,
			) ?? null;

		if (!selectedModel?.diffusion_model_id) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "CommandExecutionError",
				metadata: {
					command: "config model image",
					guildId: interaction.guild?.id ?? interaction.user.id,
					requestedModelId: selectedModelIdStr,
					availableModels: availableModels.map((m) => m.diffusion_model_id),
				},
			};
			// Log the error even if it seems impossible due to modal choices
			await log.error(
				"Selected model ID not found in available diffusion models from DB",
				new Error("Invalid model selection despite modal choices"),
				context,
			);

			await modalSubmitInteraction.editReply({
				content: localizer(
					locale,
					"commands.config.model.image.invalid_model_description",
				),
			});
			return;
		}

		// 9. Check if this is the same as the current model
		if (selectedModel.diffusion_model_id === tomoriState.config.diffusion_model_id) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.model.image.already_selected_title",
				descriptionKey:
					"commands.config.model.image.already_selected_description",
				descriptionVars: {
					model_name: selectedModel.codename,
				},
				color: ColorCode.WARN,
			});
			return;
		}

		// 10. Update the config in the database using direct SQL
		const [updatedRow] = await sql`
            UPDATE tomori_configs
            SET diffusion_model_id = ${selectedModel.diffusion_model_id}
            WHERE tomori_id = ${tomoriState.tomori_id}
            RETURNING *
        `;

		// 11. Validate the returned data
		const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);

		if (!validatedConfig.success || !updatedRow) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "DatabaseUpdateError",
				metadata: {
					command: "config model image",
					guildId: interaction.guild?.id ?? interaction.user.id,
					selectedModelCodename: selectedModel.codename,
					targetDiffusionModelId: selectedModel.diffusion_model_id,
					validationErrors: validatedConfig.success
						? null
						: validatedConfig.error.flatten(),
				},
			};
			await log.error(
				"Failed to update or validate diffusion model config after DB update",
				validatedConfig.success
					? new Error("Database update returned no rows or unexpected data")
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

		// 12. Invalidate cache so next message gets fresh config
		invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

		// 13. Success message
		// Find previous model name
		const previousModel = availableModels.find(
			(model) => model.diffusion_model_id === tomoriState.config.diffusion_model_id,
		);

		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: "commands.config.model.image.success_title",
			descriptionKey: "commands.config.model.image.success_description",
			descriptionVars: {
				model_name: selectedModel.codename,
				previous_model:
					previousModel?.codename ||
					localizer(locale, "commands.config.model.image.current_none"),
			},
			color: ColorCode.SUCCESS,
		});
	} catch (error) {
		// 13. Log error with context
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
				command: "config model image",
				guildId: interaction.guild?.id ?? interaction.user.id,
				executorDiscordId: interaction.user.id,
				targetDiffusionModelIdAttempted: selectedModel?.diffusion_model_id,
			},
		};
		await log.error(
			`Error executing /config model image for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		// 14. Inform user of unknown error
		// Use modalSubmitInteraction if available (error after modal), otherwise interaction (error during modal)
		const replyTarget = modalSubmitInteraction ?? interaction;
		await replyInfoEmbed(replyTarget, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
	}
}
