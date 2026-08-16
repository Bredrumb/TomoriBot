import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
// Hoisted real namespace so the mock below stays full-surface; `mock.module` is
// process-global for the whole run and a partial factory breaks later files.
import * as realDbClient from "@/utils/db/client";
import { createScopedModuleMocker, stubLogMembers } from "../../helpers/mockSurface";

const queries: string[] = [];
let insertRejection: Error | null = null;

/**
 * Stands in for the Bun SQL tagged template, recording the normalized statement text so a test
 * can assert which statements ran rather than what the repository intended to run.
 */
function fakeSql(strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> {
  const text = strings.join(" ? ").replace(/\s+/g, " ").trim();
  queries.push(text);
  if (insertRejection && text.startsWith("INSERT")) {
    return Promise.reject(insertRejection);
  }
  return Promise.resolve([]);
}

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/client": realDbClient,
});

scopedMock.module("@/utils/db/client", () => ({
  ...realDbClient,
  sql: fakeSql,
}));

stubLogMembers({ warn: () => {} });

let MetricSampleRepository: typeof import("@/utils/db/repositories/MetricSampleRepository").MetricSampleRepository;

beforeAll(async () => {
  ({ MetricSampleRepository } = await import("@/utils/db/repositories/MetricSampleRepository"));
});

const originalEnv = { ...process.env };

beforeEach(() => {
  queries.length = 0;
  insertRejection = null;
});

afterEach(() => {
  process.env.METRIC_SAMPLE_PRUNE_INTERVAL_MS = originalEnv.METRIC_SAMPLE_PRUNE_INTERVAL_MS;
  process.env.METRIC_SAMPLE_RETENTION_DAYS = originalEnv.METRIC_SAMPLE_RETENTION_DAYS;
});

const inserts = () => queries.filter((q) => q.startsWith("INSERT"));
const deletes = () => queries.filter((q) => q.startsWith("DELETE"));

describe("MetricSampleRepository", () => {
  it("records a sample and prunes on the first write", async () => {
    const repository = new MetricSampleRepository();
    await repository.recordSample("cache_sizes", { heap_used_mb: 312 });

    expect(inserts()).toHaveLength(1);
    expect(inserts()[0]).toContain("INSERT INTO metric_samples");
    expect(deletes()).toHaveLength(1);
  });

  // Retention is enforced here rather than by pg_cron, which is not installed in production and
  // would be skipped anyway while schema management is off. If this gate ever stops firing the
  // table grows unbounded with nothing to report it, which is the failure this test exists for.
  it("prunes again once the interval has elapsed", async () => {
    process.env.METRIC_SAMPLE_PRUNE_INTERVAL_MS = "1";
    const repository = new MetricSampleRepository();

    await repository.recordSample("cache_sizes", { heap_used_mb: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repository.recordSample("cache_sizes", { heap_used_mb: 2 });

    expect(deletes()).toHaveLength(2);
  });

  it("does not prune twice inside the interval", async () => {
    process.env.METRIC_SAMPLE_PRUNE_INTERVAL_MS = String(60 * 60 * 1000);
    const repository = new MetricSampleRepository();

    await repository.recordSample("cache_sizes", { heap_used_mb: 1 });
    await repository.recordSample("cache_sizes", { heap_used_mb: 2 });
    await repository.recordSample("cache_sizes", { heap_used_mb: 3 });

    expect(inserts()).toHaveLength(3);
    expect(deletes()).toHaveLength(1);
  });

  it("falls back to the default retention when the env value is not a positive integer", async () => {
    process.env.METRIC_SAMPLE_RETENTION_DAYS = "not-a-number";
    const repository = new MetricSampleRepository();

    await expect(repository.recordSample("cache_sizes", { heap_used_mb: 1 })).resolves.toBeUndefined();
    expect(deletes()).toHaveLength(1);
  });

  // A telemetry sink must never be able to break the interval that feeds it, and must not retry
  // into a pool that is already retiring queries.
  it("swallows an insert failure without rejecting or pruning", async () => {
    insertRejection = new Error("Idle timeout reached after 30s");
    const repository = new MetricSampleRepository();

    await expect(repository.recordSample("cache_sizes", { heap_used_mb: 1 })).resolves.toBeUndefined();
    expect(inserts()).toHaveLength(1);
    expect(deletes()).toHaveLength(0);
  });
});
