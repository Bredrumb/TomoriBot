import { errorMessageNamesRejectableParam } from "@/providers/utils/paramDegradation";
import type { ProviderError } from "@/types/stream/interfaces";
import {
  formatProviderErrorCodeForDisplay,
  isOperatorActionableProviderError,
  isProviderModelErrorMessage,
  isProviderTimeoutMessage,
} from "@/utils/provider/providerErrorClassification";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { isPrivateNetworkRefusal, RemoteUrlPolicyError } from "@/utils/security/userRemoteFetch";
import { localizer } from "@/utils/text/localizer";

interface ParsedOpenAICompatibleErrorPayload {
  message: string;
  code?: string;
}

interface CreateErrorDescriptionOptions {
  localeNamespace: string;
  fallbackMessage: string;
  connectionRefusedMessage?: string;
}

interface NormalizeProviderErrorOptions {
  errorMessagePrefix: string;
}

export function createOpenAICompatibleHttpError(statusCode: number, statusText: string, errorText: string): Error {
  const parsed = parseOpenAICompatibleErrorPayload(errorText);
  const message = parsed.message || statusText || "Unknown error";
  return new Error(`HTTP ${statusCode}: ${message}`);
}

export interface OpenAICompatibleErrorClassification {
  type: ProviderError["type"];
  code: string;
  retryable: boolean;
}

// Thrown fetch failures and mid-SSE errors after HTTP 200 must share this classifier so transient mid-stream statuses
// remain retryable.
export function classifyOpenAICompatibleStatus(
  statusCode: number | null,
  message: string,
): OpenAICompatibleErrorClassification {
  if (statusCode === null) {
    return isProviderTimeoutMessage(message)
      ? { type: "timeout", code: "unknown", retryable: true }
      : { type: "unknown", code: "unknown", retryable: false };
  }

  const code = String(statusCode);

  if (statusCode === 401 || statusCode === 403 || statusCode === 400 || statusCode === 404) {
    return { type: "api_error", code, retryable: false };
  }
  if (statusCode === 429) {
    // Providers such as Z.ai return 429 for balance or plan denial, so match those keywords before classifying as rate
    // limit.
    const lowerMessage = message.toLowerCase();
    const isBalanceDenial =
      lowerMessage.includes("insufficient balance") ||
      lowerMessage.includes("insufficient credits") ||
      lowerMessage.includes("not enough credits") ||
      lowerMessage.includes("no resource package") ||
      lowerMessage.includes("please recharge");
    const isPlanAccessDenial =
      lowerMessage.includes("subscription plan") ||
      lowerMessage.includes("does not yet include access") ||
      lowerMessage.includes("plan does not include");
    if (isBalanceDenial) {
      return { type: "api_error", code: "429_balance", retryable: false };
    }
    if (isPlanAccessDenial) {
      return { type: "api_error", code: "429_plan_access", retryable: false };
    }
    return { type: "rate_limit", code, retryable: true };
  }
  if (statusCode === 408 || statusCode === 504) {
    return { type: "timeout", code, retryable: true };
  }
  if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
    return { type: "provider_overloaded", code, retryable: true };
  }
  return { type: "api_error", code, retryable: false };
}

export function normalizeOpenAICompatibleProviderError(
  error: unknown,
  options: NormalizeProviderErrorOptions,
): ProviderError {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Keyed by code so the channel-facing copy explains the redirect without echoing the
  // destination origin that the message carries for the operator's logs.
  if (error instanceof RemoteUrlPolicyError && error.failureCode === "REDIRECT_CREDENTIALS_WITHHELD") {
    return {
      type: "api_error",
      message: `${options.errorMessagePrefix}: ${errorMessage}`,
      code: error.failureCode,
      retryable: false,
      originalError: error,
    };
  }

  if (isPrivateNetworkRefusal(error)) {
    return {
      type: "api_error",
      message: `${options.errorMessagePrefix}: ${errorMessage}`,
      code: "PRIVATE_NETWORK_BLOCKED",
      retryable: false,
      originalError: error,
    };
  }

  let errorCode = "unknown";
  let errorType: ProviderError["type"] = "unknown";
  let retryable = false;

  if (errorMessage.includes("HTTP 4") || errorMessage.includes("HTTP 5")) {
    const statusMatch = errorMessage.match(/HTTP (\d{3})/);
    if (statusMatch) {
      const classification = classifyOpenAICompatibleStatus(Number.parseInt(statusMatch[1], 10), errorMessage);
      errorType = classification.type;
      errorCode = classification.code;
      retryable = classification.retryable;
    }
  }

  if (isProviderModelErrorMessage(errorMessage)) {
    errorType = "model_error";
    errorCode = errorCode === "unknown" ? "model_error" : `${errorCode}_model`;
    retryable = false;
  }

  const normalizedMessage = errorMessage.toLowerCase();
  if (normalizedMessage.includes("econnrefused") || normalizedMessage.includes("connection refused")) {
    errorType = "api_error";
    errorCode = "ECONNREFUSED";
    retryable = false;
  }

  if (isProviderTimeoutMessage(normalizedMessage)) {
    errorType = "timeout";
    retryable = true;
  }

  return {
    type: errorType,
    message: `${options.errorMessagePrefix}: ${errorMessage}`,
    code: errorCode,
    retryable,
    originalError: error,
  };
}

// User-typed rejected or unfunded keys are reported through this validation path so expected key failures stay out of
// error_logs.
export async function reportOpenAICompatibleKeyValidationFailure(
  error: unknown,
  provider: string,
  summary: string,
  options: NormalizeProviderErrorOptions,
): Promise<ProviderError> {
  const providerError = normalizeOpenAICompatibleProviderError(error, options);
  await reportProviderFailure({
    summary,
    errorType: "APIKeyValidationError",
    error,
    expected: !isOperatorActionableProviderError(providerError),
    dimensions: { operation: "key-validation", provider, providerErrorCode: providerError.code ?? "unknown" },
  });
  return providerError;
}

export function createOpenAICompatibleErrorDescription(
  error: ProviderError,
  locale: string,
  options: CreateErrorDescriptionOptions,
): string {
  const errorCode = formatProviderErrorCodeForDisplay(error.code);

  if (errorCode === "ECONNREFUSED" && options.connectionRefusedMessage) {
    return `Error Code ECONNREFUSED: ${options.connectionRefusedMessage}`;
  }

  let messageKey: string;
  switch (error.type) {
    case "model_error":
      messageKey = "model_error_default_message";
      break;
    case "rate_limit":
      messageKey = "429_default_message";
      break;
    case "timeout":
      messageKey = "408_default_message";
      break;
    case "provider_overloaded":
      messageKey = `${errorCode}_default_message`;
      break;
    case "api_error":
      messageKey = `${errorCode}_default_message`;
      break;
    default:
      messageKey = "unknown_default_message";
      break;
  }

  // Gate 5xx parameter remediation copy on upstream parameter names so genuine outages do not blame user settings.
  const parameterMessage =
    (error.type === "api_error" || error.type === "provider_overloaded") &&
    errorMessageNamesRejectableParam(error.message)
      ? resolveLocalizedOrNull(locale, `${options.localeNamespace}.${errorCode}_parameter_default_message`)
      : null;

  const localeKey = `${options.localeNamespace}.${messageKey}`;
  let message = parameterMessage ?? localizer(locale, localeKey);

  // Upstream text never joins this description; the caller logs it for the operator.
  if (error.type === "model_error") {
    if (message === localeKey) {
      message = localizer(locale, "genai.stream.model_error_description");
    }
  } else {
    if (message === localeKey && error.type === "provider_overloaded") {
      // Fall back from missing 5xx keys to 503 and shared overload copy so namespaces without 5xx keys avoid generic
      // unexpected-error copy.
      message =
        resolveLocalizedOrNull(locale, `${options.localeNamespace}.503_default_message`) ??
        resolveLocalizedOrNull(locale, "genai.stream.provider_overloaded_description") ??
        localeKey;
    }

    if (message === localeKey) {
      message = localizer(locale, `${options.localeNamespace}.unknown_default_message`);

      if (message === `${options.localeNamespace}.unknown_default_message`) {
        message = options.fallbackMessage;
      }
    }
  }

  return `Error Code ${errorCode}: ${message}`;
}

function resolveLocalizedOrNull(locale: string, key: string): string | null {
  const value = localizer(locale, key);
  return value === key ? null : value;
}

function parseOpenAICompatibleErrorPayload(errorText: string): ParsedOpenAICompatibleErrorPayload {
  if (!errorText) {
    return { message: "" };
  }

  try {
    const parsed = JSON.parse(errorText) as Record<string, unknown>;
    const nestedError =
      parsed.error && typeof parsed.error === "object" ? (parsed.error as Record<string, unknown>) : parsed;

    const detailMessage =
      typeof parsed.detail === "string"
        ? parsed.detail
        : parsed.detail !== undefined
          ? JSON.stringify(parsed.detail)
          : undefined;

    const message =
      typeof nestedError.message === "string"
        ? nestedError.message
        : typeof parsed.message === "string"
          ? parsed.message
          : detailMessage
            ? detailMessage
            : errorText;

    const codeValue =
      typeof nestedError.code === "string" || typeof nestedError.code === "number"
        ? String(nestedError.code)
        : typeof parsed.code === "string" || typeof parsed.code === "number"
          ? String(parsed.code)
          : undefined;

    return {
      message,
      code: codeValue,
    };
  } catch {
    return {
      message: errorText,
    };
  }
}
