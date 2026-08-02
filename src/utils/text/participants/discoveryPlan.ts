import type { TomoriState } from "@/types/db/schema";
import { buildBridgeUserAliases, buildPersonaAliases, buildWebhookAliases } from "@/utils/text/participants/aliases";
import {
  mergeParticipantSeeds,
  serializeParticipantKey,
  type ParticipantAlias,
  type ParticipantCapability,
  type ParticipantInclusionReason,
  type ParticipantKey,
  type ParticipantSeed,
} from "@/utils/text/participants/identity";
import {
  adaptLegacyParticipantIdentity,
  adaptLegacyParticipantReasons,
  adaptLegacySyntheticParticipants,
  type LegacyParticipantAdapterInput,
} from "@/utils/text/participants/legacyAdapter";
import type { AliasReferenceDiagnostics } from "@/utils/text/participants/referenceDiscovery";

export type ParticipantCandidateEvidenceSource =
  | "visible_author"
  | "active_identity"
  | "real_mention"
  | "unique_text_alias"
  | "historical_synthetic"
  | "historical_persona"
  | "co_responder"
  | "persona_trigger_reference"
  | "bridge_presence";

export type ParticipantDiscoveryRejectionReason =
  | "ineligible_state"
  | "bot"
  | "non_member"
  | "ambiguous_alias"
  | "existing_participant"
  | "blocked_source"
  | "missing_guild";

export interface ParticipantCandidateEvidence {
  key: ParticipantKey;
  source: ParticipantCandidateEvidenceSource;
  firstSeenOrder: number;
}

export interface ParticipantDiscoveryRejection {
  reason: ParticipantDiscoveryRejectionReason;
  count: number;
}

export interface ParticipantDiscoveryPlan {
  seeds: readonly ParticipantSeed[];
  evidence: readonly ParticipantCandidateEvidence[];
  rejections: readonly ParticipantDiscoveryRejection[];
  aliasReferenceDiagnostics: AliasReferenceDiagnostics;
}

export interface DiscoveredParticipantCandidate {
  key: ParticipantKey;
  reasons: ReadonlySet<ParticipantInclusionReason>;
  aliases: readonly ParticipantAlias[];
  capabilities: ReadonlySet<ParticipantCapability>;
  sourceDisplayName?: string;
  evidenceSources: readonly ParticipantCandidateEvidenceSource[];
}

const EMPTY_ALIAS_DIAGNOSTICS: AliasReferenceDiagnostics = {
  evaluatedAliasCount: 0,
  acceptedAliasCount: 0,
  ambiguousAliasCount: 0,
  unmatchedAliasCount: 0,
};

function aliasesForSyntheticParticipant(
  key: ParticipantKey,
  displayName: string | undefined,
  personas: readonly TomoriState[],
): readonly ParticipantAlias[] {
  if (!displayName) return [];
  if (key.kind === "persona") {
    const persona = personas.find((candidate) => candidate.persona_id === key.personaId);
    return buildPersonaAliases({
      owner: key,
      nickname: displayName,
      triggerWords: persona?.trigger_words,
    }).aliases;
  }
  if (key.kind === "webhook") return buildWebhookAliases({ owner: key, displayName });
  if (key.kind === "matrix_user") return buildBridgeUserAliases({ owner: key, displayName });
  return [];
}

export function discoverVisibleAuthorCandidates(
  input: LegacyParticipantAdapterInput,
  personas: readonly TomoriState[],
): DiscoveredParticipantCandidate[] {
  return input.userList.map((legacyId) => {
    const { key, sourceDisplayName } = adaptLegacyParticipantIdentity(legacyId, input);
    const reasons = adaptLegacyParticipantReasons(legacyId, key, input);
    return {
      key,
      reasons,
      aliases: aliasesForSyntheticParticipant(key, sourceDisplayName, personas),
      capabilities: new Set(key.kind === "discord_user" ? ["mentionable"] : []),
      ...(sourceDisplayName && { sourceDisplayName }),
      evidenceSources: reasons.has("active_identity") ? ["active_identity"] : ["visible_author"],
    };
  });
}

export function discoverHistoricalSyntheticCandidates(
  syntheticUsers: LegacyParticipantAdapterInput["syntheticUsers"],
  personas: readonly TomoriState[],
): DiscoveredParticipantCandidate[] {
  return adaptLegacySyntheticParticipants(syntheticUsers).map((definition) => ({
    key: definition.key,
    reasons: new Set<ParticipantInclusionReason>([
      definition.key.kind === "persona" ? "historical_persona" : "visible_author",
    ]),
    aliases: aliasesForSyntheticParticipant(definition.key, definition.displayName, personas),
    capabilities: new Set(),
    sourceDisplayName: definition.displayName,
    evidenceSources: [definition.key.kind === "persona" ? "historical_persona" : "historical_synthetic"],
  }));
}

export function discoverBridgeCandidates(
  matrixUsers: LegacyParticipantAdapterInput["matrixUsers"],
): DiscoveredParticipantCandidate[] {
  return adaptLegacySyntheticParticipants(undefined, matrixUsers).map((definition) => ({
    key: definition.key,
    reasons: new Set<ParticipantInclusionReason>(["bridge_presence"]),
    aliases: aliasesForSyntheticParticipant(definition.key, definition.displayName, []),
    capabilities: new Set(),
    sourceDisplayName: definition.displayName,
    evidenceSources: ["bridge_presence"],
  }));
}

export function discoverPersonaReferenceCandidates(
  personas: readonly TomoriState[],
  personaReasons: ReadonlyMap<number, ReadonlySet<ParticipantInclusionReason>>,
): DiscoveredParticipantCandidate[] {
  const candidates: DiscoveredParticipantCandidate[] = [];
  for (const persona of personas) {
    if (typeof persona.persona_id !== "number") continue;
    const reasons = personaReasons.get(persona.persona_id);
    if (!reasons || reasons.size === 0) continue;
    const evidenceSources = [...reasons].flatMap((reason): ParticipantCandidateEvidenceSource[] => {
      if (reason === "historical_persona") return ["historical_persona"];
      if (reason === "co_responder") return ["co_responder"];
      if (reason === "persona_trigger_reference") return ["persona_trigger_reference"];
      return [];
    });
    candidates.push({
      key: { kind: "persona", personaId: persona.persona_id },
      reasons,
      aliases: buildPersonaAliases({
        owner: { kind: "persona", personaId: persona.persona_id },
        nickname: persona.persona_nickname,
        triggerWords: persona.trigger_words,
      }).aliases,
      capabilities: new Set(),
      sourceDisplayName: persona.persona_nickname,
      evidenceSources,
    });
  }
  return candidates;
}

export function buildParticipantDiscoveryPlan(params: {
  candidates: readonly DiscoveredParticipantCandidate[];
  rejections?: readonly ParticipantDiscoveryRejection[];
  aliasReferenceDiagnostics?: AliasReferenceDiagnostics;
}): ParticipantDiscoveryPlan {
  const seeds: ParticipantSeed[] = [];
  const evidence: ParticipantCandidateEvidence[] = [];
  params.candidates.forEach((candidate, firstSeenOrder) => {
    seeds.push({
      key: candidate.key,
      reasons: candidate.reasons,
      aliases: candidate.aliases,
      capabilities: candidate.capabilities,
      firstSeenOrder,
      ...(candidate.sourceDisplayName && { sourceDisplayName: candidate.sourceDisplayName }),
    });
    for (const source of candidate.evidenceSources) {
      evidence.push({ key: candidate.key, source, firstSeenOrder });
    }
  });

  const mergedEvidence = new Map<string, ParticipantCandidateEvidence>();
  for (const item of evidence) {
    const key = `${serializeParticipantKey(item.key)}\0${item.source}`;
    const existing = mergedEvidence.get(key);
    if (!existing || item.firstSeenOrder < existing.firstSeenOrder) mergedEvidence.set(key, item);
  }

  return {
    seeds: mergeParticipantSeeds(seeds),
    evidence: [...mergedEvidence.values()].sort((left, right) => left.firstSeenOrder - right.firstSeenOrder),
    rejections: params.rejections ?? [],
    aliasReferenceDiagnostics: params.aliasReferenceDiagnostics ?? EMPTY_ALIAS_DIAGNOSTICS,
  };
}
