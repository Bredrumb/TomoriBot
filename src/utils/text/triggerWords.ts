const TRIGGER_WORD_SEPARATOR_PATTERN = /[,\u3001]/;

const SURROUNDING_QUOTE_PAIRS: Array<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["\u201c", "\u201d"],
  ["\u2018", "\u2019"],
  ["\u300c", "\u300d"],
  ["\u300e", "\u300f"],
  ["\uff62", "\uff63"],
  ["\u00ab", "\u00bb"],
  ["\u2039", "\u203a"],
];

type NormalizeTriggerWordOptions = {
  lowercase?: boolean;
};

export function stripSurroundingTriggerQuotes(value: string): string {
  let result = value.trim();
  let changed = true;

  while (changed && result.length >= 2) {
    changed = false;

    for (const [openingQuote, closingQuote] of SURROUNDING_QUOTE_PAIRS) {
      if (
        result.length >= openingQuote.length + closingQuote.length &&
        result.startsWith(openingQuote) &&
        result.endsWith(closingQuote)
      ) {
        result = result.slice(openingQuote.length, result.length - closingQuote.length).trim();
        changed = true;
        break;
      }
    }
  }

  return result;
}

export function normalizeTriggerWord(value: string, options: NormalizeTriggerWordOptions = {}): string {
  const normalized = stripSurroundingTriggerQuotes(value);
  return options.lowercase === false ? normalized : normalized.toLowerCase();
}

export function dedupeTriggerWords(
  triggerWords: readonly string[],
  options: NormalizeTriggerWordOptions = {},
): string[] {
  const uniqueTriggers: string[] = [];
  const seenTriggers = new Set<string>();

  for (const triggerWord of triggerWords) {
    const normalizedTrigger = normalizeTriggerWord(triggerWord, options);
    if (normalizedTrigger.length === 0) {
      continue;
    }

    const comparisonKey = normalizedTrigger.toLowerCase();
    if (seenTriggers.has(comparisonKey)) {
      continue;
    }

    seenTriggers.add(comparisonKey);
    uniqueTriggers.push(normalizedTrigger);
  }

  return uniqueTriggers;
}

export function parseTriggerWordListInput(input: string, options: NormalizeTriggerWordOptions = {}): string[] {
  return dedupeTriggerWords(input.split(TRIGGER_WORD_SEPARATOR_PATTERN), options);
}

/**
 * Returns the subset of `candidateTriggers` whose words are not already claimed
 * by another owner, comparing case-insensitively. Candidates are also de-duped
 * against each other, so the result never repeats a word.
 *
 * Used to keep trigger words single-owner across a server's personas: pass the
 * triggers already owned by higher-priority personas (plus reserved base words)
 * as `claimedTriggers`, and the candidate persona's desired triggers as
 * `candidateTriggers`.
 *
 * @param candidateTriggers - Triggers a persona wants to claim.
 * @param claimedTriggers   - Triggers already owned elsewhere (any iterable).
 * @param options           - Normalization options; `lowercase: false` preserves
 *                            the original casing of kept words in the output.
 * @returns The kept triggers, in input order, with claimed/duplicate words removed.
 */
export function selectUnclaimedTriggerWords(
  candidateTriggers: readonly string[],
  claimedTriggers: Iterable<string>,
  options: NormalizeTriggerWordOptions = {},
): string[] {
  const claimedKeys = new Set<string>();
  for (const claimed of claimedTriggers) {
    const normalizedClaimed = normalizeTriggerWord(claimed);
    if (normalizedClaimed.length > 0) {
      claimedKeys.add(normalizedClaimed);
    }
  }

  const keptTriggers: string[] = [];
  const seenKeys = new Set<string>();
  for (const candidate of candidateTriggers) {
    const normalizedCandidate = normalizeTriggerWord(candidate, options);
    if (normalizedCandidate.length === 0) {
      continue;
    }

    const comparisonKey = normalizedCandidate.toLowerCase();
    if (claimedKeys.has(comparisonKey) || seenKeys.has(comparisonKey)) {
      continue;
    }

    seenKeys.add(comparisonKey);
    keptTriggers.push(normalizedCandidate);
  }

  return keptTriggers;
}
