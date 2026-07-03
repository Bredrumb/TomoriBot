import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

/**
 * Maximum length for auto-derived meta descriptions. Google truncates snippets
 * around 155-160 characters, so anything longer is wasted (and can look sloppy
 * when cut mid-sentence in search results).
 */
const MAX_DESCRIPTION_LENGTH = 160;

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
function deriveDescription(body: string): string | undefined {
  // Strip HTML comments up front — they can span multiple lines, so the
  // line-based filtering below cannot reliably skip their continuations.
  const lines = body.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const paragraph: string[] = [];
  let insideFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // 1. Track fenced code blocks so their contents are never sampled.
    if (line.startsWith("```") || line.startsWith("~~~")) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;

    // 2. A blank line ends the paragraph — stop once we have collected prose.
    if (line === "") {
      if (paragraph.length > 0) break;
      continue;
    }

    // 3. Skip structural / non-prose lines. If we were mid-paragraph and hit
    //    one of these, the paragraph is done.
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

  // 4. Strip inline Markdown so the meta tag contains plain text only.
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
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text;

  // 5. Truncate at the last word boundary that fits, then add an ellipsis.
  const clipped = text.slice(0, MAX_DESCRIPTION_LENGTH);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : MAX_DESCRIPTION_LENGTH)}…`;
}

/**
 * Starlight route middleware for SEO head tags.
 *
 * 1. Auto-derives a per-page meta description from the page's first prose
 *    paragraph whenever the frontmatter has no explicit `description`. A
 *    hand-written `description:` in frontmatter always wins (Starlight emits
 *    it before this middleware runs, so we simply do nothing in that case).
 * 2. Marks internal `wiki/` pages as `noindex` — they are hidden from the
 *    sidebar and are maintainer-facing, so they should not appear in search
 *    results or compete with the user-facing pages.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const { starlightRoute } = context.locals;
  const { entry, head } = starlightRoute;

  // Keep internal wiki pages out of search indexes.
  if (entry.id === "wiki" || entry.id.startsWith("wiki/")) {
    head.push({ tag: "meta", attrs: { name: "robots", content: "noindex" } });
  }

  // Frontmatter description present → Starlight already emitted the tags.
  if (entry.data.description) return;

  const description = deriveDescription(entry.body ?? "");
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
