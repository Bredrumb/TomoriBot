import type { ErrorContext } from "@/types/db/schema";
import { buildErrorLogPayload, errorLogRepository } from "@/utils/db/repositories/ErrorLogRepository";
import { resolveErrorContext } from "@/utils/misc/errorContextStore";
import pino from "pino";

// Env flag is read per call rather than cached at module load so tests and a running process can flip DB error
// logging without restarting.
function isErrorDbLoggingEnabled(): boolean {
  const raw = process.env.ERROR_DB_LOGGING_ENABLED;
  if (raw === undefined) return true;
  return ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
}

export enum ColorCode {
  INFO = "#3498DB",
  SUCCESS = "#2ECC71",
  MEMORY_UPDATE = "#25d4da",
  WARN = "#F1C40F",
  ERROR = "#E74C3C",
  SECTION = "#E066FF",
  AFFECTION = "#ff10cb",
  RATE_LIMIT = "#FFA500",
}

const isProduction = process.env.RUN_ENV === "production";
const isTestProduction = process.env.TEST_PRODUCTION === "true";
const shouldHideLogs = isProduction && !isTestProduction;

// Probed via try/catch because pino-pretty is a devDependency omitted from production Docker images and must not
// crash startup.
const hasPinoPretty = (() => {
  try {
    require.resolve("pino-pretty/package.json");
    return true;
  } catch {
    return false;
  }
})();

const usePrettyTransport = !shouldHideLogs && hasPinoPretty;

const LOG_LEVEL_NAMES = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

// Production defaults to error because warn is noisy trace, and unknown values fall back to default so typos never
// silence errors.
export function resolveLogLevel(raw: string | undefined, hideLogs: boolean): string {
  const requested = raw?.trim().toLowerCase();
  if (requested && (LOG_LEVEL_NAMES as readonly string[]).includes(requested)) return requested;
  return hideLogs ? "error" : "info";
}

// JSON mode keeps metrics at any LOG_LEVEL for host queries, while pretty mode uses baseLevel so samples show only at
// debug or trace.
export function resolveMetricLevel(prettyTransport: boolean, baseLevel: string): string {
  return prettyTransport ? baseLevel : "metric";
}

const logFilePath = process.env.TOMORI_LOG_FILE?.trim() || undefined;

const REDACTED = "[REDACTED]";
const SENSITIVE_LOG_KEYS = [
  "authorization",
  "proxyAuthorization",
  "cookie",
  "setCookie",
  "password",
  "passwd",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "clientSecret",
  "databaseUrl",
  "postgresUrl",
  "webhookUrl",
  "signedUrl",
] as const;

export const LOG_REDACTION_PATHS = SENSITIVE_LOG_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
  `*.*.*.${key}`,
  `*.*.*.*.${key}`,
]);

// JSON logs duplicate to stdout for Docker diagnostics and write synchronously to the file sink so no lines are lost
// on a crash.
export const buildLogStreams = (
  filePath: string | undefined,
  stdoutStream: pino.DestinationStream = process.stdout,
  createFileStream: (dest: string) => pino.DestinationStream = (dest) =>
    pino.destination({ dest, append: true, mkdir: true, sync: true }),
): pino.StreamEntry[] | undefined => {
  if (!filePath) return undefined;

  // "trace" lets every record through each sink; level filtering stays on the
  // logger itself so both outputs always carry identical lines
  return [
    { stream: stdoutStream, level: "trace" },
    { stream: createFileStream(filePath), level: "trace" },
  ];
};

// Left undefined when pretty-printing is active because Pino forbids combining a transport with an explicit stream.
const jsonStreams = usePrettyTransport ? undefined : buildLogStreams(logFilePath);

const pinoLogger = pino(
  {
    level: resolveLogLevel(process.env.LOG_LEVEL, shouldHideLogs),
    customLevels: {
      success: 35,
      section: 31,
      // Below Pino info (30) so severity queries (level >= 40) exclude samples, while metricLogger selects visibility.
      metric: 25,
      rateLimit: 55,
    },
    redact: {
      paths: LOG_REDACTION_PATHS,
      censor: REDACTED,
    },
    transport: usePrettyTransport
      ? {
          target: "pino-pretty",
          options: {
            colorize: false,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
            customLevels:
              "trace:10,debug:20,metric:25,info:30,section:31,success:35,warn:40,error:50,rateLimit:55,fatal:60",
          },
        }
      : undefined,
  },
  jsonStreams ? pino.multistream(jsonStreams) : undefined,
);

// Pino attaches custom level methods dynamically at runtime without base types, so this interface centralizes the
// cast instead of using any at call sites.
interface CustomLevelLogger extends pino.Logger {
  success(message: string): void;
  section(message: string): void;
  metric(payload: Record<string, unknown>, message: string): void;
  rateLimit(payload: Record<string, unknown>, message: string): void;
}

// biome-ignore lint/suspicious/noExplicitAny: Pino adds the custom level methods at runtime
const customLevels = pinoLogger as any as CustomLevelLogger;

const metricLogger = customLevels.child(
  {},
  { level: resolveMetricLevel(usePrettyTransport, pinoLogger.level) },
) as CustomLevelLogger;

const diagnosticLogger = pinoLogger.child({}, { level: usePrettyTransport ? pinoLogger.level : "warn" });

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  brightYellow: "\x1b[93m",
};

const isCloneSafeLogValue = (value: unknown): boolean =>
  value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);

function normalizeSensitiveKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const SENSITIVE_NORMALIZED_KEYS = new Set(SENSITIVE_LOG_KEYS.map(normalizeSensitiveKey));

// Optional cap on logged strings because base64 URIs are already collapsed in redactLogString without truncating prose.
function getLogMaxStringLength(): number | undefined {
  const envVal = process.env.LOG_MAX_STRING_LENGTH;
  if (!envVal) return undefined;
  const parsed = Number.parseInt(envVal, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Redaction runs this far past the cap before the tail is dropped, so a credential straddling the cut
// is matched whole; cutting first could leave a password that lost its trailing `@` unredacted.
const REDACTION_OVERLAP_CHARS = 512;

function redactLogValues(value: string, redactValues: readonly string[] = []): string {
  return redactValues.reduce((text, secret) => (secret ? text.replaceAll(secret, REDACTED) : text), value);
}

function sanitizeLogString(value: string, redactValues: readonly string[] = []): string {
  value = redactLogValues(value, redactValues);
  const maxStringLength = getLogMaxStringLength();
  if (!maxStringLength || value.length <= maxStringLength) {
    return redactLogString(value);
  }
  const redactedHead = redactLogString(value.slice(0, maxStringLength + REDACTION_OVERLAP_CHARS));
  const truncatedSuffix = `...[TRUNCATED ${value.length - maxStringLength} chars]`;
  const truncatedText = `${redactedHead.slice(0, maxStringLength)}${truncatedSuffix}`;
  return value.includes("\x1b[") ? `${truncatedText}${colors.reset}` : truncatedText;
}

// Patterns here match credentials by shape alone, so they stay safe to apply to free prose without structured-log
// false positives.
const CREDENTIAL_REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/((?:https?|postgres(?:ql)?):\/\/[^:\s/@]+:)[^@\s/]+@/gi, `$1${REDACTED}@`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/g, `$1${REDACTED}`],
  [
    /([?&](?:access_token|refresh_token|token|api[_-]?key|key|signature|sig|x-amz-signature)=)[^&#\s]+/gi,
    `$1${REDACTED}`,
  ],
  [/\b(sk-(?:proj-|ant-|or-)?(?:live-)?[a-zA-Z0-9_-]{20,})\b/gi, REDACTED],
  [/\b(AIza[0-9A-Za-z\-_]{30,40})\b/g, REDACTED],
  [/\b(nvapi-[a-zA-Z0-9_-]{20,})\b/gi, REDACTED],
  // discord.js request URLs carry the API version (`/api/v10/webhooks/<id>/<token>`), unlike pasted webhook URLs.
  [
    /(https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/[^/\s]+\/)[^/?\s]+/gi,
    `$1${REDACTED}`,
  ],
];

// Key: value and Basic heuristics from redactLogString are omitted because they match ordinary prose such as basic
// training.
export function containsCredential(value: string): boolean {
  // `search` ignores and preserves `lastIndex`, so the shared global patterns stay stateless here.
  return CREDENTIAL_REDACTIONS.some(([pattern]) => value.search(pattern) !== -1);
}

function redactCredentialString(value: string): string {
  return CREDENTIAL_REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function redactLogString(value: string): string {
  const credentialsRedacted = redactCredentialString(
    value.replace(/(data:[a-z0-9/._\\+-]+;base64,)[A-Za-z0-9+/=]{80,}/gi, `$1...[BASE64 TRUNCATED]`),
  );
  return credentialsRedacted
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${REDACTED}`)
    .replace(
      /((?:\\?["'])?(?:api[_-]?key|apikey|token|secret|authorization|password|passwd|client[_-]?secret)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[^\s,"'\\]+/gi,
      `$1${REDACTED}`,
    );
}

export function sanitizeCredentialPayload(value: unknown, redactSensitiveKeys = false, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redactCredentialString(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((entry) => sanitizeCredentialPayload(entry, redactSensitiveKeys, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] =
      redactSensitiveKeys && SENSITIVE_NORMALIZED_KEYS.has(normalizeSensitiveKey(key))
        ? REDACTED
        : sanitizeCredentialPayload(entry, redactSensitiveKeys, depth + 1);
  }
  return output;
}

export function sanitizeLogPayload(
  value: unknown,
  depth = 0,
  truncateStrings = true,
  redactValues: readonly string[] = [],
): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string")
    return truncateStrings
      ? sanitizeLogString(value, redactValues)
      : redactLogString(redactLogValues(value, redactValues));
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((entry) => sanitizeLogPayload(entry, depth + 1, truncateStrings, redactValues));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[redactLogValues(key, redactValues)] = SENSITIVE_NORMALIZED_KEYS.has(normalizeSensitiveKey(key))
      ? REDACTED
      : sanitizeLogPayload(entry, depth + 1, truncateStrings, redactValues);
  }
  return output;
}

// Metric strings are redacted because metrics emit at every log level, while numbers pass through unchanged so host
// queries stay numeric.
export function buildMetricPayload(name: string, fields: Record<string, number | string>): Record<string, unknown> {
  return sanitizeLogPayload({ metric: name, ...fields }) as Record<string, unknown>;
}

const toLoggableError = (err: unknown, redactValues: readonly string[] = []): Record<string, unknown> => {
  if (err instanceof Error) {
    const safeExtraFields = Object.fromEntries(Object.entries(err).filter(([, value]) => isCloneSafeLogValue(value)));

    return sanitizeLogPayload(
      {
        ...safeExtraFields,
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
      0,
      true,
      redactValues,
    ) as Record<string, unknown>;
  }
  if (typeof err === "object" && err !== null)
    return sanitizeLogPayload(err, 0, true, redactValues) as Record<string, unknown>;
  return { message: sanitizeLogString(String(err), redactValues) };
};

export const log = {
  info: (msg: string) => {
    const sanitizedMsg = sanitizeLogString(msg);
    pinoLogger.info(shouldHideLogs ? sanitizedMsg : `${colors.cyan}${sanitizedMsg}${colors.reset}`);
  },

  success: (msg: string) => {
    const sanitizedMsg = sanitizeLogString(msg);
    customLevels.success(shouldHideLogs ? `✓ ${sanitizedMsg}` : `${colors.green}✓ ${sanitizedMsg}${colors.reset}`);
  },

  // Retained diagnostics bypass the JSON level filter so expected provider refusals remain diagnosable even when
  // production defaults to error.
  warn: (
    msg: string,
    err?: unknown,
    context?: ErrorContext,
    options?: { retain?: boolean; redactValues?: readonly string[] },
  ) => {
    const sanitizedPlainMsg = sanitizeLogString(msg, options?.redactValues);
    const coloredMsg = shouldHideLogs ? sanitizedPlainMsg : `${colors.yellow}${sanitizedPlainMsg}${colors.reset}`;
    const resolvedContext = resolveErrorContext(context);
    const sanitizedContext = sanitizeLogPayload(resolvedContext, 0, true, options?.redactValues);
    const sanitizedError = err ? toLoggableError(err, options?.redactValues) : undefined;
    const logger = options?.retain ? diagnosticLogger : pinoLogger;
    if (sanitizedError) {
      logger.warn({ err: sanitizedError, context: sanitizedContext }, coloredMsg);
    } else {
      logger.warn({ context: sanitizedContext }, coloredMsg);
    }
  },

  rateLimit: (msg: string, metadata?: Record<string, unknown>) => {
    const sanitizedMsg = sanitizeLogString(msg);
    const coloredMsg = shouldHideLogs ? sanitizedMsg : `${colors.brightYellow}${sanitizedMsg}${colors.reset}`;
    if (metadata) {
      customLevels.rateLimit({ metadata: sanitizeLogPayload(metadata) }, coloredMsg);
    } else {
      customLevels.rateLimit({}, coloredMsg);
    }
  },

  // Metric string fields must come from a fixed dimension set rather than free text so log queries can group and
  // aggregate samples.
  metric: (name: string, fields: Record<string, number | string>) => {
    metricLogger.metric(buildMetricPayload(name, fields), `metric:${name}`);
  },

  // Database-path failures must pass persist: false so logging avoids queueing onto the failing pool, and expected
  // refusals belong in warn and metric.
  error: async (
    msg: string,
    err?: unknown,
    context?: ErrorContext,
    options?: { persist?: boolean; redactValues?: readonly string[] },
  ): Promise<void> => {
    const sanitizedPlainMsg = sanitizeLogString(msg, options?.redactValues);
    const coloredMsg = shouldHideLogs ? sanitizedPlainMsg : `${colors.red}${sanitizedPlainMsg}${colors.reset}`;
    const resolvedContext = resolveErrorContext(context);
    const sanitizedContext = sanitizeLogPayload(resolvedContext, 0, true, options?.redactValues) as
      | ErrorContext
      | undefined;
    const sanitizedError = err ? toLoggableError(err, options?.redactValues) : undefined;

    if (sanitizedError) {
      pinoLogger.error({ err: sanitizedError, context: sanitizedContext }, coloredMsg);
    } else {
      pinoLogger.error({ context: sanitizedContext }, coloredMsg);
    }

    if (options?.persist === false || !isErrorDbLoggingEnabled()) {
      return;
    }

    const dbPayload = buildErrorLogPayload(sanitizedPlainMsg, sanitizedError, sanitizedContext);

    // Skips and DB insert failures stay unlogged because the host file already captured the error and extra logs
    // cause storms during outages.
    try {
      await errorLogRepository.insertErrorLog(dbPayload);
    } catch (dbError) {
      pinoLogger.error({ err: toLoggableError(dbError) }, "Failed to persist the sanitized error record");
    }
  },

  section: (msg: string) => {
    if (!shouldHideLogs) {
      const sanitizedMsg = sanitizeLogString(msg);
      const coloredMsg = shouldHideLogs
        ? `\n=== ${sanitizedMsg} ===`
        : `${colors.magenta}\n=== ${sanitizedMsg} ===${colors.reset}`;
      customLevels.section(coloredMsg);
    }
  },
};
