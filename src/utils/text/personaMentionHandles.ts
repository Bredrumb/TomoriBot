import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import {
  buildAliasCollisionIndex,
  buildPersonaAliases,
  normalizeParticipantAlias,
} from "@/utils/text/participants/aliases";
import { createPersonaKey, serializeParticipantKey, type ParticipantAlias } from "@/utils/text/participants/identity";
import {
  mergeParticipantTargetIndexes,
  type ParticipantTargetEntry,
  type ParticipantTargetIndex,
} from "@/utils/text/participants/targetIndex";

type PersonaMentionSource = Pick<TomoriState, "persona_nickname" | "trigger_words"> &
  Partial<Pick<TomoriState, "persona_id">>;

export interface PersonaMentionCatalog {
  mentionMap: Map<string, string>;
  targetIndex: ParticipantTargetIndex;
}

/**
 * Builds a lookup for persona-directed `@name` text that should remain a plain
 * trigger token instead of being stripped as an unresolved Discord user mention.
 *
 * Values are canonical trigger words without the leading `@`; callers emit them
 * as `@${value}` so deliberate trigger mode can route the generated message.
 */
export function buildPersonaMentionCatalog(personas: readonly PersonaMentionSource[]): PersonaMentionCatalog {
  const map = new Map<string, string>();
  const aliases: ParticipantAlias[] = [];
  const targets: ParticipantTargetEntry[] = [];

  personas.forEach((persona, index) => {
    const personaId =
      typeof persona.persona_id === "number" && Number.isSafeInteger(persona.persona_id) && persona.persona_id >= 0
        ? persona.persona_id
        : index;
    const key = createPersonaKey(personaId);
    const personaAliases = buildPersonaAliases({
      owner: key,
      nickname: persona.persona_nickname,
      triggerWords: persona.trigger_words,
    }).aliases;
    aliases.push(...personaAliases);
    targets.push({
      key,
      serializedKey: serializeParticipantKey(key),
      displayLabel: persona.persona_nickname,
      primaryAlias: persona.persona_nickname,
      mentionable: false,
      inParticipantContext: false,
      aliases: personaAliases,
    });
  });

  for (const collision of buildAliasCollisionIndex(aliases, "output_mention").values()) {
    if (collision.owners.length !== 1) continue;
    const alias = collision.aliases[0];
    if (alias?.canonicalValue) map.set(alias.normalized, alias.canonicalValue);
  }

  return { mentionMap: map, targetIndex: { targets, personaCatalogComplete: true } };
}

export function resolvePersonaMentionHandle(
  handle: string,
  personaMentionMap?: ReadonlyMap<string, string>,
): string | null {
  if (!personaMentionMap || personaMentionMap.size === 0) return null;

  const normalizedHandle = normalizeParticipantAlias(handle);
  if (!normalizedHandle) return null;

  const canonicalTrigger = personaMentionMap.get(normalizedHandle);
  return canonicalTrigger ? `@${canonicalTrigger}` : null;
}

export function attachPersonaMentionMapToContextItems(
  contextItems: StructuredContextItem[],
  catalogOrMap: PersonaMentionCatalog | Map<string, string>,
): StructuredContextItem[] {
  const personaMentionMap = catalogOrMap instanceof Map ? catalogOrMap : catalogOrMap.mentionMap;
  const personaTargetIndex = catalogOrMap instanceof Map ? undefined : catalogOrMap.targetIndex;
  if (contextItems.length === 0 || (personaMentionMap.size === 0 && !personaTargetIndex)) return contextItems;
  return [
    {
      ...contextItems[0],
      personaMentionMap,
      ...(personaTargetIndex && {
        participantTargetIndex: mergeParticipantTargetIndexes(
          contextItems[0].participantTargetIndex,
          personaTargetIndex,
        ),
      }),
    },
    ...contextItems.slice(1),
  ];
}
