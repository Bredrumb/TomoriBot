const ENGLISH_EXPLICIT_LONG_TERM_MEMORY_INTENT_PHRASES = [
  "remember",
  "don't forget",
  "note",
  "commit to memory",
  "for future conversations",
  "for future reference",
] as const;

const JAPANESE_EXPLICIT_LONG_TERM_MEMORY_INTENT_PHRASES = [
  "覚えておいて",
  "覚えといて",
  "これを覚えて",
  "これ覚えて",
  "それを覚えて",
  "それ覚えて",
  "忘れないで",
  "今後のために覚えて",
  "後で使えるように覚えて",
] as const;

const EXPLICIT_LONG_TERM_MEMORY_INTENT_PHRASES = [
  ...ENGLISH_EXPLICIT_LONG_TERM_MEMORY_INTENT_PHRASES,
  ...JAPANESE_EXPLICIT_LONG_TERM_MEMORY_INTENT_PHRASES,
];

function normalizeExplicitLongTermMemoryIntentText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function hasExplicitLongTermMemoryIntent(text: string | null | undefined): boolean {
  if (!text?.trim()) {
    return false;
  }

  const normalizedText = normalizeExplicitLongTermMemoryIntentText(text);
  return EXPLICIT_LONG_TERM_MEMORY_INTENT_PHRASES.some((phrase) => normalizedText.includes(phrase));
}
