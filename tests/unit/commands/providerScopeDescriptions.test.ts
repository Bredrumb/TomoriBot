import { beforeAll, describe, expect, it } from "bun:test";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { expectForEveryLocale } from "../../helpers/localeCases";

const LOCALES = ["en-US", "ja"] as const;

/** Discord rejects a registered command or subcommand description longer than this. */
const DISCORD_DESCRIPTION_LIMIT = 100;

const ROOT_KEYS = ["commands.providers.description", "commands.config.description"];

const PERSONAL_SCOPED_KEYS = [
  "commands.personal.description",
  "commands.personal.config.description",
  "commands.personal.memories.description",
  "commands.personal.providers.description",
];

const PERSONAL_MARKERS: Record<string, string[]> = {
  "en-US": ["your", "personal", "every server"],
  ja: ["個人", "自分", "全サーバー"],
};

function matchesAny(text: string, markers: string[]): boolean {
  const haystack = text.toLowerCase();
  return markers.some((marker) => haystack.includes(marker.toLowerCase()));
}

describe("registered root and personal command descriptions", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("resolves every current root description within Discord's limit", () =>
    expectForEveryLocale((locale) => {
      for (const key of ROOT_KEYS) {
        const description = localizer(locale, key);
        expect(description).not.toBe(key);
        expect(description.length).toBeLessThanOrEqual(DISCORD_DESCRIPTION_LIMIT);
      }
    }, LOCALES));

  it("keeps every live personal destination scoped and within Discord's limit", () => {
    for (const key of PERSONAL_SCOPED_KEYS) {
      const description = localizer("en-US", key);
      expect(description).not.toBe(key);
      expect(description.length).toBeLessThanOrEqual(DISCORD_DESCRIPTION_LIMIT);
      expect(matchesAny(description, PERSONAL_MARKERS["en-US"])).toBe(true);
    }
  });

  it("keeps the localized personal root explicitly personal", () => {
    expect(matchesAny(localizer("ja", "commands.personal.description"), PERSONAL_MARKERS.ja)).toBe(true);
  });
});
