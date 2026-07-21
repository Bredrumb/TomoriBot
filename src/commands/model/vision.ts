import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { configRepository, llmModelRepo } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { UserRow, ErrorContext, LlmRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { promptForSavedProvider, replaceProviderPickerWithInfo } from "@/utils/discord/providerPicker";
import { replyLegacyOpenRouterOtherModelMoved } from "@/utils/discord/openrouterModelMigrationNotice";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_model_vision_modal";
const MODEL_SELECT_ID = "vision_model_select";

/** Special sentinel value representing "clear the vision model" */
const CLEAR_VISION_VALUE = "__clear__";

/**
 * Helper function to get localized LLM description based on user's locale.
 * Only shows vision-relevant capability flags.
 * @param model - LLM model row from database
 * @param locale - User's preferred locale (e.g., "ja", "en-US")
 * @returns Localized description with flags prepended
 */
function getLocalizedDescription(model: LlmRow, locale: string): string {
  if (model.is_scoped_registration) {
    return localizer(locale, "general.scoped_openrouter_model_description");
  }
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.llm_description;
  const baseDescription = description || model.llm_description || `${model.llm_provider} model`;

  const flags: string[] = [];
  if (model.is_free && !isCustomProvider(model.llm_provider)) flags.push("FREE");
  if (model.has_tools) flags.push("TOOLS");
  if (model.sees_images) flags.push("IMG");
  if (model.sees_videos) flags.push("VID");
  if (model.supports_structoutput) flags.push("STRUCT");

  const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
  return `${flagPrefix}${baseDescription}`;
}

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("vision").setDescription(localizer("en-US", "commands.model.vision.description"));

/**
 * Sets a dedicated vision model for image analysis.
 * When set, non-vision chat models gain the `analyze_image` tool to delegate
 * image analysis to this vision model.
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
  const serverId = interaction.guild?.id ?? interaction.user.id;
  const tomoriState = await getCachedTomoriState(serverId);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Track modal state for error handling
  let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;
  let selectedModel: LlmRow | null = null;
  let responseInteraction: ChatInputCommandInteraction | import("discord.js").ButtonInteraction = interaction;
  let providerSelection: Awaited<ReturnType<typeof promptForSavedProvider>> = null;

  try {
    const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "vision");
    providerSelection = await promptForSavedProvider(interaction, locale, savedProviders, {
      currentSelections: tomoriState.vision_llm
        ? [
            {
              model: tomoriState.vision_llm.llm_codename,
              provider: tomoriState.vision_llm.llm_provider,
            },
          ]
        : [],
    });

    if (!providerSelection) {
      return;
    }
    const selectedProvider = providerSelection.provider;
    responseInteraction = providerSelection.interaction;

    if (isCustomProvider(selectedProvider)) {
      const selectedSavedConfig = savedProviders.find((row) => row.provider.toLowerCase() === selectedProvider) ?? null;
      if (!selectedSavedConfig?.vision_llm_id) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.model.vision.no_models_title",
          descriptionKey: "commands.model.vision.no_models_description",
          descriptionVars: {
            provider: getProviderDisplayName(selectedProvider),
          },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
        vision_llm_id: selectedSavedConfig.vision_llm_id,
      });

      if (!updated) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateTomoriStateCache(serverId);
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.vision.success_title",
        descriptionKey: tomoriState.llm.has_tools
          ? "commands.model.vision.success_description"
          : "commands.model.vision.success_no_tools_description",
        descriptionVars: {
          model_name: getProviderDisplayName(selectedProvider),
          chat_model: tomoriState.llm.llm_codename,
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    const allModels = await llmModelRepo.loadAvailableModelsForProvider(selectedProvider, false, {
      kind: "server",
      ownerId: tomoriState.server_id,
    });
    const visionModels = allModels?.filter((m) => m.sees_images) ?? [];

    if (visionModels.length === 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.vision.no_models_title",
        descriptionKey: "commands.model.vision.no_models_description",
        descriptionVars: {
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 5. Build select options: vision models + "clear" option
    const modelSelectOptions: SelectOption[] = [
      // "None" option to clear the vision model
      {
        label: safeSelectOptionText(localizer(locale, "commands.model.vision.clear_option")),
        value: CLEAR_VISION_VALUE,
        description: "",
      },
      // Vision-capable models
      ...visionModels.map((model) => ({
        label: safeSelectOptionText(model.llm_codename),
        value: safeSelectOptionText(model.llm_codename),
        description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
      })),
    ];

    // 6. Show the modal with vision model selection
    const modalResult = await promptWithRawModal(
      responseInteraction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.model.vision.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.vision.select_label",
            descriptionKey: "commands.model.vision.select_description",
            placeholder: "commands.model.vision.select_placeholder",
            required: true,
            options: modelSelectOptions,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    // 7. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Vision model selection modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    modalSubmitInteraction = modalResult.interaction!;
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const selectedValue = modalResult.values![MODEL_SELECT_ID];

    // 8. Handle "clear" selection — remove vision model
    if (selectedValue === CLEAR_VISION_VALUE) {
      // Check if already cleared
      if (!tomoriState.config.vision_llm_id) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.model.vision.cleared_title",
          descriptionKey: "commands.model.vision.cleared_description",
          color: ColorCode.WARN,
        });
        return;
      }

      const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
        vision_llm_id: null,
      });

      if (!updated) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateTomoriStateCache(serverId);

      const clearedOptions = {
        titleKey: "commands.model.vision.cleared_title",
        descriptionKey: "commands.model.vision.cleared_description",
        color: ColorCode.SUCCESS,
      } as const;

      const replacedPicker =
        modalSubmitInteraction &&
        (await replaceProviderPickerWithInfo(providerSelection, modalSubmitInteraction, locale, clearedOptions));

      if (!replacedPicker) {
        await replyInfoEmbed(modalSubmitInteraction, locale, clearedOptions);
      }
      return;
    }

    // 9. Find the selected vision model by codename
    selectedModel = visionModels.find((model) => model.llm_codename === selectedValue) ?? null;

    if (!selectedModel) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.vision.invalid_model_title",
        descriptionKey: "commands.model.vision.invalid_model_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (selectedModel.llm_codename === "other-model") {
      await replyLegacyOpenRouterOtherModelMoved(modalSubmitInteraction, locale, "server");
      return;
    }

    // 10. Check if already selected
    if (selectedModel.llm_id === tomoriState.config.vision_llm_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.vision.already_selected_title",
        descriptionKey: "commands.model.vision.already_selected_description",
        descriptionVars: { model_name: selectedModel.llm_codename },
        color: ColorCode.WARN,
      });
      return;
    }

    // 11. Update vision_llm_id in the database
    const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
      vision_llm_id: selectedModel.llm_id,
    });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "model vision",
          guildId: serverId,
          selectedModelCodename: selectedModel.llm_codename,
          targetVisionLlmId: selectedModel.llm_id,
        },
      };
      await log.error(
        "Failed to update vision model config after DB update",
        new Error("Database update failed"),
        context,
      );

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 13. Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(serverId);

    // 14. Success message (with tool warning if chat model lacks tool support)
    const descriptionKey = tomoriState.llm.has_tools
      ? "commands.model.vision.success_description"
      : "commands.model.vision.success_no_tools_description";

    const successOptions = {
      titleKey: "commands.model.vision.success_title",
      descriptionKey,
      descriptionVars: {
        model_name: selectedModel.llm_codename,
        chat_model: tomoriState.llm.llm_codename,
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
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id ?? null,
      personaId: tomoriState?.persona_id ?? null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "model vision",
        guildId: serverId,
        executorDiscordId: interaction.user.id,
        targetVisionLlmIdAttempted: selectedModel?.llm_id,
      },
    };
    await log.error(`Error executing /model vision for user ${userData.user_disc_id}`, error as Error, context);

    const replyTarget = modalSubmitInteraction ?? responseInteraction;
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
