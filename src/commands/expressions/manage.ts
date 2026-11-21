import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import {
  configurePanelPageOption,
  PANEL_PAGE_OPTION_NAME,
  respondWithPanelPages,
} from "@/utils/discord/autocomplete/panelPageAutocomplete";
import {
  executeExpressionsManageCommand,
  listExpressionsPageDestinations,
} from "@/utils/discord/interactions/expressionsRoutes";
import { localizer } from "@/utils/text/localizer";

export const guildOnly = true;
export const managerOnly = true;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("manage")
    .setDescription(localizer("en-US", "commands.expressions.manage.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.expressions.manage.page_description")),
    );

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  await respondWithPanelPages(interaction, listExpressionsPageDestinations(interaction.locale));
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await executeExpressionsManageCommand(interaction, locale, interaction.options.getString(PANEL_PAGE_OPTION_NAME));
}
