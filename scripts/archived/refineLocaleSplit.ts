/**
 * Refines the locale category split in two ways:
 *
 * Task 1 — Split commands.ts:
 *   Reads each locale's commands.ts, writes one sub-file per top-level key under
 *   commands/ subdirectory, then rewrites commands.ts as a thin assembler that
 *   imports the sub-files. The localizer's *.ts glob picks up commands.ts only;
 *   the sub-files are internal imports resolved at runtime.
 *
 * Task 2 — Move tool-activity keys from genai.* to tools.*:
 *   Extracts search, mcp, tool_notice, video, document, image, vision, gif, fetch
 *   from providers.ts and appends them to tools.ts under the same key names.
 *   Then bulk-replaces all "genai.<key>." call-site references in src/ with
 *   "tools.<key>." so the runtime localizer paths stay valid.
 *
 * Run with: bun run scripts/maintenance/refineLocaleSplit.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Glob } from "bun";


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


const LOCALES = ["en-US", "ja"];

/** Keys under genai.* that belong semantically with tools, not providers. */
const TOOL_ACTIVITY_KEYS = ["search", "mcp", "tool_notice", "video", "document", "image", "vision", "gif", "fetch"];


/** Converts a hyphenated key like "st-preset" to a valid JS identifier "stPreset". */
function toVarName(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Returns the quoted form of a key when it is not a bare identifier. */
function quoteKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `"${key}"`;
}


async function splitCommandsLocale(locale: string): Promise<void> {
  console.log(`\n  [${locale}] Splitting commands.ts…`);

  const localeDir = resolve("src", "locales", locale);
  const commandsDir = join(localeDir, "commands");
  await mkdir(commandsDir, { recursive: true });

  // Dynamic import gives us the live runtime object with template-literal strings resolved
  const mod = await import(join(localeDir, "commands.ts"));
  const commandsObj = (mod.default as Record<string, unknown>).commands as Record<string, unknown>;

  const keys = Object.keys(commandsObj);

  for (const key of keys) {
    const content = [
      `// locales/${locale}/commands/${key}.ts`,
      ``,
      `export default {`,
      `  ${quoteKey(key)}: ${serializeToTS(commandsObj[key], 1)},`,
      `};`,
      ``,
    ].join("\n");

    await writeFile(join(commandsDir, `${key}.ts`), content, "utf-8");
    console.log(`    ✓  commands/${key}.ts`);
  }

  const importLines = keys.map((k) => `import ${toVarName(k)} from "./commands/${k}";`);
  const spreadLines = keys.map((k) => `    ...${toVarName(k)},`);

  const assembler = [
    `// locales/${locale}/commands.ts`,
    `// Assembler — edit the individual files in commands/ instead.`,
    ``,
    importLines.join("\n"),
    ``,
    `export default {`,
    `  commands: {`,
    spreadLines.join("\n"),
    `  },`,
    `};`,
    ``,
  ].join("\n");

  await writeFile(join(localeDir, "commands.ts"), assembler, "utf-8");
  console.log(`    ✓  commands.ts (assembler)`);
}


async function moveToolActivityKeys(locale: string): Promise<void> {
  console.log(`\n  [${locale}] Moving tool-activity keys: genai → tools…`);

  const localeDir = resolve("src", "locales", locale);

  const providersMod = await import(join(localeDir, "providers.ts"));
  const genai = { ...((providersMod.default as Record<string, unknown>).genai as Record<string, unknown>) };

  const toolsMod = await import(join(localeDir, "tools.ts"));
  const tools = { ...((toolsMod.default as Record<string, unknown>).tools as Record<string, unknown>) };

  for (const key of TOOL_ACTIVITY_KEYS) {
    if (key in genai) {
      tools[key] = genai[key];
      delete genai[key];
      console.log(`    ✓  genai.${key} → tools.${key}`);
    } else {
      console.warn(`    ⚠  genai.${key} not found in ${locale}/providers.ts — skipping`);
    }
  }

  const providersContent = [
    `// locales/${locale}/providers.ts`,
    ``,
    `export default {`,
    `  genai: ${serializeToTS(genai, 1)},`,
    `};`,
    ``,
  ].join("\n");
  await writeFile(join(localeDir, "providers.ts"), providersContent, "utf-8");
  console.log(`    ✓  providers.ts updated`);

  const toolsContent = [
    `// locales/${locale}/tools.ts`,
    ``,
    `export default {`,
    `  tools: ${serializeToTS(tools, 1)},`,
    `};`,
    ``,
  ].join("\n");
  await writeFile(join(localeDir, "tools.ts"), toolsContent, "utf-8");
  console.log(`    ✓  tools.ts updated`);
}


async function updateCallSites(): Promise<void> {
  console.log("\n  Updating call-site references in src/…");

  // Build find→replace pairs for all quote styles the localizer key might appear in
  const replacements: Array<[string, string]> = [];
  for (const key of TOOL_ACTIVITY_KEYS) {
    for (const q of ['"', "'", "`"]) {
      replacements.push([`${q}genai.${key}.`, `${q}tools.${key}.`]);
    }
  }

  const srcDir = resolve("src");
  let updatedCount = 0;

  for await (const relPath of new Glob("**/*.ts").scan({ cwd: srcDir, onlyFiles: true })) {
    const filePath = join(srcDir, relPath);
    let content = await readFile(filePath, "utf-8");
    let changed = false;

    for (const [from, to] of replacements) {
      if (content.includes(from)) {
        content = content.split(from).join(to);
        changed = true;
      }
    }

    if (changed) {
      await writeFile(filePath, content, "utf-8");
      console.log(`    ✓  ${relPath}`);
      updatedCount++;
    }
  }

  console.log(`  → ${updatedCount} file(s) updated`);
}


console.log("=== refineLocaleSplit.ts ===\n");

console.log("Task 1: Split commands.ts → commands/ sub-files");
for (const locale of LOCALES) {
  await splitCommandsLocale(locale);
}

console.log("\nTask 2: Move tool-activity keys (genai → tools)");
for (const locale of LOCALES) {
  await moveToolActivityKeys(locale);
}

console.log("\nTask 3: Update call-site references");
await updateCallSites();

console.log("\n=== Done ===");
console.log("Verify with: bun run check && bun run lint && bun run check-locales");
