import type * as MatrixAppserviceBridge from "matrix-appservice-bridge";

export const MATRIX_TEXT_MSG_TYPE = "m.room" + ".message";
export const MATRIX_MEMBER_EVENT_TYPE = "m.room" + ".member";
export const MATRIX_LINK_CACHE_TTL_MS = Number.parseInt(process.env.MATRIX_LINK_CACHE_TTL_MINUTES || "5", 10) * 60_000;
export const MATRIX_MAX_ATTACHMENT_BYTES =
  Number.parseInt(process.env.MATRIX_MAX_ATTACHMENT_MB || "8", 10) * 1024 * 1024;
export const MATRIX_MEDIA_TIMEOUT_MS = Number.parseInt(process.env.MATRIX_MEDIA_TIMEOUT_MS || "15000", 10);
export const MATRIX_TYPING_TIMEOUT_MS = Number.parseInt(process.env.MATRIX_TYPING_TIMEOUT_MS || "60000", 10);
export const MATRIX_MAX_TRACKED_SENT_EVENTS = Number.parseInt(process.env.MATRIX_MAX_TRACKED_SENT_EVENTS || "500", 10);

export type SentPersonaReplyEvent = {
  personaName: string;
  replySnippet?: string;
};

let matrixBridge: MatrixAppserviceBridge.Bridge | null = null;

export const channelLinkCache = new Map<string, { roomId: string | null; cachedAt: number }>();
export const roomLinkCache = new Map<string, { channelDiscId: string | null; cachedAt: number }>();
export const provisionedIntents = new Map<string, { avatarUrl: string | null }>();
export const ensuredRoomMemberships = new Set<string>();
export const sentEventPersonas = new Map<string, SentPersonaReplyEvent>();
export const matrixDisplayNameToId = new Map<string, string>();
export const pendingMatrixReplyChannels = new Set<string>();

export function getMatrixBridge(): MatrixAppserviceBridge.Bridge | null {
  return matrixBridge;
}

export function setMatrixBridge(bridge: MatrixAppserviceBridge.Bridge | null): void {
  matrixBridge = bridge;
}
