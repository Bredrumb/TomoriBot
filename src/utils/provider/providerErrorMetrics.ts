// Leaf module so BaseStreamAdapter avoids repo coupling; operational telemetry only, so routing, persona, and model
// selection must never read provider_error.

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
  // Stable prefix shared by every record of a failure, so operators can filter logs reliably.
  summary: string;
  errorType: string;
  error: unknown;
  // When true, failures (bad input, timeouts, cancellations, auth or quota refusals) are counted and traced without
  // creating an error_logs row.
  expected: boolean;
  // Provider status and body, which callers must pre-scrub of the request credential so raw secrets never reach logs.
  detail?: string;
  serverId?: number | null;
  userId?: number | null;
  // Values must come from fixed sets rather than unbounded strings because these keys become metric dimensions and
  // are copied into record metadata.
  dimensions: Record<string, string | number>;
  metadata?: Record<string, unknown>;
  // Exact credentials scrubbed from the message, error, and metadata before truncation or persistence, so truncation
  // never splits a secret.
  redactValues?: readonly string[];
}

// Detail is kept unchanged in the logged message so operator records match what the gated "Show Full Error" modal
// displays.
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

// Reported once per stream attempt regardless of surfaced so callers do not re-report it, while requestApiKey is
// scrubbed since it may be personal or rotated.
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
      videoRequestDiagnostics: args.providerName === "openrouter" ? context.videoRequestDiagnostics : undefined,
    },
    redactValues: [args.requestApiKey],
  });
}

// Detail is bounded here because provider response bodies are unbounded while logger truncation is opt-in per
// deployment.
function boundOperatorDetail(detail: string): string {
  return detail.length > OPERATOR_ERROR_DETAIL_CHARS ? `${detail.slice(0, OPERATOR_ERROR_DETAIL_CHARS)}...` : detail;
}

// Never throws because a telemetry write must not turn a recoverable provider error into a crash on the error path.
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
