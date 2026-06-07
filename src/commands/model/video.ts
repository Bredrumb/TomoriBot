/**
 * Video Model Configuration Command (/model video)
 * Allows server admins to select which video generation model Tomori uses.
 * Queries available models filtered by the current LLM provider.
 * Mirrors the /model image command pattern.
 */

import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { promptForSavedProvider, replaceProviderPickerWithInfo } from "@/utils/discord/providerPicker";
import { configRepository, llmModelRepo } from "@/utils/db/repositories";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { promptCustomModelSelection } from "@/utils/provider/customModelPicker";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_model_video_modal";
const MODEL_SELECT_ID = "model_select";

/**
 * Type definition for video generation model row from the database.
 * Mirrors ImageDiffusionModelRow but without is_uncensored.
 */
interface VideoGenerationModelRow {
  video_model_id?: number;
  provider: string;
  codename: string;
  model_description?: string | null;
  ja_description?: string | null;
  is_default: boolean;
  is_deprecated: boolean;
  is_free: boolean;
  is_scoped_registration?: boolean;
}

/**
 * Get localized video model description based on user's locale.
 * @param model - Video generation model row from database
 * @param locale - User's preferred locale (e.g., "ja", "en-US")
 * @returns Localized description with flags prepended (e.g., "(FREE) Description")
 */
function getLocalizedDescription(model: VideoGenerationModelRow, locale: string): string {
  if (model.is_scoped_registration) {
    return localizer(locale, "general.scoped_openrouter_model_description");
  }
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.model_description;
  const baseDescription = description || model.model_description || `${model.provider} model`;

  const flags: string[] = [];
  if (model.is_free && !isCustomProvider(model.provider)) flags.push("FREE");

  const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
  return `${flagPrefix}${baseDescription}`;
}

function getVideoModelDisplayName(
  model: Pick<VideoGenerationModelRow, "model_description" | "codename"> | null | undefined,
): string | null {
  const codename = model?.codename?.trim();
  if (codename && codename.length > 0) {
    return codename;
  }

  const description = model?.model_description?.trim();
  return description && description.length > 0 ? description : null;
}

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("video").setDescription(localizer("en-US", "commands.model.video.description"));

/**
 * Changes Tomori's video generation model.
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
  const tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Track modal submit interaction and selected model for error handling in catch block
  let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;
  let selectedModel: VideoGenerationModelRow | null = null;
  let responseInteraction: ChatInputCommandInteraction | import("discord.js").ButtonInteraction = interaction;
  let providerSelection: Awaited<ReturnType<typeof promptForSavedProvider>> = null;

  try {
    const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "video");
    providerSelection = await promptForSavedProvider(interaction, locale, savedProviders);

    if (!providerSelection) {
      return;
    }
    const selectedProvider = providerSelection.provider;
    responseInteraction = providerSelection.interaction;

    if (isCustomProvider(selectedProvider)) {
      const selectedSavedConfig = savedProviders.find((row) => row.provider.toLowerCase() === selectedProvider) ?? null;
      const customAvailableModels = selectedSavedConfig
        ? ((await llmModelRepo.loadAvailableVideoGenerationModels(selectedProvider, false, {
            kind: "server",
            ownerId: tomoriState.server_id,
          })) ?? [])
        : [];
      const customModelChoices = customAvailableModels.filter(
        (model): model is typeof model & { video_model_id: number } =>
          model.video_model_id !== undefined && model.video_model_id !== null,
      );
      if (!selectedSavedConfig || customModelChoices.length === 0) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.model.video.no_models_title",
          descriptionKey: "commands.model.video.no_models_description",
          descriptionVars: {
            provider: getProviderDisplayName(selectedProvider),
          },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Single registered model activates directly; multiple show a string-select picker.
      const selection = await promptCustomModelSelection({
        interaction: responseInteraction,
        locale,
        choices: customModelChoices.map((model) => ({
          model,
          value: model.video_model_id.toString(),
          label: getVideoModelDisplayName(model) ?? model.codename,
          description: getLocalizedDescription(model, userData.language_pref),
        })),
        modalCustomId: "config_model_video_custom_modal",
        modalTitleKey: "commands.model.video.modal_title",
        selectLabelKey: "commands.model.video.select_label",
        selectDescriptionKey: "commands.model.video.select_description",
        selectPlaceholderKey: "commands.model.video.select_placeholder",
      });
      if (!selection) return;

      const selectedConfiguredModel = selection.model;
      const customReplyTarget = selection.submitInteraction ?? responseInteraction;
      const currentSelectedId = tomoriState.config.video_model_id ?? null;
      const selectedModelName =
        getVideoModelDisplayName(selectedConfiguredModel) ?? getProviderDisplayName(selectedProvider);

      if (selectedConfiguredModel.video_model_id === currentSelectedId) {
        await replyInfoEmbed(customReplyTarget, locale, {
          titleKey: "commands.model.video.already_selected_title",
          descriptionKey: "commands.model.video.already_selected_description",
          descriptionVars: {
            model_name: selectedModelName,
          },
          color: ColorCode.WARN,
        });
        return;
      }

      const previousModel = currentSelectedId
        ? await llmModelRepo.loadVideoGenerationModelById(currentSelectedId)
        : null;
      const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
        video_model_id: selectedConfiguredModel.video_model_id,
      });

      if (!updated) {
        await replyInfoEmbed(customReplyTarget, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);
      await replyInfoEmbed(customReplyTarget, locale, {
        titleKey: "commands.model.video.success_title",
        descriptionKey: "commands.model.video.success_description",
        descriptionVars: {
          model_name: selectedModelName,
          previous_model:
            getVideoModelDisplayName(previousModel) ?? localizer(locale, "commands.model.video.current_none"),
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    const availableModels =
      (await llmModelRepo.loadAvailableVideoGenerationModels(selectedProvider, false, {
        kind: "server",
        ownerId: tomoriState.server_id,
      })) ?? [];

    if (!availableModels.length) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.video.no_models_title",
        descriptionKey: "commands.model.video.no_models_description",
        descriptionVars: {
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 6. Create model options for the select menu using localized descriptions
    const modelSelectOptions: SelectOption[] = availableModels
      .filter((model) => model.video_model_id !== undefined && model.video_model_id !== null)
      .map((model) => ({
        label: safeSelectOptionText(model.codename),
        value: safeSelectOptionText((model.video_model_id ?? 0).toString()),
        description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
      }));

    // 7. Show the modal with model selection
    const modalResult = await promptWithRawModal(
      responseInteraction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.model.video.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.video.select_label",
            descriptionKey: "commands.model.video.select_description",
            placeholder: "commands.model.video.select_placeholder",
            required: true,
            options: modelSelectOptions,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    // 8. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Video model selection modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // Extract values from the modal
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    modalSubmitInteraction = modalResult.interaction!;
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const selectedModelIdStr = modalResult.values![MODEL_SELECT_ID];

    // 9. Find the selected model details by video_model_id
    const selectedModelId = Number.parseInt(selectedModelIdStr, 10);
    selectedModel = availableModels.find((model) => model.video_model_id === selectedModelId) ?? null;

    if (!selectedModel?.video_model_id) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "CommandExecutionError",
        metadata: {
          command: "model video",
          guildId: interaction.guild?.id ?? interaction.user.id,
          requestedModelId: selectedModelIdStr,
          availableModels: availableModels.map((m) => m.video_model_id),
        },
      };
      await log.error(
        "Selected model ID not found in available video models from DB",
        new Error("Invalid model selection despite modal choices"),
        context,
      );

      await modalSubmitInteraction.editReply({
        content: localizer(locale, "commands.model.video.invalid_model_description"),
      });
      return;
    }

    // 10. Check if this is the same as the current model
    if (selectedModel.video_model_id === tomoriState.config.video_model_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.video.already_selected_title",
        descriptionKey: "commands.model.video.already_selected_description",
        descriptionVars: {
          model_name: selectedModel.codename,
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // 11. Update the config in the database
    const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
      video_model_id: selectedModel.video_model_id,
    });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "model video",
          guildId: interaction.guild?.id ?? interaction.user.id,
          selectedModelCodename: selectedModel.codename,
          targetVideoModelId: selectedModel.video_model_id,
        },
      };
      await log.error("Failed to update video model config", new Error("Database update failed"), context);

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 12. Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    // 14. Success message with previous model name
    const previousModel = tomoriState.config.video_model_id
      ? await llmModelRepo.loadVideoGenerationModelById(tomoriState.config.video_model_id)
      : null;

    const successOptions = {
      titleKey: "commands.model.video.success_title",
      descriptionKey: "commands.model.video.success_description",
      descriptionVars: {
        model_name: selectedModel.codename,
        previous_model:
          getVideoModelDisplayName(previousModel) ?? localizer(locale, "commands.model.video.current_none"),
        provider: getProviderDisplayName(selectedProvider),
      },
      color: ColorCode.SUCCESS,
    } as const;

    const replacedPicker =
      modalSubmitInteraction &&
      (await replaceProviderPickerWithInfo(providerSelection, modalSubmitInteraction, locale, successOptions));

    if (!replacedPicker) {
      await replyInfoEmbed(modalSubmitInteraction, locale, successOptions);
    }
  } catch (error) {
    // 15. Log error with context
    let serverIdForError: number | null = null;
    let personaIdForError: number | null = null;
    if (interaction.guild?.id) {
      const state = await getCachedTomoriState(interaction.guild.id);
      serverIdForError = state?.server_id ?? null;
      personaIdForError = state?.persona_id ?? null;
    }

    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: serverIdForError,
      personaId: personaIdForError,
      errorType: "CommandExecutionError",
      metadata: {
        command: "model video",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
        targetVideoModelIdAttempted: selectedModel?.video_model_id,
      },
    };
    await log.error(`Error executing /model video for user ${userData.user_disc_id}`, error as Error, context);

    // 16. Inform user of unknown error
    const replyTarget = modalSubmitInteraction ?? responseInteraction;
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
