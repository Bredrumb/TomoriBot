import { loadInitializedKeyManager } from "../lib/keyManagerBootstrap";
import {
  scanEncryptedRows,
  storedKeyVersion,
  verifyCiphertext,
  rotateEncryptedRow,
} from "@/utils/security/encryptedColumns";

async function rotateAllKeys(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !process.argv.includes("--bot-stopped")) {
    throw new Error("Stop every bot instance and pass --bot-stopped. Restart after rotation to clear process caches.");
  }
  const manager = await loadInitializedKeyManager();
  const { sql } = await import("@/utils/db/client");
  let scanned = 0;
  let migrated = 0;
  let failed = 0;
  try {
    for await (const { target, row } of scanEncryptedRows(sql)) {
      scanned++;
      try {
        const version = storedKeyVersion(row.key_version);
        await verifyCiphertext(sql, row.ciphertext, version);
        if (row.key_version === null || version !== manager.getCurrentVersion()) {
          if (!dryRun) await rotateEncryptedRow(sql, target, row);
          migrated++;
        }
      } catch {
        failed++;
        console.error(`Credential check or rotation failed: ${target.table}, row ${row.id}.`);
      }
    }
    console.log(`Scanned: ${scanned}; ${dryRun ? "would migrate" : "migrated"}: ${migrated}; failed: ${failed}.`);
    if (failed > 0) throw new Error("Incomplete rotation.");
    console.log(
      dryRun
        ? "Dry run complete: all scanned credentials are decryptable."
        : "Rotation complete. Run audit-keys, then restart every bot instance.",
    );
    console.log("Keep separately archived keys for retained backups; this command does not authorize key retirement.");
  } finally {
    await sql.close();
  }
}

await rotateAllKeys().catch(() => {
  console.error(
    "Rotation incomplete. Queries, keys, or rows may have failed. Keep all key versions; retry after recovery. Stop every bot instance and use --bot-stopped for writes.",
  );
  process.exitCode = 1;
});
