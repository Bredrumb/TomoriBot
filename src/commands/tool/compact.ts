import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { ChannelType } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";
import { executeCompactCommand } from "@/utils/compaction/compactOrchestrator";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("compact")
    .setDescription(localizer("en-US", "commands.tool.compact.description"))
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription(localizer("en-US", "commands.tool.compact.type_description"))
        .addChoices(
          { name: localizer("en-US", "commands.tool.compact.modal.type_choice_conversation"), value: "conversation" },
          { name: localizer("en-US", "commands.tool.compact.modal.type_choice_roleplay"), value: "roleplay" },
        )
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.tool.compact.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("thread")
        .setDescription(localizer("en-US", "commands.tool.compact.thread_description"))
        .setRequired(false),
    );

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await executeCompactCommand(client, interaction, userData, locale);
}
