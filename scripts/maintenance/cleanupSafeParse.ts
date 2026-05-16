#!/usr/bin/env bun
/**
 * Phase 6 Stage B — Remove tomoriConfigSchema.safeParse validation blocks.
 *
 * After redirecting UPDATE statements to split tables, the RETURNING clause
 * now returns only `{ server_id }` instead of a full TomoriConfigRow.
 * The safeParse validation blocks are now both incorrect (wrong shape) and
 * redundant (the `!updatedRow` check already handles update failure).
 *
 * This script removes:
 *   - `const validatedConfig = tomoriConfigSchema.safeParse(...)` declarations
 *   - The `if (!validatedConfig.success || !updatedRow)` or
 *     `if (!validatedConfig.success)` error blocks that follow
 *   - Replaces combined `!validatedConfig.success || !updatedRow` checks with
 *     standalone `!updatedRow` checks (preserving the error handling)
 *   - Removes now-unused `tomoriConfigSchema` imports where applicable
 *
 * Run: bun scripts/maintenance/cleanupSafeParse.ts [--dry-run]
 */

import { readFileSync, writeFileSync } from "fs";
import { globSync } from "glob";
import path from "path";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Returns true if this file still needs safeParse (still writes to tomori_configs
 * for model FK columns). Don't touch these — they'll be fixed when model writes
 * are redirected.
 */
const SKIP_FILES = new Set([
  "src/commands/model/text.ts",
  "src/commands/model/video.ts",
  "src/commands/model/vision.ts",
  "src/commands/model/embedding.ts",
  "src/commands/capabilities/manage.ts",
  "src/commands/model/image.ts", // still has diffusion_model_id writes
  "src/commands/server/auto-trigger/threshold.ts", // still has tomori_configs writes
]);

interface FileResult {
  file: string;
  changes: string[];
  changed: boolean;
}

function processFile(filePath: string): FileResult {
  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  const result: FileResult = { file: filePath, changes: [], changed: false };

  if (SKIP_FILES.has(rel)) return result;

  let content = readFileSync(filePath, "utf-8");
  const original = content;

  // ── Pattern A: Combined check `!validatedConfig.success || !updatedRow` ────
  // Replace the entire block starting with `const validatedConfig = ...`
  // through the closing `}` with just `if (!updatedRow) {` + original body.
  // We match: const validatedConfig = tomoriConfigSchema.safeParse(...);\n
  //           if (!validatedConfig.success || !updatedRow) {\n  ...\n  }
  content = content.replace(
    /(\s*)const validatedConfig = tomoriConfigSchema\.safeParse\([^)]+\);\s*\n\s*if \(!validatedConfig\.success \|\| !updatedRow\) \{/g,
    "$1if (!updatedRow) {",
  );

  // ── Pattern B: Separate success check after existing !updatedRow guard ────
  // Match: // (optional comment line)\n
  //        const validatedConfig = tomoriConfigSchema.safeParse(...);\n
  //        if (!validatedConfig.success) {\n  ...body...\n  }\n
  // We remove this entire block (the !updatedRow guard above it is already kept).
  // Strategy: remove from `const validatedConfig` to the closing `\n    }` of the if block.
  // We use a greedy match that stops at the first `\n    }` or `\n  }` followed by non-}
  // This is simplified: match the pattern and remove it.
  content = content.replace(
    /\n[ \t]*\/\/ [^\n]*[Vv]alidat[^\n]*\n[ \t]*const validatedConfig = tomoriConfigSchema\.safeParse\([^)]+\);[ \t]*\n[ \t]*if \(!validatedConfig\.success\) \{[^}]*(?:\{[^}]*\}[^}]*)?\}/g,
    "",
  );

  // Simpler fallback: if still present, remove the pattern without the comment
  content = content.replace(
    /\n[ \t]*const validatedConfig = tomoriConfigSchema\.safeParse\([^)]+\);[ \t]*\n[ \t]*if \(!validatedConfig\.success\) \{[^}]*(?:\{[^}]*\}[^}]*)?\}/g,
    "",
  );

  // ── Update targetTable metadata strings ─────────────────────────────────────
  // Replace targetTable: "tomori_configs" with the split table name based on
  // surrounding context. Since we can't easily detect context, we do a conservative
  // replacement: only if the file no longer has any UPDATE tomori_configs.
  if (!content.includes("UPDATE tomori_configs")) {
    // Find what split table this file uses (look for UPDATE server_X_configs)
    const tableMatch = content.match(/UPDATE\s+(server_\w+_configs)/);
    if (tableMatch) {
      const newTable = tableMatch[1]!;
      const before = content;
      content = content.replace(/targetTable:\s*"tomori_configs"/g, `targetTable: "${newTable}"`);
      if (content !== before) {
        result.changes.push(`targetTable: "tomori_configs" → "${newTable}"`);
      }
    }
  }

  // ── Remove unused tomoriConfigSchema import ──────────────────────────────────
  if (!content.includes("tomoriConfigSchema") && content.includes("import")) {
    // Remove from import: `tomoriConfigSchema,` or `, tomoriConfigSchema`
    const before = content;
    content = content.replace(/,?\s*tomoriConfigSchema,?\s*/g, (match, offset) => {
      // Only replace if inside an import statement
      const before2 = content.slice(0, offset);
      if (before2.includes("import {") && !before2.split("import {").pop()?.includes("}")) {
        return match.includes(",") ? "," : "";
      }
      return match;
    });
    // Simpler: just remove the import token from import lines
    content = content.replace(/^import \{([^}]+)\} from ["']@\/types\/db\/schema["'];/gm, (match, imports: string) => {
      const cleaned = imports
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "tomoriConfigSchema" && s !== "type TomoriConfigRow")
        .join(", ");
      if (!cleaned.trim()) return "";
      return `import { ${cleaned} } from "@/types/db/schema";`;
    });
    if (content !== before) {
      result.changes.push("removed unused tomoriConfigSchema import");
    }
  }

  if (content !== original) {
    result.changed = true;
    result.changes.unshift("removed safeParse block(s)");
    if (!DRY_RUN) {
      writeFileSync(filePath, content, "utf-8");
    }
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const files = globSync("src/commands/**/*.ts", { cwd: process.cwd() });
const results: FileResult[] = [];

for (const file of files) {
  const absPath = path.resolve(process.cwd(), file);
  const r = processFile(absPath);
  if (r.changes.length > 0) results.push(r);
}

console.log(`\n${"─".repeat(70)}`);
console.log(DRY_RUN ? "DRY RUN — no files written" : "FILES UPDATED");
console.log("─".repeat(70));

for (const r of results) {
  const rel = path.relative(process.cwd(), r.file);
  console.log(`\n${r.changed ? "✓" : "○"} ${rel}`);
  for (const c of r.changes) console.log(`    ↳ ${c}`);
}

console.log(`\n${"─".repeat(70)}`);
console.log(`Files changed: ${results.filter((r) => r.changed).length}`);
console.log("─".repeat(70));
