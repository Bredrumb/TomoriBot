import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS_LOCALES } from "../../../src/constants/docsLocales";

const outputRoot = join(import.meta.dir, "..", "dist");
const readRequired = (path: string): string => readFileSync(join(outputRoot, path), "utf8");

const rootHtml = readRequired("index.html");
if (/<meta[^>]+(?:name="robots"[^>]+content="noindex"|http-equiv="refresh")/i.test(rootHtml)) {
  throw new Error("The product root must be an indexable page, not a noindex or refresh redirect");
}
if (!/<link[^>]+rel="canonical"[^>]+href="https:\/\/tomoribot\.app\/"/i.test(rootHtml)) {
  throw new Error("The product root must carry a self-referencing canonical URL");
}
for (const locale of DOCS_LOCALES.filter((entry) => entry.docsTree)) {
  const docsUrl = `https://docs.tomoribot.app/${locale.id}/introduction/`;
  if (!rootHtml.includes(`href="${docsUrl}"`)) {
    throw new Error(`The product root has no introduction link for published locale ${locale.id}`);
  }
}

readRequired("robots.txt");
readRequired("sitemap-index.xml");
readRequired("sitemap-0.xml");

console.log("Product landing page canonical, locale links, robots file, and sitemap verified");
