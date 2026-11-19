// This module stays importless because client.ts imports it inside a fragile client->logger->ErrorLogRepository
// cycle, so callers handle logging.

const LIFETIME_CODE = "ERR_POSTGRES_LIFETIME_TIMEOUT";
const IDLE_CODE = "ERR_POSTGRES_IDLE_TIMEOUT";

const DEFAULT_EPISODE_QUIET_MS = 60_000;

interface PoolEventCounters {
  total: number;
  lifetime: number;
  idle: number;
  other: number;
  retriesRecovered: number;
  exhausted: number;
  lastLifetimePhaseS: number;
}

function emptyCounters(): PoolEventCounters {
  return { total: 0, lifetime: 0, idle: 0, other: 0, retriesRecovered: 0, exhausted: 0, lastLifetimePhaseS: -1 };
}

let counters = emptyCounters();
let lastEventAtMs = 0;

const processStartMs = Date.now();

function episodeQuietMs(): number {
  const parsed = Number.parseInt(process.env.POOL_EVENT_EPISODE_QUIET_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EPISODE_QUIET_MS;
}

export interface PoolEventRecord {
  isFirstOfEpisode: boolean;
  uptimeS: number;
  // Bun exposes no connection age, so uptime modulo maxLifetime detects burst-created retirements clustering at one
  // phase versus age-independent drops.
  lifetimePhaseS: number;
}

export function recordPoolEvent(code: string, maxLifetimeSeconds: number): PoolEventRecord {
  const now = Date.now();
  const isFirstOfEpisode = now - lastEventAtMs > episodeQuietMs();
  lastEventAtMs = now;

  const uptimeS = Math.floor((now - processStartMs) / 1000);
  const lifetimePhaseS = maxLifetimeSeconds > 0 ? uptimeS % maxLifetimeSeconds : -1;

  counters.total += 1;
  if (code === LIFETIME_CODE) {
    counters.lifetime += 1;
    counters.lastLifetimePhaseS = lifetimePhaseS;
  } else if (code === IDLE_CODE) {
    counters.idle += 1;
  } else {
    counters.other += 1;
  }

  return { isFirstOfEpisode, uptimeS, lifetimePhaseS };
}

// Production pins logging at error and drops per-retry warnings, so this counter provides the only signal for how
// many retirements retries mask.
export function recordPoolRetryRecovered(): void {
  counters.retriesRecovered += 1;
}

export function recordPoolRetryExhausted(): void {
  counters.exhausted += 1;
}

export function drainPoolEventCounters(): Record<string, number> {
  const drained = counters;
  counters = emptyCounters();

  return {
    pool_errors_5m: drained.total,
    pool_lifetime_5m: drained.lifetime,
    pool_idle_5m: drained.idle,
    pool_other_5m: drained.other,
    pool_retries_recovered_5m: drained.retriesRecovered,
    pool_retries_exhausted_5m: drained.exhausted,
    pool_last_lifetime_phase_s: drained.lastLifetimePhaseS,
  };
}

export function resetPoolEventCountersForTesting(): void {
  counters = emptyCounters();
  lastEventAtMs = 0;
}
