import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import {
  configurePanelPageOption,
  PANEL_PAGE_OPTION_NAME,
  respondWithPanelPages,
} from "@/utils/discord/autocomplete/panelPageAutocomplete";
import {
  listPersonalConfigPageDestinations,
  openPersonalConfigPanel,
} from "@/utils/discord/interactions/personalConfigRoutes";
import { localizer } from "@/utils/text/localizer";
import {
  autocompleteManagedIdentity,
  parseIdentityOption,
} from "@/utils/discord/interactions/managedIdentityPanelRoutes";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("config")
    .setDescription(localizer("en-US", "commands.personal.config.description"))
    .addStringOption((option) =>
      configurePanelPageOption(option, localizer("en-US", "commands.personal.config.page_description")),
    )
    .addStringOption((option) =>
      option
        .setName("identity")
        .setDescription(localizer("en-US", "commands.personal.config.identity_description"))
        .setAutocomplete(true),
    );

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.options.getFocused(true).name !== PANEL_PAGE_OPTION_NAME) {
    await autocompleteManagedIdentity(interaction);
    return;
  }
  await respondWithPanelPages(
    interaction,
    listPersonalConfigPageDestinations(interaction.locale, {
      guildId: interaction.guildId,
      identityMode: Boolean(interaction.options.getString("identity")),
    }),
  );
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rawIdentity = interaction.options.getString("identity");
  const identityId = parseIdentityOption(rawIdentity);
  await openPersonalConfigPanel(interaction, locale, {
    identityId: rawIdentity && !identityId ? -1 : (identityId ?? undefined),
    requestedPage: interaction.options.getString(PANEL_PAGE_OPTION_NAME),
  });
}
