import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export type QueryKind = "READ" | "WRITE";

export interface QueryHit {
  file: string;
  line: number;
  query: string;
  kind: QueryKind;
}

export interface ExemptQueryHit extends QueryHit {
  reason: string;
}

export interface SqlAuditResult {
  violations: QueryHit[];
  exemptions: ExemptQueryHit[];
}

export const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

export const AUDIT_DIRS = ["src"] as const;

export const IGNORE_PATHS = [
  "src/utils/db/repositories",
  "src/utils/db/client.ts",
  "src/db/migrations",
  "src/db/client.ts",
  "src/db/migrationRunner.ts",
  "src/init/database.ts",
  "src/types/",
] as const;

// Feature modules keep SQL in per-module repositories so each module can be deleted cleanly without touching shared
// `src/utils/db/repositories/`.
export const MODULE_REPOSITORY_PATH_RE = /^src\/modules\/[^/]+\/db\/repositories(\.ts$|\/)/;

export const EXEMPT_PATHS = new Map<string, string>([
  ["src/utils/metrics/dbStats.ts", "observability/status helper"],
  ["src/utils/metrics/status/serverConfigPages.ts", "observability/status aggregation"],
  ["src/utils/misc/logger.ts", "logging infrastructure"],
  ["src/utils/security/crypto.ts", "security primitive"],
  ["src/utils/security/keyRotation.ts", "security primitive"],
  [
    "src/utils/security/encryptedColumns.ts",
    "encrypted credential inventory and atomic key rotation with secret-safe failures",
  ],
  ["src/utils/documents/documentService.ts", "RAG service layer; SQL invoked exclusively through RagRepository facade"],
  ["src/db/seed/catalog/presetAssetLock.ts", "catalog seeding concurrency lock"],
]);

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function toRepoRelative(absolutePath: string): string {
  return normalizePath(relative(REPO_ROOT, absolutePath));
}

export function classifyQuery(query: string): QueryKind {
  const upper = query.toUpperCase();
  // Whole-word match so column/identifier names that merely CONTAIN a keyword
  // (e.g. `updated_at` containing "UPDATE", `selected` containing "SELECT") do
  // not flip the classification.
  const hasKeyword = (keyword: string): boolean => new RegExp(`\\b${keyword}\\b`).test(upper);
  return hasKeyword("SELECT") && !hasKeyword("INSERT") && !hasKeyword("UPDATE") && !hasKeyword("DELETE")
    ? "READ"
    : "WRITE";
}

export function scanFileForSqlQueries(content: string): Array<{ line: number; query: string }> {
  const lines = content.split("\n");
  const hits: Array<{ line: number; query: string }> = [];

  let inQuery = false;
  let inBlockComment = false;
  let currentQuery = "";
  let queryStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (inBlockComment) {
      const blockEnd = line.indexOf("*/");
      if (blockEnd === -1) {
        continue;
      }
      inBlockComment = false;
      line = line.slice(blockEnd + 2);
    }

    const trimmedLine = line.trimStart();
    if (trimmedLine.startsWith("//")) {
      continue;
    }

    const blockStart = line.indexOf("/*");
    if (blockStart !== -1) {
      const blockEnd = line.indexOf("*/", blockStart + 2);
      if (blockEnd === -1) {
        inBlockComment = true;
        line = line.slice(0, blockStart);
      } else {
        line = `${line.slice(0, blockStart)}${line.slice(blockEnd + 2)}`;
      }
    }

    if (!inQuery) {
      // Detect the start of a `sql`/`tx` tagged template (optional `<T>` and
      //    `await`). The leading `\b` requires a word boundary so identifiers that
      //    merely END in "sql"/"tx" (e.g. `mysql`, `someSql`) are not false-flagged.
      //    The generic group uses `[^`]` (not `[^>]`) so NESTED generics such as
      //    `sql<Array<{ id: number }>>` are matched up to the backtick instead of
      //    stopping at the first inner `>`.
      const matchRegex = /(?:await\s+)?\b(?:sql|tx)(?:<[^`]+>)?\s*`/;
      const match = line.match(matchRegex);
      if (match) {
        queryStartLine = i + 1;
        const splitPoint = (match.index ?? 0) + match[0].length;
        const restOfLine = line.substring(splitPoint);
        if (restOfLine.includes("`")) {
          hits.push({ line: queryStartLine, query: restOfLine.split("`")[0].trim() });
        } else {
          inQuery = true;
          currentQuery = `${restOfLine}\n`;
        }
      }
    } else if (line.includes("`")) {
      inQuery = false;
      currentQuery += line.split("`")[0];
      hits.push({ line: queryStartLine, query: currentQuery.trim() });
      currentQuery = "";
    } else {
      currentQuery += `${line}\n`;
    }
  }

  return hits;
}

async function getFiles(dir: string): Promise<string[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = join(dir, dirent.name);
      return dirent.isDirectory() ? getFiles(res) : res;
    }),
  );
  return files.flat();
}

export async function auditRawSqlBoundary(): Promise<SqlAuditResult> {
  const candidateFiles: string[] = [];
  for (const dir of AUDIT_DIRS) {
    const absoluteDir = resolve(REPO_ROOT, dir);
    const all = await getFiles(absoluteDir);
    for (const absolute of all) {
      if (!absolute.endsWith(".ts")) continue;
      const relativePath = toRepoRelative(absolute);
      if (IGNORE_PATHS.some((ignore) => relativePath.includes(ignore))) continue;
      if (MODULE_REPOSITORY_PATH_RE.test(relativePath)) continue;
      candidateFiles.push(absolute);
    }
  }

  const violations: QueryHit[] = [];
  const exemptions: ExemptQueryHit[] = [];

  for (const absolute of candidateFiles) {
    const relativePath = toRepoRelative(absolute);
    const content = readFileSync(absolute, "utf8");
    for (const { line, query } of scanFileForSqlQueries(content)) {
      const kind = classifyQuery(query);
      const exemptReason = EXEMPT_PATHS.get(relativePath);
      if (exemptReason) {
        exemptions.push({ file: relativePath, line, query, kind, reason: exemptReason });
      } else {
        violations.push({ file: relativePath, line, query, kind });
      }
    }
  }

  // Stable ordering so callers (and snapshots) get deterministic output.
  const byLocation = (a: QueryHit, b: QueryHit) => a.file.localeCompare(b.file) || a.line - b.line;
  violations.sort(byLocation);
  exemptions.sort(byLocation);

  return { violations, exemptions };
}
