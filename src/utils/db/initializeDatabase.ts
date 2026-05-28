import type { SQL } from "bun";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql as defaultSql } from "@/utils/db/client";
import { detectRagAvailability } from "@/utils/db/ragDetection";
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
  seedPath: string;
} {
  const dbDir = path.join(import.meta.dir, "..", "..", "db");

  return {
    schemaPath: path.join(dbDir, "schema.sql"),
    ragSchemaPath: path.join(dbDir, "schema_rag.sql"),
    stPresetSchemaPath: path.join(dbDir, "schema_stpreset.sql"),
    seedPath: path.join(dbDir, "seed.sql"),
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
  const { schemaPath, ragSchemaPath, stPresetSchemaPath, seedPath } = getSchemaPaths();
  const ragAvailable = includeRag === "auto" ? await detectRagAvailability(client) : includeRag;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
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

      await executeSqlFile(client, seedPath);
      log.success("PostgreSQL database seed verified");

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
