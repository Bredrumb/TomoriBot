// This module only observes Bun memoryPressure events without freeing memory so timing can be judged against swap and
// PSI records first.

import { accessSync, constants } from "node:fs";
import { log } from "@/utils/misc/logger";

// Bun writes to these paths to arm memoryPressure, so probing writability disambiguates zero events in read-only
// container cgroupfs mounts.
const TRIGGER_PATHS = ["/sys/fs/cgroup/memory.pressure", "/proc/pressure/memory"] as const;

export type TriggerAccess = "writable" | "readonly" | "absent";

// Sentinel codes distinguish trigger availability for telemetry queries: 1 means writable, 0 means read-only, and -1
// means no trigger file exists.
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

export function installMemoryPressureListener(access: (path: string) => TriggerAccess = defaultTriggerAccess): void {
  if (installed) return;
  process.on("memoryPressure", onMemoryPressure);
  installed = true;
  triggerWritable = probeTriggerWritable(access);
}

// Listener and trigger fields repeat on every drained sample so any single metric row tells whether a zero event
// count could have fired.
export function drainMemoryPressureCounters(): Record<string, number> {
  const drained = {
    memory_pressure_events_5m: eventsSinceDrain,
    memory_pressure_listener: installed ? 1 : 0,
    memory_pressure_trigger_writable: triggerWritable,
  };
  eventsSinceDrain = 0;
  return drained;
}

export function resetMemoryPressureForTesting(): void {
  process.off("memoryPressure", onMemoryPressure);
  installed = false;
  eventsSinceDrain = 0;
  triggerWritable = -1;
}
