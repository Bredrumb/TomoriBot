import type { ProviderError } from "@/types/stream/interfaces";

const MODEL_ERROR_PATTERNS: RegExp[] = [
  /\bunsupported\s+model\b/i,
  /\b(?:invalid|unknown|unrecognized)\s+model\b/i,
  /\bmodel\s+[`"'A-Za-z0-9_.:/-]{1,160}\s+(?:is\s+)?(?:not\s+supported|unsupported|not\s+found|unavailable|invalid)\b/i,
  /\bmodel\s+(?:not\s+found|does\s+not\s+exist|is\s+not\s+available)\b/i,
  /\bno\s+such\s+model\b/i,
  /\bmodel_not_found\b/i,
  // A deprecated/retired model is a model-availability problem (e.g. OpenRouter 404
  // "Grok 4.1 Fast is deprecated"), so present it as a model error and steer the user to
  // pick a different model rather than showing the generic API-error copy.
  /\bdeprecated\b/i,
];

export function isProviderModelError(error: ProviderError): boolean {
  if (error.type === "model_error") {
    return true;
  }

  return collectProviderErrorMessages(error).some(isProviderModelErrorMessage);
}

// A prompt whose input + reserved output exceeds the model's hard context window.
// Example (OpenRouter 400): "This endpoint's maximum context length is 16384 tokens.
// However, you requested about 22581 tokens ... use the context-compression plugin".
const CONTEXT_LENGTH_ERROR_PATTERNS: RegExp[] = [
  /\bmaximum\s+context\s+length\b/i,
  /\bcontext\s+length\s+(?:is|of|exceeded)\b/i,
  /\bcontext_length_exceeded\b/i,
  /\bcontext\s+window\s+(?:is\s+)?exceeded\b/i,
  /\breduce\s+the\s+length\s+of\b/i,
];

// The account cannot afford the request at the requested max_tokens: a credit
// ceiling, not a context-window ceiling. Example (OpenRouter 402): "This request
// requires more credits, or fewer max_tokens. You requested up to 16384 tokens,
// but can only afford 7783."
const CREDIT_AFFORDABILITY_ERROR_PATTERNS: RegExp[] = [
  /\brequires\s+more\s+credits\b/i,
  /\bcan\s+only\s+afford\b/i,
  /\bfewer\s+max_tokens\b/i,
  /\binsufficient\s+credits\b/i,
];

// The account has no spendable balance at all, so no request of any size can succeed.
// Distinct from the affordability ceiling above: there, a smaller max_tokens still fits
// the remaining credit. Example (DeepSeek 402): "Insufficient Balance". Matching these
// against the affordability patterns would hand the user a `reduce_output_tokens` tip
// that cannot possibly work.
const ACCOUNT_BALANCE_EXHAUSTED_PATTERNS: RegExp[] = [
  /\binsufficient\s+balance\b/i,
  /\bbalance\s+is\s+insufficient\b/i,
  /\bno\s+resource\s+package\b/i,
  /\bplease\s+recharge\b/i,
  /\binsufficient_user_quota\b/i,
  /\bexceeded\s+your\s+current\s+quota\b/i,
  /\bbilling\s+hard\s+limit\s+has\s+been\s+reached\b/i,
];

/**
 * Detects an exhausted account balance (the provider will reject every request until a
 * human adds funds). Distinct from a credit-affordability ceiling: trimming the request
 * cannot help, so the only useful advice is to top up or switch providers.
 * @param error - The normalized provider error.
 * @returns True when any collected message signals a zero or negative balance.
 */
export function isAccountBalanceExhaustedError(error: ProviderError): boolean {
  return collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, ACCOUNT_BALANCE_EXHAUSTED_PATTERNS),
  );
}

/**
 * Detects a hard context-window overflow (input + reserved output exceeds the
 * model's maximum context length). Distinct from a credit ceiling: here,
 * trimming the request (shorter message, less history, lower output tokens)
 * actually resolves it.
 * @param error - The normalized provider error.
 * @returns True when any collected message signals a context-length overflow.
 */
export function isContextLengthError(error: ProviderError): boolean {
  return collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, CONTEXT_LENGTH_ERROR_PATTERNS),
  );
}

/**
 * Detects a credit-affordability ceiling (the account cannot pay for the
 * requested max_tokens). Distinct from a context overflow: adding history back
 * does not help, so the fix is more credits or fewer output tokens.
 * @param error - The normalized provider error.
 * @returns True when any collected message signals a credit-affordability limit.
 */
export function isCreditAffordabilityError(error: ProviderError): boolean {
  return collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, CREDIT_AFFORDABILITY_ERROR_PATTERNS),
  );
}

/**
 * Tests a message against a set of patterns after collapsing whitespace.
 * @param message - Candidate message (nullable).
 * @returns True when the normalized message matches any pattern.
 */
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

export function getProviderErrorDetail(error: ProviderError): string | null {
  const messages = collectProviderErrorMessages(error);
  return messages.find((message) => message.trim().length > 0) ?? null;
}

function collectProviderErrorMessages(error: ProviderError): string[] {
  // Order matters: prefer the raw provider message and original error payload over the
  // friendly `userMessage`. Callers append this as a "Details" section beneath a localized
  // headline, so surfacing the raw provider text (e.g. "Unsupported model X. Supported IDs: ...")
  // is more actionable than echoing the headline, and keeps the de-dupe check meaningful.
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
