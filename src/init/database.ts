import { sql } from "@/utils/db/client";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { log } from "@/utils/misc/logger";
import type { AppEnvironment } from "@/types/config";

/**
 * Initializes the database, cleans up expired cooldowns, and sets up the pg_cron
 * job for recurring cooldown cleanup (production environments only).
 *
 * Exits the process on critical DB initialization failure.
 *
 * @param environment - Resolved runtime environment
 */
export async function initDatabase(environment: AppEnvironment): Promise<void> {
  log.section("Initializing Database...");

  // Small delay in development to reduce hot-reload conflicts
  if (environment !== "production") {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  try {
    await initializeDatabase();
  } catch {
    process.exit(1);
  }

  log.section("Cleaning up expired cooldowns...");
  try {
    const { cleanupExpiredCooldowns } = await import("@/utils/db/cooldownsCleanup");
    const cleanupResult = await cleanupExpiredCooldowns();
    if (cleanupResult.success) {
      log.success(`Cooldowns cleanup completed: ${cleanupResult.deletedCount} expired entries removed`);
    } else {
      log.warn(`Cooldowns cleanup failed: ${cleanupResult.error}`);
    }
  } catch (error) {
    log.warn("Error during startup cooldowns cleanup:", error);
    // Non-critical — continue startup
  }

  // Attempt to set up pg_cron for recurring cooldown cleanup (non-critical)
  try {
    const host = process.env.POSTGRES_HOST || "localhost";
    const port = Number.parseInt(process.env.POSTGRES_PORT || "5432", 10);

    if (!host || Number.isNaN(port)) {
      log.warn("Could not determine database host/port for pg_cron setup");
      return;
    }

    // 1. Check if the pg_cron extension is available
    const [extensionCheck] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_available_extensions
        WHERE name = 'pg_cron'
      ) as available
    `;

    if (!extensionCheck?.available) {
      log.warn("pg_cron extension not available - using startup cleanup method");
      return;
    }

    // 2. Enable pg_cron extension
    await sql`CREATE EXTENSION IF NOT EXISTS pg_cron;`;

    // 3. Delete any existing job with the same name (idempotent across pg_cron versions)
    await sql`
      DELETE FROM cron.job
      WHERE jobname = 'tomoribot_cooldown_cleanup'
    `;

    // 4. Insert the new/updated job
    await sql`
      INSERT INTO cron.job (jobname, schedule, command, nodename, nodeport, database, username)
      VALUES (
        'tomoribot_cooldown_cleanup',
        '0 * * * *',
        'SELECT cleanup_expired_cooldowns();',
        ${host},
        ${port},
        current_database(),
        current_user
      )
    `;
    log.success(`pg_cron job for cooldown cleanup scheduled/verified for ${host}:${port}`);
  } catch (err) {
    log.info(`pg_cron setup failed (non-critical): ${err instanceof Error ? err.message : err}`);
    log.info("Cooldown cleanup will be handled by startup method instead");
  }
}
