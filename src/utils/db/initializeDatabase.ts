import type { SQL } from "bun";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { seedNaiPresetsFromCatalog } from "@/db/seed/catalog/naiSeed";
import { seedPersonasFromCatalog } from "@/db/seed/catalog/personaSeed";
import { seedModelsFromCatalog } from "@/db/seed/catalog/modelSeed";
import { seedSystemPromptsFromCatalog } from "@/db/seed/catalog/systemPromptSeed";
import { markAllMigrationsApplied, runMigrations } from "@/db/migrationRunner";
import { invalidateTomoriStateCaches } from "@/utils/cache/tomoriStateCacheStore";
import { sql as defaultSql } from "@/utils/db/client";
import { detectRagAvailability } from "@/utils/db/ragAvailability";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { log } from "@/utils/misc/logger";

export interface InitializeDatabaseOptions {
  client?: SQL;
  maxRetries?: number;
  delayMs?: number;
  includeRag?: boolean | "auto";
}

export interface InitializeDatabaseResult {
  ragInitialized: boolean;
  ragAvailable: boolean;
}

function getSchemaPaths(): {
  schemaPath: string;
  ragSchemaPath: string;
  stPresetSchemaPath: string;
  serverwideQuotaRenameMigrationPath: string;
  personaRenameMigrationPath: string;
} {
  const dbDir = path.join(import.meta.dir, "..", "..", "db");

  return {
    schemaPath: path.join(dbDir, "schema.sql"),
    ragSchemaPath: path.join(dbDir, "schema_rag.sql"),
    stPresetSchemaPath: path.join(dbDir, "schema_stpreset.sql"),
    serverwideQuotaRenameMigrationPath: path.join(dbDir, "migrations", "009_rename_serverwide_quotas.sql"),
    personaRenameMigrationPath: path.join(dbDir, "migrations", "016_rename_tomori_schema_to_persona.sql"),
  };
}

function isRetryableDatabaseInitError(errorMessage: string): boolean {
  return (
    errorMessage.includes("tuple concurrently updated") ||
    errorMessage.includes("could not serialize access") ||
    errorMessage.includes("deadlock detected")
  );
}

async function executeSqlFile(client: SQL, filePath: string): Promise<void> {
  const sqlText = await readFile(filePath, "utf-8");
  const statements = splitSqlStatements(sqlText);
  for (const stmt of statements) {
    await client.unsafe(stmt);
  }
}

async function invalidatePresetPointerStateCaches(client: SQL): Promise<void> {
  const rows = await client<Array<{ server_disc_id: string }>>`
    SELECT DISTINCT s.server_disc_id
    FROM personas p
    JOIN servers s ON s.server_id = p.server_id
    WHERE p.is_pointer = true
      AND p.preset_lineage_id IS NOT NULL
      AND p.preset_language IS NOT NULL
  `;

  invalidateTomoriStateCaches(rows.map((row) => row.server_disc_id));
}

async function isFreshDatabaseBeforeSchema(client: SQL): Promise<boolean> {
  const [state] = await client<
    Array<{
      has_schema_migrations: boolean;
      has_servers: boolean;
      has_personas: boolean;
      has_tomoris: boolean;
      has_tomori_configs: boolean;
    }>
  >`
    SELECT
      to_regclass('public.schema_migrations') IS NOT NULL AS has_schema_migrations,
      to_regclass('public.servers') IS NOT NULL AS has_servers,
      to_regclass('public.personas') IS NOT NULL AS has_personas,
      to_regclass('public.tomoris') IS NOT NULL AS has_tomoris,
      to_regclass('public.tomori_configs') IS NOT NULL AS has_tomori_configs
  `;

  return Boolean(
    state &&
      !state.has_schema_migrations &&
      !state.has_servers &&
      !state.has_personas &&
      !state.has_tomoris &&
      !state.has_tomori_configs,
  );
}

async function shouldRecoverFreshSnapshotBaseline(client: SQL): Promise<boolean> {
  const [state] = await client<
    Array<{
      has_schema_migrations: boolean;
      has_servers: boolean;
      has_users: boolean;
      has_personas: boolean;
      has_tomori_configs: boolean;
      has_tomoris: boolean;
      has_tomori_presets: boolean;
      has_serverwide_quotas: boolean;
    }>
  >`
    SELECT
      to_regclass('public.schema_migrations') IS NOT NULL AS has_schema_migrations,
      to_regclass('public.servers') IS NOT NULL AS has_servers,
      to_regclass('public.users') IS NOT NULL AS has_users,
      to_regclass('public.personas') IS NOT NULL AS has_personas,
      to_regclass('public.tomori_configs') IS NOT NULL AS has_tomori_configs,
      to_regclass('public.tomoris') IS NOT NULL AS has_tomoris,
      to_regclass('public.tomori_presets') IS NOT NULL AS has_tomori_presets,
      to_regclass('public.serverwide_quotas') IS NOT NULL AS has_serverwide_quotas
  `;

  if (
    !state?.has_schema_migrations ||
    !state?.has_servers ||
    !state.has_users ||
    !state.has_personas ||
    state.has_tomori_configs ||
    state.has_tomoris ||
    state.has_tomori_presets ||
    state.has_serverwide_quotas
  ) {
    return false;
  }

  const [migrationStats] = await client<Array<{ applied_count: number }>>`
    SELECT COUNT(*)::INT AS applied_count
    FROM schema_migrations
  `;

  if (!migrationStats || migrationStats.applied_count > 1) {
    return false;
  }

  const [counts] = await client<Array<{ server_count: number; user_count: number }>>`
    SELECT
      (SELECT COUNT(*)::INT FROM servers) AS server_count,
      (SELECT COUNT(*)::INT FROM users) AS user_count
  `;

  return counts?.server_count === 0 && counts.user_count === 0;
}

async function runPreSchemaServerwideQuotaRenameBridge(client: SQL, migrationPath: string): Promise<void> {
  const [state] = await client<
    Array<{
      has_serverwide_quotas: boolean;
      has_image_serverwide_quotas: boolean;
    }>
  >`
    SELECT
      to_regclass('public.serverwide_quotas') IS NOT NULL AS has_serverwide_quotas,
      to_regclass('public.image_serverwide_quotas') IS NOT NULL AS has_image_serverwide_quotas
  `;

  if (!state?.has_serverwide_quotas) {
    return;
  }

  await executeSqlFile(client, migrationPath);
  log.success("Pre-schema legacy image quota rename bridge applied");
}

async function runPreSchemaPersonaRenameBridge(client: SQL, migrationPath: string): Promise<void> {
  const [state] = await client<
    Array<{
      has_tomoris: boolean;
      has_personas: boolean;
      has_tomori_presets: boolean;
      has_persona_presets: boolean;
    }>
  >`
    SELECT
      to_regclass('public.tomoris') IS NOT NULL AS has_tomoris,
      to_regclass('public.personas') IS NOT NULL AS has_personas,
      to_regclass('public.tomori_presets') IS NOT NULL AS has_tomori_presets,
      to_regclass('public.persona_presets') IS NOT NULL AS has_persona_presets
  `;

  if (!state?.has_tomoris && !state?.has_tomori_presets) {
    return;
  }

  if ((state.has_tomoris && state.has_personas) || (state.has_tomori_presets && state.has_persona_presets)) {
    throw new Error(
      "Legacy and renamed persona schema tables both exist. Refusing to auto-rename before schema init; inspect tomoris/personas and tomori_presets/persona_presets before continuing.",
    );
  }

  await executeSqlFile(client, migrationPath);
  log.success("Pre-schema legacy persona rename bridge applied");
}

/**
 * Initialize all startup-managed database schemas and seed data.
 *
 * This is shared by the bot entry point and lifecycle validation so CI checks
 * the same bootstrap path a fresh install uses at runtime.
 */
export async function initializeDatabase(options: InitializeDatabaseOptions = {}): Promise<InitializeDatabaseResult> {
  const client = options.client ?? defaultSql;
  const maxRetries = options.maxRetries ?? 3;
  const delayMs = options.delayMs ?? 1000;
  const includeRag = options.includeRag ?? "auto";
  const {
    schemaPath,
    ragSchemaPath,
    stPresetSchemaPath,
    serverwideQuotaRenameMigrationPath,
    personaRenameMigrationPath,
  } = getSchemaPaths();
  const ragAvailable = includeRag === "auto" ? await detectRagAvailability(client) : includeRag;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const freshDatabaseBeforeSchema = await isFreshDatabaseBeforeSchema(client);

      await runPreSchemaServerwideQuotaRenameBridge(client, serverwideQuotaRenameMigrationPath);
      await runPreSchemaPersonaRenameBridge(client, personaRenameMigrationPath);

      await executeSqlFile(client, schemaPath);
      log.success("PostgreSQL database schema verified");

      if (ragAvailable) {
        await executeSqlFile(client, ragSchemaPath);
        log.success("PostgreSQL RAG schema verified");
      } else {
        log.info(
          "Skipping RAG schema init (pgvector extension not detected). Install pgvector to enable document features (see README.md).",
        );
      }

      await executeSqlFile(client, stPresetSchemaPath);
      log.success("PostgreSQL ST preset schema verified");

      // Seed typed catalogs in the same order the old numbered seed files ran.
      await seedModelsFromCatalog(client);
      log.success("PostgreSQL model catalog seeded");

      await seedPersonasFromCatalog(client);
      log.success("PostgreSQL persona catalog seeded");

      await seedSystemPromptsFromCatalog(client);
      log.success("PostgreSQL system prompt catalog seeded");

      await seedNaiPresetsFromCatalog(client);
      log.success("PostgreSQL NAI preset catalog seeded");

      // Fresh installs load the current static schema snapshot first, so historical
      // migrations are represented by schema.sql and should be recorded, not replayed.
      if (freshDatabaseBeforeSchema || (await shouldRecoverFreshSnapshotBaseline(client))) {
        await markAllMigrationsApplied(client);
      } else {
        // Run pending numbered migrations (src/db/migrations/NNN_*.sql) after the
        // static schema files so Phase 6+ schema changes apply in a controlled order.
        await runMigrations(client);
      }

      await invalidatePresetPointerStateCaches(client);

      return {
        ragInitialized: ragAvailable,
        ragAvailable,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (isRetryableDatabaseInitError(errorMessage) && attempt < maxRetries) {
        log.warn(
          `Database initialization attempt ${attempt} failed due to concurrency (retrying in ${delayMs}ms): ${errorMessage}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      log.error(`PostgreSQL database initialization failed after ${attempt} attempts:`, error);
      throw error;
    }
  }

  throw new Error("Database initialization retry loop exited unexpectedly.");
}
