import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { promptForSavedProvider, replaceProviderPickerWithInfo } from "@/commands/model/providerPicker";
import { configRepository, llmModelRepo } from "@/utils/db/repositories";
import { getDiffusionModelById } from "@/utils/image/naiDiffusionModels";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { getProviderDisplayName, getStaticProviderInfo } from "@/utils/provider/providerInfoRegistry";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_model_image_modal";
const MODEL_SELECT_ID = "model_select";

/**
 * Type definition for image diffusion model row
 */
interface ImageDiffusionModelRow {
  diffusion_model_id?: number;
  provider: string;
  codename: string;
  model_description?: string | null;
  ja_description?: string | null;
  is_default: boolean;
  is_deprecated: boolean;
  is_free: boolean;
  is_uncensored: boolean;
  is_scoped_registration?: boolean;
}

/**
 * Helper function to get localized image model description based on user's locale
 * @param model - Image diffusion model row from database
 * @param locale - User's preferred locale (e.g., "ja", "en-US")
 * @returns Localized description with flags prepended (e.g., "(FREE+UNCENSORED) Description")
 */
function getLocalizedDescription(model: ImageDiffusionModelRow, locale: string): string {
  if (model.is_scoped_registration) {
    return localizer(locale, "general.scoped_openrouter_model_description");
  }

  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.model_description;
  const baseDescription = description || model.model_description || `${model.provider} model`;

  const flags: string[] = [];
  if (model.is_free) flags.push("FREE");
  if (model.is_uncensored) flags.push("UNCENSORED");

  const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
  return `${flagPrefix}${baseDescription}`;
}

function getClearTargetLabel(locale: string, target: string): string {
  switch (target) {
    case "standard":
      return localizer(locale, "commands.model.image.clear_standard_option");
    case "nai":
      return localizer(locale, "commands.model.image.clear_nai_option");
    case "all":
      return localizer(locale, "commands.model.image.clear_all_option");
    default:
      return target;
  }
}

function getImageModelDisplayName(
  model: Pick<ImageDiffusionModelRow, "model_description" | "codename"> | null | undefined,
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
  subcommand
    .setName("image")
    .setDescription(localizer("en-US", "commands.model.image.description"))
    .addStringOption((option) =>
      option
        .setName("clear")
        .setDescription(localizer("en-US", "commands.model.image.clear_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.model.image.clear_standard_option"),
            value: "standard",
          },
          {
            name: localizer("en-US", "commands.model.image.clear_nai_option"),
            value: "nai",
          },
          {
            name: localizer("en-US", "commands.model.image.clear_all_option"),
            value: "all",
          },
        ),
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

  const clearTarget = interaction.options.getString("clear");
  if (clearTarget) {
    const nextStandardModelId = clearTarget === "nai" ? tomoriState.config.diffusion_model_id : null;
    const nextNaiModelId = clearTarget === "standard" ? tomoriState.config.nai_diffusion_model_id : null;

    await Promise.all([
      configRepository.updateModelConfig(tomoriState.server_id, {
        diffusion_model_id: nextStandardModelId,
      }),
      configRepository.updateNovelaiImagegenConfig(tomoriState.server_id, {
        nai_diffusion_model_id: nextNaiModelId,
      }),
    ]);

    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.model.image.slot_cleared_title",
      descriptionKey: "commands.model.image.slot_cleared_description",
      descriptionVars: {
        target: getClearTargetLabel(locale, clearTarget),
      },
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Track modal submit interaction and selected model for error handling in catch block
  let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;
  let selectedModel: ImageDiffusionModelRow | null = null; // For error context and logic
  let responseInteraction: ChatInputCommandInteraction | import("discord.js").ButtonInteraction = interaction;
  let providerSelection: Awaited<ReturnType<typeof promptForSavedProvider>> = null;

  try {
    const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "image");

    const hasNaiProviders = savedProviders.some(
      (provider) => getStaticProviderInfo(provider.provider)?.featureSupport.imageGeneration === "nai-pipeline",
    );
    const pickerOptions = hasNaiProviders
      ? {
          additionalDescription: localizer(locale, "commands.model.image.nai_picker_note"),
        }
      : undefined;
    providerSelection = await promptForSavedProvider(interaction, locale, savedProviders, pickerOptions);

    if (!providerSelection) {
      return;
    }
    const selectedProvider = providerSelection.provider;
    responseInteraction = providerSelection.interaction;

    if (isCustomProvider(selectedProvider)) {
      const selectedSavedConfig = savedProviders.find((row) => row.provider.toLowerCase() === selectedProvider) ?? null;
      const selectedModelId = selectedSavedConfig?.diffusion_model_id ?? null;
      if (!selectedModelId) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.model.image.no_models_title",
          descriptionKey: "commands.model.image.no_models_description",
          descriptionVars: {
            provider: getProviderDisplayName(selectedProvider),
          },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const currentSelectedId = tomoriState.config.diffusion_model_id ?? null;
      const [selectedConfiguredModel, previousModel] = await Promise.all([
        getDiffusionModelById(selectedModelId),
        currentSelectedId ? getDiffusionModelById(currentSelectedId) : Promise.resolve(null),
      ]);
      const selectedModelName =
        selectedSavedConfig?.custom_model_name ??
        getImageModelDisplayName(selectedConfiguredModel) ??
        getProviderDisplayName(selectedProvider);

      if (selectedModelId === currentSelectedId) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.model.image.already_selected_title",
          descriptionKey: "commands.model.image.already_selected_description",
          descriptionVars: {
            model_name: selectedModelName,
          },
          color: ColorCode.WARN,
        });
        return;
      }

      const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
        diffusion_model_id: selectedModelId,
      });

      if (!updated) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.image.success_title",
        descriptionKey: "commands.model.image.success_description",
        descriptionVars: {
          model_name: selectedModelName,
          previous_model:
            getImageModelDisplayName(previousModel) ?? localizer(locale, "commands.model.image.current_none"),
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    const availableModels =
      (await llmModelRepo.loadAvailableDiffusionModels(selectedProvider, false, {
        kind: "server",
        ownerId: tomoriState.server_id,
      })) ?? [];

    if (!availableModels.length) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.image.no_models_title",
        descriptionKey: "commands.model.image.no_models_description",
        descriptionVars: {
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const imageGenerationStyle = getStaticProviderInfo(selectedProvider)?.featureSupport.imageGeneration ?? "none";
    const targetColumn = imageGenerationStyle === "nai-pipeline" ? "nai_diffusion_model_id" : "diffusion_model_id";
    const currentSelectedId =
      targetColumn === "nai_diffusion_model_id"
        ? tomoriState.config.nai_diffusion_model_id
        : tomoriState.config.diffusion_model_id;

    // 5. Create model options for the select menu using localized descriptions
    const modelSelectOptions: SelectOption[] = availableModels
      .filter((model) => model.diffusion_model_id !== undefined && model.diffusion_model_id !== null)
      .map((model) => ({
        label: safeSelectOptionText(model.codename), // Use codename as display label
        value: safeSelectOptionText((model.diffusion_model_id ?? 0).toString()), // Use diffusion_model_id as value
        description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)), // Use locale-specific description with flags
      }));

    // 6. Show the modal with model selection
    const modalResult = await promptWithRawModal(
      responseInteraction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.model.image.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.image.select_label",
            descriptionKey: "commands.model.image.select_description",
            placeholder: "commands.model.image.select_placeholder",
            required: true,
            options: modelSelectOptions,
          },
        ],
      },
      MessageFlags.Ephemeral, // Auto-defer with ephemeral flag
    );

    // 7. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Image model selection modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // Extract values from the modal
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    modalSubmitInteraction = modalResult.interaction!;
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const selectedModelIdStr = modalResult.values![MODEL_SELECT_ID];

    // 8. Find the selected model details by diffusion_model_id
    const selectedModelId = Number.parseInt(selectedModelIdStr, 10);
    selectedModel = availableModels.find((model) => model.diffusion_model_id === selectedModelId) ?? null;

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
        content: localizer(locale, "commands.model.image.invalid_model_description"),
      });
      return;
    }

    // 9. Check if this is the same as the current model
    if (selectedModel.diffusion_model_id === currentSelectedId) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.image.already_selected_title",
        descriptionKey: "commands.model.image.already_selected_description",
        descriptionVars: {
          model_name: selectedModel.codename,
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // 10. Update the config in the database via the repository
    const updated =
      targetColumn === "nai_diffusion_model_id"
        ? await configRepository.updateNovelaiImagegenConfig(tomoriState.server_id, {
            nai_diffusion_model_id: selectedModel.diffusion_model_id,
          })
        : await configRepository.updateModelConfig(tomoriState.server_id, {
            diffusion_model_id: selectedModel.diffusion_model_id,
          });

    if (!updated) {
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
        },
      };
      await log.error(
        "Failed to update diffusion model config after DB update",
        new Error("Database update returned no rows"),
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
    const previousModel = currentSelectedId ? await getDiffusionModelById(currentSelectedId) : null;

    const successOptions = {
      titleKey: "commands.model.image.success_title",
      descriptionKey: "commands.model.image.success_description",
      descriptionVars: {
        model_name: selectedModel.codename,
        previous_model:
          getImageModelDisplayName(previousModel) ?? localizer(locale, "commands.model.image.current_none"),
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
    await log.error(`Error executing /config model image for user ${userData.user_disc_id}`, error as Error, context);

    // 14. Inform user of unknown error
    // Use modalSubmitInteraction if available (error after modal), otherwise interaction (error during modal)
    const replyTarget = modalSubmitInteraction ?? responseInteraction;
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
