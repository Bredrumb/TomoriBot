import type { AutocompleteInteraction, ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { configurePanelPageOption, PANEL_PAGE_OPTION_NAME } from "@/utils/discord/autocomplete/panelPageAutocomplete";
import { handleWorkspacePersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { autocompleteConfigPage, executeConfigCommand } from "@/utils/discord/interactions/configRoutes";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("config")
    .setDescription(localizer("en-US", "commands.config.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.config.page_description")),
    )
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.config.persona_description"))
        .setAutocomplete(true),
    );

export async function autocomplete(client: Client, interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.options.getFocused(true).name === PANEL_PAGE_OPTION_NAME) {
    await autocompleteConfigPage(interaction);
    return;
  }
  await handleWorkspacePersonaAutocomplete(client, interaction);
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await executeConfigCommand(interaction, locale, {
    page: interaction.options.getString(PANEL_PAGE_OPTION_NAME),
    persona: interaction.options.getString("persona"),
  });
}
