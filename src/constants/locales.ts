/** Discord accepts these keys in application command localization maps. */
export const DISCORD_LOCALES = [
  "id",
  "da",
  "de",
  "en-GB",
  "en-US",
  "es-ES",
  "es-419",
  "fr",
  "hr",
  "it",
  "lt",
  "hu",
  "nl",
  "no",
  "pl",
  "pt-BR",
  "ro",
  "fi",
  "sv-SE",
  "vi",
  "tr",
  "cs",
  "el",
  "bg",
  "ru",
  "uk",
  "hi",
  "th",
  "zh-CN",
  "ja",
  "zh-TW",
  "ko",
] as const;

export type LocaleCode = (typeof DISCORD_LOCALES)[number];

const discordLocaleSet: ReadonlySet<string> = new Set(DISCORD_LOCALES);

export function isDiscordLocaleCode(value: string): value is LocaleCode {
  return discordLocaleSet.has(value);
}

/** One authored Spanish tree serves both Discord Spanish locale keys. */
export const LOCALE_ALIASES = {
  "es-ES": "es-419",
} as const satisfies Partial<Record<LocaleCode, LocaleCode>>;
