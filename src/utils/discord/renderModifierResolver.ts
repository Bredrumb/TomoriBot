import type { Guild } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type ConversationUserReference } from "@/types/misc/context";
import type { StreamContext } from "@/types/stream/interfaces";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { resolveImpersonatedIdentity } from "@/utils/chat/webhookIdentity";
import { formatRenderModifierWebhookName, normalizeRenderModifierName } from "@/utils/discord/renderModifierParser";
import { resolvePersonaWebhookIdentity } from "@/utils/discord/webhook/identity";
import { log } from "@/utils/misc/logger";

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
