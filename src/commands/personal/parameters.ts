import type { ButtonInteraction, ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { THINKING_LEVEL_VALUES, type ThinkingLevelValue, isThinkingLevelValue } from "@/constants/thinkingLevels";
import type { ErrorContext, SavedProviderConfigRow, UserRow } from "@/types/db/schema";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";
import { loadUserSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { llmProviderRepo } from "@/utils/db/repositories";
import { promptForSavedProvider } from "@/utils/discord/providerPicker";
import { resolveActivePersonalProviderModelSelections } from "@/utils/provider/personalProviderHelpers";

/**
 * Formats a list of changed sampler settings into a human-readable string.
 */
function formatChangedSettings(locale: string, settings: Array<{ label: string; value: string }>): string {
  return (
    settings.map((setting) => `${setting.label}=\`${setting.value}\``).join(", ") || localizer(locale, "general.none")
  );
}

/**
 * Returns the localized display label for a given sampler setting key.
 */
function getChangedSettingLabel(locale: string, setting: string): string {
  const labelKeys: Record<string, string> = {
    temperature: "commands.model.parameters.sampler_temperature_label",
    top_p: "commands.model.parameters.sampler_top_p_label",
    top_k: "commands.model.parameters.sampler_top_k_label",
    frequency_penalty: "commands.model.parameters.sampler_frequency_penalty_label",
    presence_penalty: "commands.model.parameters.sampler_presence_penalty_label",
    min_p: "commands.model.parameters.sampler_min_p_label",
    max_output_tokens: "commands.model.parameters.sampler_max_output_tokens_label",
    thinking_level: "commands.config.thinking-level.select_label",
  };

  return localizer(locale, labelKeys[setting] ?? "general.unknown");
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("parameters")
    .setDescription(localizer("en-US", "commands.personal.parameters.description"))
    .addNumberOption((option) =>
      option
        .setName("temperature")
        .setDescription(localizer("en-US", "commands.model.parameters.temperature_description"))
        .setMinValue(0)
        .setMaxValue(2)
        .setRequired(false),
    )
    .addNumberOption((option) =>
      option
        .setName("top_p")
        .setDescription(localizer("en-US", "commands.model.parameters.top_p_description"))
        .setMinValue(0)
        .setMaxValue(1)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("top_k")
        .setDescription(localizer("en-US", "commands.model.parameters.top_k_description"))
        .setMinValue(0)
        .setMaxValue(256)
        .setRequired(false),
    )
    .addNumberOption((option) =>
      option
        .setName("frequency_penalty")
        .setDescription(localizer("en-US", "commands.model.parameters.frequency_penalty_description"))
        .setMinValue(-2)
        .setMaxValue(2)
        .setRequired(false),
    )
    .addNumberOption((option) =>
      option
        .setName("presence_penalty")
        .setDescription(localizer("en-US", "commands.model.parameters.presence_penalty_description"))
        .setMinValue(-2)
        .setMaxValue(2)
        .setRequired(false),
    )
    .addNumberOption((option) =>
      option
        .setName("min_p")
        .setDescription(localizer("en-US", "commands.model.parameters.min_p_description"))
        .setMinValue(0)
        .setMaxValue(1)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("max_output_tokens")
        .setDescription(localizer("en-US", "commands.model.parameters.max_output_tokens_description"))
        .setMinValue(1)
        .setMaxValue(131072)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("thinking_level")
        .setDescription(localizer("en-US", "commands.model.parameters.thinking_level_description"))
        .setRequired(false)
        .addChoices(
          ...THINKING_LEVEL_VALUES.map((value) => ({
            name: localizer("en-US", `commands.config.thinking-level.choice_${value}`),
            value,
          })),
        ),
    );

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
    // Validate thinking_level before showing the picker, to surface errors immediately
    const nextThinkingLevel = interaction.options.getString("thinking_level");
    if (nextThinkingLevel && !isThinkingLevelValue(nextThinkingLevel)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.operation_failed_title",
        descriptionKey: "commands.config.thinking-level.invalid_value_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Require at least one sampler value before showing the picker
    const nextMaxOutputTokens = interaction.options.getInteger("max_output_tokens");
    const hasAnyChange =
      interaction.options.getNumber("temperature") !== null ||
      interaction.options.getNumber("top_p") !== null ||
      interaction.options.getInteger("top_k") !== null ||
      interaction.options.getNumber("frequency_penalty") !== null ||
      interaction.options.getNumber("presence_penalty") !== null ||
      interaction.options.getNumber("min_p") !== null ||
      nextMaxOutputTokens !== null ||
      nextThinkingLevel !== null;

    if (!hasAnyChange) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.parameters.no_changes_title",
        descriptionKey: "commands.model.parameters.no_changes_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Load all saved personal text providers and present the picker.
    //    UserSavedProviderConfigRow shares the `provider` field that promptForSavedProvider reads,
    //    so the cast is safe, because the picker only uses that field to build button labels.
    const savedProviders = await loadUserSavedProvidersForCapability(userData.user_id, "text");
    const providerSelection = await promptForSavedProvider(
      interaction,
      locale,
      savedProviders as unknown as SavedProviderConfigRow[],
      {
        descriptionKey: "commands.model.parameters.picker_description",
        currentSelections: await resolveActivePersonalProviderModelSelections(savedProviders, "text"),
      },
    );
    if (!providerSelection) return;

    const selectedProvider = providerSelection.provider;
    const responseInteraction = providerSelection.interaction;

    const replyWithResult = async (options: Parameters<typeof replyInfoEmbed>[2]) => {
      if (providerSelection.pickerInteraction) {
        // A button was clicked, so update the picker message in-place (this also acknowledges the button)
        await (responseInteraction as ButtonInteraction).update({
          embeds: [createStandardEmbed(locale, options)],
          components: [],
        });
      } else {
        // Single provider was auto-selected: no picker message exists, reply normally
        await replyInfoEmbed(interaction, locale, { ...options, flags: MessageFlags.Ephemeral });
      }
    };

    // Retrieve the saved config from the already-loaded list (avoids a second DB round-trip)
    const savedConfig = savedProviders.find((p) => p.provider.toLowerCase() === selectedProvider) ?? null;
    if (!savedConfig) {
      await replyWithResult({
        titleKey: "general.errors.operation_failed_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const nextConfig = {
      ...savedConfig,
      llm_temperature: interaction.options.getNumber("temperature") ?? savedConfig.llm_temperature,
      llm_top_p: interaction.options.getNumber("top_p") ?? savedConfig.llm_top_p,
      llm_top_k: interaction.options.getInteger("top_k") ?? savedConfig.llm_top_k,
      llm_frequency_penalty: interaction.options.getNumber("frequency_penalty") ?? savedConfig.llm_frequency_penalty,
      llm_presence_penalty: interaction.options.getNumber("presence_penalty") ?? savedConfig.llm_presence_penalty,
      llm_min_p: interaction.options.getNumber("min_p") ?? savedConfig.llm_min_p,
      llm_max_output_tokens: nextMaxOutputTokens ?? savedConfig.llm_max_output_tokens ?? null,
      thinking_level: (nextThinkingLevel as ThinkingLevelValue | null) ?? savedConfig.thinking_level,
    };

    const changedSettings: Array<{ label: string; value: string }> = [];
    if (interaction.options.getNumber("temperature") !== null) {
      changedSettings.push({
        label: getChangedSettingLabel(locale, "temperature"),
        value: String(nextConfig.llm_temperature),
      });
    }
    if (interaction.options.getNumber("top_p") !== null) {
      changedSettings.push({ label: getChangedSettingLabel(locale, "top_p"), value: String(nextConfig.llm_top_p) });
    }
    if (interaction.options.getInteger("top_k") !== null) {
      changedSettings.push({ label: getChangedSettingLabel(locale, "top_k"), value: String(nextConfig.llm_top_k) });
    }
    if (interaction.options.getNumber("frequency_penalty") !== null) {
      changedSettings.push({
        label: getChangedSettingLabel(locale, "frequency_penalty"),
        value: String(nextConfig.llm_frequency_penalty),
      });
    }
    if (interaction.options.getNumber("presence_penalty") !== null) {
      changedSettings.push({
        label: getChangedSettingLabel(locale, "presence_penalty"),
        value: String(nextConfig.llm_presence_penalty),
      });
    }
    if (interaction.options.getNumber("min_p") !== null) {
      changedSettings.push({ label: getChangedSettingLabel(locale, "min_p"), value: String(nextConfig.llm_min_p) });
    }
    if (nextMaxOutputTokens !== null) {
      changedSettings.push({
        label: getChangedSettingLabel(locale, "max_output_tokens"),
        value: String(nextConfig.llm_max_output_tokens),
      });
    }
    if (nextThinkingLevel) {
      changedSettings.push({
        label: getChangedSettingLabel(locale, "thinking_level"),
        value: nextConfig.thinking_level,
      });
    }

    const writeOk = await llmProviderRepo.upsertUserSavedProviderConfig(userData.user_id, nextConfig);
    if (!writeOk) {
      await replyWithResult({
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await replyWithResult({
      titleKey: "commands.personal.parameters.success_title",
      descriptionKey: "commands.personal.parameters.success_description",
      descriptionVars: {
        provider: getProviderDisplayName(savedConfig.provider),
        settings: formatChangedSettings(locale, changedSettings),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal parameters",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal parameters", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
