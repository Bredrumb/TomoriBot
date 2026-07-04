import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

interface RawLine {
  kind: "raw";
  text: string;
}

interface EntryLine {
  kind: "entry";
  key: string;
  value: string;
  quote?: "\"" | "'";
  exportPrefix: boolean;
}

type EnvLine = RawLine | EntryLine;

export interface EnvFile {
  path: string;
  lines: EnvLine[];
  trailingNewline: boolean;
}

export interface UpsertOptions {
  overwrite?: boolean;
}

const ENTRY_PATTERN = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function parseValue(rawValue: string): { value: string; quote?: "\"" | "'" } {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const quote = trimmed[0] as "\"" | "'";
    const inner = trimmed.slice(1, -1);
    return {
      value: quote === "\"" ? inner.replace(/\\"/g, "\"") : inner.replace(/\\'/g, "'"),
      quote,
    };
  }
  return { value: trimmed };
}

function parseLine(text: string): EnvLine {
  const match = text.match(ENTRY_PATTERN);
  if (!match) {
    return { kind: "raw", text };
  }

  const [, , exportPrefix, key, rawValue] = match;
  const parsed = parseValue(rawValue);
  return {
    kind: "entry",
    key,
    value: parsed.value,
    quote: parsed.quote,
    exportPrefix: Boolean(exportPrefix),
  };
}

function formatValue(value: string, quote?: "\"" | "'"): string {
  const needsQuotes = quote || /\s|#/.test(value);
  if (!needsQuotes) {
    return value;
  }
  const selectedQuote = quote ?? "\"";
  if (selectedQuote === "'") {
    return `'${value.replace(/'/g, "\\'")}'`;
  }
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function formatLine(line: EnvLine): string {
  if (line.kind === "raw") {
    return line.text;
  }
  const prefix = line.exportPrefix ? "export " : "";
  return `${prefix}${line.key}=${formatValue(line.value, line.quote)}`;
}

function normalizePlaceholderValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").toLowerCase();
}

export function isPlaceholder(value: string | undefined): boolean {
  if (value === undefined) return true;
  const normalized = normalizePlaceholderValue(value);
  if (normalized.length === 0) return true;
  return (
    normalized.startsWith("your_") ||
    normalized.endsWith("_here") ||
    normalized.includes("changeme") ||
    normalized.includes("change_me") ||
    normalized.includes("replace_me") ||
    normalized === "todo"
  );
}

export function loadEnvFile(path: string): EnvFile {
  if (!existsSync(path)) {
    return {
      path,
      lines: [],
      trailingNewline: true,
    };
  }

  const content = readFileSync(path, "utf-8");
  const trailingNewline = content.endsWith("\n");
  const trimmedContent = trailingNewline ? content.slice(0, -1).replace(/\r$/, "") : content;
  const lines = trimmedContent.length === 0 ? [] : trimmedContent.split(/\r?\n/).map(parseLine);
  return { path, lines, trailingNewline };
}

export function readEnvValues(path: string): Record<string, string> {
  const envFile = loadEnvFile(path);
  const values: Record<string, string> = {};
  for (const line of envFile.lines) {
    if (line.kind === "entry") {
      values[line.key] = line.value;
    }
  }
  return values;
}

export function seedFromExample(examplePath: string, destPath: string): boolean {
  if (existsSync(destPath)) {
    return false;
  }
  copyFileSync(examplePath, destPath);
  return true;
}

export function writeEnvFile(envFile: EnvFile): void {
  const content = envFile.lines.map(formatLine).join("\n") + (envFile.trailingNewline ? "\n" : "");
  writeFileSync(envFile.path, content);
}

export function upsertEnvKeys(path: string, values: Record<string, string>, options: UpsertOptions = {}): void {
  const envFile = loadEnvFile(path);
  const overwrite = options.overwrite ?? false;

  for (const [key, value] of Object.entries(values)) {
    const existingLine = envFile.lines.find((line): line is EntryLine => line.kind === "entry" && line.key === key);
    if (existingLine) {
      if (overwrite || isPlaceholder(existingLine.value)) {
        existingLine.value = value;
      }
      continue;
    }
    envFile.lines.push({
      kind: "entry",
      key,
      value,
      exportPrefix: false,
    });
  }

  writeEnvFile(envFile);
}
