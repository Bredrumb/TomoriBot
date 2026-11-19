import { SQL } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "@/utils/misc/logger";
import { parseIntegerEnvFlag } from "@/utils/misc/envFlags";
import { recordPoolEvent, recordPoolRetryExhausted, recordPoolRetryRecovered } from "@/utils/db/poolEvents";

interface PostgresPoolOptions {
  idleTimeout: number;
  maxLifetime: number;
  connectionTimeout: number;
  max: number;
}

// Pool timeouts (seconds) stay under the ~4-minute silent gateway reap to avoid black-hole sockets, yet high because
// oven-sh/bun#30646 rejects in-flight queries.
function resolveProductionPoolOptions(): PostgresPoolOptions {
  return {
    // Well inside the ~4 minute gateway reap while giving Bun's buggy timer far fewer chances
    // to fire than the 30s this previously used.
    idleTimeout: parseIntegerEnvFlag(process.env.POSTGRES_IDLE_TIMEOUT_SECONDS, 180, 5),
    // Hard age cap so no connection lingers indefinitely even under steady load.
    maxLifetime: parseIntegerEnvFlag(process.env.POSTGRES_MAX_LIFETIME_SECONDS, 1800, 30),
    connectionTimeout: parseIntegerEnvFlag(process.env.POSTGRES_CONNECTION_TIMEOUT_SECONDS, 10, 1),
    // Stated rather than inherited so the pool width is auditable from this file and tunable
    // during an incident without a rebuild. Matches Bun's own default, so this is not a
    // behaviour change on its own.
    max: parseIntegerEnvFlag(process.env.POSTGRES_POOL_MAX, 10, 1),
  };
}

function createDatabaseClient(): SQL {
  const runEnv = process.env.RUN_ENV || "development";
  const host = process.env.POSTGRES_HOST || "localhost";
  const isProduction = runEnv === "production" && !skipsTlsForTestProduction(host);

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

  const poolOptions = resolveProductionPoolOptions();

  // Production: verified TLS for TCP connections; no TLS for unix sockets (Cloud SQL Auth Proxy)
  if (isProduction) {
    // Unix socket path (e.g. /cloudsql/<connection-name>): Cloud SQL Auth Proxy handles TLS
    // internally; the client connects via a local socket and must not add a second TLS layer.
    if (host.startsWith("/")) {
      return new SQL({
        path: host, // Use path for Unix socket connections
        port: port,
        username: user,
        password: password,
        database: database,
        ...poolOptions,
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
      ...poolOptions,
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
    ...poolOptions,
  });
}

const LOOPBACK_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Loopback host requirement prevents TEST_PRODUCTION=true from disabling TLS verification when a copied env points at
// a remote host.
export function skipsTlsForTestProduction(host: string, testProduction = process.env.TEST_PRODUCTION): boolean {
  return testProduction === "true" && LOOPBACK_DATABASE_HOSTS.has(host.trim().toLowerCase());
}

export interface ProductionPostgresTlsOptions {
  ca?: string;
  rejectUnauthorized: true;
}

// Azure PostgreSQL chains to public roots in Alpine ca-certificates, so only AWS RDS needs a bundled CA unless
// POSTGRES_CA_CERT_PATH overrides it.
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

function getClient(): SQL {
  if (!cachedClient) {
    cachedClient = createDatabaseClient();
  }
  return cachedClient;
}

// Schema or extension changes can invalidate PostgreSQL prepared statements, so clearing cachedClient forces a new
// session with a fresh plan cache.
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

// Bun pool timers (oven-sh/bun#30646) drop sockets mid-query without draining, so queries retry without calling
// resetDatabaseConnection on healthy pools.
const RETIRED_CONNECTION_ERROR_CODES = new Set([
  "ERR_POSTGRES_LIFETIME_TIMEOUT",
  "ERR_POSTGRES_IDLE_TIMEOUT",
  "ERR_POSTGRES_CONNECTION_CLOSED",
  // The next two reach us from the wire-protocol reader rather than the socket: when a
  // connection dies mid-message, Bun rejects the pending queries from `#onClose` carrying
  // whatever state its parser stopped in, so the code marks where the byte stream was
  // truncated. Neither code is exclusive to that path (Bun can also raise them from encoding
  // faults), so read the stack before the code when triaging: a replay costs one query, but a
  // real encoding bug retried here will look like ordinary connection churn in the logs.
  "ERR_POSTGRES_INVALID_MESSAGE",
  "ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE",
]);

/** @public Release-only `src/modules/supporter-billing/db/repositories/memberKeys.ts` imports this. */
export function isRetiredConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const { code } = error as { code?: unknown };
  return typeof code === "string" && RETIRED_CONNECTION_ERROR_CODES.has(code);
}

interface TransientRetryOptions {
  // Total attempts include the first try, so 1 disables retrying.
  attempts: number;
  delayMs: number;
}

function resolveTransientRetryOptions(): TransientRetryOptions {
  return {
    // Three rather than two because a cascade retires successive cohorts: production logged
    // `Exhausted 2 attempt(s)` 1,905 times in one episode and 103 times in eight minutes of
    // another, so the second attempt frequently lands inside the same cascade as the first.
    attempts: parseIntegerEnvFlag(process.env.POSTGRES_TRANSIENT_RETRY_ATTEMPTS, 3, 1),
    // A retired socket is replaced on the pool's next tick; retrying in the same tick
    // can land on the still-closing connection.
    delayMs: parseIntegerEnvFlag(process.env.POSTGRES_TRANSIENT_RETRY_DELAY_MS, 100, 0),
  };
}

// Full jitter spreads retries after a mass pool retirement fails in-flight callers together, preventing them from
// hammering replacement connections at once.
function jitteredDelayMs(delayMs: number): number {
  return delayMs <= 0 ? 0 : Math.floor(Math.random() * delayMs);
}

// Only replay-safe queries (reads, idempotent writes, or transactions) belong here because mid-commit drops can
// double-apply writes, and failures rethrow.
export async function withTransientDbRetry<T>(queryFn: () => Promise<T>, operationName: string): Promise<T> {
  const { attempts, delayMs } = resolveTransientRetryOptions();
  let sawRetiredConnection = false;

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await queryFn();
      if (sawRetiredConnection) {
        recordPoolRetryRecovered();
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isCachedPlanError = errorMessage.includes("cached plan must not change result type");
      const isRetiredConnection = isRetiredConnectionError(error);

      if (!isCachedPlanError && !isRetiredConnection) {
        throw error;
      }

      if (isRetiredConnection) {
        sawRetiredConnection = true;
        reportPoolEvent(error, operationName, attempt, attempts);
      }

      if (attempt >= attempts) {
        if (isRetiredConnection) {
          recordPoolRetryExhausted();
        }
        await log.error(`Exhausted ${attempt} attempt(s) for "${operationName}"`, error);
        throw error;
      }

      if (isCachedPlanError) {
        log.warn(`Cached plan error during "${operationName}", resetting connection and retrying`);
        resetDatabaseConnection();
        continue;
      }

      log.warn(
        `Pool retired the connection during "${operationName}" (attempt ${attempt}/${attempts}), retrying on a fresh connection`,
      );
      const backoff = jitteredDelayMs(delayMs);
      if (backoff > 0) {
        await Bun.sleep(backoff);
      }
    }
  }
}

// Only the episode-opening retirement is logged because logging every failed caller during a pool cascade obscures
// the root cause and adds log load.
function reportPoolEvent(error: unknown, operationName: string, attempt: number, attempts: number): void {
  const code = (error as { code?: string }).code ?? "unknown";
  const { maxLifetime } = resolveProductionPoolOptions();
  const { isFirstOfEpisode, uptimeS, lifetimePhaseS } = recordPoolEvent(code, maxLifetime);

  if (!isFirstOfEpisode) {
    return;
  }

  // `log.metric` rather than `log.error`: production pins pino at level `error`, so this is the
  // only route besides an error that reaches the host JSONL, and an episode marker is a
  // measurement rather than a fault the operator must act on line by line.
  log.metric("pool_event", {
    code,
    operation: operationName,
    attempt,
    attempts,
    uptime_s: uptimeS,
    lifetime_phase_s: lifetimePhaseS,
    max_lifetime_s: maxLifetime,
  });
}
