import { describe, expect, test } from "bun:test";
import { EventLoopMonitor, eventLoopMonitor } from "@/utils/misc/eventLoopMonitor";

/**
 * Every assertion here is a ratio of the sample interval, so the monitor runs the same lag and
 * staleness shapes at a cadence small enough for a unit test. The floor is Bun's timer
 * granularity: below a few milliseconds the callback itself is the load being measured, and the
 * lag readings become noise rather than signal.
 */
const FAST_INTERVAL_MS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function startFastMonitor(): EventLoopMonitor {
  const monitor = new EventLoopMonitor(FAST_INTERVAL_MS);
  monitor.start();
  return monitor;
}

/** A synchronous spin, which is the shape of the failure being detected. */
function blockFor(ms: number): void {
  const blockUntil = Date.now() + ms;
  while (Date.now() < blockUntil) {
    /* deliberately blocking */
  }
}

describe("eventLoopMonitor", () => {
  test("reports not running before start, and starts idempotently on the singleton", () => {
    expect(eventLoopMonitor.getSnapshot().running).toBe(false);

    eventLoopMonitor.start();
    eventLoopMonitor.start();

    expect(eventLoopMonitor.getSnapshot().running).toBe(true);
    expect(eventLoopMonitor.getSnapshot().sampleIntervalMs).toBeGreaterThan(0);
    eventLoopMonitor.stop();
    expect(eventLoopMonitor.getSnapshot().running).toBe(false);
  });

  test("staleness stays within a sample interval while the loop is free", async () => {
    const monitor = startFastMonitor();

    await sleep(FAST_INTERVAL_MS * 2);

    // Allow one extra interval of slack: the assertion is that staleness is bounded by the cadence,
    // not that the timer is punctual on a loaded CI box.
    expect(monitor.getSnapshot().stalenessMs).toBeLessThan(FAST_INTERVAL_MS * 3);
    monitor.stop();
  });

  test("a blocking job shows up as lag, which is the whole point of the monitor", async () => {
    const monitor = startFastMonitor();
    monitor.takeIntervalPeakLagMs();

    // Synchronous spin: the thread is busy rather than idle, so no amount of Discord or WebSocket
    // state would reveal it.
    blockFor(FAST_INTERVAL_MS * 2);
    await sleep(FAST_INTERVAL_MS * 2);

    expect(monitor.getSnapshot().peakLagSinceStartMs).toBeGreaterThan(0);
    monitor.stop();
  });

  test("takeIntervalPeakLagMs resets its window but leaves the since-start peak alone", async () => {
    const monitor = startFastMonitor();

    blockFor(FAST_INTERVAL_MS * 2);
    await sleep(FAST_INTERVAL_MS * 2);

    const firstRead = monitor.takeIntervalPeakLagMs();
    expect(firstRead).toBeGreaterThan(0);

    // A second read with no intervening stall must not re-report the same spike, or every metrics
    // sample after an incident would look like a fresh one.
    expect(monitor.takeIntervalPeakLagMs()).toBeLessThan(firstRead);
    expect(monitor.getSnapshot().peakLagSinceStartMs).toBeGreaterThanOrEqual(firstRead);

    monitor.stop();
  });

  test("a stopped monitor stops advancing its readings", async () => {
    const monitor = startFastMonitor();
    blockFor(FAST_INTERVAL_MS * 2);
    await sleep(FAST_INTERVAL_MS * 2);
    monitor.stop();

    const peakAtStop = monitor.getSnapshot().peakLagSinceStartMs;
    await sleep(FAST_INTERVAL_MS * 2);

    expect(monitor.getSnapshot().running).toBe(false);
    expect(monitor.getSnapshot().peakLagSinceStartMs).toBe(peakAtStop);
  });
});
