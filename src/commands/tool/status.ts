import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";
import { executeStatusCommand } from "@/utils/metrics/statusCommandMetrics";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("status")
    .setDescription(localizer("en-US", "commands.tool.status.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.tool.status.scope_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.tool.status.scope_choice_server_model"), value: "server_model" },
          { name: localizer("en-US", "commands.tool.status.scope_choice_server_config"), value: "server_config" },
          { name: localizer("en-US", "commands.tool.status.scope_choice_server_channels"), value: "server_channels" },
          { name: localizer("en-US", "commands.tool.status.scope_choice_personal"), value: "personal" },
          { name: localizer("en-US", "commands.tool.status.scope_choice_persona"), value: "persona" },
        ),
    );

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await executeStatusCommand(client, interaction, userData, locale);
}
