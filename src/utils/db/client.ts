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

  // Production: TLS for TCP connections (AWS RDS); no TLS for unix sockets (Cloud SQL Auth Proxy)
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

    // TCP connection (AWS RDS) — TLS with CA certificate verification
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
      console.error("\x1b[31m[ERROR]\x1b[0m Failed to load AWS RDS CA certificate:", error);
      throw new Error(
        "Production database requires a CA certificate. " +
          `Searched paths: ${candidatePaths.join(", ")}. ` +
          "Set POSTGRES_CA_CERT_PATH to the correct file if needed.",
      );
    }
  }

  // Development: No SSL for localhost PostgreSQL
  console.log("\x1b[36m[INFO]\x1b[0m Database SSL mode: disabled (development)");
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
    // Bun's SQL client doesn't have an explicit close method, but clearing
    // the reference allows garbage collection and forces reconnection
    cachedClient = null;
    console.log("\x1b[33m[WARN]\x1b[0m Database connection reset (prepared statement cache cleared)");
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
      console.log(
        `\x1b[33m[WARN]\x1b[0m Cached plan error detected during ${operationName}, resetting connection and retrying...`,
      );

      // Reset the connection to clear prepared statement cache
      resetDatabaseConnection();

      try {
        // Retry the query with fresh connection
        return await queryFn();
      } catch (retryError) {
        console.error(`\x1b[31m[ERROR]\x1b[0m Retry failed for ${operationName}:`, retryError);
        return null;
      }
    }

    // Not a cached plan error - rethrow for normal error handling
    throw error;
  }
}
