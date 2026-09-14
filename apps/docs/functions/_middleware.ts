/**
 * Cloudflare Pages Functions middleware for the docs site.
 *
 * Only the site root needs a decision. Static assets serve every other route, so branching there
 * would add a worker invocation without changing the response.
 *
 * This file is deliberately self-contained. It is bundled on its own during a Pages deploy, so it
 * cannot import the shared locale table from `src/constants/docsLocales.ts`: that path sits outside
 * the published directory and the bundler resolves nothing above it. The locale list and matching
 * rules below are the middleware's own copy, and `tests/unit/docs/docsSiteMiddleware.test.ts` holds
 * them identical to `matchAcceptLanguage` in the shared table for every header it can distinguish.
 */

/**
 * Locales whose page tree exists, which are the roots the site actually serves. A locale from the
 * shared table appears here only once its `docsTree` flag is true.
 */
const PUBLISHED_LOCALES = ["en", "ja"] as const;

/** Locale used when the header asks for nothing this site serves. */
const DEFAULT_LOCALE = "en";

/**
 * Discord keys that reuse another published locale's tree. Mirrors the bot's alias registry, so an
 * `es-ES` browser reaches the same Spanish pages its interface strings come from.
 */
const LOCALE_ALIASES: Record<string, string> = { "es-ES": "es-419" };

/**
 * Picks the published locale a browser's `Accept-Language` header asks for.
 *
 * Quality values are honored and `q=0` rejects a language outright, because a plain prefix test
 * treats `ja;q=0, en` as a Japanese request. Ranges match by exact code, alias, or base language;
 * the first acceptable match wins, and anything unmatched falls back to the default locale.
 */
export function resolveLocaleFromHeader(header: string | null | undefined): string {
  const candidates = (header ?? "")
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim().match(/^q=([\d.]+)$/)?.[1])
        .find((value) => value !== undefined);
      return { tag: tag.trim().toLowerCase(), index, quality: quality ? Number(quality) : 1 };
    })
    .filter((candidate) => candidate.tag.length > 0 && !Number.isNaN(candidate.quality))
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const candidate of candidates) {
    if (candidate.quality <= 0) continue;

    // A wildcard states no preference beyond "something I can read", so the default answers it.
    if (candidate.tag === "*") return DEFAULT_LOCALE;

    const exact = PUBLISHED_LOCALES.find((locale) => locale.toLowerCase() === candidate.tag);
    if (exact) return exact;

    const alias = LOCALE_ALIASES[candidate.tag] ?? LOCALE_ALIASES[candidate.tag.split("-")[0]];
    if (alias && (PUBLISHED_LOCALES as readonly string[]).includes(alias)) return alias;

    const base = candidate.tag.split("-")[0];
    const baseMatches = PUBLISHED_LOCALES.filter((locale) => locale.split("-")[0] === base);
    if (baseMatches.length === 1) return baseMatches[0];
  }

  return DEFAULT_LOCALE;
}

export const onRequest = async (context) => {
  const url = new URL(context.request.url);

  if (url.pathname === "/") {
    const locale = resolveLocaleFromHeader(context.request.headers.get("accept-language"));
    // The locale root is itself a rewrite target, so redirecting to it would cost a second hop.
    return Response.redirect(`${url.origin}/${locale}/introduction/`, 302);
  }

  return context.next();
};
