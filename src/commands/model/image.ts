import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { UserRow, ErrorContext } from "@/types/db/schema";
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
  if (model.is_free && !isCustomProvider(model.provider)) flags.push("FREE");
  if (model.is_uncensored && !isCustomProvider(model.provider)) flags.push("UNCENSORED");

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
  // Ensure command is run in a channel
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // Load the Tomori state for this server
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

  // Anchor one-message controller, tracked so the outer catch can render an
  // unexpected-error terminal on the same ephemeral message.
  let selectedModel: ImageDiffusionModelRow | null = null;
  let anchorMessage: PersonaWorkflowMessageController | null = null;

  try {
    const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "image");
    const idRoot = "model_image";

    // Open the anchor message with the right initial control for the provider count.
    const hasNaiProviders = savedProviders.some(
      (provider) => getStaticProviderInfo(provider.provider)?.featureSupport.imageGeneration === "nai-pipeline",
    );
    const currentImageModels = await Promise.all(
      [tomoriState.config.diffusion_model_id, tomoriState.config.nai_diffusion_model_id]
        .filter((modelId): modelId is number => typeof modelId === "number")
        .map((modelId) => llmModelRepo.loadDiffusionModelById(modelId)),
    );
    const currentPrimary = currentImageModels.find((model) => model) ?? null;
    const currentModel =
      getImageModelDisplayName(currentPrimary) ?? localizer(locale, "commands.model.image.current_none");
    const currentProvider = currentPrimary?.provider ?? localizer(locale, "general.unknown");
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
              { note: hasNaiProviders ? localizer(locale, "commands.model.image.nai_picker_note") : undefined },
            );

    const phase = await beginAnchorPrivateWorkflow(interaction, locale, initialPayload);
    anchorMessage = phase.message;
    if (savedProviders.length === 0) return;

    // Resolve the provider and the unacknowledged button the modal opens from.
    const opener = await acquireModelModalOpener(phase, interaction.user.id, locale, savedProviders, idRoot);
    if (!opener) return;
    const selectedProvider = opener.provider;
    const isCustom = isCustomProvider(selectedProvider);

    // Load this provider's diffusion models (custom + regular share the list).
    const availableModels = (
      (await llmModelRepo.loadAvailableDiffusionModels(selectedProvider, false, {
        kind: "server",
        ownerId: tomoriState.server_id,
      })) ?? []
    ).filter(
      (model): model is typeof model & { diffusion_model_id: number } =>
        model.diffusion_model_id !== undefined && model.diffusion_model_id !== null,
    );
    type ImageModelChoice = (typeof availableModels)[number];

    if (availableModels.length === 0) {
      await phase.useButton(opener.button).replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.image.no_models_title",
          descriptionKey: "commands.model.image.no_models_description",
          descriptionVars: { provider: getProviderDisplayName(selectedProvider) },
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    // Regular NAI-pipeline providers write the NAI slot; custom always uses the standard slot.
    const imageGenerationStyle = getStaticProviderInfo(selectedProvider)?.featureSupport.imageGeneration ?? "none";
    const targetColumn =
      !isCustom && imageGenerationStyle === "nai-pipeline" ? "nai_diffusion_model_id" : "diffusion_model_id";
    const currentSelectedId =
      targetColumn === "nai_diffusion_model_id"
        ? (tomoriState.config.nai_diffusion_model_id ?? null)
        : (tomoriState.config.diffusion_model_id ?? null);

    // Acquire the selected model. A custom provider with a single registered model
    //    activates directly (no modal); otherwise a string-select modal is shown in place.
    let work: PersonaWorkflowInPlacePhase;
    let chosenModel: ImageModelChoice | null;
    if (isCustom && availableModels.length === 1) {
      work = await phase.useButton(opener.button).beginInPlaceWork();
      chosenModel = availableModels[0];
    } else {
      // >25 models route through the anchor range selector automatically.
      const modalPhase = await openAnchorModal(phase, opener.button, locale, {
        modalCustomId: isCustom ? "config_model_image_custom_modal" : MODAL_CUSTOM_ID,
        modalTitleKey: "commands.model.image.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.image.select_label",
            descriptionKey: "commands.model.image.select_description",
            placeholder: "commands.model.image.select_placeholder",
            required: true,
            options: availableModels.map((model) => ({
              label: safeSelectOptionText(model.codename),
              value: safeSelectOptionText(model.diffusion_model_id.toString()),
              description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
            })),
          },
        ],
      });
      if (!modalPhase) return;
      work = await modalPhase.beginInPlaceWork();
      const selectedId = Number.parseInt(modalPhase.values[MODEL_SELECT_ID], 10);
      chosenModel = availableModels.find((model) => model.diffusion_model_id === selectedId) ?? null;
    }
    selectedModel = chosenModel;

    if (!chosenModel) {
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "commands.model.image.invalid_model_description",
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    const selectedModelName = getImageModelDisplayName(chosenModel) ?? getProviderDisplayName(selectedProvider);

    if (chosenModel.diffusion_model_id === currentSelectedId) {
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.image.already_selected_title",
          descriptionKey: "commands.model.image.already_selected_description",
          descriptionVars: { model_name: selectedModelName },
          color: ColorCode.WARN,
        }),
      );
      return;
    }

    const previousModel = currentSelectedId ? await getDiffusionModelById(currentSelectedId) : null;
    const updated =
      targetColumn === "nai_diffusion_model_id"
        ? await configRepository.updateNovelaiImagegenConfig(tomoriState.server_id, {
            nai_diffusion_model_id: chosenModel.diffusion_model_id,
          })
        : await configRepository.updateModelConfig(tomoriState.server_id, {
            diffusion_model_id: chosenModel.diffusion_model_id,
          });
    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "model image",
          guildId: interaction.guild?.id ?? interaction.user.id,
          selectedModelCodename: chosenModel.codename,
          targetDiffusionModelId: chosenModel.diffusion_model_id,
        },
      };
      await log.error(
        "Failed to update diffusion model config after DB update",
        new Error("Database update returned no rows"),
        context,
      );
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
    await work.message.replace(
      buildPersonaWorkflowNotice({
        locale,
        titleKey: "commands.model.image.success_title",
        descriptionKey: "commands.model.image.success_description",
        descriptionVars: {
          model_name: selectedModelName,
          previous_model:
            getImageModelDisplayName(previousModel) ?? localizer(locale, "commands.model.image.current_none"),
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.SUCCESS,
      }),
    );
  } catch (error) {
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
        command: "model image",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
        targetDiffusionModelIdAttempted: selectedModel?.diffusion_model_id,
      },
    };
    await log.error(`Error executing /model image for user ${userData.user_disc_id}`, error as Error, context);

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
