import { describe, expect, it } from "bun:test";
import { DOCS_LOCALES, PUBLISHED_DOCS_LOCALES, matchAcceptLanguage } from "@/constants/docsLocales";
import { onRequest, resolveLocaleFromHeader } from "../../../apps/docs/functions/_middleware";

/**
 * The Pages Functions middleware cannot import the shared locale table: the deploy bundler does not
 * apply the repo's `@/*` tsconfig alias, which that module needs. It therefore keeps its own copy of
 * the routed locale list and the matching rules. These headers are the ones the two copies could
 * plausibly disagree on: quality ordering, rejection, wildcards, aliases, region tags, and casing. A
 * divergence means the site root sends a visitor somewhere the rest of the site would not.
 */
const HEADERS = [
  "ja",
  "ja-JP",
  "ja-JP,ja;q=0.9,en;q=0.8",
  "en-US,en;q=0.9",
  "en;q=0.4,ja;q=0.9",
  "ja;q=0,en",
  "ja;q=0",
  "*",
  "*;q=0.5,ja;q=0.9",
  "",
  "de-DE,de;q=0.9",
  "es-ES,es;q=0.9",
  "pt-BR,pt;q=0.9",
  "zh",
  "zh-TW",
  "ko-KR,ko;q=0.9",
  "fr-FR,fr;q=0.8,en;q=0.7",
  "ru,en;q=0.5",
  "vi-VN",
  "  JA  ",
];

/** The middleware's routed list, read from source because it is not exported. */
async function readRoutedLocales(): Promise<string[]> {
  const source = await Bun.file(new URL("../../../apps/docs/functions/_middleware.ts", import.meta.url)).text();
  const declaration = source.match(/const ROUTED_LOCALES[^=]*=\s*\[([^\]]*)\]/);

  expect(declaration).not.toBeNull();
  return [...(declaration?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("docs site root middleware", () => {
  it("routes every locale the shared table registers", async () => {
    // Pinned as an exact set in both directions. The middleware covers target locales whose trees
    // have not landed yet, so this list can be wider than the published set, but it must never be
    // missing one: a published locale that is absent here sends its readers to the wrong language.
    const routed = await readRoutedLocales();

    expect(routed).toEqual(DOCS_LOCALES.map((locale) => locale.id));
    for (const published of PUBLISHED_DOCS_LOCALES) {
      expect(routed).toContain(published);
    }
  });

  it("agrees with the shared locale matcher wherever the shared matcher picks a tree", () => {
    // Scoped two ways, both of them the staging state rather than a rule disagreement.
    //
    // First, the shared matcher returns the default locale for any header it cannot serve, so a
    // comparison is only meaningful where it picked a non-default locale. A header such as `es-ES`
    // resolves to English in the shared table while `es-419` is unpublished, and the middleware
    // routes the staged Spanish root; comparing those two would assert that staging does not exist.
    //
    // Second, a header the middleware answers with an unpublished locale is skipped, because the
    // shared matcher is allowed to disagree there by design. `only ever answers with a routed locale`
    // covers the value's validity.
    for (const header of HEADERS) {
      const shared = matchAcceptLanguage(header);
      if (shared === "en" || !PUBLISHED_DOCS_LOCALES.includes(shared)) continue;

      const middleware = resolveLocaleFromHeader(header);
      if (!PUBLISHED_DOCS_LOCALES.includes(middleware)) continue;

      expect(`${header} -> ${middleware}`).toBe(`${header} -> ${shared}`);
    }
  });

  it("only ever answers with a routed locale", async () => {
    const routed = await readRoutedLocales();

    for (const header of [...HEADERS, null, "pt-PT", "es-MX", "zh-HK"]) {
      expect(routed).toContain(resolveLocaleFromHeader(header));
    }
  });

  it("treats a missing header as no preference", () => {
    expect(resolveLocaleFromHeader(null)).toBe(matchAcceptLanguage(null));
    expect(resolveLocaleFromHeader(null)).toBe("en");
  });

  it("resolves this copy's alias key in the casing a lookup produces", async () => {
    // The middleware's alias table is a separate literal from the shared map, so it can drift on its
    // own. Key casing is the failure that hides: the lookup lowercases the tag, and a camel-cased
    // key is then unreachable, exactly as it was before this was caught in the shared map.
    const source = await Bun.file(new URL("../../../apps/docs/functions/_middleware.ts", import.meta.url)).text();
    const declaration = source.match(/const LOCALE_ALIASES[^=]*=\s*\{([^}]*)\}/);

    expect(declaration).not.toBeNull();
    const aliasKeys = [...(declaration?.[1] ?? "").matchAll(/"([^"]+)":/g)].map((match) => match[1]);
    expect(aliasKeys.length).toBeGreaterThan(0);
    for (const key of aliasKeys) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it("redirects the site root to the matched locale's introduction page", async () => {
    const response = await onRequest({
      request: new Request("https://docs.example.test/", {
        headers: { "accept-language": "ja-JP,ja;q=0.9" },
      }),
      next: () => Promise.resolve(new Response("next")),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://docs.example.test/ja/introduction/");
  });

  it("falls through for a route that is not the site root", async () => {
    const response = await onRequest({
      request: new Request("https://docs.example.test/ja/features/"),
      next: () => Promise.resolve(new Response("next")),
    });

    expect(await response.text()).toBe("next");
  });
});
