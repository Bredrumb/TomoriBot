import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "discord.js";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { sql } from "@/utils/db/client";
import { personaRepository } from "@/utils/db/repositories";
import { getPresetAvatarBuffer, hashAvatarBuffer } from "@/utils/image/avatarHelper";
import { log } from "@/utils/misc/logger";
import {
  deletePersonaAvatarFromStorage,
  loadStoredPersonaAvatarBuffer,
  uploadPersonaAvatarToStorage,
} from "@/utils/storage/avatarStorage";

type PresetAvatarSyncCandidate = {
  persona_id: number;
  server_disc_id: string;
  is_dm_channel: boolean;
  is_alter: boolean;
  webhook_avatar_url: string | null;
  persona_preset_id: number;
  persona_preset_name: string;
  preset_avatar_path: string | null;
  avatar_source_path: string | null;
  avatar_source_hash: string | null;
};

type PresetAvatarSource = {
  sourcePath: string | null;
  sourceHash: string | null;
  dataUri: string | null;
  buffer: Buffer | null;
};

type PresetAvatarSyncDecision = "sync" | "initialize" | "skip" | "missing";

type PresetAvatarSyncConfig = {
  enabled: boolean;
  delayMs: number;
  apiTimeoutMs: number;
  maxPerRun: number;
};

const DEFAULT_AVATAR_SYNC_DELAY_MS = 3000;
const DEFAULT_AVATAR_SYNC_API_TIMEOUT_MS = 15000;

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPresetAvatarSyncConfig(): PresetAvatarSyncConfig {
  const enabled = process.env.PRESET_AVATAR_SYNC_ENABLED?.trim().toLowerCase() !== "false";
  const delayMs = parseNonNegativeInteger(process.env.PRESET_AVATAR_SYNC_DELAY_MS, DEFAULT_AVATAR_SYNC_DELAY_MS);
  const apiTimeoutMs = parsePositiveInteger(
    process.env.PRESET_AVATAR_SYNC_API_TIMEOUT_MS,
    DEFAULT_AVATAR_SYNC_API_TIMEOUT_MS,
  );
  const maxPerRun = parseNonNegativeInteger(process.env.PRESET_AVATAR_SYNC_MAX_PER_RUN, 0);

  return { enabled, delayMs, apiTimeoutMs, maxPerRun };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadPresetAvatarSyncCandidates(): Promise<PresetAvatarSyncCandidate[]> {
  const rows = await sql<PresetAvatarSyncCandidate[]>`
    SELECT
      p.persona_id,
      s.server_disc_id,
      s.is_dm_channel,
      p.is_alter,
      p.webhook_avatar_url,
      pp.persona_preset_id,
      pp.persona_preset_name,
      pp.preset_avatar_path,
      ps.avatar_source_path,
      ps.avatar_source_hash
    FROM persona_preset_sync_state ps
    JOIN personas p ON p.persona_id = ps.persona_id
    JOIN servers s ON s.server_id = p.server_id
    JOIN persona_presets pp
      ON pp.preset_lineage_id = ps.preset_lineage_id
      AND pp.preset_language = ps.preset_language
    WHERE ps.sync_mode = 'auto'
      AND ps.avatar_sync_mode = 'auto'
      AND (
        pp.preset_avatar_path IS NOT NULL
        OR ps.avatar_source_path IS NOT NULL
        OR ps.avatar_source_hash IS NOT NULL
      )
    ORDER BY ps.avatar_synced_at NULLS FIRST, p.persona_id ASC
  `;

  return rows;
}

async function loadPresetAvatarSource(candidate: PresetAvatarSyncCandidate): Promise<PresetAvatarSource> {
  const sourcePath = normalizeOptionalText(candidate.preset_avatar_path);
  if (!sourcePath) {
    return {
      sourcePath: null,
      sourceHash: null,
      dataUri: null,
      buffer: null,
    };
  }

  const buffer = await getPresetAvatarBuffer({
    persona_preset_id: candidate.persona_preset_id,
    persona_preset_name: candidate.persona_preset_name,
    preset_avatar_path: sourcePath,
  });

  if (!buffer) {
    return {
      sourcePath,
      sourceHash: null,
      dataUri: null,
      buffer: null,
    };
  }

  return {
    sourcePath,
    sourceHash: hashAvatarBuffer(buffer),
    dataUri: `data:image/png;base64,${buffer.toString("base64")}`,
    buffer,
  };
}

async function hashAvatarFileAtPath(sourcePath: string | null): Promise<string | null> {
  const normalizedPath = normalizeOptionalText(sourcePath);
  if (!normalizedPath) {
    return null;
  }

  try {
    const buffer = await readFile(path.join(process.cwd(), normalizedPath));
    return hashAvatarBuffer(buffer);
  } catch (error) {
    log.warn(`[Preset Avatar Sync] Failed to hash previous avatar source "${normalizedPath}"`, error);
    return null;
  }
}

function decidePresetAvatarSync(
  candidate: PresetAvatarSyncCandidate,
  source: PresetAvatarSource,
): PresetAvatarSyncDecision {
  if (source.sourcePath && !source.sourceHash) {
    return "missing";
  }

  const baselinePath = normalizeOptionalText(candidate.avatar_source_path);
  const baselineHash = normalizeOptionalText(candidate.avatar_source_hash);
  const hasBaseline = baselinePath !== null || baselineHash !== null;

  if (!hasBaseline) {
    return "initialize";
  }

  if (baselinePath !== source.sourcePath) {
    return "sync";
  }

  if (baselineHash !== null && baselineHash !== source.sourceHash) {
    return "sync";
  }

  if (baselineHash === null && source.sourceHash !== null) {
    return "initialize";
  }

  return "skip";
}

async function recordPresetAvatarBaseline(
  personaId: number,
  source: PresetAvatarSource,
  markSynced: boolean,
): Promise<boolean> {
  const result = await sql<Array<{ persona_id: number }>>`
    UPDATE persona_preset_sync_state
    SET
      avatar_sync_mode = 'auto',
      avatar_source_path = ${source.sourcePath},
      avatar_source_hash = ${source.sourceHash},
      avatar_synced_at = CASE
        WHEN ${markSynced} THEN CURRENT_TIMESTAMP
        ELSE avatar_synced_at
      END
    WHERE persona_id = ${personaId}
    RETURNING persona_id
  `;

  return result.length > 0;
}

async function patchGuildAvatar(
  guildId: string,
  dataUri: string | null,
  timeoutMs: number,
): Promise<{ success: true } | { success: false; details: string }> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    return { success: false, details: "DISCORD_TOKEN is not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ avatar: dataUri }),
      signal: controller.signal,
    });

    if (response.ok) {
      return { success: true };
    }

    const errorText = await response.text().catch(() => "");
    const details = `${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`;
    return { success: false, details };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, details: `Timed out after ${timeoutMs}ms` };
    }
    return {
      success: false,
      details: error instanceof Error ? error.message : "Unknown Discord API error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function syncMainPersonaAvatar(
  client: Client,
  candidate: PresetAvatarSyncCandidate,
  source: PresetAvatarSource,
  apiTimeoutMs: number,
): Promise<boolean> {
  const guild =
    client.guilds.cache.get(candidate.server_disc_id) ??
    (await client.guilds.fetch(candidate.server_disc_id).catch(() => null));

  if (!guild) {
    log.warn(
      `[Preset Avatar Sync] Skipping persona ${candidate.persona_id}; guild ${candidate.server_disc_id} not found`,
    );
    return false;
  }

  const result = await patchGuildAvatar(guild.id, source.dataUri, apiTimeoutMs);
  if (!result.success) {
    log.warn(
      `[Preset Avatar Sync] Failed to update guild avatar for persona ${candidate.persona_id}: ${result.details}`,
    );
    return false;
  }

  return true;
}

async function isAlterAvatarManuallyChanged(
  candidate: PresetAvatarSyncCandidate,
  fallbackSourceHash: string | null = null,
): Promise<boolean> {
  const previousSourceHash =
    normalizeOptionalText(candidate.avatar_source_hash) ??
    (await hashAvatarFileAtPath(normalizeOptionalText(candidate.avatar_source_path))) ??
    fallbackSourceHash;

  if (!previousSourceHash) {
    return false;
  }

  const currentAvatarReference = normalizeOptionalText(candidate.webhook_avatar_url);
  if (!currentAvatarReference) {
    await personaRepository.markOfficialPresetAvatarManual(candidate.persona_id);
    log.info(
      `[Preset Avatar Sync] Preserving removed alter avatar for persona ${candidate.persona_id}; avatar sync set to manual`,
    );
    return true;
  }

  const currentAvatarBuffer = await loadStoredPersonaAvatarBuffer(currentAvatarReference);
  if (!currentAvatarBuffer) {
    log.warn(
      `[Preset Avatar Sync] Could not read current alter avatar for persona ${candidate.persona_id}; attempting official repair`,
    );
    return false;
  }

  if (hashAvatarBuffer(currentAvatarBuffer) === previousSourceHash) {
    return false;
  }

  await personaRepository.markOfficialPresetAvatarManual(candidate.persona_id);
  log.info(
    `[Preset Avatar Sync] Preserving custom alter avatar for persona ${candidate.persona_id}; avatar sync set to manual`,
  );
  return true;
}

async function syncAlterPersonaAvatar(
  candidate: PresetAvatarSyncCandidate,
  source: PresetAvatarSource,
): Promise<boolean> {
  const currentAvatarReference = normalizeOptionalText(candidate.webhook_avatar_url);

  if (!source.buffer) {
    const avatarUpdated = await personaRepository.setAvatar(candidate.persona_id, null);
    if (!avatarUpdated) {
      return false;
    }

    invalidateTomoriStateCache(candidate.server_disc_id);

    if (currentAvatarReference) {
      await deletePersonaAvatarFromStorage(currentAvatarReference);
    }
    return true;
  }

  const storedAvatarUrl = await uploadPersonaAvatarToStorage({
    personaId: candidate.persona_id,
    serverDiscId: candidate.server_disc_id,
    label: "official preset sync",
    buffer: source.buffer,
  });

  if (!storedAvatarUrl) {
    return false;
  }

  const avatarUpdated = await personaRepository.setAvatar(candidate.persona_id, storedAvatarUrl);
  if (!avatarUpdated) {
    return false;
  }

  invalidateTomoriStateCache(candidate.server_disc_id);

  if (currentAvatarReference && currentAvatarReference !== storedAvatarUrl) {
    await deletePersonaAvatarFromStorage(currentAvatarReference);
  }

  return true;
}

export async function runOfficialPresetAvatarSync(client: Client): Promise<void> {
  const config = getPresetAvatarSyncConfig();
  if (!config.enabled) {
    log.info("[Preset Avatar Sync] Disabled by PRESET_AVATAR_SYNC_ENABLED=false");
    return;
  }

  try {
    const allCandidates = await loadPresetAvatarSyncCandidates();
    const candidates = config.maxPerRun > 0 ? allCandidates.slice(0, config.maxPerRun) : allCandidates;

    if (candidates.length === 0) {
      log.info("[Preset Avatar Sync] No official preset avatars need evaluation");
      return;
    }

    let synced = 0;
    let initialized = 0;
    let preservedManual = 0;
    let skipped = 0;
    let failed = 0;

    log.info(
      `[Preset Avatar Sync] Evaluating ${candidates.length} official preset avatar baseline(s)` +
        (allCandidates.length > candidates.length ? ` (${allCandidates.length - candidates.length} deferred)` : ""),
    );

    for (const candidate of candidates) {
      const source = await loadPresetAvatarSource(candidate);
      const decision = decidePresetAvatarSync(candidate, source);

      if (decision === "skip") {
        skipped += 1;
        continue;
      }

      if (decision === "missing") {
        failed += 1;
        log.warn(
          `[Preset Avatar Sync] Missing current avatar file "${source.sourcePath}" for preset ` +
            `${candidate.persona_preset_name}`,
        );
        continue;
      }

      if (decision === "initialize") {
        if (
          candidate.is_alter &&
          !candidate.is_dm_channel &&
          (await isAlterAvatarManuallyChanged(candidate, source.sourceHash))
        ) {
          preservedManual += 1;
          continue;
        }

        const baselineRecorded = await recordPresetAvatarBaseline(candidate.persona_id, source, false);
        if (baselineRecorded) {
          initialized += 1;
        } else {
          failed += 1;
        }
        continue;
      }

      if (candidate.is_dm_channel) {
        const baselineRecorded = await recordPresetAvatarBaseline(candidate.persona_id, source, false);
        if (baselineRecorded) {
          skipped += 1;
        } else {
          failed += 1;
        }
        continue;
      }

      if (candidate.is_alter && (await isAlterAvatarManuallyChanged(candidate))) {
        preservedManual += 1;
        continue;
      }

      const avatarSynced = candidate.is_alter
        ? await syncAlterPersonaAvatar(candidate, source)
        : await syncMainPersonaAvatar(client, candidate, source, config.apiTimeoutMs);

      if (!avatarSynced) {
        failed += 1;
        continue;
      }

      const baselineRecorded = await recordPresetAvatarBaseline(candidate.persona_id, source, true);
      if (!baselineRecorded) {
        failed += 1;
        continue;
      }

      synced += 1;

      if (!candidate.is_alter) {
        await sleep(config.delayMs);
      }
    }

    log.success(
      `[Preset Avatar Sync] Complete: ${synced} synced, ${initialized} initialized, ` +
        `${preservedManual} preserved as manual, ${skipped} skipped, ${failed} failed`,
    );
  } catch (error) {
    log.error("[Preset Avatar Sync] Failed to run official preset avatar sync", error);
  }
}
