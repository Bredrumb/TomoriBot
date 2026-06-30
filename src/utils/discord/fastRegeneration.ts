import type { GuildMember, Message } from "discord.js";
import { log } from "@/utils/misc/logger";

export const FAST_REGENERATION_EMOJI = "🔄";
export const FAST_CONTINUE_EMOJI = "➡️";
export const FAST_ACTION_EMOJIS = new Set([FAST_REGENERATION_EMOJI, FAST_CONTINUE_EMOJI, "➡"]);
const DEFAULT_FAST_REGENERATION_TIMEOUT_MS = 30_000;

export type FastActionEmoji = typeof FAST_REGENERATION_EMOJI | typeof FAST_CONTINUE_EMOJI;

export interface FastRegenerationActionConfig {
  fast_regeneration_enabled?: boolean;
  fast_regeneration_retry_enabled?: boolean;
  fast_regeneration_continue_enabled?: boolean;
}

export interface FastRegenerationEntry {
  messageId: string;
  channelId: string;
  guildId: string;
  triggerUserId: string;
  triggerUsername: string;
  locale: string;
  member: GuildMember | null;
  personaId?: number;
  timeout: NodeJS.Timeout;
  armedAt: number;
  consumed: boolean;
  message: Message;
  enabledActions: FastActionEmoji[];
}

export function getFastRegenerationReactionTimeoutMs(): number {
  const raw = process.env.FAST_REGENERATION_REACTION_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : DEFAULT_FAST_REGENERATION_TIMEOUT_MS;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_FAST_REGENERATION_TIMEOUT_MS;
}

const fastRegenerationEntries = new Map<string, FastRegenerationEntry>();

export function normalizeFastActionEmoji(emoji: string | null | undefined): FastActionEmoji | null {
  if (emoji === FAST_REGENERATION_EMOJI) {
    return FAST_REGENERATION_EMOJI;
  }
  if (emoji === FAST_CONTINUE_EMOJI || emoji === "➡") {
    return FAST_CONTINUE_EMOJI;
  }
  return null;
}

export function getEnabledFastRegenerationActions(config: FastRegenerationActionConfig): FastActionEmoji[] {
  if (config.fast_regeneration_enabled !== true) {
    return [];
  }

  const actions: FastActionEmoji[] = [];
  if (config.fast_regeneration_retry_enabled === true) {
    actions.push(FAST_REGENERATION_EMOJI);
  }
  if (config.fast_regeneration_continue_enabled === true) {
    actions.push(FAST_CONTINUE_EMOJI);
  }
  return actions;
}

function forgetFastRegenerationEntry(messageId: string): void {
  const entry = fastRegenerationEntries.get(messageId);
  if (entry) {
    clearTimeout(entry.timeout);
    fastRegenerationEntries.delete(messageId);
  }
}

async function removeBotFastActionReactions(message: Message): Promise<void> {
  const botUserId = message.client.user?.id;
  if (!botUserId) {
    return;
  }

  for (const emoji of FAST_ACTION_EMOJIS) {
    try {
      const reaction = message.reactions.cache.get(emoji) ?? message.reactions.resolve(emoji);
      await reaction?.users.remove(botUserId);
    } catch (error) {
      log.warn(`[fastRegeneration] Failed to remove fast action reaction "${emoji}"`, error);
    }
  }
}

export function consumeFastRegenerationEntry(messageId: string): FastRegenerationEntry | null {
  const entry = fastRegenerationEntries.get(messageId);
  if (!entry || entry.consumed) {
    return null;
  }

  entry.consumed = true;
  forgetFastRegenerationEntry(messageId);
  return entry;
}

export function peekFastRegenerationEntry(messageId: string): FastRegenerationEntry | null {
  return fastRegenerationEntries.get(messageId) ?? null;
}

export async function clearFastRegenerationEntriesForChannel(channelId: string): Promise<void> {
  const entries = [...fastRegenerationEntries.values()].filter((entry) => entry.channelId === channelId);
  for (const entry of entries) {
    forgetFastRegenerationEntry(entry.messageId);
    await removeBotFastActionReactions(entry.message);
  }
}

export async function clearFastRegenerationEntriesForGuild(guildId: string): Promise<void> {
  const entries = [...fastRegenerationEntries.values()].filter((entry) => entry.guildId === guildId);
  for (const entry of entries) {
    forgetFastRegenerationEntry(entry.messageId);
    await removeBotFastActionReactions(entry.message);
  }
}

export interface FastRegenerationRecorderOptions {
  triggerUserId: string;
  triggerUsername: string;
  locale: string;
  member: GuildMember | null;
  enabledActions: FastActionEmoji[];
}

export interface FastRegenerationRecorder {
  record(message: Message, personaId?: number): void;
  arm(): Promise<void>;
}

export function createFastRegenerationRecorder(options: FastRegenerationRecorderOptions): FastRegenerationRecorder {
  let latestMessage: Message | null = null;
  let latestPersonaId: number | undefined;
  const enabledActions = [...new Set(options.enabledActions)];

  return {
    record(message, personaId) {
      if (!message.guildId || (message.author.id !== message.client.user?.id && !message.webhookId)) {
        return;
      }

      latestMessage = message;
      latestPersonaId = personaId;
    },

    async arm() {
      if (!latestMessage?.guildId || enabledActions.length === 0) {
        return;
      }

      const message = latestMessage;
      const guildId = message.guildId;
      if (!guildId) {
        return;
      }
      forgetFastRegenerationEntry(message.id);

      try {
        for (const emoji of enabledActions) {
          await message.react(emoji);
        }
      } catch (error) {
        await removeBotFastActionReactions(message);
        log.warn(`[fastRegeneration] Failed to add fast action reactions to messageId=${message.id}`, error);
        return;
      }

      const timeoutMs = getFastRegenerationReactionTimeoutMs();
      const timeout = setTimeout(() => {
        fastRegenerationEntries.delete(message.id);
        void removeBotFastActionReactions(message);
      }, timeoutMs);

      fastRegenerationEntries.set(message.id, {
        messageId: message.id,
        channelId: message.channelId,
        guildId,
        triggerUserId: options.triggerUserId,
        triggerUsername: options.triggerUsername,
        locale: options.locale,
        member: options.member,
        personaId: latestPersonaId,
        timeout,
        armedAt: Date.now(),
        consumed: false,
        message,
        enabledActions,
      });
    },
  };
}
