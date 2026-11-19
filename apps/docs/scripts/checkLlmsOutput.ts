import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DOCS_LOCALE_ID, PUBLISHED_DOCS_LOCALES } from "../../../src/constants/docsLocales";

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

// Order must follow `PUBLISHED_DOCS_LOCALES` rather than filesystem or alphabetical order because `localesWithEntry`
// emits hreflang alternates in that sequence.
function publishedLocaleIds(): string[] {
  const present = new Set(
    readdirSync(contentRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  const ids = PUBLISHED_DOCS_LOCALES.filter((locale) => present.has(locale)).map(String);
  for (const name of [...present].sort()) {
    if (!ids.includes(name)) ids.push(name);
  }

  const index = ids.indexOf(DEFAULT_DOCS_LOCALE_ID);
  if (index > 0) ids.unshift(...ids.splice(index, 1));
  return ids;
}

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

// Union across all locale trees is required because fallback routes only exist in build output and never appear in
// the target locale's own source directory.
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
if (!emphasized.includes("# What is TomoriBot?") || !emphasized.includes("# Built-in tools")) {
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

// Match the full site URL instead of a bare `/${locale}/` so documented repo paths like `src/locales/ja/` do not trip
// this English-only check.
for (const file of collectTextFiles(distRoot)) {
  const content = readFileSync(file, "utf8");
  const leakedLocale = translatedLocales.find((locale) =>
    new RegExp(`https://docs\\.tomoribot\\.app/${locale}/`).test(content),
  );
  if (leakedLocale) {
    throw new Error(`${relative(distRoot, file)} links the non-default locale "${leakedLocale}"`);
  }
}

function localeHasPage(locale: string, pageId: string): boolean {
  return entryFileCandidates(pageId).some((candidate) => existsSync(join(contentRoot, locale, candidate)));
}

function entryFileCandidates(pageId: string): string[] {
  if (pageId === "index") return ["README.md", "README.mdx", "index.md", "index.mdx"];
  if (pageId.endsWith("/index")) {
    const directory = pageId.slice(0, -"/index".length);
    return ["README.md", "README.mdx", "index.md", "index.mdx"].map((name) => `${directory}/${name}`);
  }
  return [`${pageId}.md`, `${pageId}.mdx`];
}

function isInternalPage(pageId: string): boolean {
  return pageId === "wiki" || pageId.startsWith("wiki/");
}

// Built HTML is checked directly instead of route middleware because Starlight emits hreflang alternates for every
// configured locale even when no page exists.
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
    // Computed dynamically from published locales rather than hardcoded pairs so adding a third locale tree works.
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

// Check both `_redirects` (Cloudflare) and `index.html` (other static hosts) because the product site owns discovery.
const rootHtml = readRequired("index.html");
if (!/<meta[^>]+http-equiv="refresh"[^>]+url=\/en\/introduction\//i.test(rootHtml)) {
  throw new Error("The documentation root must redirect to the default-locale introduction");
}
const redirectRules = readRequired("_redirects");
if (!/^\/ \/en\/introduction\/ 301$/m.test(redirectRules)) {
  throw new Error("The Cloudflare redirect file must permanently redirect the docs root to English");
}

// Verify sitemap files exist because @astrojs/sitemap only warns on a rejected option and exits 0 without generating
// them, leaving robots.txt broken.
readRequired("sitemap-index.xml");
const sitemapUrlset = readRequired("sitemap-0.xml");
const annotatedLocales = new Set(Array.from(sitemapUrlset.matchAll(/hreflang="([^"]+)"/g), (match) => match[1]));
if (annotatedLocales.size === 0) {
  throw new Error("The sitemap carries no hreflang annotations, so its i18n map was dropped");
}
for (const locale of PUBLISHED_DOCS_LOCALES) {
  // The sitemap's own tag may be less specific than the page's, because the integration rejects a
  // numeric region subtag (see `sitemapLanguageTag` in astro.config.mts).
  const expectedTag = locale.replace(/-\d+$/, "");
  if (!annotatedLocales.has(expectedTag)) {
    throw new Error(
      `The sitemap has no hreflang annotation for ${locale} (expected ${expectedTag}); ` +
        "a locale tag the sitemap integration rejects disables generation for every locale",
    );
  }
}

console.log(
  `Generated LLM documentation indexes are curated and wiki-safe; ` +
    `hreflang verified on ${checkedPairs} translated pairs and ${checkedFallbacks} fallback routes`,
);
