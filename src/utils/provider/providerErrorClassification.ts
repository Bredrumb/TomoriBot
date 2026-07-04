import type { ProviderError } from "@/types/stream/interfaces";

const MODEL_ERROR_PATTERNS: RegExp[] = [
  /\bunsupported\s+model\b/i,
  /\b(?:invalid|unknown|unrecognized)\s+model\b/i,
  /\bmodel\s+[`"'A-Za-z0-9_.:/-]{1,160}\s+(?:is\s+)?(?:not\s+supported|unsupported|not\s+found|unavailable|invalid)\b/i,
  /\bmodel\s+(?:not\s+found|does\s+not\s+exist|is\s+not\s+available)\b/i,
  /\bno\s+such\s+model\b/i,
  /\bmodel_not_found\b/i,
];

export function isProviderModelError(error: ProviderError): boolean {
  if (error.type === "model_error") {
    return true;
  }

  return collectProviderErrorMessages(error).some(isProviderModelErrorMessage);
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
