import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { ErrorContext, UserRow, EmbeddingModelRow } from "@/types/db/schema";
import {
  beginAnchorPrivateWorkflow,
  buildPersonaWorkflowNotice,
  type PersonaWorkflowInPlacePhase,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/anchorWorkflow";
import {
  acquireModelModalOpener,
  buildNoProvidersPayload,
  buildOpenSelectorPayload,
  buildProviderPickerPayload,
  openAnchorModal,
} from "@/utils/discord/ui/anchorModelFlow";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { configRepository, llmModelRepo, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
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

  // Anchor one-message controller, tracked so the outer catch can render an
  // unexpected-error terminal on the same ephemeral message.
  let selectedModel: EmbeddingModelRow | null = null;
  let anchorMessage: PersonaWorkflowMessageController | null = null;

  try {
    const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "embedding");
    const idRoot = "model_embedding";

    // 1. Open the anchor message with the right initial control for the provider count.
    const activeEmbeddingModel = tomoriState.config.embedding_model_id
      ? await llmModelRepo.loadEmbeddingModelById(tomoriState.config.embedding_model_id)
      : null;
    const currentModel =
      getEmbeddingModelDisplayName(activeEmbeddingModel) ?? localizer(locale, "commands.model.embedding.current_none");
    const currentProvider = activeEmbeddingModel?.provider ?? localizer(locale, "general.unknown");
    const initialPayload =
      savedProviders.length === 0
        ? buildNoProvidersPayload(locale)
        : savedProviders.length === 1
          ? buildOpenSelectorPayload(locale, `${idRoot}_open`)
          : buildProviderPickerPayload(
              locale,
              idRoot,
              savedProviders.map((p) => p.provider),
              [{ model: currentModel, provider: currentProvider }],
            );

    const phase = await beginAnchorPrivateWorkflow(interaction, locale, initialPayload);
    anchorMessage = phase.message;
    if (savedProviders.length === 0) return;

    // 2. Resolve the provider and the unacknowledged button the modal opens from.
    const opener = await acquireModelModalOpener(phase, interaction.user.id, locale, savedProviders, idRoot);
    if (!opener) return;
    const selectedProvider = opener.provider;
    const isCustom = isCustomProvider(selectedProvider);

    // 3. Load this provider's embedding models (custom + regular share the list).
    const availableModels = (
      (await llmModelRepo.loadAvailableEmbeddingModels(selectedProvider, false, {
        kind: "server",
        ownerId: tomoriState.server_id,
      })) ?? []
    ).filter(
      (model): model is typeof model & { embedding_model_id: number } =>
        model.embedding_model_id !== undefined && model.embedding_model_id !== null,
    );
    type EmbeddingModelChoice = (typeof availableModels)[number];

    if (availableModels.length === 0) {
      await phase.useButton(opener.button).replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.embedding.no_models_title",
          descriptionKey: "commands.model.embedding.no_models_description",
          descriptionVars: { provider: getProviderDisplayName(selectedProvider) },
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    // 4. Acquire the selected model. A custom provider with a single registered model
    //    activates directly (no modal); otherwise a string-select modal is shown in place.
    let work: PersonaWorkflowInPlacePhase;
    let chosenModel: EmbeddingModelChoice | null;
    if (isCustom && availableModels.length === 1) {
      work = await phase.useButton(opener.button).beginInPlaceWork();
      chosenModel = availableModels[0];
    } else {
      // >25 models route through the anchor range selector automatically.
      const modalPhase = await openAnchorModal(phase, opener.button, locale, {
        modalCustomId: isCustom ? "config_model_embedding_custom_modal" : MODAL_CUSTOM_ID,
        modalTitleKey: "commands.model.embedding.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.embedding.select_label",
            descriptionKey: "commands.model.embedding.select_description",
            placeholder: "commands.model.embedding.select_placeholder",
            required: true,
            options: availableModels.map((model) => ({
              label: safeSelectOptionText(model.codename),
              value: safeSelectOptionText(model.embedding_model_id.toString()),
              description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
            })),
          },
        ],
      });
      if (!modalPhase) return;
      work = await modalPhase.beginInPlaceWork();
      const selectedId = Number.parseInt(modalPhase.values[MODEL_SELECT_ID], 10);
      chosenModel = availableModels.find((model) => model.embedding_model_id === selectedId) ?? null;
    }
    selectedModel = chosenModel;

    if (!chosenModel) {
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.embedding.invalid_model_title",
          descriptionKey: "commands.model.embedding.invalid_model_description",
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    const selectedModelName = getEmbeddingModelDisplayName(chosenModel) ?? getProviderDisplayName(selectedProvider);

    if (chosenModel.embedding_model_id === tomoriState.config.embedding_model_id) {
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.embedding.already_selected_title",
          descriptionKey: "commands.model.embedding.already_selected_description",
          descriptionVars: { model_name: selectedModelName },
          color: ColorCode.WARN,
        }),
      );
      return;
    }

    // A change of embedding family invalidates existing document vectors, so re-embed.
    const currentEmbeddingModel = tomoriState.config.embedding_model_id
      ? await llmModelRepo.loadEmbeddingModelById(tomoriState.config.embedding_model_id)
      : null;
    const shouldReembed =
      currentEmbeddingModel?.model_family && currentEmbeddingModel.model_family !== chosenModel.model_family;

    const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
      embedding_model_id: chosenModel.embedding_model_id,
    });
    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "model embedding",
          guildId: interaction.guild?.id ?? interaction.user.id,
          selectedModelCodename: chosenModel.codename,
          targetEmbeddingModelId: chosenModel.embedding_model_id,
        },
      };
      await log.error("Failed to update embedding model config", new Error("Database update failed"), context);
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    // Re-embed in place: show the progress notice on the anchor message, run the
    // (potentially long) re-embed, then land the success terminal on the same message.
    if (shouldReembed && isRagAvailable()) {
      const docCount = await serverMemoryRepository.countDocuments(tomoriState.server_id);
      if (docCount > 0) {
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.model.embedding.reembed_started_title",
            descriptionKey: "commands.model.embedding.reembed_started_description",
            color: ColorCode.INFO,
          }),
        );

        const creds = await resolveCapabilityCredentials(tomoriState.server_id, "embedding");
        const limits = getMemoryLimits();
        await ragRepository.reembedServerDocuments({
          serverId: tomoriState.server_id,
          embeddingModel: chosenModel,
          apiKey: creds.apiKey,
          chunkSize: limits.documentChunkSize,
          chunkOverlap: limits.documentChunkOverlap,
        });
      }
    }

    await work.message.replace(
      buildPersonaWorkflowNotice({
        locale,
        titleKey: "commands.model.embedding.success_title",
        descriptionKey: "commands.model.embedding.success_description",
        descriptionVars: {
          model_name: selectedModelName,
          previous_model:
            getEmbeddingModelDisplayName(currentEmbeddingModel) ??
            localizer(locale, "commands.model.embedding.current_none"),
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.SUCCESS,
      }),
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "model embedding",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
        targetEmbeddingModelIdAttempted: selectedModel?.embedding_model_id,
      },
    };
    await log.error(`Error executing /model embedding for user ${userData.user_disc_id}`, error as Error, context);

    // Render the unexpected-error terminal on the anchor message; fall back to a fresh
    // reply only if the message is already gone (fatal) or was never created.
    if (anchorMessage) {
      try {
        await anchorMessage.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "general.errors.unknown_error_title",
            descriptionKey: "general.errors.unknown_error_description",
            color: ColorCode.ERROR,
          }),
        );
        return;
      } catch {
        // Fall through to a fresh reply below.
      }
    }

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
