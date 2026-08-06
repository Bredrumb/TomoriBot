/**
 * Manual migration runner.
 *
 * Applies all pending migrations from src/db/migrations/ in version order.
 * The same logic runs automatically at bot startup via initializeDatabase.ts;
 * this script is provided for manual invocation (CI, deployment pipelines,
 * developer tooling).
 *
 * Usage:
 *   bun run scripts/db/migrate.ts
 */
import { config } from "dotenv";
import { runMigrations } from "@/db/migrationRunner";
import { log } from "@/utils/misc/logger";

config();

// Bun's sql tag reads DATABASE_URL from the environment.
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

log.section("Running database migrations...");

runMigrations()
  .then(() => {
    log.success("Migration run complete");
    process.exit(0);
  })
  .catch((error) => {
    log.error("Migration run failed:", error);
    process.exit(1);
  });
