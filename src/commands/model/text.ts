import type {
  ActionRowData,
  ButtonComponentData,
  ChatInputCommandInteraction,
  Client,
  ComponentInContainerData,
  ContainerComponentData,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { ButtonStyle, ComponentType, escapeMarkdown, MessageFlags } from "discord.js";
import { configRepository, llmModelRepo, llmOverrideRepo } from "@/utils/db/repositories";

import { getCachedTomoriState, getCachedAllPersonas, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowComponentsV2Payload,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
import type { UserRow, ErrorContext, LlmRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { isCustomProvider } from "@/utils/discord/customProviderModal";
import { resolveLogitBiasEntriesForLlm } from "@/utils/provider/logitBiasResolver";
import { promptForSavedProvider, replaceProviderPickerWithInfo } from "@/utils/discord/providerPicker";
import { replyLegacyOpenRouterOtherModelMoved } from "@/utils/discord/openrouterModelMigrationNotice";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { promptCustomModelSelection } from "@/utils/provider/customModelPicker";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { commandRegistry } from "@/utils/discord/commandRegistry";

const MODAL_CUSTOM_ID = "config_model_text_modal";
const MODEL_SELECT_ID = "model_select";

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
  if (model.is_free && !isCustomProvider(model.llm_provider)) flags.push("FREE");
  if (model.has_tools) flags.push("TOOLS");
  if (model.sees_images) flags.push("IMG");
  if (model.sees_videos) flags.push("VID");
  if (model.supports_structoutput) flags.push("STRUCT");

  const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
  return `${flagPrefix}${baseDescription}`;
}

function buildPersonaModelLoadingNotice(locale: string): PersonaWorkflowComponentsV2Payload {
  return buildPersonaWorkflowNotice({
    locale,
    titleKey: "general.persona_workflow.loading_title",
    descriptionKey: "general.persona_workflow.loading_description",
    color: ColorCode.INFO,
  });
}

function buildPersonaModelModalReady(locale: string, customId: string): PersonaWorkflowComponentsV2Payload {
  const container: ContainerComponentData<ComponentInContainerData> = {
    type: ComponentType.Container,
    accentColor: Number.parseInt(ColorCode.INFO.replace("#", ""), 16),
    components: [
      {
        type: ComponentType.TextDisplay,
        content: `### ${localizer(locale, "general.persona_workflow.modal_ready_title")}`,
      },
      {
        type: ComponentType.TextDisplay,
        content: localizer(locale, "general.persona_workflow.modal_ready_description"),
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            customId,
            label: localizer(locale, "general.persona_workflow.open_modal_button"),
            style: ButtonStyle.Primary,
          },
        ],
      } satisfies ActionRowData<ButtonComponentData>,
    ],
  };
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildPersonaProviderPicker(
  locale: string,
  customIdPrefix: string,
  providers: readonly string[],
  currentModel: string,
  currentProvider: string,
): PersonaWorkflowComponentsV2Payload {
  const components: ComponentInContainerData[] = [
    {
      type: ComponentType.TextDisplay,
      content: `### ${localizer(locale, "commands.model.providerPicker.title")}`,
    },
    {
      type: ComponentType.TextDisplay,
      content: localizer(locale, "commands.model.providerPicker.description"),
    },
    // The current selection is metadata, not body copy, so it gets its own TextDisplay
    // rendered as muted subtext — matching the footer convention in buildNoticeContainer.
    // It must NOT be appended to the description with "\n\n": a Container already puts a
    // gap between TextDisplay components, so the explicit blank line stacked on top of
    // that gap and produced the oversized break above the provider buttons.
    {
      type: ComponentType.TextDisplay,
      content: `-# ${localizer(locale, "commands.model.providerPicker.current_selection", {
        model: escapeMarkdown(currentModel),
        provider: escapeMarkdown(currentProvider),
      })}`,
    },
  ];

  const buttons = providers.map(
    (provider, index): ButtonComponentData => ({
      type: ComponentType.Button,
      customId: `${customIdPrefix}_${index}`,
      label: getProviderDisplayName(provider),
      style: ButtonStyle.Secondary,
    }),
  );
  const buttonRows: ButtonComponentData[][] = [];
  for (let offset = 0; offset < buttons.length; offset += 4) {
    buttonRows.push(buttons.slice(offset, offset + 4));
  }

  const cancelButton: ButtonComponentData = {
    type: ComponentType.Button,
    customId: `${customIdPrefix}_cancel`,
    label: localizer(locale, "general.pagination.cancel"),
    style: ButtonStyle.Danger,
  };
  const lastRow = buttonRows.at(-1);
  if (lastRow && lastRow.length < 5) {
    lastRow.push(cancelButton);
  } else {
    buttonRows.push([cancelButton]);
  }
  for (const row of buttonRows) {
    components.push({
      type: ComponentType.ActionRow,
      components: row,
    } satisfies ActionRowData<ButtonComponentData>);
  }

  const container: ContainerComponentData<ComponentInContainerData> = {
    type: ComponentType.Container,
    accentColor: Number.parseInt(ColorCode.INFO.replace("#", ""), 16),
    components,
  };
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildOpenRouterMovedNotice(locale: string): PersonaWorkflowComponentsV2Payload {
  return buildPersonaWorkflowNotice({
    locale,
    titleKey: "general.openrouter_model_moved_title",
    descriptionKey: "general.openrouter_model_moved_description",
    descriptionVars: {
      add_command: commandRegistry.getCommandMention("openrouter", "model", "add"),
      remove_command: commandRegistry.getCommandMention("openrouter", "model", "remove"),
    },
    color: ColorCode.ERROR,
  });
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

  const scope = interaction.options.getString("scope") ?? "global";
  if (scope === "persona") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

  let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;
  let selectedModel: LlmRow | null = null;
  let providerSelection: Awaited<ReturnType<typeof promptForSavedProvider>> = null;
  const personaWorkflowState: { message: PersonaWorkflowMessageController | null } = { message: null };

  try {
    // 1. Channel scope: provider picker → model picker → channel override
    if (scope === "channel") {
      const currentChannelModel =
        (await llmOverrideRepo.getChannelLlmOverride(tomoriState.server_id, interaction.channelId)) ?? tomoriState.llm;
      providerSelection = await promptForSavedProvider(interaction, locale, savedProviders, {
        currentSelections: [
          {
            model: currentChannelModel.llm_codename,
            provider: currentChannelModel.llm_provider,
          },
        ],
      });
      if (!providerSelection) return;

      const selectedProvider = providerSelection.provider;
      const responseInteraction = providerSelection.interaction;

      const availableModels = await llmModelRepo.loadAvailableModelsForProvider(selectedProvider, false, {
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
        // Opt into the shared Components V2 range selector for the >25-model list.
        // Safe: responseInteraction is unacknowledged here, so the selector takes the
        // fresh-reply path (no legacy→V2 editReply), and Phase 1's guard covers the
        // error-path fallback to the original interaction.
        selectorStyle: "componentsV2",
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

      const channelWriteOk = await llmOverrideRepo.setChannelLlmOverride(
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

      await runPersonaPickerWorkflow(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
        async onSelected(selection) {
          personaWorkflowState.message = selection.message;
          const selectedPersona = selection.persona;
          const personaId = selectedPersona.persona_id;
          if (personaId == null) {
            const work = await selection.beginInPlaceWork();
            await work.message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.invalid_option_title",
                descriptionKey: "general.errors.invalid_option_description",
                color: ColorCode.ERROR,
              }),
            );
            return completePersonaWorkflow();
          }

          try {
            const currentPersonaModel = selectedPersona.persona_llm ?? tomoriState.llm;
            let selectedProvider: string;

            if (savedProviders.length === 0) {
              const work = await selection.beginInPlaceWork();
              await work.message.replace(
                buildPersonaWorkflowNotice({
                  locale,
                  titleKey: "commands.model.providerPicker.no_providers_title",
                  descriptionKey: "commands.model.providerPicker.no_providers_description",
                  color: ColorCode.ERROR,
                }),
              );
              return completePersonaWorkflow();
            }

            if (savedProviders.length === 1) {
              selectedProvider = savedProviders[0].provider.toLowerCase();
              const work = await selection.beginInPlaceWork();
              await work.message.replace(buildPersonaModelLoadingNotice(locale));
            } else {
              const work = await selection.beginInPlaceWork();
              const providerPrefix = `persona_model_${selection.phaseId}_provider`;
              await work.message.replace(
                buildPersonaProviderPicker(
                  locale,
                  providerPrefix,
                  savedProviders.map((provider) => provider.provider),
                  currentPersonaModel.llm_codename,
                  currentPersonaModel.llm_provider,
                ),
              );

              let providerButton: import("discord.js").ButtonInteraction;
              try {
                const providerMessage = await work.message.fetchMessage();
                providerButton = await providerMessage.awaitMessageComponent({
                  componentType: ComponentType.Button,
                  filter: (candidate) =>
                    candidate.user.id === interaction.user.id && candidate.customId.startsWith(providerPrefix),
                  time: PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS,
                });
              } catch {
                await work.message.replace(
                  buildPersonaWorkflowNotice({
                    locale,
                    titleKey: "general.interaction.timeout_title",
                    descriptionKey: "general.pagination.timeout",
                    color: ColorCode.WARN,
                  }),
                );
                return completePersonaWorkflow();
              }

              const providerAction = selection.useButton(providerButton);
              if (providerButton.customId === `${providerPrefix}_cancel`) {
                await providerAction.replace(
                  buildPersonaWorkflowNotice({
                    locale,
                    titleKey: "general.interaction.cancel_title",
                    descriptionKey: "general.pagination.cancelled",
                    color: ColorCode.WARN,
                  }),
                );
                return retryPersonaWorkflow();
              }

              const providerIndex = Number.parseInt(providerButton.customId.replace(`${providerPrefix}_`, ""), 10);
              const provider = savedProviders[providerIndex];
              if (!provider) {
                await providerAction.replace(
                  buildPersonaWorkflowNotice({
                    locale,
                    titleKey: "general.errors.invalid_option_title",
                    descriptionKey: "general.errors.invalid_option_description",
                    color: ColorCode.ERROR,
                  }),
                );
                return completePersonaWorkflow();
              }
              selectedProvider = provider.provider.toLowerCase();
              const providerWork = await providerAction.beginInPlaceWork();
              await providerWork.message.replace(buildPersonaModelLoadingNotice(locale));
            }

            const personaAvailableModels = await llmModelRepo.loadAvailableModelsForProvider(selectedProvider, false, {
              kind: "server",
              ownerId: tomoriState.server_id,
            });
            if (!personaAvailableModels?.length) {
              await selection.message.replace(
                buildPersonaWorkflowNotice({
                  locale,
                  titleKey: "commands.model.text.no_models_title",
                  descriptionKey: "commands.model.text.no_models_description",
                  color: ColorCode.ERROR,
                }),
              );
              return completePersonaWorkflow();
            }

            const personaModelOptions: SelectOption[] = personaAvailableModels.map((model) => ({
              label: safeSelectOptionText(model.llm_codename),
              value: safeSelectOptionText(model.llm_codename),
              description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
            }));
            const modalButtonId = `persona_model_${selection.phaseId}_open`;
            await selection.message.replace(buildPersonaModelModalReady(locale, modalButtonId));

            let modalButton: import("discord.js").ButtonInteraction;
            try {
              const modalMessage = await selection.message.fetchMessage();
              modalButton = await modalMessage.awaitMessageComponent({
                componentType: ComponentType.Button,
                filter: (candidate) =>
                  candidate.user.id === interaction.user.id && candidate.customId === modalButtonId,
                time: PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS,
              });
            } catch {
              await selection.message.replace(
                buildPersonaWorkflowNotice({
                  locale,
                  titleKey: "general.interaction.timeout_title",
                  descriptionKey: "general.pagination.timeout",
                  color: ColorCode.WARN,
                }),
              );
              return retryPersonaWorkflow();
            }

            const personaModalResult = await selection.useButton(modalButton).openModal({
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
            if (personaModalResult.outcome !== "submitted") {
              return retryPersonaWorkflow();
            }

            const modalWork = await personaModalResult.phase.beginInPlaceWork();
            const selectedPersonaCodename = personaModalResult.phase.values[MODEL_SELECT_ID];
            const selectedPersonaModel =
              personaAvailableModels.find((model) => model.llm_codename === selectedPersonaCodename) ?? null;

            if (!selectedPersonaModel?.llm_id) {
              await modalWork.message.replace(
                buildPersonaWorkflowNotice({
                  locale,
                  titleKey: "commands.model.text.invalid_model_title",
                  descriptionKey: "commands.model.text.invalid_model_description",
                  color: ColorCode.ERROR,
                }),
              );
              return completePersonaWorkflow();
            }

            if (selectedPersonaModel.llm_codename === "other-model") {
              await modalWork.message.replace(buildOpenRouterMovedNotice(locale));
              return completePersonaWorkflow();
            }

            const personaWriteOk = await llmOverrideRepo.setPersonaLlmOverride(personaId, selectedPersonaModel.llm_id, {
              serverDiscId: serverId,
            });
            if (!personaWriteOk) {
              await modalWork.message.replace(
                buildPersonaWorkflowNotice({
                  locale,
                  titleKey: "general.errors.update_failed_title",
                  descriptionKey: "general.errors.update_failed_description",
                  color: ColorCode.ERROR,
                }),
              );
              return completePersonaWorkflow();
            }

            selectedPersona.persona_llm = selectedPersonaModel;
            await modalWork.message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "commands.model.text.success_title",
                descriptionKey: "commands.model.text.scope_set_persona_success",
                descriptionVars: {
                  persona: selectedPersona.persona_nickname,
                  model: selectedPersonaModel.llm_codename,
                },
                footerKey: "general.pagination.reloading_persona_picker",
                color: ColorCode.SUCCESS,
              }),
            );
            return retryPersonaWorkflow();
          } catch (error) {
            await selection.message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.unknown_error_title",
                descriptionKey: "general.errors.unknown_error_description",
                color: ColorCode.ERROR,
              }),
            );
            throw error;
          }
        },
      });
      return;
    }

    // 3. Global scope: provider picker → (custom capabilities || model picker) → Phase A mirror write
    providerSelection = await promptForSavedProvider(interaction, locale, savedProviders, {
      currentSelections: [
        {
          model: tomoriState.llm.llm_codename,
          provider: tomoriState.llm.llm_provider,
        },
      ],
    });
    if (!providerSelection) return;

    const selectedProvider = providerSelection.provider;
    const responseInteraction = providerSelection.interaction;
    const selectedSavedConfig = savedProviders.find((p) => p.provider.toLowerCase() === selectedProvider) ?? null;

    // 3a. Custom provider: pick among the label's registered text models, then activate the choice.
    if (isCustomProvider(selectedProvider)) {
      const customAvailableModels = selectedSavedConfig
        ? await llmModelRepo.loadAvailableModelsForProvider(selectedProvider, false, {
            kind: "server",
            ownerId: tomoriState.server_id,
          })
        : null;
      if (!selectedSavedConfig || !customAvailableModels?.length) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.model.text.no_models_title",
          descriptionKey: "commands.model.text.no_models_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      // Single registered model activates directly; multiple show a string-select picker.
      const selection = await promptCustomModelSelection<LlmRow>({
        interaction: responseInteraction,
        locale,
        choices: customAvailableModels.map((m) => ({
          model: m,
          value: m.llm_codename,
          label: m.llm_description?.trim() || m.llm_codename,
          description: getLocalizedDescription(m, userData.language_pref),
        })),
        modalCustomId: "config_model_text_custom_modal",
        modalTitleKey: "commands.model.text.modal_title",
        selectLabelKey: "commands.model.text.select_label",
        selectDescriptionKey: "commands.model.text.select_description",
        selectPlaceholderKey: "commands.model.text.select_placeholder",
      });
      if (!selection) return;

      const customModel = selection.model;
      if (selection.submitInteraction) {
        modalSubmitInteraction = selection.submitInteraction;
      }
      const customReplyTarget = selection.submitInteraction ?? responseInteraction;

      if (!customModel.llm_id) {
        await replyInfoEmbed(customReplyTarget, locale, {
          titleKey: "commands.model.text.invalid_model_title",
          descriptionKey: "commands.model.text.invalid_model_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      if (customModel.llm_id === tomoriState.config.llm_id) {
        await replyInfoEmbed(customReplyTarget, locale, {
          titleKey: "commands.model.text.already_selected_title",
          descriptionKey: "commands.model.text.already_selected_description",
          descriptionVars: { model_name: customModel.llm_description ?? customModel.llm_codename },
          color: ColorCode.WARN,
        });
        return;
      }

      const resolvedLogitBiases = resolveLogitBiasEntriesForLlm(
        selectedSavedConfig.llm_logit_biases ?? tomoriState.config.llm_logit_biases ?? [],
        customModel,
      );
      const clearFallbacks = tomoriState.llm?.llm_provider?.toLowerCase() !== selectedProvider;
      const fallbackLlmIds = clearFallbacks
        ? []
        : (selectedSavedConfig.fallback_model_refs ?? []).filter((r) => r.type === "llm").map((r) => r.id);
      const disabledParams = selectedSavedConfig.llm_disabled_params ?? [];

      const [updatedModel, updatedChat] = await Promise.all([
        configRepository.updateModelConfig(tomoriState.server_id, {
          llm_id: customModel.llm_id,
          api_key: selectedSavedConfig.api_key,
          key_version: selectedSavedConfig.key_version ?? 1,
          thinking_level: selectedSavedConfig.thinking_level ?? "auto",
          fallback_llm_ids: fallbackLlmIds,
          llm_temperature: selectedSavedConfig.llm_temperature ?? tomoriState.config.llm_temperature ?? 1.0,
          llm_disabled_params: disabledParams,
          // custom_* mirrors are resolved at runtime from the custom_endpoints table; null them here
          custom_model_name: null,
          custom_endpoint_url: null,
          custom_num_ctx: null,
        }),
        configRepository.updateChatConfig(tomoriState.server_id, {
          llm_top_p: selectedSavedConfig.llm_top_p ?? tomoriState.config.llm_top_p ?? 0.95,
          llm_top_k: selectedSavedConfig.llm_top_k ?? tomoriState.config.llm_top_k ?? 0,
          llm_frequency_penalty:
            selectedSavedConfig.llm_frequency_penalty ?? tomoriState.config.llm_frequency_penalty ?? 0.0,
          llm_presence_penalty:
            selectedSavedConfig.llm_presence_penalty ?? tomoriState.config.llm_presence_penalty ?? 0.0,
          llm_min_p: selectedSavedConfig.llm_min_p ?? tomoriState.config.llm_min_p ?? 0.05,
          llm_logit_biases: resolvedLogitBiases.entries,
        }),
      ]);
      // The split-table writes are not transactional. Invalidate after either
      // succeeds so a partial write cannot leave a stale assembled state.
      if (updatedModel || updatedChat) {
        invalidateTomoriStateCache(serverId);
      }

      if (!updatedModel || !updatedChat) {
        const context: ErrorContext = {
          personaId: tomoriState.persona_id,
          serverId: tomoriState.server_id,
          userId: userData.user_id,
          errorType: "DatabaseUpdateError",
          metadata: {
            command: "model text",
            guildId: serverId,
            scope: "global",
            selectedProvider,
            selectedModelCodename: customModel.llm_codename,
            targetLlmId: customModel.llm_id,
            modelConfigUpdated: updatedModel,
            chatConfigUpdated: updatedChat,
          },
        };
        await log.error(
          "Failed to update all custom-provider LLM configuration tables",
          new Error("One or more database updates returned false"),
          context,
        );
        await replyInfoEmbed(customReplyTarget, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      await replyInfoEmbed(customReplyTarget, locale, {
        titleKey: "commands.model.text.success_title",
        descriptionKey: "commands.model.text.success_description",
        descriptionVars: {
          model_name: customModel.llm_description ?? customModel.llm_codename,
          previous_model: tomoriState.llm?.llm_codename ?? localizer(locale, "general.unknown"),
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    // 3b. Regular provider: model picker
    const availableModels = await llmModelRepo.loadAvailableModelsForProvider(selectedProvider, false, {
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
      // Opt into the shared Components V2 range selector for the >25-model list.
      // Safe: responseInteraction is unacknowledged here (global scope never defers),
      // so the selector takes the fresh-reply path; Phase 1's guard covers the
      // single-provider error-path fallback to the marked original interaction.
      selectorStyle: "componentsV2",
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
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "CommandExecutionError",
        metadata: {
          command: "model text",
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

    const resolvedLogitBiases = resolveLogitBiasEntriesForLlm(
      selectedSavedConfig?.llm_logit_biases ?? tomoriState.config.llm_logit_biases ?? [],
      selectedModel,
    );
    const clearFallbacks = tomoriState.llm?.llm_provider?.toLowerCase() !== selectedProvider;
    const fallbackLlmIds = clearFallbacks
      ? []
      : (selectedSavedConfig?.fallback_model_refs ?? []).filter((r) => r.type === "llm").map((r) => r.id);
    const disabledParams = selectedSavedConfig?.llm_disabled_params ?? [];

    const [updatedModel, updatedChat] = await Promise.all([
      configRepository.updateModelConfig(tomoriState.server_id, {
        llm_id: selectedModel.llm_id,
        api_key: selectedSavedConfig?.api_key ?? null,
        key_version: selectedSavedConfig?.key_version ?? 1,
        thinking_level: selectedSavedConfig?.thinking_level ?? "auto",
        fallback_llm_ids: fallbackLlmIds,
        llm_temperature: selectedSavedConfig?.llm_temperature ?? tomoriState.config.llm_temperature ?? 1.0,
        llm_disabled_params: disabledParams,
        custom_model_name: null,
        custom_endpoint_url: null,
        custom_num_ctx: null,
      }),
      configRepository.updateChatConfig(tomoriState.server_id, {
        llm_top_p: selectedSavedConfig?.llm_top_p ?? tomoriState.config.llm_top_p ?? 0.95,
        llm_top_k: selectedSavedConfig?.llm_top_k ?? tomoriState.config.llm_top_k ?? 0,
        llm_frequency_penalty:
          selectedSavedConfig?.llm_frequency_penalty ?? tomoriState.config.llm_frequency_penalty ?? 0.0,
        llm_presence_penalty:
          selectedSavedConfig?.llm_presence_penalty ?? tomoriState.config.llm_presence_penalty ?? 0.0,
        llm_min_p: selectedSavedConfig?.llm_min_p ?? tomoriState.config.llm_min_p ?? 0.05,
        llm_logit_biases: resolvedLogitBiases.entries,
      }),
    ]);
    // Keep invalidation immediately after the primary split writes. This also
    // protects readers when only one of the non-transactional writes succeeds.
    if (updatedModel || updatedChat) {
      invalidateTomoriStateCache(serverId);
    }

    if (!updatedModel || !updatedChat) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "model text",
          guildId: interaction.guild?.id ?? interaction.user.id,
          selectedModelCodename,
          targetLlmId: selectedModel.llm_id,
          modelConfigUpdated: updatedModel,
          chatConfigUpdated: updatedChat,
        },
      };
      await log.error(
        "Failed to update all LLM configuration tables",
        new Error("One or more database updates returned false"),
        context,
      );
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Auto-apply default NAI sampling preset when switching to Kayra or Erato
    const naiDefaultPresets: Record<string, { name: string; target: "kayra" | "erato" }> = {
      "kayra-v1": { name: "Carefree-Kayra", target: "kayra" },
      "llama-3-erato-v1": { name: "Erato-Shosetsu", target: "erato" },
    };
    const defaultPresetEntry = naiDefaultPresets[selectedModel.llm_codename];
    if (defaultPresetEntry) {
      const naiPresets = await configRepository.loadNaiPresets(defaultPresetEntry.target);
      const defaultPreset = naiPresets.find((p) => p.preset_name === defaultPresetEntry.name);
      if (defaultPreset) {
        const presetApplied = await configRepository.applyNaiPreset(
          tomoriState.server_id,
          defaultPreset,
          selectedModel.llm_codename,
          serverId,
        );
        if (!presetApplied) {
          // The preset spans three non-transactional writes. Invalidate again
          // after the failed attempt in case any sub-write committed.
          invalidateTomoriStateCache(serverId);

          const context: ErrorContext = {
            personaId: tomoriState.persona_id,
            serverId: tomoriState.server_id,
            userId: userData.user_id,
            errorType: "DatabaseUpdateError",
            metadata: {
              command: "model text",
              guildId: serverId,
              scope: "global",
              selectedModelCodename,
              targetLlmId: selectedModel.llm_id,
              naiPresetName: defaultPreset.preset_name,
            },
          };
          await log.error(
            "Failed to apply the default NovelAI preset after updating the text model",
            new Error("NovelAI preset update returned false"),
            context,
          );

          const failureOptions = {
            titleKey: "general.errors.update_failed_title",
            descriptionKey: "general.errors.update_failed_description",
            color: ColorCode.ERROR,
          } as const;
          const replacedPicker =
            modalSubmitInteraction &&
            (await replaceProviderPickerWithInfo(providerSelection, modalSubmitInteraction, locale, failureOptions));
          if (!replacedPicker) {
            await replyInfoEmbed(modalSubmitInteraction, locale, failureOptions);
          }
          return;
        }
      } else {
        log.warn(
          `Default NAI preset "${defaultPresetEntry.name}" not found in DB. Was the seed catalog loaded? Skipping auto-apply.`,
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
      personaId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "model text",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
        targetLlmIdAttempted: selectedModel?.llm_id,
      },
    };
    await log.error(`Error executing /model text for user ${userData.user_disc_id}`, error as Error, context);

    if (personaWorkflowState.message) {
      await personaWorkflowState.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    const replyTarget = modalSubmitInteraction ?? interaction;
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
