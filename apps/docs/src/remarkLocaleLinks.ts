import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DOCS_LOCALE_ID, DOCS_LOCALES } from "../../../src/constants/docsLocales";
import { findEntryFile } from "./docsRouting";

// Local type avoids depending on `@astrojs/markdown-remark`: see `remarkHeadingIds.ts`.
type RemarkPlugin = () => (tree: unknown, file: { path?: string }) => void;

interface MdastNode {
  type: string;
  url?: string;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: MdastNode[];
}

const LOCALE_IDS: readonly string[] = DOCS_LOCALES.map((locale) => locale.id);

// Last `/docs/<locale>/` match wins because the repo path under `apps/docs/` also contains `/docs/`.
function localeFromSourcePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const matches = [...path.replaceAll("\\", "/").matchAll(/\/docs\/([A-Za-z0-9-]+)\//g)];
  const locale = matches.at(-1)?.[1];
  return locale && LOCALE_IDS.includes(locale) ? locale : undefined;
}

// Untranslated links resolve to the default locale so readers avoid `noindex` fallback URLs, while links with an
// explicit locale prefix stay untouched.
export function localizeDocsLink(
  url: string,
  locale: string,
  sections: ReadonlySet<string>,
  pageExists: (locale: string, pageId: string) => boolean,
): string {
  if (!url.startsWith("/") || url.startsWith("//")) return url;

  const suffixStart = url.search(/[#?]/);
  const pathname = suffixStart === -1 ? url : url.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : url.slice(suffixStart);
  const segments = pathname.split("/").filter(Boolean);
  const [section] = segments;
  if (!section || !sections.has(section)) return url;

  const pageId = segments.join("/");
  const target = pageExists(locale, pageId) ? locale : DEFAULT_DOCS_LOCALE_ID;
  return `/${target}${pathname}${suffix}`;
}

// Astro caches rendered HTML per file in `.astro/data-store.json`, so cached builds keep stale link targets unless
// the content digest tracks locale pages.
export function remarkLocaleLinks(docsRoot: string): RemarkPlugin {
  const sections: ReadonlySet<string> = new Set(
    readdirSync(join(docsRoot, DEFAULT_DOCS_LOCALE_ID), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  // A path names either a page or a directory index, and the URL alone does not say which.
  const pageExists = (locale: string, pageId: string): boolean =>
    findEntryFile(docsRoot, locale, pageId) !== undefined ||
    findEntryFile(docsRoot, locale, `${pageId}/index`) !== undefined;

  return () => (tree, file) => {
    const locale = localeFromSourcePath(file.path);
    if (!locale) return;

    const rewrite = (url: string): string => localizeDocsLink(url, locale, sections, pageExists);

    const visit = (node: MdastNode): void => {
      if ((node.type === "link" || node.type === "definition") && typeof node.url === "string") {
        node.url = rewrite(node.url);
      }
      // Directive nodes also carry `attributes`, as a plain object, so only the MDX JSX array form
      // can hold an `href` prop.
      if (Array.isArray(node.attributes)) {
        for (const attribute of node.attributes) {
          if (attribute.name === "href" && typeof attribute.value === "string") {
            attribute.value = rewrite(attribute.value);
          }
        }
      }
      node.children?.forEach(visit);
    };

    visit(tree as MdastNode);
  };
}
