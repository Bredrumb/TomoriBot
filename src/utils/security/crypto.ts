import { log } from "../misc/logger";
import { sql } from "bun";
import type { OptApiKeyRow } from "../../types/db/schema";
import { keyManager } from "./keyManager";
/**
 * Encrypts an API key before storing it in the database using pgcrypto's PGP symmetric encryption.
 *
 * @param apiKey - The raw API key to encrypt
 * @returns Promise<{encrypted: Buffer, version: number}> - The encrypted API key and the version used
 */
export const encryptApiKey = async (
	apiKey: string,
): Promise<{ encrypted: Buffer; version: number }> => {
	if (!apiKey) {
		log.warn("Empty API key provided for encryption");
		return {
			encrypted: Buffer.from(""),
			version: keyManager.getCurrentVersion(),
		};
	}

	try {
		const currentKey = keyManager.getCurrentKey();
		const currentVersion = keyManager.getCurrentVersion();

		// Use PostgreSQL's pgp_sym_encrypt function with armor option to encrypt the API key
		// Note: The bytea output is directly compatible with Buffer
		const [result] = await sql`
      SELECT pgp_sym_encrypt(
        ${apiKey.trim()},
        ${currentKey},
        'compress-algo=1, cipher-algo=aes256'
      ) AS encrypted_key
    `;

		if (!result || !result.encrypted_key) {
			throw new Error("Encryption failed");
		}

		log.success(
			`API key encrypted successfully with version ${currentVersion}`,
		);

		// PostgreSQL already returns bytea as Buffer - don't convert to string first
		return {
			encrypted: result.encrypted_key,
			version: currentVersion,
		};
	} catch (error) {
		log.error("Failed to encrypt API key", error);
		throw new Error("API key encryption failed");
	}
};

/**
 * Decrypts an API key retrieved from the database using pgcrypto's PGP symmetric decryption.
 *
 * @param encryptedKey - The encrypted API key Buffer from the database
 * @param keyVersion - The version of the key used to encrypt (defaults to 1 for backward compatibility)
 * @returns Promise<string> - The decrypted API key
 */
export const decryptApiKey = async (
	encryptedKey: Buffer,
	keyVersion: number = 1,
): Promise<string> => {
	if (!encryptedKey || encryptedKey.length === 0) {
		log.warn("Empty encrypted key provided for decryption");
		return "";
	}

	try {
		const key = keyManager.getKey(keyVersion);

		// Use PostgreSQL's pgp_sym_decrypt function to decrypt the API key
		// No need for typecasting to bytea since encryptedKey is already a Buffer
		const [result] = await sql`
      SELECT pgp_sym_decrypt(${encryptedKey}, ${key}) AS decrypted_key
    `;

		if (!result || !result.decrypted_key) {
			throw new Error("Decryption failed");
		}

		// Convert the result to a string for use in the application
		return result.decrypted_key.toString();
	} catch (error) {
		log.error(
			`Failed to decrypt API key with version ${keyVersion}. ` +
				`Available versions: ${keyManager.getAvailableVersions().join(", ")}. ` +
				`Run 'bun run audit-keys' to diagnose.`,
			error,
		);
		throw new Error("API key decryption failed");
	}
};

/**
 * Re-encrypts an API key from an old version to the current version
 *
 * @param encryptedKey - The encrypted API key Buffer
 * @param oldVersion - The version used to encrypt the key
 * @returns Promise<{encrypted: Buffer, version: number}> - The re-encrypted key with new version
 */
export const reencryptApiKey = async (
	encryptedKey: Buffer,
	oldVersion: number,
): Promise<{ encrypted: Buffer; version: number }> => {
	// Decrypt with old key version
	const plaintext = await decryptApiKey(encryptedKey, oldVersion);

	// Encrypt with current key version
	const result = await encryptApiKey(plaintext);

	log.info(
		`Re-encrypted API key from version ${oldVersion} to ${result.version}`,
	);
	return result;
};

/**
 * Store an encrypted optional API key in the database
 * @param serverId - Server ID to associate the key with
 * @param serviceName - Name of the service (e.g., 'brave-search', 'duckduckgo-search')
 * @param apiKey - The raw API key to encrypt and store
 * @returns Promise<boolean> - True if stored successfully
 */
export const storeOptApiKey = async (
	serverId: number,
	serviceName: string,
	apiKey: string,
): Promise<boolean> => {
	if (!apiKey || !serviceName || !serverId) {
		log.warn("Missing required parameters for optional API key storage");
		return false;
	}

	try {
		log.info(
			`Storing encrypted optional API key for server ${serverId}, service: ${serviceName}`,
		);

		// Encrypt the API key using the current key version
		const { encrypted, version } = await encryptApiKey(apiKey);

		// Store in database with ON CONFLICT update for idempotent operation
		await sql`
			INSERT INTO opt_api_keys (server_id, service_name, api_key, key_version)
			VALUES (${serverId}, ${serviceName}, ${encrypted}, ${version})
			ON CONFLICT (server_id, service_name)
			DO UPDATE SET
				api_key = EXCLUDED.api_key,
				key_version = EXCLUDED.key_version,
				updated_at = CURRENT_TIMESTAMP
		`;

		log.success(
			`Optional API key stored with version ${version} for ${serviceName} on server ${serverId}`,
		);
		return true;
	} catch (error) {
		log.error(
			`Failed to store optional API key for ${serviceName}`,
			error as Error,
		);
		return false;
	}
};

/**
 * Retrieve and decrypt an optional API key from the database
 * Automatically performs lazy rotation if the key is encrypted with an old version
 *
 * @param serverId - Server ID to look up
 * @param serviceName - Name of the service
 * @returns Promise<string | null> - Decrypted API key or null if not found
 */
export const getOptApiKey = async (
	serverId: number,
	serviceName: string,
): Promise<string | null> => {
	if (!serviceName || !serverId) {
		log.warn("Missing required parameters for optional API key retrieval");
		return null;
	}

	try {
		log.info(
			`Retrieving optional API key for server ${serverId}, service: ${serviceName}`,
		);

		const [result] = await sql`
			SELECT api_key, key_version
			FROM opt_api_keys
			WHERE server_id = ${serverId} AND service_name = ${serviceName}
		`;

		if (!result || !result.api_key) {
			log.info(
				`No optional API key found for ${serviceName} on server ${serverId}`,
			);
			return null;
		}

		// Default to V1 for backward compatibility (NULL values from before versioning)
		const keyVersion = result.key_version || 1;
		const currentVersion = keyManager.getCurrentVersion();

		// Decrypt with the version it was encrypted with
		const decryptedKey = await decryptApiKey(result.api_key, keyVersion);

		// LAZY ROTATION: If using old key version, re-encrypt with current
		if (keyVersion !== currentVersion) {
			log.info(
				`Rotating key from version ${keyVersion} to ${currentVersion} for ${serviceName}`,
			);

			const { encrypted, version } = await encryptApiKey(decryptedKey);

			await sql`
				UPDATE opt_api_keys
				SET api_key = ${encrypted},
				    key_version = ${version},
				    updated_at = CURRENT_TIMESTAMP
				WHERE server_id = ${serverId} AND service_name = ${serviceName}
			`;

			log.success(`Key rotation completed for ${serviceName}`);
		}

		return decryptedKey;
	} catch (error) {
		log.error(
			`Failed to retrieve optional API key for ${serviceName}`,
			error as Error,
		);
		return null;
	}
};

/**
 * Get all optional API keys for a server (returns a map of serviceName -> decryptedKey)
 * Automatically performs lazy rotation for keys encrypted with old versions
 *
 * @param serverId - Server ID to look up
 * @returns Promise<Record<string, string>> - Map of service names to decrypted API keys
 */
export const getAllOptApiKeysForServer = async (
	serverId: number,
): Promise<Record<string, string>> => {
	if (!serverId) {
		log.warn("Missing serverId for optional API key retrieval");
		return {};
	}

	try {
		log.info(`Retrieving all optional API keys for server ${serverId}`);

		const results = (await sql`
			SELECT service_name, api_key, key_version
			FROM opt_api_keys
			WHERE server_id = ${serverId}
		`) as OptApiKeyRow[];

		const apiKeys: Record<string, string> = {};
		const currentVersion = keyManager.getCurrentVersion();

		for (const result of results) {
			if (result.api_key && result.service_name) {
				try {
					const keyVersion = result.key_version || 1;
					const decryptedKey = await decryptApiKey(result.api_key, keyVersion);
					apiKeys[result.service_name] = decryptedKey;

					// LAZY ROTATION: Re-encrypt if using old version
					if (keyVersion !== currentVersion) {
						log.info(
							`Rotating key from version ${keyVersion} to ${currentVersion} for ${result.service_name}`,
						);

						const { encrypted, version } = await encryptApiKey(decryptedKey);

						await sql`
							UPDATE opt_api_keys
							SET api_key = ${encrypted},
							    key_version = ${version},
							    updated_at = CURRENT_TIMESTAMP
							WHERE server_id = ${serverId} AND service_name = ${result.service_name}
						`;

						log.success(`Key rotation completed for ${result.service_name}`);
					}
				} catch (error) {
					log.warn(
						`Failed to decrypt API key for service: ${result.service_name}`,
						error as Error,
					);
				}
			}
		}

		log.success(
			`Retrieved ${Object.keys(apiKeys).length} optional API keys for server ${serverId}`,
		);
		return apiKeys;
	} catch (error) {
		log.error(
			`Failed to retrieve optional API keys for server ${serverId}`,
			error as Error,
		);
		return {};
	}
};

/**
 * Delete an optional API key from the database
 * @param serverId - Server ID
 * @param serviceName - Name of the service
 * @returns Promise<boolean> - True if deleted successfully
 */
export const deleteOptApiKey = async (
	serverId: number,
	serviceName: string,
): Promise<boolean> => {
	if (!serviceName || !serverId) {
		log.warn("Missing required parameters for optional API key deletion");
		return false;
	}

	try {
		log.info(
			`Deleting optional API key for server ${serverId}, service: ${serviceName}`,
		);

		await sql`
			DELETE FROM opt_api_keys
			WHERE server_id = ${serverId} AND service_name = ${serviceName}
		`;

		log.success(
			`Optional API key deleted successfully for ${serviceName} on server ${serverId}`,
		);
		return true;
	} catch (error) {
		log.error(
			`Failed to delete optional API key for ${serviceName}`,
			error as Error,
		);
		return false;
	}
};

/**
 * Check if an optional API key exists for a server
 * @param serverId - Server ID
 * @param serviceName - Name of the service
 * @returns Promise<boolean> - True if key exists
 */
export const hasOptApiKey = async (
	serverId: number,
	serviceName: string,
): Promise<boolean> => {
	if (!serviceName || !serverId) {
		return false;
	}

	try {
		const [result] = await sql`
			SELECT 1
			FROM opt_api_keys
			WHERE server_id = ${serverId} AND service_name = ${serviceName}
		`;

		return !!result;
	} catch (error) {
		log.error(
			`Failed to check optional API key existence for ${serviceName}`,
			error as Error,
		);
		return false;
	}
};
