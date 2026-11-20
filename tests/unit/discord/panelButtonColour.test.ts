import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const SRC_DIR = resolve(import.meta.dir, "../../../src");

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const ALL_SOURCE_FILES = collectSourceFiles(SRC_DIR);

function findColourViolations(colour: "Primary" | "Success"): string[] {
  const needle = `ButtonStyle.${colour}`;
  const violations: string[] = [];

  for (const filePath of ALL_SOURCE_FILES) {
    const relPath = relative(SRC_DIR, filePath).replace(/\\/g, "/");
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      // Type annotations and comments can name ButtonStyle without rendering a button, so
      // skipping them prevents a source scan from punishing narrowed style types.
      const isTypePosition = line.includes("?:");
      const isComment = /^\s*(\/\/|\/?\*)/.test(line);
      if (isTypePosition || isComment) continue;

      const isCategorySelection =
        (relPath === "utils/discord/ui/panel.ts" &&
          line.includes("cat.id === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary")) ||
        (relPath === "utils/discord/ui/helpDashboard.ts" &&
          line.includes("category.id === activeCategoryId ? ButtonStyle.Primary : ButtonStyle.Secondary")) ||
        (relPath === "utils/stats/statsDashboard.ts" &&
          line.includes("index === activeIndex ? ButtonStyle.Primary : ButtonStyle.Secondary"));
      if (line.includes(needle) && !isCategorySelection) {
        violations.push(`${relPath}:${index + 1}`);
      }
    }
  }

  return violations;
}

describe("panel button colour convention", () => {
  it("reserves Primary for active navigation categories", () => {
    expect(findColourViolations("Primary")).toEqual([]);

    const sharedPanelSource = readFileSync(resolve(SRC_DIR, "utils/discord/ui/panel.ts"), "utf8");
    expect(sharedPanelSource).toContain("cat.id === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary");
  });

  it("keeps panel actions grey or red rather than green", () => {
    expect(findColourViolations("Success")).toEqual([]);
  });
});
