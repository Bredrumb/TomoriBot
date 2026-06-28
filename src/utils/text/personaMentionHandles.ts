import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import { dedupeTriggerWords, normalizeTriggerWord } from "@/utils/text/triggerWords";

type PersonaMentionSource = Pick<TomoriState, "persona_nickname" | "trigger_words">;

function normalizePersonaMentionAlias(value: string): string {
  return normalizeTriggerWord(value.replace(/^@+/, "")).trim();
}

function isDiscordMentionTrigger(value: string): boolean {
  return normalizeTriggerWord(value, { lowercase: false }).startsWith("<@");
}

function registerAlias(
  map: Map<string, string>,
  ambiguousAliases: Set<string>,
  alias: string,
  canonicalTrigger: string,
): void {
  const normalizedAlias = normalizePersonaMentionAlias(alias);
  const normalizedCanonical = normalizeTriggerWord(canonicalTrigger, { lowercase: false }).trim();
  if (!normalizedAlias || !normalizedCanonical || ambiguousAliases.has(normalizedAlias)) return;

  const existing = map.get(normalizedAlias);
  if (existing && normalizeTriggerWord(existing) !== normalizeTriggerWord(normalizedCanonical)) {
    map.delete(normalizedAlias);
    ambiguousAliases.add(normalizedAlias);
    return;
  }

  map.set(normalizedAlias, normalizedCanonical);
}

/**
 * Builds a lookup for persona-directed `@name` text that should remain a plain
 * trigger token instead of being stripped as an unresolved Discord user mention.
 *
 * Values are canonical trigger words without the leading `@`; callers emit them
 * as `@${value}` so deliberate trigger mode can route the generated message.
 */
export function buildPersonaMentionMap(personas: readonly PersonaMentionSource[]): Map<string, string> {
  const map = new Map<string, string>();
  const ambiguousAliases = new Set<string>();

  for (const persona of personas) {
    const triggers = dedupeTriggerWords(persona.trigger_words ?? [], { lowercase: false }).filter(
      (trigger) => !isDiscordMentionTrigger(trigger),
    );
    const nickname = normalizeTriggerWord(persona.persona_nickname ?? "", { lowercase: false }).trim();
    const nicknameKey = normalizePersonaMentionAlias(nickname);
    const nicknameTrigger =
      triggers.find((trigger) => normalizePersonaMentionAlias(trigger) === nicknameKey) ?? triggers[0] ?? nickname;

    if (nickname && nicknameTrigger) {
      registerAlias(map, ambiguousAliases, nickname, nicknameTrigger);
    }

    for (const trigger of triggers) {
      registerAlias(map, ambiguousAliases, trigger, trigger);
    }
  }

  return map;
}

export function resolvePersonaMentionHandle(
  handle: string,
  personaMentionMap?: ReadonlyMap<string, string>,
): string | null {
  if (!personaMentionMap || personaMentionMap.size === 0) return null;

  const normalizedHandle = normalizePersonaMentionAlias(handle);
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
