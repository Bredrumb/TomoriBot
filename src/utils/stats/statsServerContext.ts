import type { ChatInputCommandInteraction } from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode } from "@/utils/misc/logger";

export type StatsStateLoader = (serverDiscId: string) => Promise<{ server_id?: number } | null>;

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
