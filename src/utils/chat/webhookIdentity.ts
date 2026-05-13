import type { Client, Guild, Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { extractBridgeUserId, stripBridgePrefix } from "@/utils/bridges";

const USER_IMPERSONATION_WEBHOOK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedWebhookRelayKind = "user_impersonation";

type CachedWebhookRelay = {
  userId: string;
  kind: CachedWebhookRelayKind;
  cachedAt: number;
};

const webhookRelayCache = new Map<string, CachedWebhookRelay>();

function cacheWebhookRelay(webhookId: string, userId: string, kind: CachedWebhookRelayKind): void {
  if (!webhookId || !userId) {
    return;
  }

  webhookRelayCache.set(webhookId, {
    userId,
    kind,
    cachedAt: Date.now(),
  });
}

export function cacheUserImpersonationWebhook(webhookId: string, userId: string): void {
  cacheWebhookRelay(webhookId, userId, "user_impersonation");
}

function getCachedWebhookRelay(webhookId: string | null | undefined): CachedWebhookRelay | null {
  if (!webhookId) {
    return null;
  }

  const cached = webhookRelayCache.get(webhookId);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAt > USER_IMPERSONATION_WEBHOOK_CACHE_TTL_MS) {
    webhookRelayCache.delete(webhookId);
    return null;
  }

  return cached;
}

export function getCachedImpersonatedUserIdForWebhook(webhookId: string | null | undefined): string | null {
  const cachedRelay = getCachedWebhookRelay(webhookId);
  if (!cachedRelay || cachedRelay.kind !== "user_impersonation") {
    return null;
  }

  return cachedRelay.userId;
}

export function normalizeIdentityName(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

export function normalizeAvatarUrlForMatch(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    parsed.search = "";
    return parsed.toString();
  } catch {
    const trimmed = value.split("?")[0]?.trim();
    return trimmed || null;
  }
}

function resolveImpersonatedUserIdByWebhookIdentity(
  guild: Guild | null | undefined,
  webhookDisplayName: string,
  webhookAvatarUrl?: string | null,
): string | null {
  if (!guild) {
    return null;
  }

  const normalizedWebhookName = normalizeIdentityName(webhookDisplayName);
  if (!normalizedWebhookName) {
    return null;
  }

  const matchingMembers = Array.from(guild.members.cache.values()).filter((member) => {
    if (member.user.bot) return false;

    const candidateNames = [member.displayName, member.user.displayName, member.user.globalName, member.user.username]
      .map((name) => normalizeIdentityName(name))
      .filter((name) => name.length > 0);

    return candidateNames.includes(normalizedWebhookName);
  });

  if (matchingMembers.length === 1) {
    return matchingMembers[0].id;
  }

  if (matchingMembers.length === 0) {
    return null;
  }

  const normalizedWebhookAvatar = normalizeAvatarUrlForMatch(webhookAvatarUrl);
  if (!normalizedWebhookAvatar) {
    return null;
  }

  const avatarMatches = matchingMembers.filter((member) => {
    const memberAvatarUrl = member.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: true,
    });
    return normalizeAvatarUrlForMatch(memberAvatarUrl) === normalizedWebhookAvatar;
  });

  return avatarMatches.length === 1 ? avatarMatches[0].id : null;
}

export async function resolveImpersonatedIdentity(
  client: Client,
  guild: Guild | null | undefined,
  userId: string,
  fallbackName?: string | null,
): Promise<{ displayName: string; avatarUrl?: string }> {
  const guildMember = guild
    ? (guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null)))
    : null;
  const discordUser = guildMember?.user || (await client.users.fetch(userId).catch(() => null));

  const displayName =
    guildMember?.displayName ||
    discordUser?.displayName ||
    discordUser?.globalName ||
    discordUser?.username ||
    fallbackName ||
    "User";
  const avatarUrl =
    guildMember?.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: true,
    }) ||
    discordUser?.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: true,
    }) ||
    undefined;

  return {
    displayName,
    avatarUrl,
  };
}

export function resolveReferencedWebhookTarget(
  referenceMessage: Message,
  personaByNickname: Map<string, TomoriState>,
  guild: Guild | null | undefined,
): { replyPersona: TomoriState | null; impersonatedUserId: string | null } {
  if (!referenceMessage.webhookId) {
    return { replyPersona: null, impersonatedUserId: null };
  }

  const cachedRelay = getCachedWebhookRelay(referenceMessage.webhookId);
  const rawWebhookName = referenceMessage.author.username;
  if (rawWebhookName && !extractBridgeUserId(rawWebhookName)) {
    const webhookName = stripBridgePrefix(rawWebhookName);
    const matchedPersona = personaByNickname.get(webhookName.toLowerCase());
    if (matchedPersona) {
      return { replyPersona: matchedPersona, impersonatedUserId: null };
    }
  }

  if (cachedRelay?.kind === "user_impersonation") {
    return {
      replyPersona: null,
      impersonatedUserId: cachedRelay.userId,
    };
  }

  if (!rawWebhookName || extractBridgeUserId(rawWebhookName)) {
    return { replyPersona: null, impersonatedUserId: null };
  }

  if (!cachedRelay) {
    return { replyPersona: null, impersonatedUserId: null };
  }

  const webhookName = stripBridgePrefix(rawWebhookName);
  const webhookAvatarUrl = referenceMessage.author.displayAvatarURL({
    size: 1024,
    extension: "png",
    forceStatic: true,
  });

  const impersonatedUserId = resolveImpersonatedUserIdByWebhookIdentity(guild, webhookName, webhookAvatarUrl);

  return {
    replyPersona: null,
    impersonatedUserId,
  };
}
