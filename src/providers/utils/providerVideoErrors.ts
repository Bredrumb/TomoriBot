/**
 * A provider's safety filter removed the generated video. This is an expected content refusal, so
 * callers show the safety message without writing an `error_logs` row.
 */
export class ProviderVideoFilteredError extends Error {
  constructor(readonly provider: string) {
    super(`${provider} blocked the generated video with its content safety filter`);
    this.name = "ProviderVideoFilteredError";
  }
}

/** Matches the content refusals both video handlers answer with their blocked-content reply. */
export function isVideoContentRefusal(errorMessage: string): boolean {
  return errorMessage.includes("content") || errorMessage.includes("safety") || errorMessage.includes("blocked");
}

/** A quota, billing, permission, or content refusal, or a provider that timed out. */
export function isExpectedVideoFailure(errorMessage: string, failureCode: string | undefined): boolean {
  return (
    ["401", "403", "authentication"].includes(failureCode ?? "") ||
    /\b(?:billing|payment|quota|balance|credits?|402|PERMISSION_DENIED)\b/i.test(errorMessage) ||
    errorMessage.includes("timed out") ||
    isVideoContentRefusal(errorMessage)
  );
}
