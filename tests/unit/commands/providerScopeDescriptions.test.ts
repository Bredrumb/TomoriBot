import { beforeAll, describe, expect, it } from "bun:test";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";

const LOCALES = ["en-US", "ja"] as const;

/** Discord rejects a registered command or subcommand description longer than this. */
const DISCORD_DESCRIPTION_LIMIT = 100;

const SERVER_SCOPED_KEYS = [
  "commands.provider.description",
  "commands.provider.add.description",
  "commands.provider.remove.description",
  "commands.model.description",
  "commands.model.text.description",
  "commands.model.embedding.description",
  "commands.model.image.description",
  "commands.model.video.description",
  "commands.model.vision.description",
  "commands.model.fallback.description",
  "commands.model.parameters.description",
];

const PERSONAL_SCOPED_KEYS = [
  "commands.personal.provider.description",
  "commands.personal.provider.add.description",
  "commands.personal.provider.remove.description",
  "commands.personal.provider.model-text.description",
  "commands.personal.provider.model-embedding.description",
  "commands.personal.provider.model-image.description",
  "commands.personal.provider.model-video.description",
  "commands.personal.provider.model-vision.description",
  "commands.personal.provider.toggle-models.description",
  "commands.personal.model.description",
  "commands.personal.model.fallback.description",
  "commands.personal.parameters.description",
];

/** Scope markers that must appear in a description for it to read as server- or user-scoped. */
const SERVER_MARKERS: Record<string, string[]> = {
  "en-US": ["this server", "server's"],
  ja: ["このサーバー"],
};

const PERSONAL_MARKERS: Record<string, string[]> = {
  "en-US": ["your", "personal", "every server"],
  ja: ["個人", "自分", "全サーバー"],
};

function matchesAny(text: string, markers: string[]): boolean {
  const haystack = text.toLowerCase();
  return markers.some((marker) => haystack.includes(marker.toLowerCase()));
}

describe("server and personal command descriptions state their scope", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  for (const locale of LOCALES) {
    it(`resolves every scoped description in ${locale}`, () => {
      for (const key of [...SERVER_SCOPED_KEYS, ...PERSONAL_SCOPED_KEYS]) {
        // The localizer echoes the key back when it is missing, which is exactly the failure
        // that let `/model` fall through to the command loader's generic fallback description.
        expect(localizer(locale, key)).not.toBe(key);
      }
    });

    it(`keeps every scoped description within Discord's limit in ${locale}`, () => {
      for (const key of [...SERVER_SCOPED_KEYS, ...PERSONAL_SCOPED_KEYS]) {
        expect(localizer(locale, key).length).toBeLessThanOrEqual(DISCORD_DESCRIPTION_LIMIT);
      }
    });

    it(`names the server scope on /provider and /model in ${locale}`, () => {
      for (const key of SERVER_SCOPED_KEYS) {
        expect(matchesAny(localizer(locale, key), SERVER_MARKERS[locale])).toBe(true);
      }
    });

    it(`names the personal scope on /personal provider and /personal model in ${locale}`, () => {
      for (const key of PERSONAL_SCOPED_KEYS) {
        expect(matchesAny(localizer(locale, key), PERSONAL_MARKERS[locale])).toBe(true);
      }
    });
  }

  it("keeps the cross-server consequence in the activation confirmation copy", () => {
    expect(localizer("en-US", "commands.personal.provider.activation_confirm_description")).toContain("every server");
    expect(localizer("en-US", "commands.personal.provider.scope_notice")).toContain("every server");
    expect(localizer("ja", "commands.personal.provider.activation_confirm_description")).toContain("すべてのサーバー");
    expect(localizer("ja", "commands.personal.provider.scope_notice")).toContain("すべてのサーバー");
  });
});
