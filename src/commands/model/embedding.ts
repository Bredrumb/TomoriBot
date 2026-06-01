import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { ErrorContext, UserRow, EmbeddingModelRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { configRepository, llmModelRepo, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { promptForSavedProvider, replaceProviderPickerWithInfo } from "@/utils/discord/providerPicker";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";

const MODAL_CUSTOM_ID = "config_model_embedding_modal";
const MODEL_SELECT_ID = "model_select";

function getLocalizedDescription(model: EmbeddingModelRow, locale: string): string {
  if (model.is_scoped_registration) {
    return localizer(locale, "general.scoped_openrouter_model_description");
  }
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.model_description;
  const baseDescription = description || model.model_description || `${model.provider} model`;

  const flags: string[] = [];
  if (model.is_default) flags.push("DEFAULT");
  const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
  return `${flagPrefix}${baseDescription}`;
}

function getEmbeddingModelDisplayName(
  model: Pick<EmbeddingModelRow, "model_description" | "codename"> | null | undefined,
): string | null {
  const codename = model?.codename?.trim();
  if (codename && codename.length > 0) {
    return codename;
  }

  const description = model?.model_description?.trim();
  return description && description.length > 0 ? description : null;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("embedding").setDescription(localizer("en-US", "commands.model.embedding.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

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

  let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;
  let selectedModel: EmbeddingModelRow | null = null;
  let responseInteraction: ChatInputCommandInteraction | import("discord.js").ButtonInteraction = interaction;
  let providerSelection: Awaited<ReturnType<typeof promptForSavedProvider>> = null;

  try {
    const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "embedding");
    providerSelection = await promptForSavedProvider(interaction, locale, savedProviders);

    if (!providerSelection) {
      return;
    }
    const selectedProvider = providerSelection.provider;
    responseInteraction = providerSelection.interaction;

    if (isCustomProvider(selectedProvider)) {
      const selectedSavedConfig = savedProviders.find((row) => row.provider.toLowerCase() === selectedProvider) ?? null;
      if (!selectedSavedConfig?.embedding_model_id) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.model.embedding.no_models_title",
          descriptionKey: "commands.model.embedding.no_models_description",
          descriptionVars: {
            provider: getProviderDisplayName(selectedProvider),
          },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const currentSelectedId = tomoriState.config.embedding_model_id ?? null;
      const [selectedConfiguredModel, previousModel] = await Promise.all([
        llmModelRepo.loadEmbeddingModelById(selectedSavedConfig.embedding_model_id),
        currentSelectedId ? llmModelRepo.loadEmbeddingModelById(currentSelectedId) : Promise.resolve(null),
      ]);
      const selectedModelName =
        getEmbeddingModelDisplayName(selectedConfiguredModel) ?? getProviderDisplayName(selectedProvider);

      if (selectedSavedConfig.embedding_model_id === currentSelectedId) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.model.embedding.already_selected_title",
          descriptionKey: "commands.model.embedding.already_selected_description",
          descriptionVars: {
            model_name: selectedModelName,
          },
          color: ColorCode.WARN,
        });
        return;
      }

      const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
        embedding_model_id: selectedSavedConfig.embedding_model_id,
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
        titleKey: "commands.model.embedding.success_title",
        descriptionKey: "commands.model.embedding.success_description",
        descriptionVars: {
          model_name: selectedModelName,
          previous_model:
            getEmbeddingModelDisplayName(previousModel) ?? localizer(locale, "commands.model.embedding.current_none"),
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    const availableModels =
      (await llmModelRepo.loadAvailableEmbeddingModels(selectedProvider, false, {
        kind: "server",
        ownerId: tomoriState.server_id,
      })) ?? [];
    if (!availableModels.length) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.embedding.no_models_title",
        descriptionKey: "commands.model.embedding.no_models_description",
        descriptionVars: {
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modelSelectOptions: SelectOption[] = [];
    for (const model of availableModels) {
      if (model.embedding_model_id === null || model.embedding_model_id === undefined) {
        continue;
      }
      modelSelectOptions.push({
        label: safeSelectOptionText(model.codename),
        value: safeSelectOptionText(model.embedding_model_id.toString()),
        description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
      });
    }

    if (modelSelectOptions.length === 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.embedding.no_models_title",
        descriptionKey: "commands.model.embedding.no_models_description",
        descriptionVars: {
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modalResult = await promptWithRawModal(
      responseInteraction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.model.embedding.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.embedding.select_label",
            descriptionKey: "commands.model.embedding.select_description",
            placeholder: "commands.model.embedding.select_placeholder",
            required: true,
            options: modelSelectOptions,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Embedding model selection modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    if (!modalResult.interaction || !modalResult.values) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    modalSubmitInteraction = modalResult.interaction;
    const selectedModelIdStr = modalResult.values[MODEL_SELECT_ID];
    if (!selectedModelIdStr) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.embedding.invalid_model_title",
        descriptionKey: "commands.model.embedding.invalid_model_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    const selectedModelId = Number.parseInt(selectedModelIdStr, 10);
    selectedModel = availableModels.find((model) => model.embedding_model_id === selectedModelId) ?? null;

    if (!selectedModel?.embedding_model_id) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "CommandExecutionError",
        metadata: {
          command: "config model embedding",
          guildId: interaction.guild?.id ?? interaction.user.id,
          requestedModelId: selectedModelIdStr,
        },
      };
      await log.error(
        "Selected embedding model ID not found in available models from DB",
        new Error("Invalid model selection despite modal choices"),
        context,
      );

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.embedding.invalid_model_title",
        descriptionKey: "commands.model.embedding.invalid_model_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (selectedModel.embedding_model_id === tomoriState.config.embedding_model_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.embedding.already_selected_title",
        descriptionKey: "commands.model.embedding.already_selected_description",
        descriptionVars: {
          model_name: selectedModel.codename,
        },
        color: ColorCode.WARN,
      });
      return;
    }

    const currentEmbeddingModel = tomoriState.config.embedding_model_id
      ? await llmModelRepo.loadEmbeddingModelById(tomoriState.config.embedding_model_id)
      : null;
    const shouldReembed =
      currentEmbeddingModel?.model_family && currentEmbeddingModel.model_family !== selectedModel.model_family;

    const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
      embedding_model_id: selectedModel.embedding_model_id,
    });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config model embedding",
          guildId: interaction.guild?.id ?? interaction.user.id,
          selectedModelCodename: selectedModel.codename,
          targetEmbeddingModelId: selectedModel.embedding_model_id,
        },
      };
      await log.error("Failed to update embedding model config", new Error("Database update failed"), context);

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    if (shouldReembed && isRagAvailable()) {
      const docCount = await serverMemoryRepository.countDocuments(tomoriState.server_id);
      if (docCount > 0) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.model.embedding.reembed_started_title",
          descriptionKey: "commands.model.embedding.reembed_started_description",
          color: ColorCode.INFO,
        });

        const creds = await resolveCapabilityCredentials(tomoriState.server_id, "embedding");
        const limits = getMemoryLimits();
        await ragRepository.reembedServerDocuments({
          serverId: tomoriState.server_id,
          embeddingModel: selectedModel,
          apiKey: creds.apiKey,
          chunkSize: limits.documentChunkSize,
          chunkOverlap: limits.documentChunkOverlap,
        });
      }
    }

    const previousModel = currentEmbeddingModel?.codename
      ? currentEmbeddingModel.codename
      : localizer(locale, "commands.model.embedding.current_none");

    const successOptions = {
      titleKey: "commands.model.embedding.success_title",
      descriptionKey: "commands.model.embedding.success_description",
      descriptionVars: {
        model_name: selectedModel.codename,
        previous_model: previousModel,
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
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config model embedding",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
        targetEmbeddingModelIdAttempted: selectedModel?.embedding_model_id,
      },
    };
    await log.error(
      `Error executing /config model embedding for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    const replyTarget = modalSubmitInteraction ?? responseInteraction;
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
