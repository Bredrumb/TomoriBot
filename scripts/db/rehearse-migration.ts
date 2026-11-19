import { config } from "dotenv";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

config();

// Hard stop if this is somehow running in a production environment because this
//    script mutates schema and seed data and is only meant for scratch copies.
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

// Run the same bootstrap the bot performs at startup. includeRag defaults to
//    "auto" so RAG schema is applied only when pgvector is detected; matching
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
