import type { ChatInputCommandInteraction } from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode } from "@/utils/misc/logger";

/** The cache read the resolver uses. Overridden by tests; production reads the state cache. */
export type StatsStateLoader = (serverDiscId: string) => Promise<{ server_id?: number } | null>;

/**
 * Resolve the internal server id for a guild-scoped command.
 *
 * The stat and audit reads key on the internal `server_id`, never on the Discord snowflake,
 * so a command that skipped this lookup would silently read another scope's rows. A guild
 * with no cached state is not set up yet, so the helper answers with the setup error and
 * returns null rather than leaving the caller to build a dashboard from a partial state.
 */
export async function resolveStatsServerId(
  interaction: ChatInputCommandInteraction,
  locale: string,
  loadState: StatsStateLoader = getCachedTomoriState,
): Promise<number | null> {
  const guildId = interaction.guild?.id;
  if (!guildId) return null;

  const tomoriState = await loadState(guildId);
  const serverId = tomoriState?.server_id;

  if (!serverId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
    });
    return null;
  }

  return serverId;
}
