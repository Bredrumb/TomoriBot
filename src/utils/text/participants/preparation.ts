import type { Client } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import type { ContributionExecutionDiagnostic } from "@/utils/contributions/registry";
import type { PublicPersonaProfile, SimplifiedMessageForContext } from "@/utils/text/context/types";
import { resolveContextReferences, type ResolvedContextReferences } from "@/utils/text/contextReferences";
import {
  createDiscordParticipantMemberDirectory,
  repositoryUserReferenceCandidateSource,
  type ParticipantMemberDirectory,
  type UserReferenceCandidateSource,
} from "@/utils/text/participants/candidateSources";
import type {
  ParticipantDiscoveryPlan,
  ParticipantDiscoveryRejectionReason,
} from "@/utils/text/participants/discoveryPlan";
import { composeParticipantDiscoveryPlan, type ParticipantSourceRegistry } from "@/utils/text/participants/sources";
import type { ParticipantProfileEnricherRegistry } from "@/utils/text/participants/profileEnrichers";

export interface ParticipantRequestScope {
  discoveries: Map<string, Promise<CachedParticipantDiscovery>>;
}

export interface ParticipantPreparationExternalCalls {
  candidateSourceReads: number;
  memberCacheHits: number;
  memberFetches: number;
}

export interface ParticipantPreparationDiagnostics {
  discoveryCacheHit: boolean;
  discoveryDurationMs: number;
  candidateCount: number;
  includedCount: number;
  rejectionCounts: Readonly<Record<ParticipantDiscoveryRejectionReason, number>>;
  externalCalls: ParticipantPreparationExternalCalls;
  sourceContributions: readonly ContributionExecutionDiagnostic[];
}

export interface PreparedParticipantContext {
  participantIds: readonly string[];
  discoveryPlan: ParticipantDiscoveryPlan;
  matrixUsers: ReadonlyMap<string, string>;
  syntheticUsers: ReadonlyMap<string, { displayName: string; type: "persona" | "webhook" }>;
  publicPersonaProfiles: readonly PublicPersonaProfile[];
  referencedUserRows: ReadonlyMap<string, UserRow>;
  referencedUserIds: ReadonlySet<string>;
  diagnostics: ParticipantPreparationDiagnostics;
  profileEnricherRegistry?: ParticipantProfileEnricherRegistry;
}

export interface ParticipantPreparationInput {
  client: Client;
  guildId: string;
  simplifiedMessageHistory: readonly SimplifiedMessageForContext[];
  personas: readonly TomoriState[];
  activePersona: TomoriState | null;
  visibleUserIds: readonly string[];
  syntheticUsers?: ReadonlyMap<string, { displayName: string; type: "persona" | "webhook" }>;
  matrixUsers?: ReadonlyMap<string, string>;
  responderPersonaIds?: ReadonlySet<number>;
  requestScope?: ParticipantRequestScope;
  candidateSource?: UserReferenceCandidateSource;
  memberDirectory?: ParticipantMemberDirectory | null;
  sourceRegistry?: ParticipantSourceRegistry;
  profileEnricherRegistry?: ParticipantProfileEnricherRegistry;
}

interface CachedParticipantDiscovery {
  references: ResolvedContextReferences;
  durationMs: number;
  externalCalls: ParticipantPreparationExternalCalls;
}

const EMPTY_REJECTION_COUNTS: Record<ParticipantDiscoveryRejectionReason, number> = {
  ineligible_state: 0,
  bot: 0,
  non_member: 0,
  ambiguous_alias: 0,
  existing_participant: 0,
  blocked_source: 0,
  missing_guild: 0,
};

export function createParticipantRequestScope(): ParticipantRequestScope {
  return { discoveries: new Map() };
}

export async function prepareParticipantContext(
  input: ParticipantPreparationInput,
): Promise<PreparedParticipantContext> {
  const frozen = freezeParticipantInput(input);
  const cacheKey = participantInputCacheKey(frozen);
  const requestScope = input.requestScope ?? createParticipantRequestScope();
  const cached = requestScope.discoveries.get(cacheKey);
  const discoveryCacheHit = Boolean(cached);
  const discoveryPromise = cached ?? discoverParticipants(frozen, input.candidateSource, input.memberDirectory);
  if (!cached) requestScope.discoveries.set(cacheKey, discoveryPromise);
  const discoveryStartedAt = performance.now();
  let discovery: CachedParticipantDiscovery;
  try {
    discovery = await discoveryPromise;
  } catch (error) {
    if (requestScope.discoveries.get(cacheKey) === discoveryPromise) requestScope.discoveries.delete(cacheKey);
    throw error;
  }
  const activePersonaId = frozen.activePersona?.persona_id;
  const publicPersonaProfiles = discovery.references.publicPersonaProfiles.filter(
    (profile) => profile.personaId !== activePersonaId,
  );
  const composition = await composeParticipantDiscoveryPlan(
    {
      visibleInput: {
        userList: frozen.visibleUserIds,
        clientUserId: frozen.client.user?.id,
        activePersonaId,
        activePersonaIsAlter: frozen.activePersona?.is_alter,
        syntheticUsers: frozen.syntheticUsers,
        matrixUsers: frozen.matrixUsers,
      },
      personas: frozen.personas,
      referencePlan: discovery.references.discoveryPlan,
    },
    input.sourceRegistry,
  );
  const discoveryPlan = composition.plan;
  const participantIds = [...frozen.visibleUserIds];
  for (const referencedUserId of discovery.references.referencedUserIds) {
    if (!participantIds.includes(referencedUserId)) participantIds.push(referencedUserId);
  }
  const rejectionCounts = { ...EMPTY_REJECTION_COUNTS };
  for (const rejection of discoveryPlan.rejections) rejectionCounts[rejection.reason] += rejection.count;

  return {
    participantIds,
    discoveryPlan,
    matrixUsers: frozen.matrixUsers,
    syntheticUsers: frozen.syntheticUsers,
    publicPersonaProfiles,
    referencedUserRows: discovery.references.referencedUserRows,
    referencedUserIds: discovery.references.referencedUserIds,
    diagnostics: {
      discoveryCacheHit,
      discoveryDurationMs: discoveryCacheHit ? performance.now() - discoveryStartedAt : discovery.durationMs,
      candidateCount: discovery.references.candidateCount,
      includedCount: discoveryPlan.seeds.length,
      rejectionCounts,
      externalCalls: discoveryCacheHit
        ? { candidateSourceReads: 0, memberCacheHits: 0, memberFetches: 0 }
        : discovery.externalCalls,
      sourceContributions: composition.diagnostics,
    },
    profileEnricherRegistry: input.profileEnricherRegistry,
  };
}

function freezeParticipantInput(input: ParticipantPreparationInput): ParticipantPreparationInput & {
  simplifiedMessageHistory: readonly SimplifiedMessageForContext[];
  personas: readonly TomoriState[];
  visibleUserIds: readonly string[];
  syntheticUsers: ReadonlyMap<string, { displayName: string; type: "persona" | "webhook" }>;
  matrixUsers: ReadonlyMap<string, string>;
} {
  return {
    ...input,
    simplifiedMessageHistory: input.simplifiedMessageHistory.map((message) => ({
      ...message,
      imageAttachments: [...message.imageAttachments],
      videoAttachments: [...message.videoAttachments],
    })),
    personas: input.personas.map((persona) => ({
      ...persona,
      trigger_words: [...(persona.trigger_words ?? [])],
      persona_attributes: (persona.persona_attributes ?? []).map((attribute) => ({ ...attribute })),
      physical_appearance_tags: [...(persona.physical_appearance_tags ?? [])],
    })),
    visibleUserIds: [...input.visibleUserIds],
    syntheticUsers: new Map([...(input.syntheticUsers ?? [])].map(([id, user]) => [id, { ...user }])),
    matrixUsers: new Map(input.matrixUsers ?? []),
    responderPersonaIds: new Set(input.responderPersonaIds ?? []),
  };
}

async function discoverParticipants(
  input: ReturnType<typeof freezeParticipantInput>,
  candidateSourceOverride?: UserReferenceCandidateSource,
  memberDirectoryOverride?: ParticipantMemberDirectory | null,
): Promise<CachedParticipantDiscovery> {
  const startedAt = performance.now();
  const externalCalls: ParticipantPreparationExternalCalls = {
    candidateSourceReads: 0,
    memberCacheHits: 0,
    memberFetches: 0,
  };
  const candidateSource = candidateSourceOverride ?? repositoryUserReferenceCandidateSource;
  const countedCandidateSource: UserReferenceCandidateSource = {
    loadCandidates: async (query) => {
      externalCalls.candidateSourceReads += 1;
      return candidateSource.loadCandidates(query);
    },
  };
  const memberDirectory =
    memberDirectoryOverride === undefined
      ? createDiscordParticipantMemberDirectory(input.client, input.guildId)
      : memberDirectoryOverride;
  const cachedMemberIds = new Set(memberDirectory?.cachedMemberIds() ?? []);
  const countedMemberDirectory: ParticipantMemberDirectory | null = memberDirectory
    ? {
        cachedMemberIds: () => [...cachedMemberIds],
        resolveMember: async (discordId) => {
          if (cachedMemberIds.has(discordId)) externalCalls.memberCacheHits += 1;
          else externalCalls.memberFetches += 1;
          return memberDirectory.resolveMember(discordId);
        },
      }
    : null;
  const existingPersonaIds = new Set(
    [...input.syntheticUsers.entries()].flatMap(([id, user]) => {
      if (user.type !== "persona") return [];
      const parsed = Number.parseInt(id.replace(/^persona:/, ""), 10);
      return Number.isSafeInteger(parsed) ? [parsed] : [];
    }),
  );
  const references = await resolveContextReferences({
    client: input.client,
    guildId: input.guildId,
    simplifiedMessageHistory: [...input.simplifiedMessageHistory],
    personas: [...input.personas],
    existingParticipantIds: new Set(input.visibleUserIds),
    existingPersonaIds,
    responderPersonaIds: input.responderPersonaIds,
    candidateSource: countedCandidateSource,
    memberDirectory: countedMemberDirectory,
  });
  return { references, durationMs: performance.now() - startedAt, externalCalls };
}

function participantInputCacheKey(input: ReturnType<typeof freezeParticipantInput>): string {
  // Exact request-local keys prevent a hash collision from sharing discovery across differently sanitized histories.
  return JSON.stringify({
    guildId: input.guildId,
    messages: input.simplifiedMessageHistory.map((message) => [
      message.id,
      message.authorId,
      message.authorType,
      message.content,
    ]),
    visibleUserIds: input.visibleUserIds,
    syntheticUsers: [...input.syntheticUsers],
    matrixUsers: [...input.matrixUsers],
    personas: input.personas.map((persona) => [
      persona.persona_id,
      persona.persona_nickname,
      persona.trigger_words,
      persona.persona_attributes,
      persona.physical_appearance_tags,
    ]),
    responderPersonaIds: [...(input.responderPersonaIds ?? [])],
  });
}
