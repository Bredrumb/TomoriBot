/**
 * Aggregate recording and logging for terminal provider failures.
 *
 * Kept as its own leaf module so `src/types/stream/interfaces.ts` (where `BaseStreamAdapter`
 * lives) takes on exactly one narrow runtime dependency instead of pulling the repository layer
 * into a file almost everything imports.
 *
 * Scope constraint: this is operational telemetry only. Nothing behavioral may read the
 * `provider_error` counter, so no persona, routing, or model-selection decision ever takes a
 * failure rate as input.
 */

import type { ProviderError, StreamContext } from "@/types/stream/interfaces";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { log, redactLogString } from "@/utils/misc/logger";
import {
  formatProviderErrorCodeForDisplay,
  getProviderErrorDetail,
  isOperatorActionableProviderError,
} from "@/utils/provider/providerErrorClassification";
import { readBoundedResponse } from "@/utils/security/boundedResponse";

const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;
const OPERATOR_ERROR_DETAIL_CHARS = 2000;

export function redactProviderDetail(detail: string, apiKey: string): string {
  return redactLogString(apiKey ? detail.replaceAll(apiKey, "[REDACTED]") : detail);
}

export async function readProviderErrorBody(response: Response, apiKey: string): Promise<string> {
  try {
    return redactProviderDetail(
      (await readBoundedResponse(response, MAX_PROVIDER_ERROR_BYTES)).toString("utf8"),
      apiKey,
    );
  } catch (error) {
    return redactProviderDetail(
      `Response body unavailable: ${error instanceof Error ? error.message : String(error)}`,
      apiKey,
    );
  }
}

export interface ProviderFailureReport {
  /** Stable prefix shared by every record of this failure, so operators can filter on it. */
  summary: string;
  errorType: string;
  error: unknown;
  /**
   * Bad input, cancellation, timeouts, and authentication or quota refusals. These are counted and
   * traced without an `error_logs` row.
   */
  expected: boolean;
  /** Provider status and response body, already scrubbed of the request's own credential. */
  detail?: string;
  serverId?: number | null;
  userId?: number | null;
  /** Metric dimensions drawn from fixed sets; they are also copied into the record's metadata. */
  dimensions: Record<string, string | number>;
  metadata?: Record<string, unknown>;
  /** Exact credentials removed from the message, attached error, and metadata before truncation or persistence. */
  redactValues?: readonly string[];
}

/**
 * Logs a failure at the point a pipeline converts it into a result object, a reply, or a tool error.
 * The message carries `detail` unchanged, so the record matches what a gated "Show Full Error"
 * modal displays.
 */
export async function reportProviderFailure(report: ProviderFailureReport): Promise<void> {
  const message = report.detail ? `${report.summary}: ${report.detail}` : report.summary;
  const context = {
    ...(report.serverId != null ? { serverId: report.serverId } : {}),
    ...(report.userId != null ? { userId: report.userId } : {}),
    errorType: report.errorType,
    metadata: { ...report.dimensions, ...report.metadata },
  };
  if (report.expected) {
    log.metric("provider_failure", { errorType: report.errorType, ...report.dimensions });
    log.warn(message, report.error, context, { retain: true, redactValues: report.redactValues });
    return;
  }
  await log.error(message, report.error, context, { redactValues: report.redactValues });
}

/**
 * Reports a provider failure chunk once per stream attempt, whether or not the user sees it, so
 * callers handling the returned result must not report it again.
 * @param args.requestApiKey - The key this attempt sent, which may be a personal or rotated key rather than the server's.
 * @param args.denied - TomoriBot refused the request itself, so there is no provider text and no incident.
 * @param args.surfaced - Whether the error UI will show this failure to the user.
 */
export async function reportStreamProviderFailure(args: {
  providerError: ProviderError;
  providerName: string;
  context: StreamContext;
  requestApiKey: string;
  denied: boolean;
  surfaced: boolean;
}): Promise<void> {
  const { providerError, context } = args;
  const rawCode = providerError.code ?? "unknown";
  const rawDetail = args.denied ? null : getProviderErrorDetail(providerError);
  await reportProviderFailure({
    summary: `Provider stream error (${args.providerName} ${providerError.type}/${rawCode})`,
    errorType: "ProviderStreamError",
    error: providerError.originalError ?? providerError,
    expected: args.denied || !isOperatorActionableProviderError(providerError),
    detail: rawDetail ? boundOperatorDetail(redactProviderDetail(rawDetail, args.requestApiKey)) : undefined,
    serverId: context.tomoriState.server_id,
    userId: context.triggererUserId ?? null,
    dimensions: {
      provider: args.providerName,
      providerErrorType: providerError.type,
      code: formatProviderErrorCodeForDisplay(providerError.code),
    },
    metadata: {
      textCredentialSource: context.textCredentialSource ?? "server",
      model: context.requestDiagnostics?.model ?? context.tomoriState.llm.llm_codename,
      providerErrorCode: rawCode,
      channelId: context.channel.id,
      surfaced: args.surfaced,
      requestDiagnostics: context.requestDiagnostics,
    },
    redactValues: [args.requestApiKey],
  });
}

/** Response bodies are unbounded, and logger truncation is opt-in per deployment. */
function boundOperatorDetail(detail: string): string {
  return detail.length > OPERATOR_ERROR_DETAIL_CHARS ? `${detail.slice(0, OPERATOR_ERROR_DETAIL_CHARS)}...` : detail;
}

/**
 * Record one `provider_error` counter for a failure that reached the user.
 *
 * Never throws: a telemetry write must not be able to turn a recoverable provider error into a
 * crash on the error path itself.
 *
 * @param providerName - Adapter identity used as the first half of the metric key.
 */
export function recordProviderErrorStat(
  providerName: string,
  providerError: ProviderError,
  context?: StreamContext,
): void {
  const serverId = context?.tomoriState?.server_id;
  const userId = context?.triggererUserId;
  // stat_counters.server_id and user_id are NOT NULL FKs, so an unscoped failure (a DM, or a
  // flow with no resolved triggerer) records nothing rather than inventing a sentinel row.
  if (!serverId || !userId) return;

  try {
    statRepository.recordStat({
      serverId,
      userId,
      metric: "provider_error",
      metricKey: `${providerName}:${providerError.code ?? "unknown"}`,
    });
  } catch (error) {
    log.warn(`Failed to record provider_error stat for ${providerName}`, error);
  }
}
