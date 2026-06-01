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
