import { CONDITIONING_ACTION_LOCALE_KEYS, CONDITIONING_FOOTER_LOCALE_KEYS } from "@/utils/conditioning/conditioning";
import type {
  BaseGuildTextChannel,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Message,
  SlashCommandSubcommandBuilder,
  TextChannel,
} from "discord.js";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { createUserImpersonationWebhook } from "@/utils/chat/webhookIdentity";
import {
  isGuildMessageCommandChannel,
  resolveGuildWebhookTargetChannel,
  resolveGuildWebhookThreadId,
} from "@/utils/discord/guildMessageChannel";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { ConditioningType, TomoriState, UserRow } from "@/types/db/schema";
import { personaRepository } from "@/utils/db/repositories";
import { getCachedWhitelistStatus } from "@/utils/cache/channelWhitelistCache";
import { getCachedPersonalSpotlightStatus } from "@/utils/cache/personalSpotlightCache";
import { getCachedActiveBlocksForUser } from "@/utils/cache/personaUserBlockCache";
import { tomoriChat } from "@/events/messageCreate/tomoriChat";
import {
  CONDITIONING_REASON_MAX_LENGTH,
  normalizeConditioningReason,
  type ConditioningActionKey,
} from "@/utils/conditioning/conditioning";
import { conditioningMemoryRepository } from "@/utils/db/repositories/ConditioningMemoryRepository";
import { filterPersonasForTrigger, isPersonaAllowedForTrigger } from "@/utils/persona/personaAccess";
import { handlePersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { resolveFallbackPersona } from "@/utils/discord/personaTurnDetectionResolver";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import {
  buildConditioningIgnoredEmbed,
  buildConditioningInteractionEmbed,
} from "@/utils/conditioning/conditioningEmbed";
import { buildConditioningInteractionEvent } from "@/utils/conditioning/conditioningInteractionContext";

interface ConditioningCommandOptions {
  /** Returns extra interpolation context for the embed description localizer. */
  getExtraContext?: (interaction: ChatInputCommandInteraction) => Record<string, string>;
}

const INVOKER_WEBHOOK_REASON = "TomoriBot reward or punish interaction";

function resolveInvokerWebhookTarget(
  interaction: ChatInputCommandInteraction,
): TextChannel | BaseGuildTextChannel | null {
  if (!isGuildMessageCommandChannel(interaction.channel)) return null;
  const target = resolveGuildWebhookTargetChannel(interaction.channel);
  const botMember = target?.guild.members.me;
  return target && botMember && target.permissionsFor(botMember).has(PermissionFlagsBits.ManageWebhooks)
    ? target
    : null;
}

async function sendAsInvoker(
  client: Client,
  interaction: ChatInputCommandInteraction,
  target: TextChannel | BaseGuildTextChannel,
  embed: EmbedBuilder,
): Promise<Message> {
  const threadId = isGuildMessageCommandChannel(interaction.channel)
    ? resolveGuildWebhookThreadId(interaction.channel)
    : undefined;
  const { webhook } = await createUserImpersonationWebhook(client, target, interaction.user.id, INVOKER_WEBHOOK_REASON);
  try {
    return await webhook.send({
      embeds: [embed],
      flags: MessageFlags.SuppressNotifications,
      allowedMentions: { parse: [] },
      ...(threadId ? { threadId } : {}),
    });
  } finally {
    await webhook.delete(INVOKER_WEBHOOK_REASON).catch((error: unknown) => {
      log.warn("Failed to delete temporary reward or punish webhook", error);
    });
  }
}

/**
 * Posts the action embed under the invoker's name and avatar, or as the interaction reply where the
 * channel cannot host a webhook, and returns the message that anchors the persona's chat turn.
 */
async function deliverConditioningEmbed(
  client: Client,
  interaction: ChatInputCommandInteraction,
  locale: string,
  embed: EmbedBuilder,
): Promise<Message> {
  const target = resolveInvokerWebhookTarget(interaction);
  if (!target) {
    await interaction.reply({ embeds: [embed], flags: MessageFlags.SuppressNotifications });
    return (await interaction.fetchReply()) as Message;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let message: Message;
  try {
    message = await sendAsInvoker(client, interaction, target, embed);
  } catch (error) {
    log.warn(`Falling back to the interaction reply for a reward or punish embed in ${interaction.channelId}`, error);
    // Discord turns the first follow-up after a pending defer into that ephemeral response, so the
    // defer is removed first to keep the fallback embed public.
    await interaction.deleteReply().catch(() => undefined);
    return (await interaction.followUp({ embeds: [embed], flags: MessageFlags.SuppressNotifications })) as Message;
  }

  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.conditioning.shared.sent_title",
    descriptionKey: "commands.conditioning.shared.sent_description",
    color: ColorCode.SUCCESS,
  });
  return message;
}

export function createConditioningInteractionCommand(
  type: ConditioningType,
  actionKey: ConditioningActionKey,
  cmdOptions?: ConditioningCommandOptions,
) {
  const commandKeys = CONDITIONING_ACTION_LOCALE_KEYS[actionKey];

  const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
    subcommand
      .setName(actionKey)
      .setDescription(localizer("en-US", commandKeys.description))
      .addStringOption((option) =>
        option
          .setName("persona")
          .setDescription(localizer("en-US", commandKeys.persona_description))
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addUserOption((option) =>
        option.setName("user").setDescription(localizer("en-US", commandKeys.user_description)).setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription(localizer("en-US", commandKeys.reason_description))
          .setMaxLength(CONDITIONING_REASON_MAX_LENGTH)
          .setRequired(false),
      );

  async function execute(
    client: Client,
    interaction: ChatInputCommandInteraction,
    userData: UserRow,
    locale: string,
  ): Promise<void> {
    if (!interaction.channel || !("messages" in interaction.channel) || !interaction.guild) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const targetUser = interaction.options.getUser("user");
    if (targetUser) {
      if (interaction.options.getString("persona") !== null) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "commands.conditioning.shared.target_conflict_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const targetMember = interaction.options.getMember("user");
      const targetName =
        targetMember && "displayName" in targetMember
          ? targetMember.displayName
          : (targetMember?.nick ?? targetUser.displayName);
      await deliverConditioningEmbed(
        client,
        interaction,
        locale,
        buildConditioningInteractionEmbed({
          locale,
          type,
          actionKey,
          actorLabel: `<@${interaction.user.id}>`,
          targetName,
          targetMention: `<@${targetUser.id}>`,
          reasonText: normalizeConditioningReason(interaction.options.getString("reason")),
          extraContext: cmdOptions?.getExtraContext?.(interaction) ?? {},
          footerKey: "commands.conditioning.shared.user_footer",
        }),
      );
      return;
    }

    const botMember = interaction.guild.members.me;
    if (!botMember) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const commandChannel = interaction.channel;
    const guildChannel = interaction.guild.channels.cache.get(interaction.channel.id) ?? interaction.channel;
    if (!("permissionsFor" in guildChannel)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const permissions = guildChannel.permissionsFor(botMember);
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions?.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.channel_missing_permissions_title",
        descriptionKey: "general.errors.channel_missing_permissions_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const tomoriState = await personaRepository.loadState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const invokingMember = interaction.guild.members.cache.get(interaction.user.id);
    const memberRoleDiscIds = invokingMember?.roles.cache.map((role) => role.id);
    const isThread =
      "isThread" in guildChannel && typeof guildChannel.isThread === "function" && guildChannel.isThread();
    const parentChannelId = isThread && "parent" in guildChannel ? guildChannel.parent?.id : undefined;
    const whitelistStatus = await getCachedWhitelistStatus(
      interaction.guild.id,
      interaction.channel.id,
      memberRoleDiscIds,
      parentChannelId,
    );
    const personalSpotlightStatus = userData.user_id
      ? await getCachedPersonalSpotlightStatus(
          tomoriState.server_id,
          userData.user_id,
          parentChannelId ?? interaction.channel.id,
        )
      : null;
    const availablePersonas = filterPersonasForTrigger(allPersonas, whitelistStatus, personalSpotlightStatus);

    if (availablePersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.conditioning.shared.persona_access_blocked_title",
        descriptionKey: "commands.conditioning.shared.persona_access_blocked_description",
        color: ColorCode.WARN,
      });
      return;
    }

    let selectedPersona: TomoriState;

    const personaOptionValue = interaction.options.getString("persona");
    if (personaOptionValue !== null) {
      const personaId = Number.parseInt(personaOptionValue, 10);
      if (Number.isNaN(personaId)) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      const foundPersona = availablePersonas.find((p) => p.persona_id === personaId);
      if (!foundPersona) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
        });
        return;
      }
      selectedPersona = foundPersona;
    } else {
      const fallbackPersona = await resolveFallbackPersona({
        availablePersonas,
        allPersonas,
        tomoriState,
        effectiveChannelId: parentChannelId ?? interaction.channel.id,
        personalAutoTriggerPersonaId: personalSpotlightStatus?.autoTriggerPersonaId ?? null,
        clientUserId: client.user?.id,
        fetchRecentMessages: async () => {
          const fetched = await commandChannel.messages.fetch({
            limit: normalizeMessageFetchLimit(tomoriState.config.message_fetch_limit),
          });
          return [...fetched.values()].reverse();
        },
      });

      if (!fallbackPersona) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.conditioning.shared.persona_access_blocked_title",
          descriptionKey: "commands.conditioning.shared.persona_access_blocked_description",
          color: ColorCode.WARN,
        });
        return;
      }
      selectedPersona = fallbackPersona;
    }

    const activeBlocks = await getCachedActiveBlocksForUser(tomoriState.server_id, interaction.user.id);
    const personaBlock = activeBlocks.find((block) => block.persona_id === selectedPersona.persona_id);
    if (personaBlock) {
      await interaction.reply({
        embeds: [
          buildConditioningIgnoredEmbed({
            locale,
            type,
            actionKey,
            targetName: selectedPersona.persona_nickname,
            expiresAt: personaBlock.expires_at,
          }),
        ],
        flags: MessageFlags.SuppressNotifications,
      });
      return;
    }

    if (!userData.user_id) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.operation_failed_title",
        descriptionKey: "general.errors.operation_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    try {
      const botName =
        selectedPersona.persona_nickname ?? tomoriState.persona_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori";
      const reasonText = normalizeConditioningReason(interaction.options.getString("reason"));
      const extraContext = cmdOptions?.getExtraContext?.(interaction) ?? {};
      const actionTextValue = extraContext.action_text?.trim() ?? null;
      const conditioningEvent = await conditioningMemoryRepository.recordEvent({
        serverId: tomoriState.server_id,
        personaLineageId: selectedPersona.persona_lineage_id ?? 0,
        conditioningType: type,
        actionKey,
        userId: userData.user_id,
        reason: reasonText,
        actionText: actionTextValue,
      });

      const interactionEmbed = buildConditioningInteractionEmbed({
        locale,
        type,
        actionKey,
        actorLabel: `<@${interaction.user.id}>`,
        targetName: botName,
        reasonText,
        extraContext,
        footerKey: conditioningEvent ? CONDITIONING_FOOTER_LOCALE_KEYS[type] : null,
      });

      const interactionMessage = await deliverConditioningEmbed(client, interaction, locale, interactionEmbed);

      if (!whitelistStatus.isTriggerAllowed) {
        log.info(
          `${type} ${actionKey} interaction completed without chat response because channel ${interaction.channel.id} is blocked by whitelist policy (${whitelistStatus.blockReason ?? "unknown"})`,
        );
        return;
      }

      if (!isPersonaAllowedForTrigger(whitelistStatus, personalSpotlightStatus, selectedPersona.persona_id)) {
        log.info(
          `${type} ${actionKey} interaction completed without chat response because persona ${selectedPersona.persona_id} is blocked by persona access rules in ${interaction.channel.id}`,
        );
        return;
      }

      log.info(
        `${type} ${actionKey} triggered by ${interaction.user.id} in channel ${interaction.channel.id} for message ${interactionMessage.id}`,
      );

      await tomoriChat({
        client,
        message: interactionMessage,
        isFromQueue: false,
        isManuallyTriggered: true,
        selectedPersonaId: selectedPersona.persona_id,
        conditioningInteraction: { actorType: "user", type, action: actionKey },
        injectedContextItems: [
          buildConditioningInteractionEvent({
            actorName: `<@${interaction.user.id}>`,
            targetName: botName,
            action: actionKey,
            reason: reasonText,
            food: actionTextValue ?? undefined,
            messageId: interactionMessage.id,
          }),
        ],
        textQuotaSource: "user",
        textQuotaTriggerKey: interaction.id,
        textQuotaUserDiscId: interaction.user.id,
        manualTriggerInvoker: {
          userDiscId: interaction.user.id,
          username: interaction.user.username,
          locale,
          member: interaction.member as import("discord.js").GuildMember | null,
        },
      });
    } catch (error) {
      await log.error(`Error in ${type} ${actionKey} command`, error, {
        errorType: `${type}_${actionKey}_command_error`,
        metadata: {
          userId: interaction.user.id,
          guildId: interaction.guild.id,
          channelId: interaction.channel?.id,
        },
      });

      try {
        const errorOptions = {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        };
        // editReply would overwrite the public action embed when delivery fell back to the reply.
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            embeds: [createStandardEmbed(locale, errorOptions)],
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await replyInfoEmbed(interaction, locale, errorOptions);
        }
      } catch (followUpError) {
        await log.error(`Failed to send error follow-up for ${type} ${actionKey} command`, followUpError, {
          errorType: `${type}_${actionKey}_command_error_followup`,
          metadata: {
            userId: interaction.user.id,
            guildId: interaction.guild.id,
          },
        });
      }
    }
  }

  return { configureSubcommand, execute, autocomplete: handlePersonaAutocomplete };
}
