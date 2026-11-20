export interface ProcessMemorySnapshot {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb: number;
}

export type ForcedGcRuntime = "bun" | "node" | "unavailable";

/**
 * Runs a full, blocking garbage collection when the runtime exposes one.
 *
 * Throws whatever the underlying collector throws so callers can record the
 * failure; a caller that only wants a best-effort pass must catch.
 */
export function runForcedGc(): ForcedGcRuntime {
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true);
    return "bun";
  }

  if (global.gc) {
    global.gc();
    return "node";
  }

  return "unavailable";
}

type MetricFields = Record<string, number | string>;

const BYTES_PER_MB = 1024 * 1024;

function roundMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 100) / 100;
}

function roundDeltaMb(value: number): number {
  return Math.round(value * 100) / 100;
}

export function collectProcessMemorySnapshot(): ProcessMemorySnapshot {
  const usage = process.memoryUsage();

  return {
    rssMb: roundMb(usage.rss),
    heapUsedMb: roundMb(usage.heapUsed),
    heapTotalMb: roundMb(usage.heapTotal),
    externalMb: roundMb(usage.external),
    arrayBuffersMb: roundMb(usage.arrayBuffers),
  };
}

export function addProcessMemorySnapshotFields(
  fields: MetricFields,
  suffix: string,
  snapshot: ProcessMemorySnapshot,
): void {
  fields[`rss_mb_${suffix}`] = snapshot.rssMb;
  fields[`heap_used_mb_${suffix}`] = snapshot.heapUsedMb;
  fields[`heap_total_mb_${suffix}`] = snapshot.heapTotalMb;
  fields[`external_mb_${suffix}`] = snapshot.externalMb;
  fields[`array_buffers_mb_${suffix}`] = snapshot.arrayBuffersMb;
}

export function addProcessMemoryDeltaFields(
  fields: MetricFields,
  suffix: string,
  before: ProcessMemorySnapshot,
  after: ProcessMemorySnapshot,
): void {
  fields[`rss_mb_delta_${suffix}`] = roundDeltaMb(after.rssMb - before.rssMb);
  fields[`heap_used_mb_delta_${suffix}`] = roundDeltaMb(after.heapUsedMb - before.heapUsedMb);
  fields[`heap_total_mb_delta_${suffix}`] = roundDeltaMb(after.heapTotalMb - before.heapTotalMb);
  fields[`external_mb_delta_${suffix}`] = roundDeltaMb(after.externalMb - before.externalMb);
  fields[`array_buffers_mb_delta_${suffix}`] = roundDeltaMb(after.arrayBuffersMb - before.arrayBuffersMb);
}
