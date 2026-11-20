import type { AppEnvironment } from "@/types/config";
import { runAutomaticDataBackupIfNeeded } from "@/utils/backup/dataBackup";
import { log } from "@/utils/misc/logger";

// Startup backup must run before schema initialization so migrations and seed changes cannot alter the database
// first.
export async function initStartupBackup(environment: AppEnvironment): Promise<void> {
  if (environment === "production") {
    return;
  }

  try {
    await runAutomaticDataBackupIfNeeded();
  } catch (error) {
    await log.error("Automatic startup backup failed; refusing to continue before database initialization.", error);
    process.exit(1);
  }
}
