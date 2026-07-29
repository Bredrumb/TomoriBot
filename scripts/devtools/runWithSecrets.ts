/**
 * Runs a devtool script with environment variables injected from a JSON secrets file.
 *
 * Lets cutover tasks target a specific database (GCP Cloud SQL, Azure Flexible
 * Server, local dev) without editing `.env`. Point it at a flat JSON blob of
 * env-style keys — the same shape as the `TOMORI_SECRETS_JSON` deploy secret —
 * and every string/number/boolean value is exported into the child process
 * before the wrapped script starts. JSON values win over `.env` because dotenv
 * never overrides variables that are already set.
 *
 * Usage:
 *   bun run scripts/devtools/runWithSecrets.ts <secrets-file> <script> [scriptArgs...]
 *
 * Examples:
 *   bun run scripts/devtools/runWithSecrets.ts rehearsal/gcp-db.json scripts/devtools/backupData.ts --backup
 *   bun run scripts/devtools/runWithSecrets.ts rehearsal/azure-db.json scripts/devtools/backupData.ts --restore --latest
 *   bun run scripts/devtools/runWithSecrets.ts rehearsal/azure-db.json scripts/devtools/migrateAssetUrls.ts --from <old> --to <new> --dry-run
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "@/utils/misc/logger";

function printUsage(): void {
  log.info("Usage:");
  log.info("  bun run scripts/devtools/runWithSecrets.ts <secrets-file> <script> [scriptArgs...]");
}

/**
 * Reads a flat JSON secrets file and converts scalar values to env-var strings.
 *
 * @param filePath - Absolute path to the JSON secrets file.
 * @returns Map of env var names to string values, ready to merge into a child environment.
 */
function loadSecretsAsEnv(filePath: string): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Secrets file must contain a flat JSON object of env-style keys.");
  }

  const envVars: Record<string, string> = {};
  const skippedKeys: string[] = [];

  // Keep scalar values (strings/numbers/booleans) and stringify them for the env;
  //    skip nested objects/arrays/null so a malformed blob fails loudly instead of silently.
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      envVars[key] = String(value);
    } else {
      skippedKeys.push(key);
    }
  }

  if (skippedKeys.length > 0) {
    log.warn(`Skipped non-scalar secret keys: ${skippedKeys.join(", ")}`);
  }

  return envVars;
}

async function runWithSecrets(): Promise<void> {
  const [secretsArg, scriptArg, ...scriptArgs] = process.argv.slice(2);

  if (!secretsArg || !scriptArg) {
    printUsage();
    process.exit(1);
  }

  // Resolve and validate both file arguments before spawning anything.
  const secretsPath = resolve(process.cwd(), secretsArg);
  const scriptPath = resolve(process.cwd(), scriptArg);

  if (!existsSync(secretsPath)) {
    log.error(`Secrets file not found: ${secretsPath}`);
    process.exit(1);
  }

  if (!existsSync(scriptPath)) {
    log.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const injectedEnv = loadSecretsAsEnv(secretsPath);
  const injectedKeys = Object.keys(injectedEnv);

  if (injectedKeys.length === 0) {
    log.error("Secrets file contained no usable env values — aborting.");
    process.exit(1);
  }

  // Log key NAMES only (never values) so the target is auditable without leaking secrets.
  log.info(`Injecting ${injectedKeys.length} env var(s): ${injectedKeys.join(", ")}`);

  // Spawn the wrapped script with inherited stdio; injected values are placed
  //    after process.env so the JSON wins over anything from the parent shell/.env.
  const subprocess = Bun.spawn(["bun", "run", scriptPath, ...scriptArgs], {
    env: { ...process.env, ...injectedEnv },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  // Mirror the child's exit code so CI/shell callers see failures.
  process.exit(await subprocess.exited);
}

runWithSecrets().catch((error) => {
  log.error("runWithSecrets failed", error);
  process.exitCode = 1;
});
