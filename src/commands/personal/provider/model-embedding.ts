import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { llmModelRepo } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { EmbeddingModelRow, ErrorContext, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { loadUserSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import {
  assignPersonalCapabilityToProvider,
  resolveActivePersonalProviderModelSelections,
} from "@/utils/provider/personalProviderHelpers";
import {
  beginAnchorPrivateWorkflow,
  buildPersonaWorkflowNotice,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/anchorWorkflow";
import {
  acquireModelModalOpener,
  buildNoProvidersPayload,
  buildOpenSelectorPayload,
  buildProviderPickerPayload,
  openAnchorModal,
} from "@/utils/discord/ui/anchorModelFlow";

const MODEL_SELECT_ID = "model_select";

/** Custom-id root for this command's anchor provider picker / opener buttons. */
const ID_ROOT = "personal_model_embedding";

function getLocalizedDescription(model: EmbeddingModelRow, locale: string): string {
  if (model.is_scoped_registration) {
    return localizer(locale, "general.scoped_openrouter_model_description");
  }
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.model_description;
  const baseDescription = description || model.model_description || `${model.provider} model`;
  return model.is_default ? `(DEFAULT) ${baseDescription}` : baseDescription;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("model-embedding")
    .setDescription(localizer("en-US", "commands.personal.provider.model-embedding.description"));

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
    const savedProviders = await loadUserSavedProvidersForCapability(userData.user_id, "embedding");

    // Open the anchor message with the right initial control for the provider count.
    //    The active-selection lookup only matters when a picker is actually rendered.
    const currentSelections =
      savedProviders.length > 1 ? await resolveActivePersonalProviderModelSelections(savedProviders, "embedding") : [];
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

    // Resolve the provider and the unacknowledged button the modal opens from.
    const opener = await acquireModelModalOpener(phase, interaction.user.id, locale, savedProviders, ID_ROOT);
    if (!opener) return;
    const selectedProvider = opener.provider;

    const availableModels =
      (await llmModelRepo.loadAvailableEmbeddingModels(selectedProvider, false, {
        kind: "personal",
        ownerId: userData.user_id,
      })) ?? [];
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

    const modelOptions: SelectOption[] = availableModels
      .filter((model) => model.embedding_model_id !== null)
      .map((model) => ({
        label: safeSelectOptionText(model.codename),
        value: safeSelectOptionText((model.embedding_model_id ?? 0).toString()),
        description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
      }));

    // >25 models route through the anchor range selector automatically.
    const modalPhase = await openAnchorModal(phase, opener.button, locale, {
      modalCustomId: "personal_provider_model_embedding_modal",
      modalTitleKey: "commands.model.embedding.modal_title",
      components: [
        {
          customId: MODEL_SELECT_ID,
          labelKey: "commands.model.embedding.select_label",
          descriptionKey: "commands.model.embedding.select_description",
          placeholder: "commands.model.embedding.select_placeholder",
          required: true,
          options: modelOptions,
        },
      ],
    });
    if (!modalPhase) return;

    // Acknowledge the modal submit within 3s, then render the terminal in place.
    const work = await modalPhase.beginInPlaceWork();
    const selectedModelId = Number.parseInt(modalPhase.values[MODEL_SELECT_ID] ?? "", 10);
    const selectedModel = availableModels.find((model) => model.embedding_model_id === selectedModelId) ?? null;
    if (!selectedModel?.embedding_model_id) {
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

    const updated = await assignPersonalCapabilityToProvider(
      userData.user_id,
      selectedProvider,
      "embedding",
      (row) => ({
        ...row,
        embedding_model_id: selectedModel.embedding_model_id ?? null,
      }),
    );
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
        descriptionKey: "commands.personal.provider.model_embedding.success_description",
        descriptionVars: {
          provider: getProviderDisplayName(selectedProvider),
          model: selectedModel.codename,
        },
        color: ColorCode.SUCCESS,
      }),
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal provider model-embedding",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal provider model-embedding", error as Error, context);

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
