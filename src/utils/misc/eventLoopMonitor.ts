// Floor for the configured cadence: below this the timer itself becomes the load being measured.
const MIN_SAMPLE_INTERVAL_MS = 100;

const SAMPLE_INTERVAL_MS = Math.max(
  Number.parseInt(process.env.EVENT_LOOP_SAMPLE_INTERVAL_MS || "", 10) || 1000,
  MIN_SAMPLE_INTERVAL_MS,
);

// Exported so tests can instantiate fast sampling cadences, while production uses the singleton configured from the
// environment.
export class EventLoopMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = Date.now();
  private lastLagMs = 0;
  private peakLagSinceStartMs = 0;
  private peakLagSinceReadMs = 0;

  constructor(private readonly sampleIntervalMs: number = SAMPLE_INTERVAL_MS) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.lastTickAt = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const lag = Math.max(0, now - this.lastTickAt - this.sampleIntervalMs);
      this.lastTickAt = now;
      this.lastLagMs = lag;
      this.peakLagSinceStartMs = Math.max(this.peakLagSinceStartMs, lag);
      this.peakLagSinceReadMs = Math.max(this.peakLagSinceReadMs, lag);
    }, this.sampleIntervalMs);

    // Never hold the process open: this is diagnostics, and a live handle here would stall shutdown.
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  // Point-in-time /healthz snapshot that leaves the windowed peak untouched so health probes cannot blind the metrics
  // series.
  getSnapshot(): EventLoopSnapshot {
    return {
      running: this.timer !== null,
      sampleIntervalMs: this.sampleIntervalMs,
      stalenessMs: Date.now() - this.lastTickAt,
      lastLagMs: this.lastLagMs,
      peakLagSinceStartMs: this.peakLagSinceStartMs,
    };
  }

  // Each read resets the peak window so 5-minute samples capture short spikes, assuming a single caller.
  takeIntervalPeakLagMs(): number {
    const peak = this.peakLagSinceReadMs;
    this.peakLagSinceReadMs = 0;
    return peak;
  }
}

interface EventLoopSnapshot {
  running: boolean;
  sampleIntervalMs: number;

  // Large values indicate CPU starvation rather than an outright block, because a blocked loop stops answering probes
  // before staleness can be read.
  stalenessMs: number;

  lastLagMs: number;
  peakLagSinceStartMs: number;
}

export const eventLoopMonitor = new EventLoopMonitor();
