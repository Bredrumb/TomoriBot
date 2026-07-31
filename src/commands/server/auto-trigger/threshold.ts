import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";

export const MIN_THRESHOLD = 0; // 0 means always-reply in configured auto-chat channels
export const MIN_RANDOM_THRESHOLD = 1;
export const MAX_THRESHOLD = 100; // The absolute maximum value allowed

export interface ThresholdValidationResult {
  isValid: boolean;
  isAlwaysReplyMode: boolean;
  isRangeMode: boolean;
}

/**
 * Validates a threshold+max pair and identifies which auto-chat mode applies.
 * (0,0) = always-reply; (n,n) = fixed; (min,max where max>min) = random range.
 */
export function validateThresholdInput(threshold: number, maxThreshold: number): ThresholdValidationResult {
  const isAlwaysReplyMode = threshold === MIN_THRESHOLD && maxThreshold === MIN_THRESHOLD;
  const isRangeMode = threshold >= MIN_RANDOM_THRESHOLD && maxThreshold > threshold;
  const isValid =
    isAlwaysReplyMode ||
    (threshold >= MIN_RANDOM_THRESHOLD &&
      threshold <= MAX_THRESHOLD &&
      maxThreshold >= threshold &&
      maxThreshold <= MAX_THRESHOLD);
  return { isValid, isAlwaysReplyMode, isRangeMode };
}

export function rollAutochatTarget(minThreshold: number, maxThreshold: number): number {
  if (minThreshold <= 0 || maxThreshold <= 0) {
    return 0;
  }

  if (minThreshold === maxThreshold) {
    return minThreshold;
  }

  return Math.floor(Math.random() * (maxThreshold - minThreshold + 1)) + minThreshold;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("threshold")
    .setDescription(localizer("en-US", "commands.server.auto-trigger.threshold.description"))
    .addIntegerOption((option) =>
      option
        .setName("threshold")
        .setDescription(localizer("en-US", "commands.server.auto-trigger.threshold.threshold_description"))
        .setMinValue(MIN_THRESHOLD)
        .setMaxValue(MAX_THRESHOLD)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("max")
        .setDescription(localizer("en-US", "commands.server.auto-trigger.threshold.max_description"))
        .setMinValue(MIN_THRESHOLD)
        .setMaxValue(MAX_THRESHOLD)
        .setRequired(false),
    );

/**

Configures shared auto-chat range settings for Tomori.
0 enables always-reply in configured auto-chat channels.
Positive values use a shared fixed or random range.
@param _client - Discord client instance
@param interaction - Command interaction
@param userData - User data from database
@param locale - Locale of the interaction */ export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // Defer the interaction before async work to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const threshold = interaction.options.getInteger("threshold", true);
    const maxThreshold = interaction.options.getInteger("max") ?? threshold;
    const { isValid, isAlwaysReplyMode, isRangeMode } = validateThresholdInput(threshold, maxThreshold);

    if (!isValid) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.auto-trigger.threshold.invalid_range_title",
        descriptionKey: "commands.server.auto-trigger.threshold.invalid_range_specific_description",
        descriptionVars: {
          always: MIN_THRESHOLD.toString(),
          min: MIN_RANDOM_THRESHOLD.toString(),
          max: MAX_THRESHOLD.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    // Load the Tomori state for this server - let helper functions manage interaction state
    const tomoriState = await getCachedTomoriState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const nextTarget = isAlwaysReplyMode ? 0 : rollAutochatTarget(threshold, maxThreshold);

    // Guard: invariants for a setup persona (mirrors prior inline-SQL assumptions).
    if (tomoriState.server_id === undefined || tomoriState.persona_id === undefined) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Update config and reset the shared cycle atomically via repository.
    const updatedRuntime = await configRepository.setAutoChatThreshold(
      tomoriState.server_id,
      tomoriState.persona_id,
      threshold,
      maxThreshold,
      nextTarget,
    );

    if (!updatedRuntime) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "server auto-trigger threshold",
          threshold,
          maxThreshold,
          nextTarget,
          targetTables: ["server_auto_trigger_configs", "persona_autoch_runtime_state"],
        },
      };
      await log.error(
        "Failed to update auto-chat range config/state",
        new Error("configRepository.setAutoChatThreshold returned null"),
        context,
      );

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild.id);

    await replyInfoEmbed(interaction, locale, {
      titleKey: isAlwaysReplyMode
        ? "commands.server.auto-trigger.threshold.success_always_title"
        : isRangeMode
          ? "commands.server.auto-trigger.threshold.success_range_title"
          : "commands.server.auto-trigger.threshold.success_title",
      descriptionKey: isAlwaysReplyMode
        ? "commands.server.auto-trigger.threshold.success_always_description"
        : isRangeMode
          ? "commands.server.auto-trigger.threshold.success_range_description"
          : "commands.server.auto-trigger.threshold.success_description",
      descriptionVars: {
        threshold: threshold.toString(),
        min: threshold.toString(),
        max: maxThreshold.toString(),
      },
      color: isAlwaysReplyMode ? ColorCode.WARN : ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(interaction.guild.id))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server auto-trigger threshold",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /server auto-trigger threshold command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
