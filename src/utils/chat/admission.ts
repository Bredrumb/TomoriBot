import type { AnyThreadChannel, BaseGuildVoiceChannel, Client, Guild, GuildMember, Message, User } from "discord.js";
import { BaseGuildTextChannel, ChannelType, DMChannel, EmbedBuilder, TextChannel } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { CooldownType, PrivacyLevel } from "@/types/db/schema";
import { getCachedPersonalSpotlightStatus } from "@/utils/cache/personalSpotlightCache";
import { getCachedWhitelistStatus } from "@/utils/cache/channelWhitelistCache";
import { getCachedPrivacyLevel, getCachedUserRow } from "@/utils/cache/userCache";
import { getCachedAllPersonas, getLastDbError } from "@/utils/cache/tomoriStateCache";
import { pendingMatrixReplyChannels } from "@/utils/bridges/matrix";
import { extractBridgeUserId, isMatrixBridgeWebhookUsername } from "@/utils/bridges";
import {
  checkMessageTriggerCooldownWithWhitelist,
  setMessageTriggerCooldownWithWhitelist,
} from "@/utils/db/cooldownManager";
import { getCooldownTypeFooterKey } from "@/utils/db/messageCooldown";
import { isPersonaAllowedForTrigger } from "@/utils/db/personaAccess";
import { sendCooldownDM } from "@/utils/discord/cooldownDM";
import { createStandardEmbed, sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { checkTextQuota } from "@/utils/quota/textQuotaManager";
import { checkServerRateLimit, checkUserRateLimit } from "@/utils/security/rateLimiter";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import {
  createScreamingRegex,
  getAutochatAssignedPersonaId,
  getDeliberateTriggerMatch,
  isAutochatAlwaysReplyChannelActive,
  isAutochatConfiguredChannel,
  isAutochatCounterHit,
  isAutochatQualifyingMessage,
  isMatrixRelayMessage,
  isRealUserLikeMessage,
  isSelfTriggerMessage,
} from "@/utils/chat/triggerProcessor";
import {
  cleanupTextQuotaTriggerStates,
  buildTextQuotaResetInfo,
  getSelfReplyChainOriginUser,
  getSelfReplyChainState,
  isActiveNaturalStopTurn,
  getServerActiveMessageCount,
  getUserActiveMessageCount,
  selfReplySuppressionUntil,
  setSelfReplyChainOriginUser,
  textQuotaTriggerStates,
  updateSelfReplyChainState,
  type TextQuotaTriggerState,
} from "@/utils/chat/channelQueue";
import type { ChatAdmission, ChatIncoming, NonRunnableChatAdmission } from "@/utils/chat/types";
import { resolveReferencedWebhookTarget } from "@/utils/chat/webhookIdentity";

const DEFAULT_CASCADE_LIMIT = 3;
const MAX_CASCADE_LIMIT = 10;
const BASE_TRIGGER_WORDS = process.env.BASE_TRIGGER_WORDS?.split(",").map((word) => word.trim()) || [
  "tomori",
  "tomo",
  "トモリ",
  "ともり",
];

type ShouldBotReplyOptions = {
  personalAutoTriggerPersonaId?: number | null;
  allowedPersonaIds?: ReadonlySet<number> | null;
};

export interface ChatAccessState {
  whitelistStatus: Awaited<ReturnType<typeof getCachedWhitelistStatus>> | null;
  personalSpotlightStatus: Awaited<ReturnType<typeof getCachedPersonalSpotlightStatus>> | null;
  allowedPersonaIds: Set<number> | null;
  rejectedByWhitelist: boolean;
}

export interface DirectChatTriggerValidation {
  shouldContinue: boolean;
  isReplyToBot: boolean;
  replyPersona: TomoriState | null;
  isBotMentioned: boolean;
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
}

export async function evaluateChatAdmission(incoming: ChatIncoming): Promise<ChatAdmission> {
  cleanupTextQuotaTriggerStates();

  const { client, message } = incoming;
  const channel = message.channel;
  const isBotAuthor = message.author.bot;
  const isWebhookMessage = Boolean(message.webhookId);
  const isInteractionResponse = Boolean(message.interaction);
  const isFromClientUser = Boolean(client.user && message.author.id === client.user.id);
  const isMatrixRelay = isMatrixRelayMessage(message);
  const isLikelySelfMessage = !isMatrixRelay && (isFromClientUser || isWebhookMessage);
  const isRealUserMessage = isRealUserLikeMessage(message);
  const isActiveNaturalStopMessage =
    !incoming.isStopResponse &&
    !incoming.isManuallyTriggered &&
    isRealUserMessage &&
    isNaturalStopMessage(message.content) &&
    isActiveNaturalStopTurn(channel.id, message.author.id);

  const ignored = (reason: string): NonRunnableChatAdmission => ({
    incoming,
    disposition: "ignore",
    locale: "en-US",
    reason,
  });

  const blocked = (reason: string): NonRunnableChatAdmission => ({
    incoming,
    disposition: "blocked",
    locale: "en-US",
    reason,
  });

  const isSeedPlaceholderMessage =
    isFromClientUser &&
    !isWebhookMessage &&
    message.content === "\u2800" &&
    message.embeds.length === 0 &&
    message.attachments.size === 0;
  if (isSeedPlaceholderMessage && !incoming.isManuallyTriggered) {
    updateSelfReplyChainState(channel.id, false);
    return ignored("seed_placeholder");
  }

  const suppressionUntil = selfReplySuppressionUntil.get(channel.id);
  if (
    !incoming.isManuallyTriggered &&
    isLikelySelfMessage &&
    typeof suppressionUntil === "number" &&
    Date.now() < suppressionUntil
  ) {
    selfReplySuppressionUntil.delete(channel.id);
    updateSelfReplyChainState(channel.id, false);
    return ignored("self_reply_suppressed");
  }

  if (!incoming.isManuallyTriggered && isLikelySelfMessage && message.reference?.messageId) {
    let referencedMessage = message.channel.messages.cache.get(message.reference.messageId);

    if (!referencedMessage && "messages" in channel) {
      try {
        referencedMessage = await channel.messages.fetch(message.reference.messageId);
      } catch {
        referencedMessage = undefined;
      }
    }

    if (referencedMessage && (referencedMessage.author.id === client.user?.id || referencedMessage.webhookId)) {
      updateSelfReplyChainState(channel.id, false);
      return ignored("self_reply_reference");
    }
  }

  if (isRealUserMessage && !isActiveNaturalStopMessage && !incoming.isPersonaJob) {
    updateSelfReplyChainState(channel.id, false);
  }

  if (channel.type === ChannelType.DM && isBotAuthor && !incoming.isManuallyTriggered) {
    updateSelfReplyChainState(channel.id, false);
    return ignored("bot_dm_message");
  }

  if (isBotAuthor && !incoming.isManuallyTriggered) {
    if (isInteractionResponse) {
      updateSelfReplyChainState(channel.id, false);
      return ignored("bot_interaction_response");
    }
    if (!isFromClientUser && !isWebhookMessage) {
      updateSelfReplyChainState(channel.id, false);
      return ignored("other_bot_message");
    }
  }

  if (isLikelySelfMessage && !incoming.isManuallyTriggered) {
    incoming.isPersonaJob = true;
  }

  if (incoming.isStopResponse) {
    log.info(`Processing stop response for message ${message.id} using original message as passport`);
  }

  if (message.content === "$whoami" && "send" in channel) {
    const whoAmIEmbed = new EmbedBuilder()
      .setTitle("トモリですよ！")
      .setURL("https://github.com/Bredrumb/TomoriBot/")
      .setColor(ColorCode.INFO);

    await channel.send({
      embeds: [whoAmIEmbed],
    });
    return ignored("whoami_easter_egg");
  }

  const chainOriginUserDiscId =
    !incoming.isManuallyTriggered && isLikelySelfMessage ? getSelfReplyChainOriginUser(channel.id) : null;
  const userDiscId = incoming.manualTriggerInvoker?.userDiscId ?? chainOriginUserDiscId ?? message.author.id;
  const matrixRelayUserId = isMatrixRelay ? extractBridgeUserId(message.author.username) : undefined;
  const cooldownUserDiscId = matrixRelayUserId ?? userDiscId;

  if (incoming.isManuallyTriggered || !isLikelySelfMessage) {
    setSelfReplyChainOriginUser(channel.id, userDiscId);
  }

  if (!incoming.isManuallyTriggered && !incoming.reminderRecipientID && !incoming.reminderData?.self_reminder) {
    const userPrivacyLevel = await getCachedPrivacyLevel(userDiscId);
    if (userPrivacyLevel === PrivacyLevel.FULL) {
      return blocked("full_privacy_user");
    }
  }

  const channelScope = await resolveAdmissionChannelScope(incoming, userDiscId);
  if (!channelScope) {
    return blocked("unsupported_channel");
  }

  incoming.isManuallyTriggered = channelScope.isManuallyTriggered;

  if (!channelScope.isDMChannel && "permissionsFor" in channel) {
    const permissions = client.user ? channel.permissionsFor(client.user) : null;
    if (!permissions) {
      return blocked("missing_channel_permissions");
    }
    const canSend = channelScope.isThreadChannel
      ? permissions.has("SendMessagesInThreads")
      : permissions.has("SendMessages");
    if (!canSend) {
      return blocked("cannot_send_in_channel");
    }
  }

  const { earlyTomoriState, earlyAllPersonas } = await loadEarlyTomoriState(channelScope.serverDiscId, channel.id);

  const botReplyBlockReason = await shouldBlockReplyToOtherBot({
    incoming,
    earlyAllPersonas,
    isBotAuthor,
  });
  if (botReplyBlockReason) {
    updateSelfReplyChainState(channel.id, false);
    return ignored(botReplyBlockReason);
  }

  return {
    incoming,
    disposition: "run",
    locale: "en-US",
    client: incoming.client,
    message: incoming.message,
    channel: incoming.message.channel,
    guild: channelScope.guild,
    serverDiscId: channelScope.serverDiscId,
    userDiscId,
    isDMChannel: channelScope.isDMChannel,
    tomoriState: earlyTomoriState ?? undefined,
    allPersonas: earlyAllPersonas,
    cooldownUserDiscId,
  };
}

export async function handleChatDisposition(admission: NonRunnableChatAdmission): Promise<void> {
  if (admission.error) {
    log.warn(`Chat admission ended with ${admission.disposition}: ${admission.reason}`, admission.error);
    return;
  }

  log.info(`Chat admission ended with ${admission.disposition}: ${admission.reason}`);
}

export async function enforceGlobalRateLimit(params: {
  userDiscId: string;
  serverDiscId: string;
  channel: TextChannel | DMChannel | BaseGuildTextChannel | AnyThreadChannel | BaseGuildVoiceChannel;
  guild: Guild | null;
  client: Client;
  messageId: string;
  userActiveCountAdjustment?: number;
  serverActiveCountAdjustment?: number;
}): Promise<boolean> {
  const {
    userDiscId,
    serverDiscId,
    channel,
    guild,
    client,
    messageId,
    userActiveCountAdjustment = 0,
    serverActiveCountAdjustment = 0,
  } = params;

  const userActiveCount = Math.max(getUserActiveMessageCount(userDiscId) + userActiveCountAdjustment, 0);
  const userRateCheck = checkUserRateLimit(userActiveCount);
  if (!userRateCheck.allowed) {
    const currentCount = userRateCheck.currentCount ?? userActiveCount;
    log.warn(
      `User ${userDiscId} exceeded rate limit (${currentCount}/${userRateCheck.maxLimit} active messages). Dropping message ${messageId}.`,
    );

    const tempUserRow = await getCachedUserRow(userDiscId);
    const userLocale = tempUserRow?.language_pref ?? guild?.preferredLocale ?? "en-US";

    await sendUserRateLimitDM(userDiscId, client, userLocale, currentCount);

    return false;
  }

  const serverActiveCount = Math.max(getServerActiveMessageCount(serverDiscId) + serverActiveCountAdjustment, 0);
  const serverRateCheck = checkServerRateLimit(serverActiveCount);
  if (!serverRateCheck.allowed) {
    const currentCount = serverRateCheck.currentCount ?? serverActiveCount;
    log.warn(
      `Server ${serverDiscId} exceeded rate limit (${currentCount}/${serverRateCheck.maxLimit} active messages). Dropping message ${messageId}.`,
    );

    const serverLocale = guild?.preferredLocale ?? "en-US";

    await sendServerRateLimitEmbed(channel, serverLocale, currentCount);

    return false;
  }

  return true;
}

export async function rejectOnMessageTriggerCooldown(params: {
  serverDiscId: string;
  userDiscId: string;
  channelId: string;
  cooldownType: CooldownType;
  member: GuildMember | null;
  isAutochatOverride: boolean;
  author: User;
  locale: string;
  botName: string;
}): Promise<boolean> {
  const cooldownResult = await checkMessageTriggerCooldownWithWhitelist(
    params.serverDiscId,
    params.userDiscId,
    params.channelId,
    params.cooldownType,
    params.member,
    params.isAutochatOverride,
  );

  if (!cooldownResult.isOnCooldown) {
    return false;
  }

  const footerKey = getCooldownTypeFooterKey(cooldownResult.cooldownType);
  await sendCooldownDM(
    params.author,
    params.locale,
    "general.message_cooldown_title",
    "general.message_cooldown",
    {
      seconds: cooldownResult.remainingSeconds.toString(),
      botName: params.botName,
    },
    footerKey,
  );
  log.info(
    `Message trigger cooldown active for ${
      cooldownResult.cooldownType === CooldownType.PER_USER
        ? `user ${params.userDiscId}`
        : cooldownResult.cooldownType === CooldownType.PER_CHANNEL
          ? `channel ${params.channelId}`
          : `server ${params.serverDiscId}`
    }. ${cooldownResult.remainingSeconds}s remaining.`,
  );
  return true;
}

export async function setMessageTriggerCooldownForAdmission(params: {
  serverDiscId: string;
  userDiscId: string;
  channelId: string;
  cooldownType: CooldownType;
  cooldownLength: number;
  member: GuildMember | null;
}): Promise<void> {
  await setMessageTriggerCooldownWithWhitelist(
    params.serverDiscId,
    params.userDiscId,
    params.channelId,
    params.cooldownType,
    params.cooldownLength,
    params.member,
  );
}

export async function checkTextQuotaForAdmission(params: {
  shouldApplyTextQuota: boolean;
  isPersonaJob: boolean;
  triggerKey: string;
  serverId: number;
  userDiscId: string;
  channel: TextChannel | DMChannel | BaseGuildTextChannel | AnyThreadChannel | BaseGuildVoiceChannel;
  locale: string;
}): Promise<{ allowed: true; state: TextQuotaTriggerState | null } | { allowed: false; state: null }> {
  if (!params.shouldApplyTextQuota) {
    return { allowed: true, state: null };
  }

  const existingTextQuotaState = textQuotaTriggerStates.get(params.triggerKey);

  if (params.isPersonaJob) {
    return {
      allowed: true,
      state: existingTextQuotaState ?? null,
    };
  }

  if (existingTextQuotaState) {
    return {
      allowed: true,
      state: existingTextQuotaState,
    };
  }

  const quotaCheck = await checkTextQuota(params.serverId, params.userDiscId);

  if (!quotaCheck.allowed) {
    const resetInfo = buildTextQuotaResetInfo(params.locale, quotaCheck);
    let descriptionKey = "genai.text_quota_exceeded_description";

    if (quotaCheck.reason === "user_quota_exceeded") {
      descriptionKey = "genai.text_user_quota_exceeded_description";
    } else if (quotaCheck.reason === "serverwide_quota_exceeded") {
      descriptionKey = "genai.text_serverwide_quota_exceeded_description";
    }

    await sendStandardEmbed(params.channel, params.locale, {
      color: ColorCode.ERROR,
      titleKey: "genai.text_quota_exceeded_title",
      descriptionKey,
      descriptionVars: {
        reset_info: resetInfo,
      },
      footerKey: "genai.text_quota_exceeded_footer",
    });
    return { allowed: false, state: null };
  }

  const textQuotaStateForTrigger: TextQuotaTriggerState = {
    serverId: params.serverId,
    userDiscId: params.userDiscId,
    consumed: false,
    createdAt: Date.now(),
  };
  textQuotaTriggerStates.set(params.triggerKey, textQuotaStateForTrigger);

  return {
    allowed: true,
    state: textQuotaStateForTrigger,
  };
}

export async function evaluateChatAccess(params: {
  isStopResponse: boolean;
  isDMChannel: boolean;
  isManuallyTriggered?: boolean;
  isSelfMessage: boolean;
  isAutochatOverride: boolean;
  guildDiscId: string;
  fallbackUserDiscId: string;
  message: Message;
  memberRoleDiscIds?: string[];
  parentChannelId?: string;
  effectiveChannelId: string;
  serverId: number;
  userId?: number | null;
  allPersonas: TomoriState[];
}): Promise<ChatAccessState> {
  if (params.isStopResponse) {
    return {
      whitelistStatus: null,
      personalSpotlightStatus: null,
      allowedPersonaIds: null,
      rejectedByWhitelist: false,
    };
  }

  const whitelistStatus = await getCachedWhitelistStatus(
    params.guildDiscId || params.fallbackUserDiscId,
    params.message.channelId,
    params.memberRoleDiscIds,
    params.parentChannelId,
  );
  const personalSpotlightStatus =
    !params.isDMChannel && params.userId
      ? await getCachedPersonalSpotlightStatus(params.serverId, params.userId, params.effectiveChannelId)
      : null;

  const shouldEnforceWhitelistGate = params.isManuallyTriggered || !params.isSelfMessage;
  const rejectedByWhitelist =
    shouldEnforceWhitelistGate && !whitelistStatus.isTriggerAllowed && !params.isAutochatOverride;
  if (rejectedByWhitelist) {
    log.info(
      `Message ${params.message.id} in channel ${params.message.channelId} rejected by whitelist policy (${whitelistStatus.blockReason ?? "unknown"})`,
    );
  }

  const allowedPersonaIds =
    whitelistStatus.hasActivePersonaWhitelist || personalSpotlightStatus
      ? new Set(
          params.allPersonas.flatMap((persona) =>
            typeof persona.tomori_id === "number" &&
            isPersonaAllowedForTrigger(whitelistStatus, personalSpotlightStatus, persona.tomori_id)
              ? [persona.tomori_id]
              : [],
          ),
        )
      : null;

  return {
    whitelistStatus,
    personalSpotlightStatus,
    allowedPersonaIds,
    rejectedByWhitelist,
  };
}

export async function validateDirectChatTrigger(params: {
  client: Client;
  message: Message;
  guild: Guild | null;
  allPersonas: TomoriState[];
  tomoriState: TomoriState | null | undefined;
  isDMChannel: boolean;
  isManuallyTriggered?: boolean;
  userDiscId: string;
  serverDiscId: string;
  locale: string;
}): Promise<DirectChatTriggerValidation> {
  const personaByNickname = new Map<string, TomoriState>();
  for (const persona of params.allPersonas) {
    const nicknameKey = persona.tomori_nickname?.toLowerCase();
    if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
    personaByNickname.set(nicknameKey, persona);
  }

  let isReplyToBot = false;
  let replyPersona: TomoriState | null = null;
  let isUserImpersonation = false;
  let impersonatedUserId: string | undefined;

  if (params.message.reference?.messageId) {
    try {
      const referenceMessage = await params.message.channel.messages.fetch(params.message.reference.messageId);
      if (referenceMessage) {
        if (referenceMessage.author.id === params.client.user?.id) {
          isReplyToBot = true;
        } else if (referenceMessage.webhookId) {
          const webhookReplyTarget = resolveReferencedWebhookTarget(referenceMessage, personaByNickname, params.guild);

          if (webhookReplyTarget.replyPersona) {
            replyPersona = webhookReplyTarget.replyPersona;
          } else if (webhookReplyTarget.impersonatedUserId) {
            isReplyToBot = true;
            isUserImpersonation = true;
            impersonatedUserId = webhookReplyTarget.impersonatedUserId;
            log.info(
              `Reply ${params.message.id} matched user impersonation webhook. Target user: ${impersonatedUserId}`,
            );
          }
        }
      }
    } catch (fetchError) {
      log.warn("Could not fetch reference message for reply check", fetchError);
    }
  }

  const isReplyToPersona = isReplyToBot || !!replyPersona;
  const isBaseTriggerWord = isBaseTriggerWordMatch(params.message.content);
  const isBotMentioned = !!(params.client.user && params.message.mentions.users.has(params.client.user.id));
  const shouldValidateState =
    isBaseTriggerWord ||
    isReplyToPersona ||
    isBotMentioned ||
    params.isManuallyTriggered ||
    (params.isDMChannel && params.message.author.id !== params.client.user?.id);

  if (shouldValidateState && !params.tomoriState) {
    const contextMessage = params.isDMChannel
      ? `User tried to use Tomori in DM but no Tomori instance found for user ${params.userDiscId}.`
      : `User mentioned Tomori in server ${params.serverDiscId} but Tomori not set up.`;
    log.info(contextMessage);

    const dbError = getLastDbError(params.serverDiscId);
    const responseChannel = params.message.channel as
      | TextChannel
      | DMChannel
      | BaseGuildTextChannel
      | AnyThreadChannel
      | BaseGuildVoiceChannel;
    if (dbError) {
      await sendStandardEmbed(responseChannel, params.locale, {
        color: ColorCode.WARN,
        titleKey: "general.errors.tomori_updating_title",
        descriptionKey: "general.errors.tomori_updating_description",
      });
    } else {
      await sendStandardEmbed(responseChannel, params.locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        ...(params.isDMChannel && {
          footerKey: "general.errors.tomori_not_setup_dm_footer",
        }),
      });
    }

    return {
      shouldContinue: false,
      isReplyToBot,
      replyPersona,
      isBotMentioned,
      isUserImpersonation,
      impersonatedUserId,
    };
  }

  if (shouldValidateState && params.tomoriState && !params.tomoriState.config.api_key) {
    const contextMessage = params.isDMChannel
      ? `No server API key configured for DM user ${params.userDiscId}; deferring final credential resolution.`
      : `No server API key configured for server ${params.serverDiscId}; deferring final credential resolution.`;
    log.info(contextMessage);
  }

  if (!shouldValidateState && !params.tomoriState) {
    return {
      shouldContinue: false,
      isReplyToBot,
      replyPersona,
      isBotMentioned,
      isUserImpersonation,
      impersonatedUserId,
    };
  }

  return {
    shouldContinue: true,
    isReplyToBot,
    replyPersona,
    isBotMentioned,
    isUserImpersonation,
    impersonatedUserId,
  };
}

function isBaseTriggerWordMatch(content: string): boolean {
  for (const baseWord of BASE_TRIGGER_WORDS) {
    if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(baseWord)) {
      if (content.includes(baseWord)) {
        return true;
      }
    } else {
      const regex = new RegExp(`\\b${escapeRegExp(baseWord)}\\b`, "i");
      if (regex.test(content)) {
        return true;
      }
    }
  }
  return false;
}

async function sendUserRateLimitDM(
  userDiscId: string,
  client: Client,
  userLocale: string,
  currentCount: number,
): Promise<void> {
  try {
    const user = await client.users.fetch(userDiscId);
    const rateLimitEmbed = createStandardEmbed(userLocale, {
      titleKey: "rate_limit.user_exceeded_title",
      descriptionKey: "rate_limit.user_exceeded_description",
      color: ColorCode.WARN,
    });

    await user.send({ embeds: [rateLimitEmbed] });
    log.info(`Sent rate limit DM to user ${userDiscId} (${currentCount} active messages)`);
  } catch (error) {
    log.info(
      `Could not send rate limit DM to user ${userDiscId}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function sendServerRateLimitEmbed(
  channel: TextChannel | DMChannel | BaseGuildTextChannel | AnyThreadChannel | BaseGuildVoiceChannel,
  locale: string,
  currentCount: number,
): Promise<void> {
  try {
    await sendStandardEmbed(channel, locale, {
      titleKey: "rate_limit.server_exceeded_title",
      descriptionKey: "rate_limit.server_exceeded_description",
      color: ColorCode.WARN,
    });
    log.info(`Sent rate limit embed to channel ${channel.id} (${currentCount} active messages in server)`);
  } catch (error) {
    log.warn(`Failed to send rate limit embed to channel ${channel.id}`, error);
  }
}

function isNaturalStopMessage(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^(stop|cancel|abort|enough|やめて|止まって|ストップ)[.!?。！？\s]*$/i.test(normalized);
}

async function resolveAdmissionChannelScope(
  incoming: ChatIncoming,
  userDiscId: string,
): Promise<{
  guild: Guild | null;
  serverDiscId: string;
  isDMChannel: boolean;
  isThreadChannel: boolean;
  isManuallyTriggered?: boolean;
} | null> {
  const { client, message } = incoming;
  const channel = message.channel;
  const isThreadChannel =
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread;
  const isVoiceChannel = channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;

  if (channel instanceof BaseGuildTextChannel || isThreadChannel || isVoiceChannel) {
    return {
      guild: message.guild,
      serverDiscId: message.guild?.id ?? userDiscId,
      isDMChannel: false,
      isThreadChannel,
      isManuallyTriggered: incoming.isManuallyTriggered,
    };
  }

  if (channel instanceof DMChannel) {
    log.info(`Processing DM from user ${userDiscId} in channel ${channel.id}`);
    return {
      guild: null,
      serverDiscId: userDiscId,
      isDMChannel: true,
      isThreadChannel: false,
      isManuallyTriggered: true,
    };
  }

  let shouldShowError = Boolean(incoming.isManuallyTriggered);
  if (!shouldShowError && message.content) {
    shouldShowError = BASE_TRIGGER_WORDS.some((baseWord) => {
      if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(baseWord)) {
        return message.content.includes(baseWord);
      }
      return new RegExp(`\\b${escapeRegExp(baseWord)}\\b`, "i").test(message.content);
    });
  }
  if (!shouldShowError && client.user && message.mentions.users.has(client.user.id)) {
    shouldShowError = true;
  }
  if (!shouldShowError && message.reference?.messageId) {
    try {
      const referenceMessage = await message.channel.messages.fetch(message.reference.messageId);
      if (referenceMessage && referenceMessage.author.id === client.user?.id) {
        shouldShowError = true;
      }
    } catch {
      // Unsupported-channel admission should stay quiet if the reference cannot be fetched.
    }
  }

  if (shouldShowError && "send" in channel && message.author.id !== client.user?.id) {
    const errorEmbed = createStandardEmbed("en-US", {
      color: ColorCode.ERROR,
      titleKey: "general.errors.channel_not_supported_title",
      descriptionKey: "general.errors.channel_not_supported_description",
    });

    try {
      await channel.send({ embeds: [errorEmbed] });
    } catch (sendError) {
      log.error("Failed to send unsupported channel type message", sendError);
    }
  }

  return null;
}

async function loadEarlyTomoriState(
  serverDiscId: string,
  channelId: string,
): Promise<{
  earlyTomoriState: TomoriState | null;
  earlyAllPersonas: TomoriState[];
}> {
  try {
    const earlyAllPersonas = await getCachedAllPersonas(serverDiscId);
    return {
      earlyAllPersonas,
      earlyTomoriState: earlyAllPersonas.find((persona) => !persona.is_alter) ?? null,
    };
  } catch (error) {
    await log.error(`Failed to load TomoriState early for server ${serverDiscId} in chat admission.`, error, {
      errorType: "EarlyStateLoadingError",
      metadata: { serverDiscId, channelId },
    });
    return {
      earlyAllPersonas: [],
      earlyTomoriState: null,
    };
  }
}

async function shouldBlockReplyToOtherBot(args: {
  incoming: ChatIncoming;
  earlyAllPersonas: TomoriState[];
  isBotAuthor: boolean;
}): Promise<string | null> {
  const { incoming, earlyAllPersonas, isBotAuthor } = args;
  const { client, message } = incoming;

  if (incoming.isManuallyTriggered || isBotAuthor || !message.reference?.messageId) {
    return null;
  }

  let referencedMessage = message.channel.messages.cache.get(message.reference.messageId);

  if (!referencedMessage && "messages" in message.channel) {
    try {
      referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
    } catch {
      referencedMessage = undefined;
    }
  }

  if (
    !referencedMessage?.author.bot ||
    referencedMessage.author.id === client.user?.id ||
    referencedMessage.webhookId
  ) {
    return null;
  }

  const isBotDirectlyAddressed =
    (client.user && message.mentions.users.has(client.user.id)) ||
    BASE_TRIGGER_WORDS.some((word) => {
      if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(word)) {
        return message.content.includes(word);
      }
      return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(message.content);
    }) ||
    earlyAllPersonas.some((persona) => {
      const triggers =
        persona.trigger_words ??
        (persona.is_alter ? (persona.alter_triggers ?? []) : (persona.config?.trigger_words ?? []));

      return triggers.some((trigger: string) => {
        if (trigger.startsWith("<@")) {
          return message.mentions.users.has(trigger.replace(/[<@!>]/g, ""));
        }
        if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(trigger)) {
          return message.content.includes(trigger);
        }
        return createScreamingRegex(trigger).test(message.content);
      });
    });

  return isBotDirectlyAddressed ? null : "reply_to_other_bot";
}

export function shouldBotReply(
  message: Message,
  tomoriState: TomoriState,
  allPersonas: TomoriState[],
  options: ShouldBotReplyOptions = {},
): boolean {
  const isSelfMessage = isSelfTriggerMessage(message, allPersonas);
  const isMatrixRelayMessage = Boolean(message.webhookId) && isMatrixBridgeWebhookUsername(message.author.username);
  const rawCascadeLimit = tomoriState.config.cascade_limit ?? DEFAULT_CASCADE_LIMIT;
  const cascadeLimit = Math.min(Math.max(rawCascadeLimit, 0), MAX_CASCADE_LIMIT);

  if (message.webhookId && !isSelfMessage && !isMatrixRelayMessage) {
    return false;
  }
  if (isSelfMessage && cascadeLimit <= 0) {
    return false;
  }

  const isThreadChannel =
    message.channel.type === ChannelType.PublicThread ||
    message.channel.type === ChannelType.PrivateThread ||
    message.channel.type === ChannelType.AnnouncementThread;
  const isVoiceChannel =
    message.channel.type === ChannelType.GuildVoice || message.channel.type === ChannelType.GuildStageVoice;
  if (
    (message.author.bot && (!isSelfMessage || cascadeLimit <= 0) && !isMatrixRelayMessage) ||
    message.content.startsWith("!") ||
    !(
      message.channel instanceof TextChannel ||
      message.channel instanceof DMChannel ||
      isThreadChannel ||
      isVoiceChannel
    )
  ) {
    return false;
  }

  if (isSelfMessage && cascadeLimit > 0) {
    const chainState = getSelfReplyChainState(message.channel.id);
    if (chainState.triggerCount >= cascadeLimit + 1) {
      return false;
    }
  }

  const config = tomoriState.config;
  const allowedPersonaIds = options.allowedPersonaIds ?? null;
  const mainPersona = allPersonas.find((persona) => !persona.is_alter);
  const resolveFallbackPersona = (personaId?: number | null): TomoriState | undefined =>
    (personaId ? allPersonas.find((persona) => persona.tomori_id === personaId) : undefined) ?? mainPersona;
  const isPersonaAllowed = (persona?: TomoriState | null): persona is TomoriState =>
    Boolean(
      persona &&
        (!allowedPersonaIds || (typeof persona.tomori_id === "number" && allowedPersonaIds.has(persona.tomori_id))),
    );

  let isReplyToBot = false;
  let isReplyToPersona = false;
  let replyPersonaTarget: TomoriState | null = null;
  const personaByNickname = new Map<string, TomoriState>();
  for (const persona of allPersonas) {
    const nicknameKey = persona.tomori_nickname?.toLowerCase();
    if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
    personaByNickname.set(nicknameKey, persona);
  }
  if (message.reference?.messageId) {
    const referenceMessage = message.channel.messages.cache.get(message.reference.messageId);
    if (referenceMessage?.author.id === message.client.user?.id) {
      isReplyToBot = true;
      isReplyToPersona = true;
      replyPersonaTarget = mainPersona ?? null;
    } else if (referenceMessage?.webhookId) {
      const webhookReplyTarget = resolveReferencedWebhookTarget(referenceMessage, personaByNickname, message.guild);
      if (webhookReplyTarget.replyPersona) {
        isReplyToPersona = true;
        replyPersonaTarget = webhookReplyTarget.replyPersona;
      }
      if (webhookReplyTarget.impersonatedUserId) {
        isReplyToBot = true;
        isReplyToPersona = true;
      }
    }
  }

  const isBotMentioned = message.client.user ? message.mentions.users.has(message.client.user.id) : false;

  let senderPersona: TomoriState | undefined;
  if (message.webhookId) {
    const webhookName = message.author.username.toLowerCase();
    senderPersona = personaByNickname.get(webhookName);
  } else if (message.author.id === message.client.user?.id) {
    senderPersona = allPersonas.find((persona) => !persona.is_alter);
  }

  const msgEffectiveChannelId = message.channel.isThread()
    ? (message.channel.parentId ?? message.channel.id)
    : message.channel.id;
  const isDtmActive = (config.deliberate_trigger_mode ?? false) && !!message.guild && !isMatrixRelayMessage;
  const personalAutoTriggerPersonaId = options.personalAutoTriggerPersonaId ?? null;
  const hasPersonalAutoTrigger = Number.isInteger(personalAutoTriggerPersonaId);
  const isAutoTriggerChannel = isAutochatConfiguredChannel(config, msgEffectiveChannelId) || hasPersonalAutoTrigger;
  const serverAutochatPersonaId = isAutochatConfiguredChannel(config, msgEffectiveChannelId)
    ? getAutochatAssignedPersonaId(config, msgEffectiveChannelId)
    : null;
  const autochatPersonaId = hasPersonalAutoTrigger ? personalAutoTriggerPersonaId : serverAutochatPersonaId;

  let triggersActive = false;
  let triggersActiveDeliberate = false;
  let selfMsgTriggerDiag: {
    matchedPersona: string;
    matchedTrigger: string;
    triggerSource: string;
    senderPersona: string;
    contentSnippet: string;
  } | null = null;

  for (const persona of allPersonas) {
    if (!isPersonaAllowed(persona)) {
      continue;
    }

    if (senderPersona && persona.tomori_id === senderPersona.tomori_id) {
      continue;
    }

    const triggerSource = persona.trigger_words
      ? "trigger_words"
      : persona.is_alter
        ? "alter_triggers"
        : "config_trigger_words";
    const triggers =
      persona.trigger_words ??
      (persona.is_alter ? (persona.alter_triggers ?? []) : (persona.config?.trigger_words ?? []));

    for (const trigger of triggers) {
      let matched = false;
      let isDeliberate = false;

      if (trigger.startsWith("<@")) {
        const userId = trigger.replace(/[<@!>]/g, "");
        matched = message.mentions.users.has(userId);
        isDeliberate = true;
      } else {
        const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(trigger);
        matched = isJapanese ? message.content.includes(trigger) : createScreamingRegex(trigger).test(message.content);
        const isPersonaDtmExempt =
          isAutoTriggerChannel &&
          (autochatPersonaId === null ? !persona.is_alter : autochatPersonaId === persona.tomori_id);
        isDeliberate =
          isDtmActive && !isPersonaDtmExempt ? getDeliberateTriggerMatch(message.content, trigger) !== null : true;
      }

      if (matched) {
        triggersActive = true;
        if (isDeliberate) {
          triggersActiveDeliberate = true;
          break;
        }
        if (isSelfMessage) {
          selfMsgTriggerDiag = {
            matchedPersona: persona.tomori_nickname ?? `id:${persona.tomori_id}`,
            matchedTrigger: trigger,
            triggerSource,
            senderPersona: senderPersona?.tomori_nickname ?? `id:${senderPersona?.tomori_id}`,
            contentSnippet: message.content.slice(0, 120),
          };
        }
        if (!isDtmActive) {
          break;
        }
      }
    }
    if (triggersActive && (!isDtmActive || triggersActiveDeliberate)) break;
  }

  if (selfMsgTriggerDiag) {
    log.info(
      `[Self-Msg Cross-Trigger] Persona "${selfMsgTriggerDiag.senderPersona}" message ` +
        `triggered "${selfMsgTriggerDiag.matchedPersona}" via ${selfMsgTriggerDiag.triggerSource} ` +
        `trigger "${selfMsgTriggerDiag.matchedTrigger}" in channel ${message.channel.id}. ` +
        `Content: "${selfMsgTriggerDiag.contentSnippet}"`,
    );
  }

  const autoReplyPersona = resolveFallbackPersona(autochatPersonaId);
  const scopedAlwaysReplyPersona = resolveFallbackPersona(serverAutochatPersonaId);
  const personalAutoReplyPersona = resolveFallbackPersona(personalAutoTriggerPersonaId);
  const isAutoMsgHit =
    !hasPersonalAutoTrigger &&
    isAutochatQualifyingMessage(message, isSelfMessage) &&
    isAutochatCounterHit(tomoriState, msgEffectiveChannelId) &&
    isPersonaAllowed(autoReplyPersona);
  const isScopedAlwaysReplyHit =
    !isMatrixRelayMessage &&
    isAutochatAlwaysReplyChannelActive(config, msgEffectiveChannelId) &&
    isAutochatQualifyingMessage(message, isSelfMessage) &&
    isPersonaAllowed(scopedAlwaysReplyPersona);
  const isPersonalAutoTriggerHit =
    !isMatrixRelayMessage &&
    hasPersonalAutoTrigger &&
    isAutochatQualifyingMessage(message, isSelfMessage) &&
    isPersonaAllowed(personalAutoReplyPersona);

  const isAlwaysReplyHit =
    (config.always_reply_enabled &&
      !isMatrixRelayMessage &&
      isAutochatQualifyingMessage(message, isSelfMessage) &&
      isPersonaAllowed(mainPersona)) ||
    isScopedAlwaysReplyHit ||
    isPersonalAutoTriggerHit;

  const isMatrixReplyToPersona = isMatrixRelayMessage && pendingMatrixReplyChannels.delete(message.channelId);
  const effectiveTriggersActive = isDtmActive ? triggersActiveDeliberate : triggersActive;
  const effectiveReplyToBot = isReplyToBot && isPersonaAllowed(mainPersona);
  const effectiveReplyToPersona = isReplyToPersona && isPersonaAllowed(replyPersonaTarget ?? mainPersona);
  const effectiveBotMentioned = isBotMentioned && isPersonaAllowed(mainPersona);

  const wouldReply =
    effectiveReplyToBot ||
    effectiveReplyToPersona ||
    effectiveBotMentioned ||
    effectiveTriggersActive ||
    isAutoMsgHit ||
    isAlwaysReplyHit ||
    isMatrixReplyToPersona;

  if (isSelfMessage && wouldReply) {
    const reasons = [
      effectiveReplyToBot && "isReplyToBot",
      effectiveReplyToPersona && "isReplyToPersona",
      effectiveBotMentioned && "isBotMentioned",
      effectiveTriggersActive && "effectiveTriggersActive",
      isAutoMsgHit && "isAutoMsgHit",
      isAlwaysReplyHit && "isAlwaysReplyHit",
      isMatrixReplyToPersona && "isMatrixReplyToPersona",
    ].filter(Boolean);

    log.info(
      `[Self-Msg Reply Decision] msg ${message.id} in ch ${message.channel.id} ` +
        `from "${senderPersona?.tomori_nickname ?? message.author.username}" -> would reply. ` +
        `Reasons: [${reasons.join(", ")}]. ` +
        `autoch_counter=${tomoriState.autoch_counter}/${tomoriState.autoch_next_target}, ` +
        `cascadeLimit=${cascadeLimit}, triggerCount=${getSelfReplyChainState(message.channel.id).triggerCount}`,
    );
  }

  return wouldReply;
}
