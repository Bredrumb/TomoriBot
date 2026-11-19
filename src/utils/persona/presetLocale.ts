import { LOCALE_ALIASES } from "@/constants/locales";
import type { TomoriPresetRow } from "@/types/db/schema";

// Raw Discord locales from commands must map through LOCALE_ALIASES so aliased locales like es-ES match
// catalog-seeded es-419.
export function presetFallbackLanguages(locale: string): string[] {
  const authoredLocale = LOCALE_ALIASES[locale as keyof typeof LOCALE_ALIASES] ?? locale;
  const baseLanguage = authoredLocale.split("-")[0];
  return [...new Set([authoredLocale, baseLanguage, "en-US"])];
}

// Strict is_nsfw filtering applies because only /nsfw routes may show NSFW presets; preset_lineage_id sort keeps
// selector order identical across locales.
export function selectPresetsForLocale(
  rows: readonly TomoriPresetRow[],
  locale: string,
  options: { nsfw: boolean },
): TomoriPresetRow[] {
  const languages = presetFallbackLanguages(locale);
  const candidates = rows.filter((row) => row.is_nsfw === options.nsfw);
  const selectedLanguage = languages.find((language) => candidates.some((row) => row.preset_language === language));
  if (!selectedLanguage) return [];

  return candidates
    .filter((row) => row.preset_language === selectedLanguage)
    .sort((left, right) => lineageOrder(left) - lineageOrder(right));
}

function lineageOrder(preset: TomoriPresetRow): number {
  return preset.preset_lineage_id ?? Number.MAX_SAFE_INTEGER;
}
