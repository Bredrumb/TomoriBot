import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import {
  MATRIX_LINK_CACHE_TTL_MS,
  MATRIX_MEDIA_TIMEOUT_MS,
  channelLinkCache,
  getMatrixBridge,
  roomLinkCache,
} from "./state";

export async function joinMatrixRoom(roomId: string): Promise<void> {
  const bridge = getMatrixBridge();
  if (!bridge) return;

  await bridge.getIntent().join(roomId, getJoinViaServers(roomId));
}

export function getJoinViaServers(roomId: string): string[] | undefined {
  const localServer = process.env.MATRIX_SERVER_NAME?.trim();
  const roomDelimiter = roomId.indexOf(":");
  const roomServer = roomDelimiter === -1 ? undefined : roomId.slice(roomDelimiter + 1).trim();
  const viaServers = new Set<string>();
  if (roomServer) viaServers.add(roomServer);
  if (localServer) viaServers.add(localServer);
  const list = Array.from(viaServers);
  return list.length > 0 ? list : undefined;
}

export async function getLinkedMatrixRoom(channelDiscId: string): Promise<string | null> {
  const now = Date.now();
  const cached = channelLinkCache.get(channelDiscId);
  if (cached && now - cached.cachedAt < MATRIX_LINK_CACHE_TTL_MS) {
    return cached.roomId;
  }

  const [row] = await sql<{ matrix_room_id: string }[]>`
    SELECT matrix_room_id
    FROM matrix_channel_links
    WHERE channel_disc_id = ${channelDiscId}
    LIMIT 1
  `;

  const roomId = row?.matrix_room_id ?? null;
  channelLinkCache.set(channelDiscId, { roomId, cachedAt: now });
  return roomId;
}

export async function getDiscordChannelForRoom(matrixRoomId: string): Promise<string | null> {
  const now = Date.now();
  const cached = roomLinkCache.get(matrixRoomId);
  if (cached && now - cached.cachedAt < MATRIX_LINK_CACHE_TTL_MS) {
    return cached.channelDiscId;
  }

  const [row] = await sql<{ channel_disc_id: string }[]>`
    SELECT channel_disc_id
    FROM matrix_channel_links
    WHERE matrix_room_id = ${matrixRoomId}
    LIMIT 1
  `;

  const channelDiscId = row?.channel_disc_id ?? null;
  roomLinkCache.set(matrixRoomId, { channelDiscId, cachedAt: now });
  return channelDiscId;
}

export async function isRoomEncrypted(roomId: string): Promise<boolean> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const asToken = process.env.MATRIX_ACCESS_TOKEN;
  if (!homeserverUrl || !asToken) return false;

  try {
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${asToken}` },
      signal: AbortSignal.timeout(MATRIX_MEDIA_TIMEOUT_MS),
    });
    return response.ok;
  } catch (error) {
    log.warn(`Matrix bridge: failed to check encryption state for room ${roomId}`, error);
    return false;
  }
}

export function invalidateMatrixLinkCache(channelDiscId: string, matrixRoomId?: string): void {
  channelLinkCache.delete(channelDiscId);
  if (matrixRoomId) {
    roomLinkCache.delete(matrixRoomId);
  }
}
