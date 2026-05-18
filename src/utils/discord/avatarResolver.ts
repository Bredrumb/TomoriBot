import type { ToolContext } from "@/types/tool/interfaces";
import type { Webhook } from "discord.js";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { log } from "@/utils/misc/logger";
import { resolvePersonaAvatarPublicUrl } from "@/utils/storage/avatarStorage";
import { normalizeUserTargetInput, resolveUserTarget } from "@/utils/discord/targetResolver";

export type ResolvedAvatarData = {
  sourceType: "user" | "webhook" | "persona";
  username: string;
  avatarUrl: string;
  bannerUrl?: string | null;
  serverNickname?: string;
};

type AvatarResolverOptions = {
  forceStatic: boolean;
};

const DEFAULT_AVATAR_RESOLVER_OPTIONS: AvatarResolverOptions = {
  forceStatic: true,
};

function isNotFoundError(error: Error): boolean {
  return (
    error.message.includes("Unknown User") ||
    error.message.includes("Unknown Webhook") ||
    error.message.includes("Unknown Message") ||
    error.message.includes("not found")
  );
}

function parsePersonaIdentifier(id: string): number | null {
  const trimmed = id.trim();
  const prefixed = /^persona:(\d+)$/i.exec(trimmed);
  const rawNumeric = /^\d{1,10}$/.test(trimmed) ? trimmed : null;
  const candidate = prefixed?.[1] ?? rawNumeric;
  if (!candidate) return null;

  const parsed = Number.parseInt(candidate, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLegacyAvatarIdentity(id: string): boolean {
  const trimmed = id.trim();
  return (
    trimmed.toLowerCase() === "self" ||
    /^\d{17,19}$/.test(trimmed) ||
    /^persona:\d+$/i.test(trimmed) ||
    /^\d{1,10}$/.test(trimmed)
  );
}

function normalizeAvatarTargetId(id: string, context: ToolContext): string {
  const trimmed = id.trim();
  const activePersonaId = context.tomoriState.persona_id;
  if (activePersonaId == null) {
    return trimmed;
  }

  if (trimmed.toLowerCase() === "self") {
    return `persona:${activePersonaId}`;
  }

  const botUserId = context.client.user?.id;
  if (botUserId && trimmed === botUserId) {
    log.info(`[Avatar Resolver] Remapped bot user ID ${trimmed} to active persona persona:${activePersonaId}`);
    return `persona:${activePersonaId}`;
  }

  return trimmed;
}

type WebhookFetchCapableChannel = {
  id: string;
  fetchWebhooks: () => Promise<import("discord.js").Collection<string, Webhook>>;
};

function isWebhookFetchCapableChannel(channel: unknown): channel is WebhookFetchCapableChannel {
  if (typeof channel !== "object" || channel === null) {
    return false;
  }

  if (!("fetchWebhooks" in channel)) {
    return false;
  }

  return typeof (channel as { fetchWebhooks?: unknown }).fetchWebhooks === "function";
}

function buildWebhookAvatarData(
  webhook: Webhook,
  forceStatic: boolean,
  personaAvatarUrl?: string,
  fallbackBotAvatarUrl?: string,
): ResolvedAvatarData | null {
  const avatarUrl =
    webhook.avatarURL({
      size: 1024,
      extension: "png",
      forceStatic,
    }) ??
    personaAvatarUrl ??
    fallbackBotAvatarUrl;

  if (!avatarUrl) {
    return null;
  }

  return {
    sourceType: "webhook",
    username: webhook.name ?? `Webhook ${webhook.id}`,
    avatarUrl,
  };
}

async function resolveUserAvatar(
  id: string,
  context: ToolContext,
  options: AvatarResolverOptions,
): Promise<ResolvedAvatarData> {
  const user = await context.client.users.fetch(id, { force: true });
  let avatarUrl: string;
  const bannerUrl =
    user.bannerURL({
      size: 1024,
      extension: "png",
      forceStatic: options.forceStatic,
    }) ?? null;
  let serverNickname: string | undefined;

  if (context.guildId) {
    const guild = context.client.guilds.cache.get(context.guildId);
    if (guild) {
      const member = await guild.members.fetch(id).catch(() => null);
      if (member) {
        avatarUrl = member.displayAvatarURL({
          size: 1024,
          extension: "png",
          forceStatic: options.forceStatic,
        });
        serverNickname = member.nickname ?? undefined;
      } else {
        avatarUrl = user.displayAvatarURL({
          size: 1024,
          extension: "png",
          forceStatic: options.forceStatic,
        });
      }
    } else {
      avatarUrl = user.displayAvatarURL({
        size: 1024,
        extension: "png",
        forceStatic: options.forceStatic,
      });
    }
  } else {
    avatarUrl = user.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: options.forceStatic,
    });
  }

  return {
    sourceType: "user",
    username: user.username,
    avatarUrl,
    bannerUrl,
    serverNickname,
  };
}

async function resolveWebhookAvatarFromChannel(
  channel: WebhookFetchCapableChannel,
  id: string,
): Promise<Webhook | null> {
  try {
    const webhooks = await channel.fetchWebhooks();
    return webhooks.get(id) ?? null;
  } catch (error) {
    log.warn(`[Avatar Resolver] Failed to fetch webhooks for channel ${channel.id} while resolving ${id}`, error);
    return null;
  }
}

async function resolveWebhookAvatar(
  id: string,
  context: ToolContext,
  options: AvatarResolverOptions,
): Promise<ResolvedAvatarData | null> {
  const fallbackBotAvatarUrl = context.client.user?.displayAvatarURL({
    size: 1024,
    extension: "png",
    forceStatic: options.forceStatic,
  });

  if (context.webhook?.id === id) {
    const fromContext = buildWebhookAvatarData(
      context.webhook,
      options.forceStatic,
      context.personaAvatarUrl,
      fallbackBotAvatarUrl,
    );
    if (fromContext) {
      return fromContext;
    }
  }

  if (isWebhookFetchCapableChannel(context.channel)) {
    const channelWebhook = await resolveWebhookAvatarFromChannel(context.channel, id);
    if (channelWebhook) {
      const fromChannel = buildWebhookAvatarData(
        channelWebhook,
        options.forceStatic,
        context.personaAvatarUrl,
        fallbackBotAvatarUrl,
      );
      if (fromChannel) {
        return fromChannel;
      }
    }
  }

  const directWebhook = await context.client.fetchWebhook(id).catch(() => null);
  if (directWebhook) {
    const directResult = buildWebhookAvatarData(
      directWebhook,
      options.forceStatic,
      context.personaAvatarUrl,
      fallbackBotAvatarUrl,
    );
    if (directResult) {
      return directResult;
    }
  }

  if (!context.guildId) {
    return null;
  }

  const guild = context.client.guilds.cache.get(context.guildId);
  if (!guild) {
    return null;
  }

  for (const guildChannel of guild.channels.cache.values()) {
    if (!isWebhookFetchCapableChannel(guildChannel)) {
      continue;
    }

    const webhook = await resolveWebhookAvatarFromChannel(guildChannel, id);
    if (!webhook) {
      continue;
    }

    const fromGuildScan = buildWebhookAvatarData(
      webhook,
      options.forceStatic,
      context.personaAvatarUrl,
      fallbackBotAvatarUrl,
    );
    if (fromGuildScan) {
      return fromGuildScan;
    }
  }

  return null;
}

async function resolvePersonaAvatar(
  personaId: number,
  context: ToolContext,
  options: AvatarResolverOptions,
): Promise<ResolvedAvatarData | null> {
  const guildId = context.guildId;
  if (!guildId) {
    return null;
  }

  const allPersonas = await getCachedAllPersonas(guildId).catch((error) => {
    log.warn(
      `[Avatar Resolver] Failed to load personas for guild ${guildId} while resolving persona:${personaId}`,
      error,
    );
    return [];
  });
  const persona = allPersonas.find((entry) => entry.persona_id === personaId);
  if (!persona) {
    return null;
  }

  let avatarUrl: string | null = null;

  if (persona.is_alter) {
    avatarUrl = resolvePersonaAvatarPublicUrl(persona.webhook_avatar_url) ?? null;
  } else {
    const guild = context.client.guilds.cache.get(guildId);
    avatarUrl =
      guild?.iconURL({
        size: 1024,
        extension: "png",
        forceStatic: options.forceStatic,
      }) ??
      resolvePersonaAvatarPublicUrl(persona.webhook_avatar_url) ??
      null;
  }

  if (!avatarUrl && context.personaUsername === persona.persona_nickname) {
    avatarUrl = context.personaAvatarUrl ?? null;
  }

  if (!avatarUrl && context.webhook && context.personaUsername === persona.persona_nickname) {
    avatarUrl =
      context.webhook.avatarURL({
        size: 1024,
        extension: "png",
        forceStatic: options.forceStatic,
      }) ?? null;
  }

  if (!avatarUrl) {
    avatarUrl =
      context.client.user?.displayAvatarURL({
        size: 1024,
        extension: "png",
        forceStatic: options.forceStatic,
      }) ?? null;
  }

  if (!avatarUrl) {
    return null;
  }

  return {
    sourceType: "persona",
    username: persona.persona_nickname,
    avatarUrl,
  };
}

function formatAmbiguousLabels(labels: string[]): string {
  return labels.slice(0, 3).join(", ");
}

export async function resolveAvatarByIdentity(
  targetIdentity: string,
  context: ToolContext,
  options?: Partial<AvatarResolverOptions>,
): Promise<ResolvedAvatarData> {
  const resolvedOptions: AvatarResolverOptions = {
    ...DEFAULT_AVATAR_RESOLVER_OPTIONS,
    ...options,
  };
  const trimmedIdentity = targetIdentity.trim();

  if (!trimmedIdentity) {
    throw new Error("Avatar target cannot be empty");
  }

  if (isLegacyAvatarIdentity(trimmedIdentity)) {
    return await resolveAvatarByDiscordId(trimmedIdentity, context, resolvedOptions);
  }

  const normalizedIdentity = normalizeUserTargetInput(trimmedIdentity);
  const guildId = context.guildId;
  const personaMatches: Array<{ personaId: number; nickname: string }> = [];

  if (guildId) {
    const allPersonas = await getCachedAllPersonas(guildId).catch((error) => {
      log.warn(
        `[Avatar Resolver] Failed to load personas for guild ${guildId} while resolving "${trimmedIdentity}"`,
        error,
      );
      return [];
    });

    for (const persona of allPersonas) {
      if (persona.persona_id == null) {
        continue;
      }

      if (normalizeUserTargetInput(persona.persona_nickname) === normalizedIdentity) {
        personaMatches.push({
          personaId: persona.persona_id,
          nickname: persona.persona_nickname,
        });
      }
    }
  }

  const uniquePersonaMatches = personaMatches.filter(
    (candidate, index, array) => array.findIndex((entry) => entry.personaId === candidate.personaId) === index,
  );

  const userResolution = await resolveUserTarget(trimmedIdentity, context);

  if (uniquePersonaMatches.length > 1) {
    throw new Error(
      `Ambiguous avatar target "${trimmedIdentity}". It matches multiple personas: ${formatAmbiguousLabels(uniquePersonaMatches.map((candidate) => candidate.nickname))}.`,
    );
  }

  if (uniquePersonaMatches.length === 1 && userResolution.status === "resolved") {
    const [matchedPersona] = uniquePersonaMatches;
    throw new Error(
      `Ambiguous avatar target "${trimmedIdentity}". It matches both persona "${matchedPersona?.nickname}" and user "${userResolution.displayLabel}".`,
    );
  }

  if (uniquePersonaMatches.length === 1) {
    const [matchedPersona] = uniquePersonaMatches;
    if (!matchedPersona) {
      throw new Error(`No persona found with the name "${trimmedIdentity}"`);
    }

    const personaAvatar = await resolvePersonaAvatar(matchedPersona.personaId, context, resolvedOptions);
    if (personaAvatar) {
      return personaAvatar;
    }
    throw new Error(`No persona found with the name "${matchedPersona.nickname}"`);
  }

  if (userResolution.status === "ambiguous") {
    throw new Error(
      `Ambiguous avatar target "${trimmedIdentity}". Candidates: ${formatAmbiguousLabels(userResolution.candidates.map((candidate) => candidate.label))}.`,
    );
  }

  if (userResolution.status === "resolved") {
    if (userResolution.isBridgeUser) {
      throw new Error(`Cannot fetch an avatar for bridge user "${userResolution.displayLabel}".`);
    }

    return await resolveUserAvatar(userResolution.targetId, context, resolvedOptions);
  }

  const personaNameHint =
    guildId && context.personaUsername && normalizeUserTargetInput(context.personaUsername) === normalizedIdentity
      ? ` or active persona "${context.personaUsername}"`
      : "";
  throw new Error(`No user${personaNameHint} found matching "${trimmedIdentity}"`);
}

export async function resolveAvatarByDiscordId(
  id: string,
  context: ToolContext,
  options?: Partial<AvatarResolverOptions>,
): Promise<ResolvedAvatarData> {
  const resolvedOptions: AvatarResolverOptions = {
    ...DEFAULT_AVATAR_RESOLVER_OPTIONS,
    ...options,
  };
  const normalizedId = normalizeAvatarTargetId(id, context);

  const personaId = parsePersonaIdentifier(normalizedId);
  if (personaId !== null) {
    const personaAvatar = await resolvePersonaAvatar(personaId, context, resolvedOptions);
    if (personaAvatar) {
      log.info(`[Avatar Resolver] Resolved ID ${id} as persona avatar (${personaAvatar.username}) via ${normalizedId}`);
      return personaAvatar;
    }
    throw new Error(`No persona found with persona_id ${personaId}`);
  }

  try {
    return await resolveUserAvatar(normalizedId, context, resolvedOptions);
  } catch (userError) {
    const userErrorObj =
      userError instanceof Error ? userError : new Error("Unknown error while resolving user avatar");
    const webhookAvatar = await resolveWebhookAvatar(normalizedId, context, resolvedOptions);

    if (webhookAvatar) {
      log.info(`[Avatar Resolver] Resolved ID ${id} as webhook avatar (${webhookAvatar.username}) via ${normalizedId}`);
      return webhookAvatar;
    }

    if (!isNotFoundError(userErrorObj)) {
      throw new Error(`${userErrorObj.message} (and no matching webhook was found for ID ${normalizedId})`);
    }

    throw new Error(`No Discord user or webhook found with ID ${normalizedId}`);
  }
}
