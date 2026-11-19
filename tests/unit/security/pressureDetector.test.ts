import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PRESSURE_THRESHOLDS,
  evaluatePressure,
  initialPressureState,
  type PressureSample,
  type PressureState,
  type PressureThresholds,
  type PressureVerdict,
} from "@/utils/security/pressureDetector";

// Thresholds are stated in full instead of spreading shipped defaults because defaults change over time, which would
// silently alter these tests.
const T: PressureThresholds = {
  elevatedIoFull: 10,
  criticalIoFull: 20,
  recoveryIoFull: 5,
  minSwapInPerS: 1,
  elevatedDwellMs: 10 * 60 * 1000,
  criticalDwellMs: 5 * 60 * 1000,
  minDutyCycle: 0.7,
  startupGraceMs: 15 * 60 * 1000,
  minActionIntervalMs: 6 * 60 * 60 * 1000,
};

const MINUTE = 60 * 1000;

function run(
  samples: Array<Partial<PressureSample>>,
  options: { startOffsetMin?: number; thresholds?: PressureThresholds } = {},
): { verdicts: PressureVerdict[]; state: PressureState } {
  const processStartMs = 0;
  const firstAt = (options.startOffsetMin ?? 60) * MINUTE;
  let state = initialPressureState();
  const verdicts: PressureVerdict[] = [];

  samples.forEach((partial, index) => {
    const sample: PressureSample = {
      atMs: firstAt + index * MINUTE,
      ioFullAvg60: 0,
      swapInPerS: 0,
      ...partial,
    };
    const result = evaluatePressure(state, sample, processStartMs, options.thresholds ?? T);
    state = result.state;
    verdicts.push(result.verdict);
  });

  return { verdicts, state };
}

const stressed = { ioFullAvg60: 15, swapInPerS: 40 };
const severe = { ioFullAvg60: 25, swapInPerS: 90 };
const calm = { ioFullAvg60: 1, swapInPerS: 0 };

describe("evaluatePressure", () => {
  it("does not act on a single critical sample", () => {
    // A naive free-memory threshold acting on one sample has already taken production down once.
    const { verdicts } = run([severe]);

    expect(verdicts[0].rawLevel).toBe("critical");
    expect(verdicts[0].wouldAct).toBe("none");
    expect(verdicts[0].suppressedBy).toBe("dwell");
  });

  it("requires PSI and live swap-in together", () => {
    // Swap depth alone is cold pages evicted once and never touched again, which is harmless.
    const { verdicts } = run([{ ioFullAvg60: 30, swapInPerS: 0 }]);

    expect(verdicts[0].rawLevel).toBe("normal");
    expect(verdicts[0].wouldAct).toBe("none");
  });

  it("recommends the cheap rung first once the dwell is satisfied", () => {
    const { verdicts } = run(Array(12).fill(stressed));
    const acted = verdicts.filter((v) => v.wouldAct !== "none");

    expect(acted.length).toBeGreaterThan(0);
    expect(acted[0].wouldAct).toBe("recycle_cotenants");
  });

  it("escalates to recycling the bot under sustained critical pressure", () => {
    const { verdicts } = run(Array(8).fill(severe));
    const acted = verdicts.filter((v) => v.wouldAct !== "none");

    expect(acted[0].wouldAct).toBe("recycle_bot");
  });

  it("tolerates dips without losing accumulated pressure", () => {
    // Real io_full incidents cross thresholds intermittently, so one calm sample in twelve must not reset the
    // dwell window.
    const dippy = [...Array(6).fill(stressed), calm, ...Array(6).fill(stressed)];
    const { verdicts } = run(dippy);

    expect(verdicts.at(-1)?.elevatedDuty).toBeGreaterThan(0.7);
    expect(verdicts.some((v) => v.wouldAct !== "none")).toBe(true);
  });

  it("does not act when the pressure is a minority of the window", () => {
    const alternating = Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? stressed : calm));
    const { verdicts } = run(alternating);

    expect(verdicts.every((v) => v.wouldAct === "none")).toBe(true);
  });

  it("cannot act before the window is actually full", () => {
    // A fresh process reaches a duty of 1.0 on its first two samples; acting on that would restart
    // the container on the strength of two readings.
    const { verdicts } = run(Array(4).fill(severe));

    expect(verdicts.every((v) => v.wouldAct === "none")).toBe(true);
    expect(verdicts.at(-1)?.suppressedBy).toBe("dwell");
  });

  it("suppresses during the startup grace period", () => {
    // The normal warm-up working set is reached within ten minutes, and treating that as an
    // incident is how a threshold turns a healthy boot into a restart loop.
    const { verdicts } = run(Array(8).fill(severe), { startOffsetMin: 0 });

    expect(verdicts.some((v) => v.rawLevel === "critical")).toBe(true);
    expect(verdicts.every((v) => v.wouldAct === "none")).toBe(true);
    expect(verdicts.at(-1)?.suppressedBy).toBe("startup_grace");
  });

  it("rate limits repeat recommendations", () => {
    const { verdicts } = run(Array(40).fill(severe));
    const acted = verdicts.filter((v) => v.wouldAct !== "none");

    expect(acted).toHaveLength(1);
    expect(verdicts.at(-1)?.suppressedBy).toBe("rate_limit");
  });

  it("holds the level until the separate recovery threshold is met", () => {
    // Hysteresis: a host sitting between the recovery and entry thresholds must not oscillate.
    const between = { ioFullAvg60: 8, swapInPerS: 0 };
    const { verdicts } = run([...Array(12).fill(stressed), between, between]);

    expect(verdicts.at(-1)?.level).toBe("elevated");

    const { verdicts: recovered } = run([...Array(12).fill(stressed), calm]);
    expect(recovered.at(-1)?.level).toBe("normal");
  });

  it("reports normal when the host fields are absent", () => {
    // Off Linux every source is missing, and an absent reading is not evidence of pressure.
    const { verdicts } = run([{ ioFullAvg60: undefined, swapInPerS: undefined }]);

    expect(verdicts[0].rawLevel).toBe("normal");
    expect(verdicts[0].wouldAct).toBe("none");
  });
});

describe("DEFAULT_PRESSURE_THRESHOLDS", () => {
  it("keeps the recovery threshold below the elevated one", () => {
    // Hysteresis only exists if these differ; equal values reintroduce the oscillation the
    // separate recovery threshold was added to prevent.
    expect(DEFAULT_PRESSURE_THRESHOLDS.recoveryIoFull).toBeLessThan(DEFAULT_PRESSURE_THRESHOLDS.elevatedIoFull);
    expect(DEFAULT_PRESSURE_THRESHOLDS.elevatedIoFull).toBeLessThan(DEFAULT_PRESSURE_THRESHOLDS.criticalIoFull);
  });

  it("ships a duty cycle that a chronically degraded host cannot satisfy by baseline alone", () => {
    // A chronically degraded baseline satisfies 0.7 duty, so minDutyCycle must stay at or above 0.9.
    expect(DEFAULT_PRESSURE_THRESHOLDS.minDutyCycle).toBeGreaterThanOrEqual(0.9);
  });
});
