import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
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
	[key: string]: string | undefined; // Allow dynamic CRYPTO_SECRET_V* keys
}

/**
 * Fetches application secrets from AWS Secrets Manager (production) or process.env (development).
 *
 * Environment-Based Behavior:
 * - Development (NODE_ENV !== 'production'):
 *   - Reads secrets from process.env (loaded via dotenv)
 *   - No AWS API calls
 *   - Maintains current .env workflow
 *
 * - Production (NODE_ENV === 'production'):
 *   - Fetches from AWS Secrets Manager (us-east-1)
 *   - Secret name: "tomoribot/production"
 *   - Parses JSON string and validates required fields
 *   - Auto-detects CRYPTO_SECRET_V* key versions
 *
 * Key Version Auto-Detection:
 * - Scans for CRYPTO_SECRET_V1, CRYPTO_SECRET_V2, CRYPTO_SECRET_V3, etc.
 * - Dynamically includes all found versions
 * - Integrates seamlessly with existing CryptoKeyManager
 *
 * Error Handling:
 * - Missing required fields → throws error with missing key list
 * - AWS network/permission errors → descriptive error message
 * - Invalid JSON → parse error with guidance
 *
 * @returns {Promise<TomoriSecrets>} Object containing all application secrets
 * @throws {Error} If required secrets are missing or AWS fetch fails
 *
 * @example
 * // In src/index.ts
 * const secrets = await getAppSecrets();
 * process.env.DISCORD_TOKEN = secrets.DISCORD_TOKEN;
 * process.env.POSTGRES_HOST = secrets.POSTGRES_HOST;
 */
export async function getAppSecrets(): Promise<TomoriSecrets> {
	const isProduction = process.env.NODE_ENV === "production";

	// Development mode: Use process.env (loaded via dotenv)
	if (!isProduction) {
		log.info("Loading secrets from .env (development mode)");

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
		if (process.env.CRYPTO_SECRET_V1) {
			secrets.CRYPTO_SECRET_V1 = process.env.CRYPTO_SECRET_V1;
		}
		if (process.env.CRYPTO_SECRET_V2) {
			secrets.CRYPTO_SECRET_V2 = process.env.CRYPTO_SECRET_V2;
		}
		if (process.env.CRYPTO_SECRET_V3) {
			secrets.CRYPTO_SECRET_V3 = process.env.CRYPTO_SECRET_V3;
		}

		// Optional webhook URL
		if (process.env.DISCORD_WEBHOOK_URL) {
			secrets.DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
		}

		// Validate required fields
		validateRequiredSecrets(secrets);

		return secrets;
	}

	// Production mode: Fetch from AWS Secrets Manager
	log.info("Fetching secrets from AWS Secrets Manager (production mode)");

	try {
		// 1. Create AWS Secrets Manager client
		const client = new SecretsManagerClient({ region: "us-east-1" });

		// 2. Fetch secret value
		const command = new GetSecretValueCommand({
			SecretId: "tomoribot/production",
		});

		const response = await client.send(command);

		// 3. Parse SecretString as JSON
		if (!response.SecretString) {
			throw new Error(
				"AWS Secrets Manager returned empty SecretString. Ensure the secret contains a JSON object.",
			);
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

		// 6. Optional webhook URL
		if (rawSecrets.DISCORD_WEBHOOK_URL) {
			secrets.DISCORD_WEBHOOK_URL = rawSecrets.DISCORD_WEBHOOK_URL;
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
					`AWS Secrets Manager: Secret "tomoribot/production" not found in us-east-1. ` +
						`Please create the secret in AWS Secrets Manager console.`,
				);
			}

			if (error.name === "AccessDeniedException") {
				throw new Error(
					`AWS Secrets Manager: Access denied to "tomoribot/production". ` +
						`Ensure your EC2 instance role has secretsmanager:GetSecretValue permission.`,
				);
			}

			if (error.message.includes("getaddrinfo ENOTFOUND")) {
				throw new Error(
					`AWS Secrets Manager: Network error. ` +
						`Ensure your EC2 instance has internet connectivity and can reach AWS services.`,
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

	const missingFields = requiredFields.filter(
		(field) => !secrets[field] || secrets[field] === "",
	);

	if (missingFields.length > 0) {
		throw new Error(
			`Missing required secrets: ${missingFields.join(", ")}. ` +
				`Ensure all required fields are present in AWS Secrets Manager (production) or .env (development).`,
		);
	}
}
