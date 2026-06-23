/**
 * personalCardGatherer.ts — data-gathering layer for the Personal "Wrapped"
 * infographic card (plans/stat-tracking.md §10, Phase 3).
 *
 * This is the ONLY file in the infographic stack that touches the DB.
 * `gatherPersonalCardData` calls existing StatRepository read methods, applies
 * the normalization and timeframe-gating rules baked into this layer, and returns
 * a `PersonalCardData` struct that `renderPersonalCard` (in statsInfographic.tsx)
 * consumes as a pure function.
 *
 * Rules applied here (not in the renderer):
 * - HEATMAP NORMALIZATION: raw counts divided by per-weekday occurrence count in
 *   the window so the heatmap reads "typical Monday at 9 PM" rather than raw totals
 *   (longer windows would otherwise just darken every cell uniformly).
 * - TIMEFRAME GATING: heatmap only at month/year/all_time; streak/anniversary/
 *   conditioning gated per the same rules as the Phase 2 text dashboard.
 * - TIMEZONE: personal scope passes `users.timezone_offset` as `offsetHours`
 *   to `getActivityHeatmap` so the week-hour rotation happens at the repo layer.
 * - AVATARS: the favorite persona's `webhook_avatar_url` is fetched (via
 *   safeDownload) and base64-encoded for the card's embedded `<img>` data URI.
 *   Fetch failure is graceful — returns null so the renderer shows a placeholder.
 */
import type { ActivityHeatmap, MetricKeyEntry } from "@/utils/db/repositories/StatRepository";
import { statRepository } from "@/utils/db/repositories";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { safeDownload } from "@/utils/security/safeDownload";
import { log } from "@/utils/misc/logger";
import { type Timeframe, resolveWindowFrom } from "@/utils/stats/statsDashboard";
import type { PersonalCardData, PersonalHeatmapData } from "@/utils/stats/statsInfographic";

// ── Avatar fetch constants ─────────────────────────────────────────────────────

const AVATAR_MAX_SIZE_MB = 4;
const AVATAR_TIMEOUT_MS = 8_000;

// ── Normalization helpers ──────────────────────────────────────────────────────

/**
 * Counts how many times each UTC weekday (0=Sun–6=Sat) occurs between `from`
 * and `to` (inclusive). Used as the denominator for per-weekday normalization
 * so the heatmap reads "typical Monday activity" rather than a raw total that
 * grows with window length.
 *
 * @param from - Inclusive start date (UTC midnight).
 * @param to   - Inclusive end date (UTC midnight, typically today).
 */
export function countWeekdayOccurrences(from: Date, to: Date): Record<number, number> {
  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const cursor = new Date(from.getTime());
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(to.getTime());
  end.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= end.getTime()) {
    counts[cursor.getUTCDay()]++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return counts;
}

/**
 * Normalizes a raw `getActivityHeatmap` grid into per-weekday-occurrence averages.
 *
 * Each cell is divided by how many times its weekday occurred in the window
 * (e.g. 4 Mondays in a 30-day window → ÷4). This lets a longer window sharpen
 * the pattern instead of just brightening every cell proportionally.
 *
 * Special cases:
 * - If `windowFrom` is undefined (all-time) and `anniversaryDate` is provided,
 *   the anniversary is used as the effective window start.
 * - If neither bound is known, the raw grid is returned unchanged (no
 *   normalization is better than dividing by zero or wrong counts).
 * - A weekday with 0 occurrences gets a divisor of 1 (safety guard).
 *
 * @param rawGrid       - Raw ActivityHeatmap from `StatRepository.getActivityHeatmap`.
 * @param windowFrom    - YYYY-MM-DD floor for the query window (undefined = all-time).
 * @param anniversaryDate - Fallback start when windowFrom is undefined (all-time).
 * @param _today        - Override "today" (UTC midnight) — used only in tests.
 */
export function normalizeHeatmap(
  rawGrid: ActivityHeatmap,
  windowFrom: string | undefined,
  anniversaryDate: Date | null,
  _today?: Date,
): PersonalHeatmapData {
  const today = _today ? new Date(_today.getTime()) : new Date();
  today.setUTCHours(0, 0, 0, 0);

  // 1. Determine the effective window start for occurrence counting.
  let fromDate: Date | null = null;
  if (windowFrom) {
    fromDate = new Date(`${windowFrom}T00:00:00Z`);
  } else if (anniversaryDate) {
    fromDate = new Date(anniversaryDate.getTime());
    fromDate.setUTCHours(0, 0, 0, 0);
  }

  // 2. Build the normalized grid (7×24 pre-populated with zeros).
  const normalized: ActivityHeatmap = {};
  for (let dow = 0; dow < 7; dow++) {
    normalized[dow] = {};
    for (let hour = 0; hour < 24; hour++) normalized[dow][hour] = 0;
  }

  let maxVal = 0;

  if (!fromDate) {
    // No window bound: return raw grid (avoid meaningless normalization).
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const v = rawGrid[dow]?.[hour] ?? 0;
        normalized[dow][hour] = v;
        if (v > maxVal) maxVal = v;
      }
    }
    return { normalized, maxVal };
  }

  // 3. Count weekday occurrences in the window.
  const occurrences = countWeekdayOccurrences(fromDate, today);

  // 4. Divide each cell by its weekday's occurrence count.
  for (let dow = 0; dow < 7; dow++) {
    const divisor = Math.max(1, occurrences[dow] ?? 1);
    for (let hour = 0; hour < 24; hour++) {
      const v = (rawGrid[dow]?.[hour] ?? 0) / divisor;
      normalized[dow][hour] = v;
      if (v > maxVal) maxVal = v;
    }
  }

  return { normalized, maxVal };
}

// ── Timeframe gating helpers ───────────────────────────────────────────────────

/** Heatmap renders only when the timeframe has enough data density. */
export function shouldShowHeatmap(timeframe: Timeframe): boolean {
  return timeframe === "month" || timeframe === "year" || timeframe === "all_time";
}

/** Streak / anniversary are hidden under a single-day "today" view. */
export function shouldShowStreak(timeframe: Timeframe): boolean {
  return timeframe !== "today";
}

/** Conditioning totals are all-time only (conditioning_history is not bucketed). */
export function shouldShowConditioning(timeframe: Timeframe): boolean {
  return timeframe === "all_time";
}

// ── Avatar fetch helper ────────────────────────────────────────────────────────

/**
 * Fetches a persona avatar from a URL and returns a base64 data URI suitable for
 * embedding in a satori `<img>` element. Returns null on any failure so the
 * renderer can fall back to a placeholder without crashing.
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
    log.warn(`personalCardGatherer: avatar fetch failed for ${avatarUrl}`, error as Error);
    return null;
  }
}

// ── Main gather function ───────────────────────────────────────────────────────

/** Arguments for `gatherPersonalCardData`. */
export interface GatherPersonalCardArgs {
  /** Internal `users` FK (not the Discord snowflake). */
  userId: number;
  /** Internal `servers` FK — passed for "this server" scope; omit for global. */
  serverId?: number;
  /** Discord guild snowflake ID, used to resolve persona names/avatars from cache. */
  guildDiscId: string;
  /** Display name shown on the card. */
  username: string;
  /** BCP-47 locale passed through to `PersonalCardData`. */
  locale: string;
  /** Selected time window — drives gating and window floor. */
  timeframe: Timeframe;
  /** User's UTC offset in whole hours (e.g. +9 for JST). Null = UTC. */
  offsetHours?: number | null;
}

/**
 * Gathers all data the Personal "Wrapped" card needs from the DB and external
 * sources, applies normalization and timeframe gating, then returns a
 * `PersonalCardData` struct for the pure renderer.
 *
 * This is the ONLY async, DB-touching function in the infographic stack.
 * Everything downstream (`renderPersonalCard`, `renderCardToPng`) is either
 * pure or CPU-only.
 *
 * @param args - Scope, locale, and timeframe for the card.
 */
export async function gatherPersonalCardData(args: GatherPersonalCardArgs): Promise<PersonalCardData> {
  const { userId, serverId, guildDiscId, username, locale, timeframe, offsetHours } = args;
  const windowFrom = resolveWindowFrom(timeframe);
  const windowArg = windowFrom ? { from: windowFrom } : {};

  // ── 1. Parallel reads — safe to fire together ────────────────────────────────
  const [favoritePersona, totalMessages, streak, activityHistogram, modelBreakdown, estimatedCost] = await Promise.all([
    statRepository.getFavoritePersona({ userId, serverId, ...windowArg }),
    statRepository.getMetricTotal({ metric: "message_sent", userId, serverId, ...windowArg }),
    shouldShowStreak(timeframe) ? statRepository.getStreak({ userId, serverId }) : Promise.resolve(null),
    // Histogram used for 24h ring fallback (always fetched; cheap)
    statRepository.getActivityHistogram({ userId, serverId, ...windowArg }),
    statRepository.getModelBreakdown({ userId, serverId, ...windowArg }),
    statRepository.getEstimatedCost({ userId, serverId, ...windowArg }),
  ]);

  // ── 2. Anniversary — fetched once; used by both heatmap normalization and card ─
  const anniversary: Date | null =
    shouldShowStreak(timeframe) && favoritePersona
      ? await statRepository.getPersonaAnniversary({ userId, lineageId: favoritePersona.lineageId })
      : null;

  // ── 3. Heatmap — only when timeframe has enough density ─────────────────────
  let heatmapData: PersonalHeatmapData | null = null;
  if (shouldShowHeatmap(timeframe)) {
    const rawHeatmap = await statRepository.getActivityHeatmap({
      userId,
      serverId,
      offsetHours,
      ...windowArg,
    });
    // anniversary doubles as the all-time window floor for normalization.
    heatmapData = normalizeHeatmap(rawHeatmap, windowFrom, anniversary);
  }

  // ── 4. Expression (top emoji + sticker combined, top 5) ────────────────────
  const [topEmoji, topStickers] = await Promise.all([
    statRepository.getMetricKeyBreakdown({
      metric: "emoji_used",
      userId,
      serverId,
      limit: 5,
      ...windowArg,
    }),
    statRepository.getMetricKeyBreakdown({
      metric: "sticker_used",
      userId,
      serverId,
      limit: 5,
      ...windowArg,
    }),
  ]);
  // Merge emoji + sticker lists, sort by count, keep top 5
  const combined: MetricKeyEntry[] = [...topEmoji, ...topStickers];
  combined.sort((a, b) => b.count - a.count);
  const topExpression = combined.slice(0, 5).map((e) => ({ key: e.key, count: e.count }));

  // ── 5. Conditioning (all-time only) ─────────────────────────────────────────
  const conditioning = shouldShowConditioning(timeframe)
    ? await statRepository.getConditioningTotals({ userId, serverId })
    : null;

  // ── 6. Persona name + avatar resolution ─────────────────────────────────────
  let favoritePersonaName: string | null = null;
  let favoritePersonaAvatarDataUri: string | null = null;

  if (favoritePersona) {
    try {
      const personas = await getCachedAllPersonas(guildDiscId);
      const match = personas.find((p) => p.persona_lineage_id === favoritePersona.lineageId);
      if (match) {
        favoritePersonaName = match.persona_nickname;
        // webhook_avatar_url is the persona's current displayed avatar URL
        const avatarUrl = match.webhook_avatar_url ?? null;
        if (avatarUrl) {
          favoritePersonaAvatarDataUri = await fetchAvatarDataUri(avatarUrl);
        }
      }
    } catch (error) {
      log.warn("personalCardGatherer: persona resolution failed", error as Error);
    }
  }

  // ── 7. Assemble PersonalCardData ─────────────────────────────────────────────
  return {
    locale,
    timeframe,
    username,

    favoritePersonaName,
    favoritePersonaAvatarDataUri,
    loyaltyPct: favoritePersona?.loyaltyPct ?? 0,

    totalMessages,

    heatmap: heatmapData,
    histogramByHour: activityHistogram.byHour,

    currentStreak: streak?.currentStreak ?? null,
    longestStreak: streak?.longestStreak ?? null,

    anniversary,

    topModelName: modelBreakdown[0]?.model ?? null,
    estimatedCost,

    topExpression,

    conditioning: conditioning ? { rewards: conditioning.rewards, punishments: conditioning.punishments } : null,
  };
}
