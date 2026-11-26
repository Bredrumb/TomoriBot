import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REDIRECTS_PATH = join(import.meta.dir, "../../../apps/docs/public/_redirects");
// Cloudflare's documented caps; rules past them are dropped without any build or deploy error.
const MAX_STATIC_RULES = 2000;
const MAX_DYNAMIC_RULES = 100;

const rules = readFileSync(REDIRECTS_PATH, "utf8")
  .split(/\r?\n/)
  .map((text, index) => ({ line: index + 1, source: text.trim().split(/\s+/)[0] ?? "" }))
  .filter((rule) => rule.source.startsWith("/"));
const isDynamic = (source: string) => source.includes("*") || /\/:[A-Za-z]/.test(source);

describe("docs _redirects", () => {
  it("keeps every exact rule above the first dynamic rule", () => {
    const firstDynamic = rules.findIndex((rule) => isDynamic(rule.source));
    const misplaced =
      firstDynamic === -1
        ? []
        : rules
            .slice(firstDynamic)
            .filter((rule) => !isDynamic(rule.source))
            .map((rule) => `line ${rule.line}: ${rule.source}`);
    expect(misplaced).toEqual([]);
  });

  it("stays within Cloudflare's static and dynamic rule caps", () => {
    const dynamicCount = rules.filter((rule) => isDynamic(rule.source)).length;
    expect(dynamicCount).toBeLessThanOrEqual(MAX_DYNAMIC_RULES);
    expect(rules.length - dynamicCount).toBeLessThanOrEqual(MAX_STATIC_RULES);
  });
});
