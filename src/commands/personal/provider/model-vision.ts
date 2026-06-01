import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { llmModelRepo } from "@/utils/db/repositories";
import { promptForSavedProvider } from "@/utils/discord/providerPicker";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { ErrorContext, LlmRow, SavedProviderConfigRow, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { loadUserSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { assignPersonalCapabilityToProvider } from "@/utils/provider/personalProviderHelpers";
import { replyLegacyOpenRouterOtherModelMoved } from "@/utils/discord/openrouterModelMigrationNotice";

const MODEL_SELECT_ID = "model_select";

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

  try {
    const savedProviders = await loadUserSavedProvidersForCapability(userData.user_id, "vision");
    if (savedProviders.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.provider.no_saved_title",
        descriptionKey: "commands.personal.provider.no_saved_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const providerSelection = await promptForSavedProvider(
      interaction,
      locale,
      savedProviders as unknown as SavedProviderConfigRow[],
    );
    if (!providerSelection) return;

    const availableModels =
      (
        await llmModelRepo.loadAvailableModelsForProvider(providerSelection.provider, false, {
          kind: "personal",
          ownerId: userData.user_id,
        })
      )?.filter((model) => model.sees_images) ?? [];
    if (availableModels.length === 0) {
      await replyInfoEmbed(providerSelection.interaction, locale, {
        titleKey: "commands.model.vision.no_models_title",
        descriptionKey: "commands.model.vision.no_models_description",
        descriptionVars: { provider: getProviderDisplayName(providerSelection.provider) },
        color: ColorCode.ERROR,
      });
      return;
    }

    const modelOptions: SelectOption[] = availableModels.map((model) => ({
      label: safeSelectOptionText(model.llm_codename),
      value: safeSelectOptionText(model.llm_codename),
      description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
    }));

    const modalResult = await promptWithRawModal(
      providerSelection.interaction,
      locale,
      {
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
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) return;

    const selectedCodename = modalResult.values?.[MODEL_SELECT_ID];
    const selectedModel = availableModels.find((model) => model.llm_codename === selectedCodename) ?? null;
    if (!selectedModel?.llm_id) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.model.vision.invalid_model_title",
        descriptionKey: "commands.model.vision.invalid_model_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (selectedModel.llm_codename === "other-model") {
      await replyLegacyOpenRouterOtherModelMoved(modalResult.interaction, locale, "personal");
      return;
    }

    const updated = await assignPersonalCapabilityToProvider(
      userData.user_id,
      providerSelection.provider,
      "vision",
      (row) => ({
        ...row,
        vision_llm_id: selectedModel.llm_id ?? null,
      }),
    );
    if (!updated) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.personal.provider.model_success_title",
      descriptionKey: "commands.personal.provider.model_vision.success_description",
      descriptionVars: {
        provider: getProviderDisplayName(providerSelection.provider),
        model: selectedModel.llm_codename,
      },
      color: ColorCode.SUCCESS,
    });
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
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
