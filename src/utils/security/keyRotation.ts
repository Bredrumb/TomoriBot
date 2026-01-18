/**
 * API Key Rotation Utility
 * Provides load balancing (round-robin) and failover capabilities for LLM API keys.
 *
 * Key Features:
 * - Round-robin distribution across multiple API keys
 * - Automatic failover on API errors
 * - Cooldown-based recovery (60s for rate limits, 5min for other errors)
 * - Main key pointer design (uses tomori_configs.api_key as virtual key in pool)
 */

import { sql } from "@/utils/db/client";
import { log } from "../misc/logger";
import { encryptApiKey, decryptApiKey } from "./crypto";
import {
	type ApiKeyRotationRow,
	type ApiKeyRotationErrorType,
	type TomoriState,
	apiKeyRotationSchema,
} from "@/types/db/schema";

/** Cooldown duration for rate limit errors (429) in milliseconds */
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 60 seconds

/** Cooldown duration for other API errors (401, 403, etc.) in milliseconds */
const API_ERROR_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum number of key attempts per request before giving up */
export const MAX_KEY_ATTEMPTS = 3;

/**
 * Result of selecting an API key for use
 */
export interface SelectedKeyResult {
	/** The decrypted API key ready for use */
	apiKey: string;
	/** The rotation_key_id to use for recording success/error (null for main key without pointer) */
	rotationKeyId: number | null;
	/** Whether this is the main key from tomori_configs */
	isMainKey: boolean;
}

/**
 * Checks if a key is currently in cooldown based on its last error
 * @param lastErrorAt - Timestamp of the last error
 * @param lastErrorType - Type of the last error ('rate_limit' or 'api_error')
 * @returns True if the key is still in cooldown
 */
function isKeyInCooldown(
	lastErrorAt: Date | null | undefined,
	lastErrorType: ApiKeyRotationErrorType | null | undefined,
): boolean {
	if (!lastErrorAt || !lastErrorType) {
		return false;
	}

	const now = Date.now();
	const errorTime = lastErrorAt.getTime();
	const cooldownMs =
		lastErrorType === "rate_limit" ? RATE_LIMIT_COOLDOWN_MS : API_ERROR_COOLDOWN_MS;

	return now - errorTime < cooldownMs;
}

/**
 * Selects the next available API key using round-robin with cooldown filtering.
 * If rotation is not active (< 2 keys), returns null to signal using main key directly.
 *
 * Selection Algorithm:
 * 1. Query api_key_rotation for server_id
 * 2. If 0-1 rows → no rotation, return null (use tomori_configs.api_key directly)
 * 3. If 2+ rows → rotation active:
 *    a. Filter: is_enabled = true AND cooldown expired
 *    b. Sort by: usage_count ASC (round-robin)
 *    c. Select first key not in excludeKeyIds
 *    d. Decrypt and return
 *
 * @param tomoriState - The Tomori state containing server_id and config
 * @param excludeKeyIds - Array of rotation_key_ids to exclude (already tried and failed)
 * @returns Selected key result, or null if rotation not active or all keys exhausted
 */
export async function selectApiKey(
	tomoriState: TomoriState,
	excludeKeyIds: number[] = [],
): Promise<SelectedKeyResult | null> {
	const serverId = tomoriState.server_id;
	const provider = tomoriState.llm.llm_provider.toLowerCase();

	try {
		// 1. Query all rotation keys for this server and provider
		const rotationKeys = await sql`
			SELECT * FROM api_key_rotation
			WHERE server_id = ${serverId}
			AND provider = ${provider}
			ORDER BY usage_count ASC, rotation_key_id ASC
		`;

		// 2. If less than 2 keys, rotation is not active
		if (!rotationKeys || rotationKeys.length < 2) {
			log.info(
				`Key rotation not active for server ${serverId} (${rotationKeys?.length || 0} keys)`,
			);
			return null;
		}

		// 3. Filter and find the best available key
		for (const row of rotationKeys) {
			// Validate the row
			const parsed = apiKeyRotationSchema.safeParse(row);
			if (!parsed.success) {
				log.warn(
					`Invalid rotation key row for server ${serverId}:`,
					parsed.error.flatten(),
				);
				continue;
			}
			const key = parsed.data;

			// Skip disabled keys
			if (!key.is_enabled) {
				continue;
			}

			// Skip excluded keys (already tried this request)
			if (key.rotation_key_id && excludeKeyIds.includes(key.rotation_key_id)) {
				continue;
			}

			// Skip keys in cooldown
			if (isKeyInCooldown(key.last_error_at, key.last_error_type)) {
				log.info(
					`Skipping rotation key ${key.rotation_key_id} (in cooldown: ${key.last_error_type})`,
				);
				continue;
			}

			// 4. Decrypt and return this key
			let decryptedKey: string;

			if (key.is_main_key_pointer) {
				// Main key pointer: decrypt from tomori_configs.api_key
				if (!tomoriState.config.api_key) {
					log.warn(
						`Main key pointer exists but tomori_configs.api_key is null for server ${serverId}`,
					);
					continue;
				}
				const keyVersion = tomoriState.config.key_version || 1;
				decryptedKey = await decryptApiKey(tomoriState.config.api_key, keyVersion);
			} else {
				// Regular rotation key: decrypt from row's api_key
				if (!key.api_key) {
					log.warn(
						`Rotation key ${key.rotation_key_id} has null api_key for server ${serverId}`,
					);
					continue;
				}
				decryptedKey = await decryptApiKey(key.api_key, key.key_version);
			}

			if (!decryptedKey) {
				log.warn(
					`Failed to decrypt rotation key ${key.rotation_key_id} for server ${serverId}`,
				);
				continue;
			}

			log.info(
				`Selected rotation key ${key.rotation_key_id} for server ${serverId} (usage: ${key.usage_count}, main: ${key.is_main_key_pointer})`,
			);

			return {
				apiKey: decryptedKey,
				rotationKeyId: key.rotation_key_id ?? null,
				isMainKey: key.is_main_key_pointer,
			};
		}

		// 5. All keys exhausted or in cooldown
		log.warn(
			`All rotation keys exhausted or in cooldown for server ${serverId}`,
		);
		return null;
	} catch (error) {
		log.error(`Error selecting API key for server ${serverId}:`, error);
		return null;
	}
}

/**
 * Records a successful API call for a rotation key.
 * Increments usage_count, resets error_count, and updates last_used_at.
 *
 * @param rotationKeyId - The rotation_key_id to update
 */
export async function recordKeySuccess(rotationKeyId: number): Promise<void> {
	try {
		await sql`
			UPDATE api_key_rotation
			SET usage_count = usage_count + 1,
			    error_count = 0,
			    last_used_at = CURRENT_TIMESTAMP,
			    last_error_at = NULL,
			    last_error_type = NULL,
			    last_error_message = NULL
			WHERE rotation_key_id = ${rotationKeyId}
		`;

		log.info(`Recorded success for rotation key ${rotationKeyId}`);
	} catch (error) {
		log.error(`Error recording key success for ${rotationKeyId}:`, error);
	}
}

/**
 * Records an API error for a rotation key.
 * Sets cooldown based on error type and increments error_count.
 *
 * @param rotationKeyId - The rotation_key_id to update
 * @param errorType - Type of error ('rate_limit' for 429, 'api_error' for others)
 * @param errorMessage - Human-readable error message
 */
export async function recordKeyError(
	rotationKeyId: number,
	errorType: ApiKeyRotationErrorType,
	errorMessage: string,
): Promise<void> {
	try {
		await sql`
			UPDATE api_key_rotation
			SET error_count = error_count + 1,
			    last_error_at = CURRENT_TIMESTAMP,
			    last_error_type = ${errorType},
			    last_error_message = ${errorMessage.substring(0, 500)}
			WHERE rotation_key_id = ${rotationKeyId}
		`;

		const cooldownSecs =
			errorType === "rate_limit"
				? RATE_LIMIT_COOLDOWN_MS / 1000
				: API_ERROR_COOLDOWN_MS / 1000;

		log.warn(
			`Recorded ${errorType} error for rotation key ${rotationKeyId} (cooldown: ${cooldownSecs}s): ${errorMessage.substring(0, 100)}`,
		);
	} catch (error) {
		log.error(`Error recording key error for ${rotationKeyId}:`, error);
	}
}

/**
 * Adds a new rotation key to the pool.
 * Also creates the main key pointer if this is the first rotation key.
 *
 * @param serverId - The internal server ID
 * @param provider - The LLM provider name (must match current provider)
 * @param apiKey - The raw API key to encrypt and store
 * @returns True if the key was added successfully
 */
export async function addRotationKey(
	serverId: number,
	provider: string,
	apiKey: string,
): Promise<boolean> {
	const normalizedProvider = provider.toLowerCase();

	try {
		// 1. Check if main key pointer already exists
		const existingPointer = await sql`
			SELECT rotation_key_id FROM api_key_rotation
			WHERE server_id = ${serverId} AND is_main_key_pointer = true
			LIMIT 1
		`;

		// 2. If no pointer exists, create one first (enables rotation)
		if (!existingPointer || existingPointer.length === 0) {
			log.info(
				`Creating main key pointer for server ${serverId} to enable rotation`,
			);
			await sql`
				INSERT INTO api_key_rotation (server_id, provider, api_key, is_main_key_pointer, is_enabled)
				VALUES (${serverId}, ${normalizedProvider}, NULL, true, true)
			`;
		}

		// 3. Encrypt and store the new rotation key
		const { encrypted, version } = await encryptApiKey(apiKey);

		await sql`
			INSERT INTO api_key_rotation (server_id, provider, api_key, key_version, is_main_key_pointer, is_enabled)
			VALUES (${serverId}, ${normalizedProvider}, ${encrypted}, ${version}, false, true)
		`;

		log.success(`Added rotation key for server ${serverId} (provider: ${normalizedProvider})`);
		return true;
	} catch (error) {
		log.error(`Error adding rotation key for server ${serverId}:`, error);
		return false;
	}
}

/**
 * Purges all rotation keys for a server.
 * This includes the main key pointer and all additional rotation keys.
 *
 * @param serverId - The internal server ID
 * @returns The number of keys deleted
 */
export async function purgeRotationKeys(serverId: number): Promise<number> {
	try {
		const result = await sql`
			DELETE FROM api_key_rotation
			WHERE server_id = ${serverId}
		`;

		const deletedCount = result.count || 0;
		log.success(
			`Purged ${deletedCount} rotation key(s) for server ${serverId}`,
		);
		return deletedCount;
	} catch (error) {
		log.error(`Error purging rotation keys for server ${serverId}:`, error);
		return 0;
	}
}

/**
 * Gets the count of rotation keys for a server (excluding main key pointer).
 *
 * @param serverId - The internal server ID
 * @returns The count of additional rotation keys (not including main key pointer)
 */
export async function getRotationKeyCount(serverId: number): Promise<number> {
	try {
		const result = await sql`
			SELECT COUNT(*) as count FROM api_key_rotation
			WHERE server_id = ${serverId} AND is_main_key_pointer = false
		`;

		return Number(result[0]?.count || 0);
	} catch (error) {
		log.error(`Error counting rotation keys for server ${serverId}:`, error);
		return 0;
	}
}

/**
 * Gets all rotation keys for a server (for loading into TomoriState).
 *
 * @param serverId - The internal server ID
 * @returns Array of validated ApiKeyRotationRow objects
 */
export async function loadRotationKeys(
	serverId: number,
): Promise<ApiKeyRotationRow[]> {
	try {
		const rows = await sql`
			SELECT * FROM api_key_rotation
			WHERE server_id = ${serverId}
			ORDER BY usage_count ASC, rotation_key_id ASC
		`;

		if (!rows || rows.length === 0) {
			return [];
		}

		// Validate each row
		const validatedKeys: ApiKeyRotationRow[] = [];
		for (const row of rows) {
			const parsed = apiKeyRotationSchema.safeParse(row);
			if (parsed.success) {
				validatedKeys.push(parsed.data);
			} else {
				log.warn(
					`Invalid rotation key row for server ${serverId}:`,
					parsed.error.flatten(),
				);
			}
		}

		return validatedKeys;
	} catch (error) {
		log.error(`Error loading rotation keys for server ${serverId}:`, error);
		return [];
	}
}

/**
 * Checks if API key rotation is active for a server.
 * Rotation is active when there are 2+ keys in the pool (main pointer + at least 1 rotation key).
 *
 * @param serverId - The internal server ID
 * @returns True if rotation is active
 */
export async function isRotationActive(serverId: number): Promise<boolean> {
	try {
		const result = await sql`
			SELECT COUNT(*) as count FROM api_key_rotation
			WHERE server_id = ${serverId}
		`;

		return Number(result[0]?.count || 0) >= 2;
	} catch (error) {
		log.error(`Error checking rotation status for server ${serverId}:`, error);
		return false;
	}
}
