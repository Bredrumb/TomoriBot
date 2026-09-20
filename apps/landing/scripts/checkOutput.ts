import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS_LOCALES } from "../../../src/constants/docsLocales";

const outputRoot = join(import.meta.dir, "..", "dist");
const readRequired = (path: string): string => readFileSync(join(outputRoot, path), "utf8");
const publishedLocales = DOCS_LOCALES.filter((entry) => entry.docsTree);
const landingPath = (localeId: string) => (localeId === "en" ? "index.html" : join(localeId, "index.html"));
const landingUrl = (localeId: string) => `https://tomoribot.app${localeId === "en" ? "/" : `/${localeId}/`}`;

const rootHtml = readRequired("index.html");
if (/<meta[^>]+(?:name="robots"[^>]+content="noindex"|http-equiv="refresh")/i.test(rootHtml)) {
  throw new Error("The product root must be an indexable page, not a noindex or refresh redirect");
}
if (!/<link[^>]+rel="canonical"[^>]+href="https:\/\/tomoribot\.app\/"/i.test(rootHtml)) {
  throw new Error("The product root must carry a self-referencing canonical URL");
}

for (const locale of publishedLocales) {
  const html = readRequired(landingPath(locale.id));
  const canonicalUrl = landingUrl(locale.id);
  const docsUrl = `https://docs.tomoribot.app/${locale.id}/introduction/`;

  if (!html.includes(`<html lang="${locale.lang}"`)) {
    throw new Error(`The ${locale.id} landing page has the wrong document language`);
  }
  if (!html.includes(`<link rel="canonical" href="${canonicalUrl}">`)) {
    throw new Error(`The ${locale.id} landing page has no self-referencing canonical URL`);
  }
  if (!html.includes(`href="${docsUrl}"`)) {
    throw new Error(`The ${locale.id} landing page has no localized introduction link`);
  }
  for (const alternateLocale of publishedLocales) {
    const alternateUrl = landingUrl(alternateLocale.id);
    if (!html.includes(`hreflang="${alternateLocale.lang}" href="${alternateUrl}"`)) {
      throw new Error(`The ${locale.id} landing page is missing its ${alternateLocale.id} alternate`);
    }
  }
  if (!html.includes(`hreflang="x-default" href="${landingUrl("en")}"`)) {
    throw new Error(`The ${locale.id} landing page is missing its x-default alternate`);
  }
}

readRequired("robots.txt");
readRequired("sitemap-index.xml");
readRequired("sitemap-0.xml");

console.log("Product landing page canonicals, locale links, hreflang, robots file, and sitemap verified");
