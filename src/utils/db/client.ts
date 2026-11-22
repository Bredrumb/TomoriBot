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

// The idle timeout stays below four minutes because the gateway can silently drop idle sockets around that point.
function resolveProductionPoolOptions(): PostgresPoolOptions {
  return {
    idleTimeout: parseIntegerEnvFlag(process.env.POSTGRES_IDLE_TIMEOUT_SECONDS, 180, 5),
    maxLifetime: parseIntegerEnvFlag(process.env.POSTGRES_MAX_LIFETIME_SECONDS, 1800, 30),
    connectionTimeout: parseIntegerEnvFlag(process.env.POSTGRES_CONNECTION_TIMEOUT_SECONDS, 10, 1),
    max: parseIntegerEnvFlag(process.env.POSTGRES_POOL_MAX, 10, 1),
  };
}

function createUnconfiguredDatabaseError(): Error {
  return new Error("Database is not configured (POSTGRES_PASSWORD is unset)");
}

function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && "raw" in value;
}

// Reject only on consumption so un-awaited SQL fragments like `ownedServersOnly()` do not emit unhandled rejections.
function createUnconfiguredQuery(): PromiseLike<never> & {
  execute(): Promise<never>;
  catch<TResult = never>(onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null): Promise<TResult>;
  finally(onfinally?: (() => void) | null): Promise<never>;
} {
  const fail = () => Promise.reject(createUnconfiguredDatabaseError());
  return {
    execute: fail,
    // biome-ignore lint/suspicious/noThenProperty: lazy thenable matches Bun SQLQuery so un-awaited SQL fragments stay silent
    then(onfulfilled, onrejected) {
      return fail().then(onfulfilled, onrejected);
    },
    catch(onrejected) {
      return fail().catch(onrejected);
    },
    finally(onfinally) {
      return fail().finally(onfinally);
    },
  };
}

// Bun's array helper marshals values locally, so tests can build SQL arrays without opening a database connection.
const unconfiguredArrayMarshaller = new SQL({
  hostname: "127.0.0.1",
  port: 0,
  username: "postgres",
  password: "dummy",
  database: "tomodb",
});

const unconfiguredDatabaseClient = Object.assign(
  function unconfiguredSql(first: unknown, ...rest: unknown[]) {
    if (isTemplateStringsArray(first)) {
      return createUnconfiguredQuery();
    }
    return { values: [first, ...rest] };
  },
  {
    array: unconfiguredArrayMarshaller.array.bind(unconfiguredArrayMarshaller),
    begin: () => Promise.reject(createUnconfiguredDatabaseError()),
    transaction: () => Promise.reject(createUnconfiguredDatabaseError()),
    unsafe: () => createUnconfiguredQuery(),
    reserve: () => Promise.reject(createUnconfiguredDatabaseError()),
    connect: () => Promise.reject(createUnconfiguredDatabaseError()),
    close: async () => undefined,
  },
) as unknown as SQL;

function createDatabaseClient(): SQL {
  const runEnv = process.env.RUN_ENV || "development";
  const host = process.env.POSTGRES_HOST || "localhost";
  const isProduction = runEnv === "production" && !skipsTlsForTestProduction(host);

  const port = Number.parseInt(process.env.POSTGRES_PORT || "5432", 10);
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    return unconfiguredDatabaseClient;
  }

  const poolOptions = resolveProductionPoolOptions();

  if (isProduction) {
    // The Cloud SQL Auth Proxy handles TLS, so its Unix socket connects without a second TLS layer.
    if (host.startsWith("/")) {
      return new SQL({
        path: host,
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

// The loopback check keeps TLS enabled when a copied test environment points at a remote database.
export function skipsTlsForTestProduction(host: string, testProduction = process.env.TEST_PRODUCTION): boolean {
  return testProduction === "true" && LOOPBACK_DATABASE_HOSTS.has(host.trim().toLowerCase());
}

export interface ProductionPostgresTlsOptions {
  ca?: string;
  rejectUnauthorized: true;
}

// Azure PostgreSQL can use the system trust store because its certificates chain to public roots.
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

  return { rejectUnauthorized: true };
}

// Defer client creation because modules can import `sql` before credentials are loaded.
let cachedClient: SQL | null = null;

function getClient(): SQL {
  if (!process.env.POSTGRES_PASSWORD) {
    return unconfiguredDatabaseClient;
  }
  if (!cachedClient) {
    cachedClient = createDatabaseClient();
  }
  return cachedClient;
}

// Schema changes can invalidate prepared plans, so the next query needs a fresh session.
export function resetDatabaseConnection(): void {
  if (cachedClient) {
    cachedClient = null;
    log.warn("Database connection reset (prepared statement cache cleared)");
  }
}

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
  // Bun can report these parser codes on both truncated replies and encoding faults, so check the stack.
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
    // Three rather than two because pool cascades retire successive cohorts, so a second try often hits the same cascade.
    attempts: parseIntegerEnvFlag(process.env.POSTGRES_TRANSIENT_RETRY_ATTEMPTS, 3, 1),
    // A retired socket is replaced on the pool's next tick; retrying in the same tick
    // can land on the still-closing connection.
    delayMs: parseIntegerEnvFlag(process.env.POSTGRES_TRANSIENT_RETRY_DELAY_MS, 100, 0),
  };
}

// Jitter spreads retries because a pool retirement can reject many queries at once.
function jitteredDelayMs(delayMs: number): number {
  return delayMs <= 0 ? 0 : Math.floor(Math.random() * delayMs);
}

// Retry only operations safe to replay because losing the commit acknowledgement can cause a write to run twice.
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

function reportPoolEvent(error: unknown, operationName: string, attempt: number, attempts: number): void {
  const code = (error as { code?: string }).code ?? "unknown";
  const { maxLifetime } = resolveProductionPoolOptions();
  const { isFirstOfEpisode, uptimeS, lifetimePhaseS } = recordPoolEvent(code, maxLifetime);

  if (!isFirstOfEpisode) {
    return;
  }

  // Production retains this metric at error log level so a pool retirement can be tracked without paging.
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
