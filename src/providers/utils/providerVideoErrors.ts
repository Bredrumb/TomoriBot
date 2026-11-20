// Safety-filtered video is an expected content refusal, so callers show the safety notice without writing an
// error_logs row.
export class ProviderVideoFilteredError extends Error {
  constructor(readonly provider: string) {
    super(`${provider} blocked the generated video with its content safety filter`);
    this.name = "ProviderVideoFilteredError";
  }
}

export function isVideoContentRefusal(errorMessage: string): boolean {
  return errorMessage.includes("content") || errorMessage.includes("safety") || errorMessage.includes("blocked");
}

export function isExpectedVideoFailure(errorMessage: string, failureCode: string | undefined): boolean {
  return (
    ["401", "403", "429", "502", "503", "504", "authentication"].includes(failureCode ?? "") ||
    /\b(?:billing|payment|quota|balance|credits?|402|PERMISSION_DENIED)\b/i.test(errorMessage) ||
    /\b(?:RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED)\b/.test(errorMessage) ||
    errorMessage.includes("timed out") ||
    isVideoContentRefusal(errorMessage)
  );
}
