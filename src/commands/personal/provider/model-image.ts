import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { llmModelRepo } from "@/utils/db/repositories";
import { promptForSavedProvider } from "@/utils/discord/providerPicker";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { DiffusionModelRow, ErrorContext, SavedProviderConfigRow, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { loadUserSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { assignPersonalCapabilityToProvider } from "@/utils/provider/personalProviderHelpers";
import { getProviderDisplayName, getStaticProviderInfo } from "@/utils/provider/providerInfoRegistry";

const MODEL_SELECT_ID = "model_select";

function getLocalizedDescription(model: DiffusionModelRow, locale: string): string {
  if (model.is_scoped_registration) {
    return localizer(locale, "general.scoped_openrouter_model_description");
  }
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.model_description;
  const baseDescription = description || model.model_description || `${model.provider} model`;
  const flags: string[] = [];
  if (model.is_default) flags.push("DEFAULT");
  if (model.is_free) flags.push("FREE");
  if (model.is_uncensored) flags.push("UNCENSORED");
  return flags.length > 0 ? `(${flags.join("+")}) ${baseDescription}` : baseDescription;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("model-image")
    .setDescription(localizer("en-US", "commands.personal.provider.model-image.description"));

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
    const savedProviders = await loadUserSavedProvidersForCapability(userData.user_id, "image");
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
      (await llmModelRepo.loadAvailableDiffusionModels(providerSelection.provider, false, {
        kind: "personal",
        ownerId: userData.user_id,
      })) ?? [];
    if (availableModels.length === 0) {
      await replyInfoEmbed(providerSelection.interaction, locale, {
        titleKey: "commands.model.image.no_models_title",
        descriptionKey: "commands.model.image.no_models_description",
        descriptionVars: { provider: getProviderDisplayName(providerSelection.provider) },
        color: ColorCode.ERROR,
      });
      return;
    }

    const modelOptions: SelectOption[] = availableModels
      .filter((model) => model.diffusion_model_id !== null)
      .map((model) => ({
        label: safeSelectOptionText(model.codename),
        value: safeSelectOptionText((model.diffusion_model_id ?? 0).toString()),
        description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
      }));

    const modalResult = await promptWithRawModal(
      providerSelection.interaction,
      locale,
      {
        modalCustomId: "personal_provider_model_image_modal",
        modalTitleKey: "commands.model.image.modal_title",
        components: [
          {
            customId: MODEL_SELECT_ID,
            labelKey: "commands.model.image.select_label",
            descriptionKey: "commands.model.image.select_description",
            placeholder: "commands.model.image.select_placeholder",
            required: true,
            options: modelOptions,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) return;

    const selectedModelId = Number.parseInt(modalResult.values?.[MODEL_SELECT_ID] ?? "", 10);
    const selectedModel = availableModels.find((model) => model.diffusion_model_id === selectedModelId) ?? null;
    if (!selectedModel?.diffusion_model_id) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "commands.model.image.invalid_model_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const imageStyle = getStaticProviderInfo(providerSelection.provider)?.featureSupport.imageGeneration ?? "none";
    const updated = await assignPersonalCapabilityToProvider(
      userData.user_id,
      providerSelection.provider,
      "image",
      (row) => ({
        ...row,
        diffusion_model_id:
          imageStyle === "nai-pipeline" ? (row.diffusion_model_id ?? null) : (selectedModel.diffusion_model_id ?? null),
        nai_diffusion_model_id:
          imageStyle === "nai-pipeline"
            ? (selectedModel.diffusion_model_id ?? null)
            : (row.nai_diffusion_model_id ?? null),
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
      descriptionKey: "commands.personal.provider.model_image.success_description",
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
        command: "personal provider model-image",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal provider model-image", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
