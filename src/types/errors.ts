// Thrown on DB connection failures rather than missing rows, so cache and UI layers can distinguish transient outages
// from unconfigured servers.
export class DatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}
