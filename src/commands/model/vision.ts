import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { configRepository, llmModelRepo } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { UserRow, ErrorContext, LlmRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import {
  beginCanonicalPrivateWorkflow,
  buildPersonaWorkflowNotice,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/canonicalWorkflow";
import {
  acquireModelModalOpener,
  buildNoProvidersPayload,
  buildOpenRouterMovedNotice,
  buildOpenSelectorPayload,
  buildProviderPickerPayload,
  openCanonicalModal,
} from "@/utils/discord/ui/canonicalModelFlow";
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

  // Canonical one-message controller, tracked so the outer catch can render an
  // unexpected-error terminal on the same ephemeral message.
  let selectedModel: LlmRow | null = null;
  let canonicalMessage: PersonaWorkflowMessageController | null = null;

  try {
    const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "vision");
    const idRoot = "model_vision";

    // 1. Open the canonical message with the right initial control for the provider count.
    const currentModel = tomoriState.vision_llm?.llm_codename ?? localizer(locale, "general.unknown");
    const currentProvider = tomoriState.vision_llm?.llm_provider ?? localizer(locale, "general.unknown");
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

    // 3a. Custom provider: no modal — activate the saved vision model directly.
    if (isCustomProvider(selectedProvider)) {
      const selectedSavedConfig = savedProviders.find((row) => row.provider.toLowerCase() === selectedProvider) ?? null;
      const work = await phase.useButton(opener.button).beginInPlaceWork();
      if (!selectedSavedConfig?.vision_llm_id) {
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.model.vision.no_models_title",
            descriptionKey: "commands.model.vision.no_models_description",
            descriptionVars: { provider: getProviderDisplayName(selectedProvider) },
            color: ColorCode.ERROR,
          }),
        );
        return;
      }

      const updated = await configRepository.updateModelConfig(tomoriState.server_id, {
        vision_llm_id: selectedSavedConfig.vision_llm_id,
      });
      if (!updated) {
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

      invalidateTomoriStateCache(serverId);
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
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
        }),
      );
      return;
    }

    // 3b. Regular provider: vision-capable model picker with a "clear" option.
    const allModels = await llmModelRepo.loadAvailableModelsForProvider(selectedProvider, false, {
      kind: "server",
      ownerId: tomoriState.server_id,
    });
    const visionModels = allModels?.filter((m) => m.sees_images) ?? [];

    if (visionModels.length === 0) {
      await phase.useButton(opener.button).replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.vision.no_models_title",
          descriptionKey: "commands.model.vision.no_models_description",
          descriptionVars: { provider: getProviderDisplayName(selectedProvider) },
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    const modelSelectOptions: SelectOption[] = [
      {
        label: safeSelectOptionText(localizer(locale, "commands.model.vision.clear_option")),
        value: CLEAR_VISION_VALUE,
        description: "",
      },
      ...visionModels.map((model) => ({
        label: safeSelectOptionText(model.llm_codename),
        value: safeSelectOptionText(model.llm_codename),
        description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
      })),
    ];

    // >25 vision models route through the canonical range selector automatically.
    const modalPhase = await openCanonicalModal(phase, opener.button, locale, {
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
    });
    if (!modalPhase) return;

    const work = await modalPhase.beginInPlaceWork();
    const selectedValue = modalPhase.values[MODEL_SELECT_ID];

    // Handle "clear" selection — remove the vision model.
    if (selectedValue === CLEAR_VISION_VALUE) {
      if (!tomoriState.config.vision_llm_id) {
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.model.vision.cleared_title",
            descriptionKey: "commands.model.vision.cleared_description",
            color: ColorCode.WARN,
          }),
        );
        return;
      }

      const updated = await configRepository.updateModelConfig(tomoriState.server_id, { vision_llm_id: null });
      if (!updated) {
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

      invalidateTomoriStateCache(serverId);
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.vision.cleared_title",
          descriptionKey: "commands.model.vision.cleared_description",
          color: ColorCode.SUCCESS,
        }),
      );
      return;
    }

    selectedModel = visionModels.find((model) => model.llm_codename === selectedValue) ?? null;
    if (!selectedModel) {
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.vision.invalid_model_title",
          descriptionKey: "commands.model.vision.invalid_model_description",
          color: ColorCode.ERROR,
        }),
      );
      return;
    }

    if (selectedModel.llm_codename === "other-model") {
      await work.message.replace(buildOpenRouterMovedNotice(locale));
      return;
    }

    if (selectedModel.llm_id === tomoriState.config.vision_llm_id) {
      await work.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "commands.model.vision.already_selected_title",
          descriptionKey: "commands.model.vision.already_selected_description",
          descriptionVars: { model_name: selectedModel.llm_codename },
          color: ColorCode.WARN,
        }),
      );
      return;
    }

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

    invalidateTomoriStateCache(serverId);
    await work.message.replace(
      buildPersonaWorkflowNotice({
        locale,
        titleKey: "commands.model.vision.success_title",
        descriptionKey: tomoriState.llm.has_tools
          ? "commands.model.vision.success_description"
          : "commands.model.vision.success_no_tools_description",
        descriptionVars: {
          model_name: selectedModel.llm_codename,
          chat_model: tomoriState.llm.llm_codename,
          provider: getProviderDisplayName(selectedProvider),
        },
        color: ColorCode.SUCCESS,
      }),
    );
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
