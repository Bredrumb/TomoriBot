import type { Intent } from "matrix-appservice-bridge";
import { log } from "@/utils/misc/logger";
import { MATRIX_MAX_ATTACHMENT_BYTES, MATRIX_MEDIA_TIMEOUT_MS, getMatrixBridge } from "./state";
import { ensurePersonaInRoom, getPersonaIntent } from "./userMapping";
import { trackSentMatrixEvent } from "./stateSync";

export { MATRIX_MAX_ATTACHMENT_BYTES } from "./state";

export async function sendToMatrixRoom(
  roomId: string,
  text: string,
  personaName?: string,
  avatarUrl?: string | null,
  formattedText?: string,
  mentionedUserIds?: string[],
): Promise<void> {
  const bridge = getMatrixBridge();
  if (!bridge) return;

  try {
    const intent = await resolveSendIntent(roomId, personaName, avatarUrl ?? null);
    const messageContent: Record<string, unknown> = {
      msgtype: "m.text",
      body: text,
    };

    if (formattedText) {
      messageContent.formatted_body = formattedText;
      messageContent.format = "org.matrix.custom.html";
    }
    if (mentionedUserIds && mentionedUserIds.length > 0) {
      messageContent["m.mentions"] = { user_ids: mentionedUserIds };
    }

    const response = await intent.sendMessage(roomId, messageContent);
    if (personaName && (response as { event_id?: string })?.event_id) {
      trackSentMatrixEvent((response as { event_id: string }).event_id, personaName, text);
    }
  } catch (error) {
    log.warn(`Matrix bridge: failed to send message to room ${roomId}`, error);
  }
}

export async function sendAttachmentToMatrixRoom(
  roomId: string,
  data: ArrayBuffer,
  filename: string,
  mimeType: string,
  size: number,
  personaName?: string,
  avatarUrl?: string | null,
): Promise<void> {
  try {
    const intent = await resolveSendIntent(roomId, personaName, avatarUrl ?? null);
    const mxcUri = await intent.uploadContent(Buffer.from(data), {
      type: mimeType,
      name: filename,
    });

    const info = { mimetype: mimeType, size };
    const msgtype = mimeType.startsWith("image/") ? "m.image" : mimeType.startsWith("video/") ? "m.video" : "m.file";
    const mediaResponse = await intent.sendMessage(roomId, {
      msgtype,
      body: filename,
      url: mxcUri,
      info,
    });

    if (personaName && mediaResponse?.event_id) {
      trackSentMatrixEvent(mediaResponse.event_id, personaName);
    }
  } catch (error) {
    log.warn(`Matrix bridge: failed to send attachment to room ${roomId}`, error);
  }
}

export async function downloadAvatar(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(MATRIX_MEDIA_TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn(`Matrix appservice: avatar fetch failed (${response.status}) for ${url}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get("content-type") ?? "image/png";
    return { buffer: Buffer.from(arrayBuffer), mimeType };
  } catch (error) {
    log.warn(`Matrix appservice: failed to download avatar from ${url}`, error);
    return null;
  }
}

export async function downloadMatrixMedia(
  mxcUrl: string,
  homeserverUrl: string,
  asToken: string,
  knownSize?: number,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (knownSize !== undefined && knownSize > MATRIX_MAX_ATTACHMENT_BYTES) {
    return null;
  }

  const httpUrl = mxcToHttp(mxcUrl, homeserverUrl);
  if (!httpUrl) {
    log.warn(`Matrix bridge: could not resolve mxc URL: ${mxcUrl}`);
    return null;
  }

  try {
    const response = await fetch(httpUrl, {
      headers: { Authorization: `Bearer ${asToken}` },
      signal: AbortSignal.timeout(MATRIX_MEDIA_TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn(`Matrix bridge: media fetch failed (${response.status}) for ${httpUrl}`);
      return null;
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (contentLength > MATRIX_MAX_ATTACHMENT_BYTES) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MATRIX_MAX_ATTACHMENT_BYTES) {
      return null;
    }

    return {
      buffer,
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch (error) {
    log.warn(`Matrix bridge: failed to download media from ${httpUrl}`, error);
    return null;
  }
}

async function resolveSendIntent(roomId: string, personaName?: string, avatarUrl?: string | null): Promise<Intent> {
  const bridge = getMatrixBridge();
  if (!bridge) {
    throw new Error("Matrix bridge is not configured");
  }

  if (!personaName) {
    return bridge.getIntent();
  }

  const serverName = process.env.MATRIX_SERVER_NAME ?? "";
  const localpart = `_tomori_${personaName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  const userId = `@${localpart}:${serverName}`;
  const intent = (await getPersonaIntent(personaName, avatarUrl ?? null)) ?? bridge.getIntent();
  await ensurePersonaInRoom(intent, userId, localpart, roomId);
  return intent;
}

function mxcToHttp(mxcUrl: string, homeserverUrl: string): string | null {
  const match = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, serverHost, mediaId] = match;
  return `${homeserverUrl}/_matrix/client/v1/media/download/${serverHost}/${mediaId}`;
}
