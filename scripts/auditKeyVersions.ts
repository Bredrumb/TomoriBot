/**
 * Audits encryption key usage and provides rotation recommendations
 *
 * This script analyzes:
 * - Which key versions are available in environment
 * - Which key versions are in use in the database
 * - Safe-to-remove recommendations
 * - Warnings about missing keys
 * - Rotation progress tracking
 *
 * Usage: bun run audit-keys
 */

/*

# Advanced: Encryption Key Rotation (Optional)
# For production deployments, you can rotate encryption keys without downtime
# The system auto-detects the current version (highest number) unless overridden
#
# Example rotation workflow:
# 1. Add new version: CRYPTO_SECRET_V2=new-key-here
# 2. Restart bot (new keys use V2, old keys still work with V1)
# 3. Check progress: bun run audit-keys
# 4. Force migration: bun run rotate-keys
# 5. After 100% migrated, remove old version from .env
#
# CRYPTO_SECRET_V1=old-key
# CRYPTO_SECRET_V2=new-key
# CRYPTO_SECRET_CURRENT=2  # Optional: Override auto-detection


*/

import { config } from "dotenv";
import { sql } from "bun";
import { keyManager } from "@/utils/security/keyManager";

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

interface VersionStats {
	key_version: number | null;
	count: string;
}

interface TableVersionStats {
	tableName: string;
	stats: VersionStats[];
	total: number;
}

async function auditKeyVersions() {
	console.log("\n=== TomoriBot Key Version Audit ===\n");

	// 1. Get available key versions from environment
	const availableVersions = keyManager.getAvailableVersions();
	const currentVersion = keyManager.getCurrentVersion();

	console.log("📋 Environment Configuration:");
	console.log(`   Current Version: V${currentVersion}`);
	console.log(
		`   Available Versions: ${availableVersions.map((v) => `V${v}`).join(", ")}`,
	);
	console.log();

	// 2. Get key version usage from both tables
	const tables: TableVersionStats[] = [];

	// Check opt_api_keys table
	try {
		const optApiKeysStats = (await sql`
			SELECT key_version, COUNT(*) as count
			FROM opt_api_keys
			GROUP BY key_version
			ORDER BY key_version
		`) as VersionStats[];

		const optApiKeysTotal = optApiKeysStats.reduce(
			(sum, s) => sum + Number(s.count),
			0,
		);

		tables.push({
			tableName: "opt_api_keys",
			stats: optApiKeysStats,
			total: optApiKeysTotal,
		});
	} catch (error) {
		console.log("⚠️  Could not query opt_api_keys table:", error);
	}

	// Check tomori_configs table
	try {
		const tomoriConfigsStats = (await sql`
			SELECT key_version, COUNT(*) as count
			FROM tomori_configs
			WHERE api_key IS NOT NULL
			GROUP BY key_version
			ORDER BY key_version
		`) as VersionStats[];

		const tomoriConfigsTotal = tomoriConfigsStats.reduce(
			(sum, s) => sum + Number(s.count),
			0,
		);

		tables.push({
			tableName: "tomori_configs",
			stats: tomoriConfigsStats,
			total: tomoriConfigsTotal,
		});
	} catch (error) {
		console.log("⚠️  Could not query tomori_configs table:", error);
	}

	// 3. Display database usage
	if (tables.length === 0 || tables.every((t) => t.total === 0)) {
		console.log("ℹ️  No encrypted data found in database");
		console.log();
	} else {
		console.log("💾 Database Usage:");

		const versionsInUse = new Set<number>();

		for (const table of tables) {
			if (table.total === 0) continue;

			console.log(`\n   ${table.tableName}:`);

			for (const stat of table.stats) {
				const version = stat.key_version || 1; // Handle NULL as V1
				const count = Number(stat.count);
				versionsInUse.add(version);

				const percentage = ((count / table.total) * 100).toFixed(1);
				const hasKey = keyManager.hasVersion(version);
				const status = hasKey ? "✅" : "❌ MISSING";

				console.log(
					`      V${version}: ${count} keys (${percentage}%) ${status}`,
				);
			}

			console.log(`      Total: ${table.total} keys`);
		}

		console.log();

		// 4. Identify missing keys (data exists but key not in env)
		const missingKeys = Array.from(versionsInUse).filter(
			(v) => !keyManager.hasVersion(v),
		);
		if (missingKeys.length > 0) {
			console.log("⚠️  CRITICAL WARNINGS:");
			for (const version of missingKeys) {
				let keysAffected = 0;
				for (const table of tables) {
					const stat = table.stats.find(
						(s) => (s.key_version || 1) === version,
					);
					if (stat) keysAffected += Number(stat.count);
				}
				console.log(`   - CRYPTO_SECRET_V${version} missing from environment`);
				console.log(`     Cannot decrypt ${keysAffected} keys!`);
			}
			console.log();
		}

		// 5. Identify unused keys (key in env but no data using it)
		const unusedKeys = availableVersions.filter((v) => !versionsInUse.has(v));
		if (unusedKeys.length > 0) {
			console.log("✅ Safe to Remove:");
			for (const version of unusedKeys) {
				if (version === currentVersion) {
					console.log(
						`   - CRYPTO_SECRET_V${version} (current version, keep for new encryptions)`,
					);
				} else {
					console.log(
						`   - CRYPTO_SECRET_V${version} (no data using this version)`,
					);
				}
			}
			console.log();
		}

		// 6. Rotation progress (if multiple versions in use)
		if (versionsInUse.size > 1) {
			const oldVersions = Array.from(versionsInUse).filter(
				(v) => v !== currentVersion,
			);
			let oldKeyCount = 0;
			let totalKeys = 0;

			for (const table of tables) {
				totalKeys += table.total;
				for (const stat of table.stats) {
					const version = stat.key_version || 1;
					if (oldVersions.includes(version)) {
						oldKeyCount += Number(stat.count);
					}
				}
			}

			const newKeyCount = totalKeys - oldKeyCount;
			const progress = ((newKeyCount / totalKeys) * 100).toFixed(1);

			console.log("🔄 Rotation Progress:");
			console.log(
				`   ${newKeyCount}/${totalKeys} keys migrated to V${currentVersion} (${progress}%)`,
			);
			console.log(`   ${oldKeyCount} keys still on old versions`);
			console.log();
		}

		// 7. Recommendations
		console.log("💡 Recommendations:");

		if (missingKeys.length > 0) {
			console.log(
				"   1. ❌ URGENT: Add missing key versions to .env immediately",
			);
			console.log("      Your bot cannot decrypt some API keys!");
		} else if (versionsInUse.size === 1 && versionsInUse.has(currentVersion)) {
			console.log("   1. ✅ All keys are on the current version");
			if (unusedKeys.length > 0) {
				console.log("   2. ✅ Safe to remove unused versions from .env:");
				console.log(
					`      ${unusedKeys
						.filter((v) => v !== currentVersion)
						.map((v) => `CRYPTO_SECRET_V${v}`)
						.join(", ")}`,
				);
			} else {
				console.log("   2. ✅ No cleanup needed");
			}
		} else if (versionsInUse.size > 1) {
			const oldVersions = Array.from(versionsInUse).filter(
				(v) => v !== currentVersion,
			);
			let oldKeyCount = 0;

			for (const table of tables) {
				for (const stat of table.stats) {
					const version = stat.key_version || 1;
					if (oldVersions.includes(version)) {
						oldKeyCount += Number(stat.count);
					}
				}
			}

			console.log(
				`   1. 🔄 Rotation in progress: ${oldKeyCount} keys need migration`,
			);
			console.log("   2. ⏳ Wait for lazy rotation, or run:");
			console.log("      bun run rotate-keys");
			console.log("   3. ⚠️  Keep old key versions until migration completes");
		}
	}

	console.log();
}

auditKeyVersions().catch((error) => {
	console.error("Audit failed:", error);
	process.exit(1);
});
