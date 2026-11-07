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
  panelPageNotFoundReceipt,
  resolvePanelPage,
  respondWithPanelPages,
} from "@/utils/discord/autocomplete/panelPageAutocomplete";
import { listHelpPageDestinations } from "@/utils/discord/helpCatalog";
import { deliverGuardedPanel } from "@/utils/discord/interactions/panelController";
import { buildHelpDashboardPayload } from "@/utils/discord/ui/helpDashboard";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("help")
    .setDescription(localizer("en-US", "commands.help.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.help.page_description")),
    );

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  await respondWithPanelPages(interaction, listHelpPageDestinations(interaction.locale));
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  const requestedPage = interaction.options.getString(PANEL_PAGE_OPTION_NAME);
  const destination = requestedPage ? resolvePanelPage(listHelpPageDestinations(locale), requestedPage) : null;
  const payload = buildHelpDashboardPayload(
    locale,
    destination?.category,
    destination?.page,
    undefined,
    requestedPage && !destination ? panelPageNotFoundReceipt(locale) : undefined,
  );
  await deliverGuardedPanel(interaction, payload, {
    method: "reply",
    locale,
    flags: payload.flags | MessageFlags.Ephemeral,
  });
}
