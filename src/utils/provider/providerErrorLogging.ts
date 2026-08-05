import { log } from "@/utils/misc/logger";
import { isAccountBalanceExhaustedError } from "@/utils/provider/providerErrorClassification";

/**
 * Logs a raw provider failure at a severity that matches who can act on it.
 *
 * An exhausted account balance is a BYOK billing state, not a bot defect: nothing in TomoriBot is
 * broken and no deploy can fix it, so it belongs at `warn` rather than in the error dashboard. It
 * also repeats for as long as the balance stays empty, which is exactly the shape that drowns out
 * real incidents. The ambient error context still attributes the record, so the affected server is
 * identifiable from the warning alone.
 *
 * @param label - Adapter identifier used as the message prefix.
 */
export function logRawProviderError(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  // Reuses the ProviderError-shaped classifier so nested SDK payloads are inspected the same way
  // here as they are when the error reaches the embed builder.
  const balanceExhausted = isAccountBalanceExhaustedError({
    type: "api_error",
    message,
    retryable: false,
    originalError: error,
  });

  if (balanceExhausted) {
    log.warn(`${label}: Provider account balance exhausted`, error);
    return;
  }

  log.error(`${label}: Provider error`, error);
}
