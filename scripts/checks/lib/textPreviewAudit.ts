import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Glob } from "bun";

export const REQUIRED_HELPER = "buildTextPreview";

export const SAFE_PREVIEW_WRAPPERS = ["renderMemorySaveNoticeContent"] as const;

// `ja` is audited alongside `en-US` because `check-locales` enforces key parity rather than content, so a `ja`-only
// baked ellipsis would otherwise pass.
export const AUDITED_LOCALES = ["en-US", "ja"] as const;

// Frozen legacy backlog so the guard blocks new violations while existing ones stay visible: remove keys as migrated,
// and never add new entries.
export const KNOWN_UNGUARDED = new Set([
  "commands.persona.image-tags.success_description",
  "commands.novelai.generate.image.error_description",
]);

export const TEXT_PREVIEW_REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

const FENCED_PLACEHOLDER = /```[\s\S]*?\{[a-zA-Z_][a-zA-Z0-9_]*\}[\s\S]*?```/;
const BAKED_ELLIPSIS = /\{[a-zA-Z_][a-zA-Z0-9_]*\}(\.\.\.|…)/g;

export type TextPreviewViolationKind = "baked-ellipsis" | "unguarded-fenced-placeholder";

export interface TextPreviewViolation {
  kind: TextPreviewViolationKind;
  key: string;
  detail: string;
}

export interface TextPreviewAuditResult {
  violations: TextPreviewViolation[];
  scannedFiles: number;
}

export function scanBakedEllipsis(key: string, value: string, locale = "en-US"): TextPreviewViolation[] {
  const violations: TextPreviewViolation[] = [];
  // matchAll on a /g regex is stateless per call, so no lastIndex reset needed.
  for (const match of value.matchAll(BAKED_ELLIPSIS)) {
    violations.push({
      kind: "baked-ellipsis",
      key: `[${locale}] ${key}`,
      detail: `renders "${match[0]}" even when nothing was truncated`,
    });
  }
  return violations;
}

export function hasFencedPlaceholder(value: string): boolean {
  return FENCED_PLACEHOLDER.test(value);
}

// Keys with no static consumer are skipped because dynamic key construction (such as `embed${n}_description`) cannot
// be resolved without false positives.
export function scanFencedPlaceholderUsage(
  key: string,
  value: string,
  sources: Map<string, string>,
): TextPreviewViolation[] {
  if (!hasFencedPlaceholder(value)) return [];
  if (KNOWN_UNGUARDED.has(key)) return [];

  const consumers = [...sources].filter(([, content]) => content.includes(key));
  if (consumers.length === 0) return [];

  return consumers
    .filter(
      ([, content]) =>
        !content.includes(REQUIRED_HELPER) && !SAFE_PREVIEW_WRAPPERS.some((wrapper) => content.includes(wrapper)),
    )
    .map(([file]) => ({
      kind: "unguarded-fenced-placeholder" as const,
      key,
      detail: `consumed by ${file} without ${REQUIRED_HELPER}`,
    }));
}

async function loadLocale(locale: string): Promise<Record<string, unknown>> {
  const localeDir = join(TEXT_PREVIEW_REPO_ROOT, "src/locales", locale);
  const files = (await readdir(localeDir)).filter((file) => file.endsWith(".ts"));

  let merged: Record<string, unknown> = {};
  for (const file of files) {
    const module = await import(join(localeDir, file));
    merged = { ...merged, ...(module.default ?? module) };
  }
  return merged;
}

export function flattenLocale(node: unknown, path: string[], out: Map<string, string>): void {
  if (typeof node === "string") {
    out.set(path.join("."), node);
    return;
  }
  if (node && typeof node === "object") {
    for (const [segment, child] of Object.entries(node)) flattenLocale(child, [...path, segment], out);
  }
}

export async function auditTextPreview(): Promise<TextPreviewAuditResult> {
  const violations: TextPreviewViolation[] = [];

  // Read locales concurrently because this runs in `bun run vl`'s shared unit lane, where serial I/O hits the critical
  // path.
  const loaded = await Promise.all(AUDITED_LOCALES.map(async (locale) => [locale, await loadLocale(locale)] as const));
  const perLocale = new Map<string, Map<string, string>>();
  for (const [locale, tree] of loaded) {
    const flat = new Map<string, string>();
    flattenLocale(tree, [], flat);
    perLocale.set(locale, flat);
  }

  // Rule 1 runs per locale, so a translation must not reintroduce it alone.
  for (const [locale, flat] of perLocale) {
    for (const [key, value] of flat) violations.push(...scanBakedEllipsis(key, value, locale));
  }

  const sourceFiles = (await Array.fromAsync(new Glob("src/**/*.ts").scan(TEXT_PREVIEW_REPO_ROOT))).filter(
    (file) => !file.replaceAll("\\", "/").includes("src/locales/"),
  );
  // Read source files concurrently because serializing every file read across src/ dominates this audit.
  const sources = new Map<string, string>(
    await Promise.all(
      sourceFiles.map(
        async (file) => [file, await readFile(join(TEXT_PREVIEW_REPO_ROOT, file), "utf-8")] as [string, string],
      ),
    ),
  );

  // Rule 2 is structural, so the reference locale alone drives it.
  const reference = perLocale.get(AUDITED_LOCALES[0]) ?? new Map<string, string>();
  for (const [key, value] of reference) violations.push(...scanFencedPlaceholderUsage(key, value, sources));

  return { violations, scannedFiles: sources.size };
}
