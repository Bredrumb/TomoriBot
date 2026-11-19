import { join, relative } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { Glob } from "bun";
import { analyzeLocalizationKeys } from "../checks/checkLocalizationKeys";

const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`❌ ${msg}`, err ? `| ${err}` : ""),
  success: (msg: string) => console.log(`✅ ${msg}`),
};

function isAssembler(content: string): boolean {
  return /import\s+\w+\s+from\s+['"]\./.test(content);
}

function deletePath(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== "object" || current[part] === null) return false;
    current = current[part] as Record<string, unknown>;
  }

  const leaf = parts[parts.length - 1];
  if (!(leaf in current)) return false;
  delete current[leaf];
  return true;
}

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

function serializeToTypeScript(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  const padInner = "  ".repeat(indent + 1);

  if (Array.isArray(obj)) {
    const items = obj.map((item) => JSON.stringify(item)).join(", ");
    return `[${items}]`;
  }

  if (typeof obj === "string") {
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
      const needsQuoting = /[^a-zA-Z0-9_]/.test(k) || /^[0-9]/.test(k);
      const key = needsQuoting ? `"${k}"` : k;
      return `${padInner}${key}: ${serializeToTypeScript(v, indent + 1)},`;
    });

    return `{\n${lines.join("\n")}\n${pad}}`;
  }

  return JSON.stringify(obj);
}

interface LocaleSlice {
  filePath: string;
  relPath: string;
  keyPrefix: string;
  obj: Record<string, unknown>;
}

async function loadLocaleSlices(): Promise<LocaleSlice[]> {
  const slices: LocaleSlice[] = [];
  const localesPath = join(process.cwd(), "src", "locales");
  const glob = new Glob("**/*.ts");

  for await (const file of glob.scan(localesPath)) {
    const filePath = join(localesPath, file);
    const content = await readFile(filePath, "utf-8");

    if (isAssembler(content)) continue;

    const module = await import(filePath);
    const obj = structuredClone(module.default) as Record<string, unknown>;

    const relPath = relative(localesPath, filePath).replace(/\\/g, "/");
    const segments = relPath.split("/");

    const keyPrefix = segments.length > 2 ? segments[1] : "";

    slices.push({ filePath, relPath, keyPrefix, obj });
  }

  return slices;
}

// The allowlist is load-bearing because the static scanner misses dynamic keys (joined-string roots, cross-function
// plumbing, template property access).
async function loadAllowlist(): Promise<{ preservedPrefixes: string[]; preservedKeys: Set<string> }> {
  const allowlistPath = join(process.cwd(), "scripts", "devtools", "locale-prune-allowlist.json");
  try {
    const raw = await readFile(allowlistPath, "utf-8");
    const parsed = JSON.parse(raw) as { preservedPrefixes?: string[]; preservedKeys?: string[] };
    return {
      preservedPrefixes: parsed.preservedPrefixes ?? [],
      preservedKeys: new Set(parsed.preservedKeys ?? []),
    };
  } catch {
    log.warn(`No allowlist found at ${allowlistPath} — pruning without safety net.`);
    return { preservedPrefixes: [], preservedKeys: new Set() };
  }
}

function isAllowlisted(key: string, allowlist: { preservedPrefixes: string[]; preservedKeys: Set<string> }): boolean {
  if (allowlist.preservedKeys.has(key)) return true;
  for (const prefix of allowlist.preservedPrefixes) {
    if (key === prefix || key.startsWith(`${prefix}.`)) return true;
  }
  return false;
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes("--dry-run");

  if (isDryRun) {
    log.info("DRY RUN — no files will be written");
  }

  log.info("Running locale analysis to identify unused keys…");
  const results = await analyzeLocalizationKeys();
  const allowlist = await loadAllowlist();
  const allUnusedKeys = results.unusedKeys.map(({ key }) => key);
  const unusedKeys = allUnusedKeys.filter((key) => !isAllowlisted(key, allowlist));
  const skippedCount = allUnusedKeys.length - unusedKeys.length;

  log.info(
    `Found ${allUnusedKeys.length} unused keys total; ${skippedCount} protected by allowlist; ${unusedKeys.length} eligible to prune`,
  );

  if (unusedKeys.length === 0) {
    log.success("Nothing to prune — locale files are already clean (or fully allowlisted).");
    return;
  }

  const slices = await loadLocaleSlices();
  log.info(`Loaded ${slices.length} leaf slice files`);

  const modifiedSlices = new Set<number>();

  for (const key of unusedKeys) {
    let deleted = false;

    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      let subPath: string;

      if (slice.keyPrefix === "") {
        subPath = key;
      } else {
        if (!key.startsWith(`${slice.keyPrefix}.`)) continue;
        subPath = key.slice(slice.keyPrefix.length + 1);
      }

      if (deletePath(slice.obj, subPath)) {
        modifiedSlices.add(i);
        deleted = true;
      }
    }

    if (!deleted) {
      log.warn(`Key not found in any slice (already pruned or dynamically generated?): ${key}`);
    }
  }

  for (const i of modifiedSlices) {
    pruneEmptyObjects(slices[i].obj);
  }

  for (const i of modifiedSlices) {
    const slice = slices[i];
    const serialized = `// locales/${slice.relPath}\n\nexport default ${serializeToTypeScript(slice.obj)};\n`;

    if (!isDryRun) {
      await writeFile(slice.filePath, serialized, "utf-8");
      log.success(`Updated: ${slice.relPath}`);
    } else {
      log.info(`[DRY RUN] Would update: ${slice.relPath}`);
    }
  }

  const verb = isDryRun ? "Would prune" : "Pruned";
  log.success(`${verb} ${unusedKeys.length} unused keys across ${modifiedSlices.size} files.`);
  if (!isDryRun) {
    log.info("Run `bun run lint` to reformat the output files.");
  }
}

main().catch((err) => {
  log.error("Fatal error during locale pruning", err);
  process.exit(1);
});
