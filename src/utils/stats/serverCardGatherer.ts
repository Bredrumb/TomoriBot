/**
 * serverCardGatherer.ts — data-gathering layer for the Server "Year in Review"
 * infographic card (plans/stat-tracking.md §10, Phase 3, Deliverable B).
 *
 * Mirrors the pattern in personalCardGatherer.ts:
 * - This is the ONLY file for the server card that touches the DB.
 * - `gatherServerCardData` reads from existing StatRepository methods, resolves
 *   guild member display names and persona names, and returns a `ServerCardData`
 *   struct.
 * - `renderServerCard` in statsInfographic.tsx consumes that struct as a pure
 *   function — it never touches the DB or the Discord API.
 *
 * Generation totals (text/image/video) are all-time only (quota counter tables
 * are not daily-bucketed), so `generationTotals` is only populated when
 * `timeframe === "all_time"`.
 */
import type { Guild } from "discord.js";
import type { TopUserEntry } from "@/utils/db/repositories/StatRepository";
import { statRepository } from "@/utils/db/repositories";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { log } from "@/utils/misc/logger";
import { type Timeframe, resolveWindowFrom } from "@/utils/stats/statsDashboard";
import type { ResolvedUserEntry, ServerCardData } from "@/utils/stats/statsInfographic";

// ── Display-name resolution ───────────────────────────────────────────────────

/**
 * Resolves a Discord user snowflake to the guild member's display name.
 * Falls back to a short ID suffix on any error (member left, API failure, etc.)
 *
 * @param guild      - Discord.js Guild to resolve against.
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
 *
 * @param guild   - Discord.js Guild to resolve against.
 * @param entries - Raw DB entries with userDiscId snowflakes.
 */
async function resolveDisplayNames(
  guild: Guild,
  entries: TopUserEntry[],
): Promise<Array<ResolvedUserEntry & { rank: number }>> {
  return Promise.all(
    entries.map(async (e, i) => ({
      displayName: await resolveDisplayName(guild, e.userDiscId),
      count: e.count,
      rank: i + 1,
    })),
  );
}

// ── Args type ─────────────────────────────────────────────────────────────────

/** Arguments for `gatherServerCardData`. */
export interface GatherServerCardArgs {
  /** Internal `servers` FK (not the Discord snowflake). */
  serverId: number;
  /** Discord guild snowflake, used for persona cache lookups. */
  guildDiscId: string;
  /** Display name of the server shown on the card header. */
  serverName: string;
  /** BCP-47 locale string passed through to ServerCardData. */
  locale: string;
  /** Selected time window — drives the metric window for most reads. */
  timeframe: Timeframe;
  /** Discord Guild object for display-name resolution. */
  guild: Guild;
}

// ── Peak hour helper ──────────────────────────────────────────────────────────

/**
 * Extracts the peak hour (0–23) from a `getMetricKeyBreakdown` result for
 * the `active_hour` metric. Returns null when no activity data exists.
 *
 * @param entries - Breakdown result, highest-count first.
 */
function extractPeakHour(entries: Array<{ key: string; count: number }>): number | null {
  const top = entries[0];
  if (!top) return null;
  const h = Number.parseInt(top.key, 10);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
}

// ── Main gather function ───────────────────────────────────────────────────────

/**
 * Gathers all data the Server "Year in Review" card needs from the DB and Discord
 * API, returning a `ServerCardData` struct for the pure renderer.
 *
 * Read categories:
 * - Windowed (uses timeframe): top chatters, persona messages, peak hour, top
 *   expression, top commands, estimated cost.
 * - All-time (not bucketed): generation totals (only populated for all_time).
 * - Cache: persona names from getCachedAllPersonas.
 *
 * @param args - Scope, locale, timeframe, server name, and Discord Guild.
 */
export async function gatherServerCardData(args: GatherServerCardArgs): Promise<ServerCardData> {
  const { serverId, guildDiscId, serverName, locale, timeframe, guild } = args;
  const windowFrom = resolveWindowFrom(timeframe);
  const windowArg = windowFrom ? { from: windowFrom } : {};

  // ── 1. Parallel windowed reads ────────────────────────────────────────────────
  const [
    rawTopChatters,
    serverPersonaRoster,
    peakHourBreakdown,
    topEmojiRaw,
    topStickersRaw,
    topCommands,
    estimatedCost,
  ] = await Promise.all([
    statRepository.getTopUsers({ serverId, limit: 3, ...windowArg }),
    statRepository.getServerPersonaMessages({ serverId, limit: 3, ...windowArg }),
    statRepository.getMetricKeyBreakdown({ metric: "active_hour", serverId, limit: 1, ...windowArg }),
    statRepository.getMetricKeyBreakdown({ metric: "emoji_used", serverId, limit: 5, ...windowArg }),
    statRepository.getMetricKeyBreakdown({ metric: "sticker_used", serverId, limit: 5, ...windowArg }),
    statRepository.getTopCommands({ serverId, limit: 4, ...windowArg }),
    statRepository.getEstimatedCost({ serverId, ...windowArg }),
  ]);

  // ── 2. Generation totals (all-time only — quota tables are not bucketed) ──────
  const generationTotals = timeframe === "all_time" ? await statRepository.getGenerationTotals({ serverId }) : null;

  // ── 3. Resolve top chatter display names ─────────────────────────────────────
  const topChatters = await resolveDisplayNames(guild, rawTopChatters);

  // ── 4. Resolve persona names from cache ──────────────────────────────────────
  let topPersonas: Array<{ name: string; count: number; rank: number }> = [];
  try {
    const personas = await getCachedAllPersonas(guildDiscId);
    topPersonas = serverPersonaRoster.map((entry, i) => {
      const match = personas.find((p) => p.persona_lineage_id === entry.lineageId);
      return {
        name: match?.persona_nickname ?? `Persona #${entry.lineageId}`,
        count: entry.count,
        rank: i + 1,
      };
    });
  } catch (error) {
    log.warn("serverCardGatherer: persona cache lookup failed", error as Error);
  }

  // ── 5. Merge emoji + sticker expression lists, sort, keep top 3 ──────────────
  const combined = [...topEmojiRaw, ...topStickersRaw];
  combined.sort((a, b) => b.count - a.count);
  const mostLovedExpression = combined.slice(0, 3).map((e) => ({ key: e.key, count: e.count }));

  // ── 6. Assemble ServerCardData ────────────────────────────────────────────────
  return {
    locale,
    timeframe,
    serverName,
    topChatters,
    topPersonas,
    generationTotals: generationTotals
      ? {
          text: generationTotals.textGenerations,
          images: generationTotals.imageGenerations,
          videos: generationTotals.videoGenerations,
        }
      : null,
    estimatedCost,
    peakHour: extractPeakHour(peakHourBreakdown),
    mostLovedExpression,
    topCommands: topCommands.map((c) => ({ command: c.command, count: c.count })),
  };
}
