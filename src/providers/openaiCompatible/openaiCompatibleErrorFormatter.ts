import type { ProviderError } from "@/types/stream/interfaces";
import { isProviderModelErrorMessage } from "@/utils/provider/providerErrorClassification";
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

export function normalizeOpenAICompatibleProviderError(
  error: unknown,
  options: NormalizeProviderErrorOptions,
): ProviderError {
  const errorMessage = error instanceof Error ? error.message : String(error);

  let errorCode = "unknown";
  let errorType: ProviderError["type"] = "unknown";
  let retryable = false;

  if (errorMessage.includes("HTTP 4") || errorMessage.includes("HTTP 5")) {
    const statusMatch = errorMessage.match(/HTTP (\d{3})/);
    if (statusMatch) {
      errorCode = statusMatch[1];
      const status = Number.parseInt(errorCode, 10);

      if (status === 401 || status === 403 || status === 400 || status === 404) {
        errorType = "api_error";
      } else if (status === 429) {
        // Some providers (e.g. Z.ai) use 429 for billing/plan/access denial, not just rate limiting.
        // Detect these by checking the error message for subscription or balance keywords.
        const lowerMessage = errorMessage.toLowerCase();
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
          errorType = "api_error";
          errorCode = "429_balance";
          retryable = false;
        } else if (isPlanAccessDenial) {
          errorType = "api_error";
          errorCode = "429_plan_access";
          retryable = false;
        } else {
          errorType = "rate_limit";
          retryable = true;
        }
      } else if (status === 408 || status === 504) {
        errorType = "timeout";
        retryable = true;
      } else if (status === 500 || status === 502 || status === 503) {
        errorType = "provider_overloaded";
        retryable = true;
      } else {
        errorType = "api_error";
      }
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

  if (normalizedMessage.includes("timeout")) {
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

export function createOpenAICompatibleErrorDescription(
  error: ProviderError,
  locale: string,
  options: CreateErrorDescriptionOptions,
): string {
  const errorCode = error.code || "unknown";

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
      messageKey = "503_default_message";
      break;
    case "api_error":
      messageKey = `${errorCode}_default_message`;
      break;
    default:
      messageKey = "unknown_default_message";
      break;
  }

  const localeKey = `${options.localeNamespace}.${messageKey}`;
  let message = localizer(locale, localeKey);

  if (error.type === "model_error") {
    const details = getProviderErrorDisplayMessage(error);
    if (message === localeKey) {
      message = localizer(locale, "genai.stream.model_error_description");
    }
    if (details && !message.includes(details)) {
      message += `\n\n**Details:**\n${details}`;
    }
  } else if (message === localeKey) {
    message = localizer(locale, `${options.localeNamespace}.unknown_default_message`);

    if (message === `${options.localeNamespace}.unknown_default_message`) {
      message = options.fallbackMessage;
    }

    const maxErrorLength = 500;
    const errorSnippet =
      error.message.length > maxErrorLength ? `${error.message.substring(0, maxErrorLength)}...` : error.message;
    message += `\n\n**Details:**\n${errorSnippet}`;
  }

  return `Error Code ${errorCode}: ${message}`;
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

function getProviderErrorDisplayMessage(error: ProviderError): string | null {
  const maxErrorLength = 1200;
  const detail = error.userMessage?.trim() || error.message.trim();
  if (!detail) {
    return null;
  }
  return detail.length > maxErrorLength ? `${detail.substring(0, maxErrorLength)}...` : detail;
}
