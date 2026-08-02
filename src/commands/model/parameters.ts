import type { ButtonInteraction, ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { THINKING_LEVEL_VALUES, type ThinkingLevelValue, isThinkingLevelValue } from "@/constants/thinkingLevels";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { configRepository, llmProviderRepo } from "@/utils/db/repositories";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { promptForSavedProvider } from "@/utils/discord/providerPicker";
import { localizer } from "@/utils/text/localizer";
import { buildModelParametersSamplerPatch } from "@/utils/discord/modelParametersConfigMapping";

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
    .setDescription(localizer("en-US", "commands.model.parameters.description"))
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

  try {
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

    const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "text");
    const providerSelection = await promptForSavedProvider(interaction, locale, savedProviders, {
      descriptionKey: "commands.model.parameters.picker_description",
      currentSelections: [
        {
          model: tomoriState.llm.llm_codename,
          provider: tomoriState.llm.llm_provider,
        },
      ],
    });
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
        // Single provider was auto-selected, so no picker message exists, reply normally
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

    const samplerPatch = buildModelParametersSamplerPatch(
      {
        temperature: interaction.options.getNumber("temperature"),
        top_p: interaction.options.getNumber("top_p"),
        top_k: interaction.options.getInteger("top_k"),
        frequency_penalty: interaction.options.getNumber("frequency_penalty"),
        presence_penalty: interaction.options.getNumber("presence_penalty"),
        min_p: interaction.options.getNumber("min_p"),
        max_output_tokens: nextMaxOutputTokens,
        thinking_level: nextThinkingLevel as ThinkingLevelValue | null,
      },
      savedConfig,
    );
    const nextConfig = { ...savedConfig, ...samplerPatch };

    const changedSettings: Array<{ label: string; value: string }> = [];
    if (interaction.options.getNumber("temperature") !== null) {
      changedSettings.push({
        label: getChangedSettingLabel(locale, "temperature"),
        value: String(nextConfig.llm_temperature),
      });
    }
    if (interaction.options.getNumber("top_p") !== null) {
      changedSettings.push({
        label: getChangedSettingLabel(locale, "top_p"),
        value: String(nextConfig.llm_top_p),
      });
    }
    if (interaction.options.getInteger("top_k") !== null) {
      changedSettings.push({
        label: getChangedSettingLabel(locale, "top_k"),
        value: String(nextConfig.llm_top_k),
      });
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
      changedSettings.push({
        label: getChangedSettingLabel(locale, "min_p"),
        value: String(nextConfig.llm_min_p),
      });
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

    const upserted = await llmProviderRepo.upsertSavedProviderConfig(tomoriState.server_id, nextConfig, {
      serverDiscId: serverId,
    });
    if (!upserted) {
      await replyWithResult({
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Mirror sampler values into split config tables when this is the currently active provider,
    //    so in-flight requests immediately reflect the new settings without a config switch.
    if (selectedProvider === tomoriState.llm.llm_provider.toLowerCase()) {
      await Promise.all([
        configRepository.updateModelConfig(tomoriState.server_id, {
          llm_temperature: nextConfig.llm_temperature ?? 1.0,
          thinking_level: nextConfig.thinking_level,
        }),
        configRepository.updateChatConfig(tomoriState.server_id, {
          llm_top_p: nextConfig.llm_top_p ?? 0.95,
          llm_top_k: nextConfig.llm_top_k ?? 0,
          llm_frequency_penalty: nextConfig.llm_frequency_penalty ?? 0.0,
          llm_presence_penalty: nextConfig.llm_presence_penalty ?? 0.0,
          llm_min_p: nextConfig.llm_min_p ?? 0.05,
          llm_max_output_tokens: nextConfig.llm_max_output_tokens ?? null,
        }),
      ]);
    }

    await replyWithResult({
      titleKey: "commands.model.parameters.success_title",
      descriptionKey: "commands.model.parameters.success_description",
      descriptionVars: {
        provider: getProviderDisplayName(selectedProvider),
        settings: formatChangedSettings(locale, changedSettings),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config parameters",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Error executing /config parameters for user ${userData.user_disc_id}`, error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
