import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const directoriesToAudit = ["src/"];

const ignorePaths = [
  "src/utils/db/repositories",
  "src/utils/db/client.ts",
  "src/db/migrations",
  "src/db/client.ts",
  "src/db/migrationRunner.ts",
  "src/init/database.ts",
  "src/types/",
];

const exemptPaths = new Map<string, string>([
  ["src/utils/metrics/dbStats.ts", "observability/status helper"],
  ["src/utils/metrics/status/serverConfigPages.ts", "observability/status aggregation"],
  ["src/utils/misc/logger.ts", "logging infrastructure"],
  ["src/utils/security/crypto.ts", "security primitive"],
  ["src/utils/security/keyRotation.ts", "security primitive"],
  ["src/utils/documents/documentService.ts", "RAG service layer; SQL invoked exclusively through RagRepository facade"],
]);

type QueryHit = {
  file: string;
  line: number;
  query: string;
};

type ExemptQueryHit = QueryHit & {
  kind: "READ" | "WRITE";
  reason: string;
};

// normalize a path to posix for comparison
function normalizePath(p: string) {
  return p.replace(/\\/g, "/");
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

async function run() {
  const allFiles = [];
  for (const dir of directoriesToAudit) {
    allFiles.push(...(await getFiles(dir)));
  }

  const tsFiles = allFiles.filter((f) => {
    if (!f.endsWith(".ts")) return false;
    const normalized = normalizePath(f);
    return !ignorePaths.some((ignore) => normalized.includes(ignore));
  });

  const reads: QueryHit[] = [];
  const writes: QueryHit[] = [];
  const exemptions: ExemptQueryHit[] = [];

  for (const file of tsFiles) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
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
        // Match `sql` or `tx` with optional `<type>` and backtick, with or without await.
        // The `tx` alternative catches transaction blocks written as `tx\`` inside
        // sql.begin(async tx => ...) / sql.transaction(async tx => ...) callbacks.
        const matchRegex = /(?:await\s+)?(?:sql|tx)(?:<[^>]+>)?\s*`/;
        const match = line.match(matchRegex);
        if (match) {
          inQuery = true;
          queryStartLine = i + 1;
          const splitPoint = match.index! + match[0].length;
          const restOfLine = line.substring(splitPoint);
          if (restOfLine.includes("`")) {
            inQuery = false;
            currentQuery = restOfLine.split("`")[0];
            processQuery(file, queryStartLine, currentQuery);
            currentQuery = "";
          } else {
            currentQuery = restOfLine + "\n";
          }
        }
      } else {
        if (line.includes("`")) {
          inQuery = false;
          currentQuery += line.split("`")[0];
          processQuery(file, queryStartLine, currentQuery);
          currentQuery = "";
        } else {
          currentQuery += line + "\n";
        }
      }
    }
  }

  function processQuery(file: string, line: number, query: string) {
    const normalizedFile = normalizePath(file);
    const upperQuery = query.toUpperCase();
    const kind =
      upperQuery.includes("SELECT") &&
      !upperQuery.includes("INSERT") &&
      !upperQuery.includes("UPDATE") &&
      !upperQuery.includes("DELETE")
        ? "READ"
        : "WRITE";

    const exemptReason = exemptPaths.get(normalizedFile);
    if (exemptReason) {
      exemptions.push({ file, line, query: query.trim(), kind, reason: exemptReason });
      return;
    }

    if (kind === "READ") {
      reads.push({ file, line, query: query.trim() });
    } else {
      writes.push({ file, line, query: query.trim() });
    }
  }

  console.log("=== WRITES ===");
  writes.forEach((w) => console.log(`${normalizePath(w.file)}:${w.line}`));
  console.log("\n=== READS ===");
  reads.forEach((r) => console.log(`${normalizePath(r.file)}:${r.line}`));
  console.log("\n=== EXEMPTIONS ===");
  exemptions.forEach((e) => console.log(`exempt: ${normalizePath(e.file)}:${e.line} (${e.kind}; ${e.reason})`));
}

run().catch(console.error);
