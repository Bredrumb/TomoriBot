import type { ChatInputCommandInteraction, ButtonInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import { loadAvailableModelsForProvider, loadLlmById, loadNaiPresetsForModel } from "@/utils/db/repositories";
import { setChannelLlmOverride, setPersonaLlmOverride, applyNaiPreset } from "@/utils/db/repositories";
import { getCachedTomoriState, getCachedAllPersonas, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  safeSelectOptionText,
} from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { type UserRow, type ErrorContext, tomoriConfigSchema, type LlmRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { isCustomProvider } from "@/utils/discord/customProviderModal";
import { resolveLogitBiasEntriesForLlm } from "@/utils/provider/logitBiasResolver";
import { promptForSavedProvider, replaceProviderPickerWithInfo } from "@/commands/model/providerPicker";
import { replyLegacyOpenRouterOtherModelMoved } from "@/utils/discord/openrouterModelMigrationNotice";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";

const MODAL_CUSTOM_ID = "config_model_text_modal";
const MODEL_SELECT_ID = "model_select";

function toPostgresTextArrayLiteral(values: readonly string[] | null | undefined): string {
  return `{${(values ?? []).map((value) => `"${value.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

/**
 * Returns a localized description with capability flags prepended (e.g. "(FREE+TOOLS+IMG) Description").
 */
function getLocalizedDescription(model: LlmRow, locale: string): string {
  if (model.is_scoped_registration) {
    return localizer(locale, "general.scoped_openrouter_model_description");
  }

  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.llm_description;
  const baseDescription = description || model.llm_description || `${model.llm_provider} model`;

  if (model.llm_codename === "other-model") {
    return baseDescription;
  }

  const flags: string[] = [];
  if (model.is_free) flags.push("FREE");
  if (model.has_tools) flags.push("TOOLS");
  if (model.sees_images) flags.push("IMG");
  if (model.sees_videos) flags.push("VID");
  if (model.supports_structoutput) flags.push("STRUCT");

  const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
  return `${flagPrefix}${baseDescription}`;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("text")
    .setDescription(localizer("en-US", "commands.model.text.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.model.text.scope_description"))
        .setRequired(false)
        .addChoices(
          { name: localizer("en-US", "commands.model.text.scope_global"), value: "global" },
          { name: localizer("en-US", "commands.model.text.scope_channel"), value: "channel" },
          { name: localizer("en-US", "commands.model.text.scope_persona"), value: "persona" },
        ),
    );

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

  const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "text");
  const scope = interaction.options.getString("scope") ?? "global";

  let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;
  let selectedModel: LlmRow | null = null;
  let providerSelection: Awaited<ReturnType<typeof promptForSavedProvider>> = null;

  try {
    // 1. Channel scope: provider picker → model picker → channel override
    if (scope === "channel") {
      providerSelection = await promptForSavedProvider(interaction, locale, savedProviders);
      if (!providerSelection) return;

      const selectedProvider = providerSelection.provider;
      const responseInteraction = providerSelection.interaction;

      const availableModels = await loadAvailableModelsForProvider(selectedProvider, false, {
        kind: "server",
        ownerId: tomoriState.server_id,
      });
      if (!availableModels?.length) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.model.text.no_models_title",
          descriptionKey: "commands.model.text.no_models_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const modelOptions: SelectOption[] = availableModels.map((m) => ({
        label: safeSelectOptionText(m.llm_codename),
        value: safeSelectOptionText(m.llm_codename),
        description: safeSelectOptionText(getLocalizedDescription(m, userData.language_pref)),
      }));

      const channelModalResult = await promptWithPaginatedModal(responseInteraction, locale, {
        modalCustomId: "config_model_text_channel_modal",
        modalTitleKey: "commands.model.text.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.text.select_label",
            descriptionKey: "commands.model.text.select_description",
            placeholder: "commands.model.text.select_placeholder",
            required: true,
            options: modelOptions,
          },
        ],
      });

      if (channelModalResult.outcome !== "submit") return;
      // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees values
      modalSubmitInteraction = channelModalResult.interaction!;
      // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees values
      const selectedCodename = channelModalResult.values![MODEL_SELECT_ID];
      const selectedChannelModel = availableModels.find((m) => m.llm_codename === selectedCodename) ?? null;

      if (!selectedChannelModel?.llm_id) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.model.text.invalid_model_title",
          descriptionKey: "commands.model.text.invalid_model_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      if (selectedChannelModel.llm_codename === "other-model") {
        await replyLegacyOpenRouterOtherModelMoved(modalSubmitInteraction, locale, "server");
        return;
      }

      const channelWriteOk = await setChannelLlmOverride(
        tomoriState.server_id,
        interaction.channelId,
        selectedChannelModel.llm_id,
        { serverDiscId: serverId },
      );
      if (!channelWriteOk) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.text.success_title",
        descriptionKey: "commands.model.text.scope_set_channel_success",
        descriptionVars: {
          channel: interaction.channel?.toString() ?? interaction.channelId,
          model: selectedChannelModel.llm_codename,
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    // 2. Persona scope: persona picker → provider picker → model picker → persona override
    if (scope === "persona") {
      const allPersonas = await getCachedAllPersonas(serverId);
      if (!allPersonas.length) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.tomori_not_setup_title",
          descriptionKey: "general.errors.tomori_not_setup_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const avatarSessionCache: AvatarSessionCache = new Map();
      while (true) {
        const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
          personas: allPersonas,
          avatarSessionCache,
          color: ColorCode.INFO,
          preserveSelectedInteraction: true,
          onSelect: async () => {},
        });

        if (!personaSelection.success) {
          if (personaSelection.reason === "cancelled" || personaSelection.reason === "fatal") return;
          continue;
        }
        if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) return;

        const personaButtonInteraction: ButtonInteraction = personaSelection.interaction;
        const selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
        if (!selectedPersona?.tomori_id) {
          await replyInfoEmbed(personaButtonInteraction, locale, {
            titleKey: "general.errors.invalid_option_title",
            descriptionKey: "general.errors.invalid_option_description",
            color: ColorCode.ERROR,
          });
          return;
        }

        providerSelection = await promptForSavedProvider(personaButtonInteraction, locale, savedProviders);
        if (!providerSelection) return;

        const selectedProvider = providerSelection.provider;
        const providerInteraction = providerSelection.interaction;

        const personaAvailableModels = await loadAvailableModelsForProvider(selectedProvider, false, {
          kind: "server",
          ownerId: tomoriState.server_id,
        });
        if (!personaAvailableModels?.length) {
          await replyInfoEmbed(providerInteraction, locale, {
            titleKey: "commands.model.text.no_models_title",
            descriptionKey: "commands.model.text.no_models_description",
            color: ColorCode.ERROR,
          });
          return;
        }

        const personaModelOptions: SelectOption[] = personaAvailableModels.map((m) => ({
          label: safeSelectOptionText(m.llm_codename),
          value: safeSelectOptionText(m.llm_codename),
          description: safeSelectOptionText(getLocalizedDescription(m, userData.language_pref)),
        }));

        const personaModalResult = await promptWithPaginatedModal(providerInteraction, locale, {
          modalCustomId: "config_model_text_persona_modal",
          modalTitleKey: "commands.model.text.modal_title",
          components: [
            {
              customId: MODEL_SELECT_ID,
              labelKey: "commands.model.text.select_label",
              descriptionKey: "commands.model.text.select_description",
              placeholder: "commands.model.text.select_placeholder",
              required: true,
              options: personaModelOptions,
            },
          ],
        });

        if (personaModalResult.outcome !== "submit") {
          await replyComponentsV2Status(
            interaction,
            locale,
            "general.pagination.select_persona_title",
            "general.pagination.reloading_persona_picker",
            ColorCode.INFO,
          );
          continue;
        }

        // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees values
        const personaModalInteraction = personaModalResult.interaction!;
        const selectedPersonaCodename = personaModalResult.values?.[MODEL_SELECT_ID];
        const selectedPersonaModel =
          personaAvailableModels.find((m) => m.llm_codename === selectedPersonaCodename) ?? null;

        if (!selectedPersonaModel?.llm_id) {
          await replyInfoEmbed(personaModalInteraction, locale, {
            titleKey: "commands.model.text.invalid_model_title",
            descriptionKey: "commands.model.text.invalid_model_description",
            color: ColorCode.ERROR,
          });
          return;
        }

        if (selectedPersonaModel.llm_codename === "other-model") {
          await replyLegacyOpenRouterOtherModelMoved(personaModalInteraction, locale, "server");
          return;
        }

        const personaWriteOk = await setPersonaLlmOverride(selectedPersona.tomori_id, selectedPersonaModel.llm_id, {
          serverDiscId: serverId,
        });
        if (!personaWriteOk) {
          await replyInfoEmbed(personaModalInteraction, locale, {
            titleKey: "general.errors.update_failed_title",
            descriptionKey: "general.errors.update_failed_description",
            color: ColorCode.ERROR,
          });
          return;
        }

        await acknowledgeModalSubmitForRefresh(personaModalInteraction);
        await replyComponentsV2Status(
          interaction,
          locale,
          "commands.model.text.success_title",
          "commands.model.text.scope_set_persona_success",
          ColorCode.SUCCESS,
          {
            persona: selectedPersona.tomori_nickname,
            model: selectedPersonaModel.llm_codename,
          },
          "general.pagination.reloading_persona_picker",
        );
      }
    }

    // 3. Global scope: provider picker → (custom capabilities || model picker) → Phase A mirror write
    providerSelection = await promptForSavedProvider(interaction, locale, savedProviders);
    if (!providerSelection) return;

    const selectedProvider = providerSelection.provider;
    const responseInteraction = providerSelection.interaction;
    const selectedSavedConfig = savedProviders.find((p) => p.provider.toLowerCase() === selectedProvider) ?? null;

    // 3a. Custom provider: activate the already-registered labeled endpoint directly
    if (isCustomProvider(selectedProvider)) {
      const customModel = selectedSavedConfig?.llm_id ? await loadLlmById(selectedSavedConfig.llm_id) : null;
      if (!selectedSavedConfig || !customModel?.llm_id) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.model.text.no_models_title",
          descriptionKey: "commands.model.text.no_models_description",
          color: ColorCode.ERROR,
        });
        return;
      }
      const resolvedLogitBiases = resolveLogitBiasEntriesForLlm(
        selectedSavedConfig.llm_logit_biases ?? tomoriState.config.llm_logit_biases ?? [],
        customModel,
      );
      const resolvedLogitBiasesJson = JSON.stringify(resolvedLogitBiases.entries);
      const disabledParamsLiteral = toPostgresTextArrayLiteral(selectedSavedConfig.llm_disabled_params);
      const clearFallbacks = tomoriState.llm?.llm_provider?.toLowerCase() !== selectedProvider;
      const fallbackLlmIdsJson = clearFallbacks ? "[]" : JSON.stringify(selectedSavedConfig.fallback_llm_ids ?? []);

      const [updatedRow] = await sql`
        UPDATE tomori_configs
        SET llm_id = ${customModel.llm_id},
            api_key = ${selectedSavedConfig.api_key},
            key_version = ${selectedSavedConfig.key_version ?? 1},
            thinking_level = ${selectedSavedConfig.thinking_level ?? "auto"},
            fallback_llm_ids = ${fallbackLlmIdsJson}::jsonb,
            llm_temperature = ${selectedSavedConfig.llm_temperature ?? tomoriState.config.llm_temperature ?? 1.0},
            llm_top_p = ${selectedSavedConfig.llm_top_p ?? tomoriState.config.llm_top_p ?? 0.95},
            llm_top_k = ${selectedSavedConfig.llm_top_k ?? tomoriState.config.llm_top_k ?? 0},
            llm_frequency_penalty = ${selectedSavedConfig.llm_frequency_penalty ?? tomoriState.config.llm_frequency_penalty ?? 0.0},
            llm_presence_penalty = ${selectedSavedConfig.llm_presence_penalty ?? tomoriState.config.llm_presence_penalty ?? 0.0},
            llm_min_p = ${selectedSavedConfig.llm_min_p ?? tomoriState.config.llm_min_p ?? 0.05},
            llm_disabled_params = ${disabledParamsLiteral}::text[],
            llm_logit_biases = ${resolvedLogitBiasesJson}::jsonb,
            custom_model_name = ${selectedSavedConfig.custom_model_name ?? customModel.llm_description ?? customModel.llm_codename},
            custom_endpoint_url = ${selectedSavedConfig.custom_endpoint_url ?? null},
            custom_num_ctx = ${selectedSavedConfig.custom_num_ctx ?? null}
        WHERE server_id = ${tomoriState.server_id}
        RETURNING *
      `;

      const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);
      if (!validatedConfig.success || !updatedRow) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateTomoriStateCache(serverId);
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.text.success_title",
        descriptionKey: "commands.model.text.success_description",
        descriptionVars: {
          model_name: selectedSavedConfig.custom_model_name ?? customModel.llm_description ?? customModel.llm_codename,
          previous_model: tomoriState.llm?.llm_codename ?? localizer(locale, "general.unknown"),
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    // 3b. Regular provider: model picker
    const availableModels = await loadAvailableModelsForProvider(selectedProvider, false, {
      kind: "server",
      ownerId: tomoriState.server_id,
    });
    if (!availableModels?.length) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.text.no_models_title",
        descriptionKey: "commands.model.text.no_models_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modelSelectOptions: SelectOption[] = availableModels.map((model) => ({
      label: safeSelectOptionText(model.llm_codename),
      value: safeSelectOptionText(model.llm_codename),
      description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
    }));

    const modalResult = await promptWithPaginatedModal(responseInteraction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.model.text.modal_title",
      components: [
        {
          customId: MODEL_SELECT_ID,
          labelKey: "commands.model.text.select_label",
          descriptionKey: "commands.model.text.select_description",
          placeholder: "commands.model.text.select_placeholder",
          required: true,
          options: modelSelectOptions,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`Model selection modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees values
    modalSubmitInteraction = modalResult.interaction!;
    // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees values
    const selectedModelCodename = modalResult.values![MODEL_SELECT_ID];
    selectedModel = availableModels.find((model) => model.llm_codename === selectedModelCodename) ?? null;

    if (!selectedModel?.llm_id) {
      const context: ErrorContext = {
        tomoriId: tomoriState.tomori_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "CommandExecutionError",
        metadata: {
          command: "config model text",
          guildId: interaction.guild?.id ?? interaction.user.id,
          requestedModel: selectedModelCodename,
          availableModels: availableModels.map((m) => m.llm_codename),
        },
      };
      await log.error(
        "Selected model codename not found in available LLMs from DB",
        new Error("Invalid model selection despite modal choices"),
        context,
      );
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.text.invalid_model_title",
        descriptionKey: "commands.model.text.invalid_model_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (selectedModel.llm_codename === "other-model") {
      await replyLegacyOpenRouterOtherModelMoved(modalSubmitInteraction, locale, "server");
      return;
    }

    if (selectedModel.llm_id === tomoriState.config.llm_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.model.text.already_selected_title",
        descriptionKey: "commands.model.text.already_selected_description",
        descriptionVars: { model_name: selectedModel.llm_codename },
        color: ColorCode.WARN,
      });
      return;
    }

    // Phase A mirror write: copy credentials and samplers from saved_provider_configs into tomori_configs
    // so the existing runtime (which reads tomori_configs) continues to work without modification.
    const resolvedLogitBiases = resolveLogitBiasEntriesForLlm(
      selectedSavedConfig?.llm_logit_biases ?? tomoriState.config.llm_logit_biases ?? [],
      selectedModel,
    );
    const resolvedLogitBiasesJson = JSON.stringify(resolvedLogitBiases.entries);
    const clearFallbacks = tomoriState.llm?.llm_provider?.toLowerCase() !== selectedProvider;
    const fallbackLlmIdsJson = clearFallbacks ? "[]" : JSON.stringify(selectedSavedConfig?.fallback_llm_ids ?? []);
    const disabledParamsLiteral = toPostgresTextArrayLiteral(selectedSavedConfig?.llm_disabled_params);

    const [updatedRow] = await sql`
      UPDATE tomori_configs
      SET llm_id = ${selectedModel.llm_id},
          api_key = ${selectedSavedConfig?.api_key ?? null},
          key_version = ${selectedSavedConfig?.key_version ?? 1},
          thinking_level = ${selectedSavedConfig?.thinking_level ?? "auto"},
          fallback_llm_ids = ${fallbackLlmIdsJson}::jsonb,
          llm_temperature = ${selectedSavedConfig?.llm_temperature ?? tomoriState.config.llm_temperature ?? 1.0},
          llm_top_p = ${selectedSavedConfig?.llm_top_p ?? tomoriState.config.llm_top_p ?? 0.95},
          llm_top_k = ${selectedSavedConfig?.llm_top_k ?? tomoriState.config.llm_top_k ?? 0},
          llm_frequency_penalty = ${selectedSavedConfig?.llm_frequency_penalty ?? tomoriState.config.llm_frequency_penalty ?? 0.0},
          llm_presence_penalty = ${selectedSavedConfig?.llm_presence_penalty ?? tomoriState.config.llm_presence_penalty ?? 0.0},
          llm_min_p = ${selectedSavedConfig?.llm_min_p ?? tomoriState.config.llm_min_p ?? 0.05},
          llm_disabled_params = ${disabledParamsLiteral}::text[],
          llm_logit_biases = ${resolvedLogitBiasesJson}::jsonb,
          custom_model_name = NULL,
          custom_endpoint_url = NULL,
          custom_num_ctx = NULL
      WHERE server_id = ${tomoriState.server_id}
      RETURNING *
    `;

    const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);
    if (!validatedConfig.success || !updatedRow) {
      const context: ErrorContext = {
        tomoriId: tomoriState.tomori_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config model text",
          guildId: interaction.guild?.id ?? interaction.user.id,
          selectedModelCodename,
          targetLlmId: selectedModel.llm_id,
          validationErrors: validatedConfig.success ? null : validatedConfig.error.flatten(),
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

    invalidateTomoriStateCache(serverId);

    // Auto-apply default NAI sampling preset when switching to Kayra or Erato
    const naiDefaultPresets: Record<string, { name: string; target: "kayra" | "erato" }> = {
      "kayra-v1": { name: "Carefree-Kayra", target: "kayra" },
      "llama-3-erato-v1": { name: "Erato-Shosetsu", target: "erato" },
    };
    const defaultPresetEntry = naiDefaultPresets[selectedModel.llm_codename];
    if (defaultPresetEntry) {
      const naiPresets = await loadNaiPresetsForModel(defaultPresetEntry.target);
      const defaultPreset = naiPresets.find((p) => p.preset_name === defaultPresetEntry.name);
      if (defaultPreset) {
        await applyNaiPreset(tomoriState.server_id, defaultPreset, selectedModel.llm_codename);
      } else {
        log.warn(
          `Default NAI preset "${defaultPresetEntry.name}" not found in DB. Was seed.sql run? Skipping auto-apply.`,
        );
      }
    }

    const previousModel = tomoriState.llm;
    const successOptions = {
      titleKey: "commands.model.text.success_title",
      descriptionKey: "commands.model.text.success_description",
      descriptionVars: {
        model_name: selectedModel.llm_codename,
        previous_model: previousModel?.llm_codename ?? localizer(locale, "general.unknown"),
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
      tomoriId: tomoriState.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config model text",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
        targetLlmIdAttempted: selectedModel?.llm_id,
      },
    };
    await log.error(`Error executing /config model text for user ${userData.user_disc_id}`, error as Error, context);

    const replyTarget = modalSubmitInteraction ?? interaction;
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
