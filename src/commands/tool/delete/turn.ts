import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import type { ChatInputCommandInteraction, Client, Message } from "discord.js";
import { BaseGuildTextChannel, MessageFlags, type SlashCommandSubcommandBuilder } from "discord.js";
import { tomoriChat } from "@/events/messageCreate/tomoriChat";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedMainPersona } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  PersonaWorkflowUpdateError,
  runPersonaPickerWorkflow,
} from "@/utils/discord/ui/personaWorkflow";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { findLastPersonaTurnBlock } from "@/utils/discord/personaTurnDetection";
import { deletePersonaTurnMessages, tryAcquirePersonaTurnDeletion } from "@/utils/discord/personaTurnDeletion";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

interface DeleteTurnStatus {
  titleKey: string;
  descriptionKey: string;
  descriptionVars?: Record<string, string | number | boolean>;
  color: ColorCode;
}

/**
 * Configures the 'turn' subcommand under the 'delete' group.
 */
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

/**
 * Executes the `/tool delete turn` command.
 *
 * Walks the recent channel history, finds the last contiguous block of
 * messages sent by a single known persona (via webhook username or bot
 * non-webhook messages), deletes those messages, and optionally re-triggers
 * that persona with `tomoriChat`. Matrix bridge relay webhooks are treated
 * as user messages and stop block detection without being deleted.
 *
 * Interaction patterns used:
 * - The slash interaction is deferred before state/persona loads.
 * - With `select_persona`, the persona workflow edits that reply, then
 *   update-defers the selected button and keeps the anchor message in place.
 *
 */
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

  // Both execution branches perform asynchronous state/persona loads. Acknowledge
  // before those reads so the optional persona picker can safely edit this reply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tomoriState = await getCachedMainPersona(guildId);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // Permission check: requires ManageGuild OR use in a designated RP channel.
  //    When the command is run inside a thread, channelId is the thread's own ID:
  //    not the parent channel's ID. Check both so threads inherit their parent's RP status.
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

  // Check bot's MANAGE_MESSAGES permission: determines whether direct
  //      deletion methods (bulkDelete, msg.delete) will work. The command
  //      proceeds regardless, but uses webhook-based deletion as fallback.
  const botMember = interaction.guild.members.me;
  let botHasManageMessages = false;
  if (botMember && "permissionsFor" in channel) {
    botHasManageMessages = Boolean(channel.permissionsFor(botMember)?.has("ManageMessages"));
  }

  const releaseDeletion = tryAcquirePersonaTurnDeletion(channelId);
  if (!releaseDeletion) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.delete.turn.already_running_title",
      descriptionKey: "commands.tool.delete.turn.already_running_description",
      color: ColorCode.WARN,
    });
    return;
  }

  let personaWorkflowStarted = false;

  try {
    const allPersonas = await getCachedAllPersonas(guildId);

    const performDeletion = async (
      initialPersona: TomoriState | null,
      updateStatus: (status: DeleteTurnStatus) => Promise<void>,
    ): Promise<void> => {
      // Target persona tracking: null means auto-detect from message history
      let resolvedPersona = initialPersona;

      const fetchLimit = normalizeMessageFetchLimit(tomoriState.config.message_fetch_limit);
      const fetched = await channel.messages.fetch({ limit: fetchLimit });

      // Discord returns messages newest-first; reverse to chronological order
      // so index 0 = oldest and the last index = newest
      const messages: Message[] = [...fetched.values()].reverse();

      await Promise.all(messages.map(verifyMessageWebhook));
      const detectedTurn = findLastPersonaTurnBlock({
        messages,
        allPersonas,
        clientUserId: client.user?.id,
        targetPersonaId: resolvedPersona?.persona_id,
      });
      const blockMessages = detectedTurn.blockMessages;
      resolvedPersona = detectedTurn.resolvedPersona;

      if (blockMessages.length === 0) {
        await updateStatus({
          titleKey: "commands.tool.delete.turn.no_persona_found_title",
          descriptionKey: "commands.tool.delete.turn.no_persona_found_description",
          color: ColorCode.WARN,
        });
        return;
      }

      const displayName = resolvedPersona?.persona_nickname ?? detectedTurn.targetPersonaKey ?? "Unknown";
      const totalCount = blockMessages.length;

      await updateStatus({
        titleKey: "commands.tool.delete.turn.deleting_title",
        descriptionKey: "commands.tool.delete.turn.deleting_description",
        descriptionVars: {
          count: totalCount,
          persona_name: displayName,
        },
        color: ColorCode.INFO,
      });

      const { deletedCount, failedCount } = await deletePersonaTurnMessages(
        channel,
        blockMessages,
        botHasManageMessages,
      );

      const embedValues: Record<string, string> = {
        persona_name: displayName,
        count: String(deletedCount),
        deleted_count: String(deletedCount),
        total_count: String(totalCount),
      };

      let titleKey: string;
      let descKey: string;
      let embedColor: ColorCode;

      if (deletedCount === 0 && failedCount > 0) {
        titleKey = "commands.tool.delete.turn.bot_no_delete_title";
        descKey = !botHasManageMessages
          ? "commands.tool.delete.turn.bot_no_delete_description"
          : "commands.tool.delete.turn.bot_failed_delete_description";
        embedColor = ColorCode.ERROR;
      } else if (deletedCount < totalCount) {
        titleKey = "commands.tool.delete.turn.partial_title";
        descKey = !botHasManageMessages
          ? "commands.tool.delete.turn.partial_no_manage_messages_description"
          : "commands.tool.delete.turn.partial_description";
        embedColor = ColorCode.WARN;
      } else if (regenerate && resolvedPersona) {
        titleKey = "commands.tool.delete.turn.success_title";
        descKey = "commands.tool.delete.turn.success_regenerate_description";
        embedColor = ColorCode.SUCCESS;
      } else {
        titleKey = "commands.tool.delete.turn.success_title";
        descKey = "commands.tool.delete.turn.success_description";
        embedColor = ColorCode.SUCCESS;
      }

      await updateStatus({
        titleKey,
        descriptionKey: descKey,
        descriptionVars: embedValues,
        color: embedColor,
      });

      log.info(
        `[deleteTurn] Deleted ${deletedCount}/${totalCount} messages (${failedCount} failed) from persona="${displayName}" in channelId=${channelId}`,
      );

      if (regenerate && resolvedPersona && deletedCount === totalCount) {
        try {
          const remaining = await channel.messages.fetch({ limit: 1 });
          let lastMessage: Message | undefined = remaining.first();

          // If the channel has no messages left after deletion, seed a braille
          // blank placeholder so tomoriChat has a valid Message to operate on
          if (!lastMessage && channel instanceof BaseGuildTextChannel) {
            lastMessage = await channel.send("\u2800");
          }

          if (lastMessage) {
            // Fire-and-forget, so do not await so the command interaction resolves
            void tomoriChat({
              client,
              message: lastMessage,
              isFromQueue: false,
              isManuallyTriggered: true,
              forceReason: false,
              isStopResponse: false,
              selectedPersonaId: resolvedPersona.persona_id,
              isPersonaJob: false,
              isUserImpersonation: false,
              textQuotaSource: "user",
              textQuotaTriggerKey: interaction.id,
              textQuotaUserDiscId: interaction.user.id,
              suppressSelfReply: true,
              manualTriggerInvoker: {
                userDiscId: interaction.user.id,
                username: interaction.user.username,
                locale,
                member: interaction.member as import("discord.js").GuildMember | null,
              },
            });
          }
        } catch (regenError) {
          log.warn(`[deleteTurn] Failed to set up regenerate for persona="${displayName}"`, regenError);
        }
      }
    };

    if (selectPersona) {
      if (allPersonas.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.tool.delete.turn.no_persona_found_title",
          descriptionKey: "commands.tool.delete.turn.no_persona_found_description",
          color: ColorCode.WARN,
        });
        return;
      }

      personaWorkflowStarted = true;
      await runPersonaPickerWorkflow(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
        onSelected: async (selection) => {
          const { message } = await selection.beginInPlaceWork();
          const selectedPersona = selection.persona;

          if (!selectedPersona.persona_id) {
            await message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.invalid_option_title",
                descriptionKey: "general.errors.invalid_option_description",
                color: ColorCode.ERROR,
              }),
            );
            return completePersonaWorkflow();
          }

          try {
            await performDeletion(selectedPersona, async (status) => {
              await message.replace(buildPersonaWorkflowNotice({ locale, ...status }));
            });
          } catch (error) {
            if (error instanceof PersonaWorkflowUpdateError) throw error;
            log.error("[deleteTurn] Unexpected error during selected turn deletion", error, {
              errorType: "DeleteTurnError",
              metadata: {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                personaId: selectedPersona.persona_id,
              },
            });
            await message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.unknown_error_title",
                descriptionKey: "general.errors.unknown_error_description",
                color: ColorCode.ERROR,
              }),
            );
          }

          return completePersonaWorkflow();
        },
      });
      return;
    }

    await performDeletion(null, async (status) => {
      await replyInfoEmbed(interaction, locale, status);
    });
  } catch (error) {
    log.error("[deleteTurn] Unexpected error during turn deletion", error, {
      errorType: "DeleteTurnError",
      metadata: {
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
    });

    if (personaWorkflowStarted) return;

    try {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    } catch {
      // Interaction may have already expired, so nothing we can do
    }
  } finally {
    // Always release the channel lock regardless of outcome
    releaseDeletion();
  }
}
