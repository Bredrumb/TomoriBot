import type { ErrorContext } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import pino from "pino";

/**
 * Feature flag to control database error logging
 * Set to false to rely on CloudWatch instead and reduce RDS costs
 */
const ENABLE_ERROR_DB_LOGGING = false;

/**
 * Standard color scheme for both console logs and Discord embeds
 */
export enum ColorCode {
  INFO = "#3498DB", // Cyan color
  SUCCESS = "#2ECC71", // Green color
  MEMORY_UPDATE = "#25d4da", // Aqua color
  WARN = "#F1C40F", // Yellow color
  ERROR = "#E74C3C", // Red color
  SECTION = "#E066FF", // Purple color
  AFFECTION = "#ff10cb", // Pink color
  RATE_LIMIT = "#FFA500", // Orange color
}

/**
 * Determines if non-essential logs should be shown based on environment
 * TEST_PRODUCTION mode: Show all logs even when RUN_ENV=production
 */
const isProduction = process.env.RUN_ENV === "production";
const isTestProduction = process.env.TEST_PRODUCTION === "true";
const shouldHideLogs = isProduction && !isTestProduction;
// const entrypointPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
// const isMaintenanceScript = entrypointPath.includes("/scripts/maintenance/");

/**
 * Check if pino-pretty is available (it's a devDependency, absent in production Docker builds).
 * Wrapping in try/catch avoids crashing when the package isn't installed.
 */
const hasPinoPretty = (() => {
  try {
    require.resolve("pino-pretty/package.json");
    return true;
  } catch {
    return false;
  }
})();

/**
 * Pino logger instance with custom levels and formatting
 */
const pinoLogger = pino({
  level: shouldHideLogs ? "error" : "info",
  customLevels: {
    success: 35, // Between info (30) and warn (40)
    section: 31, // Just above info (30)
    metric: 52, // Above error (50) so periodic metrics reach CloudWatch in production
    rateLimit: 55, // Between error (50) and fatal (60)
  },
  transport:
    !shouldHideLogs && hasPinoPretty
      ? {
          target: "pino-pretty",
          options: {
            colorize: false,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
            customLevels:
              "trace:10,debug:20,info:30,section:31,success:35,warn:40,error:50,metric:52,rateLimit:55,fatal:60",
          },
        }
      : undefined,
});

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  brightYellow: "\x1b[93m",
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isCloneSafeLogValue = (value: unknown): boolean =>
  value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);

const toLoggableError = (err: unknown): Record<string, unknown> => {
  if (err instanceof Error) {
    const safeExtraFields = Object.fromEntries(Object.entries(err).filter(([, value]) => isCloneSafeLogValue(value)));

    return {
      ...safeExtraFields,
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  if (isRecord(err)) return err;
  return { message: String(err) };
};

const toErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (isRecord(err)) {
    if (typeof err.message === "string") return err.message;
    try {
      return JSON.stringify(err);
    } catch {
      return "[unserializable object]";
    }
  }
  return String(err);
};

const toErrorStack = (err: unknown): string | null => {
  if (err instanceof Error) return err.stack ?? null;
  if (isRecord(err) && typeof err.stack === "string") return err.stack;
  return null;
};

/**
 * Logging utility for formatted info, success, error, warning, and section messages.
 * Uses Pino for structured logging with custom levels and pretty printing in development.
 */
export const log = {
  /**
   * Logs informational messages (hidden in production).
   * @param msg - The message to log.
   */
  info: (msg: string) => {
    pinoLogger.info(shouldHideLogs ? msg : `${colors.cyan}${msg}${colors.reset}`);
  },

  /**
   * Logs success messages (hidden in production).
   * @param msg - The message to log.
   */
  success: (msg: string) => {
    // Pino adds custom level methods at runtime, but TypeScript doesn't know about them
    // biome-ignore lint/suspicious/noExplicitAny: Custom Pino level added at runtime
    (pinoLogger as any).success(shouldHideLogs ? `✓ ${msg}` : `${colors.green}✓ ${msg}${colors.reset}`);
  },

  /**
   * Logs warning messages with optional error details (hidden in production).
   * @param msg - The warning message to log.
   * @param err - Optional error object to include.
   */
  warn: (msg: string, err?: unknown) => {
    const coloredMsg = shouldHideLogs ? msg : `${colors.yellow}${msg}${colors.reset}`;
    if (err) {
      pinoLogger.warn({ err: toLoggableError(err) }, coloredMsg);
    } else {
      pinoLogger.warn(coloredMsg);
    }
  },

  /**
   * Logs Discord API rate limit events.
   * Always shown in production for monitoring purposes.
   * @param msg - The rate limit message to log.
   * @param metadata - Optional metadata object with rate limit details.
   */
  rateLimit: (msg: string, metadata?: Record<string, unknown>) => {
    const coloredMsg = shouldHideLogs ? msg : `${colors.brightYellow}${msg}${colors.reset}`;
    // Pino adds custom level methods at runtime, but TypeScript doesn't know about them
    // biome-ignore lint/suspicious/noExplicitAny: Custom Pino level added at runtime
    const logger = pinoLogger as any;
    if (metadata) {
      logger.rateLimit({ metadata }, coloredMsg);
    } else {
      logger.rateLimit(coloredMsg);
    }
  },

  /**
   * Logs a periodic metric sample as structured JSON.
   * Always emitted regardless of environment (uses custom level 52, above `error`).
   * Intended for CloudWatch Logs Insights queries — pass flat numeric fields
   * so each metric becomes queryable at the top level of the log record.
   *
   * @param name - Short metric name (used as the `metric` field for filtering).
   * @param fields - Flat key/value map of numeric fields to attach to the log.
   */
  metric: (name: string, fields: Record<string, number | string>) => {
    // 1. Merge the metric name into the payload so it's queryable via `filter metric = "..."`
    const payload = { metric: name, ...fields };
    // 2. Pino adds custom level methods at runtime; TS doesn't know about them
    // biome-ignore lint/suspicious/noExplicitAny: Custom Pino level added at runtime
    (pinoLogger as any).metric(payload, `metric:${name}`);
  },

  /**
   * Logs an error message to the console and attempts to insert it into the database.
   * Always shown in production.
   * @param msg - The primary error message to log.
   * @param err - The actual Error object or unknown error data (optional).
   * @param context - Optional context containing IDs and metadata for DB logging.
   */
  error: async (msg: string, err?: unknown, context?: ErrorContext): Promise<void> => {
    const coloredMsg = shouldHideLogs ? msg : `${colors.red}${msg}${colors.reset}`;

    // 1. Log to console using Pino
    if (err) {
      pinoLogger.error(
        {
          err: toLoggableError(err),
          context,
        },
        coloredMsg,
      );
    } else {
      pinoLogger.error({ context }, coloredMsg);
    }

    // 2. Skip database logging if disabled (relying on CloudWatch instead)
    if (!ENABLE_ERROR_DB_LOGGING) {
      return;
    }

    // 3. Prepare data for database insertion
    const errorMessage = toErrorMessage(err);
    const stackTrace = toErrorStack(err);

    const dbPayload = {
      persona_id: context?.tomoriId ?? null,
      user_id: context?.userId ?? null,
      server_id: context?.serverId ?? null,
      error_type: context?.errorType ?? "GenericError",
      error_message: `${msg} - ${errorMessage}`,
      stack_trace: stackTrace,
      error_metadata: context?.metadata ? JSON.stringify(context.metadata) : null,
    };

    // 4. Attempt to insert into the database
    try {
      await sql`
                INSERT INTO error_logs (
                    persona_id, user_id, server_id,
                    error_type, error_message, stack_trace, error_metadata
                ) VALUES (
                    ${dbPayload.persona_id}, ${dbPayload.user_id}, ${dbPayload.server_id},
                    ${dbPayload.error_type}, ${dbPayload.error_message}, ${dbPayload.stack_trace},
                    ${dbPayload.error_metadata}::jsonb
                )
            `;
    } catch (dbError) {
      // Log DB insertion failure - avoid infinite recursion by using console directly
      console.error("\x1b[31m[DB LOG ERROR]\x1b[0m Failed to log error to database:");
      console.error(dbError instanceof Error ? (dbError.stack ?? dbError.message) : String(dbError));
      console.error("Original error payload:", dbPayload);
    }
  },

  /**
   * Logs section dividers for grouping related logs (hidden in production).
   * @param msg - The section title.
   */
  section: (msg: string) => {
    const coloredMsg = shouldHideLogs ? `\n=== ${msg} ===` : `${colors.magenta}\n=== ${msg} ===${colors.reset}`;
    // Pino adds custom level methods at runtime, but TypeScript doesn't know about them
    // biome-ignore lint/suspicious/noExplicitAny: Custom Pino level added at runtime
    (pinoLogger as any).section(coloredMsg);
  },
};
