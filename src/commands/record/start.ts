import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { executeRecordingCommand } from "@/modules/conversation-recording/discord/routes";
import { RECORDING_DURATIONS } from "@/modules/conversation-recording/db/types";
import { recordingContextKeys, recordingDurationKeys } from "@/modules/conversation-recording/discord/catalog";
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
          ...RECORDING_DURATIONS.map((value) => ({ name: localizer("en-US", recordingDurationKeys[value]), value })),
        ),
    )
    .addStringOption((option) =>
      option
        .setName("context")
        .setDescription(localizer("en-US", "commands.record.start.context_description"))
        .setRequired(true)
        .addChoices(
          ...(["own", "surrounding"] as const).map((value) => ({
            name: localizer("en-US", recordingContextKeys[value]),
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
  await executeRecordingCommand(interaction, userData, locale, "start", {
    context: interaction.options.getString("context"),
    duration: interaction.options.getString("duration"),
  });
}
