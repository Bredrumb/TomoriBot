import type { Client } from "discord.js";

export type AppEnvironment = "production" | "development";

/**
 * Typed application configuration passed between init modules.
 * Secrets remain in process.env for downstream backward-compatibility;
 * this object carries only values that benefit from explicit typing.
 */
export interface AppConfig {
  /** Resolved runtime environment — defaults to "development" if RUN_ENV is unset */
  environment: AppEnvironment;
  /** Discord.js client instance, created during discord init */
  client: Client;
}

/** Helper that resolves the runtime environment string to the typed union. */
export function resolveEnvironment(): AppEnvironment {
  return (process.env.RUN_ENV || "development") === "production" ? "production" : "development";
}
