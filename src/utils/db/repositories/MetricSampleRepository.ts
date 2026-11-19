import { sql } from "@/utils/db/client";
import { z } from "zod";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";
import type { ShardTopology } from "@/utils/discord/shardOwnership";

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

// Kept local instead of importing config helpers so MetricSampleRepository stays free of config initialization
// dependencies.
function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Grafana reads metric_samples over Postgres instead of Log Analytics so the host avoids running
// AzureMonitorLinuxAgent.
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

  // Optional db injection avoids process-wide mock.module leaks in tests, and resolving sql inside executor prevents
  // init-order reads.
  constructor(private readonly db?: typeof sql) {}

  private get executor(): typeof sql {
    return this.db ?? sql;
  }

  private hasReportedSinceSuccess = false;

  // Never throws or retries with withTransientDbRetry because droppable telemetry must not break callers or amplify
  // failing DB pool load.
  async recordSample(metricName: string, fields: MetricFields): Promise<void> {
    // `fields` is bound as an object, not a `JSON.stringify` result: under Bun's driver a
    // stringified value binds as text and `::jsonb` parses it into a JSONB scalar string, which
    // makes every `fields->>'...'` read in the Grafana panels return null. See migration 064.
    // Called through a local so `this` stays undefined at the call site, matching a bare `sql`.
    const run = this.executor;
    try {
      const { sanitizeLogPayload } = await import("@/utils/misc/logger");
      await run`
        INSERT INTO metric_samples (metric_name, fields)
        VALUES (${metricName}, ${sanitizeLogPayload(fields, 0, false)})
      `;
      this.hasReportedSinceSuccess = false;
      await this.pruneIfDue();
    } catch (error) {
      await this.reportOnce("Failed to record metric sample", error);
    }
  }

  // Write-path pruning replaces pg_cron or init jobs because pg_cron is absent and schema management is disabled in
  // production.
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

  // Logger import is deferred to avoid an import cycle and errors log once with persist: false so failing DB writes
  // never storm the pool.
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

export const metricSampleRepository = new MetricSampleRepository();
