import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  buildServerTabs,
  buildSubtitle,
  DEFAULT_TIMEFRAME,
  renderStatsDashboard,
  resolveWindowFrom,
  type Timeframe,
  TIMEFRAME_VALUES,
} from "@/utils/stats/statsDashboard";

/**
 * Configures the /stats server subcommand: server-wide usage stats for the chosen
 * timeframe (leaderboard, models, tools, expression, generations).
 * @param subcommand - The subcommand builder
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("server")
    .setDescription(localizer("en-US", "commands.stats.server.description"))
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.server.timeframe_description"))
        .setRequired(false)
        .addChoices(
          ...TIMEFRAME_VALUES.map((value) => ({ name: localizer("en-US", `commands.choices.${value}`), value })),
        ),
    );

/**
 * Renders the server-wide stats dashboard.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Acknowledge publicly before DB reads (dashboard is a public message).
  await interaction.deferReply();

  const guild = interaction.guild;
  if (!guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    // Resolve the internal server id; stat reads key on it, not the snowflake.
    const tomoriState = await getCachedTomoriState(guild.id);
    const serverId = tomoriState?.server_id;
    if (!serverId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Resolve timeframe → window floor and build the dashboard.
    const timeframe = (interaction.options.getString("timeframe") ?? DEFAULT_TIMEFRAME) as Timeframe;
    const from = resolveWindowFrom(timeframe);
    const subtitle = buildSubtitle(locale, timeframe);

    const tabs = await buildServerTabs({
      locale,
      serverId,
      guildId: guild.id,
      timeframe,
      from,
      subtitle: `${guild.name} • ${subtitle}`,
    });

    // Pin the server's icon to the dashboard's top-right corner (null when the guild
    // has no custom icon — the card simply renders without one).
    const iconUrl = guild.iconURL({ extension: "png", size: 256 }) ?? undefined;
    await renderStatsDashboard(interaction, interaction.user.id, locale, tabs, iconUrl);
  } catch (error) {
    await log.error(`Error executing /stats server for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats server" },
    });
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
