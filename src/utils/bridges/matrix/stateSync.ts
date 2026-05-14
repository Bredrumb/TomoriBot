import type { TextBasedChannel } from "discord.js";
import type { ReminderRow } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { getLinkedMatrixRoom } from "./rooms";
import {
  MATRIX_MAX_TRACKED_SENT_EVENTS,
  MATRIX_MEDIA_TIMEOUT_MS,
  pendingMatrixReplyChannels,
  sentEventPersonas,
} from "./state";
import { sendToMatrixRoom } from "./media";

export { pendingMatrixReplyChannels } from "./state";

export type PersonaReplyLookup = {
  isPersonaReply: boolean;
  replySnippet?: string;
};

export function getTrackedPersonaReply(eventId: string) {
  return sentEventPersonas.get(eventId);
}

export function trackSentMatrixEvent(eventId: string, personaName: string, sentText?: string): void {
  if (sentEventPersonas.size >= MATRIX_MAX_TRACKED_SENT_EVENTS) {
    const oldestKey = sentEventPersonas.keys().next().value;
    if (oldestKey) sentEventPersonas.delete(oldestKey);
  }

  sentEventPersonas.set(eventId, {
    personaName,
    replySnippet: buildReplySnippet(sentText),
  });
}

export function markPendingMatrixReply(channelDiscId: string): void {
  pendingMatrixReplyChannels.add(channelDiscId);
}

export function stripMatrixReplyFallback(body: string): string {
  if (!body.startsWith("> ")) return body;
  const blankLineIndex = body.indexOf("\n\n");
  if (blankLineIndex === -1) return body;
  return body.slice(blankLineIndex + 2).trim();
}

export async function getPersonaReplyEventMetadata(
  roomId: string,
  eventId: string,
  serverName: string,
): Promise<PersonaReplyLookup> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const asToken = process.env.MATRIX_ACCESS_TOKEN;
  if (!homeserverUrl || !asToken || !serverName) {
    return { isPersonaReply: false };
  }

  try {
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${asToken}` },
      signal: AbortSignal.timeout(MATRIX_MEDIA_TIMEOUT_MS),
    });
    if (!response.ok) return { isPersonaReply: false };

    const data = (await response.json()) as {
      sender?: string;
      content?: { body?: string };
    };
    const isPersonaReply =
      typeof data.sender === "string" && data.sender.startsWith("@_tomori_") && data.sender.endsWith(`:${serverName}`);

    return isPersonaReply
      ? {
          isPersonaReply: true,
          replySnippet: buildReplySnippet(data.content?.body),
        }
      : { isPersonaReply: false };
  } catch (error) {
    log.warn(`Matrix bridge: failed to inspect reply event ${eventId} in room ${roomId}`, error);
    return { isPersonaReply: false };
  }
}

export async function sendMatrixReminderMention(
  channel: TextBasedChannel,
  reminder: ReminderRow,
  afterMessageId: string,
  reminderStartTime: number,
  botUserId: string,
): Promise<void> {
  const matrixRoomId = await getLinkedMatrixRoom(reminder.channel_disc_id);
  if (!matrixRoomId || !botUserId || !("messages" in channel)) return;

  const matrixLocalpart = reminder.user_discord_id.split(":")[0].replace(/^@/, "");
  const mentionPlaceholder = `@{${matrixLocalpart}}`;

  try {
    const recentMessages = await channel.messages.fetch({
      after: afterMessageId,
      limit: 100,
    });

    const relevantMessages = recentMessages.filter(
      (message) =>
        (message.author.id === botUserId || message.webhookId) && message.createdTimestamp >= reminderStartTime - 1000,
    );

    if (relevantMessages.some((message) => message.content.includes(mentionPlaceholder))) {
      return;
    }

    const matrixId = reminder.user_discord_id;
    const safeName = reminder.user_nickname.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await sendToMatrixRoom(
      matrixRoomId,
      matrixId,
      undefined,
      undefined,
      `<a href="https://matrix.to/#/${matrixId}">${safeName}</a>`,
      [matrixId],
    );

    log.info(`Matrix: Added fallback mention for reminder ${reminder.reminder_id} to ensure recipient is pinged`);
  } catch (error) {
    log.warn(`Matrix: Failed to ensure mention for reminder ${reminder.reminder_id}:`, error);
  }
}

function buildReplySnippet(rawText?: string | null): string | undefined {
  if (!rawText) return undefined;
  const normalized = rawText.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.replace(/"/g, "'");
}
