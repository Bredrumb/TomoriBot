import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

config();

function resolveBackupsRoot(): string {
  return process.env.TOMORI_BACKUP_DIR ? resolve(process.env.TOMORI_BACKUP_DIR) : join(process.cwd(), "backups");
}

// ---------------------------------------------------------------------------
// scripts/maintenance/backupMemories.ts
//   bun run backup:memories  → export ALL personal memories across all users
//
//   Reads from the personal_memories table (lineage-scoped). Each user gets
//   their own JSON file containing all memory rows grouped by persona lineage.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryRow {
  personal_memory_id: number;
  user_id: number;
  user_disc_id: string;
  user_nickname: string;
  persona_lineage_id: number;
  content: string;
  created_at: string;
  updated_at: string;
}

interface UserEntry {
  user_disc_id: string;
  user_nickname: string;
  memory_count: number;
  filename: string;
}

interface BundleManifest {
  exported_at: string;
  bot_version: string;
  total_users: number;
  total_memories: number;
  users: UserEntry[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runBackup(): Promise<void> {
  log.section("MEMORIES BACKUP");
  log.info("Exporting all personal memories from the database...");

  // 1. Verify database credentials
  if (!process.env.POSTGRES_PASSWORD && !process.env.DATABASE_URL) {
    log.error("POSTGRES_PASSWORD or DATABASE_URL must be set in .env");
    process.exit(1);
  }

  // 2. Create timestamped output directory
  const backupsRoot = resolveBackupsRoot();
  if (!existsSync(backupsRoot)) mkdirSync(backupsRoot, { recursive: true });

  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "").replace("T", "_");
  const bundleDir = join(backupsRoot, `memories_${timestamp}`);
  mkdirSync(bundleDir, { recursive: true });
  log.info(`Output directory: ${bundleDir}`);

  // 3. Load bot version
  const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { version: string };

  // 4. Fetch all personal memories joined with user info
  const rows = await sql<MemoryRow[]>`
    SELECT
      pm.personal_memory_id,
      pm.user_id,
      u.user_disc_id,
      u.user_nickname,
      pm.persona_lineage_id,
      pm.content,
      pm.created_at,
      pm.updated_at
    FROM personal_memories pm
    JOIN users u ON pm.user_id = u.user_id
    ORDER BY pm.user_id ASC, pm.persona_lineage_id ASC, pm.created_at ASC
  `;

  if (rows.length === 0) {
    log.warn("No personal memories found. Nothing to export.");
    return;
  }

  // 5. Group rows by user
  const byUser = new Map<number, MemoryRow[]>();
  for (const row of rows) {
    const existing = byUser.get(row.user_id) ?? [];
    existing.push(row);
    byUser.set(row.user_id, existing);
  }

  log.info(`Found ${byUser.size} user(s) with personal memories`);

  const manifest: BundleManifest = {
    exported_at: new Date().toISOString(),
    bot_version: version,
    total_users: 0,
    total_memories: 0,
    users: [],
  };

  // 6. Export each user's memories
  for (const [, memories] of byUser) {
    const first = memories[0];
    if (!first) continue;

    const safeName =
      (first.user_nickname ?? "unknown")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^\w]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 50) || `user_${first.user_id}`;

    const filename = `${safeName}_${first.user_disc_id}.json`;

    const payload = {
      user_disc_id: first.user_disc_id,
      user_nickname: first.user_nickname,
      exported_at: new Date().toISOString(),
      personal_memories: memories.map((m) => ({
        personal_memory_id: m.personal_memory_id,
        persona_lineage_id: m.persona_lineage_id,
        content: m.content,
        created_at: m.created_at,
        updated_at: m.updated_at,
      })),
    };

    writeFileSync(join(bundleDir, filename), `${JSON.stringify(payload, null, 2)}\n`);

    log.success(`  ${first.user_nickname}: ${memories.length} memories`);

    manifest.users.push({
      user_disc_id: first.user_disc_id,
      user_nickname: first.user_nickname,
      memory_count: memories.length,
      filename,
    });
    manifest.total_memories += memories.length;
  }

  // 7. Write manifest
  manifest.total_users = manifest.users.length;
  writeFileSync(join(bundleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // 8. Summary
  log.section("BACKUP COMPLETE");
  log.info(`Location:       ${bundleDir}`);
  log.info(`Users:          ${manifest.total_users}`);
  log.info(`Total memories: ${manifest.total_memories}`);
}

runBackup()
  .catch((error) => {
    log.error("Memories backup failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
