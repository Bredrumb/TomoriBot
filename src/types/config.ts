import type {} from "discord.js";

export type AppEnvironment = "production" | "development";

/** Helper that resolves the runtime environment string to the typed union. */
export function resolveEnvironment(): AppEnvironment {
  return (process.env.RUN_ENV || "development") === "production" ? "production" : "development";
}
