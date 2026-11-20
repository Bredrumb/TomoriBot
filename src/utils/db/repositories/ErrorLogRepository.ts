import type { ErrorContext } from "@/types/db/schema";
import { sql } from "@/utils/db/client";

export interface ErrorLogPayload {
  persona_id: number | null;
  user_id: number | null;
  server_id: number | null;
  error_type: string;
  error_message: string;
  stack_trace: string | null;
  // Must stay an object rather than JSON.stringify output because Bun binds strings as text and ::jsonb turns them
  // into scalar strings, breaking JSONB operators.
  error_metadata: Record<string, unknown> | null;
}

export function buildErrorLogPayload(msg: string, err: unknown, context?: ErrorContext): ErrorLogPayload {
  const stackTrace = toErrorStack(err);

  // Mirrors `logger.error`'s `if (err)` branch so omitted-error calls do not append literal " - undefined" to rows.
  const errorMessage = err ? ` - ${toErrorMessage(err)}` : "";

  return {
    persona_id: context?.personaId ?? null,
    user_id: context?.userId ?? null,
    server_id: context?.serverId ?? null,
    error_type: context?.errorType ?? "GenericError",
    error_message: `${msg}${errorMessage}`,
    stack_trace: stackTrace,
    error_metadata: context?.metadata ?? null,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function toErrorMessage(err: unknown): string {
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
}

function toErrorStack(err: unknown): string | null {
  if (err instanceof Error) return err.stack ?? null;
  if (isRecord(err) && typeof err.stack === "string") return err.stack;
  return null;
}

const DEFAULT_BREAKER_THRESHOLD = 5;
const DEFAULT_BREAKER_COOLDOWN_MS = 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type ErrorLogWriteResult = "written" | "skipped_breaker_open" | "failed";

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Must not statically import logger.ts because client, logger, and this module form a circular dependency.
export class ErrorLogRepository {
  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;
  private lastPruneAt = 0;

  // Injected db avoids mock.module test leaks and must resolve per call instead of a = sql default because the client
  // cycle leaves sql in TDZ at startup.
  constructor(private readonly db?: typeof sql) {}

  private get executor(): typeof sql {
    return this.db ?? sql;
  }

  // Circuit breaker skips DB inserts during outages so error storms do not hammer a failing pool, while host JSONL
  // still captures every record.
  async insertErrorLog(payload: ErrorLogPayload): Promise<ErrorLogWriteResult> {
    if (Date.now() < this.breakerOpenUntil) {
      return "skipped_breaker_open";
    }

    // Called through a local so `this` stays undefined at the call site, matching a bare `sql`.
    const run = this.executor;
    try {
      await run`
        INSERT INTO error_logs (
          persona_id, user_id, server_id,
          error_type, error_message, stack_trace, error_metadata
        ) VALUES (
          ${payload.persona_id}, ${payload.user_id}, ${payload.server_id},
          ${payload.error_type}, ${payload.error_message}, ${payload.stack_trace},
          ${payload.error_metadata}
        )
      `;
      this.consecutiveFailures = 0;
      await this.pruneIfDue();
      return "written";
    } catch {
      this.consecutiveFailures += 1;
      const threshold = positiveIntFromEnv("ERROR_DB_LOGGING_BREAKER_THRESHOLD", DEFAULT_BREAKER_THRESHOLD);
      if (this.consecutiveFailures >= threshold) {
        const cooldownMs = positiveIntFromEnv("ERROR_DB_LOGGING_BREAKER_COOLDOWN_MS", DEFAULT_BREAKER_COOLDOWN_MS);
        this.breakerOpenUntil = Date.now() + cooldownMs;
        this.consecutiveFailures = 0;
      }
      return "failed";
    }
  }

  // Retention rides the write path because pg_cron is absent in production and skipped when schema management is
  // disabled, so scheduled pruning would not run.
  private async pruneIfDue(): Promise<void> {
    const intervalMs = positiveIntFromEnv("ERROR_LOG_PRUNE_INTERVAL_MS", DEFAULT_PRUNE_INTERVAL_MS);
    const now = Date.now();
    if (now - this.lastPruneAt < intervalMs) {
      return;
    }

    // Claim the slot before awaiting, so two overlapping errors cannot both prune.
    this.lastPruneAt = now;

    const retentionDays = positiveIntFromEnv("ERROR_LOG_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
    const run = this.executor;
    try {
      await run`
        DELETE FROM error_logs
        WHERE created_at < CURRENT_TIMESTAMP - MAKE_INTERVAL(days => ${retentionDays})
      `;
    } catch {
      // A failed prune is not worth reporting from inside error handling: the next
      // interval retries, and surfacing it here risks amplifying the storm it rode in on.
    }
  }
}

export const errorLogRepository = new ErrorLogRepository();
