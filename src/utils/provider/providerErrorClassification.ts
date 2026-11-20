import { z } from "zod";
import type { ProviderError } from "@/types/stream/interfaces";

export const providerContentRejectionSchema = z.enum([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "RECITATION",
  "BLOCKLIST",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "content_filter",
  "content_policy_violation",
]);

const contentRejectionFields = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({ finishReason: z.string().optional() })).optional(),
  choices: z.array(z.object({ finish_reason: z.string().nullish() })).optional(),
  error: z.object({ code: z.union([z.string(), z.number()]).optional() }).optional(),
});

export function getProviderContentRejectionCode(value: unknown): string | undefined {
  const response = contentRejectionFields.safeParse(value);
  if (!response.success) return undefined;
  const codes = [
    response.data.promptFeedback?.blockReason,
    response.data.error?.code,
    ...(response.data.candidates?.map((candidate) => candidate.finishReason) ?? []),
    ...(response.data.choices?.map((choice) => choice.finish_reason) ?? []),
  ];
  for (const value of codes) {
    const code = providerContentRejectionSchema.safeParse(value);
    if (code.success) return code.data;
  }
  return undefined;
}

const MODEL_ERROR_PATTERNS: RegExp[] = [
  /\bunsupported\s+model\b/i,
  /\b(?:invalid|unknown|unrecognized)\s+model\b/i,
  /\bmodel\s+[`"'A-Za-z0-9_.:/-]{1,160}\s+(?:is\s+)?(?:not\s+supported|unsupported|not\s+found|unavailable|invalid)\b/i,
  /\bmodel\s+(?:not\s+found|does\s+not\s+exist|is\s+not\s+available)\b/i,
  /\bno\s+such\s+model\b/i,
  /\bmodel_not_found\b/i,
  /\bmodel_not_supported\b/i,
  // Retired-model errors (such as OpenRouter 404 "deprecated") map to model guidance instead of generic API errors.
  /\bdeprecated\b/i,
  // NVIDIA NIM uses 410 end-of-life and 404 account-function phrasing, so generic model patterns otherwise miss them.
  /\breached\s+its\s+end\s+of\s+life\b/i,
  /\bnot\s+found\s+for\s+account\b/i,
  // Google words a retired model, a malformed model ID, and a missing model feature this way, so
  // without these patterns each one reads as a retryable API error instead of a configuration problem.
  /\bno\s+longer\s+available\b/i,
  /\bunexpected\s+model\s+name\s+format\b/i,
  /\bmodel\s+[`"'A-Za-z0-9_.:/-]{1,160}\s+does\s+not\s+support\b/i,
];

export function isProviderModelError(error: ProviderError): boolean {
  if (error.type === "model_error") {
    return true;
  }

  return collectProviderErrorMessages(error).some(isProviderModelErrorMessage);
}

const CONTEXT_LENGTH_ERROR_PATTERNS: RegExp[] = [
  /\bmaximum\s+context\s+length\b/i,
  /\bcontext\s+length\s+(?:is|of|exceeded)\b/i,
  /\bcontext_length_exceeded\b/i,
  /\bcontext\s+window\s+(?:is\s+)?exceeded\b/i,
  /\breduce\s+the\s+length\s+of\b/i,
  /\btoo\s+much\s+context\b/i,
];

// OpenRouter 402 affordability limits differ from context limits because lowering max_tokens can resolve them.
const CREDIT_AFFORDABILITY_ERROR_PATTERNS: RegExp[] = [
  /\brequires\s+more\s+credits\b/i,
  /\bcan\s+only\s+afford\b/i,
  /\bfewer\s+max_tokens\b/i,
  /\binsufficient\s+credits\b/i,
];

// Zero-balance patterns stay separate from affordability above so callers never suggest reducing max_tokens when empty.
const ACCOUNT_BALANCE_EXHAUSTED_PATTERNS: RegExp[] = [
  /\binsufficient\s+balance\b/i,
  /\bbalance\s+is\s+insufficient\b/i,
  /\bno\s+resource\s+package\b/i,
  /\bplease\s+recharge\b/i,
  /\binsufficient_user_quota\b/i,
  /\bbilling\s+hard\s+limit\s+has\s+been\s+reached\b/i,
];

// OpenAI-style providers say this only for an empty balance, but Gemini opens every 429 quota
// message with the same sentence, including free-tier per-minute and per-day request limits.
const EXCEEDED_CURRENT_QUOTA_PATTERN = [/\bexceeded\s+your\s+current\s+quota\b/i];
const GEMINI_QUOTA_MESSAGE_MARKER = [/\bgenerativelanguage\.googleapis\.com\b/i, /\bai\.google\.dev\b/i];

// Distinct from a credit-affordability ceiling because trimming the request cannot help; callers must advise topping
// up or switching providers.
export function isAccountBalanceExhaustedError(error: ProviderError): boolean {
  return collectProviderErrorMessages(error).some(
    (message) =>
      matchesAnyPattern(message, ACCOUNT_BALANCE_EXHAUSTED_PATTERNS) ||
      (matchesAnyPattern(message, EXCEEDED_CURRENT_QUOTA_PATTERN) &&
        !matchesAnyPattern(message, GEMINI_QUOTA_MESSAGE_MARKER)),
  );
}

const FREE_TIER_PATTERN = [/(?<![A-Za-z0-9])free[\s_-]?tier(?![A-Za-z0-9])/i, /FreeTier(?![A-Za-z0-9])/];
const PER_DAY_PATTERN = [/\bper\s+day\b/i, /PerDay/];
const PER_MINUTE_PATTERN = [/\bper\s+minute\b/i, /PerMinute/];

// Paid-tier limits return undefined while free-tier 429s split into minute or day, because per-minute limits clear on
// retry whereas per-day wait for reset.
export function getGeminiFreeTierQuotaWindow(error: ProviderError): "day" | "minute" | undefined {
  for (const message of collectProviderErrorMessages(error)) {
    if (!matchesAnyPattern(message, GEMINI_QUOTA_MESSAGE_MARKER) || !matchesAnyPattern(message, FREE_TIER_PATTERN)) {
      continue;
    }
    // A daily violation outranks a simultaneous per-minute one, since waiting a minute cannot clear it.
    if (matchesAnyPattern(message, PER_DAY_PATTERN)) return "day";
    if (matchesAnyPattern(message, PER_MINUTE_PATTERN)) return "minute";
  }
  return undefined;
}

// Scoped to NVIDIA because NIM returns 403 {"detail":"Authorization failed"} for mistyped, expired, or unprivileged
// keys alike.
export function isNvidiaCredentialRejected(providerName: string, error: ProviderError): boolean {
  return providerName === "nvidia" && error.type === "api_error" && error.code === "403";
}

// Distinct from a credit ceiling because shortening input, history, or output tokens resolves context overflows.
export function isContextLengthError(error: ProviderError): boolean {
  return collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, CONTEXT_LENGTH_ERROR_PATTERNS),
  );
}

// Distinct from a context overflow because reducing history does not help; only more credits or lower max_tokens
// resolves a credit ceiling.
export function isCreditAffordabilityError(error: ProviderError): boolean {
  return collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, CREDIT_AFFORDABILITY_ERROR_PATTERNS),
  );
}

// Adapters write `code` in their own vocabulary: HTTP statuses, Google status names, Anthropic error
// types, Vertex's own config codes, and the OpenAI-compatible composites.
const CREDENTIAL_REJECTION_CODES = new Set([
  "401",
  "403",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "authentication_error",
  "permission_error",
  "vertex_auth_error",
]);

// Each entry names a failure the server's own key, account, or endpoint causes, or one that clears
// on its own.
const NON_INCIDENT_PROVIDER_CODES = new Set([
  ...CREDENTIAL_REJECTION_CODES,
  "402",
  "404",
  "429_balance",
  "429_plan_access",
  "ECONNREFUSED",
  "PRIVATE_NETWORK_BLOCKED",
  "billing_error",
  "not_found_error",
  // Anthropic's mid-stream SSE error event arrives as a non-retryable api_error whatever its cause.
  "rate_limit_error",
  // NovelAI's adapter already records this at error level with the raw tool-call block, which
  // cannot ride on the ProviderError because the embed would show it to the user as "Details".
  "tool_call_parse_error",
  "vertex_config_error",
  "input_complexity",
  "context_overflow",
  "subscription_unavailable",
  "subscription_inactive",
  "model_tier",
  "xialong_opus",
  "continuation_exhausted",
]);

// Google/moderation 400s and Bun fetch errors lack status or errno codes, so message matching avoids false incidents.
const NON_INCIDENT_MESSAGE_PATTERNS: RegExp[] = [
  /\bunable\s+to\s+connect\b/i,
  /\bconnection\s+refused\b/i,
  /\bsocket\s+connection\s+was\s+closed\s+unexpectedly\b/i,
  /\b(?:ENOTFOUND|ECONNRESET|EHOSTUNREACH|ENETUNREACH)\b/,
  /\bapi[\s_-]?key\s+(?:is\s+)?(?:not\s+valid|invalid|expired|revoked)\b/i,
  /\b(?:invalid|incorrect|expired)\s+api[\s_-]?key\b/i,
  /\bPERMISSION_DENIED\b/,
  /\bUNAUTHENTICATED\b/,
  /\bbilling\b/i,
  /\bfree\s+tier\b/i,
  /\brecaptcha\b/i,
  /\btrial\s+generations?\b/i,
  /\bcontent[\s_-]?(?:filter|policy|management|safety)\b/i,
  /\bmoderation\b/i,
  /\bflagged\b/i,
];

// Production reads error_logs as the operator incident feed, so transient or user-fixable failures stay at warn level
// to avoid flooding it.
export function isOperatorActionableProviderError(error: ProviderError): boolean {
  if (error.retryable || (error.type !== "api_error" && error.type !== "unknown")) {
    return false;
  }
  if (error.code !== undefined && NON_INCIDENT_PROVIDER_CODES.has(String(error.code))) {
    return false;
  }
  if (
    isProviderModelError(error) ||
    isContextLengthError(error) ||
    isCreditAffordabilityError(error) ||
    isAccountBalanceExhaustedError(error)
  ) {
    return false;
  }
  return !collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, NON_INCIDENT_MESSAGE_PATTERNS),
  );
}

export const STREAM_INTERRUPTED_CODE = "stream_interrupted";

// Parameter is typed unknown rather than ProviderError because stream results carry their failure untyped.
export function isStreamInterruption(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === STREAM_INTERRUPTED_CODE;
}

export function isCredentialRejection(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  if ("retryable" in error && error.retryable === true) return false;
  return CREDENTIAL_REJECTION_CODES.has(String(error.code));
}

// Pattern includes "timed out" because Bun's fetch fails at 300s with "The operation timed out.", lacking "timeout"
// for slow local backends.
export function isProviderTimeoutMessage(message: string): boolean {
  return /timeout|timed\s+out/i.test(message);
}

function matchesAnyPattern(message: string | null | undefined, patterns: RegExp[]): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.replace(/\s+/g, " ").trim();
  return patterns.some((pattern) => pattern.test(normalized));
}

export function isProviderModelErrorMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.replace(/\s+/g, " ").trim();
  return MODEL_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}

const DISPLAYABLE_ERROR_CODE_PATTERNS = [/^\d{3}(?:_[a-z]+)*$/, /^[A-Z]+(?:_[A-Z]+)*$/, /^[a-z]+(?:_[a-z]+)*$/];

// Only HTTP statuses and single-case enum words are shown because hostile endpoints can echo bearer tokens (digits
// plus mixed case) as the error code.
export function formatProviderErrorCodeForDisplay(code: string | number | null | undefined): string {
  const value = code === null || code === undefined ? "" : String(code);
  return value.length <= 40 && DISPLAYABLE_ERROR_CODE_PATTERNS.some((pattern) => pattern.test(value))
    ? value
    : "unknown";
}

// Restricted to operator logs because upstream endpoints can echo request headers here, so never expose this in
// channels, replies, or model context.
export function getProviderErrorDetail(error: ProviderError): string | null {
  const messages = collectProviderErrorMessages(error);
  return messages.find((message) => message.trim().length > 0) ?? null;
}

function collectProviderErrorMessages(error: ProviderError): string[] {
  // Raw provider message and original error precede userMessage because logs need the upstream model-error cause.
  const messages: string[] = [];
  appendMessage(messages, error.message);
  appendMessage(messages, extractUnknownErrorMessage(error.originalError));
  appendMessage(messages, error.userMessage);
  return Array.from(new Set(messages));
}

function extractUnknownErrorMessage(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  const record = value as Record<string, unknown>;
  const directMessage = getString(record.message) ?? getString(record.detail);
  if (directMessage) {
    return directMessage;
  }

  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const nestedRecord = nestedError as Record<string, unknown>;
    const nestedMessage = getString(nestedRecord.message) ?? getString(nestedRecord.detail);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  const body = getString(record.body);
  if (body) {
    return extractJsonMessage(body) ?? body;
  }

  return null;
}

function extractJsonMessage(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const nestedError =
      parsed.error && typeof parsed.error === "object" ? (parsed.error as Record<string, unknown>) : parsed;
    return (
      getString(nestedError.message) ??
      getString(nestedError.detail) ??
      getString(parsed.message) ??
      getString(parsed.detail)
    );
  } catch {
    return null;
  }
}

function appendMessage(messages: string[], value: string | null | undefined): void {
  if (value?.trim()) {
    messages.push(value.trim());
  }
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
