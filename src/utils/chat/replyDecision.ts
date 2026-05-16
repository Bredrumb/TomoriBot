import type { Message } from "discord.js";
import { ChannelType, DMChannel, TextChannel } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { pendingMatrixReplyChannels } from "@/utils/bridges/matrix";
import { isMatrixBridgeWebhookUsername } from "@/utils/bridges";
import { log } from "@/utils/misc/logger";
import {
  createScreamingRegex,
  getAutochatAssignedPersonaId,
  getDeliberateTriggerMatch,
  isAutochatAlwaysReplyChannelActive,
  isAutochatConfiguredChannel,
  isAutochatCounterHit,
  isAutochatQualifyingMessage,
  isSelfTriggerMessage,
} from "@/utils/chat/triggerProcessor";
import { getSelfReplyChainState } from "@/utils/chat/selfReplyState";
import { resolveReferencedWebhookTarget } from "@/utils/chat/webhookIdentity";

const DEFAULT_CASCADE_LIMIT = 3;
const MAX_CASCADE_LIMIT = 10;

type ShouldBotReplyOptions = {
  personalAutoTriggerPersonaId?: number | null;
  allowedPersonaIds?: ReadonlySet<number> | null;
  personalDtm?: "off" | "follow" | "on";
};
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
  const serverDtmEnabled = config.deliberate_trigger_mode ?? false;
  const personalDtmMode = options.personalDtm ?? "follow";
  const isDtmActive =
    (personalDtmMode === "on" || (personalDtmMode === "follow" && serverDtmEnabled)) &&
    !!message.guild &&
    !isMatrixRelayMessage;
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

    const triggerSource = "trigger_words";
    const triggers = persona.trigger_words ?? [];

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
