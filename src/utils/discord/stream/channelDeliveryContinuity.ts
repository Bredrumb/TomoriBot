import { formatRenderModifierWebhookName, NEUTRAL_APPEARANCE_MODIFIER } from "@/utils/discord/renderModifierParser";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { log } from "@/utils/misc/logger";
import { toGroupBreakName } from "@/utils/text/groupBreakName";

// Held outside per-call StreamState because Discord groups webhooks by webhook_id and username across turns, so all
// webhook callers must record sends here.

// Discord stops grouping consecutive same-author messages after a few minutes, so continuity
// beyond that window is pointless, so an expired entry is equivalent to a fresh channel.
const CONTINUITY_TTL_MS = 10 * 60 * 1000;

// Sprite keys can never contain parentheses (validatePersonaSpriteName rejects them), so this key
// cannot collide with a real sprite named "neutral" in the channel's group alternation.
const NEUTRAL_APPEARANCE_GROUP_KEY = "(neutral)";

// Housekeeping (not an operational limit): channels are unbounded, so sweep expired entries
// once the map grows past this size rather than wiring up a timer.
const SWEEP_SIZE_THRESHOLD = 2000;

type DeliveredSpeakerKind = "appearance" | "identity_sprite" | "copied";

export interface DeliveredSpeaker {
  // Sentinel null means the speaker has no single persona, so two null deliveries never match as the same speaker.
  personaId: number | null;
  kind: DeliveredSpeakerKind;
}

export type ChannelLastDelivery =
  | { via: "webhook"; identity: ResolvedWebhookIdentity; speaker: DeliveredSpeaker | null; webhookId: string }
  | { via: "bot"; speaker: DeliveredSpeaker | null };

interface ChannelDeliveryState {
  lastSpriteKey: string | null;
  groupParity: boolean;
  lastWebhookIdentity: ResolvedWebhookIdentity | null;
  lastWebhookId: string | null;
  // Holds only webhook message IDs so null after a bot message blocks adjacency, because a bot message breaks any
  // Discord webhook group.
  lastDeliveredMessageId: string | null;
  lastDeliveryVia: "webhook" | "bot" | null;
  lastSpeaker: DeliveredSpeaker | null;
  updatedAt: number;
}

const channelDeliveryStates = new Map<string, ChannelDeliveryState>();

function sweepExpiredEntries(now: number): void {
  for (const [channelId, entry] of channelDeliveryStates) {
    if (now - entry.updatedAt >= CONTINUITY_TTL_MS) {
      channelDeliveryStates.delete(channelId);
    }
  }
}

// Stale entries are discarded rather than refreshed so the channel restarts on the clean username once Discord's
// grouping window has passed.
function getLiveEntry(channelId: string, now: number): ChannelDeliveryState {
  if (channelDeliveryStates.size >= SWEEP_SIZE_THRESHOLD) {
    sweepExpiredEntries(now);
  }

  const existing = channelDeliveryStates.get(channelId);
  if (existing && now - existing.updatedAt < CONTINUITY_TTL_MS) {
    return existing;
  }

  const fresh: ChannelDeliveryState = {
    lastSpriteKey: null,
    groupParity: false,
    lastWebhookIdentity: null,
    lastWebhookId: null,
    lastDeliveredMessageId: null,
    lastDeliveryVia: null,
    lastSpeaker: null,
    updatedAt: now,
  };
  channelDeliveryStates.set(channelId, fresh);
  return fresh;
}

// Compares snowflake order instead of equality because channel.lastMessageId can lag REST sends, so lagged reads stay
// adjacent and prevent merged avatars.
function hasForeignMessageSinceDelivery(
  deliveredMessageId: string | null,
  channelLastMessageId: string | null,
): boolean {
  if (deliveredMessageId === null) return true;
  if (channelLastMessageId === null) return false;

  try {
    return BigInt(channelLastMessageId) > BigInt(deliveredMessageId);
  } catch {
    // A non-numeric id should be impossible, so assume adjacency and keep the group break.
    return false;
  }
}

// Parity flips only when spriteKey changes and resets after any intervening message because Discord only groups
// directly adjacent messages.
export function advanceChannelSpriteGroupParity(
  channelId: string,
  spriteKey: string,
  channelLastMessageId: string | null,
): boolean {
  const now = Date.now();
  const entry = getLiveEntry(channelId, now);
  entry.updatedAt = now;

  if (hasForeignMessageSinceDelivery(entry.lastDeliveredMessageId, channelLastMessageId)) {
    entry.lastSpriteKey = null;
    entry.groupParity = false;
  }

  // A null previous key means this sprite is the channel's first in the current window, so it
  // stays on the clean name, so there is nothing before it to collide with.
  if (entry.lastSpriteKey !== null && entry.lastSpriteKey !== spriteKey) {
    entry.groupParity = !entry.groupParity;
  }
  entry.lastSpriteKey = spriteKey;
  return entry.groupParity;
}

// Discord strips zero-width/blank characters from webhook usernames, so group breaks substitute lookalike letters and
// fall back to fallbackDecoratedUsername.
export function resolveChannelGroupBreakIdentity(
  channelId: string,
  identity: ResolvedWebhookIdentity,
  fallbackDecoratedUsername: string,
  groupKey: string,
  channelLastMessageId: string | null,
): ResolvedWebhookIdentity {
  if (!advanceChannelSpriteGroupParity(channelId, groupKey, channelLastMessageId)) {
    return identity;
  }
  const groupBreakName = identity.username ? toGroupBreakName(identity.username) : null;
  return { ...identity, username: groupBreakName ?? fallbackDecoratedUsername };
}

export function resolveChannelBaseAppearanceIdentity(
  channelId: string,
  baseIdentity: ResolvedWebhookIdentity,
  sourceDisplayName: string,
  channelLastMessageId: string | null,
): ResolvedWebhookIdentity {
  return resolveChannelGroupBreakIdentity(
    channelId,
    baseIdentity,
    formatRenderModifierWebhookName(sourceDisplayName, NEUTRAL_APPEARANCE_MODIFIER),
    NEUTRAL_APPEARANCE_GROUP_KEY,
    channelLastMessageId,
  );
}

export function getAdjacentPersonaIdentity(
  channelId: string,
  personaId: number | null,
  channelLastMessageId: string | null,
): ResolvedWebhookIdentity | null {
  const entry = getLiveEntry(channelId, Date.now());
  const last = getChannelLastDelivery(channelId);
  const previousIdentity = last?.via === "webhook" ? last.identity : null;
  const continuesOwnLine =
    previousIdentity !== null &&
    personaId !== null &&
    entry.lastSpeaker !== null &&
    entry.lastSpeaker.kind !== "copied" &&
    entry.lastSpeaker.personaId === personaId &&
    !hasForeignMessageSinceDelivery(entry.lastDeliveredMessageId, channelLastMessageId);
  if (previousIdentity && continuesOwnLine) {
    return { ...previousIdentity };
  }
  return null;
}

// Stores the exact delivered username (including any group-break variant) because re-resolving the clean name on
// later segments would split the Discord group.
export function recordChannelDeliveredWebhookIdentity(
  channelId: string,
  identity: ResolvedWebhookIdentity,
  messageId: string,
  speaker: DeliveredSpeaker | null,
  webhookId: string,
): void {
  const now = Date.now();
  const entry = getLiveEntry(channelId, now);
  entry.lastWebhookIdentity = { ...identity };
  entry.lastWebhookId = webhookId;
  entry.lastDeliveredMessageId = messageId;
  entry.lastDeliveryVia = "webhook";
  entry.lastSpeaker = speaker ? { ...speaker } : null;
  entry.updatedAt = now;
}

export function recordChannelDeliveredBotMessage(channelId: string, speaker: DeliveredSpeaker | null = null): void {
  const now = Date.now();
  const entry = getLiveEntry(channelId, now);
  entry.lastWebhookIdentity = null;
  entry.lastWebhookId = null;
  entry.lastDeliveredMessageId = null;
  entry.lastDeliveryVia = "bot";
  entry.lastSpeaker = speaker ? { ...speaker } : null;
  entry.updatedAt = now;
}

export function getChannelLastDelivery(channelId: string): ChannelLastDelivery | null {
  const entry = channelDeliveryStates.get(channelId);
  if (!entry || Date.now() - entry.updatedAt >= CONTINUITY_TTL_MS) {
    return null;
  }
  if (entry.lastDeliveryVia === "bot") {
    return { via: "bot", speaker: entry.lastSpeaker };
  }
  if (entry.lastDeliveryVia === "webhook" && entry.lastWebhookIdentity && entry.lastWebhookId) {
    return {
      via: "webhook",
      identity: entry.lastWebhookIdentity,
      speaker: entry.lastSpeaker,
      webhookId: entry.lastWebhookId,
    };
  }
  return null;
}

export function clearAllChannelDeliveryContinuity(): void {
  const cleared = channelDeliveryStates.size;
  channelDeliveryStates.clear();
  if (cleared > 0) {
    log.info(`Cleared delivery continuity for ${cleared} channel(s).`);
  }
}
