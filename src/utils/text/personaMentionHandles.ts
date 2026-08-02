import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import {
  buildAliasCollisionIndex,
  buildPersonaAliases,
  normalizeParticipantAlias,
} from "@/utils/text/participants/aliases";
import { createPersonaKey, type ParticipantAlias } from "@/utils/text/participants/identity";

type PersonaMentionSource = Pick<TomoriState, "persona_nickname" | "trigger_words"> &
  Partial<Pick<TomoriState, "persona_id">>;

/**
 * Builds a lookup for persona-directed `@name` text that should remain a plain
 * trigger token instead of being stripped as an unresolved Discord user mention.
 *
 * Values are canonical trigger words without the leading `@`; callers emit them
 * as `@${value}` so deliberate trigger mode can route the generated message.
 */
export function buildPersonaMentionMap(personas: readonly PersonaMentionSource[]): Map<string, string> {
  const map = new Map<string, string>();
  const aliases: ParticipantAlias[] = [];

  personas.forEach((persona, index) => {
    const personaId =
      typeof persona.persona_id === "number" && Number.isSafeInteger(persona.persona_id) && persona.persona_id >= 0
        ? persona.persona_id
        : index;
    aliases.push(
      ...buildPersonaAliases({
        owner: createPersonaKey(personaId),
        nickname: persona.persona_nickname,
        triggerWords: persona.trigger_words,
      }).aliases,
    );
  });

  for (const collision of buildAliasCollisionIndex(aliases, "output_mention").values()) {
    if (collision.owners.length !== 1) continue;
    const alias = collision.aliases[0];
    if (alias?.canonicalValue) map.set(alias.normalized, alias.canonicalValue);
  }

  return map;
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
  personaMentionMap: Map<string, string>,
): StructuredContextItem[] {
  if (contextItems.length === 0 || personaMentionMap.size === 0) return contextItems;
  return [{ ...contextItems[0], personaMentionMap }, ...contextItems.slice(1)];
}
