import type { Client } from "discord.js";
import {
  measureChatTurnStage,
  recordChatTurnParticipantMemberOutcomes,
  type ChatTurnParticipantMemberOutcomes,
} from "@/utils/chat/turnLatency";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { isEligibleContextReferenceUserV1 } from "@/utils/db/repositories/UserRepository";
import type { PublicPersonaProfile, SimplifiedMessageForContext } from "@/utils/text/context/types";
import {
  buildDiscordUserAliases,
  buildMessageProxyIdentityAliases,
  normalizeParticipantAlias,
} from "@/utils/text/participants/aliases";
import {
  createDiscordParticipantMemberDirectory,
  repositoryMessageProxyIdentityReferenceSource,
  repositoryUserReferenceCandidateSource,
  type ParticipantMemberDirectory,
  type MessageProxyIdentityReferenceSource,
  type ReferenceMemberIdentity,
  type UserReferenceCandidateSource,
} from "@/utils/text/participants/candidateSources";
import {
  buildParticipantDiscoveryPlan,
  discoverPersonaReferenceCandidates,
  type DiscoveredParticipantCandidate,
  type ParticipantDiscoveryPlan,
  type ParticipantDiscoveryRejection,
} from "@/utils/text/participants/discoveryPlan";
import { isMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";
import {
  containsStandaloneAlias,
  discoverReferencedPersonaIds,
  extractRealDiscordMentionIds,
  resolveUniqueParticipantAliasReferences,
  type AliasReferenceDiagnostics,
} from "@/utils/text/participants/referenceDiscovery";
import { createDiscordUserKey, type ParticipantInclusionReason } from "@/utils/text/participants/identity";

export { discoverReferencedPersonaIds } from "@/utils/text/participants/referenceDiscovery";

export type ResolvedContextReferences = {
  candidateCount: number;
  referencedUserIds: Set<string>;
  referencedUserRows: Map<string, UserRow>;
  referencedUserReasons: Map<string, ReadonlySet<"real_mention" | "unique_text_alias">>;
  aliasReferenceDiagnostics: AliasReferenceDiagnostics;
  discoveryPlan: ParticipantDiscoveryPlan;
  publicPersonaProfiles: PublicPersonaProfile[];
  personaProfileReasons: Map<number, ReadonlySet<ParticipantInclusionReason>>;
};

function addReason<Key, Reason>(map: Map<Key, Set<Reason>>, key: Key, reason: Reason): void {
  const reasons = map.get(key) ?? new Set<Reason>();
  reasons.add(reason);
  map.set(key, reasons);
}

function addRejection(
  rejections: ParticipantDiscoveryRejection[],
  reason: ParticipantDiscoveryRejection["reason"],
  count = 1,
): void {
  const existing = rejections.find((rejection) => rejection.reason === reason);
  if (existing) existing.count += count;
  else rejections.push({ reason, count });
}

function summarizeMemberOutcomes(params: {
  historyText: string;
  resolvedMembers: readonly { userRow: UserRow; member: ReferenceMemberIdentity | null }[];
  nicknameOnlyIds: ReadonlySet<string>;
  cachedMemberIds: ReadonlySet<string>;
  referencedIds: ReadonlySet<string>;
}): ChatTurnParticipantMemberOutcomes {
  const outcomes: ChatTurnParticipantMemberOutcomes = {
    misses: 0,
    nicknameMisses: 0,
    nicknameSubstringFetches: 0,
    nicknameSubstringReferences: 0,
    fetchedReferences: 0,
  };
  for (const { userRow, member } of params.resolvedMembers) {
    const discordId = userRow.user_disc_id;
    const nicknameOnly = params.nicknameOnlyIds.has(discordId);
    const referenced = params.referencedIds.has(discordId);
    if (!member) {
      outcomes.misses += 1;
      if (nicknameOnly) outcomes.nicknameMisses += 1;
    }
    if (referenced && !params.cachedMemberIds.has(discordId)) outcomes.fetchedReferences += 1;
    if (!nicknameOnly) continue;
    // The candidate SQL admits nicknames by bare substring, so this counts rows admitted on a nickname the alias matcher rejects.
    const savedNickname = normalizeParticipantAlias(userRow.user_nickname ?? "");
    if (savedNickname && containsStandaloneAlias(params.historyText, savedNickname)) continue;
    outcomes.nicknameSubstringFetches += 1;
    if (referenced) outcomes.nicknameSubstringReferences += 1;
  }
  return outcomes;
}

export function buildPublicPersonaProfiles(
  personas: TomoriState[],
  personaIds: ReadonlySet<number>,
  activePersonaId?: number,
): PublicPersonaProfile[] {
  return personas
    .filter(
      (persona) =>
        typeof persona.persona_id === "number" &&
        persona.persona_id !== activePersonaId &&
        personaIds.has(persona.persona_id),
    )
    .map((persona) => ({
      personaId: persona.persona_id as number,
      personaName: persona.persona_nickname,
      attributes: (persona.persona_attributes ?? [])
        .filter((attribute) => attribute.is_public)
        .map((attribute) => attribute.attribute_text),
      imageAppearanceTags: (persona.physical_appearance_tags ?? [])
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    }))
    .filter((profile) => profile.attributes.length > 0 || profile.imageAppearanceTags.length > 0);
}

export async function resolveContextReferences(params: {
  client: Client;
  guildId: string;
  simplifiedMessageHistory: SimplifiedMessageForContext[];
  personas: TomoriState[];
  activePersonaId?: number;
  existingParticipantIds: ReadonlySet<string>;
  existingPersonaIds?: ReadonlySet<number>;
  responderPersonaIds?: ReadonlySet<number>;
  candidateSource?: UserReferenceCandidateSource;
  messageProxyIdentitySource?: MessageProxyIdentityReferenceSource;
  memberDirectory?: ParticipantMemberDirectory | null;
}): Promise<ResolvedContextReferences> {
  const historyText = params.simplifiedMessageHistory
    .filter((message) => !message.id.startsWith("synthetic-user-block-"))
    .map((message) => message.content ?? "")
    .filter((content) => content.length > 0)
    .join("\n");

  const referencedPersonaIds = discoverReferencedPersonaIds(params.simplifiedMessageHistory, params.personas);
  const personaProfileReasons = new Map<number, Set<ParticipantInclusionReason>>();
  for (const personaId of referencedPersonaIds) {
    addReason(personaProfileReasons, personaId, "persona_trigger_reference");
  }
  for (const personaId of params.existingPersonaIds ?? []) {
    addReason(personaProfileReasons, personaId, "historical_persona");
  }
  for (const personaId of params.responderPersonaIds ?? []) {
    addReason(personaProfileReasons, personaId, "co_responder");
  }
  const profilePersonaIds = new Set(personaProfileReasons.keys());

  const publicPersonaProfiles = buildPublicPersonaProfiles(params.personas, profilePersonaIds, params.activePersonaId);
  const personaCandidates = discoverPersonaReferenceCandidates(params.personas, personaProfileReasons);
  const rejections: ParticipantDiscoveryRejection[] = [];
  const blockedSourceCount = params.simplifiedMessageHistory.filter((message) =>
    message.id.startsWith("synthetic-user-block-"),
  ).length;
  if (blockedSourceCount > 0) addRejection(rejections, "blocked_source", blockedSourceCount);

  const memberDirectory =
    params.memberDirectory === undefined
      ? createDiscordParticipantMemberDirectory(params.client, params.guildId)
      : params.memberDirectory;
  if (!memberDirectory || !historyText) {
    if (!memberDirectory && historyText) addRejection(rejections, "missing_guild");
    const discoveryPlan = buildParticipantDiscoveryPlan({ candidates: personaCandidates, rejections });
    return {
      candidateCount: personaCandidates.length,
      referencedUserIds: new Set<string>(),
      referencedUserRows: new Map<string, UserRow>(),
      referencedUserReasons: new Map(),
      aliasReferenceDiagnostics: discoveryPlan.aliasReferenceDiagnostics,
      discoveryPlan,
      publicPersonaProfiles,
      personaProfileReasons,
    };
  }

  const realMentionIds = extractRealDiscordMentionIds(historyText);
  const cachedMemberIds = new Set(memberDirectory.cachedMemberIds());
  const candidateDiscordIds = new Set<string>([...realMentionIds, ...cachedMemberIds]);

  const candidateSource = params.candidateSource ?? repositoryUserReferenceCandidateSource;
  const loadedCandidates = await candidateSource.loadCandidates({
    serverDiscId: params.guildId,
    candidateDiscordIds: [...candidateDiscordIds],
    normalizedHistoryText: historyText,
  });
  const eligibleRows = loadedCandidates
    .filter((candidate) => {
      const eligible = isEligibleContextReferenceUserV1(candidate.userRow, candidate.evidence);
      if (!eligible) addRejection(rejections, "ineligible_state");
      return eligible;
    })
    .map((candidate) => candidate.userRow);
  // Filter out proxy user rows here so synthetic IDs never trigger doomed guild.members.fetch() REST calls.
  const uniqueEligibleRows = [...new Map(eligibleRows.map((row) => [row.user_disc_id, row])).values()].filter(
    (row) => !isMessageProxyIdentityUserId(row.user_disc_id),
  );
  const nicknameOnlyIds = new Set(
    loadedCandidates
      .filter(({ userRow, evidence }) => !candidateDiscordIds.has(userRow.user_disc_id) && !evidence.hasServerActivity)
      .map(({ userRow }) => userRow.user_disc_id),
  );

  const resolvedMembers = await measureChatTurnStage("participant_members_ms", () =>
    Promise.all(
      uniqueEligibleRows.map(async (userRow) => ({
        userRow,
        member: await memberDirectory.resolveMember(userRow.user_disc_id),
      })),
    ),
  );
  const eligibleMembers = resolvedMembers.flatMap(({ userRow, member }) => {
    if (!member) {
      addRejection(rejections, "non_member");
      return [];
    }
    if (member.bot) {
      addRejection(rejections, "bot");
      return [];
    }
    return [{ member, userRow }];
  });

  // Proxy identities skip Discord directory lookup so shared alias resolution catches colliding names across pools.
  const messageProxyReferences = await (
    params.messageProxyIdentitySource ?? repositoryMessageProxyIdentityReferenceSource
  ).loadIdentities({
    hostUserDiscIds: [...candidateDiscordIds],
    normalizedHistoryText: historyText,
  });

  const participantAliases = [
    ...eligibleMembers.flatMap(({ member, userRow }) =>
      buildDiscordUserAliases({
        owner: createDiscordUserKey(userRow.user_disc_id),
        userRow,
        identity: {
          displayName: member.displayName,
          nickname: member.nickname,
          globalName: member.globalName,
          username: member.username,
        },
        exposeSavedNickname: false,
      }),
    ),
    ...messageProxyReferences.flatMap((reference) =>
      buildMessageProxyIdentityAliases({
        owner: createDiscordUserKey(reference.userDiscId),
        displayName: reference.displayName,
        savedNickname: reference.savedNickname,
      }),
    ),
  ];
  const aliasResolution = resolveUniqueParticipantAliasReferences(historyText, participantAliases);
  if (aliasResolution.diagnostics.ambiguousAliasCount > 0) {
    addRejection(rejections, "ambiguous_alias", aliasResolution.diagnostics.ambiguousAliasCount);
  }
  const referencedUserIds = new Set(
    aliasResolution.referencedOwners.flatMap((owner) => (owner.kind === "discord_user" ? [owner.discordId] : [])),
  );
  const referencedUserReasons = new Map<string, Set<"real_mention" | "unique_text_alias">>();
  for (const userId of referencedUserIds) addReason(referencedUserReasons, userId, "unique_text_alias");

  for (const userId of realMentionIds) {
    if (eligibleMembers.some(({ userRow }) => userRow.user_disc_id === userId)) {
      referencedUserIds.add(userId);
      addReason(referencedUserReasons, userId, "real_mention");
    }
  }
  for (const existingParticipantId of params.existingParticipantIds) {
    if (referencedUserIds.has(existingParticipantId)) {
      addRejection(rejections, "existing_participant");
    }
    referencedUserIds.delete(existingParticipantId);
    referencedUserReasons.delete(existingParticipantId);
  }

  const referencedUserRows = new Map(
    eligibleMembers
      .filter(({ userRow }) => referencedUserIds.has(userRow.user_disc_id))
      .map(({ userRow }) => [userRow.user_disc_id, userRow]),
  );
  recordChatTurnParticipantMemberOutcomes(
    summarizeMemberOutcomes({
      historyText,
      resolvedMembers,
      nicknameOnlyIds,
      cachedMemberIds,
      referencedIds: new Set(referencedUserRows.keys()),
    }),
  );
  const userCandidates: DiscoveredParticipantCandidate[] = [...referencedUserIds].flatMap((userId) => {
    const reasons = referencedUserReasons.get(userId);
    const userRow = referencedUserRows.get(userId);
    if (!reasons || !userRow) return [];
    const key = createDiscordUserKey(userId);
    return [
      {
        key,
        reasons,
        aliases: participantAliases.filter(
          (alias) => alias.owner.kind === "discord_user" && alias.owner.discordId === userId,
        ),
        capabilities: new Set(["mentionable"]),
        sourceDisplayName: userRow.user_nickname ?? undefined,
        evidenceSources: [...reasons],
      },
    ];
  });
  const messageProxyCandidates: DiscoveredParticipantCandidate[] = messageProxyReferences.flatMap((reference) => {
    const reasons = referencedUserReasons.get(reference.userDiscId);
    if (!reasons) return [];
    const displayName = reference.savedNickname ?? reference.displayName;
    return [
      {
        key: createDiscordUserKey(reference.userDiscId),
        reasons,
        aliases: participantAliases.filter(
          (alias) => alias.owner.kind === "discord_user" && alias.owner.discordId === reference.userDiscId,
        ),
        // No "mentionable": a member has no account to ping, only a host that does.
        capabilities: new Set(),
        ...(displayName && { sourceDisplayName: displayName }),
        evidenceSources: [...reasons],
      },
    ];
  });
  const discoveryPlan = buildParticipantDiscoveryPlan({
    candidates: [...userCandidates, ...messageProxyCandidates, ...personaCandidates],
    rejections,
    aliasReferenceDiagnostics: aliasResolution.diagnostics,
  });

  return {
    candidateCount: personaCandidates.length + loadedCandidates.length + messageProxyReferences.length,
    referencedUserIds,
    referencedUserRows,
    referencedUserReasons,
    aliasReferenceDiagnostics: aliasResolution.diagnostics,
    discoveryPlan,
    publicPersonaProfiles,
    personaProfileReasons,
  };
}
