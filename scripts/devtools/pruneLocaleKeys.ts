import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { Glob } from "bun";
import { analyzeLocalizationKeys } from "./checkLocalizationKeys";

/**
 * Lightweight logger (no DB dependency)
 */
const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`❌ ${msg}`, err ? `| ${err}` : ""),
  success: (msg: string) => console.log(`✅ ${msg}`),
};

/**
 * Recursively removes dot-notation paths from a nested object.
 * The path segments are split on `.` — intermediate objects with no remaining
 * children are pruned automatically in a second pass via `pruneEmptyObjects`.
 * @param obj - The mutable locale object
 * @param path - Dot-separated key path (e.g. "commands.conditioning.toggle.description")
 */
function deletePath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  // Walk to the parent of the leaf
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== "object" || current[part] === null) return;
    current = current[part] as Record<string, unknown>;
  }

  const leaf = parts[parts.length - 1];
  delete current[leaf];
}

/**
 * Recursively removes empty objects left behind after key deletion.
 * Returns true if the current object became empty and should also be removed.
 * @param obj - The locale object to clean
 */
function pruneEmptyObjects(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const isEmpty = pruneEmptyObjects(val as Record<string, unknown>);
      if (isEmpty) delete obj[key];
    }
  }
  return Object.keys(obj).length === 0;
}

/**
 * Serializes a locale object back to a TypeScript default export string.
 * Uses double-quoted strings (Biome will normalize formatting on the next lint run).
 * Preserves array values as-is for fields like `base_trigger_words`.
 * @param obj - The cleaned locale object
 * @param indent - Current indentation depth
 */
function serializeToTypeScript(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  const padInner = "  ".repeat(indent + 1);

  if (Array.isArray(obj)) {
    const items = obj.map((item) => JSON.stringify(item)).join(", ");
    return `[${items}]`;
  }

  if (typeof obj === "string") {
    // Use backtick template literals to match original style
    const escaped = obj.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    return `\`${escaped}\``;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }

  if (typeof obj === "object" && obj !== null) {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";

    const lines = entries.map(([k, v]) => {
      // Quote keys that contain non-identifier chars (e.g. "st-preset")
      // or start with a digit (e.g. "400_default_message") — bare identifiers otherwise
      const needsQuoting = /[^a-zA-Z0-9_]/.test(k) || /^[0-9]/.test(k);
      const key = needsQuoting ? `"${k}"` : k;
      return `${padInner}${key}: ${serializeToTypeScript(v, indent + 1)},`;
    });

    return `{\n${lines.join("\n")}\n${pad}}`;
  }

  return JSON.stringify(obj);
}

/**
 * Loads the list of unused keys using the same analysis logic as checkLocalizationKeys.ts.
 * Reuses the checker in-process so sandboxed runs do not depend on spawning Bun.
 */
async function loadUnusedKeys(): Promise<string[]> {
  log.info("Running locale analysis to identify unused keys…");
  const results = await analyzeLocalizationKeys();
  return results.unusedKeys.map(({ key }) => key);
}

/**
 * Main entry point — prunes unused keys from all locale files.
 * Pass `--dry-run` to preview without writing any files.
 */
async function main(): Promise<void> {
  const isDryRun = process.argv.includes("--dry-run");

  if (isDryRun) {
    log.info("DRY RUN — no files will be written");
  }

  // 1. Get the list of unused keys
  const unusedKeys = await loadUnusedKeys();
  log.info(`Found ${unusedKeys.length} unused keys to prune`);

  if (unusedKeys.length === 0) {
    log.success("Nothing to prune — locale files are already clean.");
    return;
  }

  // 2. Load all locale files
  const localesPath = join(process.cwd(), "src", "locales");
  const localeFiles: Array<{ name: string; path: string; obj: Record<string, unknown> }> = [];

  const glob = new Glob("*.ts");
  for await (const file of glob.scan(localesPath)) {
    const filePath = join(localesPath, file);
    const module = await import(filePath);
    localeFiles.push({
      name: file.replace(".ts", ""),
      path: filePath,
      obj: structuredClone(module.default) as Record<string, unknown>,
    });
  }

  log.info(`Loaded ${localeFiles.length} locale files: ${localeFiles.map((f) => f.name).join(", ")}`);

  // 3. Delete each unused key from all locale objects
  for (const key of unusedKeys) {
    for (const locale of localeFiles) {
      deletePath(locale.obj, key);
    }
  }

  // 4. Prune empty objects left behind
  for (const locale of localeFiles) {
    pruneEmptyObjects(locale.obj);
  }

  // 5. Count remaining keys for summary
  function countKeys(obj: unknown): number {
    if (typeof obj === "string" || Array.isArray(obj)) return 1;
    if (typeof obj === "object" && obj !== null) {
      return Object.values(obj as Record<string, unknown>).reduce((sum, v) => sum + countKeys(v), 0);
    }
    return 0;
  }

  // 6. Write cleaned locale files back (or preview in dry-run)
  for (const locale of localeFiles) {
    const serialized = `// locales/${locale.name}.ts\n\n// ${locale.name === "en-US" ? "Export the entire locale structure as a default object" : "ロケール構造全体をデフォルトオブジェクトとしてエクスポートします"}\nexport default ${serializeToTypeScript(locale.obj)};\n`;

    const remaining = countKeys(locale.obj);
    log.info(`${locale.name}: ${remaining} keys remaining after pruning ${unusedKeys.length} unused keys`);

    if (!isDryRun) {
      await writeFile(locale.path, serialized, "utf-8");
      log.success(`Written: ${locale.path}`);
    } else {
      log.info(`[DRY RUN] Would write ${locale.path}`);
    }
  }

  if (!isDryRun) {
    log.success(`Done! Pruned ${unusedKeys.length} unused keys from ${localeFiles.length} locale files.`);
    log.info("Run `bun run lint` to reformat the output files.");
  }
}

main().catch((err) => {
  log.error("Fatal error during locale pruning", err);
  process.exit(1);
});
