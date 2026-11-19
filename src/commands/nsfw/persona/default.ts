import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { addPresetTargetTypeOption, applyPresetDefault } from "@/commands/persona/default";
import type { UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  addPresetTargetTypeOption(
    subcommand.setName("default").setDescription(localizer("en-US", "commands.nsfw.persona.default.description")),
  );

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await applyPresetDefault(client, interaction, userData, locale, { nsfw: true });
}
