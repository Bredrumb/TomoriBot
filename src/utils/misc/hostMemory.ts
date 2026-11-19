// Docker does not virtualize /proc/meminfo or /proc/pressure/*, so reading them from the container intentionally
// captures host-level telemetry without a host agent.

import { readFile } from "node:fs/promises";

export type HostMemoryFields = Record<string, number>;

// Injected rather than module-mocked because Bun mock.module persists process-wide after mock.restore() and would
// leak a mocked node:fs into later test files.
export type HostFileReader = (path: string) => Promise<string | null>;

const KB_PER_MB = 1024;
const BYTES_PER_MB = 1024 * 1024;

let previousCounters: { values: Record<string, number>; atMs: number } | null = null;

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function parseMeminfo(text: string): Record<string, number> {
  const values: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB$/);
    if (match) values[match[1]] = Number(match[2]);
  }
  return values;
}

// Both some and full PSI lines are retained because full captures all-task stalls while some moves earlier.
function parsePressure(text: string): Record<string, Record<string, number>> {
  const parsed: Record<string, Record<string, number>> = {};
  for (const line of text.split("\n")) {
    const [kind, ...rest] = line.trim().split(/\s+/);
    if (kind !== "some" && kind !== "full") continue;
    const windows: Record<string, number> = {};
    for (const pair of rest) {
      const [key, value] = pair.split("=");
      const numeric = Number(value);
      if (key && Number.isFinite(numeric)) windows[key] = numeric;
    }
    parsed[kind] = windows;
  }
  return parsed;
}

function addMeminfoFields(fields: HostMemoryFields, text: string): void {
  const info = parseMeminfo(text);
  const total = info.MemTotal;
  if (!total) return;

  fields.host_total_mb = round(total / KB_PER_MB);
  if (info.MemAvailable !== undefined) {
    fields.host_avail_mb = round(info.MemAvailable / KB_PER_MB);
    fields.host_avail_pct = round((info.MemAvailable / total) * 100);
  }
  if (info.MemFree !== undefined) fields.host_free_mb = round(info.MemFree / KB_PER_MB);
  if (info.Cached !== undefined) fields.host_cache_mb = round(info.Cached / KB_PER_MB);
  if (info.SwapTotal !== undefined && info.SwapFree !== undefined) {
    fields.host_swap_used_mb = round((info.SwapTotal - info.SwapFree) / KB_PER_MB);
  }
}

function addPressureFields(fields: HostMemoryFields, resource: "mem" | "io", text: string): void {
  const pressure = parsePressure(text);
  for (const kind of ["some", "full"] as const) {
    const windows = pressure[kind];
    if (!windows) continue;
    for (const window of ["avg10", "avg60", "avg300"] as const) {
      const value = windows[window];
      if (value !== undefined) fields[`${resource}_${kind}_${window}`] = value;
    }
  }
}

// Per-device swap is tracked instead of /proc/meminfo aggregates because zram and disk /swapfile differ roughly 100x
// in fault cost.
function addSwapDeviceFields(fields: HostMemoryFields, text: string): void {
  for (const line of text.split("\n").slice(1)) {
    const [filename, , size, used] = line.trim().split(/\s+/);
    const usedKb = Number(used);
    if (!filename || !Number.isFinite(usedKb)) continue;
    if (filename.includes("zram")) {
      fields.zram_used_mb = round(usedKb / KB_PER_MB);
      // Saturation is judged against this rather than a constant, so resizing the device does not
      // silently move every "time to saturation" reading.
      const sizeKb = Number(size);
      if (Number.isFinite(sizeKb) && sizeKb > 0) fields.zram_size_mb = round(sizeKb / KB_PER_MB);
    } else {
      fields.swapfile_used_mb = round(usedKb / KB_PER_MB);
    }
  }
}

// Zram mm_stat sizes are needed because swapon reports only uncompressed size, hiding actual RAM usage and proximity
// to the pool ceiling.
function addZramFields(fields: HostMemoryFields, text: string): void {
  const [orig, compressed] = text.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(orig) || !Number.isFinite(compressed) || compressed <= 0) return;
  fields.zram_orig_mb = round(orig / BYTES_PER_MB);
  fields.zram_compr_mb = round(compressed / BYTES_PER_MB);
  fields.zram_ratio = round(orig / compressed);
}

// Negative deltas mean a host reboot restarted cumulative counters, so rates are dropped instead of reporting a
// negative spike.
function addVmstatRateFields(fields: HostMemoryFields, text: string, nowMs: number): void {
  const wanted = ["pswpin", "pswpout", "pgmajfault"] as const;
  const values: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const [key, value] = line.trim().split(/\s+/);
    if ((wanted as readonly string[]).includes(key)) values[key] = Number(value);
  }
  if (Object.keys(values).length !== wanted.length) return;

  const previous = previousCounters;
  previousCounters = { values, atMs: nowMs };
  if (!previous) return;

  const elapsedSeconds = (nowMs - previous.atMs) / 1000;
  if (elapsedSeconds <= 0) return;

  const names: Record<string, string> = {
    pswpin: "swap_in_per_s",
    pswpout: "swap_out_per_s",
    pgmajfault: "major_faults_per_s",
  };
  for (const key of wanted) {
    const delta = values[key] - previous.values[key];
    if (delta < 0) return;
    fields[names[key]] = round(delta / elapsedSeconds);
  }
}

// Null is returned when no Linux counters are readable so callers skip the sink instead of emitting empty rows.
export async function collectHostMemorySnapshot(
  nowMs = Date.now(),
  read: HostFileReader = readText,
): Promise<HostMemoryFields | null> {
  const [meminfo, memPressure, ioPressure, swaps, zram, vmstat] = await Promise.all([
    read("/proc/meminfo"),
    read("/proc/pressure/memory"),
    read("/proc/pressure/io"),
    read("/proc/swaps"),
    read("/sys/block/zram0/mm_stat"),
    read("/proc/vmstat"),
  ]);

  const fields: HostMemoryFields = {};
  if (meminfo) addMeminfoFields(fields, meminfo);
  if (memPressure) addPressureFields(fields, "mem", memPressure);
  if (ioPressure) addPressureFields(fields, "io", ioPressure);
  if (swaps) addSwapDeviceFields(fields, swaps);
  if (zram) addZramFields(fields, zram);
  if (vmstat) addVmstatRateFields(fields, vmstat, nowMs);

  return Object.keys(fields).length > 0 ? fields : null;
}

export function resetHostMemoryCountersForTests(): void {
  previousCounters = null;
}
