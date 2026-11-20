import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHreflangAlternates,
  deriveDescription,
  localeFromEntryId,
  stripLocaleFromEntryId,
  withoutHreflangAlternates,
} from "./docsRouting";
import { DEFAULT_DOCS_LOCALE_ID, DOCS_BASE_URL, getDocsLocaleConfig } from "../../../src/constants/docsLocales";

// Both module dir and `process.cwd()` are passed because bundled middleware runs from `dist/.prerender/chunks/`,
// where `import.meta.url` stays inside `dist/`.
const docsRoot = resolveDocsRoot(
  dirname(fileURLToPath(import.meta.url)),
  process.cwd(),
);

function resolveDocsRoot(moduleDir: string, workingDir: string): string {
  const candidates = [
    join(workingDir, "src", "content", "docs"),
    join(moduleDir, "content", "docs"),
    join(moduleDir, "..", "content", "docs"),
    join(moduleDir, "..", "..", "..", "content", "docs"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export const onRequest = defineRouteMiddleware((context) => {
  const { starlightRoute } = context.locals;
  const { entry, head } = starlightRoute;

  const baseId = stripLocaleFromEntryId(entry.id);
  // The route's own locale decides the budget, except on a fallback route, which serves the default
  // locale's English body: an 80-character budget there would clip English mid-sentence.
  const locale = starlightRoute.locale ?? localeFromEntryId(entry.id) ?? DEFAULT_DOCS_LOCALE_ID;
  const budgetLocale = starlightRoute.isFallback ? DEFAULT_DOCS_LOCALE_ID : locale;

  // Noindex internal wiki pages and untranslated fallback routes because fallbacks duplicate default-locale content until
  // translated.
  const isWiki = baseId === "wiki" || baseId.startsWith("wiki/");
  if (isWiki || starlightRoute.isFallback) {
    head.push({ tag: "meta", attrs: { name: "robots", content: "noindex" } });
  }

  // Rebuild hreflang alternates from disk because Starlight emits tags for every configured locale, advertising
  // fallbacks as translations.
  const alternates = buildHreflangAlternates(docsRoot, baseId, {
    isFallback: starlightRoute.isFallback,
    site: context.site ?? DOCS_BASE_URL,
  });
  const headWithoutAlternates = withoutHreflangAlternates(head);
  head.length = 0;
  head.push(...headWithoutAlternates, ...alternates);

  if (entry.data.description) return;

  const maxLength = getDocsLocaleConfig(budgetLocale)?.descriptionMaxLength ?? 160;
  const description = deriveDescription(entry.body ?? "", maxLength);
  if (!description) return;

  // Overwrite Starlight's site-wide fallback description tags in place because pushing new tags would emit duplicates.
  for (const tag of head) {
    if (tag.tag !== "meta") continue;
    if (tag.attrs?.name === "description" || tag.attrs?.property === "og:description") {
      tag.attrs.content = description;
    }
  }
});
