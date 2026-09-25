import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DOCS_BASE_URL,
  DOCS_LOCALES,
  DOCS_ROUTES,
  LEGAL_DOC_ROUTES,
  PUBLISHED_DOCS_LOCALES,
  buildLocalizedDocsPath,
} from "@/constants/docsLocales";
import { ANCHOR_COMMENT } from "../../../scripts/checks/checkLocaleLinks";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const docsRoot = join(repoRoot, "docs");
const defaultLocale = "en";

const PAGE_EXTENSIONS = [".md", ".mdx"];

/**
 * Resolves a docs route to its source file. A route that ends at a directory index has four
 * possible sources; anything else is a page file.
 */
function resolveRoute(route: string): string | undefined {
  const withoutFragment = route.split("#")[0];
  const relativePath = withoutFragment.replace(/^\//, "").replace(/\/$/, "");
  const directory = relativePath ? `${relativePath}/` : "";
  const candidates = [
    `${relativePath}/README.md`,
    `${relativePath}/README.mdx`,
    `${relativePath}/index.md`,
    `${relativePath}/index.mdx`,
    ...PAGE_EXTENSIONS.map((extension) => `${relativePath}${extension}`),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(docsRoot, defaultLocale, candidate))) return candidate;
  }
  // A route ending in a slash targets a directory index even when its own README is missing.
  void directory;
  return undefined;
}

/** Anchor ids a Markdown heading or an explicit anchor element produces. */
function collectAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  for (const match of source.matchAll(/<a\s+(?:[^>]*?\s+)?(?:id|name)=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    const anchor = ANCHOR_COMMENT.exec(line);
    if (anchor && index > 0 && /^#{1,6}\s+.+$/.test(lines[index - 1])) anchors.add(anchor[1]);

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (!heading) continue;
    anchors.add(
      heading[1]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[*_~`]/g, "")
        .replace(/<[^>]+>/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^\p{L}\p{N}\p{M}\-_]/gu, "")
        .replace(/-+/g, "-"),
    );
  }
  return anchors;
}

const routeEntries = Object.entries(DOCS_ROUTES);
const legalRouteEntries = Object.entries(LEGAL_DOC_ROUTES);

describe("bot docs route registry", () => {
  it("resolves every registered route to a page in the default locale", () => {
    const unresolved = routeEntries.filter(([, route]) => !resolveRoute(route)).map(([name]) => name);
    expect(unresolved).toEqual([]);
  });

  it("resolves every registered anchor to a heading in its destination page", () => {
    const missing: string[] = [];

    for (const [name, route] of routeEntries) {
      const [path, fragment] = route.split("#");
      if (!fragment) continue;
      const file = resolveRoute(path);
      if (!file) continue;
      const anchors = collectAnchors(readFileSync(join(docsRoot, defaultLocale, file), "utf8"));
      if (!anchors.has(fragment)) missing.push(`${name}#${fragment}`);
    }

    expect(missing).toEqual([]);
  });

  it("resolves every legal route to a page in the default locale", () => {
    const unresolved = legalRouteEntries.filter(([, route]) => !resolveRoute(route)).map(([name]) => name);
    expect(unresolved).toEqual([]);
  });

  it("keeps every registered route inside a locale root the site serves", () => {
    for (const locale of DOCS_LOCALES) {
      for (const [, route] of [...routeEntries, ...legalRouteEntries]) {
        expect(buildLocalizedDocsPath(locale.id, route)).toMatch(/^\/[^/]+\//);
      }
    }
  });

  it("keeps the route table free of locale prefixes", () => {
    // The prefix belongs to `buildLocalizedDocsPath` alone, so a second source of truth here would
    // silently produce doubled segments like `/ja/ja/features/`.
    for (const [name, route] of [...routeEntries, ...legalRouteEntries]) {
      expect(`${name}:${route}`).not.toMatch(/\/(?:en|ja|pt-BR|es-419|fr|zh-TW|zh-CN|vi|ru|ko)\//);
    }
  });
});

describe("locale documentation links", () => {
  const localeDirs = PUBLISHED_DOCS_LOCALES.map((locale) => {
    const name = locale === defaultLocale ? "en-US" : locale;
    return { docsLocale: locale, directory: join(repoRoot, "src", "locales", name) };
  }).filter((entry) => existsSync(entry.directory));

  const projectUrlPattern = new RegExp(`${DOCS_BASE_URL.replace(/\./g, "\\.")}([^\\s)\\]"'\`>,]*)`, "g");

  it("finds locale trees to scan", () => {
    expect(localeDirs.length).toBeGreaterThan(0);
  });

  it("prefixes every hardcoded docs URL in locale strings with a published locale root", () => {
    const offenders: string[] = [];

    for (const { directory } of localeDirs) {
      for (const file of readdirSync(directory, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith(".ts")) continue;
        const source = readFileSync(join(directory, file.name), "utf8");
        for (const match of source.matchAll(projectUrlPattern)) {
          const path = match[1].split("#")[0];
          const [segment] = path.replace(/^\//, "").split("/");
          if (!(PUBLISHED_DOCS_LOCALES as readonly string[]).includes(segment)) {
            offenders.push(`${file.name}: ${DOCS_BASE_URL}${path}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("resolves every hardcoded docs URL in locale strings to a page under docs/", () => {
    const offenders: string[] = [];

    for (const { directory } of localeDirs) {
      for (const file of readdirSync(directory, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith(".ts")) continue;
        const source = readFileSync(join(directory, file.name), "utf8");
        for (const match of source.matchAll(projectUrlPattern)) {
          const [path] = match[1].split("#");
          const withoutLocale = path.replace(/^\/[^/]+\//, "/");
          if (!resolveRoute(withoutLocale)) offenders.push(`${file.name}: ${DOCS_BASE_URL}${path}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps every locale tree a real directory", () => {
    for (const { directory } of localeDirs) {
      expect(statSync(directory).isDirectory()).toBe(true);
    }
  });
});
