import type { ErrorContext } from "@/types/db/schema";
import { sql } from "@/utils/db/client";

/**
 * Pre-built row payload for `error_logs` insertion.
 * Assembled by the logger before calling `insertErrorLog()`.
 */
export interface ErrorLogPayload {
  persona_id: number | null;
  user_id: number | null;
  server_id: number | null;
  error_type: string;
  error_message: string;
  stack_trace: string | null;
  /** JSON-serialized metadata string, or null. */
  error_metadata: string | null;
}

/**
 * Assembles an `ErrorLogPayload` from a raw message, error, and optional context.
 * Kept here so `logger.ts` never needs to import `sql` directly.
 *
 * @param msg     - Primary log message
 * @param err     - Raw error value from the catch block
 * @param context - Optional caller-supplied context IDs and metadata
 */
export function buildErrorLogPayload(msg: string, err: unknown, context?: ErrorContext): ErrorLogPayload {
  const errorMessage = toErrorMessage(err);
  const stackTrace = toErrorStack(err);

  return {
    persona_id: context?.personaId ?? null,
    user_id: context?.userId ?? null,
    server_id: context?.serverId ?? null,
    error_type: context?.errorType ?? "GenericError",
    error_message: `${msg} - ${errorMessage}`,
    stack_trace: stackTrace,
    error_metadata: context?.metadata ? JSON.stringify(context.metadata) : null,
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

/**
 * Thin repository for the `error_logs` table.
 *
 * Intentionally does NOT import `logger.ts`: this file sits between the
 * logger and the DB client, breaking the circular dependency.
 */
class ErrorLogRepository {
  /**
   * Inserts a structured error record into the `error_logs` table.
   * Throws on query failure so the logger can fall back to `console.error`.
   *
   * @param payload - Pre-assembled row data
   */
  async insertErrorLog(payload: ErrorLogPayload): Promise<void> {
    await sql`
      INSERT INTO error_logs (
        persona_id, user_id, server_id,
        error_type, error_message, stack_trace, error_metadata
      ) VALUES (
        ${payload.persona_id}, ${payload.user_id}, ${payload.server_id},
        ${payload.error_type}, ${payload.error_message}, ${payload.stack_trace},
        ${payload.error_metadata}::jsonb
      )
    `;
  }
}

/** Singleton: import this in callers. */
export const errorLogRepository = new ErrorLogRepository();
