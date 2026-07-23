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
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import {
  beginCanonicalPrivateWorkflow,
  buildPersonaWorkflowNotice,
  type PersonaWorkflowInPlacePhase,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/canonicalWorkflow";
import {
  acquireModelModalOpener,
  buildNoProvidersPayload,
  buildOpenSelectorPayload,
  buildProviderPickerPayload,
  openCanonicalModal,
} from "@/utils/discord/ui/canonicalModelFlow";
import { configRepository, llmModelRepo } from "@/utils/db/repositories";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
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

  // Canonical one-message controller, tracked so the outer catch can render an
  // unexpected-error terminal on the same ephemeral message.
  let selectedModel: VideoGenerationModelRow | null = null;
  let canonicalMessage: PersonaWorkflowMessageController | null = null;

  try {
    const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "video");
    const idRoot = "model_video";

    // 1. Open the canonical message with the right initial control for the provider count.
    const currentVideoModel = tomoriState.config.video_model_id
      ? await llmModelRepo.loadVideoGenerationModelById(tomoriState.config.video_model_id)
      : null;
    const currentModel =
      getVideoModelDisplayName(currentVideoModel) ?? localizer(locale, "commands.model.video.current_none");
    const currentProvider = currentVideoModel?.provider ?? localizer(locale, "general.unknown");
    const initialPayload =
      savedProviders.length === 0
        ? buildNoProvidersPayload(locale)
        : savedProviders.length === 1
          ? buildOpenSelectorPayload(locale, `${idRoot}_open`)
          : buildProviderPickerPayload(
              locale,
              idRoot,
              savedProviders.map((p) => p.provider),
              currentModel,
              currentProvider,
            );

    const phase = await beginCanonicalPrivateWorkflow(interaction, locale, initialPayload);
    canonicalMessage = phase.message;
    if (savedProviders.length === 0) return;

    // 2. Resolve the provider and the unacknowledged button the modal opens from.
    const opener = await acquireModelModalOpener(phase, interaction.user.id, locale, savedProviders, idRoot);
    if (!opener) return;
    const selectedProvider = opener.provider;
    const isCustom = isCustomProvider(selectedProvider);

    // 3. Load this provider's video-generation models (custom + regular share the list).
    const availableModels = (
      (await llmModelRepo.loadAvailableVideoGenerationModels(selectedProvider, false, {
        kind: "server",
        ownerId: tomoriState.server_id,
      })) ?? []
    ).filter(
      (model): model is typeof model & { video_model_id: number } =>
        model.video_model_id !== undefined && model.video_model_id !== null,
    );
    type VideoModelChoice = (typeof availableModels)[number];

    if (availableModels.length === 0) {
      await phase.useButton(opener.button).replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.video.no_models_title",
          descriptionKey: "commands.model.video.no_models_description",
          descriptionVars: { provider: getProviderDisplayName(selectedProvider) },
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    // 4. Acquire the selected model. A custom provider with a single registered model
    //    activates directly (no modal); otherwise a string-select modal is shown in place.
    let work: PersonaWorkflowInPlacePhase;
    let chosenModel: VideoModelChoice | null;
    if (isCustom && availableModels.length === 1) {
      work = await phase.useButton(opener.button).beginInPlaceWork();
      chosenModel = availableModels[0];
    } else {
      // >25 models route through the canonical range selector automatically.
      const modalPhase = await openCanonicalModal(phase, opener.button, locale, {
        modalCustomId: isCustom ? "config_model_video_custom_modal" : MODAL_CUSTOM_ID,
        modalTitleKey: "commands.model.video.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.video.select_label",
            descriptionKey: "commands.model.video.select_description",
            placeholder: "commands.model.video.select_placeholder",
            required: true,
            options: availableModels.map((model) => ({
              label: safeSelectOptionText(getVideoModelDisplayName(model) ?? model.codename),
              value: safeSelectOptionText(model.video_model_id.toString()),
              description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
            })),
          },
        ],
      });
      if (!modalPhase) return;
      work = await modalPhase.beginInPlaceWork();
      const selectedId = Number.parseInt(modalPhase.values[MODEL_SELECT_ID], 10);
      chosenModel = availableModels.find((model) => model.video_model_id === selectedId) ?? null;
    }
    selectedModel = chosenModel;

    if (!chosenModel) {
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "commands.model.video.invalid_model_description",
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    const selectedModelName = getVideoModelDisplayName(chosenModel) ?? getProviderDisplayName(selectedProvider);
    const currentSelectedId = tomoriState.config.video_model_id ?? null;

    if (chosenModel.video_model_id === currentSelectedId) {
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.video.already_selected_title",
          descriptionKey: "commands.model.video.already_selected_description",
          descriptionVars: { model_name: selectedModelName },
          color: ColorCode.WARN,
        }),
      );
      return;
    }

    const previousModel = currentSelectedId ? await llmModelRepo.loadVideoGenerationModelById(currentSelectedId) : null;
    const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
      video_model_id: chosenModel.video_model_id,
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
          selectedModelCodename: chosenModel.codename,
          targetVideoModelId: chosenModel.video_model_id,
        },
      };
      await log.error("Failed to update video model config", new Error("Database update failed"), context);
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
        titleKey: "commands.model.video.success_title",
        descriptionKey: "commands.model.video.success_description",
        descriptionVars: {
          model_name: selectedModelName,
          previous_model:
            getVideoModelDisplayName(previousModel) ?? localizer(locale, "commands.model.video.current_none"),
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
        command: "model video",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
        targetVideoModelIdAttempted: selectedModel?.video_model_id,
      },
    };
    await log.error(`Error executing /model video for user ${userData.user_disc_id}`, error as Error, context);

    // Render the unexpected-error terminal on the canonical message; fall back to a fresh
    // reply only if the message is already gone (fatal) or was never created.
    if (canonicalMessage) {
      try {
        await canonicalMessage.replace(
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
