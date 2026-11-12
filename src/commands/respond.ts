import type { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client, Message } from "discord.js";
import { DiscordAPIError, MessageFlags, PermissionFlagsBits, RESTJSONErrorCodes } from "discord.js";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { handlePersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { sendCooldownDM } from "@/utils/discord/cooldownDM";
import { ColorCode, log } from "@/utils/misc/logger";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { statusNote } from "@/utils/discord/ui/statusTitle";
import { localizer } from "@/utils/text/localizer";
import type { LlmRow, UserRow } from "@/types/db/schema";
import { ASSISTANT_PREFILL_MAX_LENGTH, resolvePrefillBlocker, resolvePrefillMode } from "@/utils/chat/assistantPrefill";
import { tomoriChat } from "@/events/messageCreate/tomoriChat";
import { llmModelRepo, personaRepository } from "@/utils/db/repositories";
import { getCachedWhitelistStatus } from "@/utils/cache/channelWhitelistCache";
import { getCachedPersonalSpotlightStatus } from "@/utils/cache/personalSpotlightCache";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { resolveFallbackPersona } from "@/utils/discord/personaTurnDetectionResolver";
import { filterPersonasForTrigger } from "@/utils/persona/personaAccess";
import { resolveSelectedPersona } from "@/utils/persona/personaOptionValue";
import { CooldownType } from "@/types/db/schema";
import { cooldownRepository } from "@/utils/db/repositories/CooldownRepository";
import { isNoticeEmbedVisible } from "@/utils/discord/toolProgressNotice";

const RESPOND_PROMPT_MAX_LENGTH = 2000;

export const autocomplete = handlePersonaAutocomplete;

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("respond")
    .setDescription(localizer("en-US", "commands.respond.description"))
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.respond.persona_description"))
        .setAutocomplete(true)
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("reasoning")
        .setDescription(localizer("en-US", "commands.respond.reasoning_description"))
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription(localizer("en-US", "commands.respond.prompt_description"))
        .setMaxLength(RESPOND_PROMPT_MAX_LENGTH)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("prefill")
        .setDescription(localizer("en-US", "commands.respond.prefill_description"))
        .setMaxLength(ASSISTANT_PREFILL_MAX_LENGTH)
        .setRequired(false),
    );

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Ensure command is run in a guild text channel - let helper functions manage interaction state
  if (!interaction.channel || !("messages" in interaction.channel)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const isDMChannel = !interaction.guildId;
  const serverDiscId = interaction.guildId ?? interaction.user.id;

  if (!isDMChannel) {
    const botMember = interaction.guild?.members.me;
    if (!botMember || !interaction.guild) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Get the guild channel (we know it exists from check above, but need type narrowing)
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
      !permissions?.has(PermissionFlagsBits.ReadMessageHistory) ||
      // Discord requires Connect to fetch the text history of a voice channel.
      (guildChannel.isVoiceBased() && !permissions?.has(PermissionFlagsBits.Connect))
    ) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.channel_missing_permissions_title",
        descriptionKey: "general.errors.channel_missing_permissions_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.SuppressNotifications });

  const tomoriState = await personaRepository.loadState(serverDiscId);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const invokingMember = interaction.member as import("discord.js").GuildMember | null;

  // Check cooldown (shares cooldown pool with message triggers)
  const cooldownType = tomoriState.config.cooldown_type ?? CooldownType.OFF;
  const cooldownLength = tomoriState.config.cooldown_length ?? 5;

  // Uses whitelist-aware version to respect per-channel cooldown overrides
  const cooldownResult = await cooldownRepository.checkMessageTriggerCooldownWithWhitelist(
    serverDiscId,
    interaction.user.id,
    interaction.channel.id,
    cooldownType,
    invokingMember,
  );

  if (cooldownResult.isOnCooldown) {
    if (cooldownResult.blockedByWhitelist) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.message_cooldown_title",
        descriptionKey: "commands.respond.channel_not_whitelisted",
        color: ColorCode.WARN,
      });
      return;
    }

    const footerKey = cooldownRepository.getCooldownTypeFooterKey(cooldownResult.cooldownType);
    await sendCooldownDM(
      interaction.user,
      locale,
      "general.message_cooldown_title",
      "commands.respond.cooldown_active",
      {
        seconds: cooldownResult.remainingSeconds.toString(),
        botName: tomoriState.persona_nickname,
      },
      footerKey,
      interaction,
      MessageFlags.Ephemeral,
    );
    if (!interaction.replied) await interaction.deleteReply();
    return;
  }

  const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
  const parentChannelId = interaction.channel.isThread() ? interaction.channel.parent?.id : undefined;
  const whitelistStatus = await getCachedWhitelistStatus(
    serverDiscId,
    interaction.channel.id,
    invokingMember?.roles.cache.map((role) => role.id),
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
      titleKey: "general.message_cooldown_title",
      descriptionKey: "commands.respond.persona_access_blocked",
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const personaOption = interaction.options.getString("persona");
  const requestedPersona = personaOption === null ? null : resolveSelectedPersona(availablePersonas, personaOption);
  if (personaOption !== null && !requestedPersona) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.invalid_option_title",
      descriptionKey: "commands.respond.invalid_persona_description",
      color: ColorCode.WARN,
    });
    return;
  }

  const fetchedMessages = await interaction.channel.messages
    .fetch({ limit: normalizeMessageFetchLimit(tomoriState.config.message_fetch_limit) })
    .catch(async (error: unknown) => {
      // Channel overwrites can change after the cached permission check.
      if (
        !(error instanceof DiscordAPIError) ||
        (error.code !== RESTJSONErrorCodes.MissingAccess && error.code !== RESTJSONErrorCodes.MissingPermissions)
      ) {
        throw error;
      }
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.channel_missing_permissions_title",
        descriptionKey: "general.errors.channel_missing_permissions_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return null;
    });
  if (!fetchedMessages) return;
  const messages = [...fetchedMessages.values()].reverse();
  const latestMessage = fetchedMessages.first();

  if (!latestMessage) {
    log.warn(`No messages found in channel ${interaction.channel.id} for manual respond command.`);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.respond.no_messages_title",
      descriptionKey: "commands.respond.no_messages_description",
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedPersona =
    requestedPersona ??
    (await resolveFallbackPersona({
      availablePersonas,
      allPersonas,
      tomoriState,
      effectiveChannelId: parentChannelId ?? interaction.channel.id,
      personalAutoTriggerPersonaId: personalSpotlightStatus?.autoTriggerPersonaId ?? null,
      clientUserId: client.user?.id,
      fetchRecentMessages: async () => messages,
    }));

  if (!selectedPersona) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const hideEmbed = !isNoticeEmbedVisible(tomoriState.config, "respond_embed");
  const manualPrompt = interaction.options.getString("prompt")?.trim() || undefined;
  const manualPrefill = interaction.options.getString("prefill")?.trim() || undefined;
  let forceReason: boolean | undefined;
  let llmOverrideCodename: string | undefined;
  let reasoningModel: LlmRow | undefined;

  if (interaction.options.getBoolean("reasoning")) {
    const currentProvider = tomoriState.llm.llm_provider;
    const smartestModel = await llmModelRepo.loadSmartestModel(currentProvider);

    if (!smartestModel) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.respond.no_smart_model_title",
        descriptionKey: "commands.respond.no_smart_model_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    forceReason = true;
    llmOverrideCodename = smartestModel.llm_codename;
    reasoningModel = smartestModel;
  }

  try {
    // Fallback attempts can resolve differently, but a mismatch only costs an inaccurate hint.
    const prefillBecomesInstruction =
      manualPrefill !== undefined &&
      resolvePrefillMode(
        "manual",
        resolvePrefillBlocker(
          { llm: reasoningModel ?? selectedPersona.llm, config: selectedPersona.config },
          forceReason,
        ),
      ) === "instruction";
    const successDescription = localizer(locale, "commands.respond.success_description");
    const successEmbedOptions = {
      titleKey: "commands.respond.success_title",
      description: prefillBecomesInstruction
        ? `${successDescription}\n${statusNote("warning", localizer(locale, "commands.respond.prefill_instruction_notice"))}`
        : successDescription,
      color: ColorCode.SUCCESS,
      configHint: !hideEmbed,
    };
    if (hideEmbed) {
      await replyInfoEmbed(interaction, locale, successEmbedOptions);
    } else {
      // Discord keeps a deferred reply's visibility on its first follow-up, so delete the private defer before posting publicly.
      await interaction.deleteReply();
      await interaction.followUp({
        embeds: [createStandardEmbed(locale, successEmbedOptions)],
        flags: MessageFlags.SuppressNotifications,
      });
    }

    // tomoriChat injects its "[Continue your last message]" prompt when a manual
    // trigger's tail message is the bot's own, so replaying the latest message keeps
    // /respond on that path instead of a plain chat turn.
    const passportMessage = latestMessage;

    log.info(
      `Manual respond command triggered by ${interaction.user.id} in channel ${interaction.channel.id} for message ${latestMessage.id}`,
    );

    await tomoriChat({
      client,
      message: passportMessage as Message,
      isFromQueue: false,
      isManuallyTriggered: true,
      forceReason,
      reasoningQuery: forceReason ? manualPrompt : undefined,
      llmOverrideCodename,
      selectedPersonaId: selectedPersona?.persona_id ?? undefined,
      textQuotaSource: "user",
      textQuotaTriggerKey: interaction.id,
      textQuotaUserDiscId: interaction.user.id,
      manualSystemPrompt: manualPrompt || undefined,
      manualPrefill,
      manualTriggerInvoker: {
        userDiscId: interaction.user.id,
        username: interaction.user.username,
        locale,
        member: interaction.member as import("discord.js").GuildMember | null,
      },
    });

    // Set cooldown after successful response (shares cooldown pool with message triggers)
    // Uses whitelist-aware version to respect per-channel cooldown overrides
    await cooldownRepository.setMessageTriggerCooldownWithWhitelist(
      serverDiscId,
      interaction.user.id,
      interaction.channel.id,
      cooldownType,
      cooldownLength,
      invokingMember,
    );
  } catch (error) {
    log.error("Error in respond command:", error, {
      errorType: "RespondCommandError",
      metadata: {
        userId: interaction.user.id,
        guildId: interaction.guild?.id ?? interaction.user.id,
        channelId: interaction.channel?.id,
      },
    });

    try {
      await interaction.followUp({
        embeds: [
          createStandardEmbed(locale, {
            titleKey: "general.errors.unknown_error_title",
            descriptionKey: "general.errors.unknown_error_description",
            color: ColorCode.ERROR,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } catch (followUpError) {
      log.error("Failed to send error followup for respond command:", followUpError);
    }
  }
}
