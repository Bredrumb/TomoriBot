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
import { listMemoriesPageDestinations, openMemoriesPanel } from "@/utils/discord/interactions/memoriesRoutes";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("memories")
    .setDescription(localizer("en-US", "commands.memories.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.memories.page_description")),
    );

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  await respondWithPanelPages(interaction, listMemoriesPageDestinations(interaction.locale));
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await openMemoriesPanel(interaction, locale, interaction.options.getString(PANEL_PAGE_OPTION_NAME));
}
