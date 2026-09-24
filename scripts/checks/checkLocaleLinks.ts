import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { PUBLISHED_DOCS_LOCALES } from "@/constants/docsLocales";
import { isDiscordLocaleCode } from "@/constants/locales";

const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
};

export const DOCS_HOST = "https://docs.tomoribot.app";
const ANCHOR_COMMENT = /^\s*<!--\s*anchor:\s*([A-Za-z0-9_-]+)\s*-->\s*$/;

export interface LinkFinding {
  sourceFile: string;
  url: string;
  pathname: string;
  fragment?: string;
  resolvedFile?: string;
  type: "missing_route" | "missing_fragment";
  message: string;
}

export interface LinkValidationSummary {
  totalLinksChecked: number;
  validLinksCount: number;
  findings: LinkFinding[];
}

/**
 * Slugs a markdown heading to match Starlight / GitHub anchor generation.
 */
export function slugifyHeading(heading: string): string {
  let clean = heading
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links [text](url) -> text
    .replace(/[*_~`]/g, "") // formatting
    .replace(/<[^>]+>/g, "") // html tags
    .trim();

  // Each space becomes its own hyphen and runs are not collapsed, because that is what
  // github-slugger does: dropping `&` from "Web & URLs" leaves two spaces, so the real anchor is
  // `web--urls`. Collapsing here reported every such heading as a broken fragment.
  return clean
    .toLowerCase()
    .replace(/\s/g, "-")
    .replace(/[^\p{L}\p{N}\p{M}\-_]/gu, "");
}

/**
 * Extracts all valid anchors from a markdown document:
 * explicit `<a id="...">` or `<a name="...">`, `anchor:` comments, and slugified headings.
 */
export function extractDocAnchors(content: string): Set<string> {
  const anchors = new Set<string>();

  // Explicit anchor tags
  for (const match of content.matchAll(/<a\s+(?:[^>]*?\s+)?(?:id|name)=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }

  // Heading lines: # Heading
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    const anchor = ANCHOR_COMMENT.exec(line);
    if (anchor && index > 0 && /^#{1,6}\s+.+$/.test(lines[index - 1])) {
      anchors.add(anchor[1]);
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      const rawHeading = headingMatch[1];
      const slug = slugifyHeading(rawHeading);
      if (slug) {
        anchors.add(slug);
      }
    }
  }

  return anchors;
}

/**
 * Strips a published locale root from a docs URL pathname, so the file lookup sees the route the
 * locale trees share. Without this, `/ja/features/command-reference/` reads as a file named
 * `ja/features/...` and every prefixed link reports as broken.
 */
export function stripLocaleRoot(urlPath: string): string {
  const [first, ...rest] = urlPath.replace(/^\//, "").split("/");
  if (!(PUBLISHED_DOCS_LOCALES as readonly string[]).includes(first)) return urlPath;
  return rest.length > 0 ? `/${rest.join("/")}` : "/";
}

/** Locale directory a source file documents, which decides which tree a route must resolve in. */
export function sourceLocaleOf(sourceFile: string): string | undefined {
  const normalized = sourceFile.replaceAll("\\", "/");
  const readmeMatch = normalized.match(/(?:^|\/)README_([A-Za-z-]+)\.md$/);
  if (readmeMatch && isDiscordLocaleCode(readmeMatch[1])) return readmeMatch[1];
  const docsMatch = normalized.match(/(?:^|\/)docs\/([^/]+)\//);
  if (docsMatch && (PUBLISHED_DOCS_LOCALES as readonly string[]).includes(docsMatch[1])) return docsMatch[1];
  const localeMatch = normalized.match(/(?:^|\/)locales\/([^/]+)\//);
  if (localeMatch && isDiscordLocaleCode(localeMatch[1])) return localeMatch[1];
  return undefined;
}

/**
 * Resolves a doc URL pathname to a markdown file path under docs/.
 *
 * A route resolves in the source file's own locale tree first and then in the default locale,
 * because the site serves the default locale's content at a URL whose translation does not exist
 * yet. A route with no page in either tree is genuinely broken.
 */
export function resolveDocPath(
  urlPath: string,
  docFiles: Set<string>,
  publicFiles?: Set<string>,
  locale?: string,
): string | null {
  const clean = stripLocaleRoot(urlPath).replace(/^\//, "").replace(/\/$/, "");

  // Root path / or a locale landing root (e.g. /en, /ja)
  if (!clean || clean === "" || isDiscordLocaleCode(clean)) {
    return "ROOT";
  }

  // Static files in apps/docs/public (e.g. /img/..., /llms.txt)
  if (clean === "llms.txt" || (publicFiles && (publicFiles.has(clean) || publicFiles.has(`public/${clean}`)))) {
    return "STATIC_ASSET";
  }

  const candidates = [
    `${clean}.md`,
    `${clean}.mdx`,
    `${clean}/README.md`,
    `${clean}/README.mdx`,
    `${clean}/index.md`,
    `${clean}/index.mdx`,
  ];

  const localeRoots =
    locale && (PUBLISHED_DOCS_LOCALES as readonly string[]).includes(locale)
      ? [locale, "en"]
      : ["en", ...(PUBLISHED_DOCS_LOCALES as readonly string[])];
  for (const localeRoot of localeRoots) {
    for (const candidate of candidates) {
      const localeCandidate = `${localeRoot}/${candidate}`;
      if (docFiles.has(localeCandidate)) {
        return localeCandidate;
      }
    }
  }

  return null;
}

/**
 * Extracts project-owned documentation URLs from file content.
 * Matches `https://docs.tomoribot.app/{path}`. Third-party URLs are untouched and ignored.
 */
export function extractProjectDocLinks(
  content: string,
  sourceFile: string,
): Array<{ sourceFile: string; url: string; pathname: string; fragment?: string }> {
  const links: Array<{ sourceFile: string; url: string; pathname: string; fragment?: string }> = [];
  const push = (rawPath: string) => {
    // Strip trailing punctuation often adjacent to URLs in prose (e.g. ".", ")", "...")
    const trimmed = rawPath.replace(/[.,;:]+$/, "");
    const [pathname, fragment] = trimmed.split("#");
    links.push({
      sourceFile,
      url: `${DOCS_HOST}${trimmed}`,
      pathname: pathname || "/",
      fragment: fragment || undefined,
    });
  };

  for (const match of content.matchAll(/https:\/\/docs\.tomoribot\.app([^\s)\]"`'>,]*)/g)) {
    push(match[1]);
  }

  // Root-relative markdown links. Only a path whose first segment is a published locale root is
  // ours: every other `](/...)` belongs to some other site or to a static asset the docs build
  // owns, and matching those would report noise the author cannot act on.
  for (const match of content.matchAll(/\]\((\/[^)\s]*)\)/g)) {
    const [first] = match[1].replace(/^\//, "").split("/");
    if ((PUBLISHED_DOCS_LOCALES as readonly string[]).includes(first)) push(match[1]);
  }

  // The route table stores bare, locale-less routes as string literals rather than links, so it
  // needs its own pattern. Scoped to that file because a bare quoted path anywhere else is far
  // more likely to be a filesystem path than a docs route.
  if (sourceFile.replaceAll("\\", "/").endsWith("src/constants/docsLocales.ts")) {
    for (const match of content.matchAll(/"(\/[A-Za-z0-9\-_/]*\/#?[A-Za-z0-9\-_#]*)"/g)) {
      push(match[1]);
    }
  }

  return links;
}

/**
 * Scans documentation files, locale files, and READMEs for broken project-owned doc routes and fragments.
 */
export async function validateLocaleLinks(options?: {
  locale?: string;
  rootDir?: string;
}): Promise<LinkValidationSummary> {
  const root = options?.rootDir ?? process.cwd();
  const docsDir = join(root, "docs");

  // Index all doc files under docs/
  const docFiles = new Set<string>();
  const docContents = new Map<string, string>();
  const docGlob = new Glob("**/*.{md,mdx}");
  for await (const file of docGlob.scan({ cwd: docsDir })) {
    const normalized = file.replaceAll("\\", "/");
    docFiles.add(normalized);
    docContents.set(normalized, readFileSync(join(docsDir, file), "utf-8"));
  }

  // Index static public files
  const publicFiles = new Set<string>();
  const publicDir = join(root, "apps", "docs", "public");
  if (existsSync(publicDir)) {
    const pubGlob = new Glob("**/*");
    for await (const file of pubGlob.scan({ cwd: publicDir, onlyFiles: true })) {
      publicFiles.add(file.replaceAll("\\", "/"));
    }
  }

  if (options?.locale && !isDiscordLocaleCode(options.locale)) {
    throw new Error(`Invalid Discord locale code: ${options.locale}`);
  }

  // Collect source files to scan
  const filesToScan: string[] = [];

  // Locales
  const localesDir = join(root, "src", "locales");
  if (existsSync(localesDir)) {
    if (options?.locale) {
      const targetLocaleDir = join(localesDir, options.locale);
      if (existsSync(targetLocaleDir)) {
        const localeGlob = new Glob("**/*.ts");
        for await (const file of localeGlob.scan({ cwd: targetLocaleDir })) {
          filesToScan.push(join("src", "locales", options.locale, file));
        }
      }
    } else {
      const localeGlob = new Glob("**/*.ts");
      for await (const file of localeGlob.scan({ cwd: localesDir })) {
        filesToScan.push(join("src", "locales", file));
      }
    }
  }

  // The bot's own docs destinations. `DOCS_ROUTES` is locale-less, so a fragment there has to
  // exist in every published tree, not just the English one: `buildDocsUrl` prefixes the reader's
  // locale onto it, and an anchor that only English carries lands every other locale at page top.
  const routeTable = join("src", "constants", "docsLocales.ts");
  if (!options?.locale && existsSync(join(root, routeTable))) {
    filesToScan.push(routeTable);
  }

  // Docs
  if (options?.locale) {
    const localeDocs = join(docsDir, options.locale);
    if (existsSync(localeDocs)) {
      const glob = new Glob("**/*.{md,mdx}");
      for await (const file of glob.scan({ cwd: localeDocs })) {
        filesToScan.push(join("docs", options.locale, file));
      }
    }
  } else {
    for (const file of docFiles) {
      filesToScan.push(join("docs", file));
    }
  }

  // READMEs: root README.md for en-US/global, and .github/README_${locale}.md for translated locales
  if (options?.locale) {
    if (options.locale === "en-US") {
      const enReadme = join(root, "README.md");
      if (existsSync(enReadme)) filesToScan.push("README.md");
    } else {
      const candidates = [
        join(".github", `README_${options.locale}.md`),
        `README_${options.locale}.md`,
        `README.${options.locale}.md`,
      ];
      for (const candidate of candidates) {
        if (existsSync(join(root, candidate))) {
          filesToScan.push(candidate);
        }
      }
    }
  } else {
    const rootGlob = new Glob("README*.md");
    for await (const file of rootGlob.scan({ cwd: root })) {
      filesToScan.push(file);
    }
    const githubDir = join(root, ".github");
    if (existsSync(githubDir)) {
      const githubGlob = new Glob("README*.md");
      for await (const file of githubGlob.scan({ cwd: githubDir })) {
        filesToScan.push(join(".github", file));
      }
    }
  }

  if (options?.locale && filesToScan.length === 0) {
    throw new Error(
      `Locale "${options.locale}" has no source files in src/locales/, docs/, or .github/README_${options.locale}.md`,
    );
  }

  const findings: LinkFinding[] = [];
  let totalLinksChecked = 0;
  let validLinksCount = 0;

  for (const relPath of filesToScan) {
    const fullPath = join(root, relPath);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const links = extractProjectDocLinks(content, relPath);
    totalLinksChecked += links.length;
    const sourceLocale = sourceLocaleOf(relPath);

    for (const link of links) {
      const resolved = resolveDocPath(link.pathname, docFiles, publicFiles, sourceLocale);

      if (!resolved) {
        findings.push({
          sourceFile: link.sourceFile,
          url: link.url,
          pathname: link.pathname,
          fragment: link.fragment,
          type: "missing_route",
          message: `Documentation route "${link.pathname}" does not resolve to any page under docs/`,
        });
        continue;
      }

      if (resolved === "ROOT" || resolved === "STATIC_ASSET") {
        validLinksCount++;
        continue;
      }

      if (link.fragment && relPath.replaceAll("\\", "/") === "src/constants/docsLocales.ts") {
        const missing = PUBLISHED_DOCS_LOCALES.filter((published) => {
          const localeFile = resolveDocPath(link.pathname, docFiles, publicFiles, published);
          if (!localeFile || localeFile === "ROOT" || localeFile === "STATIC_ASSET") return false;
          return !extractDocAnchors(docContents.get(localeFile) ?? "").has(link.fragment as string);
        });
        if (missing.length > 0) {
          findings.push({
            sourceFile: link.sourceFile,
            url: link.url,
            pathname: link.pathname,
            fragment: link.fragment,
            resolvedFile: resolved,
            type: "missing_fragment",
            message:
              `Heading anchor "#${link.fragment}" is missing from ${missing.join(", ")}; ` +
              `add <!-- anchor: ${link.fragment} --> directly after the matching heading in each locale`,
          });
          continue;
        }
        validLinksCount++;
        continue;
      }

      if (link.fragment) {
        const docText = docContents.get(resolved) ?? "";
        const anchors = extractDocAnchors(docText);
        if (!anchors.has(link.fragment)) {
          findings.push({
            sourceFile: link.sourceFile,
            url: link.url,
            pathname: link.pathname,
            fragment: link.fragment,
            resolvedFile: resolved,
            type: "missing_fragment",
            message: `Heading anchor "#${link.fragment}" not found in destination "docs/${resolved}"`,
          });
          continue;
        }
      }

      validLinksCount++;
    }
  }

  return {
    totalLinksChecked,
    validLinksCount,
    findings,
  };
}

/** Prints the link section of `check-locales` and returns whether every link resolved. */
export async function reportLocaleLinks(): Promise<boolean> {
  log.info("Validating project-owned documentation links…");
  const summary = await validateLocaleLinks();

  log.info(`Checked ${summary.totalLinksChecked} project-owned link(s).`);

  if (summary.findings.length > 0) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`❌ BROKEN DOC LINKS OR STALE FRAGMENTS (${summary.findings.length})`);
    console.log("=".repeat(80));

    for (const f of summary.findings) {
      console.log(`  • [${f.type.toUpperCase()}] in ${f.sourceFile}`);
      console.log(`    URL: ${f.url}`);
      console.log(`    Detail: ${f.message}`);
    }

    console.log(`\n${"=".repeat(80)}`);
    log.error(`Locale link check FAILED: ${summary.findings.length} broken link(s) or fragment(s)`);
    return false;
  }
  log.success(`Locale link check PASSED: all ${summary.validLinksCount} project-owned links and heading fragments resolve`);
  return true;
}
