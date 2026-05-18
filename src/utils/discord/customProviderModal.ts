/**
 * Legacy Custom Provider Modal Utilities
 *
 * Shared utilities for the retired inline custom-provider setup flow.
 * Phase 3 moved user-facing setup to /config custom-endpoint and /personal custom-endpoint.
 *
 * These helpers remain for compatibility with legacy data and shared constants.
 */

import {
  ActionRowBuilder,
  ComponentType,
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
import { configRepository, llmModelRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import type { McpUrlValidationResult } from "@/utils/mcp/mcpUrlSecurity";
import { isCustomProvider as isCustomProviderHelper } from "@/utils/provider/customProviderUtils";
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
  /** Optional context window override (e.g. Ollama num_ctx). Null means use endpoint default. */
  numCtx: number | null;
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
        {
          label: localizer(locale, "commands.config.custom.capability_tools_yes"),
          value: "true",
          default: true,
        },
        {
          label: localizer(locale, "commands.config.custom.capability_tools_no"),
          value: "false",
        },
      ]);

    const imagesSelect = new StringSelectMenuBuilder()
      .setCustomId("cap_images")
      .setPlaceholder(localizer(locale, "commands.config.custom.capability_images_label"))
      .addOptions([
        {
          label: localizer(locale, "commands.config.custom.capability_images_yes"),
          value: "true",
          default: true,
        },
        {
          label: localizer(locale, "commands.config.custom.capability_images_no"),
          value: "false",
        },
      ]);

    const videosSelect = new StringSelectMenuBuilder()
      .setCustomId("cap_videos")
      .setPlaceholder(localizer(locale, "commands.config.custom.capability_videos_label"))
      .addOptions([
        {
          label: localizer(locale, "commands.config.custom.capability_videos_yes"),
          value: "true",
        },
        {
          label: localizer(locale, "commands.config.custom.capability_videos_no"),
          value: "false",
          default: true,
        },
      ]);

    const structOutputSelect = new StringSelectMenuBuilder()
      .setCustomId("cap_structoutput")
      .setPlaceholder(localizer(locale, "commands.config.custom.capability_structoutput_label"))
      .addOptions([
        {
          label: localizer(locale, "commands.config.custom.capability_structoutput_yes"),
          value: "true",
        },
        {
          label: localizer(locale, "commands.config.custom.capability_structoutput_no"),
          value: "false",
          default: true,
        },
      ]);

    // Create buttons: model name input, context window input, and confirm
    const modelNameButton = new ButtonBuilder()
      .setCustomId("set_model_name")
      .setLabel(localizer(locale, "commands.config.custom.model_name_label"))
      .setStyle(ButtonStyle.Secondary);

    const numCtxButton = new ButtonBuilder()
      .setCustomId("set_num_ctx")
      .setLabel(localizer(locale, "commands.config.custom.num_ctx_label"))
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
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(modelNameButton, numCtxButton, confirmButton);

    // Track selected values (defaults match the select menu defaults)
    let hasTools = true;
    let seesImages = true;
    let seesVideos = false;
    let supportsStructOutput = false;
    let customModelName = "";
    let customNumCtx: number | null = null;

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
            .setRequired(true)
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
        } else if (i.isButton() && i.customId === "set_num_ctx") {
          // Show modal for context window size input
          const modal = new ModalBuilder()
            .setCustomId("num_ctx_modal")
            .setTitle(localizer(locale, "commands.config.custom.num_ctx_label"));

          const numCtxInput = new TextInputBuilder()
            .setCustomId("num_ctx_input")
            .setLabel(localizer(locale, "commands.config.custom.num_ctx_label"))
            .setPlaceholder(localizer(locale, "commands.config.custom.num_ctx_placeholder"))
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(8);

          // Pre-fill with current value if set
          if (customNumCtx !== null) {
            numCtxInput.setValue(String(customNumCtx));
          }

          const row = new ActionRowBuilder<TextInputBuilder>().addComponents(numCtxInput);
          modal.addComponents(row);

          await i.showModal(modal);

          try {
            const modalSubmit = await i.awaitModalSubmit({
              filter: (modalI) => modalI.customId === "num_ctx_modal" && modalI.user.id === i.user.id,
              time: 300000,
            });

            const rawValue = modalSubmit.fields.getTextInputValue("num_ctx_input").trim();

            if (rawValue === "") {
              // User cleared the field — reset to no override
              customNumCtx = null;
            } else {
              const parsed = Number.parseInt(rawValue, 10);
              if (Number.isNaN(parsed) || parsed < 512) {
                // Invalid input — inform user and leave current value unchanged
                await modalSubmit.reply({
                  content: localizer(locale, "commands.config.custom.num_ctx_invalid"),
                  ephemeral: true,
                });
                return;
              }
              customNumCtx = parsed;
            }

            await modalSubmit.deferUpdate();

            // Update the display to reflect the new context window size
            const modelNameDisplay =
              customModelName || localizer(locale, "commands.config.custom.model_name_placeholder");
            const numCtxDisplay = customNumCtx !== null ? String(customNumCtx) : localizer(locale, "general.none");
            await interaction.editReply({
              content: `${localizer(locale, "commands.config.custom.capabilities_prompt")}\n\n**${localizer(locale, "commands.config.custom.model_name_label")}:** \`${modelNameDisplay}\`\n**${localizer(locale, "commands.config.custom.num_ctx_label")}:** \`${numCtxDisplay}\``,
              components: [toolsRow, imagesRow, videosRow, structOutputRow, buttonRow],
            });
          } catch (modalError) {
            log.warn("Context window modal timed out or errored:", modalError);
          }
        } else if (i.isButton() && i.customId === "confirm_capabilities") {
          if (!customModelName.trim()) {
            await i.reply({
              content: localizer(locale, "commands.config.custom.model_name_required_description"),
              ephemeral: true,
            });
            return;
          }

          collector.stop("confirmed");

          // Acknowledge the button
          await i.deferUpdate();

          // Create the llms row for this custom model
          const llmId = await createCustomLLMEntry(serverId, hasTools, seesImages, seesVideos, supportsStructOutput);

          resolve({
            success: true,
            modelName: customModelName,
            hasTools,
            seesImages,
            seesVideos,
            supportsStructOutput,
            numCtx: customNumCtx,
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
            numCtx: null,
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
      numCtx: null,
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

  const llmId = await llmModelRepo.upsertLegacyCustomLlm({
    codename,
    hasTools,
    seesImages,
    seesVideos,
    supportsStructOutput,
  });
  if (!llmId) {
    throw new Error(`Failed to create custom LLM entry for ${codename}`);
  }
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

  const deleted = await llmModelRepo.deleteLegacyCustomLlm(codename);
  if (deleted) {
    log.info(`Deleted custom LLM entry for server ${serverId}`);
  }
}

/**
 * Save custom endpoint configuration to server_model_configs
 *
 * @param serverId - The internal server_id to update
 * @param endpointUrl - The custom endpoint URL
 * @param llmId - The llm_id of the custom model
 * @param customModelName - Optional custom model name (e.g., "gemma3:latest" for Ollama)
 * @param numCtx - Optional context window size override (e.g., 8192 for Ollama num_ctx)
 */
export async function saveCustomEndpointConfig(
  serverId: number,
  endpointUrl: string,
  llmId: number,
  customModelName?: string,
  numCtx?: number | null,
): Promise<void> {
  await configRepository.updateModelConfig(serverId, {
    custom_endpoint_url: endpointUrl,
    custom_model_name: customModelName || null,
    custom_num_ctx: numCtx ?? null,
    llm_id: llmId,
  });

  log.info(
    `Saved custom endpoint config for server ${serverId}${customModelName ? ` with model name: ${customModelName}` : ""}${numCtx ? ` with num_ctx: ${numCtx}` : ""}`,
  );
}

/**
 * Result of the other-model configuration
 */
export interface OtherModelConfigResult {
  success: boolean;
  modelName?: string;
  error?: string;
}

/**
 * Prompt user for their OpenRouter model codename using button → modal pattern
 *
 * Flow:
 * 1. Edit the deferred reply with a "Enter Model" button
 * 2. Button click opens a text input modal (button → modal is Discord-allowed)
 * 3. User submits model codename (e.g., "xai/grok-2")
 * 4. Return the entered model name for validation by the caller
 *
 * @param interaction - Already-deferred interaction to edit
 * @param locale - User's locale for localized strings
 * @returns Promise<OtherModelConfigResult>
 */
export async function promptOtherModelConfig(
  interaction: ModalSubmitInteraction | ButtonInteraction,
  locale: string,
): Promise<OtherModelConfigResult> {
  try {
    // 1. Build the "Enter Model" button and edit the deferred reply
    const enterModelButton = new ButtonBuilder()
      .setCustomId("enter_model_name")
      .setLabel(localizer(locale, "commands.model.text.other_model_model_label"))
      .setStyle(ButtonStyle.Primary);

    const message = await interaction.editReply({
      content: localizer(locale, "commands.model.text.other_model_prompt_description"),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(enterModelButton)],
    });

    // 2. Await button click using awaitMessageComponent (more reliable than collector on ephemeral replies)
    let buttonInteraction: ButtonInteraction;
    try {
      buttonInteraction = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id && i.customId === "enter_model_name",
        time: 300000, // 5 minutes
      });
    } catch {
      // Timed out waiting for button click
      return {
        success: false,
        error: localizer(locale, "general.interaction.timeout_description"),
      };
    }

    // 3. Show modal from button click (button → modal is Discord-allowed)
    const modal = new ModalBuilder()
      .setCustomId("other_model_modal")
      .setTitle(localizer(locale, "commands.model.text.other_model_modal_title"));

    const modelInput = new TextInputBuilder()
      .setCustomId("model_name_input")
      .setLabel(localizer(locale, "commands.model.text.other_model_model_label"))
      .setPlaceholder(localizer(locale, "commands.model.text.other_model_model_placeholder"))
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(100);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(modelInput));

    await buttonInteraction.showModal(modal);

    // 4. Await modal submission
    let modalSubmit: ModalSubmitInteraction;
    try {
      modalSubmit = await buttonInteraction.awaitModalSubmit({
        filter: (m) => m.customId === "other_model_modal" && m.user.id === buttonInteraction.user.id,
        time: 300000,
      });
    } catch {
      // Timed out waiting for modal submit
      return {
        success: false,
        error: localizer(locale, "general.interaction.timeout_description"),
      };
    }

    const enteredModel = modalSubmit.fields.getTextInputValue("model_name_input").trim();

    // Defer the modal so the caller can use editReply for follow-up messages
    await modalSubmit.deferUpdate();

    return { success: true, modelName: enteredModel };
  } catch (error) {
    log.error("Error in promptOtherModelConfig:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if a provider is the custom provider
 *
 * @param provider - Provider name to check
 * @returns boolean - True if the provider is "custom"
 */
export function isCustomProvider(provider: string): boolean {
  return isCustomProviderHelper(provider);
}

/**
 * Validate custom endpoint URL format (lightweight sync check).
 * Use validateRemoteMcpUrl() from mcpUrlSecurity for the full security gate.
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

/**
 * Maps a McpUrlValidationResult failure code to the appropriate locale keys
 * for the custom provider endpoint URL error messages.
 *
 * @param validation - The failed validation result from validateRemoteMcpUrl()
 * @returns Locale key and optional variable substitutions for replyInfoEmbed
 */
export function getCustomEndpointValidationMessage(validation: McpUrlValidationResult): {
  descriptionKey: string;
  descriptionVars?: Record<string, string>;
} {
  switch (validation.failureCode) {
    case "INVALID_PROTOCOL":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_protocol_description",
      };
    case "PRODUCTION_HTTPS_REQUIRED":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_https_required_description",
      };
    case "REMOTE_HTTP_FORBIDDEN":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_http_localhost_only_description",
      };
    case "PRODUCTION_LOCALHOST_FORBIDDEN":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_localhost_blocked_description",
      };
    case "DNS_RESOLUTION_FAILED":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_dns_failed_description",
        descriptionVars: { hostname: validation.hostname ?? "unknown" },
      };
    case "PRODUCTION_BLOCKED_ADDRESS":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_private_address_description",
        descriptionVars: { address: validation.blockedAddress ?? "unknown" },
      };
    default:
      // INVALID_FORMAT or unexpected codes
      return {
        descriptionKey: "commands.config.custom.endpoint_url_invalid_description",
      };
  }
}
