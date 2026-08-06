import { config } from "dotenv";
import { loadDatabaseSecretsFromFile } from "@/utils/db/databaseSecrets";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { log } from "@/utils/misc/logger";

config({ quiet: true });

try {
  const secretFile = process.env.SECRET_FILE?.trim();
  if (!secretFile) {
    throw new Error("SECRET_FILE is required for database schema initialization.");
  }

  await loadDatabaseSecretsFromFile(secretFile);
  await initializeDatabase();
  log.success("Production schema initialization and migrations completed");
  process.exit(0);
} catch (error) {
  await log.error("Production schema initialization failed", error);
  process.exit(1);
}
