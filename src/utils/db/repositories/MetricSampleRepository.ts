import { sql } from "@/utils/db/client";
import { z } from "zod";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";
import type { ShardTopology } from "@/utils/discord/shardOwnership";

/** Flat numeric snapshot as produced by `collectCacheMetricsSnapshot()`. */
export type MetricFields = Record<string, number | string>;

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CACHE_SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const clusterSampleSchema = z.object({
  process_label: z.string(),
  shard_count: z.number().int().positive().safe(),
  shard_ids: z.string().regex(/^\d+(,\d+)*$/),
  discord_guilds: z.number().int().nonnegative().safe(),
});

/**
 * Reads a positive integer from the environment, falling back when unset or unparseable.
 * Kept local so this file stays importable without pulling in config machinery.
 */
function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Sink for periodic process and cache measurements, read by Grafana over the existing
 * Postgres datasource.
 *
 * Replaces the `TomoriBotCacheMetrics_CL` Log Analytics table so the AzureMonitorLinuxAgent
 * can be removed from a host where it holds 179 MB against a saturated 1 GB zram device.
 */
export class MetricSampleRepository {
  private lastPruneAt = 0;

  async getClusterGuildCount(topology: ShardTopology): Promise<number | null> {
    const run = this.executor;
    const { totalShardCount, ownedShardIds } = topology.getResolvedTopology();
    const freshnessMs = 2 * positiveIntFromEnv("CACHE_METRICS_INTERVAL_MS", DEFAULT_CACHE_SAMPLE_INTERVAL_MS);
    try {
      const rows = await run<{ fields: unknown }[]>`
        SELECT DISTINCT ON (fields->>'process_label') fields
        FROM metric_samples
        WHERE metric_name = 'cache_sizes'
          AND created_at >= clock_timestamp() - ${freshnessMs} * INTERVAL '1 millisecond'
          AND created_at <= clock_timestamp()
        ORDER BY fields->>'process_label', created_at DESC, metric_sample_id DESC
      `;
      const covered = new Set<number>();
      let guildCount = 0;
      let hasLocalSample = false;
      for (const row of rows) {
        const parsed = clusterSampleSchema.safeParse(row.fields);
        if (!parsed.success || parsed.data.shard_count !== totalShardCount) continue;
        const sample = parsed.data;
        const ids = sample.shard_ids.split(",").map(Number);
        if (ids.some((id, index) => id >= totalShardCount || (index > 0 && id <= ids[index - 1]))) continue;
        const label = ids.length === totalShardCount ? "all" : `shards:${totalShardCount}:${ids.join(",")}`;
        if (sample.process_label !== label || sample.shard_ids !== ids.join(",")) continue;
        const local = sample.process_label === topology.processLabel;
        if (!local && ids.some((id) => ownedShardIds.includes(id))) continue;
        if (ids.some((id) => covered.has(id))) return null;
        for (const id of ids) covered.add(id);
        hasLocalSample ||= local;
        guildCount += sample.discord_guilds;
      }
      return hasLocalSample && covered.size === totalShardCount && Number.isSafeInteger(guildCount) ? guildCount : null;
    } catch (error) {
      await this.reportOnce("Failed to read cluster guild count", error);
      return null;
    }
  }

  /**
   * The executor is injected rather than module-mocked in tests. `mock.module` is registered
   * process-wide for the whole run and is not undone by `mock.restore()`, so a mocked `sql`
   * leaks into every later test file and quietly answers its queries too.
   *
   * It stays optional and resolves in {@link executor} rather than as a `= sql` default, for the
   * same reason as ErrorLogRepository: a default parameter is evaluated while constructing the
   * singleton below, which can read `sql` before its module has finished initializing.
   */
  constructor(private readonly db?: typeof sql) {}

  /** Resolved per call so module initialization order cannot matter. */
  private get executor(): typeof sql {
    return this.db ?? sql;
  }

  /** Suppresses repeat reports so a pool-wide failure logs once, not once per sample. */
  private hasReportedSinceSuccess = false;

  /**
   * Records one sample and prunes expired rows when due. Never throws and never rejects:
   * telemetry must not be able to break the caller that produced it.
   *
   * Deliberately NOT wrapped in `withTransientDbRetry`. A retry is right for work a user is
   * waiting on, but for a 5-minute telemetry sample it converts a pool retirement into extra
   * load at exactly the moment the pool is already failing. A missing sample is the cheaper
   * outcome, and `log.metric()` still writes the durable copy to the host JSONL regardless.
   */
  async recordSample(metricName: string, fields: MetricFields): Promise<void> {
    // `fields` is bound as an object, not a `JSON.stringify` result: under Bun's driver a
    // stringified value binds as text and `::jsonb` parses it into a JSONB scalar string, which
    // makes every `fields->>'...'` read in the Grafana panels return null. See migration 064.
    // Called through a local so `this` stays undefined at the call site, matching a bare `sql`.
    const run = this.executor;
    try {
      await run`
        INSERT INTO metric_samples (metric_name, fields)
        VALUES (${metricName}, ${fields})
      `;
      this.hasReportedSinceSuccess = false;
      await this.pruneIfDue();
    } catch (error) {
      await this.reportOnce("Failed to record metric sample", error);
    }
  }

  /**
   * Deletes samples past the retention window, at most once per prune interval.
   *
   * Pruning rides the write path rather than a pg_cron job because production runs with
   * `DATABASE_SCHEMA_MANAGEMENT_ENABLED=false`, and `src/init/database.ts` returns before
   * scheduling any job in that mode. pg_cron is not installed on the server at all, so a
   * scheduled job would never run and nothing would report that it hadn't. This mirrors the
   * sweep-on-write approach in `personaSpriteMessageCache.ts`.
   */
  private async pruneIfDue(): Promise<void> {
    if (!isPrimaryProcess()) return;
    const intervalMs = positiveIntFromEnv("METRIC_SAMPLE_PRUNE_INTERVAL_MS", DEFAULT_PRUNE_INTERVAL_MS);
    const now = Date.now();
    if (now - this.lastPruneAt < intervalMs) {
      return;
    }

    // Claim the slot before awaiting, so two overlapping samples cannot both prune.
    this.lastPruneAt = now;

    const retentionDays = positiveIntFromEnv("METRIC_SAMPLE_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
    const run = this.executor;
    try {
      await run`
        DELETE FROM metric_samples
        WHERE created_at < CURRENT_TIMESTAMP - MAKE_INTERVAL(days => ${retentionDays})
      `;
    } catch (error) {
      await this.reportOnce("Failed to prune metric samples", error);
    }
  }

  /**
   * Logs a failure only when the previous write succeeded, so a pool-wide retirement does not
   * add its own log storm to the incident that caused it. The logger import is deferred to
   * keep this repository out of `logger.ts`'s import cycle, matching `ErrorLogRepository`.
   *
   * An error, because a gap in `metric_samples` during an outage is otherwise traceless, and this
   * line is the one artifact that names the cause. Not persisted: an `error_logs` insert would
   * queue on the same pool that just failed, adding load to the incident it is reporting.
   */
  private async reportOnce(message: string, error: unknown): Promise<void> {
    if (this.hasReportedSinceSuccess) return;
    this.hasReportedSinceSuccess = true;

    try {
      const { log } = await import("@/utils/misc/logger");
      await log.error(message, error, { errorType: "metric_sink_failure" }, { persist: false });
    } catch {
      // Reporting a telemetry failure must not itself become one, so the "never rejects"
      // contract of recordSample() holds even if the logger module fails to resolve.
    }
  }
}

/** Singleton: import this in callers. */
export const metricSampleRepository = new MetricSampleRepository();
