/**
 * Force rotation script to migrate all encrypted keys to the current version
 *
 * This script:
 * - Finds all keys encrypted with old versions
 * - Re-encrypts them with the current version
 * - Updates the database with new ciphertext and version
 * - Supports --dry-run mode to preview changes
 *
 * Usage:
 *   bun run rotate-keys           # Perform rotation
 *   bun run rotate-keys --dry-run # Preview without changes
 */

import { config } from "dotenv";
import { sql } from "bun";
import { keyManager } from "@/utils/security/keyManager";
import { decryptApiKey, encryptApiKey } from "@/utils/security/crypto";

config();

/**
 * Get PostgreSQL connection URL from environment variables
 * Supports both POSTGRES_URL and component-based configuration
 */
function getPostgresUrl(): string {
	// If POSTGRES_URL is provided, use it directly (backwards compatibility)
	if (process.env.POSTGRES_URL) {
		return process.env.POSTGRES_URL;
	}

	// Otherwise, build URL from components
	const host = process.env.POSTGRES_HOST || "localhost";
	const port = process.env.POSTGRES_PORT || "5432";
	const user = process.env.POSTGRES_USER || "postgres";
	const password = process.env.POSTGRES_PASSWORD;
	const database = process.env.POSTGRES_DB || "tomodb";

	if (!password) {
		throw new Error(
			"Database password must be provided via POSTGRES_PASSWORD or POSTGRES_URL",
		);
	}

	return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

const postgresUrl = getPostgresUrl();
process.env.DATABASE_URL = postgresUrl;

interface OldKeyRow {
	table: string;
	id: number;
	api_key: Buffer;
	key_version: number | null;
	identifier: string; // For logging (e.g., "server_id: 123, service: brave-search")
}

async function rotateAllKeys() {
	const isDryRun = process.argv.includes("--dry-run");
	const currentVersion = keyManager.getCurrentVersion();

	console.log("\n=== TomoriBot Key Rotation ===\n");

	if (isDryRun) {
		console.log("🔍 DRY RUN MODE - No changes will be made\n");
	}

	console.log(`Current version: V${currentVersion}`);
	console.log(
		`Available versions: ${keyManager.getAvailableVersions().map((v) => `V${v}`).join(", ")}\n`,
	);

	// 1. Find all keys not on current version
	const oldKeys: OldKeyRow[] = [];

	// Check opt_api_keys table
	try {
		const optApiKeys = await sql`
			SELECT opt_api_key_id, server_id, service_name, api_key, key_version
			FROM opt_api_keys
			WHERE (key_version != ${currentVersion} OR key_version IS NULL)
			  AND api_key IS NOT NULL
		`;

		for (const row of optApiKeys) {
			oldKeys.push({
				table: "opt_api_keys",
				id: row.opt_api_key_id,
				api_key: row.api_key,
				key_version: row.key_version || 1,
				identifier: `server_id: ${row.server_id}, service: ${row.service_name}`,
			});
		}
	} catch (error) {
		console.error("❌ Failed to query opt_api_keys:", error);
	}

	// Check tomori_configs table
	try {
		const tomoriConfigs = await sql`
			SELECT tomori_config_id, tomori_id, api_key, key_version
			FROM tomori_configs
			WHERE (key_version != ${currentVersion} OR key_version IS NULL)
			  AND api_key IS NOT NULL
		`;

		for (const row of tomoriConfigs) {
			oldKeys.push({
				table: "tomori_configs",
				id: row.tomori_config_id,
				api_key: row.api_key,
				key_version: row.key_version || 1,
				identifier: `tomori_id: ${row.tomori_id}`,
			});
		}
	} catch (error) {
		console.error("❌ Failed to query tomori_configs:", error);
	}

	// 2. Check if there's anything to rotate
	if (oldKeys.length === 0) {
		console.log(`✅ All keys are already on the current version (V${currentVersion})`);
		console.log("   No rotation needed!\n");
		return;
	}

	console.log(`Found ${oldKeys.length} keys to rotate:\n`);

	// Group by table for display
	const byTable = oldKeys.reduce(
		(acc, key) => {
			acc[key.table] = (acc[key.table] || 0) + 1;
			return acc;
		},
		{} as Record<string, number>,
	);

	for (const [table, count] of Object.entries(byTable)) {
		console.log(`   ${table}: ${count} keys`);
	}

	console.log();

	if (isDryRun) {
		console.log("📋 Keys that would be rotated:\n");
		for (const key of oldKeys.slice(0, 10)) {
			// Show first 10
			console.log(
				`   V${key.key_version} → V${currentVersion}: ${key.table} (${key.identifier})`,
			);
		}
		if (oldKeys.length > 10) {
			console.log(`   ... and ${oldKeys.length - 10} more`);
		}
		console.log(
			"\n✅ Dry run complete. Remove --dry-run to perform rotation.\n",
		);
		return;
	}

	// 3. Perform rotation
	console.log("🔄 Starting rotation...\n");

	let successCount = 0;
	let failCount = 0;
	const errors: Array<{ key: OldKeyRow; error: unknown }> = [];

	for (const oldKey of oldKeys) {
		try {
			// Decrypt with old version
			const plaintext = await decryptApiKey(oldKey.api_key, oldKey.key_version);

			// Encrypt with current version
			const { encrypted, version } = await encryptApiKey(plaintext);

			// Update database based on table
			if (oldKey.table === "opt_api_keys") {
				await sql`
					UPDATE opt_api_keys
					SET api_key = ${encrypted},
					    key_version = ${version},
					    updated_at = CURRENT_TIMESTAMP
					WHERE opt_api_key_id = ${oldKey.id}
				`;
			} else if (oldKey.table === "tomori_configs") {
				await sql`
					UPDATE tomori_configs
					SET api_key = ${encrypted},
					    key_version = ${version},
					    updated_at = CURRENT_TIMESTAMP
					WHERE tomori_config_id = ${oldKey.id}
				`;
			}

			successCount++;
			console.log(
				`   ✅ Rotated V${oldKey.key_version} → V${version}: ${oldKey.table} (${oldKey.identifier})`,
			);
		} catch (error) {
			failCount++;
			errors.push({ key: oldKey, error });
			console.error(
				`   ❌ Failed: ${oldKey.table} (${oldKey.identifier}): ${error instanceof Error ? error.message : error}`,
			);
		}
	}

	// 4. Summary
	console.log("\n=== Rotation Summary ===\n");
	console.log(`   ✅ Succeeded: ${successCount}`);
	console.log(`   ❌ Failed: ${failCount}`);
	console.log(`   📊 Total: ${oldKeys.length}\n`);

	if (failCount > 0) {
		console.log("⚠️  Some keys failed to rotate. Details:");
		for (const { key, error } of errors.slice(0, 5)) {
			// Show first 5 errors
			console.log(
				`   - ${key.table} (${key.identifier}): ${error instanceof Error ? error.message : error}`,
			);
		}
		if (errors.length > 5) {
			console.log(`   ... and ${errors.length - 5} more errors`);
		}
		console.log();
	}

	if (successCount === oldKeys.length) {
		console.log(`🎉 All keys successfully rotated to V${currentVersion}!`);
		console.log("   Run 'bun run audit-keys' to verify.\n");
	} else if (successCount > 0) {
		console.log(
			`⚠️  Partial success: ${successCount}/${oldKeys.length} keys rotated.`,
		);
		console.log("   Run 'bun run audit-keys' to see current status.\n");
	} else {
		console.log("❌ Rotation failed - no keys were migrated.");
		console.log("   Check error messages above and try again.\n");
		process.exit(1);
	}
}

rotateAllKeys().catch((error) => {
	console.error("\n❌ Rotation script failed:", error);
	process.exit(1);
});
