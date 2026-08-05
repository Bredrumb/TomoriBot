import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { llmModelRepo } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { ErrorContext, LlmRow, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { loadUserSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import {
  assignPersonalCapabilityToProvider,
  activatesNewPersonalOverride,
  resolveActivePersonalProviderModelSelections,
} from "@/utils/provider/personalProviderHelpers";
import {
  beginAnchorPrivateWorkflow,
  buildPersonaWorkflowNotice,
  type PersonaWorkflowInPlacePhase,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/anchorWorkflow";
import {
  acquireModelModalOpener,
  buildNoProvidersPayload,
  buildOpenRouterMovedNotice,
  buildOpenSelectorPayload,
  buildProviderPickerPayload,
  confirmPersonalOverrideActivation,
  openAnchorModal,
} from "@/utils/discord/ui/anchorModelFlow";

const MODEL_SELECT_ID = "model_select";

/** Custom-id root for this command's anchor provider picker / opener buttons. */
const ID_ROOT = "personal_model_vision";

function getLocalizedDescription(model: LlmRow, locale: string): string {
  if (model.is_scoped_registration) {
    return localizer(locale, "general.scoped_openrouter_model_description");
  }
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.llm_description;
  const baseDescription = description || model.llm_description || `${model.llm_provider} model`;
  const flags: string[] = [];
  if (model.is_free) flags.push("FREE");
  if (model.has_tools) flags.push("TOOLS");
  if (model.sees_images) flags.push("IMG");
  if (model.supports_structoutput) flags.push("STRUCT");
  return flags.length > 0 ? `(${flags.join("+")}) ${baseDescription}` : baseDescription;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("model-vision")
    .setDescription(localizer("en-US", "commands.personal.provider.model-vision.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!userData.user_id) {
    return;
  }

  // Anchor one-message controller, tracked so the outer catch can render an
  // unexpected-error terminal on the same ephemeral message.
  let anchorMessage: PersonaWorkflowMessageController | null = null;

  try {
    const savedProviders = await loadUserSavedProvidersForCapability(userData.user_id, "vision");

    // Open the anchor message with the right initial control for the provider count.
    //    The active-selection lookup only matters when a picker is actually rendered.
    const currentSelections =
      savedProviders.length > 1 ? await resolveActivePersonalProviderModelSelections(savedProviders, "vision") : [];
    const initialPayload =
      savedProviders.length === 0
        ? buildNoProvidersPayload(locale, "personal")
        : savedProviders.length === 1
          ? buildOpenSelectorPayload(locale, `${ID_ROOT}_open`)
          : buildProviderPickerPayload(
              locale,
              ID_ROOT,
              savedProviders.map((row) => row.provider),
              currentSelections,
            );

    const phase = await beginAnchorPrivateWorkflow(interaction, locale, initialPayload);
    anchorMessage = phase.message;
    if (savedProviders.length === 0) return;

    const opener = await acquireModelModalOpener(phase, interaction.user.id, locale, savedProviders, ID_ROOT);
    if (!opener) return;
    const selectedProvider = opener.provider;

    const availableModels =
      (
        await llmModelRepo.loadAvailableModelsForProvider(selectedProvider, false, {
          kind: "personal",
          ownerId: userData.user_id,
        })
      )?.filter((model) => model.sees_images) ?? [];
    if (availableModels.length === 0) {
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

    const modelOptions: SelectOption[] = availableModels.map((model) => ({
      label: safeSelectOptionText(model.llm_codename),
      value: safeSelectOptionText(model.llm_codename),
      description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
    }));

    // >25 models route through the anchor range selector automatically.
    const modalPhase = await openAnchorModal(phase, opener.button, locale, {
      modalCustomId: "personal_provider_model_vision_modal",
      modalTitleKey: "commands.model.vision.modal_title",
      components: [
        {
          customId: MODEL_SELECT_ID,
          labelKey: "commands.model.vision.select_label",
          descriptionKey: "commands.model.vision.select_description",
          placeholder: "commands.model.vision.select_placeholder",
          required: true,
          options: modelOptions,
        },
      ],
    });
    if (!modalPhase) return;

    // Selecting a model also activates the capability, so whether Vision was already routing
    // personally is what separates "newly enabling a cross-server override" (needs consent)
    // from "switching models inside an override that is already on".
    const activatesOverride = activatesNewPersonalOverride(savedProviders, "vision");

    const selectedCodename = modalPhase.values[MODEL_SELECT_ID];
    const selectedModel = availableModels.find((model) => model.llm_codename === selectedCodename) ?? null;
    if (!selectedModel?.llm_id) {
      await modalPhase.replace(
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
      await modalPhase.replace(buildOpenRouterMovedNotice(locale, "personal"));
      return;
    }

    // Either branch acknowledges its own interaction within 3s and yields the same in-place
    // controller, so everything below is unaware of whether a confirmation was shown.
    let work: PersonaWorkflowInPlacePhase;
    if (!activatesOverride) {
      work = await modalPhase.beginInPlaceWork();
    } else {
      const confirmed = await confirmPersonalOverrideActivation(
        phase,
        modalPhase,
        interaction.user.id,
        locale,
        {
          capability: localizer(locale, "commands.personal.provider.capability_vision"),
          provider: getProviderDisplayName(selectedProvider),
          model: selectedModel.llm_codename,
        },
        ID_ROOT,
      );
      if (!confirmed) return;
      work = await phase.useButton(confirmed).beginInPlaceWork();
    }

    const updated = await assignPersonalCapabilityToProvider(userData.user_id, selectedProvider, "vision", (row) => ({
      ...row,
      vision_llm_id: selectedModel.llm_id ?? null,
    }));
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

    await work.message.replace(
      buildPersonaWorkflowNotice({
        locale,
        titleKey: "commands.personal.provider.model_success_title",
        descriptionKey: "commands.personal.provider.model_vision.success_description",
        descriptionVars: {
          provider: getProviderDisplayName(selectedProvider),
          model: selectedModel.llm_codename,
          scope_notice: localizer(locale, "commands.personal.provider.scope_notice"),
        },
        color: ColorCode.SUCCESS,
      }),
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal provider model-vision",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal provider model-vision", error as Error, context);

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
      } catch {}
    }

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
