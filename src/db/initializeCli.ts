import { config } from "dotenv";
import { loadSecrets } from "@/init/secrets";
import { resolveEnvironment } from "@/types/config";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { log } from "@/utils/misc/logger";

config({ quiet: true });

const environment = resolveEnvironment();

try {
  await loadSecrets(environment);
  await initializeDatabase();
  log.success("Production schema initialization and migrations completed");
  process.exit(0);
} catch (error) {
  await log.error("Production schema initialization failed", error);
  process.exit(1);
}
