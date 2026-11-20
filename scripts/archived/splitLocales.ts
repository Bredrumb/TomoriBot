/**
 * One-time script to split the monolithic locale files into category-based directories.
 * Run with: bun run scripts/maintenance/splitLocales.ts
 * After verifying output, delete src/locales/en-US.ts and src/locales/ja.ts.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Maps category file name → the top-level locale keys it will contain. */
const CATEGORY_MAPPING: Record<string, string[]> = {
  general: ["general", "rate_limit", "events", "reminders"],
  commands: ["commands"],
  providers: ["genai"],
  tools: ["tools"],
  bridges: ["matrix"],
};

/**
 * Serializes a JavaScript value to a TypeScript source string using template literals
 * for strings and proper indentation for objects. Handles nested objects, arrays,
 * and special characters (backticks, `${`) that need escaping inside template literals.
 */
function serializeToTS(value: unknown, depth = 0): string {
  const childIndent = "  ".repeat(depth + 1);
  const closingIndent = "  ".repeat(depth);

  if (typeof value === "string") {
    const escaped = value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    return `\`${escaped}\``;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => serializeToTS(v, depth));
    return `[${items.join(", ")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([k, v]) => {
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : `"${k}"`;
      return `${childIndent}${key}: ${serializeToTS(v, depth + 1)}`;
    });
    return `{\n${lines.join(",\n")},\n${closingIndent}}`;
  }

  return String(value);
}

async function writeCategoryFile(
  locale: string,
  category: string,
  localeRoot: Record<string, unknown>,
  keys: string[],
): Promise<void> {
  const dir = resolve("src", "locales", locale);
  await mkdir(dir, { recursive: true });

  const presentKeys = keys.filter((k) => k in localeRoot);
  if (presentKeys.length === 0) {
    console.warn(`  ⚠  No keys found for category "${category}" in locale "${locale}" — skipping`);
    return;
  }

  const entries = presentKeys.map((k) => `  ${k}: ${serializeToTS(localeRoot[k], 1)}`);
  const content = `// locales/${locale}/${category}.ts\n\nexport default {\n${entries.join(",\n")},\n};\n`;

  const outputPath = resolve(dir, `${category}.ts`);
  await writeFile(outputPath, content, "utf-8");
  console.log(`  ✓  Wrote ${outputPath.replace(resolve("."), "")}`);
}

const LOCALE_FILES: Record<string, string> = {
  "en-US": resolve("src", "locales", "en-US.ts"),
  ja: resolve("src", "locales", "ja.ts"),
};

console.log("Splitting locale files into category directories...\n");

for (const [locale, filePath] of Object.entries(LOCALE_FILES)) {
  console.log(`Processing locale: ${locale}`);
  const module = await import(filePath);
  const localeRoot = module.default as Record<string, unknown>;

  for (const [category, keys] of Object.entries(CATEGORY_MAPPING)) {
    await writeCategoryFile(locale, category, localeRoot, keys);
  }

  console.log();
}

console.log("Done! Verify the output in src/locales/{en-US,ja}/, then:");
console.log("  1. Delete src/locales/en-US.ts");
console.log("  2. Delete src/locales/ja.ts");
