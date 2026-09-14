import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { type LocaleCode, isDiscordLocaleCode } from "@/constants/locales";

const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
};

export const DOCS_HOST = "https://docs.tomoribot.app";

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

  // Strip {#custom-id} if present
  clean = clean.replace(/\{#[^}]+\}/, "").trim();

  return clean
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\p{M}\-_]/gu, "")
    .replace(/-+/g, "-");
}

/**
 * Extracts all valid anchors from a markdown document:
 * explicit `<a id="...">` or `<a name="...">`, custom `{#id}`, and slugified headings.
 */
export function extractDocAnchors(content: string): Set<string> {
  const anchors = new Set<string>();

  // Explicit anchor tags
  for (const match of content.matchAll(/<a\s+(?:[^>]*?\s+)?(?:id|name)=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }

  // Heading lines: # Heading
  for (const line of content.split("\n")) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      const rawHeading = headingMatch[1];
      const customId = rawHeading.match(/\{#([^}]+)\}/);
      if (customId) {
        anchors.add(customId[1]);
      }
      const slug = slugifyHeading(rawHeading);
      if (slug) {
        anchors.add(slug);
      }
    }
  }

  return anchors;
}

/**
 * Resolves a doc URL pathname to a markdown file path under docs/.
 */
export function resolveDocPath(
  urlPath: string,
  docFiles: Set<string>,
  publicFiles?: Set<string>,
): string | null {
  const clean = urlPath.replace(/^\//, "").replace(/\/$/, "");

  // Root path / or locale landing roots (e.g. /en, /ja)
  if (!clean || clean === "" || clean === "en" || clean === "ja" || isDiscordLocaleCode(clean)) {
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

  for (const candidate of candidates) {
    if (docFiles.has(candidate)) {
      return candidate;
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
  const regex = /https:\/\/docs\.tomoribot\.app([^\s)\]"`'>,]*)/g;

  for (const match of content.matchAll(regex)) {
    let rawPath = match[1];

    // Strip trailing punctuation often adjacent to URLs in prose (e.g. ".", ")", "...")
    rawPath = rawPath.replace(/[.,;:]+$/, "");

    const [pathname, fragment] = rawPath.split("#");
    links.push({
      sourceFile,
      url: `${DOCS_HOST}${rawPath}`,
      pathname: pathname || "/",
      fragment: fragment || undefined,
    });
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

  // Validate links across collected files
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

    for (const link of links) {
      const resolved = resolveDocPath(link.pathname, docFiles, publicFiles);

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const localeArg = args.find((arg) => arg.startsWith("--locale="))?.split("=")[1] ??
    (args.includes("--locale") ? args[args.indexOf("--locale") + 1] : undefined);

  if (localeArg && !isDiscordLocaleCode(localeArg)) {
    console.error(`Invalid Discord locale code: ${localeArg}`);
    process.exit(1);
  }

  log.info(`Validating project-owned documentation links${localeArg ? ` for ${localeArg}` : ""}…`);
  const summary = await validateLocaleLinks({ locale: localeArg });

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
    process.exit(1);
  } else {
    log.success(
      `Locale link check PASSED: all ${summary.validLinksCount} project-owned links and heading fragments resolve`,
    );
    process.exit(0);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error during link validation:", err);
    process.exit(1);
  });
}
