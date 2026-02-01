/**
 * Custom Provider Modal Utilities
 *
 * Shared utilities for handling the custom provider's two-step modal flow.
 * Used by /config setup and /config apikey set commands.
 *
 * Flow:
 * 1. User selects "custom" provider in the first modal
 * 2. The api_key field is used to input the endpoint URL
 * 3. After first modal submission, show capabilities selection (message components)
 * 4. Create new llms row with user-declared capabilities
 * 5. Save endpoint URL to tomori_configs.custom_endpoint_url
 */

import {
	ActionRowBuilder,
	StringSelectMenuBuilder,
	type ModalSubmitInteraction,
	type ButtonInteraction,
	type StringSelectMenuInteraction,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * Default model name for custom provider (informational only)
 */
export const DEFAULT_CUSTOM_MODEL_NAME = "custom";

/**
 * Placeholder API key value for custom provider
 * This satisfies existing validation logic that expects a non-empty API key
 */
export const CUSTOM_ENDPOINT_PLACEHOLDER_KEY = "custom-endpoint-configured";

/**
 * Result of the custom provider capabilities configuration
 */
export interface CustomCapabilitiesResult {
	success: boolean;
	modelName: string;
	hasTools: boolean;
	seesImages: boolean;
	seesVideos: boolean;
	supportsStructOutput: boolean;
	llmId?: number;
	error?: string;
}

/**
 * Prompt user for custom model capabilities using message components
 *
 * This function is designed to work with already-deferred interactions.
 * It edits the existing reply with select menus and a confirm button.
 *
 * @param interaction - The deferred interaction to edit (modal submit or button)
 * @param locale - User's locale for localized strings
 * @param serverId - The server ID for creating the llms row
 * @returns Promise<CustomCapabilitiesResult> - The result of the capabilities configuration
 */
export async function promptCustomCapabilities(
	interaction: ModalSubmitInteraction | ButtonInteraction,
	locale: string,
	serverId: string | number,
): Promise<CustomCapabilitiesResult> {
	try {
		// Create model name input using a text input in a modal
		// First show select menus for capabilities, with model name as optional text input

		// Create select menus for each capability with descriptive labels
		const toolsSelect = new StringSelectMenuBuilder()
			.setCustomId("cap_tools")
			.setPlaceholder(localizer(locale, "commands.config.custom.capability_tools_label"))
			.addOptions([
				{ label: localizer(locale, "commands.config.custom.capability_tools_yes"), value: "true", default: true },
				{ label: localizer(locale, "commands.config.custom.capability_tools_no"), value: "false" },
			]);

		const imagesSelect = new StringSelectMenuBuilder()
			.setCustomId("cap_images")
			.setPlaceholder(localizer(locale, "commands.config.custom.capability_images_label"))
			.addOptions([
				{ label: localizer(locale, "commands.config.custom.capability_images_yes"), value: "true", default: true },
				{ label: localizer(locale, "commands.config.custom.capability_images_no"), value: "false" },
			]);

		const videosSelect = new StringSelectMenuBuilder()
			.setCustomId("cap_videos")
			.setPlaceholder(localizer(locale, "commands.config.custom.capability_videos_label"))
			.addOptions([
				{ label: localizer(locale, "commands.config.custom.capability_videos_yes"), value: "true" },
				{ label: localizer(locale, "commands.config.custom.capability_videos_no"), value: "false", default: true },
			]);

		const structOutputSelect = new StringSelectMenuBuilder()
			.setCustomId("cap_structoutput")
			.setPlaceholder(localizer(locale, "commands.config.custom.capability_structoutput_label"))
			.addOptions([
				{ label: localizer(locale, "commands.config.custom.capability_structoutput_yes"), value: "true" },
				{ label: localizer(locale, "commands.config.custom.capability_structoutput_no"), value: "false", default: true },
			]);

		// Create buttons: model name input and confirm
		const modelNameButton = new ButtonBuilder()
			.setCustomId("set_model_name")
			.setLabel(localizer(locale, "commands.config.custom.model_name_label"))
			.setStyle(ButtonStyle.Secondary);

		const confirmButton = new ButtonBuilder()
			.setCustomId("confirm_capabilities")
			.setLabel(localizer(locale, "general.confirm"))
			.setStyle(ButtonStyle.Primary);

		// Build rows
		const toolsRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toolsSelect);
		const imagesRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(imagesSelect);
		const videosRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(videosSelect);
		const structOutputRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(structOutputSelect);
		const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(modelNameButton, confirmButton);

		// Track selected values (defaults match the select menu defaults)
		let hasTools = true;
		let seesImages = true;
		let seesVideos = false;
		let supportsStructOutput = false;
		let customModelName = ""; // Empty string means use default (llm_codename)

		// Helper function to update the message content with current model name
		const updateMessageContent = () => {
			const modelNameDisplay = customModelName || localizer(locale, "commands.config.custom.model_name_placeholder");
			return `${localizer(locale, "commands.config.custom.capabilities_prompt")}\n\n**${localizer(locale, "commands.config.custom.model_name_label")}:** \`${modelNameDisplay}\``;
		};

		// Edit the deferred reply with the capabilities selection
		const message = await interaction.editReply({
			content: updateMessageContent(),
			components: [toolsRow, imagesRow, videosRow, structOutputRow, buttonRow],
		});

		// Create collector for both select menus and button
		const collector = message.createMessageComponentCollector({
			filter: (i) => i.user.id === interaction.user.id,
			time: 300000, // 5 minute timeout
		});

		return new Promise((resolve) => {
			collector.on("collect", async (i) => {
				if (i.isStringSelectMenu()) {
					const selectInteraction = i as StringSelectMenuInteraction;
					const value = selectInteraction.values[0] === "true";

					switch (selectInteraction.customId) {
						case "cap_tools":
							hasTools = value;
							break;
						case "cap_images":
							seesImages = value;
							break;
						case "cap_videos":
							seesVideos = value;
							break;
						case "cap_structoutput":
							supportsStructOutput = value;
							break;
					}

					// Acknowledge the selection without sending a new message
					await selectInteraction.deferUpdate();
				} else if (i.isButton() && i.customId === "set_model_name") {
					// Show modal for model name input
					const modal = new ModalBuilder()
						.setCustomId("model_name_modal")
						.setTitle(localizer(locale, "commands.config.custom.model_name_label"));

					const modelNameInput = new TextInputBuilder()
						.setCustomId("model_name_input")
						.setLabel(localizer(locale, "commands.config.custom.model_name_label"))
						.setPlaceholder(localizer(locale, "commands.config.custom.model_name_placeholder"))
						.setStyle(TextInputStyle.Short)
						.setRequired(false)
						.setMaxLength(100);

					// Set current value if exists
					if (customModelName) {
						modelNameInput.setValue(customModelName);
					}

					const row = new ActionRowBuilder<TextInputBuilder>().addComponents(modelNameInput);
					modal.addComponents(row);

					await i.showModal(modal);

					// Wait for modal submission (with timeout)
					try {
						const modalSubmit = await i.awaitModalSubmit({
							filter: (modalI) => modalI.customId === "model_name_modal" && modalI.user.id === i.user.id,
							time: 300000, // 5 minutes
						});

						// Update the model name
						customModelName = modalSubmit.fields.getTextInputValue("model_name_input").trim();

						// Acknowledge the modal submission
						await modalSubmit.deferUpdate();

						// Update the message to show the new model name
						await interaction.editReply({
							content: updateMessageContent(),
							components: [toolsRow, imagesRow, videosRow, structOutputRow, buttonRow],
						});
					} catch (modalError) {
						// Timeout or error - just log and continue
						log.warn("Model name modal timed out or errored:", modalError);
					}
				} else if (i.isButton() && i.customId === "confirm_capabilities") {
					collector.stop("confirmed");

					// Acknowledge the button
					await i.deferUpdate();

					// Create the llms row for this custom model
					const llmId = await createCustomLLMEntry(
						serverId,
						hasTools,
						seesImages,
						seesVideos,
						supportsStructOutput,
					);

					resolve({
						success: true,
						modelName: customModelName, // Return the custom model name (or empty string for default)
						hasTools,
						seesImages,
						seesVideos,
						supportsStructOutput,
						llmId,
					});
				}
			});

			collector.on("end", (_collected, reason) => {
				if (reason !== "confirmed") {
					resolve({
						success: false,
						modelName: DEFAULT_CUSTOM_MODEL_NAME,
						hasTools: false,
						seesImages: false,
						seesVideos: false,
						supportsStructOutput: false,
						error: localizer(locale, "commands.config.custom.capabilities_timeout"),
					});
				}
			});
		});
	} catch (error) {
		log.error("Error in custom capabilities prompt:", error);
		return {
			success: false,
			modelName: DEFAULT_CUSTOM_MODEL_NAME,
			hasTools: false,
			seesImages: false,
			seesVideos: false,
			supportsStructOutput: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

/**
 * Create a new LLM entry in the database for a custom model
 *
 * @param serverId - Server ID to associate the model with (used in codename for uniqueness)
 * @param hasTools - Whether the model supports function calling
 * @param seesImages - Whether the model can process images
 * @param seesVideos - Whether the model can process videos
 * @param supportsStructOutput - Whether the model supports structured output
 * @returns Promise<number> - The llm_id of the created entry
 */
async function createCustomLLMEntry(
	serverId: string | number,
	hasTools: boolean,
	seesImages: boolean,
	seesVideos: boolean,
	supportsStructOutput: boolean,
): Promise<number> {
	// Create a unique codename for this server's custom model
	// Format: custom/{serverId} - one custom model per server
	const codename = `custom/${serverId}`;

	log.info(`Creating custom LLM entry: ${codename}`);

	// Insert or update the LLM entry
	// Use ON CONFLICT to handle cases where the server reconfigures their custom model
	const result = await sql`
		INSERT INTO llms (
			llm_provider,
			llm_codename,
			has_tools,
			sees_images,
			sees_videos,
			sees_youtube,
			supports_structoutput,
			is_smartest,
			is_default,
			is_reasoning,
			is_deprecated,
			is_free,
			is_uncensored,
			llm_description
		) VALUES (
			'custom',
			${codename},
			${hasTools},
			${seesImages},
			${seesVideos},
			false,
			${supportsStructOutput},
			false,
			false,
			false,
			false,
			true,
			true,
			${"Custom endpoint model configured by server admin"}
		)
		ON CONFLICT (llm_codename) DO UPDATE SET
			has_tools = EXCLUDED.has_tools,
			sees_images = EXCLUDED.sees_images,
			sees_videos = EXCLUDED.sees_videos,
			supports_structoutput = EXCLUDED.supports_structoutput,
			updated_at = CURRENT_TIMESTAMP
		RETURNING llm_id
	`;

	const llmId = result[0].llm_id as number;
	log.info(`Created/updated custom LLM entry with ID: ${llmId}`);

	return llmId;
}

/**
 * Delete custom LLM entry for a server
 * Called when a server switches away from the custom provider
 *
 * @param serverId - Server ID to find and delete the custom model for
 */
export async function deleteCustomLLMEntry(serverId: string | number): Promise<void> {
	const codename = `custom/${serverId}`;

	const result = await sql`
		DELETE FROM llms
		WHERE llm_codename = ${codename}
		RETURNING llm_id
	`;

	if (result.length > 0) {
		log.info(`Deleted custom LLM entry for server ${serverId}`);
	}
}

/**
 * Save custom endpoint configuration to tomori_configs
 *
 * @param serverId - The internal server_id to update
 * @param endpointUrl - The custom endpoint URL
 * @param llmId - The llm_id of the custom model
 * @param customModelName - Optional custom model name (e.g., "gemma3:latest" for Ollama)
 */
export async function saveCustomEndpointConfig(
	serverId: number,
	endpointUrl: string,
	llmId: number,
	customModelName?: string,
): Promise<void> {
	await sql`
		UPDATE tomori_configs
		SET
			custom_endpoint_url = ${endpointUrl},
			custom_model_name = ${customModelName || null},
			llm_id = ${llmId},
			updated_at = CURRENT_TIMESTAMP
		WHERE server_id = ${serverId}
	`;

	log.info(`Saved custom endpoint config for server ${serverId}${customModelName ? ` with model name: ${customModelName}` : ""}`);
}

/**
 * Check if a provider is the custom provider
 *
 * @param provider - Provider name to check
 * @returns boolean - True if the provider is "custom"
 */
export function isCustomProvider(provider: string): boolean {
	return provider.toLowerCase() === "custom";
}

/**
 * Validate custom endpoint URL format
 *
 * @param url - The URL to validate
 * @returns boolean - True if the URL appears to be a valid endpoint
 */
export function validateEndpointUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		// Must be http or https
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}
