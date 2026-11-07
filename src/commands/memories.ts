import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import {
  configurePanelPageOption,
  PANEL_PAGE_OPTION_NAME,
  respondWithPanelPages,
} from "@/utils/discord/autocomplete/panelPageAutocomplete";
import { handleWorkspacePersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { listMemoriesPageDestinations, openMemoriesPanel } from "@/utils/discord/interactions/memoriesRoutes";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("memories")
    .setDescription(localizer("en-US", "commands.memories.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.memories.page_description")),
    )
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.memories.persona_description"))
        .setAutocomplete(true),
    );

export async function autocomplete(client: Client, interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.options.getFocused(true).name === PANEL_PAGE_OPTION_NAME) {
    await respondWithPanelPages(interaction, listMemoriesPageDestinations(interaction.locale));
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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await openMemoriesPanel(interaction, locale, {
    page: interaction.options.getString(PANEL_PAGE_OPTION_NAME),
    persona: interaction.options.getString("persona"),
  });
}
