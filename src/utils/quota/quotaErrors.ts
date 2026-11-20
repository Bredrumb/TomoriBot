/**
 * The quota counters could not be read or claimed, so a caller must refuse the generation
 * rather than spend quota it cannot count.
 */
export class QuotaUnavailableError extends Error {
  constructor() {
    super("Quota counters are unavailable");
    this.name = "QuotaUnavailableError";
  }
}
