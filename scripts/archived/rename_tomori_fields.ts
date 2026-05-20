/**
 * Mechanically renames all snake_case `tomori_*` field/column references to
 * their `persona_*` equivalents across the `src/` tree, following migration 016.
 *
 * Excluded files (intentional preservations):
 *   - src/types/preset/presetExport.ts  — `tomori_nickname` is an external PNG metadata key
 *   - src/types/db/schema.ts            — already updated; `tomori_config_id` is vestigial (callers need removal, not rename)
 *
 * Run: bun run scripts/rename_tomori_fields.ts [--dry-run]
 */

import { readdir } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");

// Longest patterns first to prevent prefix-collision bugs (e.g. tomori_id matching inside tomori_preset_id)
const REPLACEMENTS: [RegExp, string][] = [
  [/tomori_preset_desc/g, "persona_preset_desc"],
  [/tomori_preset_name/g, "persona_preset_name"],
  [/tomori_preset_id/g, "persona_preset_id"],
  [/tomori_nickname/g, "persona_nickname"],
  [/tomori_id/g, "persona_id"],
];

// Normalized posix paths relative to project root
const EXCLUDED = new Set(["src/types/preset/presetExport.ts", "src/types/db/schema.ts"]);

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const allFiles = await collectTsFiles("src");
  let changed = 0;
  let skipped = 0;

  for (const file of allFiles) {
    const rel = normalizePath(file);
    if (EXCLUDED.has(rel)) {
      skipped++;
      continue;
    }

    const original = readFileSync(file, "utf-8");
    let updated = original;
    for (const [pattern, replacement] of REPLACEMENTS) {
      updated = updated.replace(pattern, replacement);
    }

    if (updated !== original) {
      if (!DRY_RUN) {
        writeFileSync(file, updated, "utf-8");
      }
      console.log(`${DRY_RUN ? "[dry] " : ""}updated: ${rel}`);
      changed++;
    }
  }

  console.log(`\n${DRY_RUN ? "[dry-run] " : ""}${changed} file(s) changed, ${skipped} excluded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
