import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  buildPersonalTabs,
  buildSubtitle,
  renderStatsDashboard,
  resolveWindowFrom,
  type StatsScope,
  type Timeframe,
  TIMEFRAME_VALUES,
} from "./statsShared";

/**
 * Configures the /stats personal subcommand: the invoking user's own usage stats,
 * with a required timeframe and a scope toggle (this server vs. across all servers).
 * @param subcommand - The subcommand builder
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("personal")
    .setDescription(localizer("en-US", "commands.stats.personal.description"))
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.personal.timeframe_description"))
        .setRequired(true)
        .addChoices(
          ...TIMEFRAME_VALUES.map((value) => ({ name: localizer("en-US", `commands.choices.${value}`), value })),
        ),
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.stats.personal.scope_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.choices.this_server"), value: "this_server" },
          { name: localizer("en-US", "commands.choices.global"), value: "global" },
        ),
    );

/**
 * Renders the personal stats dashboard for the invoking user.
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
  // 1. Acknowledge publicly before DB reads (dashboard is a public message).
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
    // 2. Resolve the internal server id; stat reads key on it, not the snowflake.
    const tomoriState = await getCachedTomoriState(guild.id);
    const serverId = tomoriState?.server_id;
    const userId = userData.user_id;
    if (!serverId || !userId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 3. Resolve options: timeframe → window floor, scope → optional server filter.
    const timeframe = interaction.options.getString("timeframe", true) as Timeframe;
    const scope = interaction.options.getString("scope", true) as StatsScope;
    const from = resolveWindowFrom(timeframe);
    const scopeServerId = scope === "this_server" ? serverId : undefined;
    const subtitle = buildSubtitle(
      locale,
      timeframe,
      scope === "this_server" ? "commands.choices.this_server" : "commands.choices.global",
    );

    // 4. Build the tabs and render the invoker-controlled tabbed dashboard.
    const tabs = await buildPersonalTabs({
      locale,
      userId,
      userDiscId: userData.user_disc_id,
      serverId,
      guildId: guild.id,
      from,
      scopeServerId,
      subtitle,
      timezoneOffset: userData.timezone_offset ?? null,
    });

    await renderStatsDashboard(interaction, interaction.user.id, locale, tabs);
  } catch (error) {
    await log.error(`Error executing /stats personal for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats personal" },
    });
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
