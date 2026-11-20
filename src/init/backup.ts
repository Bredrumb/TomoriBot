import type { AppEnvironment } from "@/types/config";
import { runAutomaticDataBackupIfNeeded } from "@/utils/backup/dataBackup";
import { log } from "@/utils/misc/logger";

/**
 * Runs the non-production startup backup gate before schema initialization can
 * apply migrations or seed changes.
 */
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
