import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { configRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { resolveDeliberateToolContextTurns } from "@/utils/tools/deliberateToolMode";

const MIN_TURNS = 0;
const MAX_TURNS = 10;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("deliberate-tool-context")
    .setDescription(localizer("en-US", "commands.server.deliberate-tool-context.description"))
    .addIntegerOption((option) =>
      option
        .setName("turns")
        .setDescription(localizer("en-US", "commands.server.deliberate-tool-context.turns_description"))
        .setMinValue(MIN_TURNS)
        .setMaxValue(MAX_TURNS)
        .setRequired(true),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const guildId = interaction.guild?.id ?? "";
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const turns = interaction.options.getInteger("turns", true);
    const tomoriState = await getCachedTomoriState(guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 1. No-op short circuit if the value is already set explicitly
    const currentTurns = resolveDeliberateToolContextTurns(tomoriState.config.deliberate_tool_context_turns);
    if (turns === currentTurns && tomoriState.config.deliberate_tool_context_turns !== null) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.deliberate-tool-context.already_set_title",
        descriptionKey: "commands.server.deliberate-tool-context.already_set_description",
        descriptionVars: { turns: turns.toString() },
        color: ColorCode.WARN,
      });
      return;
    }

    // 2. Update via per-domain repository (server_trigger_behavior_configs)
    const updated = await configRepository.updateTriggerBehaviorConfig(tomoriState.server_id, {
      deliberate_tool_context_turns: turns,
    });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "server deliberate-tool-context",
          turns,
        },
      };
      await log.error(
        "Failed to update deliberate_tool_context_turns config",
        new Error("Database update returned no rows"),
        context,
      );

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(guildId);

    await replyInfoEmbed(interaction, locale, {
      titleKey:
        turns > 0
          ? "commands.server.deliberate-tool-context.updated_title"
          : "commands.server.deliberate-tool-context.disabled_title",
      descriptionKey:
        turns > 0
          ? "commands.server.deliberate-tool-context.updated_description"
          : "commands.server.deliberate-tool-context.disabled_description",
      descriptionVars: { turns: turns.toString() },
      color: turns > 0 ? ColorCode.SUCCESS : ColorCode.WARN,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(guildId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server deliberate-tool-context",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /server deliberate-tool-context command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
