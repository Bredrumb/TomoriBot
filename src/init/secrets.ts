import { log } from "@/utils/misc/logger";
import { getAppSecrets } from "@/utils/security/secretsManager";
import { keyManager } from "@/utils/security/keyManager";
import type { AppEnvironment } from "@/types/config";

/**
 * Loads secrets from GCP Secret Manager (production) or .env (development),
 * assigns them to process.env for backward-compatibility with all downstream consumers,
 * and initializes the encryption key manager.
 *
 * Must be called before any module that reads credentials from process.env.
 *
 * @param environment - Resolved runtime environment
 */
export async function loadSecrets(environment: AppEnvironment): Promise<void> {
  log.section("Loading Application Secrets...");
  const secrets = await getAppSecrets();

  // Assign secrets to process.env for backwards compatibility with existing code
  process.env.DISCORD_TOKEN = secrets.DISCORD_TOKEN;
  process.env.POSTGRES_HOST = secrets.POSTGRES_HOST;
  process.env.POSTGRES_PORT = secrets.POSTGRES_PORT;
  process.env.POSTGRES_USER = secrets.POSTGRES_USER;
  process.env.POSTGRES_PASSWORD = secrets.POSTGRES_PASSWORD;
  process.env.POSTGRES_DB = secrets.POSTGRES_DB;
  process.env.CRYPTO_SECRET = secrets.CRYPTO_SECRET;

  // Auto-detect and assign key versions (CRYPTO_SECRET_V1, V2, V3, etc.)
  if (secrets.CRYPTO_SECRET_V1) process.env.CRYPTO_SECRET_V1 = secrets.CRYPTO_SECRET_V1;
  if (secrets.CRYPTO_SECRET_V2) process.env.CRYPTO_SECRET_V2 = secrets.CRYPTO_SECRET_V2;
  if (secrets.CRYPTO_SECRET_V3) process.env.CRYPTO_SECRET_V3 = secrets.CRYPTO_SECRET_V3;

  if (secrets.DISCORD_WEBHOOK_URL) process.env.DISCORD_WEBHOOK_URL = secrets.DISCORD_WEBHOOK_URL;

  if (secrets.AWS_ACCESS_KEY_ID) process.env.AWS_ACCESS_KEY_ID = secrets.AWS_ACCESS_KEY_ID;
  if (secrets.AWS_SECRET_ACCESS_KEY) process.env.AWS_SECRET_ACCESS_KEY = secrets.AWS_SECRET_ACCESS_KEY;
  if (secrets.S3_ENDPOINT) process.env.S3_ENDPOINT = secrets.S3_ENDPOINT;

  if (secrets.AVATAR_S3_BUCKET) process.env.AVATAR_S3_BUCKET = secrets.AVATAR_S3_BUCKET;
  if (secrets.AVATAR_S3_REGION) process.env.AVATAR_S3_REGION = secrets.AVATAR_S3_REGION;
  if (secrets.AVATAR_S3_PREFIX) process.env.AVATAR_S3_PREFIX = secrets.AVATAR_S3_PREFIX;
  if (secrets.AVATAR_PUBLIC_BASE_URL) process.env.AVATAR_PUBLIC_BASE_URL = secrets.AVATAR_PUBLIC_BASE_URL;

  if (secrets.VOICE_SAMPLE_GCS_BUCKET) process.env.VOICE_SAMPLE_GCS_BUCKET = secrets.VOICE_SAMPLE_GCS_BUCKET;
  if (secrets.VOICE_SAMPLE_GCS_PREFIX) process.env.VOICE_SAMPLE_GCS_PREFIX = secrets.VOICE_SAMPLE_GCS_PREFIX;
  if (secrets.VOICE_SAMPLE_S3_BUCKET) process.env.VOICE_SAMPLE_S3_BUCKET = secrets.VOICE_SAMPLE_S3_BUCKET;
  if (secrets.VOICE_SAMPLE_S3_REGION) process.env.VOICE_SAMPLE_S3_REGION = secrets.VOICE_SAMPLE_S3_REGION;
  if (secrets.VOICE_SAMPLE_S3_PREFIX) process.env.VOICE_SAMPLE_S3_PREFIX = secrets.VOICE_SAMPLE_S3_PREFIX;
  if (secrets.VOICE_SAMPLE_PUBLIC_BASE_URL)
    process.env.VOICE_SAMPLE_PUBLIC_BASE_URL = secrets.VOICE_SAMPLE_PUBLIC_BASE_URL;

  if (secrets.CHARREF_S3_BUCKET) process.env.CHARREF_S3_BUCKET = secrets.CHARREF_S3_BUCKET;
  if (secrets.CHARREF_S3_REGION) process.env.CHARREF_S3_REGION = secrets.CHARREF_S3_REGION;
  if (secrets.CHARREF_S3_PREFIX) process.env.CHARREF_S3_PREFIX = secrets.CHARREF_S3_PREFIX;
  if (secrets.CHARREF_PUBLIC_BASE_URL) process.env.CHARREF_PUBLIC_BASE_URL = secrets.CHARREF_PUBLIC_BASE_URL;

  if (secrets.MATRIX_HOMESERVER_URL) process.env.MATRIX_HOMESERVER_URL = secrets.MATRIX_HOMESERVER_URL;
  if (secrets.MATRIX_ACCESS_TOKEN) process.env.MATRIX_ACCESS_TOKEN = secrets.MATRIX_ACCESS_TOKEN;
  if (secrets.MATRIX_BOT_USER_ID) process.env.MATRIX_BOT_USER_ID = secrets.MATRIX_BOT_USER_ID;
  if (secrets.MATRIX_SERVER_NAME) process.env.MATRIX_SERVER_NAME = secrets.MATRIX_SERVER_NAME;
  if (secrets.MATRIX_HS_TOKEN) process.env.MATRIX_HS_TOKEN = secrets.MATRIX_HS_TOKEN;
  if (secrets.MATRIX_APPSERVICE_PUBLIC_URL)
    process.env.MATRIX_APPSERVICE_PUBLIC_URL = secrets.MATRIX_APPSERVICE_PUBLIC_URL;

  if (secrets.TOPGG_TOKEN) process.env.TOPGG_TOKEN = secrets.TOPGG_TOKEN;

  // Must be set before any module reads MEMORY_PROTECTION()
  if (secrets.CONTAINER_MEMORY_LIMIT_MB) process.env.CONTAINER_MEMORY_LIMIT_MB = secrets.CONTAINER_MEMORY_LIMIT_MB;

  const secretsSource =
    environment !== "production" || process.env.TEST_PRODUCTION === "true"
      ? ".env file"
      : process.env.SECRET_FILE
        ? "mounted JSON secret file"
        : process.env.GCP_SECRET_FILE
          ? "GCP Secret Manager file"
          : "AWS Secrets Manager";
  log.success(`Secrets loaded successfully from ${secretsSource}`);

  // Initialize encryption key manager after process.env is fully populated
  keyManager.initialize();

  const rotationStatus = keyManager.getRotationStatus();
  log.success(
    `Encryption key manager initialized: V${rotationStatus.currentVersion} active, ` +
      `${rotationStatus.availableVersions.length} version(s) available, ` +
      `rotation ${rotationStatus.rotationCapable ? "enabled" : "disabled"}`,
  );
}
