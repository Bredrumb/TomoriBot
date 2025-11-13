import {
	MessageFlags,
	TextInputStyle,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import {
	loadTomoriState,
	loadUniqueProviders,
	loadDefaultModelForProvider,
} from "../../../utils/db/dbRead";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithRawModal,
} from "../../../utils/discord/interactionHelper";
import {
	type UserRow,
	type ErrorContext,
	tomoriConfigSchema,
} from "../../../types/db/schema";
import type {
	SelectOption,
	ModalComponent,
} from "../../../types/discord/modal";
import { ProviderFactory } from "../../../utils/provider/providerFactory";
import { encryptApiKey } from "../../../utils/security/crypto";
import { sql } from "bun";

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_apikeyset_modal";
const PROVIDER_SELECT_ID = "provider_select";
const API_KEY_INPUT_ID = "api_key_input";

// Configure the subcommand
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("set")
		.setDescription(
			localizer("en-US", "commands.config.apikey.set.description"),
		);

/**
 * Sets the API key Tomori will use for this server with dynamic provider selection
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
	// 1. Ensure command is run in a channel context
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	try {
		// 2. Load the Tomori state for this server/user
		// Use user ID for DM context, guild ID for server context
		const serverId = interaction.guild?.id ?? interaction.user.id;
		const tomoriState = await loadTomoriState(serverId);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 3. Load unique providers from database
		const uniqueProviders = await loadUniqueProviders();
		if (!uniqueProviders || uniqueProviders.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.apikey.set.no_providers_title",
				descriptionKey: "commands.config.apikey.set.no_providers_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 4. Create provider select options with descriptions
		const providerSelectOptions: SelectOption[] = uniqueProviders.map(
			(provider) => ({
				label: provider.charAt(0).toUpperCase() + provider.slice(1),
				value: provider.toLowerCase(),
				description: undefined,
			}),
		);

		// 5. Show modal with provider selection and API key input
		const modalComponents: ModalComponent[] = [
			{
				customId: PROVIDER_SELECT_ID,
				labelKey: "commands.config.apikey.set.provider_label",
				descriptionKey: "commands.config.apikey.set.provider_description",
				placeholder: "commands.config.apikey.set.provider_placeholder",
				required: true,
				options: providerSelectOptions,
			},
			{
				customId: API_KEY_INPUT_ID,
				labelKey: "commands.config.apikey.set.api_key_label",
				descriptionKey: "commands.config.apikey.set.api_key_description",
				placeholder: "commands.config.apikey.set.api_key_placeholder",
				required: true,
				style: TextInputStyle.Short,
				maxLength: 200,
			},
		];

		const modalResult = await promptWithRawModal(
			interaction,
			locale,
			{
				modalCustomId: MODAL_CUSTOM_ID,
				modalTitleKey: "commands.config.apikey.set.modal_title",
				components: modalComponents,
			},
			MessageFlags.Ephemeral, // Auto-defer with ephemeral flag
		);

		// 6. Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`API key set modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		// Extract values from the modal
		const modalSubmitInteraction = modalResult.interaction;
		const selectedProvider = modalResult.values?.[PROVIDER_SELECT_ID];
		const apiKey = modalResult.values?.[API_KEY_INPUT_ID];

		// Safety checks
		if (!modalSubmitInteraction || !selectedProvider || !apiKey) {
			log.error("Modal result unexpectedly missing interaction or values");
			return;
		}

		// 7. Basic API key validation - let helper functions manage interaction state
		if (apiKey.length < 10) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.apikey.set.invalid_key_title",
				descriptionKey: "commands.config.apikey.set.invalid_key_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 9. Get provider instance and validate API key using factory
		let isValid = false;
		try {
			const providerName = selectedProvider.toLowerCase();

			// Use factory to get provider instance (handles all providers and aliases)
			// Partial TomoriState for validation only - provider doesn't use these fields during validateApiKey()
			const provider = await ProviderFactory.getProvider({
				llm: { llm_provider: providerName, llm_codename: "" },
				server_id: tomoriState.server_id,
				tomori_id: tomoriState.tomori_id,
				config: tomoriState.config,
				// biome-ignore lint/suspicious/noExplicitAny: Minimal object structure needed for factory pattern
			} as any);

			// Validate the API key with the provider
			isValid = await provider.validateApiKey(apiKey);
		} catch (error) {
			log.error(
				`Error validating API key for provider ${selectedProvider}`,
				error as Error,
			);

			// Check if error is due to unsupported provider
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			if (errorMessage.includes("Unsupported provider")) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "commands.config.apikey.set.unsupported_provider_title",
					descriptionKey:
						"commands.config.apikey.set.unsupported_provider_description",
					descriptionVars: {
						provider: selectedProvider,
					},
					color: ColorCode.ERROR,
				});
			} else {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "commands.config.apikey.set.validation_error_title",
					descriptionKey:
						"commands.config.apikey.set.validation_error_description",
					color: ColorCode.ERROR,
				});
			}
			return;
		}

		// 10. Handle validation failure with error embed (not reply)
		if (!isValid) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.apikey.set.key_validation_failed_title",
				descriptionKey:
					"commands.config.apikey.set.key_validation_failed_description",
				descriptionVars: {
					provider:
						selectedProvider.charAt(0).toUpperCase() +
						selectedProvider.slice(1),
				},
				color: ColorCode.ERROR,
			});
			return;
		}

		// 11. Encrypt and store the API key
		const { encrypted, version } = await encryptApiKey(apiKey);

		// 11.5. Check if provider changed and load default model if needed
		const currentProvider = tomoriState.llm.llm_provider.toLowerCase();
		const newProvider = selectedProvider.toLowerCase();
		let newLlmId = tomoriState.config.llm_id; // Default to current model

		if (currentProvider !== newProvider) {
			// Provider changed, load default model for new provider
			log.info(
				`Provider changed from ${currentProvider} to ${newProvider}, loading default model`,
			);
			const defaultModel = await loadDefaultModelForProvider(newProvider);

			if (!defaultModel || !defaultModel.llm_id) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "commands.config.apikey.set.no_default_model_title",
					descriptionKey:
						"commands.config.apikey.set.no_default_model_description",
					descriptionVars: {
						provider:
							newProvider.charAt(0).toUpperCase() + newProvider.slice(1),
					},
					color: ColorCode.ERROR,
				});
				return;
			}

			newLlmId = defaultModel.llm_id;
			log.info(
				`Switching to default model for ${newProvider}: ${defaultModel.llm_codename} (ID: ${newLlmId})`,
			);
		}

		// 12. Update the config in the database (includes llm_id if provider changed)
		const [updatedRow] = await sql`
			UPDATE tomori_configs
			SET api_key = ${encrypted},
			    key_version = ${version},
			    llm_id = ${newLlmId}
			WHERE tomori_id = ${tomoriState.tomori_id}
			RETURNING *
		`;

		// 13. Validate the returned data
		const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);

		if (!validatedConfig.success || !updatedRow) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "DatabaseUpdateError",
				metadata: {
					command: "config apikeyset",
					selectedProvider,
					validationErrors: validatedConfig.success
						? null
						: validatedConfig.error.flatten(),
				},
			};
			await log.error(
				"Failed to update or validate config after setting API key",
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

		// 14. Success message (include model info if provider changed)
		const successDescriptionKey =
			currentProvider !== newProvider
				? "commands.config.apikey.set.success_with_model_description"
				: "commands.config.apikey.set.success_description";

		const descriptionVars: Record<string, string> = {
			provider:
				selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1),
		};

		// Add model name if provider changed
		if (currentProvider !== newProvider) {
			const defaultModel = await loadDefaultModelForProvider(newProvider);
			if (defaultModel) {
				descriptionVars.model_name = defaultModel.llm_codename;
			}
		}

		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: "commands.config.apikey.set.success_title",
			descriptionKey: successDescriptionKey,
			descriptionVars,
			color: ColorCode.SUCCESS,
		});
	} catch (error) {
		// Error handling
		let serverIdForError: number | null = null;
		let tomoriIdForError: number | null = null;
		const errorServerId = interaction.guild?.id ?? interaction.user.id;
		const state = await loadTomoriState(errorServerId);
		serverIdForError = state?.server_id ?? null;
		tomoriIdForError = state?.tomori_id ?? null;

		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: serverIdForError,
			tomoriId: tomoriIdForError,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config apikeyset",
				guildId: interaction.guild?.id,
				executorDiscordId: interaction.user.id,
			},
		};
		await log.error(
			`Error executing /config apikeyset for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		// Inform user of unknown error
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
