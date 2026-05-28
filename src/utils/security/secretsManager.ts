import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { log } from "@/utils/misc/logger";

/**
 * Interface defining all secrets required for TomoriBot production deployment.
 *
 * Core Secrets:
 * - Discord bot authentication token
 * - PostgreSQL database connection parameters
 * - Encryption key for database-stored API keys
 *
 * Optional Secrets:
 * - CRYPTO_SECRET_V1, V2, etc. for key rotation support
 * - DISCORD_WEBHOOK_URL for logging webhooks
 * - AVATAR_GCS_BUCKET / VOICE_SAMPLE_GCS_* for GCP Cloud Storage (GCP deployments)
 * - AVATAR_S3_BUCKET / CHARREF_S3_* for AWS S3 (AWS deployments)
 */
export interface TomoriSecrets {
  DISCORD_TOKEN: string;
  POSTGRES_HOST: string;
  POSTGRES_PORT: string;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  CRYPTO_SECRET: string;
  CRYPTO_SECRET_V1?: string; // Optional: Key rotation support
  CRYPTO_SECRET_V2?: string; // Optional: Key rotation support
  CRYPTO_SECRET_V3?: string; // Optional: Key rotation support
  DISCORD_WEBHOOK_URL?: string; // Optional: Error logging webhook
  // GCP Cloud Storage (set when deployed to GCP; injected as env vars by Cloud Run terraform)
  AVATAR_GCS_BUCKET?: string;
  AVATAR_PUBLIC_BASE_URL?: string;
  VOICE_SAMPLE_GCS_BUCKET?: string;
  VOICE_SAMPLE_GCS_PREFIX?: string;
  VOICE_SAMPLE_PUBLIC_BASE_URL?: string;
  // AWS S3 storage (set when deployed to AWS)
  AVATAR_S3_BUCKET?: string;
  AVATAR_S3_REGION?: string;
  AVATAR_S3_PREFIX?: string;
  CHARREF_S3_BUCKET?: string;
  CHARREF_S3_REGION?: string;
  CHARREF_S3_PREFIX?: string;
  CHARREF_PUBLIC_BASE_URL?: string;
  // Matrix Appservice Bridge (optional — leave unset to disable the bridge entirely)
  MATRIX_HOMESERVER_URL?: string; // e.g., http://localhost:8448 or https://your-hs.example.com
  MATRIX_ACCESS_TOKEN?: string; // Appservice token (as_token) used to authenticate to the homeserver
  MATRIX_BOT_USER_ID?: string; // e.g., @tomoribot:yourdomain.com
  MATRIX_SERVER_NAME?: string; // Homeserver domain (e.g., localhost or yourdomain.com)
  MATRIX_HS_TOKEN?: string; // Homeserver token (hs_token) — homeserver sends this to verify its identity
  MATRIX_APPSERVICE_PUBLIC_URL?: string; // Optional callback URL used in appservice registration for remote homeservers
  TOPGG_TOKEN?: string; // Optional: Top.gg API token for posting server stats
  CONTAINER_MEMORY_LIMIT_MB?: string; // Optional: Container memory limit in MB (default: 1024)
  [key: string]: string | undefined; // Allow dynamic CRYPTO_SECRET_V* keys
}

/**
 * Fetches application secrets from the appropriate backend based on environment.
 *
 * Resolution order:
 * 1. Development / test-production → process.env (dotenv)
 * 2. Production + GCP_SECRET_FILE set → mounted GCP Secret Manager volume file (JSON)
 * 3. Production (fallback) → AWS Secrets Manager API call
 *
 * GCP file path:
 * - Cloud Run mounts the secret at /run/secrets/<secret_id> (configured in cloud-run.tf)
 * - GCP_SECRET_FILE env var points to that path
 * - File content is identical JSON shape to the AWS secret string
 * - No SDK call needed — plain fs.readFileSync
 *
 * AWS Configuration:
 * - AWS_REGION environment variable (defaults to "us-east-1")
 * - AWS credentials from environment, IAM role, or ~/.aws/credentials
 *
 * Key Version Auto-Detection:
 * - Scans for CRYPTO_SECRET_V1, CRYPTO_SECRET_V2, CRYPTO_SECRET_V3, etc.
 * - Dynamically includes all found versions
 * - Integrates seamlessly with existing CryptoKeyManager
 *
 * Error Handling:
 * - Missing required fields → throws error with missing key list
 * - File read / JSON parse errors → descriptive error message
 * - AWS network/permission errors → descriptive error message
 *
 * @returns {Promise<TomoriSecrets>} Object containing all application secrets
 * @throws {Error} If required secrets are missing or the secret backend fails
 *
 * @example
 * // In src/index.ts
 * const secrets = await getAppSecrets();
 * process.env.DISCORD_TOKEN = secrets.DISCORD_TOKEN;
 * process.env.POSTGRES_HOST = secrets.POSTGRES_HOST;
 */
export async function getAppSecrets(): Promise<TomoriSecrets> {
  // Default to 'development' if RUN_ENV is not set (safe for local users)
  const runEnv = process.env.RUN_ENV || "development";
  const isProduction = runEnv === "production";
  const isTestProduction = process.env.TEST_PRODUCTION === "true";

  // Development mode OR test production mode: Use process.env (loaded via dotenv)
  // TEST_PRODUCTION allows testing production behavior locally without AWS
  if (!isProduction || isTestProduction) {
    log.info(`Loading secrets from .env (${isTestProduction ? "test production" : "development"} mode)`);

    const secrets: TomoriSecrets = {
      DISCORD_TOKEN: process.env.DISCORD_TOKEN || "",
      POSTGRES_HOST: process.env.POSTGRES_HOST || "",
      POSTGRES_PORT: process.env.POSTGRES_PORT || "",
      POSTGRES_USER: process.env.POSTGRES_USER || "",
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || "",
      POSTGRES_DB: process.env.POSTGRES_DB || "",
      CRYPTO_SECRET: process.env.CRYPTO_SECRET || "",
    };

    // Auto-detect key versions (CRYPTO_SECRET_V1, V2, V3, etc.)
    for (const key of ["CRYPTO_SECRET_V1", "CRYPTO_SECRET_V2", "CRYPTO_SECRET_V3"]) {
      if (process.env[key]) {
        secrets[key] = process.env[key];
      }
    }

    // Optional fields — read from process.env matching the same keys as the JSON secret blob
    const optionalEnvFields: (keyof TomoriSecrets)[] = [
      "DISCORD_WEBHOOK_URL",
      "AVATAR_GCS_BUCKET",
      "AVATAR_PUBLIC_BASE_URL",
      "VOICE_SAMPLE_GCS_BUCKET",
      "VOICE_SAMPLE_GCS_PREFIX",
      "VOICE_SAMPLE_PUBLIC_BASE_URL",
      "AVATAR_S3_BUCKET",
      "AVATAR_S3_REGION",
      "AVATAR_S3_PREFIX",
      "CHARREF_S3_BUCKET",
      "CHARREF_S3_REGION",
      "CHARREF_S3_PREFIX",
      "CHARREF_PUBLIC_BASE_URL",
      "MATRIX_HOMESERVER_URL",
      "MATRIX_ACCESS_TOKEN",
      "MATRIX_BOT_USER_ID",
      "MATRIX_SERVER_NAME",
      "MATRIX_HS_TOKEN",
      "MATRIX_APPSERVICE_PUBLIC_URL",
      "TOPGG_TOKEN",
      "CONTAINER_MEMORY_LIMIT_MB",
    ];

    for (const field of optionalEnvFields) {
      if (process.env[field]) {
        secrets[field] = process.env[field];
      }
    }

    // Validate required fields
    validateRequiredSecrets(secrets);

    return secrets;
  }

  // Production + GCP: Read from the Secret Manager volume file mounted by Cloud Run
  const gcpSecretFile = process.env.GCP_SECRET_FILE;
  if (gcpSecretFile) {
    log.info(`Reading secrets from GCP Secret Manager file: ${gcpSecretFile}`);
    try {
      // 1. Read and parse the JSON blob written by Cloud Run's secret volume mount
      const fileContent = await Bun.file(gcpSecretFile).text();
      if (!fileContent) {
        throw new Error(`GCP secret file "${gcpSecretFile}" is empty. Ensure the secret version is populated.`);
      }

      const rawSecrets = JSON.parse(fileContent);

      // 2. Build TomoriSecrets object from the parsed JSON
      const secrets: TomoriSecrets = {
        DISCORD_TOKEN: rawSecrets.DISCORD_TOKEN,
        POSTGRES_HOST: rawSecrets.POSTGRES_HOST,
        POSTGRES_PORT: rawSecrets.POSTGRES_PORT,
        POSTGRES_USER: rawSecrets.POSTGRES_USER,
        POSTGRES_PASSWORD: rawSecrets.POSTGRES_PASSWORD,
        POSTGRES_DB: rawSecrets.POSTGRES_DB,
        CRYPTO_SECRET: rawSecrets.CRYPTO_SECRET,
      };

      // 3. Auto-detect key versions (CRYPTO_SECRET_V1, V2, V3, etc.)
      for (const key of Object.keys(rawSecrets)) {
        if (key.startsWith("CRYPTO_SECRET_V")) {
          secrets[key] = rawSecrets[key];
          log.info(`Detected key version: ${key}`);
        }
      }

      // 4. Optional fields — same shape as AWS secret blob
      const optionalFields: (keyof TomoriSecrets)[] = [
        "DISCORD_WEBHOOK_URL",
        "AVATAR_GCS_BUCKET",
        "AVATAR_PUBLIC_BASE_URL",
        "VOICE_SAMPLE_GCS_BUCKET",
        "VOICE_SAMPLE_GCS_PREFIX",
        "VOICE_SAMPLE_PUBLIC_BASE_URL",
        "AVATAR_S3_BUCKET",
        "AVATAR_S3_REGION",
        "AVATAR_S3_PREFIX",
        "CHARREF_S3_BUCKET",
        "CHARREF_S3_REGION",
        "CHARREF_S3_PREFIX",
        "CHARREF_PUBLIC_BASE_URL",
        "MATRIX_HOMESERVER_URL",
        "MATRIX_ACCESS_TOKEN",
        "MATRIX_BOT_USER_ID",
        "MATRIX_SERVER_NAME",
        "MATRIX_HS_TOKEN",
        "MATRIX_APPSERVICE_PUBLIC_URL",
        "TOPGG_TOKEN",
        "CONTAINER_MEMORY_LIMIT_MB",
      ];

      for (const field of optionalFields) {
        if (rawSecrets[field]) {
          secrets[field] = rawSecrets[field];
        }
      }

      // 5. Validate required fields
      validateRequiredSecrets(secrets);

      log.info("Successfully loaded secrets from GCP Secret Manager file");

      return secrets;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `GCP secret file "${gcpSecretFile}" contains invalid JSON. ` +
            `Re-populate the secret with a valid JSON object.`,
        );
      }

      // Re-throw with context for file-not-found and other I/O errors
      log.error(
        "Failed to read secrets from GCP Secret Manager file",
        error instanceof Error ? error : new Error(String(error)),
      );

      throw error;
    }
  }

  // Production mode: Fetch from AWS Secrets Manager
  const awsRegion = process.env.AWS_REGION || "us-east-1";
  log.info(`Fetching secrets from AWS Secrets Manager (production mode, region: ${awsRegion})`);

  try {
    // 1. Create AWS Secrets Manager client with configurable region
    const client = new SecretsManagerClient({ region: awsRegion });

    // 2. Fetch secret value
    const command = new GetSecretValueCommand({
      SecretId: "tomoribot/production",
    });

    const response = await client.send(command);

    // 3. Parse SecretString as JSON
    if (!response.SecretString) {
      throw new Error("AWS Secrets Manager returned empty SecretString. Ensure the secret contains a JSON object.");
    }

    const rawSecrets = JSON.parse(response.SecretString);

    // 4. Build TomoriSecrets object
    const secrets: TomoriSecrets = {
      DISCORD_TOKEN: rawSecrets.DISCORD_TOKEN,
      POSTGRES_HOST: rawSecrets.POSTGRES_HOST,
      POSTGRES_PORT: rawSecrets.POSTGRES_PORT,
      POSTGRES_USER: rawSecrets.POSTGRES_USER,
      POSTGRES_PASSWORD: rawSecrets.POSTGRES_PASSWORD,
      POSTGRES_DB: rawSecrets.POSTGRES_DB,
      CRYPTO_SECRET: rawSecrets.CRYPTO_SECRET,
    };

    // 5. Auto-detect key versions (CRYPTO_SECRET_V1, V2, V3, etc.)
    // This allows for unlimited key rotation versions
    for (const key of Object.keys(rawSecrets)) {
      if (key.startsWith("CRYPTO_SECRET_V")) {
        secrets[key] = rawSecrets[key];
        log.info(`Detected key version: ${key}`);
      }
    }

    // 6. Optional fields
    const optionalFields: (keyof TomoriSecrets)[] = [
      "DISCORD_WEBHOOK_URL",
      "AVATAR_GCS_BUCKET",
      "AVATAR_PUBLIC_BASE_URL",
      "VOICE_SAMPLE_GCS_BUCKET",
      "VOICE_SAMPLE_GCS_PREFIX",
      "VOICE_SAMPLE_PUBLIC_BASE_URL",
      "AVATAR_S3_BUCKET",
      "AVATAR_S3_REGION",
      "AVATAR_S3_PREFIX",
      "CHARREF_S3_BUCKET",
      "CHARREF_S3_REGION",
      "CHARREF_S3_PREFIX",
      "CHARREF_PUBLIC_BASE_URL",
      "MATRIX_HOMESERVER_URL",
      "MATRIX_ACCESS_TOKEN",
      "MATRIX_BOT_USER_ID",
      "MATRIX_SERVER_NAME",
      "MATRIX_HS_TOKEN",
      "MATRIX_APPSERVICE_PUBLIC_URL",
      "TOPGG_TOKEN",
      "CONTAINER_MEMORY_LIMIT_MB",
    ];

    for (const field of optionalFields) {
      if (rawSecrets[field]) {
        secrets[field] = rawSecrets[field];
      }
    }

    // 7. Validate required fields
    validateRequiredSecrets(secrets);

    log.info("Successfully loaded secrets from AWS Secrets Manager");

    return secrets;
  } catch (error) {
    // Enhance error message for common AWS errors
    if (error instanceof Error) {
      if (error.name === "ResourceNotFoundException") {
        throw new Error(
          `AWS Secrets Manager: Secret "tomoribot/production" not found in ${awsRegion}. ` +
            `Please create the secret in AWS Secrets Manager console.`,
        );
      }

      if (error.name === "AccessDeniedException") {
        throw new Error(
          `AWS Secrets Manager: Access denied to "tomoribot/production". ` +
            `Ensure your IAM user/role has secretsmanager:GetSecretValue permission.`,
        );
      }

      if (error.message.includes("getaddrinfo ENOTFOUND")) {
        throw new Error(
          `AWS Secrets Manager: Network error. ` +
            `Ensure your system has internet connectivity and can reach AWS services.`,
        );
      }
    }

    // Re-throw with context
    log.error(
      "Failed to fetch secrets from AWS Secrets Manager",
      error instanceof Error ? error : new Error(String(error)),
    );

    throw error;
  }
}

/**
 * Validates that all required secrets are present and non-empty.
 *
 * Required Fields:
 * - DISCORD_TOKEN (Discord bot authentication)
 * - POSTGRES_HOST (Database connection)
 * - POSTGRES_PORT (Database port)
 * - POSTGRES_USER (Database user)
 * - POSTGRES_PASSWORD (Database password)
 * - POSTGRES_DB (Database name)
 * - CRYPTO_SECRET (Encryption key for database-stored API keys)
 *
 * @param {TomoriSecrets} secrets - Secrets object to validate
 * @throws {Error} If any required secret is missing or empty
 */
function validateRequiredSecrets(secrets: TomoriSecrets): void {
  const requiredFields: (keyof TomoriSecrets)[] = [
    "DISCORD_TOKEN",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "CRYPTO_SECRET",
  ];

  const missingFields = requiredFields.filter((field) => !secrets[field] || secrets[field] === "");

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required secrets: ${missingFields.join(", ")}. ` +
        `Ensure all required fields are present in AWS Secrets Manager (production) or .env (development).`,
    );
  }
}
