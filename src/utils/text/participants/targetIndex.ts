import type { ConversationUserReference, StructuredContextItem } from "@/types/misc/context";
import { aliasesForPurpose, normalizeParticipantAlias } from "@/utils/text/participants/aliases";
import type { HydratedParticipantProfile } from "@/utils/text/participants/hydration";
import {
  serializeParticipantKey,
  type ParticipantAlias,
  type ParticipantAliasPurpose,
  type ParticipantKey,
} from "@/utils/text/participants/identity";

export interface ParticipantTargetEntry {
  key: ParticipantKey;
  serializedKey: string;
  displayLabel: string;
  primaryAlias: string | null;
  targetId?: string;
  mentionable: boolean;
  inParticipantContext: boolean;
  aliases: readonly ParticipantAlias[];
}

export interface ParticipantTargetIndex {
  targets: readonly ParticipantTargetEntry[];
  personaCatalogComplete?: boolean;
}

export function buildParticipantTargetIndex(profiles: readonly HydratedParticipantProfile[]): ParticipantTargetIndex {
  return {
    targets: profiles.map((profile) => ({
      key: profile.key,
      serializedKey: serializeParticipantKey(profile.key),
      displayLabel: profile.displayName,
      primaryAlias: profile.primaryAlias,
      ...(profile.resolvableTargetId && { targetId: profile.resolvableTargetId }),
      mentionable: profile.mentionable,
      inParticipantContext: true,
      aliases: profile.aliases,
    })),
  };
}

export function mergeParticipantTargetIndexes(
  ...indexes: ReadonlyArray<ParticipantTargetIndex | undefined>
): ParticipantTargetIndex {
  const targets = new Map<string, ParticipantTargetEntry>();
  for (const index of indexes) {
    for (const target of index?.targets ?? []) {
      const existing = targets.get(target.serializedKey);
      if (!existing) {
        targets.set(target.serializedKey, target);
        continue;
      }
      const aliases = new Map(existing.aliases.map((alias) => [targetAliasKey(alias), alias]));
      for (const alias of target.aliases) aliases.set(targetAliasKey(alias), alias);
      targets.set(target.serializedKey, {
        ...existing,
        ...target,
        targetId: target.targetId ?? existing.targetId,
        inParticipantContext: existing.inParticipantContext || target.inParticipantContext,
        aliases: [...aliases.values()],
      });
    }
  }
  return {
    targets: [...targets.values()],
    ...(indexes.some((index) => index?.personaCatalogComplete) && { personaCatalogComplete: true }),
  };
}

function targetAliasKey(alias: ParticipantAlias): string {
  return `${alias.normalized}\0${[...alias.purposes].sort().join(",")}`;
}

export function targetAliasesForPurpose(
  target: ParticipantTargetEntry,
  purpose: ParticipantAliasPurpose,
): ParticipantAlias[] {
  return aliasesForPurpose(target.aliases, purpose);
}

export function projectConversationUserReferences(index: ParticipantTargetIndex): ConversationUserReference[] {
  const references: ConversationUserReference[] = [];
  for (const target of index.targets) {
    if (!target.inParticipantContext) continue;
    const aliases = targetAliasesForPurpose(target, "tool_target").map((alias) => alias.value);
    if (!target.targetId || aliases.length === 0) continue;
    references.push({
      targetId: target.targetId,
      displayLabel: target.displayLabel,
      aliases,
      mentionable: target.mentionable,
    });
  }
  return references;
}

export function collectParticipantTargetIndex(contextItems: readonly StructuredContextItem[]): ParticipantTargetIndex {
  return mergeParticipantTargetIndexes(...contextItems.map((item) => item.participantTargetIndex));
}

export function buildPurposeCollisionIndex(
  index: ParticipantTargetIndex,
  purpose: ParticipantAliasPurpose,
  keyFilter?: (key: ParticipantKey) => boolean,
): Map<string, ParticipantTargetEntry[]> {
  const collisions = new Map<string, Map<string, ParticipantTargetEntry>>();
  for (const target of index.targets) {
    if (keyFilter && !keyFilter(target.key)) continue;
    for (const alias of targetAliasesForPurpose(target, purpose)) {
      const owners = collisions.get(alias.normalized) ?? new Map<string, ParticipantTargetEntry>();
      owners.set(target.serializedKey, target);
      collisions.set(alias.normalized, owners);
    }
  }
  return new Map([...collisions].map(([normalized, owners]) => [normalized, [...owners.values()]]));
}

export function findTargetsByAlias(
  index: ParticipantTargetIndex,
  input: string,
  purpose: ParticipantAliasPurpose,
  keyFilter?: (key: ParticipantKey) => boolean,
): ParticipantTargetEntry[] {
  const normalized = normalizeParticipantAlias(input);
  if (!normalized) return [];
  return buildPurposeCollisionIndex(index, purpose, keyFilter).get(normalized) ?? [];
}
