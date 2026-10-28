import {
  LOREBOOK_CONTEXT_CHAR_BUDGET,
  LOREBOOK_SELECTIVE_LOGIC,
  type LorebookEntryRow,
} from "@/modules/lorebooks/db/types";
import { channelScopeAdmits, channelScopeCandidates } from "@/utils/discord/channelScope";

export interface LorebookActivationOptions {
  serverId: number;
  lineageId: number | null;
  channelId: string;
  parentChannelId?: string | null;
  channelScopeEnabled: boolean;
  charBudget?: number;
  random?: () => number;
}

// Untrusted regex keys stay inert until import evidence justifies a ReDoS-safe engine.
const REGEX_KEY = /^\/.+\/[a-z]*$/i;
const WORD_BOUNDARY_KEY = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}\p{M}\s'_-]+$/u;
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function containsWholeWord(haystack: string, key: string): boolean {
  for (let index = haystack.indexOf(key); index !== -1; index = haystack.indexOf(key, index + 1)) {
    const before = Array.from(haystack.slice(Math.max(0, index - 2), index)).at(-1);
    const after = String.fromCodePoint(haystack.codePointAt(index + key.length) ?? 0);
    if ((!before || !WORD_CHARACTER.test(before)) && !WORD_CHARACTER.test(after)) return true;
  }
  return false;
}

function keyMatches(haystack: string, rawKey: string): boolean {
  const key = normalize(rawKey.trim());
  if (!key || REGEX_KEY.test(key)) return false;
  return WORD_BOUNDARY_KEY.test(key) ? containsWholeWord(haystack, key) : haystack.includes(key);
}

function matchesKeys(entry: LorebookEntryRow, haystack: string): boolean {
  if (!entry.keys.some((key) => keyMatches(haystack, key))) return false;
  if (entry.secondary_keys.length === 0) return true;
  const hits = entry.secondary_keys.filter((key) => keyMatches(haystack, key)).length;
  switch (entry.selective_logic) {
    case LOREBOOK_SELECTIVE_LOGIC.AND_ANY:
      return hits > 0;
    case LOREBOOK_SELECTIVE_LOGIC.NOT_ALL:
      return hits < entry.secondary_keys.length;
    case LOREBOOK_SELECTIVE_LOGIC.NOT_ANY:
      return hits === 0;
    case LOREBOOK_SELECTIVE_LOGIC.AND_ALL:
      return hits === entry.secondary_keys.length;
  }
}

export function evaluateActiveLorebookEntries(
  entries: readonly LorebookEntryRow[],
  recentMessages: readonly string[],
  options: LorebookActivationOptions,
): LorebookEntryRow[] {
  const random = options.random ?? Math.random;
  const charBudget = options.charBudget ?? LOREBOOK_CONTEXT_CHAR_BUDGET;
  const candidates = channelScopeCandidates(options.channelId, options.parentChannelId);
  const windows = new Map<number, string>();
  const windowFor = (depth: number): string => {
    let haystack = windows.get(depth);
    if (haystack === undefined) {
      haystack = normalize(recentMessages.slice(-depth).join("\n"));
      windows.set(depth, haystack);
    }
    return haystack;
  };
  const activated = entries
    .filter((entry) => entry.server_id === options.serverId && entry.enabled && entry.content.trim().length > 0)
    .filter((entry) => entry.persona_lineage_id === null || entry.persona_lineage_id === options.lineageId)
    .filter((entry) => !options.channelScopeEnabled || channelScopeAdmits(entry.channel_disc_ids, candidates))
    .filter(
      (entry) =>
        entry.constant || (matchesKeys(entry, windowFor(entry.scan_depth)) && random() * 100 < entry.trigger_chance),
    )
    .sort((left, right) => left.insertion_order - right.insertion_order || left.entry_id - right.entry_id);

  const admitted: LorebookEntryRow[] = [];
  let usedCharacters = 0;
  for (const entry of activated) {
    if (usedCharacters + entry.content.length > charBudget) continue;
    admitted.push(entry);
    usedCharacters += entry.content.length;
  }
  return admitted;
}
