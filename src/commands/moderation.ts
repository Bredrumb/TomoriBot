import type { AutocompleteInteraction, ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import {
  configurePanelPageOption,
  PANEL_PAGE_OPTION_NAME,
  respondWithPanelPages,
} from "@/utils/discord/autocomplete/panelPageAutocomplete";
import {
  executeModerationCommand,
  listModerationPageDestinations,
} from "@/utils/discord/interactions/moderationRoutes";
import { localizer } from "@/utils/text/localizer";

export const guildOnly = true;
export const managerOnly = true;

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("moderation")
    .setDescription(localizer("en-US", "commands.moderation.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.moderation.page_description")),
    );

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  await respondWithPanelPages(interaction, listModerationPageDestinations(interaction.locale));
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await executeModerationCommand(interaction, locale, interaction.options.getString(PANEL_PAGE_OPTION_NAME));
}
