import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exportPresetData } from "@/utils/db/presetExport";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";

config();

function resolveBackupsRoot(): string {
  return process.env.TOMORI_BACKUP_DIR ? resolve(process.env.TOMORI_BACKUP_DIR) : join(process.cwd(), "backups");
}

// ---------------------------------------------------------------------------
// scripts/maintenance/backupPersonas.ts
//   bun run backup:personas  → export ALL personas across all servers
//
//   For each persona: writes an import-compatible JSON file containing the
//   preset data (same as /persona export) plus server memories for that
//   persona lineage. Organized into per-server subdirectories.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServerRow {
  server_id: number;
  server_disc_id: string;
}

interface PersonaRow {
  tomori_id: number;
  server_id: number;
  tomori_nickname: string;
  is_alter: boolean;
  persona_lineage_id: number | bigint;
  alter_triggers: string[] | null;
  webhook_avatar_url: string | null;
}

interface PersonaManifestEntry {
  filename: string;
  filename_png: string | null;
  nickname: string;
  tomori_id: number;
  is_alter: boolean;
  memory_count: number;
}

interface ServerManifest {
  server_disc_id: string;
  server_id: number;
  personas: PersonaManifestEntry[];
}

interface BundleManifest {
  exported_at: string;
  bot_version: string;
  total_servers: number;
  total_personas: number;
  servers: ServerManifest[];
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/** Retrieve all registered servers. */
async function getAllServers(): Promise<ServerRow[]> {
  return await sql<ServerRow[]>`
    SELECT server_id, server_disc_id
    FROM servers
    ORDER BY server_id ASC
  `;
}

/** Retrieve all personas (main first, then alters) for a server. */
async function getPersonasForServer(serverId: number): Promise<PersonaRow[]> {
  return await sql<PersonaRow[]>`
    SELECT
      tomori_id, server_id, tomori_nickname, is_alter,
      persona_lineage_id, alter_triggers, webhook_avatar_url
    FROM tomoris
    WHERE server_id = ${serverId}
    ORDER BY is_alter ASC, updated_at DESC NULLS LAST, tomori_id DESC
  `;
}

/** Retrieve server-scoped memories for a persona lineage. */
async function getMemoriesForPersona(serverId: number, lineageId: number): Promise<string[]> {
  const rows = await sql<{ content: string }[]>`
    SELECT content
    FROM server_memories
    WHERE server_id = ${serverId}
      AND persona_lineage_id = ${lineageId}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => r.content);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runBackup(): Promise<void> {
  log.section("PERSONA BACKUP");
  log.info("Exporting all personas from the database...");

  // 1. Verify database credentials
  if (!process.env.POSTGRES_PASSWORD && !process.env.DATABASE_URL) {
    log.error("POSTGRES_PASSWORD or DATABASE_URL must be set in .env");
    process.exit(1);
  }

  // 2. Create timestamped output directory
  const backupsRoot = resolveBackupsRoot();
  if (!existsSync(backupsRoot)) mkdirSync(backupsRoot, { recursive: true });

  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "").replace("T", "_");
  const bundleDir = join(backupsRoot, `personas_${timestamp}`);
  mkdirSync(bundleDir, { recursive: true });
  log.info(`Output directory: ${bundleDir}`);

  // 3. Load bot version
  const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { version: string };

  // 4. Fetch all servers
  const servers = await getAllServers();
  if (servers.length === 0) {
    log.warn("No servers found in the database. Nothing to export.");
    return;
  }
  log.info(`Found ${servers.length} server(s)`);

  const manifest: BundleManifest = {
    exported_at: new Date().toISOString(),
    bot_version: version,
    total_servers: 0,
    total_personas: 0,
    servers: [],
  };

  let totalExported = 0;
  let totalFailed = 0;

  // 5. Iterate each server
  for (const server of servers) {
    const personas = await getPersonasForServer(server.server_id);
    if (personas.length === 0) {
      log.info(`  Server ${server.server_disc_id}: no personas, skipping`);
      continue;
    }

    log.info(`  Server ${server.server_disc_id}: ${personas.length} persona(s)`);

    // Per-server subdirectory to avoid filename collisions
    const serverDir = join(bundleDir, server.server_disc_id);
    mkdirSync(serverDir, { recursive: true });

    const serverEntry: ServerManifest = {
      server_disc_id: server.server_disc_id,
      server_id: server.server_id,
      personas: [],
    };

    // 6. Export each persona
    for (const persona of personas) {
      const { tomori_nickname: nickname, is_alter } = persona;
      const typeTag = is_alter ? "alter" : "main";

      try {
        // 6a. Canonical export (identical to /persona export)
        const exportResult = await exportPresetData(server.server_disc_id, persona.tomori_id);
        if (!exportResult.success) {
          log.error(`    FAILED: ${nickname} (${typeTag}) — ${exportResult.error}`);
          totalFailed++;
          continue;
        }

        // 6b. Load server memories for this persona lineage
        const lineageId =
          typeof persona.persona_lineage_id === "bigint"
            ? Number(persona.persona_lineage_id)
            : Number(persona.persona_lineage_id ?? 0);
        const memories = await getMemoriesForPersona(server.server_id, lineageId);

        // 6c. Build full backup payload
        const backup = {
          // Import-compatible preset (works with /persona import)
          preset: exportResult.data,
          // Extra metadata not in standard export
          meta: {
            tomori_id: persona.tomori_id,
            is_alter,
            webhook_avatar_url: persona.webhook_avatar_url ?? null,
            alter_triggers: persona.alter_triggers ?? [],
          },
          // Server memories for this persona
          memories,
        };

        // 6d. Write JSON file
        const sanitized = sanitizeAttachmentFilenamePart(nickname, {
          fallback: "persona",
          maxLength: 50,
        });
        const filename = `${sanitized}_${persona.tomori_id}.json`;
        writeFileSync(join(serverDir, filename), `${JSON.stringify(backup, null, 2)}\n`);

        // 6e. Generate PNG with embedded metadata (only when avatar is available)
        let filenamePng: string | null = null;
        if (persona.webhook_avatar_url) {
          try {
            const [{ loadStoredPersonaAvatarBuffer }, { convertToPNG }, { embedMetadataInPNG }] = await Promise.all([
              import("@/utils/storage/avatarStorage"),
              import("@/utils/image/imageProcessor"),
              import("@/utils/image/pngMetadata"),
            ]);
            const avatarBuffer = await loadStoredPersonaAvatarBuffer(persona.webhook_avatar_url);
            if (avatarBuffer) {
              const pngBuffer = await convertToPNG(avatarBuffer);
              const pngWithMetadata = embedMetadataInPNG(pngBuffer, exportResult.data);
              filenamePng = `${sanitized}_${persona.tomori_id}.png`;
              writeFileSync(join(serverDir, filenamePng), pngWithMetadata);
            }
          } catch (error) {
            log.warn(`      PNG generation skipped for ${nickname}: ${error}`);
          }
        }

        log.success(`    Exported: ${nickname} (${typeTag}, ${memories.length} memories${filenamePng ? ", PNG" : ""})`);
        totalExported++;

        serverEntry.personas.push({
          filename,
          filename_png: filenamePng,
          nickname,
          tomori_id: persona.tomori_id,
          is_alter,
          memory_count: memories.length,
        });
      } catch (error) {
        log.error(`    FAILED: ${nickname} (${typeTag}) — ${error}`);
        totalFailed++;
      }
    }

    if (serverEntry.personas.length > 0) {
      manifest.servers.push(serverEntry);
    }
  }

  // 7. Write manifest
  manifest.total_servers = manifest.servers.length;
  manifest.total_personas = totalExported;
  writeFileSync(join(bundleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // 8. Summary
  log.section("BACKUP COMPLETE");
  log.info(`Location:       ${bundleDir}`);
  log.info(`Servers:        ${manifest.total_servers}`);
  log.info(`Personas:       ${totalExported} exported, ${totalFailed} failed`);
  if (totalFailed > 0) {
    log.warn(`${totalFailed} persona(s) failed — check errors above.`);
  }
}

runBackup()
  .catch((error) => {
    log.error("Persona backup failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
