import { sql } from "@/utils/db/client";
import { invalidateNovelAISubscription } from "@/utils/cache/novelaiSubscriptionCache";
import { log } from "../misc/logger";
import { encryptApiKey, decryptApiKey } from "./crypto";
import { storedCredentialUsageContext } from "@/utils/security/apiKeyRetention";
import type { ProviderUsageContext } from "@/utils/provider/providerUsage";
import { type ApiKeyRotationErrorType, type TomoriState, apiKeyRotationSchema } from "@/types/db/schema";

const RATE_LIMIT_COOLDOWN_MS = 60_000;

const API_ERROR_COOLDOWN_MS = 5 * 60_000;

export const MAX_KEY_ATTEMPTS = 3;

export interface SelectedKeyResult {
  usageContext?: ProviderUsageContext;
  apiKey: string;
  rotationKeyId: number | null;
  isMainKey: boolean;
}

function isKeyInCooldown(
  lastErrorAt: Date | null | undefined,
  lastErrorType: ApiKeyRotationErrorType | null | undefined,
): boolean {
  if (!lastErrorAt || !lastErrorType) {
    return false;
  }

  const now = Date.now();
  const errorTime = lastErrorAt.getTime();
  const cooldownMs = lastErrorType === "rate_limit" ? RATE_LIMIT_COOLDOWN_MS : API_ERROR_COOLDOWN_MS;

  return now - errorTime < cooldownMs;
}

export async function selectApiKey(
  tomoriState: TomoriState,
  excludeKeyIds: number[] = [],
): Promise<SelectedKeyResult | null> {
  const serverId = tomoriState.server_id;
  const provider = tomoriState.llm.llm_provider.toLowerCase();

  try {
    const rotationKeys = await sql`
      SELECT
        akr.rotation_key_id, akr.server_id, akr.provider, akr.api_key, akr.key_version,
        akr.is_main_key_pointer, akr.is_enabled, akr.created_at, akr.updated_at,
        COALESCE(rs.usage_count, 0)  AS usage_count,
        COALESCE(rs.error_count, 0)  AS error_count,
        rs.last_used_at, rs.last_error_at, rs.last_error_type, rs.last_error_message
      FROM api_key_rotation akr
      LEFT JOIN api_key_rotation_runtime_state rs USING (rotation_key_id)
      WHERE akr.server_id = ${serverId}
        AND akr.provider = ${provider}
      ORDER BY COALESCE(rs.usage_count, 0) ASC, akr.rotation_key_id ASC
    `;

    // If less than 2 keys, rotation is not active
    if (!rotationKeys || rotationKeys.length < 2) {
      log.info(`Key rotation not active for server ${serverId} (${rotationKeys?.length || 0} keys)`);
      return null;
    }

    for (const row of rotationKeys) {
      const parsed = apiKeyRotationSchema.safeParse(row);
      if (!parsed.success) {
        const errorDetails = JSON.stringify(parsed.error.flatten(), null, 2);
        log.warn(`Invalid rotation key row for server ${serverId}:\n${errorDetails}`);
        continue;
      }
      const key = parsed.data;

      // Skip disabled keys
      if (!key.is_enabled) {
        continue;
      }

      if (key.rotation_key_id && excludeKeyIds.includes(key.rotation_key_id)) {
        continue;
      }

      if (isKeyInCooldown(key.last_error_at, key.last_error_type)) {
        log.info(`Skipping rotation key ${key.rotation_key_id} (in cooldown: ${key.last_error_type})`);
        continue;
      }

      const ciphertext = key.is_main_key_pointer ? tomoriState.config.api_key : key.api_key;
      if (!ciphertext) {
        log.warn(`Rotation key ${key.rotation_key_id} has no stored credential on server ${serverId}`);
        continue;
      }
      const keyVersion = key.is_main_key_pointer ? tomoriState.config.key_version || 1 : key.key_version;
      const decryptedKey = await decryptApiKey(ciphertext, keyVersion);

      if (!decryptedKey) {
        log.warn(`Failed to decrypt rotation key ${key.rotation_key_id} for server ${serverId}`);
        continue;
      }

      log.info(
        `Selected rotation key ${key.rotation_key_id} for server ${serverId} (usage: ${key.usage_count}, main: ${key.is_main_key_pointer})`,
      );

      return {
        apiKey: decryptedKey,
        usageContext: provider === "vertex" ? undefined : await storedCredentialUsageContext(ciphertext, decryptedKey),
        rotationKeyId: key.rotation_key_id ?? null,
        isMainKey: key.is_main_key_pointer,
      };
    }

    log.warn(`All rotation keys exhausted or in cooldown for server ${serverId}`);
    return null;
  } catch (error) {
    log.error(`Error selecting API key for server ${serverId}:`, error);
    return null;
  }
}

export async function hasAvailableRotationKey(
  tomoriState: TomoriState,
  excludeKeyIds: number[] = [],
): Promise<boolean> {
  const serverId = tomoriState.server_id;
  const provider = tomoriState.llm.llm_provider.toLowerCase();

  try {
    const rotationKeys = await sql`
      SELECT
        akr.rotation_key_id, akr.server_id, akr.provider, akr.api_key, akr.key_version,
        akr.is_main_key_pointer, akr.is_enabled, akr.created_at, akr.updated_at,
        COALESCE(rs.usage_count, 0)  AS usage_count,
        COALESCE(rs.error_count, 0)  AS error_count,
        rs.last_used_at, rs.last_error_at, rs.last_error_type, rs.last_error_message
      FROM api_key_rotation akr
      LEFT JOIN api_key_rotation_runtime_state rs USING (rotation_key_id)
      WHERE akr.server_id = ${serverId}
        AND akr.provider = ${provider}
      ORDER BY COALESCE(rs.usage_count, 0) ASC, akr.rotation_key_id ASC
    `;

    if (!rotationKeys || rotationKeys.length < 2) {
      return false;
    }

    for (const row of rotationKeys) {
      const parsed = apiKeyRotationSchema.safeParse(row);
      if (!parsed.success) {
        const errorDetails = JSON.stringify(parsed.error.flatten(), null, 2);
        log.warn(`Invalid rotation key row for server ${serverId}:\n${errorDetails}`);
        continue;
      }
      const key = parsed.data;

      if (!key.is_enabled) {
        continue;
      }

      if (key.rotation_key_id && excludeKeyIds.includes(key.rotation_key_id)) {
        continue;
      }

      if (isKeyInCooldown(key.last_error_at, key.last_error_type)) {
        continue;
      }

      if (key.is_main_key_pointer && !tomoriState.config.api_key) {
        continue;
      }

      if (!key.is_main_key_pointer && !key.api_key) {
        continue;
      }

      return true;
    }

    return false;
  } catch (error) {
    log.error(`Error checking available rotation keys for server ${serverId}:`, error);
    return false;
  }
}

// Runtime state uses UPSERT rather than UPDATE so success tracking still works if a key lacks a runtime row.
export async function recordKeySuccess(rotationKeyId: number): Promise<void> {
  try {
    await sql`
      INSERT INTO api_key_rotation_runtime_state
        (rotation_key_id, usage_count, error_count, last_used_at, last_error_at, last_error_type, last_error_message)
      VALUES
        (${rotationKeyId}, 1, 0, CURRENT_TIMESTAMP, NULL, NULL, NULL)
      ON CONFLICT (rotation_key_id) DO UPDATE SET
        usage_count      = api_key_rotation_runtime_state.usage_count + 1,
        error_count      = 0,
        last_used_at     = CURRENT_TIMESTAMP,
        last_error_at    = NULL,
        last_error_type  = NULL,
        last_error_message = NULL
    `;

    log.info(`Recorded success for rotation key ${rotationKeyId}`);
  } catch (error) {
    log.error(`Error recording key success for ${rotationKeyId}:`, error);
  }
}

// Runtime state uses UPSERT rather than UPDATE so cooldowns still apply if a key lacks a runtime row.
export async function recordKeyError(
  rotationKeyId: number,
  errorType: ApiKeyRotationErrorType,
  errorMessage: string,
): Promise<void> {
  try {
    await sql`
      INSERT INTO api_key_rotation_runtime_state
        (rotation_key_id, usage_count, error_count, last_error_at, last_error_type, last_error_message)
      VALUES
        (${rotationKeyId}, 0, 1, CURRENT_TIMESTAMP, ${errorType}, ${errorMessage.substring(0, 500)})
      ON CONFLICT (rotation_key_id) DO UPDATE SET
        error_count        = api_key_rotation_runtime_state.error_count + 1,
        last_error_at      = CURRENT_TIMESTAMP,
        last_error_type    = ${errorType},
        last_error_message = ${errorMessage.substring(0, 500)}
    `;

    const cooldownSecs = errorType === "rate_limit" ? RATE_LIMIT_COOLDOWN_MS / 1000 : API_ERROR_COOLDOWN_MS / 1000;

    log.warn(
      `Recorded ${errorType} error for rotation key ${rotationKeyId} (cooldown: ${cooldownSecs}s): ${errorMessage.substring(0, 100)}`,
    );
  } catch (error) {
    log.error(`Error recording key error for ${rotationKeyId}:`, error);
  }
}

export async function addRotationKey(serverId: number, provider: string, apiKey: string): Promise<boolean> {
  const normalizedProvider = provider.toLowerCase();

  try {
    const existingPointer = await sql`
      SELECT rotation_key_id FROM api_key_rotation
      WHERE server_id = ${serverId}
        AND provider = ${normalizedProvider}
        AND is_main_key_pointer = true
      LIMIT 1
    `;

    if (!existingPointer || existingPointer.length === 0) {
      log.info(`Creating main key pointer for server ${serverId} to enable rotation`);
      const pointerResult = await sql`
        INSERT INTO api_key_rotation (server_id, provider, api_key, is_main_key_pointer, is_enabled)
        VALUES (${serverId}, ${normalizedProvider}, NULL, true, true)
        RETURNING rotation_key_id
      `;
      const pointerId = pointerResult[0]?.rotation_key_id as number | undefined;
      if (pointerId) {
        await sql`
          INSERT INTO api_key_rotation_runtime_state (rotation_key_id)
          VALUES (${pointerId})
          ON CONFLICT (rotation_key_id) DO NOTHING
        `;
      }
    }

    // Encrypt and store the new rotation key, then seed runtime state
    const { encrypted, version } = await encryptApiKey(apiKey);

    const keyResult = await sql`
      INSERT INTO api_key_rotation (server_id, provider, api_key, key_version, is_main_key_pointer, is_enabled)
      VALUES (${serverId}, ${normalizedProvider}, ${encrypted}, ${version}, false, true)
      RETURNING rotation_key_id
    `;
    const keyId = keyResult[0]?.rotation_key_id as number | undefined;
    if (keyId) {
      await sql`
        INSERT INTO api_key_rotation_runtime_state (rotation_key_id)
        VALUES (${keyId})
        ON CONFLICT (rotation_key_id) DO NOTHING
      `;
    }

    if (keyId && normalizedProvider === "novelai") invalidateNovelAISubscription(apiKey);
    log.success(`Added rotation key for server ${serverId} (provider: ${normalizedProvider})`);
    return true;
  } catch (error) {
    log.error(`Error adding rotation key for server ${serverId}:`, error);
    return false;
  }
}

export async function purgeRotationKeysForProvider(serverId: number, provider: string): Promise<number> {
  try {
    const result = await sql`
      DELETE FROM api_key_rotation
      WHERE server_id = ${serverId}
        AND provider = ${provider.toLowerCase()}
    `;

    const deletedCount = result.count || 0;
    if (deletedCount > 0) {
      log.success(`Purged ${deletedCount} rotation key(s) for server ${serverId}, provider ${provider}`);
    }
    return deletedCount;
  } catch (error) {
    log.error(`Error purging rotation keys for server ${serverId}, provider ${provider}:`, error);
    return 0;
  }
}

export async function getRotationKeyCountForProvider(serverId: number, provider: string): Promise<number> {
  try {
    const result = await sql`
      SELECT COUNT(*) as count FROM api_key_rotation
      WHERE server_id = ${serverId}
        AND provider = ${provider.toLowerCase()}
        AND is_main_key_pointer = false
    `;
    return Number(result[0]?.count || 0);
  } catch (error) {
    log.error(`Error counting rotation keys for server ${serverId}, provider ${provider}:`, error);
    return 0;
  }
}
