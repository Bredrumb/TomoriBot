/**
 * Migration rehearsal runner.
 *
 * Runs the full startup database bootstrap (schema + seed + pending migrations)
 * against a throwaway copy of production data so a release branch's migrations
 * can be validated before they run on the live database. This invokes the exact
 * same `initializeDatabase` path the bot uses at boot, so a clean run here means
 * the same migrations will apply cleanly in production.
 *
 * Intended workflow:
 *   1. Restore a production snapshot into a scratch database (see
 *      docs/guides/safe-migration.md — the target Postgres MUST have the
 *      `pgvector` extension available, or the snapshot's document_chunks table
 *      fails to restore and silently drops data).
 *   2. Point POSTGRES_DB at that scratch database and run this script.
 *   3. Inspect the applied-migration log and run your own integrity queries.
 *
 * Usage:
 *   POSTGRES_DB=tomodb_prodrehearse POSTGRES_PASSWORD=... \
 *     bun run scripts/db/rehearse-migration.ts
 *
 * Safety: refuses to run when RUN_ENV=production so it can never be aimed at the
 * live database by accident.
 */
import { config } from "dotenv";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

config();

// Hard stop if this is somehow running in a production environment — this
//    script mutates schema and seed data and is only meant for scratch copies.
if (process.env.RUN_ENV === "production") {
  log.error("Refusing to run migration rehearsal with RUN_ENV=production. Point this at a scratch database.");
  process.exit(1);
}

// Build DATABASE_URL from individual POSTGRES_* vars if not explicitly set,
//    mirroring scripts/db/migrate.ts so the script works standalone.
if (!process.env.DATABASE_URL) {
  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    log.error("POSTGRES_PASSWORD (or DATABASE_URL) is required but not set");
    process.exit(1);
  }

  process.env.DATABASE_URL = `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

log.section("Rehearsing database migrations against the configured database...");

// Run the same bootstrap the bot performs at startup. includeRag defaults to
//    "auto" so RAG schema is applied only when pgvector is detected — matching
//    real production boot behavior.
initializeDatabase({ client: sql })
  .then((result) => {
    log.success("Migration rehearsal complete");
    log.info(`RAG initialized: ${result.ragInitialized}, RAG available: ${result.ragAvailable}`);
    process.exit(0);
  })
  .catch((error) => {
    // Surface failures with a non-zero exit so CI / callers can detect them.
    log.error("Migration rehearsal failed:", error);
    process.exit(1);
  });
