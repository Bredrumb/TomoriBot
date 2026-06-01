import type { Intent } from "matrix-appservice-bridge";
import { isBridgeUserId } from "@/utils/bridges";
import { log } from "@/utils/misc/logger";
import { downloadAvatar } from "./media";
import {
  MATRIX_TYPING_TIMEOUT_MS,
  ensuredRoomMemberships,
  getMatrixBridge,
  matrixDisplayNameToId,
  provisionedIntents,
} from "./state";

export function getMatrixIdForDisplayName(displayName: string): string | undefined {
  return matrixDisplayNameToId.get(displayName);
}

export function getDisplayNameForMatrixId(matrixUserId: string): string | undefined {
  for (const [displayName, mappedId] of matrixDisplayNameToId.entries()) {
    if (mappedId === matrixUserId) {
      return displayName;
    }
  }
  return undefined;
}

export function rememberMatrixDisplayName(displayName: string, matrixUserId: string): void {
  matrixDisplayNameToId.set(displayName, matrixUserId);
}

export function resolveBridgeUserId(rawId: string): string {
  if (!rawId || isBridgeUserId(rawId) || /^\d+$/.test(rawId)) return rawId;

  if (rawId.includes(":") && !rawId.startsWith("@")) {
    const withAt = `@${rawId}`;
    if (isBridgeUserId(withAt)) {
      log.info(`Bridge: Restored missing @ prefix in user ID: "${rawId}" -> "${withAt}"`);
      return withAt;
    }
  }

  const resolved = matrixDisplayNameToId.get(rawId);
  if (resolved) {
    log.info(`Bridge: Resolved display name "${rawId}" -> "${resolved}"`);
    return resolved;
  }

  return rawId;
}

export async function getPersonaIntent(personaName: string, avatarUrl: string | null): Promise<Intent | null> {
  const bridge = getMatrixBridge();
  if (!bridge) return null;

  const serverName = process.env.MATRIX_SERVER_NAME;
  if (!serverName) return null;

  const localpart = `_tomori_${personaName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  const userId = `@${localpart}:${serverName}`;
  const intent = bridge.getIntent(userId);
  const cached = provisionedIntents.get(localpart);
  if (cached && cached.avatarUrl === avatarUrl) {
    return intent;
  }

  provisionedIntents.set(localpart, { avatarUrl });

  try {
    await intent.ensureRegistered();
    await intent.setDisplayName(personaName);

    if (avatarUrl) {
      const media = await downloadAvatar(avatarUrl);
      if (media) {
        const mxcUri = await intent.uploadContent(media.buffer, {
          type: media.mimeType,
          name: "avatar.png",
        });
        await intent.setAvatarUrl(mxcUri);
      }
    }

    log.info(`Matrix appservice: provisioned virtual user ${userId}`);
  } catch (error) {
    provisionedIntents.delete(localpart);
    log.warn(`Matrix appservice: failed to provision ${userId}`, error);
  }

  return intent;
}

export async function ensurePersonaInRoom(
  intent: Intent,
  userId: string,
  localpart: string,
  roomId: string,
): Promise<void> {
  const cacheKey = `${roomId}:${localpart}`;
  if (ensuredRoomMemberships.has(cacheKey)) return;

  try {
    const botIntent = getMatrixBridge()?.getIntent();
    if (botIntent) {
      try {
        await botIntent.invite(roomId, userId);
      } catch (error) {
        log.warn(`Matrix appservice: failed to invite ${userId} to ${roomId}`, error);
      }
    }

    await intent.join(roomId);
    ensuredRoomMemberships.add(cacheKey);
    log.info(`Matrix appservice: ${userId} joined room ${roomId}`);
  } catch (error) {
    const safeMsg = error instanceof Error ? error.message : String(error);
    log.warn(`Matrix appservice: failed to ensure ${userId} in ${roomId}: ${safeMsg}`);
  }
}

export async function sendMatrixTypingIndicator(roomId: string, personaName: string, isTyping: boolean): Promise<void> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const asToken = process.env.MATRIX_ACCESS_TOKEN;
  const serverName = process.env.MATRIX_SERVER_NAME;
  if (!homeserverUrl || !asToken || !serverName || !getMatrixBridge()) return;

  const localpart = `_tomori_${personaName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  const userId = `@${localpart}:${serverName}`;
  const encodedRoomId = encodeURIComponent(roomId);
  const encodedUserId = encodeURIComponent(userId);

  try {
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${encodedRoomId}/typing/${encodedUserId}?user_id=${encodedUserId}`;
    const body = JSON.stringify(isTyping ? { typing: true, timeout: MATRIX_TYPING_TIMEOUT_MS } : { typing: false });

    await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${asToken}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    log.warn(`Matrix typing indicator failed for ${userId} in ${roomId}`, error);
  }
}
