import type { Guild } from "discord.js";
import type { PersonaSpriteRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag, type ConversationUserReference } from "@/types/misc/context";
import type { StreamContext } from "@/types/stream/interfaces";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { getCachedPersonaSprites } from "@/utils/cache/personaSpriteCache";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { resolveImpersonatedIdentity } from "@/utils/chat/webhookIdentity";
import { formatRenderModifierWebhookName, normalizeRenderModifierName } from "@/utils/discord/renderModifierParser";
import { resolvePersonaWebhookIdentity } from "@/utils/discord/webhook/identity";
import { log } from "@/utils/misc/logger";
import { normalizePersonaSpriteKey } from "@/utils/persona/sprites";
import {
  isLocalPersonaAvatarPath,
  loadStoredPersonaAvatarDataUri,
  resolvePersonaAvatarPublicUrl,
} from "@/utils/storage/avatarStorage";

type CopiedRenderCandidate =
  | {
      kind: "persona";
      key: string;
      displayName: string;
      persona: TomoriState;
    }
  | {
      kind: "user";
      key: string;
      displayName: string;
      aliases: string[];
      userId: string;
    };

export type CopiedRenderTarget = {
  displayName: string;
  identity: ResolvedWebhookIdentity;
};

export type SpriteRenderModifierResolution =
  | { status: "not_found" }
  | {
      status: "matched";
      target: CopiedRenderTarget | null;
    };

function getStreamGuild(context: StreamContext): Guild | null {
  return (context.channel as { guild?: Guild | null }).guild ?? null;
}

function isDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value.trim());
}

function getConversationUserReferences(context: StreamContext): ConversationUserReference[] {
  const references: ConversationUserReference[] = [];
  for (const item of context.contextItems) {
    if (item.metadataTag !== ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION || !item.conversationUsers?.length) {
      continue;
    }
    references.push(...item.conversationUsers);
  }
  return references;
}

function candidateMatches(candidate: CopiedRenderCandidate, normalizedModifier: string): boolean {
  if (normalizeRenderModifierName(candidate.displayName) === normalizedModifier) {
    return true;
  }

  if (candidate.kind === "persona") {
    return normalizeRenderModifierName(candidate.persona.persona_nickname) === normalizedModifier;
  }

  return candidate.aliases.some((alias) => normalizeRenderModifierName(alias) === normalizedModifier);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function resolveSpriteIdentity(
  sprite: PersonaSpriteRow,
  sourceDisplayName: string,
): Promise<ResolvedWebhookIdentity | null> {
  const username = formatRenderModifierWebhookName(sourceDisplayName, sprite.sprite_name);
  const avatarReference = sprite.avatar_url.trim();
  const publicAvatarUrl = resolvePersonaAvatarPublicUrl(avatarReference);
  if (publicAvatarUrl && isValidHttpUrl(publicAvatarUrl)) {
    return {
      username,
      avatarUrl: publicAvatarUrl,
    };
  }

  if (isLocalPersonaAvatarPath(avatarReference)) {
    const avatarDataUri = await loadStoredPersonaAvatarDataUri(avatarReference);
    if (avatarDataUri) {
      return {
        username,
        avatarDataUri,
      };
    }
  }

  if (isValidHttpUrl(avatarReference)) {
    return {
      username,
      avatarUrl: avatarReference,
    };
  }

  log.warn(`Persona sprite ${sprite.sprite_id ?? "unknown"} for persona ${sprite.persona_id} has no usable avatar`);
  return null;
}

function addCandidate(candidatesByKey: Map<string, CopiedRenderCandidate>, candidate: CopiedRenderCandidate): void {
  if (!candidatesByKey.has(candidate.key)) {
    candidatesByKey.set(candidate.key, candidate);
  }
}

async function collectCopiedRenderCandidates(context: StreamContext): Promise<CopiedRenderCandidate[]> {
  const guild = getStreamGuild(context);
  if (!guild) {
    return [];
  }

  const candidatesByKey = new Map<string, CopiedRenderCandidate>();
  const personas = await getCachedAllPersonas(guild.id).catch((error) => {
    log.warn(`Failed to load personas while resolving render modifier in guild ${guild.id}`, error);
    return [];
  });

  for (const persona of personas) {
    if (persona.persona_id == null || persona.persona_id === context.tomoriState.persona_id) {
      continue;
    }
    addCandidate(candidatesByKey, {
      kind: "persona",
      key: `persona:${persona.persona_id}`,
      displayName: persona.persona_nickname,
      persona,
    });
  }

  for (const reference of getConversationUserReferences(context)) {
    if (!isDiscordSnowflake(reference.targetId)) {
      continue;
    }

    addCandidate(candidatesByKey, {
      kind: "user",
      key: `user:${reference.targetId}`,
      displayName: reference.displayLabel,
      aliases: reference.aliases,
      userId: reference.targetId,
    });
  }

  return [...candidatesByKey.values()];
}

export async function resolveCopiedRenderModifierTarget(
  modifier: string,
  context: StreamContext,
  sourceDisplayName: string,
): Promise<CopiedRenderTarget | null> {
  const normalizedModifier = normalizeRenderModifierName(modifier);
  if (!normalizedModifier) {
    return null;
  }

  const candidates = (await collectCopiedRenderCandidates(context)).filter((candidate) =>
    candidateMatches(candidate, normalizedModifier),
  );

  if (candidates.length !== 1) {
    return null;
  }

  const [candidate] = candidates;
  const username = formatRenderModifierWebhookName(sourceDisplayName, candidate.displayName);
  if (candidate.kind === "persona") {
    const guild = getStreamGuild(context);
    if (!guild) return null;

    const personaIdentity = await resolvePersonaWebhookIdentity(candidate.persona, guild);
    return {
      displayName: candidate.displayName,
      identity: {
        username,
        avatarUrl: personaIdentity.avatarUrl,
        avatarDataUri: personaIdentity.avatarDataUri,
      },
    };
  }

  const userIdentity = await resolveImpersonatedIdentity(
    context.client,
    getStreamGuild(context),
    candidate.userId,
    candidate.displayName,
  );
  return {
    displayName: candidate.displayName,
    identity: {
      username,
      avatarUrl: userIdentity.avatarUrl,
    },
  };
}

export async function resolveSpriteRenderModifierTarget(
  modifier: string,
  context: StreamContext,
  sourceDisplayName: string,
): Promise<SpriteRenderModifierResolution> {
  const personaId = context.tomoriState.persona_id;
  if (typeof personaId !== "number") {
    return { status: "not_found" };
  }

  const spriteKey = normalizePersonaSpriteKey(modifier);
  if (!spriteKey) {
    return { status: "not_found" };
  }

  const sprites = await getCachedPersonaSprites(personaId).catch((error) => {
    log.warn(`Failed to load persona sprites while resolving render modifier for persona ${personaId}`, error);
    return [];
  });
  const sprite = sprites.find((candidate) => candidate.sprite_key === spriteKey);
  if (!sprite) {
    return { status: "not_found" };
  }

  const identity = await resolveSpriteIdentity(sprite, sourceDisplayName);
  return {
    status: "matched",
    target: identity
      ? {
          displayName: sprite.sprite_name,
          identity,
        }
      : null,
  };
}
