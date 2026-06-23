import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { buildNoticeContainer, replyInfoEmbed } from "@/utils/discord/ui/interactionCore";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  buildPersonaTabs,
  buildSubtitle,
  DEFAULT_TIMEFRAME,
  renderStatsDashboard,
  resolveWindowFrom,
  type Timeframe,
  TIMEFRAME_VALUES,
} from "@/utils/stats/statsDashboard";

/**
 * Configures the /stats persona subcommand: pick a persona, then view that
 * persona's usage stats on this server for the chosen timeframe.
 * @param subcommand - The subcommand builder
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("persona")
    .setDescription(localizer("en-US", "commands.stats.persona.description"))
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.persona.timeframe_description"))
        .setRequired(false)
        .addChoices(
          ...TIMEFRAME_VALUES.map((value) => ({ name: localizer("en-US", `commands.choices.${value}`), value })),
        ),
    );

/**
 * Opens the persona picker, then renders the selected persona's stats dashboard.
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
    // 1. Resolve the internal server id and the server's persona roster.
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

    const personas = await getCachedAllPersonas(guild.id);
    if (personas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.stats.persona.no_personas_title",
        descriptionKey: "commands.stats.persona.no_personas_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const timeframe = (interaction.options.getString("timeframe") ?? DEFAULT_TIMEFRAME) as Timeframe;
    const from = resolveWindowFrom(timeframe);

    // 2. Show the persona picker (ephemeral), preserving the selected button so the
    //    public dashboard can be sent from it.
    const result = await replyPaginatedPersonaChoicesV2(interaction, locale, {
      personas,
      titleKey: "commands.stats.persona.picker_title",
      descriptionKey: "commands.stats.persona.picker_description",
      color: ColorCode.INFO,
      preserveSelectedInteraction: true,
    });

    // 3. Picker dismissed/timed out/dead — nothing to render.
    if (!result.success || result.selectedIndex === undefined || !result.interaction) return;

    const selected = personas[result.selectedIndex];
    if (!selected) return;
    const lineageId = selected.persona_lineage_id ?? 0;

    // 4. Collapse the ephemeral picker to a compact confirmation so the bulky
    //    persona card disappears before the public dashboard appears.
    await interaction.editReply({
      components: buildNoticeContainer({
        locale,
        color: ColorCode.SUCCESS,
        titleKey: "commands.stats.persona.chosen_title",
        titleVars: { name: selected.persona_nickname },
      }),
      flags: MessageFlags.IsComponentsV2,
    });

    // 5. Render the dashboard publicly from the selected button interaction.
    const button = result.interaction as ButtonInteraction;
    await button.deferReply();

    const subtitle = buildSubtitle(locale, timeframe);
    const tabs = await buildPersonaTabs({
      locale,
      serverId,
      guildId: guild.id,
      lineageId,
      personaName: selected.persona_nickname,
      timeframe,
      from,
      subtitle: `${selected.persona_nickname} • ${subtitle}`,
    });

    await renderStatsDashboard(button, interaction.user.id, locale, tabs);
  } catch (error) {
    await log.error(`Error executing /stats persona for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats persona" },
    });
  }
}
