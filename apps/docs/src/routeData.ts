import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Maximum length for auto-derived meta descriptions. Google truncates snippets
 * around 155-160 characters for Latin-script text, but only around 80
 * full-width characters for Japanese, so the limit is locale-dependent.
 */
const MAX_DESCRIPTION_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH_JA = 80;

/**
 * Absolute path to the content root (the src/content/docs junction pointing at
 * repo-root docs/). Used to check whether a page has a counterpart in the
 * other locale so hreflang alternates are only emitted for real pairs.
 */
const docsRoot = join(dirname(fileURLToPath(import.meta.url)), "content/docs");

/**
 * Checks whether a docs entry exists on disk for the given locale-less entry
 * id (e.g. "introduction/index" or "features/knowledge/memory").
 *
 * Mirrors the id scheme from content.config.ts: `index` ids come from README
 * files (or literal index files), other ids map to `<id>.md`/`<id>.mdx`.
 *
 * @param baseId - Entry id without the "ja/" locale prefix.
 * @param locale - "" for the root (English) locale, or "ja".
 * @returns True when a source file exists for that id in that locale.
 */
function entryExists(baseId: string, locale: "" | "ja"): boolean {
  const base = join(docsRoot, locale, baseId);
  const candidates =
    baseId === "index" || baseId.endsWith("/index")
      ? ["README.md", "README.mdx", "index.md", "index.mdx"].map((name) => join(base, "..", name))
      : [`${base}.md`, `${base}.mdx`];
  return candidates.some((candidate) => existsSync(candidate));
}

/**
 * Derives a plain-text meta description from the first prose paragraph of a
 * Markdown/MDX body.
 *
 * Skips frontmatter-adjacent noise (imports, headings, code fences, asides,
 * images, tables, lists, JSX/HTML blocks) until it finds real prose, then
 * strips inline Markdown syntax and truncates at a word boundary.
 *
 * @param body - Raw Markdown source of the page (frontmatter already removed).
 * @returns A cleaned description string, or `undefined` when no prose exists.
 */
function deriveDescription(body: string, maxLength: number): string | undefined {
  // Strip HTML comments up front — they can span multiple lines, so the
  // line-based filtering below cannot reliably skip their continuations.
  const lines = body.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const paragraph: string[] = [];
  let insideFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```") || line.startsWith("~~~")) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;

    if (line === "") {
      if (paragraph.length > 0) break;
      continue;
    }

    const isNonProse =
      line.startsWith("#") || // headings
      line.startsWith("import ") || // MDX imports
      line.startsWith("export ") || // MDX exports
      line.startsWith(":::") || // asides/admonitions
      line.startsWith("!") || // standalone images
      line.startsWith("|") || // tables
      line.startsWith(">") || // blockquotes
      line.startsWith("<") || // JSX/HTML blocks
      /^[-*+]\s/.test(line) || // unordered lists
      /^\d+\.\s/.test(line); // ordered lists
    if (isNonProse) {
      if (paragraph.length > 0) break;
      continue;
    }

    paragraph.push(line);
  }

  if (paragraph.length === 0) return undefined;

  const text = paragraph
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → link text
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/<[^>]+>/g, "") // stray inline HTML/JSX
    .replace(/\s+/g, " ")
    .trim();

  if (text.length === 0) return undefined;
  if (text.length <= maxLength) return text;

  // Truncate at the last word boundary that fits, then add an ellipsis.
  //    (Japanese prose has no spaces, so the hard cut is the boundary there.)
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}

/**
 * Starlight route middleware for SEO head tags.
 *
 * - Auto-derives a per-page meta description from the page's first prose
 *    paragraph whenever the frontmatter has no explicit `description`. A
 *    hand-written `description:` in frontmatter always wins (Starlight emits
 *    it before this middleware runs, so we simply do nothing in that case).
 * - Marks internal `wiki/` pages as `noindex` — they are hidden from the
 *    sidebar and are maintainer-facing, so they should not appear in search
 *    results or compete with the user-facing pages.
 * - Emits hreflang alternate links for pages that exist in both English and
 *    Japanese, so Google serves each locale's page to the right audience
 *    instead of treating the pair as competing (or duplicate) content.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const { starlightRoute } = context.locals;
  const { entry, head } = starlightRoute;

  // Keep internal wiki pages out of search indexes. Same for untranslated
  // /ja/ fallback pages: they serve the English content verbatim, so indexing
  // them would create duplicate-content competition with the English pages.
  // A fallback page becomes indexable automatically once its translation
  // lands (the route stops being a fallback).
  const isWiki = entry.id === "wiki" || entry.id.startsWith("wiki/");
  if (isWiki || starlightRoute.isFallback) {
    head.push({ tag: "meta", attrs: { name: "robots", content: "noindex" } });
  }

  // hreflang pairs. Fallback pages (ja URL serving English content) are NOT
  // pairs — only emit when a real translated source file exists, otherwise
  // Google would be told duplicate English content is "the Japanese version".
  const isJa = entry.id === "ja" || entry.id.startsWith("ja/");
  const baseId = isJa ? entry.id.replace(/^ja\/?/, "") : entry.id;
  if (baseId && entryExists(baseId, "ja") && entryExists(baseId, "")) {
    const site = context.site ?? new URL("https://docs.tomoribot.app");
    const slug = baseId.replace(/(^|\/)index$/, "").replace(/\/$/, "");
    const enUrl = new URL(slug ? `/${slug}/` : "/", site).href;
    const jaUrl = new URL(slug ? `/ja/${slug}/` : "/ja/", site).href;
    head.push({ tag: "link", attrs: { rel: "alternate", hreflang: "en", href: enUrl } });
    head.push({ tag: "link", attrs: { rel: "alternate", hreflang: "ja", href: jaUrl } });
    head.push({ tag: "link", attrs: { rel: "alternate", hreflang: "x-default", href: enUrl } });
  }

  // Frontmatter description present → Starlight already emitted the tags.
  if (entry.data.description) return;

  const description = deriveDescription(
    entry.body ?? "",
    isJa ? MAX_DESCRIPTION_LENGTH_JA : MAX_DESCRIPTION_LENGTH,
  );
  if (!description) return;

  // Starlight falls back to the site-wide `description` config for pages
  // without one, so the head already contains generic description tags.
  // Overwrite those in place (pushing would emit duplicate meta tags).
  for (const tag of head) {
    if (tag.tag !== "meta") continue;
    if (tag.attrs?.name === "description" || tag.attrs?.property === "og:description") {
      tag.attrs.content = description;
    }
  }
});
