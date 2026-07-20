import { SQL } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "@/utils/misc/logger";

/**
 * Creates and configures a PostgreSQL client using Bun's SQL constructor.
 *
 * SSL behaviour:
 * - Development (`RUN_ENV !== 'production'`): SSL disabled for localhost
 * - Production (`RUN_ENV === 'production'`): full TLS with CA certificate verification
 *
 * Azure and other public-CA providers use the operating-system trust store.
 * AWS RDS retains its maintained provider bundle for compatibility.
 *
 * @returns Configured SQL instance with appropriate TLS settings
 */
function createDatabaseClient(): SQL {
  const runEnv = process.env.RUN_ENV || "development";
  const isProduction = runEnv === "production" && process.env.TEST_PRODUCTION !== "true";

  // Build connection parameters from environment
  const host = process.env.POSTGRES_HOST || "localhost";
  const port = Number.parseInt(process.env.POSTGRES_PORT || "5432", 10);
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  // Allow initialization without password for scripts that don't use the database
  // (e.g., localization checks, linting). Database operations will fail if attempted.
  if (!password) {
    return new SQL({
      hostname: host,
      port: port,
      username: user,
      password: "dummy", // Will fail on actual connection attempt
      database: database,
    });
  }

  // Production: verified TLS for TCP connections; no TLS for unix sockets (Cloud SQL Auth Proxy)
  if (isProduction) {
    // Unix socket path (e.g. /cloudsql/<connection-name>) — Cloud SQL Auth Proxy handles TLS
    // internally; the client connects via a local socket and must not add a second TLS layer.
    if (host.startsWith("/")) {
      return new SQL({
        path: host, // Use path for Unix socket connections
        port: port,
        username: user,
        password: password,
        database: database,
        // biome-ignore lint/suspicious/noExplicitAny: `path` is a valid Bun SQL unix socket option not yet reflected in the type definitions
      } as any);
    }

    const tls = resolveProductionPostgresTls(host);

    return new SQL({
      hostname: host,
      port: port,
      username: user,
      password: password,
      database: database,
      tls,
    });
  }

  // Development: No SSL for localhost PostgreSQL
  log.info("Database SSL mode: disabled (development)");
  return new SQL({
    hostname: host,
    port: port,
    username: user,
    password: password,
    database: database,
  });
}

export interface ProductionPostgresTlsOptions {
  ca?: string;
  rejectUnauthorized: true;
}

/**
 * Select verified TLS trust without coupling Azure PostgreSQL to an AWS CA.
 *
 * Azure PostgreSQL certificates chain to public roots (including DigiCert Global
 * Root G2 and Microsoft RSA Root CA 2017), which are maintained by the Alpine
 * `ca-certificates` package in the production image. AWS RDS keeps its provider
 * bundle fallback, while an explicit POSTGRES_CA_CERT_PATH always takes priority.
 */
export function resolveProductionPostgresTls(
  host: string,
  configuredCaPath = process.env.POSTGRES_CA_CERT_PATH?.trim(),
): ProductionPostgresTlsOptions {
  const isAwsRds = host.toLowerCase().endsWith(".rds.amazonaws.com");
  const candidatePaths = [
    configuredCaPath,
    ...(isAwsRds
      ? [join(process.cwd(), "docker", "certs", "rds-ca-bundle.pem"), join(process.cwd(), "certs", "rds-ca-bundle.pem")]
      : []),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const certPath = candidatePaths.find((candidate) => existsSync(candidate));

  if (configuredCaPath && !certPath) {
    throw new Error(`Configured PostgreSQL CA bundle was not found: ${configuredCaPath}`);
  }

  if (isAwsRds && !certPath) {
    throw new Error(
      "AWS RDS requires its maintained CA bundle. " +
        `Searched paths: ${candidatePaths.join(", ")}. ` +
        "Set POSTGRES_CA_CERT_PATH to the correct file if needed.",
    );
  }

  if (certPath) {
    try {
      return {
        ca: readFileSync(certPath, "utf8"),
        rejectUnauthorized: true,
      };
    } catch (error) {
      void log.error("Failed to load the configured PostgreSQL CA bundle", error);
      throw new Error(`Unable to read PostgreSQL CA bundle: ${certPath}`);
    }
  }

  // Omitting `ca` delegates root maintenance to the operating-system trust
  // store while `rejectUnauthorized` preserves chain and hostname validation.
  return { rejectUnauthorized: true };
}

// Lazily create the client so secrets/env vars are set first (avoids premature
// initialization when modules import sql before dotenv/Secrets Manager runs).
let cachedClient: SQL | null = null;

/**
 * Gets the singleton database client, creating it on first access.
 *
 * @returns Configured SQL client instance
 */
function getClient(): SQL {
  if (!cachedClient) {
    cachedClient = createDatabaseClient();
  }
  return cachedClient;
}

/**
 * Resets the database connection by clearing the cached client.
 * This forces a new connection on the next query, which clears PostgreSQL
 * prepared statement cache and resolves "cached plan must not change result type" errors.
 *
 * Use this when schema changes (migrations, extension installations) cause
 * prepared statement cache invalidation.
 */
export function resetDatabaseConnection(): void {
  if (cachedClient) {
    cachedClient = null;
    log.warn("Database connection reset (prepared statement cache cleared)");
  }
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

/**
 * Executes a database query with automatic retry on cached plan errors.
 *
 * When PostgreSQL prepared statements become stale after schema changes,
 * this wrapper detects the error, resets the connection (clearing the cache),
 * and retries the query once.
 *
 * @param queryFn - Async function that executes the database query
 * @param operationName - Descriptive name for logging (e.g., "load user", "load reminders")
 * @returns Query result or null on failure
 *
 * @example
 * ```typescript
 * const reminders = await withCachedPlanRetry(
 *   async () => await sql`SELECT * FROM reminders WHERE due_at <= NOW()`,
 *   "load due reminders"
 * );
 * ```
 */
export async function withCachedPlanRetry<T>(queryFn: () => Promise<T>, operationName: string): Promise<T | null> {
  try {
    return await queryFn();
  } catch (error) {
    // Check if this is a cached plan error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isCachedPlanError = errorMessage.includes("cached plan must not change result type");

    if (isCachedPlanError) {
      log.warn(`Cached plan error during "${operationName}", resetting connection and retrying`);
      resetDatabaseConnection();

      try {
        return await queryFn();
      } catch (retryError) {
        await log.error(`Retry failed for "${operationName}"`, retryError);
        return null;
      }
    }

    throw error;
  }
}
