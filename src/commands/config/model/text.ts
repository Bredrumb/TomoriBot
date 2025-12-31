import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
// Import sql
import { sql } from "@/utils/db/client";
import {
	loadTomoriState,
	loadAvailableModelsForProvider,
} from "../../../utils/db/dbRead";
// Remove updateTomoriConfig import
// import { updateTomoriConfig } from "../../../utils/db/dbWrite";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithRawModal,
	safeSelectOptionText,
} from "../../../utils/discord/interactionHelper";
// Import TomoriConfigRow for validation and LlmRow for type hints
import {
	type UserRow,
	type ErrorContext,
	tomoriConfigSchema,
	type LlmRow,
} from "../../../types/db/schema";
import type { SelectOption } from "../../../types/discord/modal";

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_model_text_modal";
const MODEL_SELECT_ID = "model_select";

/**
 * Helper function to get localized LLM description based on user's locale
 * @param model - LLM model row from database
 * @param locale - User's preferred locale (e.g., "ja", "en-US")
 * @returns Localized description with flags prepended (e.g., "(FREE+TOOLS) Description")
 */
function getLocalizedDescription(model: LlmRow, locale: string): string {
	// Normalize locale to handle variations (e.g., "ja-JP" -> "ja")
	const normalizedLocale = locale.toLowerCase().split("-")[0];

	// Select description based on locale
	let description: string | null | undefined;
	if (normalizedLocale === "ja") {
		description = model.ja_description;
	} else {
		description = model.llm_description;
	}

	// Fallback chain: locale-specific -> default -> provider fallback
	const baseDescription =
		description || model.llm_description || `${model.llm_provider} model`;

	// Skip flags for account-setting (don't show TOOLS+IMAGES+etc. for this special model)
	if (model.llm_codename === "account-setting") {
		return baseDescription;
	}

	// Build flags array based on model capabilities
	const flags: string[] = [];
	if (model.is_free) flags.push("FREE");
	if (model.has_tools) flags.push("TOOLS");
	if (model.sees_images) flags.push("IMAGES");
	if (model.supports_structoutput) flags.push("STRUCT");
	//if (model.is_uncensored) flags.push("UNCENSORED");

	// Prepend flags with + connector if any exist
	const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
	return `${flagPrefix}${baseDescription}`;
}

// Configure the subcommand (Rule #21)
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("text")
		.setDescription(localizer("en-US", "commands.config.model.text.description"));

/**
 * Changes Tomori's LLM model (Gemini)
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
	const tomoriState = await loadTomoriState(
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
			titleKey: "commands.config.model.text.no_api_key_title",
			descriptionKey: "commands.config.model.text.no_api_key_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 4. Load available models for the current provider from the database for modal options
	const currentProvider = tomoriState.llm.llm_provider;
	const availableModels = await loadAvailableModelsForProvider(currentProvider);
	if (!availableModels || availableModels.length === 0) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.model.text.no_models_title",
			descriptionKey: "commands.config.model.text.no_models_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Track modal submit interaction and selected model for error handling in catch block
	let modalSubmitInteraction:
		| import("discord.js").ModalSubmitInteraction
		| undefined;
	let selectedModel: LlmRow | null = null; // For error context and logic

	try {

		// 4. Create model options for the select menu using localized descriptions
		const modelSelectOptions: SelectOption[] = availableModels.map((model) => ({
			label: safeSelectOptionText(model.llm_codename), // Use codename as display label
			value: safeSelectOptionText(model.llm_codename), // Use codename as value
			description: safeSelectOptionText(
				getLocalizedDescription(model, userData.language_pref),
			), // Use locale-specific description
		}));

		// 5. Show the modal with model selection
		const modalResult = await promptWithRawModal(
			interaction,
			locale,
			{
				modalCustomId: MODAL_CUSTOM_ID,
				modalTitleKey: "commands.config.model.text.modal_title",
				components: [
					{
						customId: MODEL_SELECT_ID,
						labelKey: "commands.config.model.text.select_label",
						descriptionKey: "commands.config.model.text.select_description",
						placeholder: "commands.config.model.text.select_placeholder",
						required: true,
						options: modelSelectOptions,
					},
				],
			},
			MessageFlags.Ephemeral, // Auto-defer with ephemeral flag
		);

		// 6. Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`Model selection modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		// Extract values from the modal
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		modalSubmitInteraction = modalResult.interaction!;
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		const selectedModelCodename = modalResult.values![MODEL_SELECT_ID];

		// 7. Find the selected model details (including llm_id) by codename - let helper functions manage interaction state
		selectedModel =
			availableModels.find(
				(model) => model.llm_codename === selectedModelCodename,
			) ?? null;

		if (!selectedModel?.llm_id) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "CommandExecutionError",
				metadata: {
					command: "config model",
					guildId: interaction.guild?.id ?? interaction.user.id,
					requestedModel: selectedModelCodename,
					availableModels: availableModels.map((m) => m.llm_codename),
				},
			};
			// Log the error even if it seems impossible due to modal choices
			await log.error(
				"Selected model codename not found in available LLMs from DB",
				new Error("Invalid model selection despite modal choices"),
				context,
			);

			await modalSubmitInteraction.editReply({
				content: localizer(
					locale,
					"commands.config.model.text.invalid_model_description",
				),
			});
			return;
		}

		// 8. Check if this is the same as the current model
		if (selectedModel.llm_id === tomoriState.config.llm_id) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.model.text.already_selected_title",
				descriptionKey: "commands.config.model.text.already_selected_description",
				descriptionVars: {
					model_name: selectedModel.llm_codename,
				},
				color: ColorCode.WARN,
			});
			return;
		}

		// 8.5. Validate API key compatibility with new model's provider (if different provider)
		const currentModelProvider = tomoriState.llm?.llm_provider?.toLowerCase();
		const newModelProvider = selectedModel.llm_provider?.toLowerCase();

		if (currentModelProvider !== newModelProvider) {
			// Show validation message
			await modalSubmitInteraction.editReply({
				content: localizer(
					locale,
					"commands.config.model.text.validating_api_key_compatibility",
				),
			});

			try {
				// Decrypt and validate the API key with the new provider
				const { decryptApiKey } = await import("../../../utils/security/crypto");
				const keyVersion = tomoriState.config.key_version || 1; // Default to V1 for backward compatibility
				const decryptedApiKey = await decryptApiKey(
					tomoriState.config.api_key,
					keyVersion,
				);

				// Create provider instance for validation using factory
				let isKeyCompatible = false;
				try {
					// Use factory to get provider instance (handles all providers and aliases)
					const { ProviderFactory } = await import(
						"../../../utils/provider/providerFactory"
					);
					// Partial TomoriState for validation only - provider doesn't use these fields during validateApiKey()
					const provider = await ProviderFactory.getProvider({
						llm: { llm_provider: newModelProvider, llm_codename: "" },
						server_id: tomoriState.server_id,
						tomori_id: tomoriState.tomori_id,
						config: tomoriState.config,
						// biome-ignore lint/suspicious/noExplicitAny: Minimal object structure needed for factory pattern
					} as any);

					isKeyCompatible = await provider.validateApiKey(decryptedApiKey);
				} catch (providerError) {
					// Provider not found or other error
					log.warn(
						`Cannot validate API key for provider ${newModelProvider}: ${providerError instanceof Error ? providerError.message : String(providerError)}`,
					);
					// Assume compatible if provider cannot be loaded
					isKeyCompatible = true;
				}

				if (!isKeyCompatible) {
					await replyInfoEmbed(modalSubmitInteraction, locale, {
						titleKey: "commands.config.model.text.api_key_incompatible_title",
						descriptionKey:
							"commands.config.model.text.api_key_incompatible_description",
						descriptionVars: {
							model_name: selectedModel.llm_codename,
							provider:
								newModelProvider.charAt(0).toUpperCase() +
								newModelProvider.slice(1),
						},
						color: ColorCode.ERROR,
					});
					return;
				}
			} catch (error) {
				log.error(
					`Error validating API key compatibility for provider ${newModelProvider}`,
					error as Error,
				);
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "commands.config.model.text.validation_error_title",
					descriptionKey: "commands.config.model.text.validation_error_description",
					color: ColorCode.ERROR,
				});
				return;
			}
		}

		// 9. Update the config in the database using direct SQL (Rule #4, #15)
		const [updatedRow] = await sql`
            UPDATE tomori_configs
            SET llm_id = ${selectedModel.llm_id}
            WHERE tomori_id = ${tomoriState.tomori_id}
            RETURNING *
        `;

		// 10. Validate the returned data (Rules #3, #5)
		const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);

		if (!validatedConfig.success || !updatedRow) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "DatabaseUpdateError",
				metadata: {
					command: "config model",
					guildId: interaction.guild?.id ?? interaction.user.id,
					selectedModelCodename,
					targetLlmId: selectedModel.llm_id,
					validationErrors: validatedConfig.success
						? null
						: validatedConfig.error.flatten(),
				},
			};
			await log.error(
				"Failed to update or validate LLM config after DB update",
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

		// 11. Success message
		// Find previous model name
		const previousModel = availableModels.find(
			(model) => model.llm_id === tomoriState.config.llm_id,
		);

		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: "commands.config.model.text.success_title",
			descriptionKey: "commands.config.model.text.success_description",
			descriptionVars: {
				model_name: selectedModel.llm_codename,
				previous_model:
					previousModel?.llm_codename ?? localizer(locale, "general.unknown"),
			},
			color: ColorCode.SUCCESS,
		});
	} catch (error) {
		// 12. Log error with context (Rule #22)
		let serverIdForError: number | null = null;
		let tomoriIdForError: number | null = null;
		if (interaction.guild?.id) {
			const state = await loadTomoriState(interaction.guild.id);
			serverIdForError = state?.server_id ?? null;
			tomoriIdForError = state?.tomori_id ?? null;
		}

		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: serverIdForError,
			tomoriId: tomoriIdForError,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config model",
				guildId: interaction.guild?.id ?? interaction.user.id,
				executorDiscordId: interaction.user.id,
				targetLlmIdAttempted: selectedModel?.llm_id,
			},
		};
		await log.error(
			`Error executing /config model for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		// 13. Inform user of unknown error
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
