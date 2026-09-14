/**
 * Cloudflare Pages Functions middleware for the docs site.
 *
 * Only the site root needs a decision. Static assets serve every other route, so branching there
 * would add a worker invocation without changing the response.
 *
 * The locale list and matching rules are this file's own copy rather than an import of
 * `src/constants/docsLocales.ts`. That import resolves at runtime but not at deploy time: the Pages
 * Functions bundler follows relative paths outside the published directory, yet it does not apply
 * the repo's `@/*` tsconfig alias, which the shared table needs for `@/constants/locales`.
 * `tests/unit/docs/docsSiteMiddleware.test.ts` holds the two copies identical for every header they
 * can disagree on, so edit both together.
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
 *
 * Keys are lowercased because the lookup normalizes the caller's tag first, and a lowercased tag
 * would otherwise miss a camel-cased key.
 */
const LOCALE_ALIASES: Record<string, string> = { "es-es": "es-419" };

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
    const baseMatches = PUBLISHED_LOCALES.filter((locale) => locale.split("-")[0].toLowerCase() === base);
    if (baseMatches.length === 1) return baseMatches[0];
  }

  return DEFAULT_LOCALE;
}

/**
 * The subset of Cloudflare's `EventContext` this middleware uses. Declared locally because the
 * published directory has no dependency on `@cloudflare/workers-types`, and an untyped parameter
 * would leave the file out of every typecheck the repo runs.
 */
interface PagesEventContext {
  request: Request;
  next: () => Promise<Response>;
}

export const onRequest = async (context: PagesEventContext): Promise<Response> => {
  const url = new URL(context.request.url);

  if (url.pathname === "/") {
    const locale = resolveLocaleFromHeader(context.request.headers.get("accept-language"));
    // The locale root is itself a rewrite target, so redirecting to it would cost a second hop.
    return Response.redirect(`${url.origin}/${locale}/introduction/`, 302);
  }

  return context.next();
};
