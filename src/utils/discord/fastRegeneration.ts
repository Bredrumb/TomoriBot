import type { GuildMember, Message } from "discord.js";
import { log } from "@/utils/misc/logger";

export const FAST_REGENERATION_EMOJI = "🔄";
const DEFAULT_FAST_REGENERATION_TIMEOUT_MS = 30_000;

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
}

export function getFastRegenerationReactionTimeoutMs(): number {
  const raw = process.env.FAST_REGENERATION_REACTION_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : DEFAULT_FAST_REGENERATION_TIMEOUT_MS;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_FAST_REGENERATION_TIMEOUT_MS;
}

const fastRegenerationEntries = new Map<string, FastRegenerationEntry>();

function forgetFastRegenerationEntry(messageId: string): void {
  const entry = fastRegenerationEntries.get(messageId);
  if (entry) {
    clearTimeout(entry.timeout);
    fastRegenerationEntries.delete(messageId);
  }
}

async function removeBotRegenerationReaction(message: Message): Promise<void> {
  const botUserId = message.client.user?.id;
  if (!botUserId) {
    return;
  }

  try {
    const reaction =
      message.reactions.cache.get(FAST_REGENERATION_EMOJI) ?? message.reactions.resolve(FAST_REGENERATION_EMOJI);
    await reaction?.users.remove(botUserId);
  } catch (error) {
    log.warn("[fastRegeneration] Failed to remove regeneration reaction", error);
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
    await removeBotRegenerationReaction(entry.message);
  }
}

export async function clearFastRegenerationEntriesForGuild(guildId: string): Promise<void> {
  const entries = [...fastRegenerationEntries.values()].filter((entry) => entry.guildId === guildId);
  for (const entry of entries) {
    forgetFastRegenerationEntry(entry.messageId);
    await removeBotRegenerationReaction(entry.message);
  }
}

export interface FastRegenerationRecorderOptions {
  triggerUserId: string;
  triggerUsername: string;
  locale: string;
  member: GuildMember | null;
}

export interface FastRegenerationRecorder {
  record(message: Message, personaId?: number): void;
  arm(): Promise<void>;
}

export function createFastRegenerationRecorder(options: FastRegenerationRecorderOptions): FastRegenerationRecorder {
  let latestMessage: Message | null = null;
  let latestPersonaId: number | undefined;

  return {
    record(message, personaId) {
      if (!message.guildId || (message.author.id !== message.client.user?.id && !message.webhookId)) {
        return;
      }

      latestMessage = message;
      latestPersonaId = personaId;
    },

    async arm() {
      if (!latestMessage?.guildId) {
        return;
      }

      const message = latestMessage;
      const guildId = message.guildId;
      if (!guildId) {
        return;
      }
      forgetFastRegenerationEntry(message.id);

      try {
        await message.react(FAST_REGENERATION_EMOJI);
      } catch (error) {
        log.warn(`[fastRegeneration] Failed to add regeneration reaction to messageId=${message.id}`, error);
        return;
      }

      const timeoutMs = getFastRegenerationReactionTimeoutMs();
      const timeout = setTimeout(() => {
        fastRegenerationEntries.delete(message.id);
        void removeBotRegenerationReaction(message);
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
      });
    },
  };
}
