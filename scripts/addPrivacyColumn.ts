/**
 * Migration script to add privacy_opt_out column to users table
 * Run this once with: bun run scripts/addPrivacyColumn.ts
 */

import { sql } from "bun";

async function addPrivacyColumn() {
	try {
		console.log("Adding privacy_opt_out column to users table...");

		await sql`
			ALTER TABLE users
			ADD COLUMN IF NOT EXISTS privacy_opt_out BOOLEAN DEFAULT FALSE
		`;

		console.log("✅ Successfully added privacy_opt_out column!");
		console.log(
			"The column has been added with a default value of FALSE for all existing users.",
		);

		// Verify the column was added
		const result = await sql`
			SELECT column_name, data_type, column_default
			FROM information_schema.columns
			WHERE table_name = 'users' AND column_name = 'privacy_opt_out'
		`;

		if (result.length > 0) {
			console.log("\n✅ Verification successful:");
			console.log("Column:", result[0].column_name);
			console.log("Type:", result[0].data_type);
			console.log("Default:", result[0].column_default);
		}

		process.exit(0);
	} catch (error) {
		console.error("❌ Error adding column:", error);
		process.exit(1);
	}
}

addPrivacyColumn();
