import { SQL } from "bun";
import { createHash } from "node:crypto";
import { appendFile, lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";

const MAX_SQL_BYTES = 64 * 1024;

function statementsForMaintenance(source: string): string[] {
  if (Buffer.byteLength(source) > MAX_SQL_BYTES) throw new Error("SQL file exceeds the size limit");
  const statements = splitSqlStatements(source);
  if (statements.length === 0) throw new Error("SQL file is empty");
  for (const statement of statements) {
    const command = statement.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/u, "");
    if (/^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|PREPARE\s+TRANSACTION)\b/iu.test(command)) {
      throw new Error("The workflow owns the transaction; omit transaction control from the SQL file");
    }
  }
  return statements;
}

export async function executeMaintenanceSql(client: SQL, source: string): Promise<number> {
  const statements = statementsForMaintenance(source);
  await client.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SET LOCAL statement_timeout = '30s'`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '60s'`;
    for (const statement of statements) await tx.unsafe(statement);
  });
  return statements.length;
}

async function prepare(): Promise<void> {
  const file = process.env.SQL_PATH ?? "";
  if (!/^deploy\/azure\/maintenance\/[a-z0-9][a-z0-9_-]*\.sql$/u.test(file)) {
    throw new Error("Select a committed SQL file under deploy/azure/maintenance");
  }
  if (!(await lstat(file)).isFile() || (await realpath(file)) !== path.resolve(file)) {
    throw new Error("SQL file must be a regular file without symlinks");
  }
  const tracked = Bun.spawn(["git", "cat-file", "-e", `HEAD:${file}`], { stdout: "ignore", stderr: "ignore" });
  if ((await tracked.exited) !== 0) throw new Error("SQL file must be committed");
  const source = await readFile(file, "utf8");
  const statements = statementsForMaintenance(source);
  const sha = createHash("sha256").update(source).digest("hex");
  const mode = process.env.SQL_MODE;
  if (mode !== "preview" && mode !== "execute") throw new Error("Invalid SQL mode");
  if (mode === "execute") {
    if (
      !/^[0-9a-f]{40}$/u.test(process.env.MAINTENANCE_COMMIT ?? "") ||
      process.env.MAINTENANCE_COMMIT !== process.env.GITHUB_SHA
    ) {
      throw new Error("The release commit must match the reviewed preview");
    }
    if (!/^[0-9a-f]{64}$/u.test(process.env.SQL_SHA256 ?? "") || process.env.SQL_SHA256 !== sha) {
      throw new Error("SQL hash does not match the reviewed file");
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(process.env.EXPECTED_IMAGE_DIGEST ?? "")) {
      throw new Error("An expected running image digest is required");
    }
    if (process.env.CREATE_DB_BACKUP !== "true") throw new Error("Execution requires create_db_backup=true");
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `sql_b64=${Buffer.from(source).toString("base64")}\nsql_sha256=${sha}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### SQL maintenance ${mode}\n\nCommit: \`${process.env.GITHUB_SHA}\`\n\nFile: \`${file}\`\n\nSHA-256: \`${sha}\`\n\nStatements: ${statements.length}\n`,
    );
  }
  console.log(
    JSON.stringify({ mode, commit: process.env.GITHUB_SHA, file, sha256: sha, statements: statements.length }),
  );
}

async function execute(): Promise<void> {
  const source = await readFile("/run/maintenance/query.sql", "utf8");
  if (createHash("sha256").update(source).digest("hex") !== process.env.SQL_SHA256) {
    throw new Error("SQL hash mismatch");
  }
  const secret: Record<string, unknown> = await Bun.file("/run/maintenance/connection.json").json();
  for (const key of ["POSTGRES_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) {
    if (typeof secret[key] !== "string" || !secret[key]) throw new Error("Invalid database credential bundle");
  }
  const port = Number(secret.POSTGRES_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid database port");
  const client = new SQL({
    hostname: secret.POSTGRES_HOST as string,
    port,
    username: secret.POSTGRES_USER as string,
    password: secret.POSTGRES_PASSWORD as string,
    database: secret.POSTGRES_DB as string,
    tls: { rejectUnauthorized: true },
    max: 1,
    idleTimeout: 0,
    connectionTimeout: 10,
  });
  try {
    const count = await executeMaintenanceSql(client, source);
    console.log(JSON.stringify({ status: "committed", statements: count, sha256: process.env.SQL_SHA256 }));
  } finally {
    await client.close();
  }
}

if (import.meta.main) {
  try {
    if (process.argv[2] === "prepare") await prepare();
    else if (process.argv[2] === "execute") await execute();
    else throw new Error("Invalid maintenance command");
  } catch (error) {
    if (process.argv[2] === "prepare") console.error(error instanceof Error ? error.message : "Invalid SQL request");
    const code = error && typeof error === "object" && "errno" in error ? String(error.errno) : "";
    console.error(JSON.stringify({ status: "failed", sqlstate: /^[0-9A-Z]{5}$/u.test(code) ? code : undefined }));
    process.exitCode = 1;
  }
}
