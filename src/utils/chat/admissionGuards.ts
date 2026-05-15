import type { AnyThreadChannel, BaseGuildVoiceChannel, Client, Guild, GuildMember, Message, User } from "discord.js";
import type { BaseGuildTextChannel, DMChannel, TextChannel } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { CooldownType } from "@/types/db/schema";
import { getCachedPersonalSpotlightStatus } from "@/utils/cache/personalSpotlightCache";
import { getCachedWhitelistStatus } from "@/utils/cache/channelWhitelistCache";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { getLastDbError } from "@/utils/cache/tomoriStateCache";
import { cooldownRepository } from "@/utils/db/repositories/CooldownRepository";
import { isPersonaAllowedForTrigger } from "@/utils/persona/personaAccess";
import { sendCooldownDM } from "@/utils/discord/cooldownDM";
import { createStandardEmbed, sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { checkTextQuota } from "@/utils/quota/textQuotaManager";
import { checkServerRateLimit, checkUserRateLimit } from "@/utils/security/rateLimiter";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import {
  buildTextQuotaResetInfo,
  textQuotaTriggerStates,
  type TextQuotaTriggerState,
} from "@/utils/chat/textQuotaState";
import { getServerActiveMessageCount, getUserActiveMessageCount } from "@/utils/chat/channelActivity";
import { resolveReferencedWebhookTarget } from "@/utils/chat/webhookIdentity";

const BASE_TRIGGER_WORDS = process.env.BASE_TRIGGER_WORDS?.split(",").map((word) => word.trim()) || [
  "tomori",
  "tomo",
  "トモリ",
  "ともり",
];

export interface ChatAccessState {
  whitelistStatus: Awaited<ReturnType<typeof getCachedWhitelistStatus>> | null;
  personalSpotlightStatus: Awaited<ReturnType<typeof getCachedPersonalSpotlightStatus>> | null;
  allowedPersonaIds: Set<number> | null;
  rejectedByWhitelist: boolean;
  personalDtm?: "off" | "follow" | "on";
}

export interface DirectChatTriggerValidation {
  shouldContinue: boolean;
  isReplyToBot: boolean;
  replyPersona: TomoriState | null;
  isBotMentioned: boolean;
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
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
  const cooldownResult = await cooldownRepository.checkMessageTriggerCooldownWithWhitelist(
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

  const footerKey = cooldownRepository.getCooldownTypeFooterKey(cooldownResult.cooldownType);
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
  await cooldownRepository.setMessageTriggerCooldownWithWhitelist(
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
