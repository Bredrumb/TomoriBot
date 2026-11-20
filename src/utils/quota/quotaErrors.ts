// Thrown when quota counters fail, so callers must fail closed and refuse generation rather than spend uncounted
// quota.
export class QuotaUnavailableError extends Error {
  constructor() {
    super("Quota counters are unavailable");
    this.name = "QuotaUnavailableError";
  }
}
