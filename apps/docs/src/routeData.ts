import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHreflangAlternates,
  deriveDescription,
  localeFromEntryId,
  stripLocaleFromEntryId,
  withoutHreflangAlternates,
} from "./docsRouting";
import { DEFAULT_DOCS_LOCALE_ID, DOCS_BASE_URL, getDocsLocaleConfig } from "../../../src/constants/docsLocales";

/**
 * Content root, which is the src/content/docs junction pointing at repo-root docs/.
 *
 * Two anchors because a module URL is rewritten by the bundler: route middleware runs from
 * `dist/.prerender/chunks/`, where an `import.meta.url`-relative path lands inside the build output.
 * The working directory is the Astro project root for `astro dev` and `astro build` alike, and the
 * candidates stay separate strings rather than one resolved `..` chain so the dev path is exact.
 */
const docsRoot = resolveDocsRoot(
  dirname(fileURLToPath(import.meta.url)),
  process.cwd(),
);

function resolveDocsRoot(moduleDir: string, workingDir: string): string {
  const candidates = [
    join(workingDir, "src", "content", "docs"),
    join(moduleDir, "content", "docs"),
    join(moduleDir, "..", "content", "docs"),
    join(moduleDir, "..", "..", "..", "content", "docs"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/**
 * Starlight route middleware for SEO head tags.
 *
 * - Auto-derives a per-page meta description from the page's first prose paragraph whenever the
 *   frontmatter has no explicit `description`. A hand-written `description:` always wins, because
 *   Starlight emits it before this middleware runs.
 * - Marks internal `wiki/` pages as `noindex`, along with every locale-fallback route.
 * - Replaces Starlight's hreflang alternates with ones derived from the pages that really exist.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const { starlightRoute } = context.locals;
  const { entry, head } = starlightRoute;

  const baseId = stripLocaleFromEntryId(entry.id);
  // The route's own locale decides the budget, except on a fallback route, which serves the default
  // locale's English body: an 80-character budget there would clip English mid-sentence.
  const locale = starlightRoute.locale ?? localeFromEntryId(entry.id) ?? DEFAULT_DOCS_LOCALE_ID;
  const budgetLocale = starlightRoute.isFallback ? DEFAULT_DOCS_LOCALE_ID : locale;

  // Keep internal wiki pages out of search indexes. Same for untranslated fallback pages: they
  // serve the default locale's content verbatim, so indexing one creates duplicate-content
  // competition with the page it copies. A fallback becomes indexable automatically once its
  // translation lands, because the route stops being a fallback.
  const isWiki = baseId === "wiki" || baseId.startsWith("wiki/");
  if (isWiki || starlightRoute.isFallback) {
    head.push({ tag: "meta", attrs: { name: "robots", content: "noindex" } });
  }

  // Starlight emits an alternate for every configured locale regardless of whether that locale has
  // a source file, which would advertise a fallback route as a translation. Rebuild the set from
  // the files on disk instead of trying to suppress individual tags.
  const alternates = buildHreflangAlternates(docsRoot, baseId, {
    isFallback: starlightRoute.isFallback,
    site: context.site ?? DOCS_BASE_URL,
  });
  const headWithoutAlternates = withoutHreflangAlternates(head);
  head.length = 0;
  head.push(...headWithoutAlternates, ...alternates);

  // Frontmatter description present → Starlight already emitted the tags.
  if (entry.data.description) return;

  const maxLength = getDocsLocaleConfig(budgetLocale)?.descriptionMaxLength ?? 160;
  const description = deriveDescription(entry.body ?? "", maxLength);
  if (!description) return;

  // Starlight falls back to the site-wide `description` config for pages without one, so the head
  // already contains generic description tags. Overwrite those in place, since pushing would emit
  // duplicate meta tags.
  for (const tag of head) {
    if (tag.tag !== "meta") continue;
    if (tag.attrs?.name === "description" || tag.attrs?.property === "og:description") {
      tag.attrs.content = description;
    }
  }
});
