import type {} from "discord.js";

export type AppEnvironment = "production" | "development";

export function resolveEnvironment(): AppEnvironment {
  return (process.env.RUN_ENV || "development") === "production" ? "production" : "development";
}
