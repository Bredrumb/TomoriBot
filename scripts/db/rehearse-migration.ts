import { config } from "dotenv";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

config();

// Abort in production because this script mutates schema and seed data for scratch testing only.
if (process.env.RUN_ENV === "production") {
  log.error("Refusing to run migration rehearsal with RUN_ENV=production. Point this at a scratch database.");
  process.exit(1);
}

// Mirror the production migration URL fallback so this script also works with
// standalone POSTGRES_* settings.
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

// Match production boot by leaving includeRag at "auto" so RAG schema runs only when pgvector exists.
initializeDatabase({ client: sql })
  .then((result) => {
    log.success("Migration rehearsal complete");
    log.info(`RAG initialized: ${result.ragInitialized}, RAG available: ${result.ragAvailable}`);
    process.exit(0);
  })
  .catch((error) => {
    log.error("Migration rehearsal failed:", error);
    process.exit(1);
  });
