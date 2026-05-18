import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import {
  formatStopStringForDisplay,
  MAX_STOP_STRING_LENGTH,
  MAX_STOP_STRINGS_PER_SERVER,
  mergeConfiguredStopStrings,
  parseCommaSeparatedStopStrings,
} from "@/utils/provider/stopStringConfig";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("add")
    .setDescription(localizer("en-US", "commands.model.stop-strings.add.description"))
    .addStringOption((option) =>
      option
        .setName("strings")
        .setDescription(localizer("en-US", "commands.model.stop-strings.add.strings_description"))
        .setRequired(true)
        .setMaxLength(1000),
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

  const guildKey = interaction.guild?.id ?? interaction.user.id;
  const tomoriState = await getCachedTomoriState(guildKey);
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
    const rawInput = interaction.options.getString("strings", true);
    const parsedStops = parseCommaSeparatedStopStrings(rawInput);
    const tooLongStop = parsedStops.find((stop) => stop.length > MAX_STOP_STRING_LENGTH);

    if (parsedStops.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.stop-strings.add.invalid_title",
        descriptionKey: "commands.model.stop-strings.add.invalid_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (tooLongStop) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.stop-strings.add.too_long_title",
        descriptionKey: "commands.model.stop-strings.add.too_long_description",
        descriptionVars: {
          max_length: MAX_STOP_STRING_LENGTH.toString(),
          stop_string: formatStopStringForDisplay(tooLongStop).slice(0, 80),
        },
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existingStops = tomoriState.config.llm_stop_strings ?? [];
    const mergedStops = mergeConfiguredStopStrings(existingStops, parsedStops);
    if (mergedStops.length > MAX_STOP_STRINGS_PER_SERVER) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.stop-strings.add.too_many_title",
        descriptionKey: "commands.model.stop-strings.add.too_many_description",
        descriptionVars: {
          max_count: MAX_STOP_STRINGS_PER_SERVER.toString(),
          current_count: existingStops.length.toString(),
          added_count: parsedStops.length.toString(),
        },
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const addedStops = mergedStops.filter((stop) => !existingStops.includes(stop));
    if (addedStops.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.stop-strings.add.no_changes_title",
        descriptionKey: "commands.model.stop-strings.add.no_changes_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = await configRepository.updateChatConfig(tomoriState.server_id, {
      llm_stop_strings: mergedStops,
    });

    if (!updated) {
      const context: ErrorContext = {
        userId: userData.user_id,
        serverId: tomoriState.server_id,
        tomoriId: tomoriState.persona_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config stop-strings add",
        },
      };
      await log.error("Failed to update llm_stop_strings config", new Error("Database update failed"), context);
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    invalidateTomoriStateCache(guildKey);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.model.stop-strings.add.success_title",
      descriptionKey: "commands.model.stop-strings.add.success_description",
      descriptionVars: {
        added_count: addedStops.length.toString(),
        stop_strings: formatStopStringList(addedStops, locale),
      },
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      tomoriId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config stop-strings add",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Error executing /config stop-strings add for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

function formatStopStringList(stops: readonly string[], locale: string): string {
  const visibleStops = stops.slice(0, 8).map((stop) => `\`${formatStopStringForDisplay(stop)}\``);
  if (stops.length > visibleStops.length) {
    visibleStops.push(
      localizer(locale, "commands.model.stop-strings.add.more_added", {
        count: stops.length - visibleStops.length,
      }),
    );
  }
  return visibleStops.join(", ");
}
