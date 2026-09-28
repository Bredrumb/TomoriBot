import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { createNonce } from "@/utils/discord/panelRouteTokens";
import { showRoutedRawModal } from "@/utils/discord/ui/modals";
import { buildLanguageModal } from "@/utils/discord/ui/personalConfigModals";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("language").setDescription(localizer("en-US", "commands.personal.language.description"));

/**
 * Opens the language picker on its own, which is the same modal the Language button in
 * `/personal config` shows.
 *
 * The modal is raised directly from the command rather than through a panel, so the interaction is
 * never deferred: Discord rejects a modal on an acknowledged interaction. Its submit carries the
 * standalone route, which replies with a receipt instead of repainting a panel that is not there.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await showRoutedRawModal(
    interaction,
    buildLanguageModal(locale, createNonce(), userData.language_pref ?? "en-US", true),
  );
}
