import type { AutocompleteInteraction, ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import {
  configurePanelPageOption,
  PANEL_PAGE_OPTION_NAME,
  respondWithPanelPages,
} from "@/utils/discord/autocomplete/panelPageAutocomplete";
import { executeStatusCommand, listStatusPageDestinations } from "@/utils/metrics/status/command";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("status")
    .setDescription(localizer("en-US", "commands.status.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.status.page_description")),
    );

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  await respondWithPanelPages(interaction, listStatusPageDestinations(interaction.locale));
}

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await executeStatusCommand(
    client,
    interaction,
    userData,
    locale,
    undefined,
    interaction.options.getString(PANEL_PAGE_OPTION_NAME),
  );
}
