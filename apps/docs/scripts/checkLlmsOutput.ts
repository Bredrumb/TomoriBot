import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DOCS_LOCALE_ID } from "../../../src/constants/docsLocales";

const distRoot = fileURLToPath(new URL("../dist/", import.meta.url));
const contentRoot = fileURLToPath(new URL("../src/content/docs/", import.meta.url));
const forbiddenWikiTitles = [
  "# Azure Production Data Inspection",
  "# Azure Terraform State Recovery",
  "# Refactor Record",
  "# Threat Models",
  "# Wiki",
];

function readRequired(relativePath: string): string {
  const absolutePath = join(distRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing generated documentation file: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function collectTextFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTextFiles(absolutePath));
    } else if (entry.name.endsWith(".txt")) {
      files.push(absolutePath);
    }
  }
  return files;
}

/**
 * Locale roots whose page tree exists, which is the set of routes the build emits.
 *
 * The directory listing is sorted and the default locale is resolved by name rather than by taking
 * the first entry, because `readdirSync` order is filesystem-dependent: an indexed ext4 directory
 * returns hash order, so a translated locale could otherwise be mistaken for the default one.
 */
function publishedLocaleIds(): string[] {
  const ids = readdirSync(contentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const index = ids.indexOf(DEFAULT_DOCS_LOCALE_ID);
  if (index > 0) ids.unshift(...ids.splice(index, 1));
  return ids;
}

/**
 * Page ids present in one locale's source tree, relative to that locale. A page is one `<id>` entry
 * where a directory index collapses to `<dir>/index`.
 */
function localeRouteIds(locale: string): string[] {
  const localeRoot = join(contentRoot, locale);
  const ids: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(directory, entry.name));
        continue;
      }
      if (!/\.mdx?$/i.test(entry.name)) continue;
      const relativePath = relative(localeRoot, join(directory, entry.name)).replace(/\\/g, "/");
      ids.push(relativePath.replace(/README\.mdx?$/i, "index").replace(/\.mdx?$/i, ""));
    }
  };

  walk(localeRoot);
  return ids;
}

/**
 * Every page id the site builds at all, which is the union of the locale trees.
 *
 * A fallback route exists only in the build output, never in its own locale's tree, so a per-locale
 * listing cannot find it. Walking the union is what makes the fallback assertion meaningful.
 */
function allRouteIds(): string[] {
  const ids = new Set<string>();
  for (const locale of [defaultLocale, ...translatedLocales]) {
    for (const id of localeRouteIds(locale)) ids.add(id);
  }
  return [...ids].sort();
}

const [defaultLocale, ...translatedLocales] = publishedLocaleIds();
if (!defaultLocale) {
  throw new Error("No locale directories found under apps/docs/src/content/docs");
}

const entrypoint = readRequired("llms.txt");
const emphasized = readRequired(join("_llms-txt", "tomoribot-introduction-and-features.txt"));
const contributor = readRequired(join("_llms-txt", "contributor-and-architecture-documentation.txt"));

if (!entrypoint.includes(`/${defaultLocale}/introduction/`) || !entrypoint.includes(`/${defaultLocale}/features/`)) {
  throw new Error("llms.txt must emphasize the English introduction and feature indexes");
}
if (!emphasized.includes("# What is TomoriBot?") || !emphasized.includes("# Tools & Extensions")) {
  throw new Error("The emphasized documentation set is empty or missing its expected sections");
}
if (!contributor.includes("# Architecture")) {
  throw new Error("The contributor documentation set is empty or missing architecture content");
}

for (const file of collectTextFiles(distRoot)) {
  const content = readFileSync(file, "utf8");
  const lines = new Set(content.split(/\r?\n/).map((line) => line.trim()));
  const leakedTitle = forbiddenWikiTitles.find((title) => lines.has(title));
  if (leakedTitle) {
    throw new Error(`Internal wiki content leaked into ${file}: ${leakedTitle}`);
  }
}

// Agent-facing text sets stay English-only. `starlight-llms-txt` selects the default locale's
// entries, so a translated page appearing here means that assumption broke and every locale would
// now be duplicated into the files an agent reads. Matching the site URL rather than a bare `/ja/`
// keeps a documented repository path such as `src/locales/ja/` from tripping the check.
for (const file of collectTextFiles(distRoot)) {
  const content = readFileSync(file, "utf8");
  const leakedLocale = translatedLocales.find((locale) =>
    new RegExp(`https://docs\\.tomoribot\\.app/${locale}/`).test(content),
  );
  if (leakedLocale) {
    throw new Error(`${relative(distRoot, file)} links the non-default locale "${leakedLocale}"`);
  }
}

/** Whether a locale has a real source file for a page id, mirroring the docs routing rule. */
function localeHasPage(locale: string, pageId: string): boolean {
  return entryFileCandidates(pageId).some((candidate) => existsSync(join(contentRoot, locale, candidate)));
}

/**
 * Source filenames that produce a page id, matching the docs routing rule: a directory index has
 * four possible sources, and `.md` and `.mdx` are interchangeable for any page.
 */
function entryFileCandidates(pageId: string): string[] {
  if (pageId === "index") return ["README.md", "README.mdx", "index.md", "index.mdx"];
  if (pageId.endsWith("/index")) {
    const directory = pageId.slice(0, -"/index".length);
    return ["README.md", "README.mdx", "index.md", "index.mdx"].map((name) => `${directory}/${name}`);
  }
  return [`${pageId}.md`, `${pageId}.mdx`];
}

/** Whether a page id falls under an internal-only section, which is never advertised. */
function isInternalPage(pageId: string): boolean {
  return pageId === "wiki" || pageId.startsWith("wiki/");
}

/**
 * hreflang must describe real translations. Starlight emits an alternate for every configured
 * locale regardless of whether a page exists, so this checks the built HTML rather than trusting
 * the route middleware: a fallback route serving another locale's content must carry none, and a
 * page present in every locale must carry the full set.
 */
const alternatePattern = /<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g;
let checkedPairs = 0;
let checkedFallbacks = 0;

for (const locale of translatedLocales) {
  for (const pageId of allRouteIds()) {
    const htmlPath = join(distRoot, locale, pageId.replace(/(^|\/)index$/, ""), "index.html");
    if (!existsSync(htmlPath)) continue;

    const html = readFileSync(htmlPath, "utf8");
    const hreflangs = [...html.matchAll(alternatePattern)].map((match) => match[1]);
    // A page under an internal-only section is noindex on purpose and is never advertised.
    if (isInternalPage(pageId)) continue;

    const isFallback = !localeHasPage(locale, pageId);
    const isTranslation = localeHasPage(defaultLocale, pageId);
    const publishedLocales = [defaultLocale, ...translatedLocales];

    if (isFallback) {
      checkedFallbacks += 1;
      if (hreflangs.length > 0) {
        throw new Error(
          `${locale}/${pageId}/ is a locale-fallback route but advertises hreflang [${hreflangs.join(", ")}]`,
        );
      }
      continue;
    }

    if (!isTranslation) continue;

    checkedPairs += 1;
    // One alternate per locale that really has the page, in the published locale order, plus
    // x-default. A third tree changes both lists, so neither can be hardcoded to the current pair.
    const expected = [
      ...publishedLocales.filter((candidate) => localeHasPage(candidate, pageId)),
      "x-default",
    ];
    if (hreflangs.join(",") !== expected.join(",")) {
      throw new Error(
        `${locale}/${pageId}/ emitted hreflang [${hreflangs.join(", ")}] but expected [${expected.join(", ")}]`,
      );
    }
  }
}

if (checkedFallbacks === 0) {
  throw new Error("No locale-fallback routes were found; the hreflang suppression check proved nothing");
}
if (checkedPairs === 0) {
  throw new Error("No translated page pairs were found; the hreflang pair check proved nothing");
}

const wikiHtml = readRequired(join(defaultLocale, "wiki", "threat-models", "index.html"));
if (!/<meta[^>]+name="robots"[^>]+content="noindex"/i.test(wikiHtml)) {
  throw new Error("English wiki pages must include a noindex robots directive");
}

console.log(
  `Generated LLM documentation indexes are curated and wiki-safe; ` +
    `hreflang verified on ${checkedPairs} translated pairs and ${checkedFallbacks} fallback routes`,
);
