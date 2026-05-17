import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const directoriesToAudit = ["src/"];

const ignorePaths = [
  "src/utils/db/repositories",
  "src/db/migrations",
  "src/db/client.ts",
  "src/db/migrationRunner.ts",
  "src/init/database.ts",
  "src/types/",
];

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

  const reads: { file: string; line: number; query: string }[] = [];
  const writes: { file: string; line: number; query: string }[] = [];

  for (const file of tsFiles) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    let inQuery = false;
    let currentQuery = "";
    let queryStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!inQuery) {
        // Match `sql` with optional `<type>` and backtick, with or without await
        const matchRegex = /(?:await\s+)?sql(?:<[^>]+>)?\s*`/;
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
    const upperQuery = query.toUpperCase();
    if (
      upperQuery.includes("SELECT") &&
      !upperQuery.includes("INSERT") &&
      !upperQuery.includes("UPDATE") &&
      !upperQuery.includes("DELETE")
    ) {
      reads.push({ file, line, query: query.trim() });
    } else {
      writes.push({ file, line, query: query.trim() });
    }
  }

  console.log("=== WRITES ===");
  writes.forEach((w) => console.log(`${normalizePath(w.file)}:${w.line}`));
  console.log("\n=== READS ===");
  reads.forEach((r) => console.log(`${normalizePath(r.file)}:${r.line}`));
}

run().catch(console.error);
