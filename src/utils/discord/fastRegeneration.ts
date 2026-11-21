import type { Message, MessageReaction } from "discord.js";
import type { ChatTurn, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { getChannelTurnAbortSignal } from "@/utils/chat/channelQueue";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { getCachedMainPersona } from "@/utils/cache/tomoriStateCache";
import { findLastPersonaTurnBlock } from "@/utils/discord/personaTurnDetection";
import { deletePersonaTurnMessages, tryAcquirePersonaTurnDeletion } from "@/utils/discord/personaTurnDeletion";
import { log } from "@/utils/misc/logger";

const REACTION_WINDOW_MS = 30_000;
const REACTION_EMOJI = { retry: "🔄", continue: "➡️" } as const;
const ACTIONS = ["retry", "continue"] as const;
type Action = (typeof ACTIONS)[number];

export interface FastRegenerationRequest {
  action: Action;
  replyId: string;
  messageIds: readonly string[];
}

interface ReplyControls {
  trigger: Message;
  userId: string;
  personaId: number;
  messageIds: string[];
  reactions: Map<Action, MessageReaction>;
  timeout: ReturnType<typeof setTimeout>;
}

const replyControls = new Map<string, ReplyControls>();

function removeControls(replyId: string, entry: ReplyControls): void {
  replyControls.delete(replyId);
  clearTimeout(entry.timeout);
  for (const reaction of entry.reactions.values()) removeBotReaction(reaction, replyId);
}

function removeBotReaction(reaction: MessageReaction, replyId: string): void {
  const botId = reaction.client.user?.id;
  if (!botId) return;
  void reaction.users.remove(botId).catch((error) => {
    log.warn(`[fastRegeneration] Could not clear reaction on messageId=${replyId}`, error);
  });
}

export function takeFastRegeneration(
  replyId: string,
  userId: string,
  emoji: string | null,
): { trigger: Message; personaId: number; request: FastRegenerationRequest } | undefined {
  const normalizedEmoji = emoji === "➡" ? REACTION_EMOJI.continue : emoji;
  const action = ACTIONS.find((candidate) => REACTION_EMOJI[candidate] === normalizedEmoji);
  const entry = replyControls.get(replyId);
  if (!action || !entry || entry.userId !== userId || !entry.reactions.has(action)) return;
  removeControls(replyId, entry);
  return {
    trigger: entry.trigger,
    personaId: entry.personaId,
    request: { action, replyId, messageIds: entry.messageIds },
  };
}

export async function offerFastRegeneration(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  if (result.status !== "completed" || result.personaResponses.length === 0) return;
  const incoming = context.turn.lockedTurn.admission.incoming;
  if (
    incoming.textQuotaSource !== "user" ||
    incoming.isPersonaJob ||
    incoming.isUserImpersonation ||
    incoming.isStopResponse ||
    incoming.naturalNudge ||
    incoming.sceneTurn ||
    incoming.reminderRecipientID ||
    incoming.reminderData ||
    incoming.borrowsTriggerMessage
  )
    return;

  const { message, channel, userDiscId, currentPersona, streamingContext } = context;
  const personaId = currentPersona.persona_id;
  const config = currentPersona.config;
  if (
    !message.guildId ||
    personaId === undefined ||
    (!incoming.manualTriggerInvoker && (message.author.bot || message.author.id !== userDiscId))
  )
    return;

  const actions = ACTIONS.filter((action) =>
    action === "retry" ? config.fast_regeneration_retry_enabled : config.fast_regeneration_continue_enabled,
  );
  if (actions.length === 0) return;
  const refs = streamingContext.deliveredMessageRefs ?? [];
  const reply = refs.at(-1);
  if (!reply || refs.some((ref) => ref.channelId !== channel.id)) return;

  try {
    const delivered = await channel.messages.fetch(reply.messageId);
    if (replyControls.has(reply.messageId)) return;
    const entry: ReplyControls = {
      trigger: message,
      userId: userDiscId,
      personaId,
      messageIds: [...new Set(refs.map((ref) => ref.messageId))],
      reactions: new Map(),
      timeout: setTimeout(() => removeControls(reply.messageId, entry), REACTION_WINDOW_MS).unref(),
    };
    replyControls.set(reply.messageId, entry);
    for (const action of actions) {
      try {
        const reaction = await delivered.react(REACTION_EMOJI[action]);
        if (replyControls.get(reply.messageId) !== entry) {
          removeBotReaction(reaction, reply.messageId);
          return;
        }
        entry.reactions.set(action, reaction);
      } catch (error) {
        log.warn(`[fastRegeneration] Could not add ${action} reaction on messageId=${reply.messageId}`, error);
      }
    }
    if (entry.reactions.size === 0 && replyControls.get(reply.messageId) === entry) {
      removeControls(reply.messageId, entry);
    }
  } catch (error) {
    log.warn(`[fastRegeneration] Could not fetch messageId=${reply.messageId}`, error);
  }
}

export async function prepareFastRegeneration(turn: ChatTurn, request: FastRegenerationRequest): Promise<boolean> {
  const { client, channel, guild } = turn.lockedTurn.admission;
  const signal = getChannelTurnAbortSignal(channel.id);
  if (!guild || signal?.aborted) return false;
  const releaseDeletion = request.action === "retry" ? tryAcquirePersonaTurnDeletion(channel.id) : undefined;
  if (request.action === "retry" && !releaseDeletion) return false;
  try {
    const latest = await channel.messages.fetch({ limit: request.action === "retry" ? 100 : 1, cache: false });
    if (latest.first()?.id !== request.replyId) return false;

    const state = await getCachedMainPersona(guild.id);
    if (request.action === "continue") {
      return !signal?.aborted && state?.config.fast_regeneration_continue_enabled === true;
    }
    if (!state?.config.fast_regeneration_retry_enabled) return false;

    const messageIds = new Set(request.messageIds);
    const messages = [...latest.values()].reverse().filter((message) => messageIds.has(message.id));
    if (messages.length !== request.messageIds.length) return false;
    await Promise.all(messages.map(verifyMessageWebhook));
    const { blockMessages } = findLastPersonaTurnBlock({
      messages,
      allPersonas: turn.allPersonas,
      clientUserId: client.user?.id,
      targetPersonaId: turn.persona.persona_id,
    });
    if (blockMessages.length !== messages.length) return false;
    const botMember = guild.members.me;
    const canManageMessages = Boolean(
      botMember && "permissionsFor" in channel && channel.permissionsFor(botMember)?.has("ManageMessages"),
    );
    if (signal?.aborted || (!canManageMessages && blockMessages.some((message) => !message.webhookId))) return false;
    const { failedCount } = await deletePersonaTurnMessages(channel, blockMessages, canManageMessages, signal);
    return failedCount === 0;
  } catch (error) {
    log.warn(`[fastRegeneration] Could not prepare ${request.action} for messageId=${request.replyId}`, error);
    return false;
  } finally {
    releaseDeletion?.();
  }
}
