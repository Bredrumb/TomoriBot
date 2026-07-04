/**
 * Rewrites stored public asset URL prefixes during object-storage cutovers.
 *
 * Usage:
 *   bun run scripts/devtools/migrateAssetUrls.ts --from https://old.example --to https://assets.example --dry-run
 *   bun run scripts/devtools/migrateAssetUrls.ts --from https://old.example --to https://assets.example
 */

import { sql } from "bun";
import { config } from "dotenv";

type AssetColumnTarget = {
  table: string;
  column: string;
};

type CountRow = {
  count: number | string;
};

const ASSET_COLUMN_TARGETS: AssetColumnTarget[] = [
  { table: "personas", column: "webhook_avatar_url" },
  { table: "persona_sprites", column: "avatar_url" },
  { table: "preset_sprites", column: "avatar_url" },
  { table: "persona_presets", column: "preset_avatar_shared_url" },
  { table: "voice_samples", column: "file_path" },
  { table: "persona_imagegen_configs", column: "nai_char_ref_url" },
  { table: "user_personalization_configs", column: "nai_char_ref_url" },
];

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1]?.trim();
  return value && !value.startsWith("--") ? value : null;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  bun run scripts/devtools/migrateAssetUrls.ts --from <urlPrefix> --to <urlPrefix> [--dry-run]");
  console.log();
  console.log("Rewrites stored asset URL prefixes in persona avatars, sprites, preset avatars,");
  console.log("voice samples, and NovelAI character reference columns.");
}

function configureDatabaseUrl(): void {
  if (process.env.DATABASE_URL) {
    return;
  }

  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    throw new Error("POSTGRES_PASSWORD or DATABASE_URL is required");
  }

  process.env.DATABASE_URL = `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function parseArgs(): { fromPrefix: string; toPrefix: string; dryRun: boolean } {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const fromPrefix = getArgValue("--from");
  const toPrefix = getArgValue("--to");
  const dryRun = process.argv.includes("--dry-run");

  if (!fromPrefix || !toPrefix) {
    printUsage();
    throw new Error("--from and --to are required");
  }

  if (fromPrefix === toPrefix) {
    throw new Error("--from and --to must be different prefixes");
  }

  return { fromPrefix, toPrefix, dryRun };
}

async function countMatchingRows(target: AssetColumnTarget, fromPrefix: string): Promise<number> {
  const rows = await sql<CountRow[]>`
    SELECT COUNT(*)::INT AS count
    FROM ${sql(target.table)}
    WHERE ${sql(target.column)} IS NOT NULL
      AND left(${sql(target.column)}, length(${fromPrefix})) = ${fromPrefix}
  `;

  return Number(rows[0]?.count ?? 0);
}

async function rewriteMatchingRows(
  target: AssetColumnTarget,
  fromPrefix: string,
  toPrefix: string,
): Promise<number> {
  const rows = await sql<Array<Record<string, never>>>`
    UPDATE ${sql(target.table)}
    SET ${sql(target.column)} = ${toPrefix} || substring(${sql(target.column)} from length(${fromPrefix}) + 1)
    WHERE ${sql(target.column)} IS NOT NULL
      AND left(${sql(target.column)}, length(${fromPrefix})) = ${fromPrefix}
    RETURNING 1
  `;

  return rows.length;
}

async function migrateAssetUrls(): Promise<void> {
  const { fromPrefix, toPrefix, dryRun } = parseArgs();
  config();
  configureDatabaseUrl();

  console.log("TomoriBot asset URL migration");
  console.log(`Mode: ${dryRun ? "dry run" : "write"}`);
  console.log(`From: ${fromPrefix}`);
  console.log(`To:   ${toPrefix}`);
  console.log();

  const tableTotals = new Map<string, number>();
  let grandTotal = 0;

  for (const target of ASSET_COLUMN_TARGETS) {
    const affectedRows = dryRun
      ? await countMatchingRows(target, fromPrefix)
      : await rewriteMatchingRows(target, fromPrefix, toPrefix);

    tableTotals.set(target.table, (tableTotals.get(target.table) ?? 0) + affectedRows);
    grandTotal += affectedRows;
    console.log(`${target.table}.${target.column}: ${affectedRows}`);
  }

  console.log();
  console.log("Table totals:");
  for (const [table, count] of tableTotals) {
    console.log(`${table}: ${count}`);
  }

  console.log();
  console.log(`${dryRun ? "Would rewrite" : "Rewrote"} ${grandTotal} row(s).`);
}

migrateAssetUrls().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
