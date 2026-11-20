import { describe, expect, it } from "bun:test";
import { collectProcessMemorySnapshot, runForcedGc } from "@/utils/misc/processMemory";

describe("runForcedGc", () => {
  it("finds a collector under the Bun runtime", () => {
    // Must not return "unavailable" under Bun: otherwise every `*_delta_clear` metric silently reads zero in
    // production.
    expect(runForcedGc()).toBe("bun");
  });

  it("is safe to call repeatedly", () => {
    expect(() => {
      runForcedGc();
      runForcedGc();
    }).not.toThrow();
  });
});

describe("collectProcessMemorySnapshot", () => {
  it("reports the native partition separately from the JS heap", () => {
    const snapshot = collectProcessMemorySnapshot();

    for (const value of Object.values(snapshot)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }

    expect(snapshot.rssMb).toBeGreaterThan(0);
    // arrayBuffers is the subset of external holding ArrayBuffer-backed allocations, so a
    // snapshot where it exceeds external would mean the fields had been mixed up.
    expect(snapshot.arrayBuffersMb).toBeLessThanOrEqual(snapshot.externalMb);
  });
});
