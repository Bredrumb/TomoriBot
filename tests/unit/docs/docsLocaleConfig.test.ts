import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DOCS_LOCALE_ID,
  DOCS_BASE_URL,
  DOCS_LOCALES,
  DOCS_LOCALE_ALIASES,
  DOCS_ROUTES,
  PUBLISHED_DOCS_LOCALES,
  buildDefaultLocaleDocsPageUrl,
  buildLocalizedDocsPath,
  getDocsLocaleConfig,
  matchAcceptLanguage,
  resolveDocsLocale,
} from "@/constants/docsLocales";
import { isDiscordLocaleCode } from "@/constants/locales";
import { buildDocsUrl } from "@/utils/discord/docsLinks";
import { buildLegalDocUrl } from "@/utils/misc/docsUrl";

const repoRoot = join(import.meta.dir, "..", "..", "..");

describe("docs locale configuration", () => {
  it("keeps the published set in sync with the docs directory", () => {
    const onDisk = DOCS_LOCALES.filter((locale) => existsSync(join(repoRoot, "docs", locale.id))).map(
      (locale) => locale.id,
    );
    expect(onDisk).toEqual([...PUBLISHED_DOCS_LOCALES]);
  });

  it("reserves a locale root path segment for every locale in the table", () => {
    // The route segment is the locale id, so an id that shadows a docs section would make one of
    // the two unreachable. This asserts the reserved set is exactly the locale ids.
    const sectionDirectories = ["introduction", "features", "self-hosting", "legal", "meet-tomori", "wiki"];
    for (const locale of DOCS_LOCALES) {
      expect(sectionDirectories).not.toContain(locale.id);
    }
  });

  it("maps every locale to a Discord locale key the bot can be configured with", () => {
    for (const locale of DOCS_LOCALES) {
      expect(isDiscordLocaleCode(locale.botLocaleCode)).toBe(true);
    }
  });

  it("provides review notice copy for both notice modes in every published locale", () => {
    for (const locale of DOCS_LOCALES.filter((entry) => entry.docsTree)) {
      expect(locale.notices.draftsTitle.length).toBeGreaterThan(0);
      expect(locale.notices.draftsBody.length).toBeGreaterThan(0);
      expect(locale.notices.translatedTitle.length).toBeGreaterThan(0);
      expect(locale.notices.englishLinkText.length).toBeGreaterThan(0);
      expect(locale.notices.translatedBody).toContain("{english}");
    }
  });

  it("lets a locale name the source language in its own words", () => {
    // The link text ships inside the locale's own sentence, so a Japanese reader must not be shown
    // the English endonym as the anchor label.
    expect(getDocsLocaleConfig("ja")?.notices.englishLinkText).toBe("英語版");
    expect(getDocsLocaleConfig("en")?.notices.englishLinkText).toBe("English");
  });

  it("keys the alias map in the casing every lookup normalizes to", () => {
    // The alias lookup lowercases the caller's tag, because an `Accept-Language` range arrives that
    // way. A camel-cased key such as `es-ES` is therefore unreachable, and the alias silently
    // degrades to the base-language branch, which picks a locale only while one is published for
    // that base. This asserts the map's shape because the round trip cannot: `es-419` is not
    // published yet, so both paths currently resolve to English and would hide the difference.
    expect(DOCS_LOCALE_ALIASES["es-es"]).toBe("es-419");
    for (const key of Object.keys(DOCS_LOCALE_ALIASES)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it("exposes the default locale config used for fallbacks", () => {
    expect(getDocsLocaleConfig(DEFAULT_DOCS_LOCALE_ID)?.id).toBe("en");
    expect(getDocsLocaleConfig("nope")).toBeUndefined();
  });
});

describe("docs locale resolution", () => {
  it("resolves an exact published locale", () => {
    expect(resolveDocsLocale("ja")).toBe("ja");
  });

  it("resolves the English bot locale code to the default docs locale", () => {
    expect(resolveDocsLocale("en-US")).toBe("en");
  });

  it("matches an unambiguous base language", () => {
    expect(resolveDocsLocale("ja-JP")).toBe("ja");
  });

  it("does not route the es-ES alias to a Spanish tree that is not published yet", () => {
    // es-ES reuses es-419 strings, but an unpublished alias target must not become a docs prefix:
    // the reader would land on a route the site does not serve.
    expect(resolveDocsLocale("es-ES")).toBe(DEFAULT_DOCS_LOCALE_ID);
    expect(matchAcceptLanguage("es-ES,es;q=0.9")).toBe(DEFAULT_DOCS_LOCALE_ID);
  });

  it("falls back to English for an unsupported language", () => {
    expect(resolveDocsLocale("de")).toBe(DEFAULT_DOCS_LOCALE_ID);
  });

  it("accepts a locale tag in any case", () => {
    // An `Accept-Language` range arrives lowercased while the table keeps canonical casing, so the
    // two paths must agree on `JA` and on a region code such as `pt-br`.
    expect(resolveDocsLocale("JA")).toBe("ja");
    expect(resolveDocsLocale("ja-jp")).toBe("ja");
    expect(matchAcceptLanguage("JA")).toBe("ja");
    expect(matchAcceptLanguage("PT-BR")).toBe("pt-BR");
  });

  it("resolves a Chinese base language only while one Chinese tree is published", () => {
    // `zh` alone cannot choose between `zh-TW` and `zh-CN`, so the base-language branch picks a
    // locale only while exactly one of them is published. Both published means the tag is genuinely
    // ambiguous and resolves to the default; the shared helper keeps that rule.
    const chineseTrees = PUBLISHED_DOCS_LOCALES.filter((id) => id.split("-")[0].toLowerCase() === "zh");
    const expected = chineseTrees.length === 1 ? chineseTrees[0] : DEFAULT_DOCS_LOCALE_ID;

    expect(resolveDocsLocale("zh")).toBe(expected);
  });
});

describe("docs URL building", () => {
  // Each locale lane flips its own `docsTree`, so a hardcoded "unpublished" locale goes stale on the
  // next publication. An unlisted tag keeps the fallback covered once every planned tree ships.
  const unpublishedLocale = DOCS_LOCALES.find((locale) => !locale.docsTree)?.id ?? "de";

  it("prefixes a published locale onto every registered route", () => {
    for (const route of Object.values(DOCS_ROUTES)) {
      expect(buildLocalizedDocsPath("ja", route)).toBe(`/ja${route}`);
    }
  });

  it("returns English for a locale whose docs tree does not exist", () => {
    expect(buildLocalizedDocsPath(unpublishedLocale, DOCS_ROUTES.MEMORY)).toBe(`/en${DOCS_ROUTES.MEMORY}`);
  });

  it("keeps fragments intact", () => {
    expect(buildLocalizedDocsPath("ja", DOCS_ROUTES.SHORT_TERM_MEMORY)).toBe(`/ja${DOCS_ROUTES.SHORT_TERM_MEMORY}`);
  });

  it("normalizes a route that omits its leading slash", () => {
    expect(buildLocalizedDocsPath("ja", "features/")).toBe("/ja/features/");
  });

  it("passes an absolute URL through untouched", () => {
    const absolute = "https://example.com/docs/";
    expect(buildLocalizedDocsPath("ja", absolute)).toBe(absolute);
    expect(buildDocsUrl("ja", absolute)).toBe(absolute);
  });

  it("builds absolute bot links with the locale prefix", () => {
    expect(buildDocsUrl("en-US", DOCS_ROUTES.FEATURES)).toBe(`${DOCS_BASE_URL}/en/features/`);
    expect(buildDocsUrl("ja", DOCS_ROUTES.FEATURES)).toBe(`${DOCS_BASE_URL}/ja/features/`);
    expect(buildDocsUrl("ko", DOCS_ROUTES.FEATURES)).toBe(`${DOCS_BASE_URL}/en/features/`);
  });

  it("keeps legal destinations on the same locale rules", () => {
    expect(buildLegalDocUrl("ja", "privacy-policy")).toBe(`${DOCS_BASE_URL}/ja/legal/privacy-policy/`);
    expect(buildLegalDocUrl("en-US", "terms-of-service")).toBe(`${DOCS_BASE_URL}/en/legal/terms-of-service/`);
    expect(buildLegalDocUrl("ru", "privacy-policy")).toBe(`${DOCS_BASE_URL}/en/legal/privacy-policy/`);
  });

  it("links the source page of a translated entry back to the default locale", () => {
    expect(buildDefaultLocaleDocsPageUrl("features/knowledge/memory")).toBe(
      `${DOCS_BASE_URL}/en/features/knowledge/memory/`,
    );
    expect(buildDefaultLocaleDocsPageUrl("features/index")).toBe(`${DOCS_BASE_URL}/en/features/`);
    expect(buildDefaultLocaleDocsPageUrl("index")).toBe(`${DOCS_BASE_URL}/en/`);
  });
});

describe("Accept-Language matching", () => {
  it("matches an exact published locale code", () => {
    expect(matchAcceptLanguage("ja")).toBe("ja");
    expect(matchAcceptLanguage("ja-JP,ja;q=0.9,en;q=0.8")).toBe("ja");
  });

  it("matches an exact region code without the base being published", () => {
    expect(matchAcceptLanguage("ja-JP")).toBe("ja");
  });

  it("prefers the highest quality value over header order", () => {
    expect(matchAcceptLanguage("en;q=0.4,ja;q=0.9")).toBe("ja");
  });

  it("treats a rejected language as unacceptable", () => {
    expect(matchAcceptLanguage("ja;q=0,en")).toBe("en");
  });

  it("falls back to English for an unsupported language", () => {
    expect(matchAcceptLanguage("de-DE,de;q=0.9")).toBe(DEFAULT_DOCS_LOCALE_ID);
    expect(matchAcceptLanguage("")).toBe(DEFAULT_DOCS_LOCALE_ID);
    expect(matchAcceptLanguage(null)).toBe(DEFAULT_DOCS_LOCALE_ID);
  });

  it("resolves a Chinese base language only while one Chinese tree is published", () => {
    const chineseTrees = PUBLISHED_DOCS_LOCALES.filter((id) => id.split("-")[0].toLowerCase() === "zh");
    const expected = chineseTrees.length === 1 ? chineseTrees[0] : DEFAULT_DOCS_LOCALE_ID;

    expect(matchAcceptLanguage("zh")).toBe(expected);
  });

  it("answers a wildcard with the default locale", () => {
    expect(matchAcceptLanguage("*")).toBe(DEFAULT_DOCS_LOCALE_ID);
  });
});
