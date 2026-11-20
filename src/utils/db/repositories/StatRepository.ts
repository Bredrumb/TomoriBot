// Buffered deltas intentionally drop on hard crash rather than hitting the DB per event, because aggregate telemetry
// trades crash durability for hot-path speed.
import { REWARD_HEAT_MULTIPLIER } from "@/modules/natural-nudges/runtime/tuning";
import type { StatMetric } from "@/constants/statMetrics";
import { PERSONA_AGNOSTIC_METRICS } from "@/constants/statMetrics";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import { ownedServersOnly } from "@/utils/db/repositories/shardFilter";
import type { ShardTopology } from "@/utils/discord/shardOwnership";
import { log } from "@/utils/misc/logger";
import type { SQL } from "bun";
import type { IRepository } from "./IRepository";

const STAT_TRACKING_ENABLED = (process.env.STAT_TRACKING_ENABLED?.trim().toLowerCase() ?? "true") !== "false";
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_MAX_BUFFER = 1000;

// Unit separator delimiter prevents buffer-key collisions because metric data never contains ASCII 0x1f.
const KEY_DELIMITER = "\x1f";

export interface RecordStatInput {
  serverId: number;
  userId: number;
  // Zero (or omitted) is the sentinel for persona-agnostic metrics, so callers do not split them across lineages.
  lineageId?: number;
  metric: StatMetric;
  // Empty string is the sentinel for scalar metrics so scalar and keyed counters share one PK structure.
  metricKey?: string;
  delta?: number;
}

interface StatBufferEntry {
  serverId: number;
  userId: number;
  lineageId: number;
  metric: StatMetric;
  metricKey: string;
  // Format: YYYY-MM-DD
  bucket: string;
  delta: number;
  firstAt: Date;
  lastAt: Date;
}

type StatUpsertRow = Record<PropertyKey, unknown> & {
  server_id: number;
  user_id: number;
  persona_lineage_id: number;
  metric: StatMetric;
  metric_key: string;
  bucket: string;
  count: number;
  first_at: Date;
  last_at: Date;
};

function currentBucketDate(): string {
  return new Date().toISOString().split("T")[0];
}

// Sentinel floor date for all-time queries so windowed SQL comparisons avoid nullable branches.
const ALL_TIME_FLOOR = "0001-01-01";

function windowFloor(from?: Date | string): string {
  if (!from) return ALL_TIME_FLOOR;
  if (from instanceof Date) return from.toISOString().split("T")[0];
  return from;
}

interface StatWindow {
  from?: Date | string;
}

export interface PersonaAffinityEntry {
  lineageId: number;
  count: number;
}

interface FavoritePersona {
  lineageId: number;
  count: number;
  totalCount: number;
  loyaltyPct: number;
}

interface CommandUsageEntry {
  command: string;
  count: number;
}

interface ModelUsageEntry {
  model: string;
  count: number;
}

interface MetricKeyEntry {
  key: string;
  count: number;
}

export interface ModelCostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface PersonaTokenCostEntry {
  lineageId: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface EmotionEntry {
  emotion: string;
  count: number;
}

export interface TopUserEntry {
  userId: number;
  userDiscId: string;
  count: number;
}

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
}

// Keys use hours 0 to 23 and weekdays 0=Sun to 6=Sat because queries read Postgres EXTRACT(DOW).
interface ActivityHistogram {
  byHour: Record<number, number>;
  byWeekday: Record<number, number>;
}

// Keyed dow (0=Sun to 6=Sat) then hour with all 168 cells populated, so callers index safely and timezone shifts must
// rotate (dow, hour) together.
type ActivityHeatmap = Record<number, Record<number, number>>;

interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
}

interface UserPersonaReunionInfo {
  lastPreviousDayAt: Date | null;
  seenToday: boolean;
}

// Legacy message_sent stays alongside presence_seen so older relationships keep their activity history.
const REUNION_ACTIVITY_METRICS = ["presence_seen", "message_sent"] as const satisfies readonly StatMetric[];

export interface GenerationTotals {
  textGenerations: number;
  imageGenerations: number;
  videoGenerations: number;
}

interface ConditioningTotals {
  rewards: number;
  punishments: number;
}

export interface ConditioningPersonaEntry {
  lineageId: number;
  rewards: number;
  punishments: number;
}

class StatRepository implements IRepository<null> {
  private buffer = new Map<string, StatBufferEntry>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<boolean> | null = null;

  private bufferKey(entry: {
    serverId: number;
    userId: number;
    lineageId: number;
    metric: StatMetric;
    metricKey: string;
    bucket: string;
  }): string {
    return [entry.serverId, entry.userId, entry.lineageId, entry.metric, entry.metricKey, entry.bucket].join(
      KEY_DELIMITER,
    );
  }

  // Hot-path callers omit try/catch, so recording must stay synchronous and never throw.
  recordStat(input: RecordStatInput): void {
    if (!STAT_TRACKING_ENABLED) return;

    const { serverId, userId, metric } = input;
    // Skip non-integer scope IDs (e.g., DM contexts without a server) because server_id and user_id are NOT NULL FKs.
    if (!Number.isInteger(serverId) || !Number.isInteger(userId)) return;

    const delta = input.delta ?? 1;
    if (delta === 0) return;

    // Persona-agnostic metrics always key on the lineage-0 sentinel.
    const lineageId = PERSONA_AGNOSTIC_METRICS.has(metric) ? 0 : (input.lineageId ?? 0);
    const metricKey = input.metricKey ?? "";
    const bucket = currentBucketDate();
    const now = new Date();

    const key = this.bufferKey({ serverId, userId, lineageId, metric, metricKey, bucket });
    const existing = this.buffer.get(key);
    if (existing) {
      existing.delta += delta;
      existing.lastAt = now;
    } else {
      this.buffer.set(key, {
        serverId,
        userId,
        lineageId,
        metric,
        metricKey,
        bucket,
        delta,
        firstAt: now,
        lastAt: now,
      });
    }

    if (this.buffer.size >= FLUSH_MAX_BUFFER) {
      void this.flush();
    } else {
      this.ensureFlushTimer();
    }
  }

  private ensureFlushTimer(): void {
    if (this.flushTimer || FLUSH_INTERVAL_MS <= 0) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    // Bun/Node: don't let the flush interval hold the event loop open.
    this.flushTimer.unref?.();
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // Concurrent callers await the shared in-flight promise rather than skipping, so shutdown and stats reads do not
  // race an active flush.
  flush(): Promise<boolean> {
    if (this.flushPromise) return this.flushPromise;
    if (this.buffer.size === 0) return Promise.resolve(true);

    // Defer work one microtask so flushPromise is assigned before the drain can
    // settle, including when the SQL client rejects synchronously.
    let promise: Promise<boolean>;
    promise = Promise.resolve()
      .then(() => this.flushSnapshot())
      .finally(() => {
        if (this.flushPromise === promise) this.flushPromise = null;
        // Re-arm the periodic timer after size-cap flushes if new entries arrived while the drain ran.
        if (this.buffer.size === 0) this.clearFlushTimer();
        else this.ensureFlushTimer();
      });
    this.flushPromise = promise;
    return promise;
  }

  private async flushSnapshot(): Promise<boolean> {
    const draining = this.buffer;
    this.buffer = new Map();
    const entries = Array.from(draining.values());

    try {
      const rows: StatUpsertRow[] = entries.map((entry) => ({
        server_id: entry.serverId,
        user_id: entry.userId,
        persona_lineage_id: entry.lineageId,
        metric: entry.metric,
        metric_key: entry.metricKey,
        bucket: entry.bucket,
        count: entry.delta,
        first_at: entry.firstAt,
        last_at: entry.lastAt,
      }));
      await sql.begin(async (tx: SQL) => {
        await tx`
          INSERT INTO stat_counters ${tx(
            rows,
            "server_id",
            "user_id",
            "persona_lineage_id",
            "metric",
            "metric_key",
            "bucket",
            "count",
            "first_at",
            "last_at",
          )}
          ON CONFLICT (server_id, user_id, persona_lineage_id, metric, metric_key, bucket)
          DO UPDATE SET
            count    = stat_counters.count + EXCLUDED.count,
            first_at = LEAST(stat_counters.first_at, EXCLUDED.first_at),
            last_at  = GREATEST(stat_counters.last_at, EXCLUDED.last_at)
        `;
      });
      return true;
    } catch (error) {
      const pgError = error as Record<string, unknown>;
      let badServerId: number | null = null;
      let badUserId: number | null = null;
      let badLineageId: number | null = null;

      // Drop entries targeting deleted servers or users on FK 23503 so one nuked row never retry-loops the whole batch.
      if (
        pgError &&
        typeof pgError === "object" &&
        pgError.code === "ERR_POSTGRES_SERVER_ERROR" &&
        String(pgError.errno) === "23503" &&
        typeof pgError.detail === "string"
      ) {
        const match = pgError.detail.match(/Key \(([^)]+)\)=\(([^)]+)\) is not present/);
        if (match) {
          const col = match[1];
          const val = Number(match[2]);
          if (col === "server_id" && !Number.isNaN(val)) badServerId = val;
          else if (col === "user_id" && !Number.isNaN(val)) badUserId = val;
          else if (col === "persona_lineage_id" && !Number.isNaN(val)) badLineageId = val;
        }
      }

      // Unparseable constraint violations require a full batch drop to break the retry loop.
      const isUnparseableConstraint =
        badServerId === null &&
        badUserId === null &&
        badLineageId === null &&
        pgError &&
        typeof pgError === "object" &&
        pgError.code === "ERR_POSTGRES_SERVER_ERROR" &&
        String(pgError.errno).startsWith("23");

      if (isUnparseableConstraint) {
        log.error(
          `StatRepository.flush: dropping entire batch of ${entries.length} entries due to unparseable constraint violation`,
          error,
        );
        return false;
      }

      let droppedCount = 0;
      for (const e of entries) {
        if (
          (badServerId !== null && e.serverId === badServerId) ||
          (badUserId !== null && e.userId === badUserId) ||
          (badLineageId !== null && e.lineageId === badLineageId)
        ) {
          droppedCount++;
          continue;
        }

        const key = this.bufferKey(e);
        const existing = this.buffer.get(key);
        if (existing) {
          existing.delta += e.delta;
          existing.firstAt = e.firstAt < existing.firstAt ? e.firstAt : existing.firstAt;
          existing.lastAt = e.lastAt > existing.lastAt ? e.lastAt : existing.lastAt;
        } else {
          this.buffer.set(key, e);
        }
      }

      if (droppedCount > 0) {
        log.warn(`StatRepository.flush: dropped ${droppedCount} invalid stat entries to resolve foreign key violation`);
      } else {
        log.error(
          `StatRepository.flush: failed to persist ${entries.length} buffered stat entries (will retry)`,
          error,
        );
      }
      return false;
    }
  }

  // Failed flushes exit the drain loop instead of retrying so a DB outage cannot hang process termination.
  async shutdown(): Promise<void> {
    this.clearFlushTimer();
    while (this.flushPromise || this.buffer.size > 0) {
      const persisted = await this.flush();
      if (!persisted) return;
    }
  }

  get bufferedEntryCount(): number {
    return this.buffer.size;
  }

  // Behavioral readers must check this before querying counters, because disabled tracking returns empty history
  // indistinguishable from never having interacted.
  get isTrackingEnabled(): boolean {
    return STAT_TRACKING_ENABLED;
  }

  async getPresenceRetentionPairs(
    topology?: ShardTopology,
  ): Promise<{ server_disc_id: string; user_disc_id: string }[]> {
    return await sql<{ server_disc_id: string; user_disc_id: string }[]>`
      SELECT DISTINCT s.server_disc_id, u.user_disc_id
      FROM stat_counters sc
      JOIN servers s ON s.server_id = sc.server_id
      JOIN users u ON u.user_id = sc.user_id
      WHERE sc.metric IN ('message_sent', 'presence_seen') AND s.is_dm_channel = FALSE
        AND ${ownedServersOnly(topology)}
    `;
  }

  // Presence writes bypass buffered telemetry so context built in another channel immediately observes the completed
  // turn.
  async recordPresenceSeen(args: { serverId: number; userId: number; lineageId: number }): Promise<boolean> {
    if (
      !STAT_TRACKING_ENABLED ||
      !Number.isInteger(args.serverId) ||
      !Number.isInteger(args.userId) ||
      !Number.isInteger(args.lineageId)
    ) {
      return false;
    }

    try {
      await sql`
        INSERT INTO stat_counters
          (server_id, user_id, persona_lineage_id, metric, metric_key, bucket, count, first_at, last_at)
        VALUES
          (${args.serverId}, ${args.userId}, ${args.lineageId}, 'presence_seen', '', CURRENT_DATE, 1, NOW(), NOW())
        ON CONFLICT (server_id, user_id, persona_lineage_id, metric, metric_key, bucket)
        DO UPDATE SET
          count = stat_counters.count + 1,
          last_at = GREATEST(stat_counters.last_at, EXCLUDED.last_at)
      `;
      return true;
    } catch (error) {
      log.error(`StatRepository.recordPresenceSeen: failed for user ${args.userId}, lineage ${args.lineageId}`, error);
      return false;
    }
  }

  // Reads query Postgres directly at daily bucket granularity, so callers needing buffered increments must await flush().

  // Today's rows stay out of the gap timestamp so one-shot reunion delivery preserves the absence, and UTC buckets
  // can differ from user midnight.
  async getUserPersonaReunionInfo(userId: number, lineageId: number): Promise<UserPersonaReunionInfo | null> {
    try {
      const [row] = await sql<
        Array<{
          last_previous_day_at: Date | string | null;
          seen_today: boolean;
        }>
      >`
        SELECT
          MAX(last_at) FILTER (WHERE bucket < CURRENT_DATE) AS last_previous_day_at,
          COALESCE(SUM(count) FILTER (
            WHERE bucket = CURRENT_DATE AND metric = 'presence_seen'
          ), 0) > 0 AS seen_today
        FROM stat_counters
        WHERE user_id = ${userId}
          AND persona_lineage_id = ${lineageId}
          AND metric = ANY(${sql.array([...REUNION_ACTIVITY_METRICS], "TEXT")})
      `;
      return {
        lastPreviousDayAt: row?.last_previous_day_at ? new Date(row.last_previous_day_at) : null,
        seenToday: row?.seen_today ?? false,
      };
    } catch (error) {
      log.error(`StatRepository.getUserPersonaReunionInfo: failed for user ${userId}, lineage ${lineageId}`, error);
      return null;
    }
  }

  async getPersonaAffinity(args: { userId: number; serverId?: number } & StatWindow): Promise<PersonaAffinityEntry[]> {
    try {
      const from = windowFloor(args.from);
      const rows = await sql<{ persona_lineage_id: number | string; total: number | string }[]>`
        SELECT persona_lineage_id, SUM(count) AS total
        FROM stat_counters
        WHERE metric = 'message_sent'
          AND user_id = ${args.userId}
          AND (${args.serverId ?? null}::int IS NULL OR server_id = ${args.serverId ?? null})
          AND bucket >= ${from}::date
        GROUP BY persona_lineage_id
        ORDER BY total DESC
      `;
      return rows.map((r) => ({ lineageId: Number(r.persona_lineage_id), count: Number(r.total) }));
    } catch (error) {
      log.error(`StatRepository.getPersonaAffinity: failed for user ${args.userId}`, error);
      return [];
    }
  }

  async getFavoritePersona(args: { userId: number; serverId?: number } & StatWindow): Promise<FavoritePersona | null> {
    const affinity = await this.getPersonaAffinity(args);
    if (affinity.length === 0) return null;
    const totalCount = affinity.reduce((sum, a) => sum + a.count, 0);
    const top = affinity[0];
    return {
      lineageId: top.lineageId,
      count: top.count,
      totalCount,
      loyaltyPct: totalCount > 0 ? (top.count / totalCount) * 100 : 0,
    };
  }

  async getPersonaAnniversary(args: { userId: number; lineageId: number }): Promise<Date | null> {
    try {
      const [row] = await sql`
        SELECT MIN(first_at) AS first_at
        FROM stat_counters
        WHERE user_id = ${args.userId} AND persona_lineage_id = ${args.lineageId}
      `;
      return row?.first_at ? new Date(row.first_at as string) : null;
    } catch (error) {
      log.error(`StatRepository.getPersonaAnniversary: failed for user ${args.userId}`, error);
      return null;
    }
  }

  // Aggregates without persona filtering because `command_used` writes only lineage-0 sentinel rows.
  async getTopCommands(args: { serverId: number; limit?: number } & StatWindow): Promise<CommandUsageEntry[]> {
    try {
      const from = windowFloor(args.from);
      const limit = args.limit ?? 25;
      const rows = await sql<{ metric_key: string; total: number | string }[]>`
        SELECT metric_key, SUM(count) AS total
        FROM stat_counters
        WHERE metric = 'command_used'
          AND server_id = ${args.serverId}
          AND bucket >= ${from}::date
        GROUP BY metric_key
        ORDER BY total DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ command: String(r.metric_key), count: Number(r.total) }));
    } catch (error) {
      log.error(`StatRepository.getTopCommands: failed for server ${args.serverId}`, error);
      return [];
    }
  }

  async getUnusedCommands(allCommands: string[], args: { serverId: number } & StatWindow): Promise<string[]> {
    try {
      const from = windowFloor(args.from);
      const rows = await sql<{ metric_key: string }[]>`
        SELECT DISTINCT metric_key
        FROM stat_counters
        WHERE metric = 'command_used'
          AND server_id = ${args.serverId}
          AND bucket >= ${from}::date
      `;
      const used = new Set(rows.map((r) => String(r.metric_key)));
      return allCommands.filter((cmd) => !used.has(cmd));
    } catch (error) {
      log.error(`StatRepository.getUnusedCommands: failed for server ${args.serverId}`, error);
      return [];
    }
  }

  // Catalog rows stay space-joined to match stat_counters.metric_key, because Grafana LEFT JOINs here to report
  // unused commands.
  async syncCommandCatalog(entries: { commandName: string; category: string }[]): Promise<void> {
    // Never prune against an empty set, so a failed load must not empty the catalog.
    if (entries.length === 0) {
      log.warn("StatRepository.syncCommandCatalog: received no commands, leaving catalog untouched");
      return;
    }

    try {
      const rows = entries.map((entry) => ({ command_name: entry.commandName, category: entry.category }));
      const names = rows.map((row) => row.command_name);

      await sql.begin(async (tx: SQL) => {
        // ON CONFLICT omits first_seen_at so only mutable columns refresh on re-sync.
        await tx`
          INSERT INTO command_catalog ${tx(rows, "command_name", "category")}
          ON CONFLICT (command_name) DO UPDATE SET
            category       = EXCLUDED.category,
            last_synced_at = now()
        `;
        await tx`
          DELETE FROM command_catalog
          WHERE NOT (command_name = ANY(${sql.array(names, "text")}))
        `;
      });

      log.success(`StatRepository.syncCommandCatalog: catalog reconciled to ${rows.length} commands`);
    } catch (error) {
      log.error("StatRepository.syncCommandCatalog: failed", error);
    }
  }

  async getModelBreakdown(args: { userId?: number; serverId?: number } & StatWindow): Promise<ModelUsageEntry[]> {
    try {
      const from = windowFloor(args.from);
      const rows = await sql<{ metric_key: string; total: number | string }[]>`
        SELECT metric_key, SUM(count) AS total
        FROM stat_counters
        WHERE metric = 'model_used'
          AND (${args.userId ?? null}::int IS NULL OR user_id = ${args.userId ?? null})
          AND (${args.serverId ?? null}::int IS NULL OR server_id = ${args.serverId ?? null})
          AND bucket >= ${from}::date
        GROUP BY metric_key
        ORDER BY total DESC
      `;
      return rows.map((r) => ({ model: String(r.metric_key), count: Number(r.total) }));
    } catch (error) {
      log.error("StatRepository.getModelBreakdown: failed", error);
      return [];
    }
  }

  // Estimated cost is returned in USD because pricing tables store per-million-token USD rates.
  async getEstimatedCost(
    args: { userId?: number; serverId?: number; lineageId?: number } & StatWindow,
  ): Promise<number> {
    try {
      const from = windowFloor(args.from);
      const [row] = await sql`
        SELECT COALESCE(
          SUM(
            sc.count
            * CASE sc.metric
                WHEN 'tokens_in'  THEN COALESCE(l.input_price_per_million, 0)
                WHEN 'tokens_out' THEN COALESCE(l.output_price_per_million, 0)
                ELSE 0
              END
            / 1000000.0
          ), 0
        ) AS cost
        FROM stat_counters sc
        -- A codename can exist once per provider. stat_counters stores only the
        -- codename, so collapse pricing to one conservative row before joining;
        -- otherwise every matching provider duplicates the token counter row.
        LEFT JOIN (
          SELECT llm_codename,
            MAX(input_price_per_million) AS input_price_per_million,
            MAX(output_price_per_million) AS output_price_per_million
          FROM (
            SELECT llm_codename, input_price_per_million, output_price_per_million FROM llms
            UNION ALL
            SELECT 'decision:' || decision_model_id::text AS llm_codename,
              input_price_per_million, output_price_per_million FROM decision_models
          ) prices
          GROUP BY llm_codename
        ) l ON l.llm_codename = sc.metric_key
        WHERE sc.metric IN ('tokens_in', 'tokens_out')
          AND (${args.userId ?? null}::int IS NULL OR sc.user_id = ${args.userId ?? null})
          AND (${args.serverId ?? null}::int IS NULL OR sc.server_id = ${args.serverId ?? null})
          AND (${args.lineageId ?? null}::bigint IS NULL OR sc.persona_lineage_id = ${args.lineageId ?? null})
          AND sc.bucket >= ${from}::date
      `;
      return Number(row?.cost ?? 0);
    } catch (error) {
      log.error("StatRepository.getEstimatedCost: failed", error);
      return 0;
    }
  }

  async getActivityHistogram(args: { userId: number; serverId?: number } & StatWindow): Promise<ActivityHistogram> {
    const byHour: Record<number, number> = {};
    const byWeekday: Record<number, number> = {};
    try {
      const from = windowFloor(args.from);
      const serverId = args.serverId ?? null;
      const hourRows = await sql`
        SELECT metric_key, SUM(count) AS total
        FROM stat_counters
        WHERE metric = 'active_hour' AND user_id = ${args.userId}
          AND (${serverId}::int IS NULL OR server_id = ${serverId})
          AND bucket >= ${from}::date
        GROUP BY metric_key
      `;
      for (const r of hourRows) {
        const hour = Number.parseInt(String(r.metric_key), 10);
        if (Number.isInteger(hour)) byHour[hour] = Number(r.total);
      }

      const dowRows = await sql`
        SELECT EXTRACT(DOW FROM bucket)::int AS dow, SUM(count) AS total
        FROM stat_counters
        WHERE metric = 'active_hour' AND user_id = ${args.userId}
          AND (${serverId}::int IS NULL OR server_id = ${serverId})
          AND bucket >= ${from}::date
        GROUP BY dow
      `;
      for (const r of dowRows) {
        byWeekday[Number(r.dow)] = Number(r.total);
      }
    } catch (error) {
      log.error(`StatRepository.getActivityHistogram: failed for user ${args.userId}`, error);
    }
    return { byHour, byWeekday };
  }

  // Personal scope requires offsetHours because timezone shifts roll across weekdays, whereas server and persona
  // scopes omit it for server wall-clock.
  async getActivityHeatmap(
    args: { userId: number; serverId?: number; offsetHours?: number | null } & StatWindow,
  ): Promise<ActivityHeatmap> {
    const grid: ActivityHeatmap = {};
    for (let dow = 0; dow < 7; dow++) {
      grid[dow] = {};
      for (let hour = 0; hour < 24; hour++) grid[dow][hour] = 0;
    }

    try {
      const from = windowFloor(args.from);
      const serverId = args.serverId ?? null;
      const rows = await sql<{ dow: number | string; hour: string; total: number | string }[]>`
        SELECT EXTRACT(DOW FROM bucket)::int AS dow, metric_key AS hour, SUM(count) AS total
        FROM stat_counters
        WHERE metric = 'active_hour' AND user_id = ${args.userId}
          AND (${serverId}::int IS NULL OR server_id = ${serverId})
          AND bucket >= ${from}::date
        GROUP BY dow, hour
      `;

      // Counters are bucketed by UTC hour, so a half-hour offset can only land in its nearest hour cell.
      const offset = Math.round(args.offsetHours ?? 0);

      for (const r of rows) {
        const dow = Number(r.dow);
        const hour = Number.parseInt(String(r.hour), 10);
        if (!Number.isInteger(dow) || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
        const total = Number(r.total);

        // Rotate (dow, hour) together modulo 168 so midnight-crossing offsets shift weekdays without collisions.
        const wh = dow * 24 + hour;
        const shifted = (((wh + offset) % 168) + 168) % 168;
        const newDow = Math.floor(shifted / 24);
        const newHour = shifted % 24;
        grid[newDow][newHour] += total;
      }
    } catch (error) {
      log.error(`StatRepository.getActivityHeatmap: failed for user ${args.userId}`, error);
    }
    return grid;
  }

  async getStreak(args: { userId: number; serverId?: number }): Promise<StreakInfo> {
    try {
      const serverId = args.serverId ?? null;
      const rows = await sql<{ bucket: string | Date }[]>`
        SELECT DISTINCT bucket
        FROM stat_counters
        WHERE user_id = ${args.userId}
          AND (${serverId}::int IS NULL OR server_id = ${serverId})
        ORDER BY bucket DESC
      `;
      const days = rows.map((r) =>
        new Date(
          `${(r.bucket instanceof Date ? r.bucket.toISOString() : String(r.bucket)).split("T")[0]}T00:00:00Z`,
        ).getTime(),
      );
      if (days.length === 0) return { currentStreak: 0, longestStreak: 0, lastActiveDate: null };

      const DAY_MS = 86_400_000;
      const lastActiveDate = new Date(days[0]).toISOString().split("T")[0];

      let longest = 1;
      let run = 1;
      for (let i = 1; i < days.length; i++) {
        const gap = days[i - 1] - days[i];
        if (gap === DAY_MS) {
          run++;
          longest = Math.max(longest, run);
        } else if (gap > DAY_MS) {
          run = 1;
        }
      }

      const todayMs = new Date(`${currentBucketDate()}T00:00:00Z`).getTime();
      let current = 0;
      if (todayMs - days[0] <= DAY_MS) {
        current = 1;
        for (let i = 1; i < days.length; i++) {
          if (days[i - 1] - days[i] === DAY_MS) current++;
          else break;
        }
      }

      return { currentStreak: current, longestStreak: longest, lastActiveDate };
    } catch (error) {
      log.error(`StatRepository.getStreak: failed for user ${args.userId}`, error);
      return { currentStreak: 0, longestStreak: 0, lastActiveDate: null };
    }
  }

  async getMetricKeyBreakdown(
    args: { metric: StatMetric; userId?: number; serverId?: number; lineageId?: number; limit?: number } & StatWindow,
  ): Promise<MetricKeyEntry[]> {
    try {
      const from = windowFloor(args.from);
      const limit = args.limit ?? 10;
      const rows = await sql<{ metric_key: string; total: number | string }[]>`
        SELECT metric_key, SUM(count) AS total
        FROM stat_counters
        WHERE metric = ${args.metric}
          AND (${args.userId ?? null}::int IS NULL OR user_id = ${args.userId ?? null})
          AND (${args.serverId ?? null}::int IS NULL OR server_id = ${args.serverId ?? null})
          AND (${args.lineageId ?? null}::bigint IS NULL OR persona_lineage_id = ${args.lineageId ?? null})
          AND bucket >= ${from}::date
        GROUP BY metric_key
        ORDER BY total DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ key: String(r.metric_key), count: Number(r.total) }));
    } catch (error) {
      log.error(`StatRepository.getMetricKeyBreakdown: failed for ${args.metric}`, error);
      return [];
    }
  }

  async getMetricTotal(
    args: { metric: StatMetric; userId?: number; serverId?: number; lineageId?: number } & StatWindow,
  ): Promise<number> {
    try {
      const from = windowFloor(args.from);
      const [row] = await sql`
        SELECT COALESCE(SUM(count), 0) AS total
        FROM stat_counters
        WHERE metric = ${args.metric}
          AND (${args.userId ?? null}::int IS NULL OR user_id = ${args.userId ?? null})
          AND (${args.serverId ?? null}::int IS NULL OR server_id = ${args.serverId ?? null})
          AND (${args.lineageId ?? null}::bigint IS NULL OR persona_lineage_id = ${args.lineageId ?? null})
          AND bucket >= ${from}::date
      `;
      return Number(row?.total ?? 0);
    } catch (error) {
      log.error(`StatRepository.getMetricTotal: failed for ${args.metric}`, error);
      return 0;
    }
  }

  async getServerExpressionCount(
    serverId: number,
    metric: "emoji_used" | "sticker_used" | "custom_expression_used",
    metricKey: string,
  ): Promise<number | null> {
    try {
      const [row] = await sql`
        SELECT COALESCE(SUM(count), 0) AS total FROM stat_counters
        WHERE server_id = ${serverId} AND metric = ${metric} AND metric_key = ${metricKey}
          AND bucket >= ${ALL_TIME_FLOOR}::date
      `;
      return Number(row?.total ?? 0);
    } catch (error) {
      log.error("StatRepository.getServerExpressionCount: failed", error, {
        serverId,
        metadata: { metric, metricKey },
      });
      return null;
    }
  }

  async getFirstMetricBucket(
    args: { metric: StatMetric; userId?: number; serverId?: number; lineageId?: number } & StatWindow,
  ): Promise<string | null> {
    try {
      const from = windowFloor(args.from);
      const [row] = await sql<{ first_bucket: string | Date | null }[]>`
        SELECT MIN(bucket) AS first_bucket
        FROM stat_counters
        WHERE metric = ${args.metric}
          AND (${args.userId ?? null}::int IS NULL OR user_id = ${args.userId ?? null})
          AND (${args.serverId ?? null}::int IS NULL OR server_id = ${args.serverId ?? null})
          AND (${args.lineageId ?? null}::bigint IS NULL OR persona_lineage_id = ${args.lineageId ?? null})
          AND bucket >= ${from}::date
      `;
      if (!row?.first_bucket) return null;
      return row.first_bucket instanceof Date ? row.first_bucket.toISOString().split("T")[0] : String(row.first_bucket);
    } catch (error) {
      log.error(`StatRepository.getFirstMetricBucket: failed for ${args.metric}`, error);
      return null;
    }
  }

  async getTokenTotals(
    args: { userId?: number; serverId?: number; lineageId?: number } & StatWindow,
  ): Promise<TokenTotals> {
    const [inputTokens, outputTokens] = await Promise.all([
      this.getMetricTotal({ ...args, metric: "tokens_in" }),
      this.getMetricTotal({ ...args, metric: "tokens_out" }),
    ]);
    return { inputTokens, outputTokens };
  }

  async getPersonaTokenCostBreakdown(
    args: { userId?: number; serverId?: number; limit?: number } & StatWindow,
  ): Promise<PersonaTokenCostEntry[]> {
    try {
      const from = windowFloor(args.from);
      const rows = await sql<
        {
          persona_lineage_id: number | string;
          in_tokens: number | string;
          out_tokens: number | string;
          cost: number | string;
        }[]
      >`
        SELECT sc.persona_lineage_id,
          COALESCE(SUM(CASE WHEN sc.metric = 'tokens_in' THEN sc.count ELSE 0 END), 0) AS in_tokens,
          COALESCE(SUM(CASE WHEN sc.metric = 'tokens_out' THEN sc.count ELSE 0 END), 0) AS out_tokens,
          COALESCE(SUM(
            sc.count
            * CASE sc.metric
                WHEN 'tokens_in' THEN COALESCE(l.input_price_per_million, 0)
                WHEN 'tokens_out' THEN COALESCE(l.output_price_per_million, 0)
                ELSE 0
              END
            / 1000000.0
          ), 0) AS cost
        FROM stat_counters sc
        LEFT JOIN (
          SELECT llm_codename,
            MAX(input_price_per_million) AS input_price_per_million,
            MAX(output_price_per_million) AS output_price_per_million
          FROM (
            SELECT llm_codename, input_price_per_million, output_price_per_million FROM llms
            UNION ALL
            SELECT 'decision:' || decision_model_id::text AS llm_codename,
              input_price_per_million, output_price_per_million FROM decision_models
          ) prices
          GROUP BY llm_codename
        ) l ON l.llm_codename = sc.metric_key
        WHERE sc.metric IN ('tokens_in', 'tokens_out')
          AND (${args.userId ?? null}::int IS NULL OR sc.user_id = ${args.userId ?? null})
          AND (${args.serverId ?? null}::int IS NULL OR sc.server_id = ${args.serverId ?? null})
          AND sc.bucket >= ${from}::date
        GROUP BY sc.persona_lineage_id
        ORDER BY (
          COALESCE(SUM(CASE WHEN sc.metric = 'tokens_in' THEN sc.count ELSE 0 END), 0)
          + COALESCE(SUM(CASE WHEN sc.metric = 'tokens_out' THEN sc.count ELSE 0 END), 0)
        ) DESC
        ${args.limit ? sql`LIMIT ${args.limit}` : sql``}
      `;
      return rows.map((row) => ({
        lineageId: Number(row.persona_lineage_id),
        inputTokens: Number(row.in_tokens),
        outputTokens: Number(row.out_tokens),
        cost: Number(row.cost),
      }));
    } catch (error) {
      log.error("StatRepository.getPersonaTokenCostBreakdown: failed", error);
      return [];
    }
  }

  async getTopUsers(
    args: {
      serverId: number;
      lineageId?: number;
      metric?: StatMetric;
      limit?: number;
      // Bot user ID is excluded because system turns triggered from persona messages are credited to it.
      botUserDiscId: string;
    } & StatWindow,
  ): Promise<TopUserEntry[]> {
    try {
      const from = windowFloor(args.from);
      const metric = args.metric ?? "message_sent";
      const limit = args.limit ?? 5;
      const rows = await sql<{ user_id: number | string; user_disc_id: string; total: number | string }[]>`
        SELECT sc.user_id, u.user_disc_id, SUM(sc.count) AS total
        FROM stat_counters sc
        JOIN users u ON u.user_id = sc.user_id
        WHERE sc.metric = ${metric}
          AND sc.server_id = ${args.serverId}
          AND u.user_disc_id <> ${args.botUserDiscId}
          AND (${args.lineageId ?? null}::bigint IS NULL OR sc.persona_lineage_id = ${args.lineageId ?? null})
          AND sc.bucket >= ${from}::date
        GROUP BY sc.user_id, u.user_disc_id
        ORDER BY total DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        userId: Number(r.user_id),
        userDiscId: String(r.user_disc_id),
        count: Number(r.total),
      }));
    } catch (error) {
      log.error(`StatRepository.getTopUsers: failed for server ${args.serverId}`, error);
      return [];
    }
  }

  // Telemetry counters are read instead of quota tables because quotas omit personal-provider runs and can be
  // disabled or have shorter retention.
  async getGenerationTotals(
    args: { serverId?: number; userId?: number; lineageId?: number } & StatWindow,
  ): Promise<GenerationTotals> {
    try {
      const [textGenerations, imageGenerations, videoGenerations] = await Promise.all([
        this.getMetricTotal({ ...args, metric: "text_generated" }),
        this.getMetricTotal({ ...args, metric: "image_generated" }),
        this.getMetricTotal({ ...args, metric: "video_generated" }),
      ]);
      return {
        textGenerations,
        imageGenerations,
        videoGenerations,
      };
    } catch (error) {
      log.error("StatRepository.getGenerationTotals: failed", error);
      return { textGenerations: 0, imageGenerations: 0, videoGenerations: 0 };
    }
  }

  async getConditioningTotals(args: {
    serverId?: number;
    lineageId?: number;
    userId?: number;
  }): Promise<ConditioningTotals> {
    try {
      const rows = await sql`
        SELECT conditioning_type, COALESCE(SUM(count), 0) AS total
        FROM conditioning_history
        WHERE (${args.serverId ?? null}::int IS NULL OR server_id = ${args.serverId ?? null})
          AND (${args.lineageId ?? null}::bigint IS NULL OR persona_lineage_id = ${args.lineageId ?? null})
          AND (${args.userId ?? null}::int IS NULL OR user_id = ${args.userId ?? null})
        GROUP BY conditioning_type
      `;
      const totals: ConditioningTotals = { rewards: 0, punishments: 0 };
      for (const r of rows) {
        if (r.conditioning_type === "reward") totals.rewards = Number(r.total);
        else if (r.conditioning_type === "punish") totals.punishments = Number(r.total);
      }
      return totals;
    } catch (error) {
      log.error("StatRepository.getConditioningTotals: failed", error);
      return { rewards: 0, punishments: 0 };
    }
  }

  async getConditioningPersonaBreakdown(args: {
    serverId?: number;
    userId?: number;
    lineageId?: number;
  }): Promise<ConditioningPersonaEntry[]> {
    try {
      const rows = await sql<
        { persona_lineage_id: number | string; conditioning_type: string; total: number | string }[]
      >`
        SELECT persona_lineage_id, conditioning_type, COALESCE(SUM(count), 0) AS total
        FROM conditioning_history
        WHERE (${args.serverId ?? null}::int IS NULL OR server_id = ${args.serverId ?? null})
          AND (${args.userId ?? null}::int IS NULL OR user_id = ${args.userId ?? null})
          AND (${args.lineageId ?? null}::bigint IS NULL OR persona_lineage_id = ${args.lineageId ?? null})
        GROUP BY persona_lineage_id, conditioning_type
      `;
      const byLineage = new Map<number, ConditioningPersonaEntry>();
      for (const r of rows) {
        const lineageId = Number(r.persona_lineage_id);
        const entry = byLineage.get(lineageId) ?? { lineageId, rewards: 0, punishments: 0 };
        if (r.conditioning_type === "reward") entry.rewards = Number(r.total);
        else if (r.conditioning_type === "punish") entry.punishments = Number(r.total);
        byLineage.set(lineageId, entry);
      }
      return [...byLineage.values()];
    } catch (error) {
      log.error("StatRepository.getConditioningPersonaBreakdown: failed", error);
      return [];
    }
  }

  async getPersonalMemoryCount(args: { userId: number; lineageId?: number }): Promise<number> {
    try {
      const [row] = await sql`
        SELECT COUNT(*) AS total
        FROM personal_memories
        WHERE user_id = ${args.userId}
          AND (${args.lineageId ?? null}::bigint IS NULL OR persona_lineage_id = ${args.lineageId ?? null})
      `;
      return Number(row?.total ?? 0);
    } catch (error) {
      log.error(`StatRepository.getPersonalMemoryCount: failed for user ${args.userId}`, error);
      return 0;
    }
  }

  async getServerPersonaMessages(
    args: { serverId: number; limit?: number } & StatWindow,
  ): Promise<PersonaAffinityEntry[]> {
    try {
      const from = windowFloor(args.from);
      const limit = args.limit ?? 5;
      const rows = await sql<{ persona_lineage_id: number | string; total: number | string }[]>`
        SELECT persona_lineage_id, SUM(count) AS total
        FROM stat_counters
        WHERE metric = 'message_sent'
          AND server_id = ${args.serverId}
          AND bucket >= ${from}::date
        GROUP BY persona_lineage_id
        ORDER BY total DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ lineageId: Number(r.persona_lineage_id), count: Number(r.total) }));
    } catch (error) {
      log.error(`StatRepository.getServerPersonaMessages: failed for server ${args.serverId}`, error);
      return [];
    }
  }

  async getServerDailyHeatCounts(args: { serverId: number; from: Date }): Promise<Map<string, number>> {
    const rows = await withTransientDbRetry(
      () => sql<{ bucket: Date | string; total: number | string }[]>`
        SELECT bucket::text AS bucket,
          SUM(count * CASE WHEN metric_key = 'reward' THEN ${REWARD_HEAT_MULTIPLIER} ELSE 1 END) AS total
        FROM stat_counters
        WHERE metric = 'message_sent'
          AND server_id = ${args.serverId}
          AND bucket >= ${windowFloor(args.from)}::date
        GROUP BY bucket
      `,
      "load server daily heat counts",
    );
    return new Map(rows.map((row) => [String(row.bucket), Number(row.total)]));
  }

  async getServerPersonaMessageCounts(args: { serverId: number; from: Date }): Promise<Map<number, number>> {
    const rows = await withTransientDbRetry(
      () => sql<{ persona_lineage_id: number | string; total: number | string }[]>`
        SELECT persona_lineage_id, SUM(count) AS total
        FROM stat_counters
        WHERE metric = 'message_sent'
          AND server_id = ${args.serverId}
          AND bucket >= ${windowFloor(args.from)}::date
        GROUP BY persona_lineage_id
      `,
      "load server persona message counts",
    );
    return new Map(rows.map((row) => [Number(row.persona_lineage_id), Number(row.total)]));
  }

  async getServerActiveHourHistogram(args: { serverId: number; from: Date }): Promise<number[]> {
    const histogram = Array.from({ length: 24 }, () => 0);
    const rows = await withTransientDbRetry(
      () => sql<{ metric_key: string; total: number | string }[]>`
        SELECT metric_key, SUM(count) AS total
        FROM stat_counters
        WHERE metric = 'active_hour'
          AND server_id = ${args.serverId}
          AND bucket >= ${windowFloor(args.from)}::date
        GROUP BY metric_key
      `,
      "load server active hour histogram",
    );
    for (const row of rows) {
      const hour = Number.parseInt(row.metric_key, 10);
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) histogram[hour] = Number(row.total);
    }
    return histogram;
  }

  async getServerMetricLastAt(args: { serverId: number; metric: StatMetric }): Promise<Date | null> {
    const [row] = await withTransientDbRetry(
      () => sql<{ last_at: Date | null }[]>`
        SELECT MAX(last_at) AS last_at
        FROM stat_counters
        WHERE metric = ${args.metric} AND server_id = ${args.serverId}
      `,
      "load server metric last activity",
    );
    return row?.last_at ? new Date(row.last_at) : null;
  }

  async getPersonalMemoryByPersona(args: { userId: number; limit?: number }): Promise<PersonaAffinityEntry[]> {
    try {
      const limit = args.limit ?? 5;
      const rows = await sql<{ persona_lineage_id: number | string; total: number | string }[]>`
        SELECT persona_lineage_id, COUNT(*) AS total
        FROM personal_memories
        WHERE user_id = ${args.userId}
        GROUP BY persona_lineage_id
        ORDER BY total DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ lineageId: Number(r.persona_lineage_id), count: Number(r.total) }));
    } catch (error) {
      log.error(`StatRepository.getPersonalMemoryByPersona: failed for user ${args.userId}`, error);
      return [];
    }
  }

  async getPersonaMemoryCount(args: { lineageId: number }): Promise<number> {
    try {
      const [row] = await sql`
        SELECT COUNT(*) AS total FROM personal_memories WHERE persona_lineage_id = ${args.lineageId}
      `;
      return Number(row?.total ?? 0);
    } catch (error) {
      log.error(`StatRepository.getPersonaMemoryCount: failed for lineage ${args.lineageId}`, error);
      return 0;
    }
  }

  async getTopUsersByMemory(args: { serverId?: number; lineageId?: number; limit?: number }): Promise<TopUserEntry[]> {
    try {
      const limit = args.limit ?? 5;
      const rows = await sql<{ user_id: number | string; user_disc_id: string; total: number | string }[]>`
        SELECT pm.user_id, u.user_disc_id, COUNT(*) AS total
        FROM personal_memories pm
        JOIN users u ON u.user_id = pm.user_id
        WHERE (${args.lineageId ?? null}::bigint IS NULL OR pm.persona_lineage_id = ${args.lineageId ?? null})
          AND (${args.serverId ?? null}::int IS NULL OR pm.user_id IN (
            SELECT DISTINCT user_id FROM stat_counters WHERE server_id = ${args.serverId ?? null}
          ))
        GROUP BY pm.user_id, u.user_disc_id
        ORDER BY total DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        userId: Number(r.user_id),
        userDiscId: String(r.user_disc_id),
        count: Number(r.total),
      }));
    } catch (error) {
      log.error("StatRepository.getTopUsersByMemory: failed", error);
      return [];
    }
  }

  async getConditioningTopUsers(args: {
    serverId?: number;
    lineageId?: number;
    type: "reward" | "punish";
    limit?: number;
  }): Promise<TopUserEntry[]> {
    try {
      const limit = args.limit ?? 5;
      const rows = await sql<{ user_id: number | string; user_disc_id: string; total: number | string }[]>`
        SELECT ch.user_id, u.user_disc_id, COALESCE(SUM(ch.count), 0) AS total
        FROM conditioning_history ch
        JOIN users u ON u.user_id = ch.user_id
        WHERE ch.conditioning_type = ${args.type}
          AND (${args.serverId ?? null}::int IS NULL OR ch.server_id = ${args.serverId ?? null})
          AND (${args.lineageId ?? null}::bigint IS NULL OR ch.persona_lineage_id = ${args.lineageId ?? null})
        GROUP BY ch.user_id, u.user_disc_id
        ORDER BY total DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        userId: Number(r.user_id),
        userDiscId: String(r.user_disc_id),
        count: Number(r.total),
      }));
    } catch (error) {
      log.error("StatRepository.getConditioningTopUsers: failed", error);
      return [];
    }
  }

  async getModelCostBreakdown(
    args: { userId?: number; serverId?: number; lineageId?: number; limit?: number } & StatWindow,
  ): Promise<ModelCostEntry[]> {
    try {
      const from = windowFloor(args.from);
      const limit = args.limit ?? 5;
      const rows = await sql<
        { model: string; in_tokens: number | string; out_tokens: number | string; cost: number | string }[]
      >`
        SELECT COALESCE(MAX(l.display_name), sc.metric_key) AS model,
          COALESCE(SUM(CASE WHEN sc.metric = 'tokens_in'  THEN sc.count ELSE 0 END), 0) AS in_tokens,
          COALESCE(SUM(CASE WHEN sc.metric = 'tokens_out' THEN sc.count ELSE 0 END), 0) AS out_tokens,
          COALESCE(SUM(
            sc.count
            * CASE sc.metric
                WHEN 'tokens_in'  THEN COALESCE(l.input_price_per_million, 0)
                WHEN 'tokens_out' THEN COALESCE(l.output_price_per_million, 0)
                ELSE 0
              END
            / 1000000.0
          ), 0) AS cost
        FROM stat_counters sc
        LEFT JOIN (
          SELECT llm_codename,
            MAX(input_price_per_million) AS input_price_per_million,
            MAX(output_price_per_million) AS output_price_per_million,
            MAX(display_name) AS display_name
          FROM (
            SELECT llm_codename, llm_codename AS display_name, input_price_per_million, output_price_per_million FROM llms
            UNION ALL
            SELECT 'decision:' || decision_model_id::text AS llm_codename, codename AS display_name,
              input_price_per_million, output_price_per_million FROM decision_models
          ) prices
          GROUP BY llm_codename
        ) l ON l.llm_codename = sc.metric_key
        WHERE sc.metric IN ('tokens_in', 'tokens_out')
          AND (${args.userId ?? null}::int IS NULL OR sc.user_id = ${args.userId ?? null})
          AND (${args.serverId ?? null}::int IS NULL OR sc.server_id = ${args.serverId ?? null})
          AND (${args.lineageId ?? null}::bigint IS NULL OR sc.persona_lineage_id = ${args.lineageId ?? null})
          AND sc.bucket >= ${from}::date
        GROUP BY sc.metric_key
        ORDER BY (
          COALESCE(SUM(CASE WHEN sc.metric = 'tokens_in'  THEN sc.count ELSE 0 END), 0)
          + COALESCE(SUM(CASE WHEN sc.metric = 'tokens_out' THEN sc.count ELSE 0 END), 0)
        ) DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        model: String(r.model),
        inputTokens: Number(r.in_tokens),
        outputTokens: Number(r.out_tokens),
        cost: Number(r.cost),
      }));
    } catch (error) {
      log.error("StatRepository.getModelCostBreakdown: failed", error);
      return [];
    }
  }

  async getEmotionBreakdown(
    args: { userId?: number; serverId?: number; lineageId?: number; limit?: number } & StatWindow,
  ): Promise<EmotionEntry[]> {
    try {
      const from = windowFloor(args.from);
      const limit = args.limit ?? 5;
      const userId = args.userId ?? null;
      const serverId = args.serverId ?? null;
      const lineageId = args.lineageId ?? null;
      const rows = await sql<{ emotion_key: string; total: number | string }[]>`
        SELECT emotion_key, SUM(cnt) AS total FROM (
          SELECT se.emotion_key AS emotion_key, sc.count AS cnt
          FROM stat_counters sc
          JOIN server_emojis se ON se.server_id = sc.server_id AND se.emoji_name = sc.metric_key
          WHERE sc.metric = 'emoji_used' AND se.emotion_key IS NOT NULL
            AND (${userId}::int IS NULL OR sc.user_id = ${userId})
            AND (${serverId}::int IS NULL OR sc.server_id = ${serverId})
            AND (${lineageId}::bigint IS NULL OR sc.persona_lineage_id = ${lineageId})
            AND sc.bucket >= ${from}::date
          UNION ALL
          SELECT ss.emotion_key AS emotion_key, sc.count AS cnt
          FROM stat_counters sc
          JOIN server_stickers ss ON ss.server_id = sc.server_id AND ss.sticker_name = sc.metric_key
          WHERE sc.metric = 'sticker_used' AND ss.emotion_key IS NOT NULL
            AND (${userId}::int IS NULL OR sc.user_id = ${userId})
            AND (${serverId}::int IS NULL OR sc.server_id = ${serverId})
            AND (${lineageId}::bigint IS NULL OR sc.persona_lineage_id = ${lineageId})
            AND sc.bucket >= ${from}::date
          UNION ALL
          SELECT LOWER(sc.metric_key) AS emotion_key, sc.count AS cnt
          FROM stat_counters sc
          WHERE sc.metric = 'sprite_emotion'
            AND (${userId}::int IS NULL OR sc.user_id = ${userId})
            AND (${serverId}::int IS NULL OR sc.server_id = ${serverId})
            AND (${lineageId}::bigint IS NULL OR sc.persona_lineage_id = ${lineageId})
            AND sc.bucket >= ${from}::date
          UNION ALL
          SELECT ce.emotion_key AS emotion_key, sc.count AS cnt
          FROM stat_counters sc
          JOIN custom_expressions ce ON ce.server_id = sc.server_id AND ce.custom_expression_id::text = sc.metric_key
          WHERE sc.metric = 'custom_expression_used'
            AND (${userId}::int IS NULL OR sc.user_id = ${userId})
            AND (${serverId}::int IS NULL OR sc.server_id = ${serverId})
            AND (${lineageId}::bigint IS NULL OR sc.persona_lineage_id = ${lineageId})
            AND sc.bucket >= ${from}::date
        ) sub
        GROUP BY emotion_key
        ORDER BY total DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ emotion: String(r.emotion_key), count: Number(r.total) }));
    } catch (error) {
      log.error("StatRepository.getEmotionBreakdown: failed", error);
      return [];
    }
  }

  async getServerMemoryCount(args: { serverId: number; lineageId?: number }): Promise<number> {
    try {
      const [row] = await sql`
        SELECT COUNT(*) AS total FROM server_memories
        WHERE server_id = ${args.serverId}
          AND (${args.lineageId ?? null}::bigint IS NULL OR persona_lineage_id = ${args.lineageId ?? null})
      `;
      return Number(row?.total ?? 0);
    } catch (error) {
      log.error(`StatRepository.getServerMemoryCount: failed for server ${args.serverId}`, error);
      return 0;
    }
  }

  // Count is approximate across all servers because personal_memories has no server_id, so this counts all memories
  // of users seen here.
  async getMemberMemoryCount(args: { serverId: number }): Promise<number> {
    try {
      const [row] = await sql`
        SELECT COUNT(*) AS total FROM personal_memories
        WHERE user_id IN (SELECT DISTINCT user_id FROM stat_counters WHERE server_id = ${args.serverId})
      `;
      return Number(row?.total ?? 0);
    } catch (error) {
      log.error(`StatRepository.getMemberMemoryCount: failed for server ${args.serverId}`, error);
      return 0;
    }
  }

  async toExportShape(_ownerId: string | number): Promise<null> {
    return null;
  }

  async fromExportShape(_ownerId: string | number, _data: null): Promise<boolean> {
    return true;
  }
}

export const statRepository = new StatRepository();
