/**
 * Preset main-avatar fan-out reconciler.
 *
 * Main persona avatars are the bot's Discord guild member avatar — Discord-owned
 * state that cannot be live-resolved per message (unlike alter avatars/sprites).
 * So when a default preset's avatar art changes in the catalog, the only way to
 * fan it out to every server whose main persona is still an unforked pointer is
 * to PATCH each guild's member avatar once.
 *
 * This is a throttled, best-effort, resumable BACKGROUND reconciler — never a
 * startup burst and never blocking boot. Every PATCH is gated on a real byte
 * change via the hash columns (persona_presets.preset_avatar_hash vs
 * personas.applied_avatar_hash), which makes the run naturally idempotent and
 * resumable: an interrupted or rate-limited run simply picks up where it left
 * off on the next boot. Customized (materialized) personas are skipped
 * automatically because they are no longer pointers.
 *
 * See docs/subsystems/persona-presets.md and docs/subsystems/multi-persona.md.
 */

import type { Client } from "discord.js";
import { personaRepository, type UnsyncedMainPointer } from "@/utils/db/repositories";
import { isAvatarUpdateRateLimited } from "@/utils/discord/avatarRateLimit";
import { log } from "@/utils/misc/logger";
import { loadStoredPersonaAvatarBuffer } from "@/utils/storage/avatarStorage";

/**
 * Parses a non-negative-integer env var, falling back to a default when unset or
 * malformed. Keeps the throttle knobs configurable without hardcoding limits.
 * (0 is allowed — it is the documented "unlimited" sentinel for MAX_PER_RUN.)
 */
function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Throttle / safety knobs (documented in .env.optional.example). Discord's
 * documented per-guild bucket lets one PATCH per guild proceed independently,
 * but the bot-wide global limit (~50 req/s) and Discord's aggressive
 * avatar-change throttling mean a mass burst must be paced. Sequential PATCHes
 * with a delay between each stay far under the global limit and leave headroom
 * for live traffic.
 */
/** Operational kill switch (enabled by default). */
const SYNC_ENABLED = (process.env.PRESET_AVATAR_SYNC_ENABLED?.trim().toLowerCase() ?? "true") !== "false";
/** Delay between successive guild-avatar PATCHes. */
const DELAY_MS = readIntEnv("PRESET_AVATAR_SYNC_DELAY_MS", 3000);
/** Per-PATCH request timeout. */
const API_TIMEOUT_MS = readIntEnv("PRESET_AVATAR_SYNC_API_TIMEOUT_MS", 15_000);
/** 0 = unlimited; otherwise cap PATCHes per run so a large backlog drains across boots. */
const MAX_PER_RUN = readIntEnv("PRESET_AVATAR_SYNC_MAX_PER_RUN", 0);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PATCHes one guild's member avatar to the supplied PNG data URI.
 *
 * @returns "ok" on success, "rate_limited" when Discord throttled the change, or
 *   "failed" for any other non-2xx / network error (all retried on a later boot).
 */
async function patchGuildAvatar(guildDiscId: string, avatarDataUri: string): Promise<"ok" | "rate_limited" | "failed"> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildDiscId}/members/@me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ avatar: avatarDataUri }),
      signal: abortController.signal,
    });

    if (response.ok) {
      return "ok";
    }

    const errorText = await response.text();
    if (isAvatarUpdateRateLimited(response.status, errorText)) {
      return "rate_limited";
    }
    log.warn(
      `[Preset Avatar Fanout] Guild ${guildDiscId} avatar PATCH failed (non-fatal): ${response.status} ${response.statusText} - ${errorText}`,
    );
    return "failed";
  } catch (error) {
    log.warn(`[Preset Avatar Fanout] Guild ${guildDiscId} avatar PATCH threw (non-fatal)`, error);
    return "failed";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Runs one reconciliation pass. Intended to be fire-and-forget from clientReady
 * (never awaited by startup). Loads the work set, then for each present guild
 * downloads the shared preset avatar (cached per URL since many servers share
 * one image), PATCHes the guild avatar, and stamps applied_avatar_hash on
 * success so the persona is skipped next time.
 *
 * @param client - The ready Discord client
 */
export async function reconcilePresetMainAvatars(client: Client): Promise<void> {
  // Operational kill switch. Default-on; an operator can disable the fan-out
  // entirely (e.g. during an incident) without a code change.
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

  // Cache the avatar PNG (as a data URI) per shared URL — most servers point at
  // the same handful of preset images, so this downloads each at most once.
  const dataUriByUrl = new Map<string, string | null>();
  let applied = 0;
  let rateLimited = 0;
  let processed = 0;

  for (const target of targets) {
    if (MAX_PER_RUN > 0 && applied >= MAX_PER_RUN) {
      log.info(`[Preset Avatar Fanout] Reached per-run cap (${MAX_PER_RUN}); remaining sync deferred to next boot`);
      break;
    }

    // Only touch guilds the bot is actually in (and that are cached).
    const guild = client.guilds.cache.get(target.server_disc_id);
    if (!guild) {
      continue;
    }

    // Resolve the shared avatar bytes to a PNG data URI (cached per URL).
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

    // Pace each PATCH to stay under the bot-wide global rate limit.
    if (processed > 0) {
      await sleep(DELAY_MS);
    }
    processed++;

    // Prevent race condition: check if the user customized the avatar (materializing the pointer)
    // while this server was waiting in the reconciler queue.
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

    const result = await patchGuildAvatar(target.server_disc_id, avatarDataUri);
    if (result === "ok") {
      // Stamp the applied hash so this persona is skipped until the art changes again.
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
      // Leave applied_avatar_hash unchanged so this persona is retried next boot.
      rateLimited++;
      log.warn(`[Preset Avatar Fanout] Guild ${target.server_disc_id} rate limited; deferring to next boot`);
    }
  }

  log.success(
    `[Preset Avatar Fanout] Reconcile complete: ${applied} synced, ${rateLimited} rate-limited, ${targets.length} pending at start`,
  );
}
