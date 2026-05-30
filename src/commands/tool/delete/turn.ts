import type { ButtonInteraction, ChatInputCommandInteraction, Client, GuildMember } from "discord.js";
import { EmbedBuilder, MessageFlags, type SlashCommandSubcommandBuilder } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedMainPersona } from "@/utils/cache/tomoriStateCache";
import { deletePersonaTurnAndMaybeRegenerate } from "@/utils/discord/deletePersonaTurn";
import { replyInfoEmbed, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/interactionHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("turn")
    .setDescription(localizer("en-US", "commands.tool.delete.turn.description"))
    .addBooleanOption((option) =>
      option
        .setName("regenerate")
        .setDescription(localizer("en-US", "commands.tool.delete.turn.regenerate_description"))
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("select_persona")
        .setDescription(localizer("en-US", "commands.tool.delete.turn.select_persona_description"))
        .setRequired(false),
    );

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const guildId = interaction.guild.id;
  const channelId = interaction.channelId;
  const channel = interaction.channel;
  const regenerate = interaction.options.getBoolean("regenerate") ?? false;
  const selectPersona = interaction.options.getBoolean("select_persona") ?? false;

  const tomoriState = await getCachedMainPersona(guildId);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const hasManageGuild = interaction.memberPermissions?.has("ManageGuild") ?? false;
  const parentChannelId = channel.isThread() ? channel.parentId : null;
  const isRpChannel =
    tomoriState.config.rp_channel_ids.includes(channelId) ||
    (parentChannelId !== null && tomoriState.config.rp_channel_ids.includes(parentChannelId));

  if (!hasManageGuild && !isRpChannel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.delete.turn.no_permission_title",
      descriptionKey: "commands.tool.delete.turn.no_permission_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  let activeInteraction: ChatInputCommandInteraction | ButtonInteraction = interaction;

  try {
    const allPersonas = await getCachedAllPersonas(guildId);
    let selectedPersona: TomoriState | null = null;

    if (selectPersona) {
      if (allPersonas.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.tool.delete.turn.no_persona_found_title",
          descriptionKey: "commands.tool.delete.turn.no_persona_found_description",
          color: ColorCode.WARN,
        });
        return;
      }

      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success || personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      activeInteraction = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
      await activeInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    await activeInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.tool.delete.turn.deleting_title"))
          .setDescription(
            localizer(locale, "commands.tool.delete.turn.deleting_description", {
              count: "?",
              persona_name: selectedPersona?.tomori_nickname ?? "Tomori",
            }),
          )
          .setColor(ColorCode.INFO),
      ],
    });

    const result = await deletePersonaTurnAndMaybeRegenerate({
      client,
      guild: interaction.guild,
      channel,
      tomoriState,
      regenerate,
      locale,
      targetPersonaId: selectedPersona?.tomori_id,
      triggerUserId: interaction.user.id,
      triggerUsername: interaction.user.username,
      triggerMember: interaction.member as GuildMember | null,
      textQuotaTriggerKey: interaction.id,
    });

    if (result.status === "already_running") {
      await activeInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.tool.delete.turn.already_running_title"))
            .setDescription(localizer(locale, "commands.tool.delete.turn.already_running_description"))
            .setColor(ColorCode.WARN),
        ],
      });
      return;
    }

    if (result.status === "no_persona_found" || result.status === "target_message_not_found") {
      await activeInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.tool.delete.turn.no_persona_found_title"))
            .setDescription(localizer(locale, "commands.tool.delete.turn.no_persona_found_description"))
            .setColor(ColorCode.WARN),
        ],
      });
      return;
    }

    const embedValues: Record<string, string> = {
      persona_name: result.displayName,
      count: String(result.deletedCount),
      deleted_count: String(result.deletedCount),
      total_count: String(result.totalCount),
    };

    let titleKey: string;
    let descKey: string;
    let embedColor: ColorCode;

    if (result.status === "failed") {
      titleKey = "commands.tool.delete.turn.bot_no_delete_title";
      descKey = !result.botHasManageMessages
        ? "commands.tool.delete.turn.bot_no_delete_description"
        : "commands.tool.delete.turn.bot_failed_delete_description";
      embedColor = ColorCode.ERROR;
    } else if (result.status === "partial") {
      titleKey = "commands.tool.delete.turn.partial_title";
      descKey = !result.botHasManageMessages
        ? "commands.tool.delete.turn.partial_no_manage_messages_description"
        : "commands.tool.delete.turn.partial_description";
      embedColor = ColorCode.WARN;
    } else if (regenerate && result.resolvedPersona) {
      titleKey = "commands.tool.delete.turn.success_title";
      descKey = "commands.tool.delete.turn.success_regenerate_description";
      embedColor = ColorCode.SUCCESS;
    } else {
      titleKey = "commands.tool.delete.turn.success_title";
      descKey = "commands.tool.delete.turn.success_description";
      embedColor = ColorCode.SUCCESS;
    }

    await activeInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, titleKey))
          .setDescription(localizer(locale, descKey, embedValues))
          .setColor(embedColor),
      ],
    });
  } catch (error) {
    log.error("[deleteTurn] Unexpected error during turn deletion", error, {
      errorType: "DeleteTurnError",
      metadata: {
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
    });

    try {
      await activeInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "general.errors.unexpected_title"))
            .setDescription(localizer(locale, "general.errors.unexpected_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
    } catch {
      // Interaction may have expired.
    }
  }
}
