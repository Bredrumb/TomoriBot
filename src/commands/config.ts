import type { AutocompleteInteraction, ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { configurePanelPageOption, PANEL_PAGE_OPTION_NAME } from "@/utils/discord/autocomplete/panelPageAutocomplete";
import { autocompleteConfigPage, executeConfigCommand } from "@/utils/discord/interactions/configRoutes";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("config")
    .setDescription(localizer("en-US", "commands.config.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.config.page_description")),
    );

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  await autocompleteConfigPage(interaction);
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await executeConfigCommand(interaction, locale, interaction.options.getString(PANEL_PAGE_OPTION_NAME));
}
