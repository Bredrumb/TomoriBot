import { z } from "zod";
import type { ProviderError } from "@/types/stream/interfaces";
import type { ToolFailure, ToolResult } from "@/types/tool/interfaces";
import {
  formatProviderErrorCodeForDisplay,
  providerContentRejectionSchema,
  isAccountBalanceExhaustedError,
  isContextLengthError,
  isCreditAffordabilityError,
  isProviderModelError,
  isProviderTimeoutMessage,
} from "@/utils/provider/providerErrorClassification";
import { resolveProviderErrorPresentation } from "@/utils/provider/providerErrorPresentation";
import { localizer } from "@/utils/text/localizer";

const TOOL_FAILURE_REASON_KEYS = {
  content_blocked: "genai.tool_failure.content_blocked",
  authentication: "genai.tool_failure.authentication",
  quota: "genai.tool_failure.quota",
  rate_limit: "genai.tool_failure.rate_limit",
  timeout: "genai.tool_failure.timeout",
  provider_overloaded: "genai.tool_failure.provider_overloaded",
  invalid_request: "genai.tool_failure.invalid_request",
  malformed_response: "genai.tool_failure.malformed_response",
  missing_voice: "genai.tool_failure.missing_voice",
  missing_sample: "genai.tool_failure.missing_sample",
  sample_read_failed: "genai.tool_failure.sample_read_failed",
  script_too_long: "genai.tool_failure.script_too_long",
  cancelled: "genai.tool_failure.cancelled",
  model_error: "genai.tool_failure.model_error",
  balance_exhausted: "genai.tool_failure.balance_exhausted",
  credit_limit: "genai.tool_failure.credit_limit",
  context_length: "genai.tool_failure.context_length",
  provider_error: "genai.tool_failure.provider_error",
} as const;

const errorFields = z.object({
  message: z.string().optional().catch(undefined),
  code: z.union([z.string(), z.number()]).optional().catch(undefined),
  status: z.union([z.string(), z.number()]).optional().catch(undefined),
  statusCode: z.number().optional().catch(undefined),
  type: z
    .enum(["api_error", "rate_limit", "content_blocked", "timeout", "provider_overloaded", "model_error", "unknown"])
    .optional()
    .catch(undefined),
});

type FailureKind =
  | ProviderError["type"]
  | "authentication"
  | "quota"
  | "invalid_request"
  | "malformed_response"
  | "missing_voice"
  | "script_too_long"
  | "cancelled"
  | "provider_error"
  | "request_failed"
  | "missing_sample"
  | "sample_read_failed"
  | "invalid_response"
  | "missing_api_key";

export interface ProviderToolFailureContext {
  locale: string;
  provider: string;
  credentialScope?: "server" | "personal";
  kind?: FailureKind;
  code?: string;
}

export function createProviderToolFailure(error: unknown, context: ProviderToolFailureContext): ToolResult {
  const fields = errorFields.safeParse(error);
  const nested = z.object({ error: errorFields }).safeParse(error);
  const parsed = nested.success ? nested.data.error : fields.success ? fields.data : undefined;
  const message = parsed?.message ?? (typeof error === "string" ? error : "");
  const candidateCode = context.code ?? parsed?.code ?? parsed?.status ?? parsed?.statusCode;
  const rejection = providerContentRejectionSchema.safeParse(candidateCode);
  const messageRejection = providerContentRejectionSchema.options.find((code) =>
    new RegExp(`\\b${code}\\b`).test(message),
  );
  const status = String(
    parsed?.status ??
      parsed?.statusCode ??
      (/^\d{3}$/.test(String(candidateCode)) ? candidateCode : undefined) ??
      message.match(/\b(?:returned|HTTP|status(?: code)?|code)["']?\s*[: ]+\s*(\d{3})\b/i)?.[1] ??
      "",
  );
  const displayCode = formatProviderErrorCodeForDisplay(candidateCode);
  const suppliedCode = rejection.success
    ? rejection.data
    : (messageRejection ?? (displayCode !== "unknown" ? displayCode : /^\d{3}$/.test(status) ? status : undefined));
  let kind: FailureKind =
    messageRejection || rejection.success ? "content_blocked" : (context.kind ?? parsed?.type ?? "provider_error");
  if (kind === "invalid_response") kind = "malformed_response";
  if (kind === "missing_api_key") kind = "authentication";
  if (kind === "quota" && status === "429") kind = "rate_limit";
  if (kind === "provider_error" || kind === "request_failed" || kind === "api_error" || kind === "unknown") {
    if (/\b(?:safety|blocked|content filter)\b/i.test(message)) kind = "content_blocked";
    else if (
      status === "401" ||
      status === "403" ||
      /\b(?:authentication|unauthorized|invalid_api_key)\b/i.test(`${suppliedCode ?? ""} ${message}`)
    )
      kind = "authentication";
    else if (status === "429" || /\brate[_ -]?limit/i.test(`${suppliedCode ?? ""} ${message}`)) kind = "rate_limit";
    else if (status === "402" || /\b(?:billing|payment|quota|balance|credits?)\b/i.test(message)) kind = "quota";
    else if (isProviderTimeoutMessage(message)) kind = "timeout";
    else if (["500", "502", "503", "504"].includes(status)) kind = "provider_overloaded";
    else if (status === "400" || status === "422") kind = "invalid_request";
    else kind = "provider_error";
  }
  const code = suppliedCode ?? kind;
  const providerError: ProviderError = {
    type:
      kind === "content_blocked" ||
      kind === "rate_limit" ||
      kind === "timeout" ||
      kind === "provider_overloaded" ||
      kind === "model_error"
        ? kind
        : "api_error",
    code,
    message,
    retryable: kind === "timeout" || kind === "rate_limit" || kind === "provider_overloaded",
  };
  let reasonKey: keyof typeof TOOL_FAILURE_REASON_KEYS = kind;
  if (["provider_error", "invalid_request", "quota", "model_error"].includes(kind)) {
    if (isProviderModelError(providerError)) reasonKey = "model_error";
    else if (isAccountBalanceExhaustedError(providerError)) reasonKey = "balance_exhausted";
    else if (isCreditAffordabilityError(providerError)) reasonKey = "credit_limit";
    else if (isContextLengthError(providerError)) reasonKey = "context_length";
  }
  const presentation = resolveProviderErrorPresentation(providerError, context.provider, {
    textCredentialSource: context.credentialScope,
    tomoriState: { fallback_chain: [] },
  });
  let tipKeys = presentation.tipKeys.filter(
    (key) =>
      ![
        "genai.tips.model_fallback",
        "genai.tips.model_fallback_personal",
        "genai.tips.disable_personal_text_override",
        "genai.tips.api_key_rotation",
      ].includes(key),
  );
  if (reasonKey === "content_blocked" || reasonKey === "invalid_request") tipKeys = ["genai.tips.revise_tool_request"];
  else if (kind === "authentication")
    tipKeys = [
      context.credentialScope === "personal" ? "genai.tips.verify_api_key_personal" : "genai.tips.verify_api_key",
    ];
  else if (kind === "quota" && reasonKey === "quota") tipKeys = ["genai.tips.check_provider_quota"];
  else if (kind === "cancelled") tipKeys = [];
  else if (["missing_voice", "missing_sample", "sample_read_failed", "model_error"].includes(reasonKey))
    tipKeys = ["genai.tips.check_tool_configuration"];
  else if (kind === "script_too_long") tipKeys = ["genai.tips.shorten_message"];
  else if (["malformed_response", "provider_error"].includes(reasonKey)) tipKeys = ["genai.tips.wait_and_retry"];
  const failure: ToolFailure = {
    code: formatProviderErrorCodeForDisplay(code),
    reason: localizer(context.locale, TOOL_FAILURE_REASON_KEYS[reasonKey]),
    suggestedActions: tipKeys.map((key) => localizer(context.locale, key)),
  };
  return { success: false, error: failure.reason, failure };
}
