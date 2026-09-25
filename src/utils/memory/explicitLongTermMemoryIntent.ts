import { EXPLICIT_MEMORY_PACK_KEY, getIntentPackUnion } from "@/utils/text/localeIntentPacks";

function normalizeExplicitLongTermMemoryIntentText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function hasExplicitLongTermMemoryIntent(text: string | null | undefined): boolean {
  if (!text?.trim()) {
    return false;
  }

  const normalizedText = normalizeExplicitLongTermMemoryIntentText(text);
  return getIntentPackUnion(EXPLICIT_MEMORY_PACK_KEY).some((phrase) =>
    normalizedText.includes(normalizeExplicitLongTermMemoryIntentText(phrase.replace(/\*$/, ""))),
  );
}
