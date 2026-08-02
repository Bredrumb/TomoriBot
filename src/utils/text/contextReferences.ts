import type { Client, GuildMember } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { userRepository } from "@/utils/db/repositories";
import { getTriggerFirstMatchIndexInContent } from "@/utils/chat/triggerProcessor";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import type { PublicPersonaProfile, SimplifiedMessageForContext } from "@/utils/text/context/types";
import type { ParticipantInclusionReason } from "@/utils/text/participants/identity";

const REAL_DISCORD_MENTION_PATTERN = /<@!?(\d+)>/g;
const STANDALONE_ALIAS_CHARACTER_CLASS = "\\p{L}\\p{N}\\p{M}_";

export type EligibleAliasCandidate = {
  userId: string;
  aliases: string[];
};

export type ResolvedContextReferences = {
  referencedUserIds: Set<string>;
  referencedUserRows: Map<string, UserRow>;
  referencedUserReasons: Map<string, ReadonlySet<"real_mention" | "unique_text_alias">>;
  publicPersonaProfiles: PublicPersonaProfile[];
  personaProfileReasons: Map<number, ReadonlySet<ParticipantInclusionReason>>;
};

function addReason<Key, Reason>(map: Map<Key, Set<Reason>>, key: Key, reason: Reason): void {
  const reasons = map.get(key) ?? new Set<Reason>();
  reasons.add(reason);
  map.set(key, reasons);
}

const normalizeAlias = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const containsStandaloneAlias = (text: string, alias: string): boolean => {
  const normalizedAlias = alias.trim();
  if (!normalizedAlias) return false;

  const aliasPattern = escapeRegExp(normalizedAlias).replace(/\s+/g, "\\s+");
  return new RegExp(
    `(?:` +
      `(?<![${STANDALONE_ALIAS_CHARACTER_CLASS}])@${aliasPattern}` +
      `|(?<![${STANDALONE_ALIAS_CHARACTER_CLASS}@])${aliasPattern}` +
      `)(?![${STANDALONE_ALIAS_CHARACTER_CLASS}])`,
    "iu",
  ).test(text);
};

/**
 * Resolves aliases only when exactly one eligible guild member owns the
 * standalone phrase. Every alias is considered; there is intentionally no cap
 * or common-word denylist.
 */
export function resolveUniqueTextualAliasReferences(
  historyText: string,
  candidates: EligibleAliasCandidate[],
): Set<string> {
  const aliasOwners = new Map<string, Set<string>>();
  const aliasDisplayValues = new Map<string, string>();

  for (const candidate of candidates) {
    for (const rawAlias of candidate.aliases) {
      const alias = rawAlias.trim();
      const normalizedAlias = normalizeAlias(alias);
      if (!normalizedAlias) continue;

      const owners = aliasOwners.get(normalizedAlias) ?? new Set<string>();
      owners.add(candidate.userId);
      aliasOwners.set(normalizedAlias, owners);
      if (!aliasDisplayValues.has(normalizedAlias)) aliasDisplayValues.set(normalizedAlias, alias);
    }
  }

  const referencedUserIds = new Set<string>();
  for (const [normalizedAlias, owners] of aliasOwners) {
    if (owners.size !== 1) continue;
    const alias = aliasDisplayValues.get(normalizedAlias);
    if (!alias || !containsStandaloneAlias(historyText, alias)) continue;
    const [ownerId] = owners;
    if (ownerId) referencedUserIds.add(ownerId);
  }

  return referencedUserIds;
}

/**
 * Finds persona trigger references in the complete sanitized history. This
 * deliberately ignores Deliberate Trigger Mode; callers use the result only
 * for context enrichment, never response scheduling.
 */
export function discoverReferencedPersonaIds(
  simplifiedMessageHistory: SimplifiedMessageForContext[],
  personas: TomoriState[],
): Set<number> {
  const referencedPersonaIds = new Set<number>();

  for (const message of simplifiedMessageHistory) {
    if (message.id.startsWith("synthetic-user-block-") || !message.content) continue;

    for (const persona of personas) {
      if (typeof persona.persona_id !== "number" || referencedPersonaIds.has(persona.persona_id)) continue;
      if (
        (persona.trigger_words ?? []).some(
          (trigger) =>
            getTriggerFirstMatchIndexInContent(message.content ?? "", trigger, false) !== Number.POSITIVE_INFINITY,
        )
      ) {
        referencedPersonaIds.add(persona.persona_id);
      }
    }
  }

  return referencedPersonaIds;
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

const buildMemberAliases = (member: GuildMember, userRow: UserRow): string[] => {
  const aliases = new Map<string, string>();
  for (const value of [
    userRow.user_nickname,
    member.displayName,
    member.nickname,
    member.user.globalName,
    member.user.username,
  ]) {
    const alias = value?.trim();
    const normalizedAlias = alias ? normalizeAlias(alias) : "";
    if (alias && normalizedAlias && !aliases.has(normalizedAlias)) aliases.set(normalizedAlias, alias);
  }
  return Array.from(aliases.values());
};

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

  const aliasCandidates = eligibleMembers.map(({ member, userRow }) => ({
    userId: userRow.user_disc_id,
    aliases: buildMemberAliases(member, userRow),
  }));
  const referencedUserIds = resolveUniqueTextualAliasReferences(historyText, aliasCandidates);
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
    publicPersonaProfiles,
    personaProfileReasons,
  };
}
