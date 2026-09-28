import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { log } from "@/utils/misc/logger";
import {
  drainMemoryPressureCounters,
  installMemoryPressureListener,
  resetMemoryPressureForTesting,
  type TriggerAccess,
} from "@/utils/misc/memoryPressureEvents";

const allAbsent = (): TriggerAccess => "absent";

let metricSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  resetMemoryPressureForTesting();
  metricSpy = spyOn(log, "metric").mockImplementation(() => {});
});

afterEach(() => {
  metricSpy.mockRestore();
});

afterAll(() => {
  resetMemoryPressureForTesting();
});

describe("memory pressure events", () => {
  it("reports no listener before install, so an absent series is not read as calm", () => {
    expect(drainMemoryPressureCounters()).toEqual({
      memory_pressure_events_5m: 0,
      memory_pressure_listener: 0,
      memory_pressure_trigger_writable: -1,
    });
  });

  it("counts events per interval and resets on drain", () => {
    installMemoryPressureListener(allAbsent);
    process.emit("memoryPressure" as never);
    process.emit("memoryPressure" as never);

    expect(drainMemoryPressureCounters().memory_pressure_events_5m).toBe(2);
    expect(drainMemoryPressureCounters().memory_pressure_events_5m).toBe(0);
  });

  // A sustained episode can fire many times per interval; more than one line each would turn the
  // signal into a log load source during exactly the condition it reports.
  it("logs only the first event of an interval", () => {
    installMemoryPressureListener(allAbsent);
    process.emit("memoryPressure" as never);
    process.emit("memoryPressure" as never);
    drainMemoryPressureCounters();
    process.emit("memoryPressure" as never);

    expect(metricSpy).toHaveBeenCalledTimes(2);
  });

  it("registers the listener only once", () => {
    installMemoryPressureListener(allAbsent);
    installMemoryPressureListener(allAbsent);
    process.emit("memoryPressure" as never);

    expect(drainMemoryPressureCounters().memory_pressure_events_5m).toBe(1);
  });

  it("separates a read-only trigger from a missing one", () => {
    installMemoryPressureListener((path) => (path.startsWith("/sys") ? "readonly" : "absent"));
    expect(drainMemoryPressureCounters().memory_pressure_trigger_writable).toBe(0);

    resetMemoryPressureForTesting();
    installMemoryPressureListener((path) => (path.startsWith("/proc") ? "writable" : "readonly"));
    expect(drainMemoryPressureCounters().memory_pressure_trigger_writable).toBe(1);
  });
});
