import type { Client } from "discord.js";
import { personaRepository, type UnsyncedMainPointer } from "@/utils/db/repositories";
import { setGuildBotAvatar } from "@/utils/discord/guildIdentity";
import { log } from "@/utils/misc/logger";
import { loadStoredPersonaAvatarBuffer } from "@/utils/storage/avatarStorage";
import { hasShardLeaseOwnership } from "@/utils/cluster/shardLeases";
import { getShardTopology } from "@/utils/discord/shardOwnership";

// Zero is admitted because MAX_PER_RUN uses 0 as the unlimited sentinel.
function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Sequential guild-avatar PATCHes are paced because Discord's ~50 req/s global limit and avatar throttling require
// headroom for live traffic.
const SYNC_ENABLED = (process.env.PRESET_AVATAR_SYNC_ENABLED?.trim().toLowerCase() ?? "true") !== "false";
const DELAY_MS = readIntEnv("PRESET_AVATAR_SYNC_DELAY_MS", 3000);
const API_TIMEOUT_MS = readIntEnv("PRESET_AVATAR_SYNC_API_TIMEOUT_MS", 15_000);
// 0 means unlimited; otherwise PATCHes per run are capped so a large backlog drains across boots.
const MAX_PER_RUN = readIntEnv("PRESET_AVATAR_SYNC_MAX_PER_RUN", 0);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function patchGuildAvatar(guildDiscId: string, avatarDataUri: string): Promise<"ok" | "rate_limited" | "failed"> {
  const result = await setGuildBotAvatar(guildDiscId, avatarDataUri, API_TIMEOUT_MS);
  return result.success ? "ok" : result.error === "rate_limited" ? "rate_limited" : "failed";
}

// Must remain fire-and-forget from clientReady without being awaited by startup because paced avatar PATCHes can run
// long.
export async function reconcilePresetMainAvatars(client: Client): Promise<void> {
  if (!hasShardLeaseOwnership()) return;
  if (!SYNC_ENABLED) {
    log.info("[Preset Avatar Fanout] Disabled via PRESET_AVATAR_SYNC_ENABLED=false; skipping run");
    return;
  }

  let targets: UnsyncedMainPointer[];
  try {
    targets = await personaRepository.loadUnsyncedMainPointers();
  } catch (error) {
    log.warn("[Preset Avatar Fanout] Failed to load unsynced main pointers; skipping run", error);
    return;
  }

  if (targets.length === 0) {
    log.info("[Preset Avatar Fanout] No main personas need an avatar update");
    return;
  }

  log.info(`[Preset Avatar Fanout] ${targets.length} main persona(s) pending guild-avatar sync`);

  // Cache the avatar PNG (as a data URI) per shared URL, because most servers point at
  // the same handful of preset images, so this downloads each at most once.
  const dataUriByUrl = new Map<string, string | null>();
  let applied = 0;
  let rateLimited = 0;
  let processed = 0;

  for (const target of targets) {
    if (!hasShardLeaseOwnership()) break;
    if (!getShardTopology().ownsServer(target.server_disc_id, false)) continue;
    if (MAX_PER_RUN > 0 && applied >= MAX_PER_RUN) {
      log.info(`[Preset Avatar Fanout] Reached per-run cap (${MAX_PER_RUN}); remaining sync deferred to next boot`);
      break;
    }

    const guild = client.guilds.cache.get(target.server_disc_id);
    if (!guild) {
      continue;
    }

    let avatarDataUri = dataUriByUrl.get(target.preset_avatar_shared_url);
    if (avatarDataUri === undefined) {
      const buffer = await loadStoredPersonaAvatarBuffer(target.preset_avatar_shared_url);
      avatarDataUri = buffer ? `data:image/png;base64,${buffer.toString("base64")}` : null;
      dataUriByUrl.set(target.preset_avatar_shared_url, avatarDataUri);
    }
    if (!avatarDataUri) {
      log.warn(
        `[Preset Avatar Fanout] Could not load shared avatar ${target.preset_avatar_shared_url}; skipping guild ${target.server_disc_id}`,
      );
      continue;
    }

    if (processed > 0) {
      await sleep(DELAY_MS);
    }
    processed++;

    // Re-check pointer status after pacing delays because a user may have customized the avatar while queued.
    try {
      const isPointer = await personaRepository.isPersonaPointer(target.persona_id);
      if (!isPointer) {
        log.info(
          `[Preset Avatar Fanout] Persona ${target.persona_id} is no longer a pointer; skipping guild ${target.server_disc_id}`,
        );
        continue;
      }
    } catch (error) {
      log.warn(
        `[Preset Avatar Fanout] Failed to check is_pointer for persona ${target.persona_id}; skipping to be safe`,
        error,
      );
      continue;
    }

    if (!hasShardLeaseOwnership()) break;
    const result = await patchGuildAvatar(target.server_disc_id, avatarDataUri);
    if (result === "ok") {
      try {
        await personaRepository.stampPointerAvatarHash(target.persona_id, target.preset_avatar_hash);
        applied++;
        log.info(`[Preset Avatar Fanout] Synced guild ${target.server_disc_id} avatar (persona ${target.persona_id})`);
      } catch (error) {
        log.warn(
          `[Preset Avatar Fanout] PATCH succeeded but failed to stamp applied_avatar_hash for persona ${target.persona_id}; will retry next boot`,
          error,
        );
      }
    } else if (result === "rate_limited") {
      rateLimited++;
      log.warn(`[Preset Avatar Fanout] Guild ${target.server_disc_id} rate limited; deferring to next boot`);
    }
  }

  log.success(
    `[Preset Avatar Fanout] Reconcile complete: ${applied} synced, ${rateLimited} rate-limited, ${targets.length} pending at start`,
  );
}
