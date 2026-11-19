import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DOCS_LOCALE_ID,
  DOCS_BASE_URL,
  DOCS_LOCALES,
  PUBLISHED_DOCS_LOCALES,
  getDocsLocaleConfig,
  type DocsLocaleId,
} from "../../../src/constants/docsLocales";

// Pure routing logic is isolated from Astro imports so unit tests can exercise fallback and head rules without
// booting Astro or Starlight.

interface DocsLinkTag {
  tag: "link";
  attrs: Record<string, string>;
}

interface DocsMetaTag {
  tag: "meta";
  attrs: Record<string, string>;
}

export type DocsHeadTag = DocsLinkTag | DocsMetaTag;

const LOCALE_IDS: readonly string[] = DOCS_LOCALES.map((locale) => locale.id);

export function localeFromEntryId(entryId: string): string | undefined {
  const [segment] = entryId.split("/");
  return LOCALE_IDS.includes(segment) ? segment : undefined;
}

export function stripLocaleFromEntryId(entryId: string): string {
  const locale = localeFromEntryId(entryId);
  return locale ? entryId.slice(locale.length).replace(/^\//, "") : entryId;
}

export function entryFileCandidates(baseId: string): string[] {
  if (baseId === "index") return ["README.md", "README.mdx", "index.md", "index.mdx"];
  if (baseId.endsWith("/index")) {
    const directory = baseId.slice(0, -"/index".length);
    return ["README.md", "README.mdx", "index.md", "index.mdx"].map((name) => `${directory}/${name}`);
  }
  return [`${baseId}.md`, `${baseId}.mdx`];
}

export function findEntryFile(docsRoot: string, locale: string, baseId: string): string | undefined {
  for (const candidate of entryFileCandidates(baseId)) {
    const filePath = join(docsRoot, locale, candidate);
    if (existsSync(filePath)) return filePath;
  }
  return undefined;
}

function entryExists(docsRoot: string, locale: string, baseId: string): boolean {
  return findEntryFile(docsRoot, locale, baseId) !== undefined;
}

export function localesWithEntry(docsRoot: string, baseId: string): DocsLocaleId[] {
  return PUBLISHED_DOCS_LOCALES.filter((locale) => entryExists(docsRoot, locale, baseId));
}

export function entryRoute(locale: string, baseId: string): string {
  const slug = baseId.replace(/(^|\/)index$/, "").replace(/\/+$/, "");
  return `/${locale}/${slug ? `${slug}/` : ""}`;
}

// Fallback routes return no hreflang alternates because they duplicate default locale content rather than serving
// distinct translations.
export function buildHreflangAlternates(
  docsRoot: string,
  baseId: string,
  options: { isFallback: boolean; site?: URL | string },
): DocsHeadTag[] {
  if (options.isFallback) return [];

  const available = localesWithEntry(docsRoot, baseId);
  if (available.length < 2) return [];

  const site = options.site ?? DOCS_BASE_URL;
  return [
    ...available.map((locale) => ({
      tag: "link" as const,
      attrs: {
        rel: "alternate",
        hreflang: getDocsLocaleConfig(locale)?.lang ?? locale,
        href: new URL(entryRoute(locale, baseId), site).href,
      },
    })),
    {
      tag: "link" as const,
      attrs: {
        rel: "alternate",
        hreflang: "x-default",
        href: new URL(entryRoute(DEFAULT_DOCS_LOCALE_ID, baseId), site).href,
      },
    },
  ];
}

export function withoutHreflangAlternates<T extends { tag: string; attrs?: Record<string, unknown> }>(
  head: T[],
): T[] {
  return head.filter((tag) => !(tag.tag === "link" && tag.attrs?.rel === "alternate"));
}

export type TranslationNoticeMode = "none" | "translated" | "drafts";

// Raw frontmatter is parsed directly because querying the source locale via Astro's content layer would add a second
// lookup to every translated page.
export function sourceIsAiGenerated(source: string): boolean {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  return /^aiGenerated:\s*true\s*$/m.test(frontmatter);
}

export function resolveTranslationNoticeMode(options: {
  docsRoot: string;
  entryId: string;
  locale: string;
  aiGenerated: boolean;
  isFallback?: boolean;
}): TranslationNoticeMode {
  if (!options.aiGenerated) return "none";

  const baseId = stripLocaleFromEntryId(options.entryId);
  if (options.locale === DEFAULT_DOCS_LOCALE_ID || options.isFallback) return "drafts";

  const sourceFile = findEntryFile(options.docsRoot, DEFAULT_DOCS_LOCALE_ID, baseId);
  if (!sourceFile) return "drafts";

  return sourceIsAiGenerated(readFileSync(sourceFile, "utf8")) ? "drafts" : "translated";
}

export function deriveDescription(body: string, maxLength: number): string | undefined {
  // Strip HTML comments up front because they can span multiple lines, so the
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

  // Truncate at the last word boundary that fits, then add an ellipsis. Scripts
  // written without spaces have no boundary to find, so the hard cut is theirs.
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}
