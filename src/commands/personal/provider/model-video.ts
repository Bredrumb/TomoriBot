import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { llmModelRepo } from "@/utils/db/repositories";
import { promptForSavedProvider } from "@/utils/discord/providerPicker";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { ErrorContext, SavedProviderConfigRow, UserRow, VideoGenerationModelRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { loadUserSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { assignPersonalCapabilityToProvider } from "@/utils/provider/personalProviderHelpers";

const MODEL_SELECT_ID = "model_select";

function getLocalizedDescription(model: VideoGenerationModelRow, locale: string): string {
  if (model.is_scoped_registration) {
    return localizer(locale, "general.scoped_openrouter_model_description");
  }
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.model_description;
  const baseDescription = description || model.model_description || `${model.provider} model`;
  return model.is_free ? `(FREE) ${baseDescription}` : baseDescription;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("model-video")
    .setDescription(localizer("en-US", "commands.personal.provider.model-video.description"));

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
    const savedProviders = await loadUserSavedProvidersForCapability(userData.user_id, "video");
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
      (await llmModelRepo.loadAvailableVideoGenerationModels(providerSelection.provider, false, {
        kind: "personal",
        ownerId: userData.user_id,
      })) ?? [];
    if (availableModels.length === 0) {
      await replyInfoEmbed(providerSelection.interaction, locale, {
        titleKey: "commands.model.video.no_models_title",
        descriptionKey: "commands.model.video.no_models_description",
        descriptionVars: { provider: getProviderDisplayName(providerSelection.provider) },
        color: ColorCode.ERROR,
      });
      return;
    }

    const modelOptions: SelectOption[] = availableModels.map((model) => ({
      label: safeSelectOptionText(model.codename),
      value: safeSelectOptionText((model.video_model_id ?? 0).toString()),
      description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
    }));

    const modalResult = await promptWithRawModal(
      providerSelection.interaction,
      locale,
      {
        modalCustomId: "personal_provider_model_video_modal",
        modalTitleKey: "commands.model.video.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.video.select_label",
            descriptionKey: "commands.model.video.select_description",
            placeholder: "commands.model.video.select_placeholder",
            required: true,
            options: modelOptions,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) return;

    const selectedModelId = Number.parseInt(modalResult.values?.[MODEL_SELECT_ID] ?? "", 10);
    const selectedModel = availableModels.find((model) => model.video_model_id === selectedModelId) ?? null;
    if (!selectedModel?.video_model_id) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "commands.model.video.invalid_model_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const updated = await assignPersonalCapabilityToProvider(
      userData.user_id,
      providerSelection.provider,
      "video",
      (row) => ({
        ...row,
        video_model_id: selectedModel.video_model_id ?? null,
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
      descriptionKey: "commands.personal.provider.model_video.success_description",
      descriptionVars: {
        provider: getProviderDisplayName(providerSelection.provider),
        model: selectedModel.codename,
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal provider model-video",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal provider model-video", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
