import { LOCALE_ALIASES } from "@/constants/locales";
import type { TomoriPresetRow } from "@/types/db/schema";

/**
 * Languages a preset may fall back to for a locale, most preferred first. Commands pass the raw
 * Discord locale, so an aliased one (`es-ES`) must map to the language the catalog seeds (`es-419`).
 */
export function presetFallbackLanguages(locale: string): string[] {
  const authoredLocale = LOCALE_ALIASES[locale as keyof typeof LOCALE_ALIASES] ?? locale;
  const baseLanguage = authoredLocale.split("-")[0];
  return [...new Set([authoredLocale, baseLanguage, "en-US"])];
}

/**
 * Picks the presets in the most preferred language from {@link presetFallbackLanguages} that has at
 * least one row for the requested NSFW side, falling back to English only when the locale has none.
 * `nsfw` selects one side of the flag: SFW routes never offer NSFW presets because only the
 * age-restricted `/nsfw` routes may, and the `/nsfw` listing offers nothing else. Rows come back in
 * ascending `preset_lineage_id` order, so the selector sequence is the same in every locale.
 *
 * @param rows - Candidate rows in any of {@link presetFallbackLanguages}
 */
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
