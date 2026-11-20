export interface DatabaseSecrets {
  POSTGRES_HOST: string;
  POSTGRES_PORT: string;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
}

const DATABASE_SECRET_KEYS = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
] as const;

/**
 * Parse the database-only secret bundle used by privileged lifecycle jobs.
 * Application credentials are intentionally neither required nor returned.
 */
export function parseDatabaseSecrets(rawSecrets: unknown): DatabaseSecrets {
  if (typeof rawSecrets !== "object" || rawSecrets === null || Array.isArray(rawSecrets)) {
    throw new Error("Database secret file must contain a JSON object.");
  }

  const record = rawSecrets as Record<string, unknown>;
  const parsed = {} as DatabaseSecrets;

  for (const key of DATABASE_SECRET_KEYS) {
    const value = record[key];
    const isValidPortValue = key === "POSTGRES_PORT" && (typeof value === "string" || typeof value === "number");
    const isValidStringValue = key !== "POSTGRES_PORT" && typeof value === "string";
    if ((!isValidPortValue && !isValidStringValue) || String(value).length === 0) {
      throw new Error(`Database secret file is missing required field: ${key}.`);
    }
    parsed[key] = String(value);
  }

  const port = Number(parsed.POSTGRES_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Database secret field POSTGRES_PORT must be an integer from 1 to 65535.");
  }

  return parsed;
}

/**
 * Load only PostgreSQL connection fields from a mounted JSON secret.
 * This avoids granting a one-shot schema container access to application keys.
 */
export async function loadDatabaseSecretsFromFile(secretFile: string): Promise<void> {
  const fileContent = await Bun.file(secretFile).text();
  if (!fileContent) {
    throw new Error(`Database secret file "${secretFile}" is empty.`);
  }

  let rawSecrets: unknown;
  try {
    rawSecrets = JSON.parse(fileContent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Database secret file "${secretFile}" contains invalid JSON.`);
    }
    throw error;
  }

  const secrets = parseDatabaseSecrets(rawSecrets);
  for (const key of DATABASE_SECRET_KEYS) {
    process.env[key] = secrets[key];
  }
}
