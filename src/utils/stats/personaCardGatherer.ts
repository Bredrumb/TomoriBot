/**
 * personaCardGatherer.ts — data-gathering layer for the Persona "trading card"
 * infographic (plans/stat-tracking.md §10, Phase 3, Deliverable B).
 *
 * Mirrors the pattern in personalCardGatherer.ts:
 * - This is the ONLY file for the persona card that touches the DB.
 * - `gatherPersonaCardData` reads from existing StatRepository methods, resolves
 *   guild member display names, and returns a `PersonaCardData` struct.
 * - `renderPersonaCard` in statsInfographic.tsx consumes that struct as a pure
 *   function — it never touches the DB or the Discord API.
 *
 * Conditioning/memory reads are all-time only (not bucketed in the DB), so those
 * sections are always shown regardless of timeframe.
 */
import type { Guild } from "discord.js";
import type { TopUserEntry } from "@/utils/db/repositories/StatRepository";
import { statRepository } from "@/utils/db/repositories";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { safeDownload } from "@/utils/security/safeDownload";
import { log } from "@/utils/misc/logger";
import { type Timeframe, resolveWindowFrom } from "@/utils/stats/statsDashboard";
import type { PersonaCardData, ResolvedUserEntry } from "@/utils/stats/statsInfographic";

// ── Avatar fetch constants (same as personalCardGatherer) ─────────────────────

const AVATAR_MAX_SIZE_MB = 4;
const AVATAR_TIMEOUT_MS = 8_000;

// ── Display-name resolution ───────────────────────────────────────────────────

/**
 * Resolves a Discord user snowflake to the guild member's display name.
 * Falls back to a short ID suffix on any error (member left, API failure, etc.)
 * so rendering is never blocked by a failed lookup.
 *
 * @param guild      - The Discord.js Guild to resolve against.
 * @param userDiscId - Discord user snowflake string.
 */
async function resolveDisplayName(guild: Guild, userDiscId: string): Promise<string> {
  try {
    const member = await guild.members.fetch(userDiscId);
    return member.displayName;
  } catch {
    return `@${userDiscId.slice(-4)}`;
  }
}

/**
 * Resolves a list of TopUserEntry rows to ResolvedUserEntry structs with display names.
 * All fetches run in parallel (Promise.all) since each is independent.
 *
 * @param guild   - The Discord.js Guild to resolve against.
 * @param entries - Raw DB entries with userDiscId snowflakes.
 */
async function resolveDisplayNames(guild: Guild, entries: TopUserEntry[]): Promise<ResolvedUserEntry[]> {
  return Promise.all(
    entries.map(async (e) => ({
      displayName: await resolveDisplayName(guild, e.userDiscId),
      count: e.count,
    })),
  );
}

// ── Avatar fetch helper (copied from personalCardGatherer) ────────────────────

/**
 * Fetches a persona avatar from a URL and returns a base64 data URI. Returns
 * null on any failure so the renderer falls back to the initial-letter placeholder.
 *
 * @param avatarUrl - HTTP(S) URL of the avatar image.
 */
async function fetchAvatarDataUri(avatarUrl: string): Promise<string | null> {
  try {
    const result = await safeDownload(avatarUrl, {
      maxSizeMB: AVATAR_MAX_SIZE_MB,
      timeoutMs: AVATAR_TIMEOUT_MS,
    });
    if (!result.success || !result.buffer) return null;
    const mimeType = result.contentType ?? "image/png";
    return `data:${mimeType};base64,${result.buffer.toString("base64")}`;
  } catch (error) {
    log.warn(`personaCardGatherer: avatar fetch failed for ${avatarUrl}`, error as Error);
    return null;
  }
}

// ── Args type ─────────────────────────────────────────────────────────────────

/** Arguments for `gatherPersonaCardData`. */
export interface GatherPersonaCardArgs {
  /** Internal `servers` FK (not the Discord snowflake). */
  serverId: number;
  /** Discord guild snowflake, used for persona cache lookup and member resolution. */
  guildDiscId: string;
  /** Internal persona_lineage_id for the selected persona. */
  lineageId: number;
  /** BCP-47 locale string passed through to PersonaCardData. */
  locale: string;
  /** Selected time window — drives the metric window for message/vibe reads. */
  timeframe: Timeframe;
  /** Discord Guild object for display-name resolution. */
  guild: Guild;
}

// ── Main gather function ───────────────────────────────────────────────────────

/**
 * Gathers all data the Persona "trading card" needs from the DB and Discord API,
 * returning a `PersonaCardData` struct for the pure renderer.
 *
 * Read categories:
 * - Windowed (uses timeframe): message_sent, vibe metrics.
 * - All-time (not bucketed in DB): memory count, top people by memory,
 *   conditioning top users, server rank (server rank uses the window too).
 * - External: persona avatar via safeDownload.
 *
 * @param args - Scope, locale, timeframe, and Discord guild for name resolution.
 */
export async function gatherPersonaCardData(args: GatherPersonaCardArgs): Promise<PersonaCardData> {
  const { serverId, guildDiscId, lineageId, locale, timeframe, guild } = args;
  const windowFrom = resolveWindowFrom(timeframe);
  const windowArg = windowFrom ? { from: windowFrom } : {};

  // ── 1. Parallel windowed reads ────────────────────────────────────────────────
  const [totalMessages, vibeSprites, vibeEmoji, vibeStickers, vibeTools, serverPersonaRoster] = await Promise.all([
    statRepository.getMetricTotal({ metric: "message_sent", serverId, lineageId, ...windowArg }),
    statRepository.getMetricTotal({ metric: "sprite_shown", serverId, lineageId, ...windowArg }),
    statRepository.getMetricTotal({ metric: "emoji_used", serverId, lineageId, ...windowArg }),
    statRepository.getMetricTotal({ metric: "sticker_used", serverId, lineageId, ...windowArg }),
    statRepository.getMetricTotal({ metric: "tool_used", serverId, lineageId, ...windowArg }),
    // Fetch more results than needed so we can find the persona's exact rank position.
    statRepository.getServerPersonaMessages({ serverId, limit: 20, ...windowArg }),
  ]);

  // ── 2. Derive server rank from the persona roster ─────────────────────────────
  // 1-based rank (e.g. rank=1 means most popular). 0 = not found in top 20.
  const rankIndex = serverPersonaRoster.findIndex((p) => p.lineageId === lineageId);
  const serverRank = rankIndex >= 0 ? rankIndex + 1 : 0;

  // ── 3. All-time reads (conditioning and memory are not daily-bucketed) ────────
  const [memoryCount, rawTopPeopleByMemory, rawMostRewardedBy, rawMostPunishedBy] = await Promise.all([
    statRepository.getPersonaMemoryCount({ lineageId }),
    statRepository.getTopUsersByMemory({ serverId, lineageId, limit: 3 }),
    statRepository.getConditioningTopUsers({ serverId, lineageId, type: "reward", limit: 2 }),
    statRepository.getConditioningTopUsers({ serverId, lineageId, type: "punish", limit: 2 }),
  ]);

  // ── 4. Resolve display names in parallel ─────────────────────────────────────
  const [topPeopleByMemory, mostRewardedBy, mostPunishedBy] = await Promise.all([
    resolveDisplayNames(guild, rawTopPeopleByMemory),
    resolveDisplayNames(guild, rawMostRewardedBy),
    resolveDisplayNames(guild, rawMostPunishedBy),
  ]);

  // ── 5. Persona name + avatar from cache ──────────────────────────────────────
  let personaName = `Persona #${lineageId}`;
  let personaAvatarDataUri: string | null = null;

  try {
    const personas = await getCachedAllPersonas(guildDiscId);
    const match = personas.find((p) => p.persona_lineage_id === lineageId);
    if (match) {
      personaName = match.persona_nickname;
      const avatarUrl = match.webhook_avatar_url ?? null;
      if (avatarUrl) {
        personaAvatarDataUri = await fetchAvatarDataUri(avatarUrl);
      }
    }
  } catch (error) {
    log.warn("personaCardGatherer: persona resolution failed", error as Error);
  }

  // ── 6. Assemble PersonaCardData ───────────────────────────────────────────────
  return {
    locale,
    timeframe,
    personaName,
    personaAvatarDataUri,
    totalMessages,
    memoryCount,
    serverRank,
    topPeopleByMemory,
    mostRewardedBy,
    mostPunishedBy,
    vibeSprites,
    vibeEmoji,
    vibeStickers,
    vibeTools,
  };
}
