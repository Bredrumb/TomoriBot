import type { AutocompleteInteraction, ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import {
  configurePanelPageOption,
  PANEL_PAGE_OPTION_NAME,
  respondWithPanelPages,
} from "@/utils/discord/autocomplete/panelPageAutocomplete";
import { handleWorkspacePersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { executeStatusCommand, listStatusPageDestinations } from "@/utils/metrics/status/command";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("status")
    .setDescription(localizer("en-US", "commands.status.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.status.page_description")),
    )
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.status.persona_description"))
        .setAutocomplete(true),
    );

export async function autocomplete(client: Client, interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.options.getFocused(true).name === PANEL_PAGE_OPTION_NAME) {
    await respondWithPanelPages(interaction, listStatusPageDestinations(interaction.locale));
    return;
  }
  await handleWorkspacePersonaAutocomplete(client, interaction);
}

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await executeStatusCommand(client, interaction, userData, locale, undefined, {
    page: interaction.options.getString(PANEL_PAGE_OPTION_NAME),
    persona: interaction.options.getString("persona"),
  });
}
