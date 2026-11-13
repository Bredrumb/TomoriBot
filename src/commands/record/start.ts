import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { executeRecordingCommand } from "@/modules/conversation-recording/discord/routes";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("start")
    .setDescription(localizer("en-US", "commands.record.start.description"))
    .addStringOption((option) =>
      option
        .setName("duration")
        .setDescription(localizer("en-US", "commands.record.start.duration_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.record.start.24h_option"), value: "24h" },
          { name: localizer("en-US", "commands.record.start.7d_option"), value: "7d" },
          { name: localizer("en-US", "commands.record.start.14d_option"), value: "14d" },
          { name: localizer("en-US", "commands.record.start.30d_option"), value: "30d" },
          { name: localizer("en-US", "commands.record.start.unlimited_option"), value: "unlimited" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("context")
        .setDescription(localizer("en-US", "commands.record.start.context_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.record.start.own_option"), value: "own" },
          { name: localizer("en-US", "commands.record.start.surrounding_option"), value: "surrounding" },
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await executeRecordingCommand(interaction, userData, locale, "start", {
    context: interaction.options.getString("context"),
    duration: interaction.options.getString("duration"),
  });
}
