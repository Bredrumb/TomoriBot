// Must stay pure and observe-only for log replay and a host watchdog, because an in-process actor stalls during the
// host starvation it detects.

export type PressureLevel = "normal" | "elevated" | "critical";

// Actions escalate by cost because recycling co-tenants cut host IO pressure 43%, while VM restart is reserved for
// reclaim livelock.
export type PressureAction = "none" | "recycle_cotenants" | "recycle_bot" | "restart_vm";

type PressureSuppression = "startup_grace" | "dwell" | "rate_limit" | null;

export interface PressureSample {
  atMs: number;
  ioFullAvg60?: number;
  memFullAvg60?: number;
  swapInPerS?: number;
  hostAvailMb?: number;
  containerSwapMb?: number;
}

export interface PressureThresholds {
  elevatedIoFull: number;
  criticalIoFull: number;
  // Kept separate from entry thresholds so pressure levels cannot oscillate on one noisy sample.
  recoveryIoFull: number;
  // Minimum live swap-in rate required so harmless one-time cold page evictions are ignored.
  minSwapInPerS: number;
  elevatedDwellMs: number;
  criticalDwellMs: number;
  // Duty-cycle fraction over dwell windows instead of a continuous run, because io_full dips constantly during real
  // incidents.
  minDutyCycle: number;
  startupGraceMs: number;
  minActionIntervalMs: number;
}

export interface PressureState {
  level: PressureLevel;
  // [timestampMs, levelRank] pairs pruned by retention window rather than sample count, so state cannot grow
  // unbounded with uptime.
  recent: Array<[number, number]>;
  rawLevel: PressureLevel;
  lastActionAtMs: number | null;
  lastAction: PressureAction;
}

export interface PressureVerdict {
  level: PressureLevel;
  rawLevel: PressureLevel;
  wouldAct: PressureAction;
  suppressedBy: PressureSuppression;
  elevatedDuty: number;
  criticalDuty: number;
  // Retained history span exported so observers can distinguish an incomplete startup window from a quiet one.
  windowSpanMs: number;
}

// Observe-only thresholds calibrated by replaying 290h of production samples, because looser duty cycles (such as
// 0.7) flag baseline noise as daily incidents.
export const DEFAULT_PRESSURE_THRESHOLDS: PressureThresholds = {
  elevatedIoFull: 15,
  criticalIoFull: 30,
  recoveryIoFull: 5,
  minSwapInPerS: 1,
  elevatedDwellMs: 60 * 60 * 1000,
  criticalDwellMs: 30 * 60 * 1000,
  minDutyCycle: 0.95,
  startupGraceMs: 15 * 60 * 1000,
  minActionIntervalMs: 6 * 60 * 60 * 1000,
};

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Env threshold loader kept separate from evaluatePressure, so pressure evaluation remains a pure function replayable
// on historical logs.
export function pressureThresholdsFromEnv(): PressureThresholds {
  return {
    elevatedIoFull: numberFromEnv("PRESSURE_ELEVATED_IO_FULL", DEFAULT_PRESSURE_THRESHOLDS.elevatedIoFull),
    criticalIoFull: numberFromEnv("PRESSURE_CRITICAL_IO_FULL", DEFAULT_PRESSURE_THRESHOLDS.criticalIoFull),
    recoveryIoFull: numberFromEnv("PRESSURE_RECOVERY_IO_FULL", DEFAULT_PRESSURE_THRESHOLDS.recoveryIoFull),
    minSwapInPerS: numberFromEnv("PRESSURE_MIN_SWAP_IN_PER_S", DEFAULT_PRESSURE_THRESHOLDS.minSwapInPerS),
    elevatedDwellMs: numberFromEnv("PRESSURE_ELEVATED_DWELL_MS", DEFAULT_PRESSURE_THRESHOLDS.elevatedDwellMs),
    criticalDwellMs: numberFromEnv("PRESSURE_CRITICAL_DWELL_MS", DEFAULT_PRESSURE_THRESHOLDS.criticalDwellMs),
    minDutyCycle: numberFromEnv("PRESSURE_MIN_DUTY_CYCLE", DEFAULT_PRESSURE_THRESHOLDS.minDutyCycle),
    startupGraceMs: numberFromEnv("PRESSURE_STARTUP_GRACE_MS", DEFAULT_PRESSURE_THRESHOLDS.startupGraceMs),
    minActionIntervalMs: numberFromEnv(
      "PRESSURE_MIN_ACTION_INTERVAL_MS",
      DEFAULT_PRESSURE_THRESHOLDS.minActionIntervalMs,
    ),
  };
}

// Must stay false by default until thresholds are tuned across multi-day cycles, since the in-process path only
// labels recorded series.
export function isPressureDetectorArmed(): boolean {
  return process.env.PRESSURE_DETECTOR_ARMED === "true";
}

export function pressureSampleFromHostFields(fields: Record<string, number>, atMs: number): PressureSample {
  return {
    atMs,
    ioFullAvg60: fields.io_full_avg60,
    memFullAvg60: fields.mem_full_avg60,
    swapInPerS: fields.swap_in_per_s,
    hostAvailMb: fields.host_avail_mb,
    containerSwapMb: fields.zram_used_mb,
  };
}

export function initialPressureState(): PressureState {
  return {
    level: "normal",
    recent: [],
    rawLevel: "normal",
    lastActionAtMs: null,
    lastAction: "none",
  };
}

const LEVEL_RANK: Record<PressureLevel, number> = { normal: 0, elevated: 1, critical: 2 };

// Both PSI and live swap-in rate are required above normal, because PSI alone catches transient bursts and swap depth
// counts harmless cold pages.
function classify(sample: PressureSample, thresholds: PressureThresholds): PressureLevel {
  const ioFull = sample.ioFullAvg60;
  const swapIn = sample.swapInPerS;
  if (ioFull === undefined || swapIn === undefined) return "normal";
  if (swapIn < thresholds.minSwapInPerS) return "normal";
  if (ioFull >= thresholds.criticalIoFull) return "critical";
  if (ioFull >= thresholds.elevatedIoFull) return "elevated";
  return "normal";
}

function hasRecovered(sample: PressureSample, thresholds: PressureThresholds): boolean {
  const ioFull = sample.ioFullAvg60;
  if (ioFull === undefined) return false;
  return ioFull <= thresholds.recoveryIoFull;
}

function actionFor(level: PressureLevel): PressureAction {
  if (level === "critical") return "recycle_bot";
  if (level === "elevated") return "recycle_cotenants";
  return "none";
}

// Coverage checks the oldest retained sample instead of the oldest in-window one, because in-window samples are
// always younger than the window.
function dutyCycle(
  recent: Array<[number, number]>,
  nowMs: number,
  windowMs: number,
  minRank: number,
): { duty: number; covered: boolean } {
  let hits = 0;
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const [atMs, rank] = recent[i];
    if (nowMs - atMs > windowMs) break;
    total++;
    if (rank >= minRank) hits++;
  }
  const oldestRetained = recent.length > 0 ? recent[0][0] : nowMs;
  return { duty: total === 0 ? 0 : hits / total, covered: nowMs - oldestRetained >= windowMs };
}

// Startup grace from `processStartMs` suppresses the ~700 MB boot warm-up so healthy restarts avoid restart loops.
export function evaluatePressure(
  state: PressureState,
  sample: PressureSample,
  processStartMs: number,
  thresholds: PressureThresholds = DEFAULT_PRESSURE_THRESHOLDS,
): { state: PressureState; verdict: PressureVerdict } {
  const rawLevel = classify(sample, thresholds);

  // Retain twice the longest window so `covered` can be satisfied: pruning to exactly the window
  // leaves every retained sample younger than it, which made the condition unreachable.
  const longestWindowMs = Math.max(thresholds.elevatedDwellMs, thresholds.criticalDwellMs);
  const retainMs = longestWindowMs * 2;
  const recent = [...state.recent, [sample.atMs, LEVEL_RANK[rawLevel]] as [number, number]].filter(
    ([atMs]) => sample.atMs - atMs <= retainMs,
  );

  const elevated = dutyCycle(recent, sample.atMs, thresholds.elevatedDwellMs, LEVEL_RANK.elevated);
  const critical = dutyCycle(recent, sample.atMs, thresholds.criticalDwellMs, LEVEL_RANK.critical);

  // A window that is not yet full cannot satisfy a duty cycle: a fresh process would otherwise
  // reach 1.0 off its first two samples and act before it has seen anything.
  const criticalMet = critical.covered && critical.duty >= thresholds.minDutyCycle;
  const elevatedMet = elevated.covered && elevated.duty >= thresholds.minDutyCycle;

  const metLevel: PressureLevel = criticalMet ? "critical" : elevatedMet ? "elevated" : "normal";

  let level = state.level;
  if (LEVEL_RANK[metLevel] > LEVEL_RANK[level]) {
    level = metLevel;
  } else if (level !== "normal" && hasRecovered(sample, thresholds)) {
    level = "normal";
  }

  let wouldAct: PressureAction = "none";
  let suppressedBy: PressureSuppression = null;

  if (rawLevel !== "normal") {
    if (metLevel === "normal") {
      suppressedBy = "dwell";
    } else if (sample.atMs - processStartMs < thresholds.startupGraceMs) {
      suppressedBy = "startup_grace";
    } else if (state.lastActionAtMs !== null && sample.atMs - state.lastActionAtMs < thresholds.minActionIntervalMs) {
      suppressedBy = "rate_limit";
    } else {
      wouldAct = actionFor(metLevel);
    }
  }

  // The action timestamp advances on a recommendation even though nothing is armed, so the rate
  // limit is exercised by the observe-only run rather than first meeting reality when armed.
  const acted = wouldAct !== "none";

  return {
    state: {
      level,
      recent,
      rawLevel,
      lastActionAtMs: acted ? sample.atMs : state.lastActionAtMs,
      lastAction: acted ? wouldAct : state.lastAction,
    },
    verdict: {
      level,
      rawLevel,
      wouldAct,
      suppressedBy,
      elevatedDuty: Math.round(elevated.duty * 1000) / 1000,
      criticalDuty: Math.round(critical.duty * 1000) / 1000,
      windowSpanMs: recent.length > 0 ? sample.atMs - recent[0][0] : 0,
    },
  };
}

export function pressureVerdictFields(verdict: PressureVerdict, armed: boolean): Record<string, number | string> {
  return {
    pressure_level: verdict.level,
    pressure_raw_level: verdict.rawLevel,
    pressure_would_act: verdict.wouldAct,
    pressure_suppressed_by: verdict.suppressedBy ?? "none",
    pressure_elevated_duty: verdict.elevatedDuty,
    pressure_critical_duty: verdict.criticalDuty,
    pressure_window_span_ms: verdict.windowSpanMs,
    pressure_armed: armed ? 1 : 0,
  };
}
