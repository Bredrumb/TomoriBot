/**
 * Counts Bun's `memoryPressure` events for the periodic `host_memory` metric sample.
 *
 * The event is the operating system's own low-memory verdict (a PSI trigger on Linux). It is
 * recorded beside the swap, zram, and PSI averages this deployment already samples, so its timing
 * can be judged against a known saturation record before anything is allowed to act on it. This
 * module only observes: nothing here frees memory.
 */

import { accessSync, constants } from "node:fs";
import { log } from "@/utils/misc/logger";

/**
 * Bun arms the trigger by writing to one of these files. Container runtimes usually mount cgroupfs
 * read-only, which would leave the listener registered yet unable to ever fire, so a sample of
 * zero events is ambiguous without knowing whether a trigger could have been armed at all.
 */
const TRIGGER_PATHS = ["/sys/fs/cgroup/memory.pressure", "/proc/pressure/memory"] as const;

export type TriggerAccess = "writable" | "readonly" | "absent";

/** Encoded into the sample: 1 any trigger file writable, 0 present but read-only, -1 none present. */
type TriggerWritableCode = 1 | 0 | -1;

let installed = false;
let eventsSinceDrain = 0;
let triggerWritable: TriggerWritableCode = -1;
const processStartMs = Date.now();

function defaultTriggerAccess(path: string): TriggerAccess {
  try {
    accessSync(path, constants.W_OK);
    return "writable";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "readonly";
  }
}

function probeTriggerWritable(access: (path: string) => TriggerAccess): TriggerWritableCode {
  const results = TRIGGER_PATHS.map(access);
  if (results.includes("writable")) return 1;
  return results.includes("readonly") ? 0 : -1;
}

function onMemoryPressure(): void {
  eventsSinceDrain += 1;
  // One JSONL line per sampling interval dates an episode precisely; a sustained episode can fire
  // far more often than that, and the count in the sample carries the rest.
  if (eventsSinceDrain === 1) {
    log.metric("memory_pressure", { uptime_s: Math.floor((Date.now() - processStartMs) / 1000) });
  }
}

/**
 * Registers the listener once and records whether a trigger could be armed.
 *
 * @param access - Injected so tests do not depend on the host's `/proc` and cgroup layout.
 */
export function installMemoryPressureListener(access: (path: string) => TriggerAccess = defaultTriggerAccess): void {
  if (installed) return;
  process.on("memoryPressure", onMemoryPressure);
  installed = true;
  triggerWritable = probeTriggerWritable(access);
}

/**
 * Returns the events since the previous drain and resets the count, so each sample carries a rate
 * over its interval. The listener and trigger fields repeat on every sample so any single row can
 * answer whether a zero was even capable of being nonzero.
 */
export function drainMemoryPressureCounters(): Record<string, number> {
  const drained = {
    memory_pressure_events_5m: eventsSinceDrain,
    memory_pressure_listener: installed ? 1 : 0,
    memory_pressure_trigger_writable: triggerWritable,
  };
  eventsSinceDrain = 0;
  return drained;
}

/** Test seam: removes the listener and clears all state between cases. */
export function resetMemoryPressureForTesting(): void {
  process.off("memoryPressure", onMemoryPressure);
  installed = false;
  eventsSinceDrain = 0;
  triggerWritable = -1;
}
