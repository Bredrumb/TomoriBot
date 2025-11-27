import { SQL } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Creates and configures a PostgreSQL client using Bun's SQL constructor.
 *
 * Environment-Based SSL Configuration:
 * - Development (RUN_ENV !== 'production'): SSL disabled for localhost
 * - Production (RUN_ENV === 'production'): Full TLS with CA certificate verification
 *
 * Certificate: docker/certs/rds-ca-bundle.pem (production only)
 *
 * Note: Uses console.log instead of logger to avoid circular dependency
 * (logger.ts imports sql from this file)
 *
 * @returns Configured SQL instance with appropriate TLS settings
 */
function createDatabaseClient(): SQL {
	const runEnv = process.env.RUN_ENV || "development";
	const isProduction =
		runEnv === "production" && process.env.TEST_PRODUCTION !== "true";

	// Build connection parameters from environment
	const host = process.env.POSTGRES_HOST || "localhost";
	const port = Number.parseInt(process.env.POSTGRES_PORT || "5432", 10);
	const user = process.env.POSTGRES_USER || "postgres";
	const password = process.env.POSTGRES_PASSWORD;
	const database = process.env.POSTGRES_DB || "tomodb";

	// Allow initialization without password for scripts that don't use the database
	// (e.g., localization checks, linting). Database operations will fail if attempted.
	if (!password) {
		// console.warn("\x1b[33m[WARN]\x1b[0m POSTGRES_PASSWORD not set - database client created but operations will fail",);
		// Return a dummy client that will error on actual use
		return new SQL({
			hostname: host,
			port: port,
			username: user,
			password: "dummy", // Will fail on actual connection attempt
			database: database,
		});
	}

	// Production: TLS with CA certificate verification
	if (isProduction) {
		// Allow overriding CA bundle location; fall back to common paths for dev and container builds.
		const caPathEnv = process.env.POSTGRES_CA_CERT_PATH;
		const candidatePaths = [
			caPathEnv,
			join(process.cwd(), "docker", "certs", "rds-ca-bundle.pem"),
			join(process.cwd(), "certs", "rds-ca-bundle.pem"),
		].filter(Boolean) as string[];

		const certPath = candidatePaths.find((p) => existsSync(p));

		try {
			if (!certPath) {
				throw new Error("CA bundle not found in any known path");
			}
			const ca = readFileSync(certPath, "utf8");
			// console.log("\x1b[36m[INFO]\x1b[0m Database SSL mode: verify-full (production with CA certificate)",);

			return new SQL({
				hostname: host,
				port: port,
				username: user,
				password: password,
				database: database,
				tls: {
					ca: ca,
					rejectUnauthorized: true, // Enforce certificate validation
				},
			});
		} catch (error) {
			console.error(
				"\x1b[31m[ERROR]\x1b[0m Failed to load AWS RDS CA certificate:",
				error,
			);
			throw new Error(
				"Production database requires a CA certificate. " +
					`Searched paths: ${candidatePaths.join(", ")}. ` +
					"Set POSTGRES_CA_CERT_PATH to the correct file if needed.",
			);
		}
	}

	// Development: No SSL for localhost PostgreSQL
	console.log(
		"\x1b[36m[INFO]\x1b[0m Database SSL mode: disabled (development)",
	);
	return new SQL({
		hostname: host,
		port: port,
		username: user,
		password: password,
		database: database,
	});
}

// Lazily create the client so secrets/env vars are set first (avoids premature
// initialization when modules import sql before dotenv/Secrets Manager runs).
let cachedClient: SQL | null = null;

function getClient(): SQL {
	if (!cachedClient) {
		cachedClient = createDatabaseClient();
	}
	return cachedClient;
}

// Proxy keeps the same sql API (tagged template + helper methods) while
// deferring the real client creation until first use.
export const sql = new Proxy(
	function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
		return getClient()(strings, ...values);
	} as unknown as SQL,
	{
		apply(_target, thisArg, argArray) {
			const client = getClient() as unknown as (...args: unknown[]) => unknown;
			return Reflect.apply(client, thisArg, argArray);
		},
		get(_target, prop, receiver) {
			const client = getClient() as object;
			const value = Reflect.get(client, prop, receiver);
			return typeof value === "function" ? value.bind(client) : value;
		},
	},
) as SQL;
