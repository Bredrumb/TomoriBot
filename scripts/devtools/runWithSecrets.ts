import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "@/utils/misc/logger";

function printUsage(): void {
  log.info("Usage:");
  log.info("  bun run scripts/devtools/runWithSecrets.ts <secrets-file> <script> [scriptArgs...]");
}

function loadSecretsAsEnv(filePath: string): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Secrets file must contain a flat JSON object of env-style keys.");
  }

  const envVars: Record<string, string> = {};
  const skippedKeys: string[] = [];

  // Stringify only scalars so nested objects/null fail loudly via skippedKeys instead of silent coercion.
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

  // Place injected secrets after process.env so JSON values override parent shell/.env settings.
  const subprocess = Bun.spawn(["bun", "run", scriptPath, ...scriptArgs], {
    env: { ...process.env, ...injectedEnv },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  process.exit(await subprocess.exited);
}

runWithSecrets().catch((error) => {
  log.error("runWithSecrets failed", error);
  process.exitCode = 1;
});
