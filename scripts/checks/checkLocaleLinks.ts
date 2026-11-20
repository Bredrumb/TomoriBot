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
// `<!-- anchor: slug -->` in Markdown, `{/* anchor: slug */}` in MDX, which rejects HTML comments.
export const ANCHOR_COMMENT = /^\s*(?:<!--|\{\/\*)\s*anchor:\s*([A-Za-z0-9_-]+)\s*(?:-->|\*\/\})\s*$/;

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

export function slugifyHeading(heading: string): string {
  const clean = heading
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

  // Preserve consecutive hyphens per space to match github-slugger (e.g. dropping "&" in "Web & URLs" yields
  // "web--urls").
  return clean
    .toLowerCase()
    .replace(/\s/g, "-")
    .replace(/[^\p{L}\p{N}\p{M}\-_]/gu, "");
}

export function extractDocAnchors(content: string): Set<string> {
  const anchors = new Set<string>();

  for (const match of content.matchAll(/<a\s+(?:[^>]*?\s+)?(?:id|name)=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }

  const lines = content.split(/\r?\n/);
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

// Published locale prefixes are stripped so `resolveDocPath` tests shared routes under each `localeRoot` instead of
// `locale/locale/path`.
export function stripLocaleRoot(urlPath: string): string {
  const [first, ...rest] = urlPath.replace(/^\//, "").split("/");
  if (!(PUBLISHED_DOCS_LOCALES as readonly string[]).includes(first)) return urlPath;
  return rest.length > 0 ? `/${rest.join("/")}` : "/";
}

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

// Routes check the source locale tree before falling back to `en` because the site serves default-locale content for
// untranslated pages.
export function resolveDocPath(
  urlPath: string,
  docFiles: Set<string>,
  publicFiles?: Set<string>,
  locale?: string,
): string | null {
  const clean = stripLocaleRoot(urlPath).replace(/^\//, "").replace(/\/$/, "");

  if (!clean || clean === "" || isDiscordLocaleCode(clean)) {
    return "ROOT";
  }

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

export function extractProjectDocLinks(
  content: string,
  sourceFile: string,
): Array<{ sourceFile: string; url: string; pathname: string; fragment?: string }> {
  const links: Array<{ sourceFile: string; url: string; pathname: string; fragment?: string }> = [];
  const push = (rawPath: string) => {
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

  // Only check root-relative markdown links whose first segment is a published locale because other paths belong to
  // external sites or static assets.
  for (const match of content.matchAll(/\]\((\/[^)\s]*)\)/g)) {
    const [first] = match[1].replace(/^\//, "").split("/");
    if ((PUBLISHED_DOCS_LOCALES as readonly string[]).includes(first)) push(match[1]);
  }

  // Match bare quoted route paths only in docsLocales.ts because bare quoted paths elsewhere are usually filesystem
  // paths.
  if (sourceFile.replaceAll("\\", "/").endsWith("src/constants/docsLocales.ts")) {
    for (const match of content.matchAll(/"(\/[A-Za-z0-9\-_/]*\/#?[A-Za-z0-9\-_#]*)"/g)) {
      push(match[1]);
    }
  }

  return links;
}

export async function validateLocaleLinks(options?: {
  locale?: string;
  rootDir?: string;
}): Promise<LinkValidationSummary> {
  const root = options?.rootDir ?? process.cwd();
  const docsDir = join(root, "docs");

  const docFiles = new Set<string>();
  const docContents = new Map<string, string>();
  const docGlob = new Glob("**/*.{md,mdx}");
  for await (const file of docGlob.scan({ cwd: docsDir })) {
    const normalized = file.replaceAll("\\", "/");
    docFiles.add(normalized);
    docContents.set(normalized, readFileSync(join(docsDir, file), "utf-8"));
  }

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

  const filesToScan: string[] = [];

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

  // Check fragments in DOCS_ROUTES against every published locale because buildDocsUrl prepends the reader's locale.
  const routeTable = join("src", "constants", "docsLocales.ts");
  if (!options?.locale && existsSync(join(root, routeTable))) {
    filesToScan.push(routeTable);
  }

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
  log.success(
    `Locale link check PASSED: all ${summary.validLinksCount} project-owned links and heading fragments resolve`,
  );
  return true;
}
