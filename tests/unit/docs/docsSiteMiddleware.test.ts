import { describe, expect, it } from "bun:test";
import { matchAcceptLanguage } from "@/constants/docsLocales";
import { onRequest, resolveLocaleFromHeader } from "../../../apps/docs/functions/_middleware";

/**
 * The Pages Functions middleware cannot import the shared locale table: the deploy bundler does not
 * apply the repo's `@/*` tsconfig alias, which that module needs. It therefore keeps its own copy of
 * the matching rules. These headers are the ones the two copies could plausibly disagree on: quality
 * ordering, rejection, wildcards, aliases, region tags, and casing. A divergence means the site root
 * sends a visitor somewhere the rest of the site would not.
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

describe("docs site root middleware", () => {
  it("agrees with the shared locale matcher on every header", () => {
    for (const header of HEADERS) {
      expect(`${header} -> ${resolveLocaleFromHeader(header)}`).toBe(`${header} -> ${matchAcceptLanguage(header)}`);
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
