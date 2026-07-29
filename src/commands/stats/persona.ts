import {
  AttachmentBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/interactionCore";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  runPersonaPickerWorkflow,
} from "@/utils/discord/ui/personaWorkflow";
import {
  isLocalPersonaAvatarPath,
  loadStoredPersonaAvatarBuffer,
  resolvePersonaAvatarPublicUrl,
} from "@/utils/storage/avatarStorage";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  buildPersonaTabs,
  buildSubtitle,
  DEFAULT_TIMEFRAME,
  renderStatsDashboardWithReply,
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Resolve the internal server id and the server's persona roster.
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

    await runPersonaPickerWorkflow(interaction, locale, {
      personas,
      titleKey: "commands.stats.persona.picker_title",
      descriptionKey: "commands.stats.persona.picker_description",
      color: ColorCode.INFO,
      async onSelected(selection) {
        const selected = selection.persona;
        const publicReply = await selection.beginSeparatePublicReply(
          buildPersonaWorkflowNotice({
            locale,
            color: ColorCode.SUCCESS,
            titleKey: "commands.stats.persona.chosen_title",
            titleVars: { name: selected.persona_nickname },
          }),
        );

        try {
          const lineageId = selected.persona_lineage_id ?? 0;
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

          let personaIconUrl: string | undefined;
          let personaIconFile: AttachmentBuilder | undefined;
          if (selected.is_alter) {
            const publicUrl = resolvePersonaAvatarPublicUrl(selected.webhook_avatar_url);
            if (publicUrl) {
              personaIconUrl = publicUrl;
            } else if (selected.webhook_avatar_url && isLocalPersonaAvatarPath(selected.webhook_avatar_url)) {
              const buffer = await loadStoredPersonaAvatarBuffer(selected.webhook_avatar_url);
              if (buffer) {
                const name = "stats_persona_icon.png";
                personaIconFile = new AttachmentBuilder(buffer, { name });
                personaIconUrl = `attachment://${name}`;
              }
            }
          } else {
            personaIconUrl = guild.members.me?.displayAvatarURL({ extension: "png", size: 256 }) ?? undefined;
          }
          await renderStatsDashboardWithReply(
            (payload) => publicReply.reply(payload),
            selection.phaseId,
            interaction.user.id,
            locale,
            tabs,
            personaIconUrl,
            personaIconFile,
          );
        } catch (error) {
          await selection.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              color: ColorCode.ERROR,
              titleKey: "general.errors.unknown_error_title",
              descriptionKey: "general.errors.unknown_error_description",
            }),
          );
          throw error;
        }
        return completePersonaWorkflow();
      },
    });
  } catch (error) {
    await log.error(`Error executing /stats persona for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats persona" },
    });
  }
}
