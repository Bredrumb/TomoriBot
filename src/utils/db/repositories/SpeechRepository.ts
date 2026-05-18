/**
 * SpeechRepository — manages voice sample CRUD and speech endpoint resolution.
 *
 * Owns tables: voice_samples, custom_endpoints (speech/transcription rows),
 * saved_provider_configs (credential lookup by provider name), and
 * tomoris.speech_voice_sample_id (persona voice assignment).
 *
 * Note: decryptApiKey is NOT called here — credential decryption is a security
 * concern owned by the caller (speechEndpointResolver.ts). This repo returns
 * the raw encrypted key and key_version so callers can decrypt with the
 * appropriate key rotation context.
 *
 * Export contract: toExportShape returns null — voice samples reference
 * server-local files and are not portably exportable across servers.
 */
import type { CustomEndpointRow, VoiceSampleRow } from "@/types/db/schema";
import { customEndpointSchema, voiceSampleSchema } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import type { IRepository } from "./IRepository";

/**
 * Raw credential row returned by loadEndpointCredentials.
 * Callers decrypt api_key using decryptApiKey(api_key, key_version).
 */
export type EndpointCredentialRow = {
  api_key: Buffer;
  key_version: number;
};

// ── endpoint resolution ─────────────────────────────────────────────────────

/**
 * Find the active (is_default) custom endpoint for a speech/transcription capability.
 *
 * @param serverId   - Internal server DB ID
 * @param capability - "speech" or "transcription"
 * @returns Parsed CustomEndpointRow or null if none registered
 */
export async function loadActiveEndpoint(
  serverId: number,
  capability: "speech" | "transcription",
): Promise<CustomEndpointRow | null> {
  try {
    const rows = await sql`
      SELECT * FROM custom_endpoints
      WHERE server_id = ${serverId}
        AND capability = ${capability}
        AND user_id IS NULL
        AND is_default = true
      ORDER BY updated_at DESC, custom_endpoint_id DESC
      LIMIT 1
    `;
    if (!rows || rows.length === 0) return null;

    const parsed = customEndpointSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(
        `SpeechRepository.loadActiveEndpoint: parse failed for ${capability} on server ${serverId}: ${parsed.error.message}`,
      );
      return null;
    }
    return parsed.data;
  } catch (error) {
    log.error(`SpeechRepository.loadActiveEndpoint: failed for server ${serverId}`, error);
    return null;
  }
}

/**
 * Load encrypted credentials for a provider (keyed by internal provider name).
 * Returns null when no credentials are stored.
 *
 * @param serverId     - Internal server DB ID
 * @param providerName - Internal provider name (e.g. "custom:s123:label")
 * @returns Raw encrypted credential row or null
 */
export async function loadEndpointCredentials(
  serverId: number,
  providerName: string,
): Promise<EndpointCredentialRow | null> {
  try {
    const [row] = await sql`
      SELECT api_key, key_version FROM saved_provider_configs
      WHERE server_id = ${serverId}
        AND provider = ${providerName}
      LIMIT 1
    `;
    if (!row?.api_key) return null;
    return { api_key: row.api_key as Buffer, key_version: (row.key_version as number) ?? 1 };
  } catch (error) {
    log.error(`SpeechRepository.loadEndpointCredentials: failed for server ${serverId}`, error);
    return null;
  }
}

// ── voice sample CRUD ───────────────────────────────────────────────────────

/**
 * Load all voice samples registered for a server, ordered by name.
 *
 * @param serverId - Internal server DB ID
 * @returns Array of VoiceSampleRow (may be empty)
 */
export async function loadVoiceSamples(serverId: number): Promise<VoiceSampleRow[]> {
  try {
    const rows = await sql`
      SELECT sample_id, name, file_path, ref_text, duration_ms, created_at
      FROM voice_samples
      WHERE server_id = ${serverId}
      ORDER BY name
    `;
    return rows as VoiceSampleRow[];
  } catch (error) {
    log.error(`SpeechRepository.loadVoiceSamples: failed for server ${serverId}`, error);
    return [];
  }
}

/**
 * Load a single voice sample by ID.
 *
 * @param sampleId - Primary key of the voice sample
 * @returns Parsed VoiceSampleRow or null if not found
 */
export async function loadVoiceSampleById(sampleId: number): Promise<VoiceSampleRow | null> {
  try {
    const rows = await sql`
      SELECT * FROM voice_samples WHERE sample_id = ${sampleId} LIMIT 1
    `;
    if (!rows || rows.length === 0) return null;
    const parsed = voiceSampleSchema.safeParse(rows[0]);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    log.error(`SpeechRepository.loadVoiceSampleById: failed for sample ${sampleId}`, error);
    return null;
  }
}

/**
 * Insert a placeholder voice sample row to reserve a sample_id before storage.
 * Callers must follow up with updateVoiceSamplePath once the file is stored.
 *
 * @param serverId   - Internal server DB ID
 * @param name       - Display name for the sample
 * @param refText    - Optional reference transcript text
 * @param durationMs - Audio duration in milliseconds (0 if unknown)
 * @returns Inserted sample_id or null on failure
 */
export async function insertVoiceSample(
  serverId: number,
  name: string,
  refText: string | null,
  durationMs: number,
): Promise<number | null> {
  try {
    const [row] = await sql<[{ sample_id: number }]>`
      INSERT INTO voice_samples (server_id, name, file_path, ref_text, duration_ms)
      VALUES (${serverId}, ${name}, '', ${refText}, ${durationMs})
      RETURNING sample_id
    `;
    return row?.sample_id ?? null;
  } catch (error) {
    log.error(`SpeechRepository.insertVoiceSample: failed for server ${serverId}`, error);
    return null;
  }
}

/**
 * Update the file_path on a voice sample row after successful storage.
 *
 * @param sampleId - Primary key of the voice sample
 * @param filePath - Storage reference (S3 URL or local path)
 */
export async function updateVoiceSamplePath(sampleId: number, filePath: string): Promise<void> {
  await sql`UPDATE voice_samples SET file_path = ${filePath} WHERE sample_id = ${sampleId}`;
}

/**
 * Delete a voice sample row by ID.
 *
 * @param sampleId - Primary key of the voice sample
 */
export async function deleteVoiceSample(sampleId: number): Promise<void> {
  await sql`DELETE FROM voice_samples WHERE sample_id = ${sampleId}`;
}

/**
 * Count how many persona (tomoris) rows currently reference a voice sample.
 * Used to display a warning before deletion.
 *
 * @param serverId - Internal server DB ID
 * @param sampleId - Primary key of the voice sample
 * @returns Reference count (0 when not referenced)
 */
export async function countPersonaVoiceSampleRefs(serverId: number, sampleId: number): Promise<number> {
  try {
    const [row] = await sql<[{ count: string }]>`
      SELECT COUNT(*) AS count FROM tomoris
      WHERE server_id = ${serverId}
        AND speech_voice_sample_id = ${sampleId}
    `;
    return Number(row?.count ?? 0);
  } catch (error) {
    log.error(`SpeechRepository.countPersonaVoiceSampleRefs: failed for sample ${sampleId}`, error);
    return 0;
  }
}

/**
 * Clear the voice sample assignment from all persona rows that reference the given sample.
 * Called before deletion so no persona is left pointing to a deleted sample.
 *
 * @param serverId - Internal server DB ID
 * @param sampleId - Primary key of the voice sample being removed
 */
export async function clearPersonaVoiceSampleRefs(serverId: number, sampleId: number): Promise<void> {
  await sql`
    UPDATE tomoris
    SET speech_voice_sample_id = NULL
    WHERE server_id = ${serverId}
      AND speech_voice_sample_id = ${sampleId}
  `;
}

// ── IRepository stub ────────────────────────────────────────────────────────

/**
 * SpeechRepository class — satisfies IRepository; export shape is null because
 * voice samples reference server-local files that are not portably exportable.
 */
export class SpeechRepository implements IRepository<null> {
  async toExportShape(_ownerId: string | number): Promise<null> {
    return null;
  }

  async fromExportShape(_ownerId: string | number, _data: null): Promise<boolean> {
    return true;
  }
}

/** Singleton instance — import this in callers. */
export const speechRepository = new SpeechRepository();
