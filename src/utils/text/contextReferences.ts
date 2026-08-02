import type { Client, GuildMember } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { userRepository } from "@/utils/db/repositories";
import type { PublicPersonaProfile, SimplifiedMessageForContext } from "@/utils/text/context/types";
import { buildDiscordUserAliases, createParticipantAlias } from "@/utils/text/participants/aliases";
import {
  discoverReferencedPersonaIds,
  resolveUniqueParticipantAliasReferences,
  type AliasReferenceDiagnostics,
} from "@/utils/text/participants/referenceDiscovery";
import {
  createDiscordUserKey,
  type ParticipantAlias,
  type ParticipantInclusionReason,
} from "@/utils/text/participants/identity";

export { discoverReferencedPersonaIds } from "@/utils/text/participants/referenceDiscovery";

const REAL_DISCORD_MENTION_PATTERN = /<@!?(\d+)>/g;

export type EligibleAliasCandidate = {
  userId: string;
  aliases: string[];
};

export type ResolvedContextReferences = {
  referencedUserIds: Set<string>;
  referencedUserRows: Map<string, UserRow>;
  referencedUserReasons: Map<string, ReadonlySet<"real_mention" | "unique_text_alias">>;
  aliasReferenceDiagnostics: AliasReferenceDiagnostics;
  publicPersonaProfiles: PublicPersonaProfile[];
  personaProfileReasons: Map<number, ReadonlySet<ParticipantInclusionReason>>;
};

function addReason<Key, Reason>(map: Map<Key, Set<Reason>>, key: Key, reason: Reason): void {
  const reasons = map.get(key) ?? new Set<Reason>();
  reasons.add(reason);
  map.set(key, reasons);
}

/**
 * Keeps the pre-catalog candidate shape as a named compatibility boundary.
 */
export function resolveUniqueTextualAliasReferences(
  historyText: string,
  candidates: EligibleAliasCandidate[],
): Set<string> {
  const aliases: ParticipantAlias[] = [];
  for (const candidate of candidates) {
    const owner = createDiscordUserKey(candidate.userId);
    candidate.aliases.forEach((value, priority) => {
      const alias = createParticipantAlias({
        owner,
        value,
        source: "guild_display_name",
        purposes: ["input_reference"],
        exposure: "lookup_only",
        priority,
      });
      if (alias) aliases.push(alias);
    });
  }

  return new Set(
    resolveUniqueParticipantAliasReferences(historyText, aliases).referencedOwners.flatMap((owner) =>
      owner.kind === "discord_user" ? [owner.discordId] : [],
    ),
  );
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

const extractRealDiscordMentionIds = (historyText: string): Set<string> => {
  const mentionIds = new Set<string>();
  for (const match of historyText.matchAll(REAL_DISCORD_MENTION_PATTERN)) {
    const userId = match[1];
    if (userId) mentionIds.add(userId);
  }
  return mentionIds;
};

/**
 * Resolves all context-only persona and user references for live chat and
 * prompt snapshots from the same sanitized history representation.
 */
export async function resolveContextReferences(params: {
  client: Client;
  guildId: string;
  simplifiedMessageHistory: SimplifiedMessageForContext[];
  personas: TomoriState[];
  activePersonaId?: number;
  existingParticipantIds: ReadonlySet<string>;
  existingPersonaIds?: ReadonlySet<number>;
  responderPersonaIds?: ReadonlySet<number>;
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

  const guild = params.client.guilds.cache.get(params.guildId);
  if (!guild || !historyText) {
    return {
      referencedUserIds: new Set<string>(),
      referencedUserRows: new Map<string, UserRow>(),
      referencedUserReasons: new Map(),
      aliasReferenceDiagnostics: {
        evaluatedAliasCount: 0,
        acceptedAliasCount: 0,
        ambiguousAliasCount: 0,
        unmatchedAliasCount: 0,
      },
      publicPersonaProfiles,
      personaProfileReasons,
    };
  }

  const realMentionIds = extractRealDiscordMentionIds(historyText);
  const candidateDiscordIds = new Set<string>(realMentionIds);
  for (const memberId of guild.members.cache.keys()) candidateDiscordIds.add(memberId);

  const eligibleRows = await userRepository.loadEligibleContextReferenceCandidates({
    serverDiscId: params.guildId,
    candidateDiscordIds: Array.from(candidateDiscordIds),
    normalizedHistoryText: historyText,
  });

  const eligibleMembers = (
    await Promise.all(
      eligibleRows.map(async (userRow) => {
        const cachedMember = guild.members.cache.get(userRow.user_disc_id);
        const member = cachedMember ?? (await guild.members.fetch(userRow.user_disc_id).catch(() => null));
        return member && !member.user.bot ? { member, userRow } : null;
      }),
    )
  ).filter((candidate): candidate is { member: GuildMember; userRow: UserRow } => candidate !== null);

  const participantAliases = eligibleMembers.flatMap(({ member, userRow }) =>
    buildDiscordUserAliases({
      owner: createDiscordUserKey(userRow.user_disc_id),
      userRow,
      identity: {
        displayName: member.displayName,
        nickname: member.nickname,
        globalName: member.user.globalName,
        username: member.user.username,
      },
      exposeSavedNickname: false,
    }),
  );
  const aliasResolution = resolveUniqueParticipantAliasReferences(historyText, participantAliases);
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
    referencedUserIds.delete(existingParticipantId);
    referencedUserReasons.delete(existingParticipantId);
  }

  return {
    referencedUserIds,
    referencedUserRows: new Map(
      eligibleMembers
        .filter(({ userRow }) => referencedUserIds.has(userRow.user_disc_id))
        .map(({ userRow }) => [userRow.user_disc_id, userRow]),
    ),
    referencedUserReasons,
    aliasReferenceDiagnostics: aliasResolution.diagnostics,
    publicPersonaProfiles,
    personaProfileReasons,
  };
}
