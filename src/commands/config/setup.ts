import { TextInputStyle, MessageFlags } from "discord.js";
import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import type { SetupConfig, UserRow } from "../../types/db/schema";
import type { SelectOption } from "../../types/discord/modal";
import { setupConfigSchema } from "../../types/db/schema";
import type { ProviderError } from "../../types/stream/interfaces";
import { localizer, getDefaultBotName } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import {
	replyInfoEmbed,
	replySummaryEmbed,
	promptWithRawModal,
} from "../../utils/discord/interactionHelper";
import { ProviderFactory } from "../../utils/provider/providerFactory";
import { encryptApiKey } from "../../utils/security/crypto";
import { setupServer } from "../../utils/db/dbWrite";
import {
	loadTomoriState,
	loadUniqueProviders,
	loadPresetOptionsByLocale,
} from "@/utils/db/dbRead";
import { getCachedPresetAvatar } from "@/utils/image/avatarHelper";
import { lazySyncGuildEmojis } from "@/utils/cache/emojiLazySync";
import { lazySyncGuildStickers } from "@/utils/cache/stickerLazySync";
import {
	isCustomProvider,
	validateEndpointUrl,
	promptCustomCapabilities,
	saveCustomEndpointConfig,
	CUSTOM_ENDPOINT_PLACEHOLDER_KEY,
	type CustomCapabilitiesResult,
} from "@/utils/discord/customProviderModal";

import type { HumanizerDegree } from "@/types/db/schema";

// Define constants at the top (Rule #20)

// Configure the subcommand
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("setup")
		.setDescription(localizer("en-US", "commands.config.setup.description"));

/**
 * Execute the setup command - guides users through the initial setup of TomoriBot for their server
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction (user-facing language)
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	// Check if channel exists (required for both guilds and DMs)
	if (!interaction.channel) {
		await interaction.reply({
			content: localizer(
				userData.language_pref,
				"general.errors.operation_failed_description",
			),
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Determine if this is a DM or guild context
	const isDMChannel = interaction.channel.isDMBased();
	const serverId = isDMChannel ? interaction.user.id : interaction.guild?.id;
	// Use guild locale when available so server-level triggers/localized defaults match the guild language
	const serverLocale = interaction.guildLocale ?? locale;
	// Analytics-only locale capture (static); do not use for functionality
	const registrationLocale = interaction.guildLocale ?? locale ?? null;

	if (!serverId) {
		await interaction.reply({
			content: localizer(
				userData.language_pref,
				"general.errors.critical_error_description",
			),
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	try {
		// 2. Check if Tomori already exists for this server - NEW CHECK
		const existingTomoriState = await loadTomoriState(serverId);

		// 3. If Tomori already exists, inform user and exit early
		if (existingTomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.setup.already_setup_title",
				descriptionKey: "commands.config.setup.already_setup_description",
				color: ColorCode.WARN,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Load dynamic data for the modal
		const [uniqueProviders, presetOptions] = await Promise.all([
			loadUniqueProviders(),
			loadPresetOptionsByLocale(locale, 100),
		]);

		// Check if we have the required data
		if (!uniqueProviders || uniqueProviders.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "No LLM providers found in database",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!presetOptions || presetOptions.length === 0) {
			await interaction.reply({
				content: localizer(locale, "commands.config.setup.no_presets_found"),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Create provider options for the select menu
		const providerSelectOptions: SelectOption[] = uniqueProviders.map(
			(provider) => ({
				label: provider.charAt(0).toUpperCase() + provider.slice(1), // Capitalize first letter
				value: provider,
				description: undefined,
			}),
		);

		// Create preset options for the select menu
		const presetSelectOptions: SelectOption[] = presetOptions.map((preset) => ({
			label: preset.name,
			value: preset.name,
			description: preset.description,
		}));

		// Create humanizer degree options for the select menu
		const humanizerSelectOptions: SelectOption[] = [
			{
				label: localizer(
					locale,
					"commands.config.setup.humanizer_option_none_label",
				),
				value: "0",
				description: localizer(
					locale,
					"commands.config.setup.humanizer_option_none_desc",
				),
			},
			{
				label: localizer(
					locale,
					"commands.config.setup.humanizer_option_light_label",
				),
				value: "1",
				description: localizer(
					locale,
					"commands.config.setup.humanizer_option_light_desc",
				),
			},
			{
				label: localizer(
					locale,
					"commands.config.setup.humanizer_option_default_label",
				),
				value: "2",
				description: localizer(
					locale,
					"commands.config.setup.humanizer_option_default_desc",
				),
			},
			{
				label: localizer(
					locale,
					"commands.config.setup.humanizer_option_heavy_label",
				),
				value: "3",
				description: localizer(
					locale,
					"commands.config.setup.humanizer_option_heavy_desc",
				),
			},
		];

		// Create the modal using the new promptWithRawModal utility with Component Type 18 support
		const modalResult = await promptWithRawModal(
			interaction,
			locale,
			{
				modalCustomId: "tomori_setup_modal",
				modalTitleKey: "commands.config.setup.modal_title",
				components: [
					{
						customId: "api_provider",
						labelKey: "commands.config.setup.api_provider_label",
						descriptionKey: "commands.config.setup.api_provider_description",
						placeholder: "commands.config.setup.api_provider_placeholder",
						required: true,
						options: providerSelectOptions,
					},
					{
						customId: "api_key",
						labelKey: "commands.config.setup.api_key_label",
						// Show custom endpoint hint when not in production (custom provider available)
						descriptionKey: process.env.RUN_ENV !== "production"
							? "commands.config.setup.api_key_description_with_custom"
							: "commands.config.setup.api_key_description",
						placeholder: "commands.config.setup.api_key_placeholder",
						style: TextInputStyle.Short,
						required: true,
					},
					{
						customId: "preset_name",
						labelKey: "commands.config.setup.preset_label",
						descriptionKey: "commands.config.setup.preset_description",
						placeholder: "commands.config.setup.preset_placeholder",
						required: true,
						options: presetSelectOptions,
					},
					{
						customId: "humanizer_degree",
						labelKey: "commands.config.setup.humanizer_label",
						descriptionKey: "commands.config.setup.humanizer_description",
						placeholder: "commands.config.setup.humanizer_placeholder",
						required: true,
						options: humanizerSelectOptions,
					},
					{
						customId: "timezone_offset",
						labelKey: "commands.config.setup.timezone_label",
						descriptionKey: "commands.config.setup.timezone_description",
						style: TextInputStyle.Short,
						placeholder: "commands.config.setup.timezone_placeholder",
						required: false, // Optional - defaults to 0 (UTC) if not provided
					},
				],
			},
			MessageFlags.Ephemeral, // Auto-defer with ephemeral flag
		);

		// Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`Setup modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		// Process modal submission - wrap in try-catch to handle errors within modal context
		try {
			// Extract values from the modal
			// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
			const modalSubmitInteraction = modalResult.interaction!;

			// Extract values with validation - modal submission can have missing values due to Component Type 18 handling

			const apiProvider = modalResult.values?.api_provider;
			const apiKey = modalResult.values?.api_key;
			const presetName = modalResult.values?.preset_name;
			const humanizerDegreeStr = modalResult.values?.humanizer_degree;
			const timezoneOffsetStr = modalResult.values?.timezone_offset;

			// Validate that all required values are present - let helper functions manage interaction state
			if (!apiProvider || !apiKey || !presetName || !humanizerDegreeStr) {
				log.error("Missing required modal values:", {
					apiProvider: apiProvider || "MISSING",
					apiKey: apiKey ? "PROVIDED" : "MISSING",
					presetName: presetName || "MISSING",
					humanizerDegree: humanizerDegreeStr || "MISSING",
					allValuesKeys: modalResult.values
						? Object.keys(modalResult.values)
						: "NO_VALUES",
					allValuesStringified: modalResult.values
						? JSON.stringify(modalResult.values, null, 2)
						: "NO_VALUES",
				});
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.operation_failed_title",
					descriptionKey: "commands.config.setup.modal_values_missing",
					color: ColorCode.ERROR,
				});
				return;
			}

			// Validate and transform inputs

			// 1. Validate API Provider (case-insensitive)
			const normalizedProvider = uniqueProviders.find(
				(provider) => provider.toLowerCase() === apiProvider.toLowerCase(),
			);

			if (!apiProvider || !normalizedProvider) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.operation_failed_title",
					descriptionKey: "commands.config.setup.provider_invalid",
					color: ColorCode.ERROR,
				});
				return;
			}

			// 2. Handle Custom Provider vs Regular Providers differently
			let encryptedKey: Buffer;
			let keyVersion: number;
			let customCapabilitiesResult: CustomCapabilitiesResult | null = null;
			let customEndpointUrl: string | null = null;

			if (isCustomProvider(normalizedProvider)) {
				// Custom Provider Flow: apiKey field contains the endpoint URL
				log.info(`Custom provider selected - treating api_key as endpoint URL`);

				// Validate the endpoint URL format
				if (!apiKey || !validateEndpointUrl(apiKey)) {
					await replyInfoEmbed(modalSubmitInteraction, locale, {
						titleKey: "commands.config.custom.endpoint_url_invalid_title",
						descriptionKey: "commands.config.custom.endpoint_url_invalid_description",
						color: ColorCode.ERROR,
					});
					return;
				}

				customEndpointUrl = apiKey;
				log.info(`Custom endpoint URL validated: ${customEndpointUrl}`);

				// Show capabilities selection for custom model
				customCapabilitiesResult = await promptCustomCapabilities(
					modalSubmitInteraction,
					locale,
					serverId,
				);

				if (!customCapabilitiesResult.success) {
					await replyInfoEmbed(modalSubmitInteraction, locale, {
						titleKey: "general.errors.operation_failed_title",
						description: customCapabilitiesResult.error || localizer(locale, "commands.config.custom.capabilities_timeout"),
						color: ColorCode.ERROR,
					});
					return;
				}

				log.info(`Custom model capabilities configured: tools=${customCapabilitiesResult.hasTools}, images=${customCapabilitiesResult.seesImages}, videos=${customCapabilitiesResult.seesVideos}, structOutput=${customCapabilitiesResult.supportsStructOutput}`);

				// Use placeholder API key for custom provider (the endpoint URL is stored separately)
				const placeholderResult = await encryptApiKey(CUSTOM_ENDPOINT_PLACEHOLDER_KEY);
				encryptedKey = placeholderResult.encrypted;
				keyVersion = placeholderResult.version;
			} else {
				// Regular Provider Flow: Validate API Key
				if (!apiKey || apiKey.length < 10) {
					await replyInfoEmbed(modalSubmitInteraction, locale, {
						titleKey: "general.errors.operation_failed_title",
						descriptionKey: "commands.config.setup.api_key_invalid",
						color: ColorCode.ERROR,
					});
					return;
				}

				// Test the API key with a real API call using provider factory
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "commands.config.setup.api_key_validating",
					descriptionKey: "commands.config.setup.api_key_validating",
					color: ColorCode.INFO,
				});

				try {
					// Use factory to get provider instance (handles all providers and aliases)
					// Partial TomoriState for validation only - provider doesn't use these fields during validateApiKey()
					const provider = await ProviderFactory.getProvider({
						llm: { llm_provider: normalizedProvider, llm_codename: "" },
						server_id: 0, // Temporary, not used for validation
						tomori_id: 0, // Temporary, not used for validation
						// biome-ignore lint/suspicious/noExplicitAny: Empty config object is sufficient for validation
						config: {} as any,
						// biome-ignore lint/suspicious/noExplicitAny: Minimal object structure needed for factory pattern
					} as any);

					const validationResult = await provider.validateApiKey(apiKey);
					if (!validationResult.valid) {
						// Get stream adapter to format the error message
						let errorDescription = "API key validation failed";

						if (validationResult.error) {
							// Use provider-specific error description formatting
							try {
								// Dynamically get the appropriate stream adapter based on provider
								let adapter: { createErrorDescription: (error: ProviderError, locale: string) => string | null } | undefined;

								if (normalizedProvider === "google" || normalizedProvider === "gemini") {
									const { GoogleStreamAdapter } = await import("../../providers/google/googleStreamAdapter");
									adapter = new GoogleStreamAdapter();
								} else if (normalizedProvider === "novelai" || normalizedProvider === "nai") {
									const { NovelaiStreamAdapter } = await import("../../providers/novelai/novelaiStreamAdapter");
									adapter = new NovelaiStreamAdapter();
								} else if (normalizedProvider === "openrouter" || normalizedProvider === "or") {
									const { OpenrouterStreamAdapter } = await import("../../providers/openrouter/openrouterStreamAdapter");
									adapter = new OpenrouterStreamAdapter();
								}

								if (adapter) {
									const formattedError = adapter.createErrorDescription(validationResult.error, locale);
									if (formattedError) {
										errorDescription = formattedError;
									}
								} else {
									// Fallback for unknown providers
									errorDescription = `Error Code ${validationResult.error.code}: ${validationResult.error.message}`;
								}
							} catch (adapterError) {
								// Fallback if adapter creation fails
								log.warn("Failed to create stream adapter for error formatting", adapterError);
								errorDescription = `Error Code ${validationResult.error.code}: ${validationResult.error.message}`;
							}
						}

						await replyInfoEmbed(modalSubmitInteraction, locale, {
							titleKey: "general.errors.operation_failed_title",
							description: errorDescription, // Use formatted error description
							color: ColorCode.ERROR,
						});
						return;
					}
				} catch (providerError) {
					log.error(
						`Error validating API key for provider ${normalizedProvider}`,
						providerError as Error,
					);
					await replyInfoEmbed(modalSubmitInteraction, locale, {
						titleKey: "general.errors.operation_failed_title",
						descriptionKey: "commands.config.setup.api_key_invalid_api",
						color: ColorCode.ERROR,
					});
					return;
				}

				// API key is valid, proceed with encryption
				const encryptionResult = await encryptApiKey(apiKey);
				encryptedKey = encryptionResult.encrypted;
				keyVersion = encryptionResult.version;
			}

			// 4. Validate preset name against available presets
			const selectedPresetOption = presetOptions.find(
				(p) => p.name.toLowerCase() === presetName.trim().toLowerCase(),
			);

			if (!selectedPresetOption) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.operation_failed_title",
					descriptionKey: "commands.config.setup.preset_invalid",
					descriptionVars: {
						available: presetOptions.map((p) => p.name).join(", "),
					},
					color: ColorCode.ERROR,
				});
				return;
			}

			// Get the full preset data from database
			const presetRows = await sql`
			SELECT tomori_preset_id, tomori_preset_name 
			FROM tomori_presets 
			WHERE tomori_preset_name = ${selectedPresetOption.name}
			LIMIT 1
		`;

			if (!presetRows.length) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.operation_failed_title",
					descriptionKey: "commands.config.setup.preset_not_found",
					color: ColorCode.ERROR,
				});
				return;
			}

			const selectedPresetId = presetRows[0].tomori_preset_id;
			log.info(
				`Selected preset ID: ${selectedPresetId} (${selectedPresetOption.name})`,
			);

			// 5. Validate humanizer degree (required, must be 0-3)
			const parsedHumanizer = Number.parseInt(humanizerDegreeStr, 10);

			// Check if it's a valid number
			if (Number.isNaN(parsedHumanizer)) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.operation_failed_title",
					descriptionKey: "commands.config.setup.humanizer_invalid",
					color: ColorCode.ERROR,
				});
				return;
			}

			// Validate it's a valid HumanizerDegree value (0-3)
			if (parsedHumanizer < 0 || parsedHumanizer > 3) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.operation_failed_title",
					descriptionKey: "commands.config.setup.humanizer_invalid",
					color: ColorCode.ERROR,
				});
				return;
			}

			const humanizerDegree = parsedHumanizer as HumanizerDegree;
			log.info(`Selected humanizer degree: ${humanizerDegree}`);

			// 6. Validate timezone offset (optional, defaults to 0 if not provided or invalid)
			let timezoneOffset = 0; // Default to UTC
			if (timezoneOffsetStr?.trim()) {
				const parsedOffset = Number.parseFloat(timezoneOffsetStr.trim());

				// Check if it's a valid number and within range
				if (Number.isNaN(parsedOffset)) {
					await replyInfoEmbed(modalSubmitInteraction, locale, {
						titleKey: "general.errors.operation_failed_title",
						descriptionKey: "commands.config.setup.timezone_invalid_format",
						descriptionVars: {
							provided: timezoneOffsetStr,
						},
						color: ColorCode.ERROR,
					});
					return;
				}

				// Validate range (-12 to +14)
				if (parsedOffset < -12 || parsedOffset > 14) {
					await replyInfoEmbed(modalSubmitInteraction, locale, {
						titleKey: "general.errors.operation_failed_title",
						descriptionKey: "commands.config.setup.timezone_out_of_range",
						descriptionVars: {
							provided: parsedOffset.toString(),
							min: "-12",
							max: "14",
						},
						color: ColorCode.ERROR,
					});
					return;
				}

				// Round to integer (in case user provided decimal like 5.5)
				timezoneOffset = Math.round(parsedOffset);
			}

			// Create setup config
			const setupConfig: SetupConfig = {
				serverId: serverId,
				encryptedApiKey: encryptedKey,
				keyVersion: keyVersion, // Add encryption key version
				provider: normalizedProvider, // Use the case-normalized provider name
				presetId: selectedPresetId,
				humanizer: humanizerDegree, // Use the selected humanizer degree
				tomoriName: getDefaultBotName(locale), // Get bot name from locale files
				timezoneOffset: timezoneOffset, // Add timezone offset to config
				locale: serverLocale, // Persist guild locale for server analytics/triggers; DM falls back to user locale
				registrationLocale, // Analytics-only locale for servers
			};

			// Validate config using zod schema
			try {
				setupConfigSchema.parse(setupConfig);
			} catch (error) {
				log.error("Setup config validation failed:", error);
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.operation_failed_title",
					descriptionKey: "commands.config.setup.config_invalid",
					color: ColorCode.ERROR,
				});
				return;
			}

			// Setup the server
			try {
				await setupServer(interaction.guild, setupConfig);
			} catch (error) {
				log.error("Server setup failed:", error);
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey: "general.errors.operation_failed_title",
					descriptionKey: "commands.config.setup.setup_failed_description",
					color: ColorCode.ERROR,
				});
				return;
			}

			// Custom provider post-processing: update config with endpoint URL and LLM ID
			if (isCustomProvider(normalizedProvider) && customCapabilitiesResult && customCapabilitiesResult.llmId && customEndpointUrl) {
				// Non-null assertion is safe here - we've verified llmId is truthy in the if condition
				const customLlmId = customCapabilitiesResult.llmId as number;
				try {
					// Load the newly created TomoriState to get tomori_id
					const newTomoriState = await loadTomoriState(serverId);
					if (newTomoriState?.tomori_id) {
						await saveCustomEndpointConfig(
							newTomoriState.tomori_id,
							customEndpointUrl,
							customLlmId,
						);
						log.success(
							`[Setup] Saved custom endpoint config for server ${serverId}: endpoint=${customEndpointUrl}, llmId=${customLlmId}`,
						);
					} else {
						log.error(
							`[Setup] Failed to load TomoriState after setup for custom provider config update`,
						);
					}
				} catch (customConfigError) {
					log.error(
						`[Setup] Failed to save custom endpoint config: ${customConfigError}`,
					);
					// Don't fail setup, the server was created successfully
				}
			}

			// Force sync emojis and stickers for guild context (skip for DMs)
			// This populates the database with all current emojis/stickers from Discord
			// Ensures emoji/sticker conversion works immediately without requiring an extra message
			if (!isDMChannel && interaction.guild) {
				try {
					// 1. Load the newly created TomoriState to get server_id
					const newTomoriState = await loadTomoriState(serverId);

					if (newTomoriState) {
						log.info(
							`[Setup] Force syncing emojis/stickers for guild ${interaction.guild.name}`,
						);

						// 2. Force sync both emojis and stickers (ignore 24hr cache)
						await Promise.all([
							lazySyncGuildEmojis(interaction.guild, newTomoriState.server_id, true),
							lazySyncGuildStickers(interaction.guild, newTomoriState.server_id, true),
						]);

						log.success(
							`[Setup] Successfully synced expressions for guild ${interaction.guild.name}`,
						);
					} else {
						log.warn(
							`[Setup] Failed to load TomoriState after setup for guild ${interaction.guild.id}`,
						);
					}
				} catch (syncError) {
					// 3. Log error but don't fail setup - expressions will sync on first message anyway
					log.warn(
						`[Setup] Failed to sync expressions during setup (will sync on first message): ${syncError}`,
					);
				}
			}

			// Update guild avatar to match the selected preset (guild-only operation)
			let avatarUpdateFailed = false;

			// Only attempt avatar update in guilds (not available in DMs)
			if (!isDMChannel && interaction.guild) {
				try {
					// 1. Try to get cached preset avatar
					const cachedAvatar = getCachedPresetAvatar(selectedPresetId);

					// 2. Prepare avatar value (base64 data URI or null)
					const avatarValue = cachedAvatar || null;

					// 3. Update guild avatar via Discord API
					const endpoint = `https://discord.com/api/v10/guilds/${interaction.guild.id}/members/@me`;
					const response = await fetch(endpoint, {
						method: "PATCH",
						headers: {
							Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ avatar: avatarValue }),
					});

					if (response.ok) {
						const actionDescription = cachedAvatar
							? `Set preset avatar for "${selectedPresetOption.name}"`
							: "Reset guild avatar to bot default";
						log.info(
							`${actionDescription} for guild ${interaction.guild.id} during setup`,
						);
					} else {
						avatarUpdateFailed = true;
						log.warn(
							`Failed to update guild avatar during setup: ${response.status} ${response.statusText}`,
						);
					}
				} catch (avatarError) {
					// Log avatar error but don't fail the setup
					avatarUpdateFailed = true;
					log.warn(`Failed to update avatar during setup: ${avatarError}`);
				}
			}

			// Prepare fields for success message
			// Map humanizer degree to user-friendly label
			const humanizerLabels = [
				localizer(locale, "commands.config.setup.humanizer_option_none_label"),
				localizer(locale, "commands.config.setup.humanizer_option_light_label"),
				localizer(
					locale,
					"commands.config.setup.humanizer_option_default_label",
				),
				localizer(locale, "commands.config.setup.humanizer_option_heavy_label"),
			];
			const humanizerLabel = humanizerLabels[humanizerDegree] || "Unknown";

			const successFields = [
				{
					nameKey: "commands.config.setup.preset_field",
					value: selectedPresetOption.name,
				},
				{
					nameKey: "commands.config.setup.name_field",
					value:
						locale === "ja"
							? process.env.DEFAULT_BOTNAME_JP || "ともり" // Use environment variable with fallback
							: process.env.DEFAULT_BOTNAME || "Tomori", // Use environment variable with fallback
				},
				{
					nameKey: "commands.config.setup.humanizer_field",
					value: humanizerLabel,
				},
			];

			// Add DM explanation field if in DM context
			if (isDMChannel) {
				successFields.push({
					nameKey: "commands.config.setup.dm_context_explanation_title",
					value: localizer(
						locale,
						"commands.config.setup.dm_context_explanation",
					),
				});
			}

			// Show success message
			await replySummaryEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.setup.success_title",
				descriptionKey: isDMChannel
					? "commands.config.setup.success_desc_dm"
					: "commands.config.setup.success_desc",
				color:
					avatarUpdateFailed || isDMChannel
						? ColorCode.WARN
						: ColorCode.SUCCESS,
				fields: successFields,
				footerKey: isDMChannel
					? "commands.persona.default.avatar_update_skipped_dm"
					: avatarUpdateFailed
						? "commands.persona.default.avatar_update_failed"
						: undefined,
			});
		} catch (modalError) {
			// Handle errors within modal submission context
			log.error("Error during modal submission processing:", modalError);

			// Try to respond to the modal submission interaction if we have it
			const modalSubmitInteraction = modalResult.interaction;
			if (modalSubmitInteraction) {
				try {
					await replyInfoEmbed(modalSubmitInteraction, locale, {
						titleKey: "general.errors.unknown_error_title",
						descriptionKey: "general.errors.unknown_error_description",
						color: ColorCode.ERROR,
					});
				} catch (replyError) {
					log.error("Failed to send modal error reply:", replyError);
				}
			}
		}
	} catch (error) {
		// Top-level error handler for non-modal errors (before modal is shown)
		log.error("Error during setup process:", error);
		if (!interaction.replied && !interaction.deferred) {
			try {
				await replyInfoEmbed(interaction, locale, {
					titleKey: "general.errors.unknown_error_title",
					descriptionKey: "general.errors.unknown_error_description",
					color: ColorCode.ERROR,
				});
			} catch (replyError) {
				log.error("Failed to send setup error reply:", replyError);
			}
		}
	}
}
