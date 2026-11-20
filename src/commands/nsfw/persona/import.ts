import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { addPersonaImportOptions, importPersona } from "@/commands/persona/import";
import type { UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  addPersonaImportOptions(
    subcommand.setName("import").setDescription(localizer("en-US", "commands.nsfw.persona.import.description")),
  );

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await importPersona(client, interaction, userData, locale, { allowNsfw: true });
}
