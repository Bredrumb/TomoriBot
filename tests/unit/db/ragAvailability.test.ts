import type { SQL } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import {
  detectRagAvailability,
  getRagAvailabilityState,
  isRagAvailable,
  probeRagUsable,
  resetRagAvailabilityCache,
} from "@/utils/db/ragAvailability";

// Passing a custom client rather than the module's default sql keeps the process-wide availability cache untouched so
// test cases do not bleed into each other.
function stubClient(behavior: () => Promise<unknown[]>): SQL {
  return (() => behavior()) as unknown as SQL;
}

afterEach(() => {
  resetRagAvailabilityCache();
});

describe("detectRagAvailability", () => {
  it("reports availability from the probe row", async () => {
    const client = stubClient(async () => [{ available: true }]);

    expect(await detectRagAvailability(client)).toBe(true);
  });

  it("reports unavailable when the extension is absent", async () => {
    const client = stubClient(async () => [{ available: false }]);

    expect(await detectRagAvailability(client)).toBe(false);
  });

  it("degrades to false instead of throwing when the probe cannot reach the server", async () => {
    const client = stubClient(async () => {
      throw Object.assign(new Error("Failed to read data"), { code: "ERR_POSTGRES_INVALID_MESSAGE" });
    });

    expect(await detectRagAvailability(client)).toBe(false);
  });

  it("treats an empty result as unavailable", async () => {
    const client = stubClient(async () => []);

    expect(await detectRagAvailability(client)).toBe(false);
  });
});

describe("probeRagUsable", () => {
  // Startup skips the RAG schema when detection fails, so re-probe must require both extension and document_chunks.
  it("requires both the extension and the RAG schema", async () => {
    expect(await probeRagUsable(stubClient(async () => [{ usable: true }]))).toBe(true);
    expect(await probeRagUsable(stubClient(async () => [{ usable: false }]))).toBe(false);
  });

  it("stays unusable when the re-probe cannot reach the server", async () => {
    const client = stubClient(async () => {
      throw Object.assign(new Error("Failed to read data"), { code: "ERR_POSTGRES_CONNECTION_CLOSED" });
    });

    expect(await probeRagUsable(client)).toBe(false);
  });
});

describe("isRagAvailable", () => {
  // `isRagAvailable` sits on every chat turn, so it must stay I/O-free while `ragAvailabilityMonitor` owns recovery.
  it("is side-effect free while availability is unknown", () => {
    expect(isRagAvailable()).toBe(false);
    expect(getRagAvailabilityState()).toBeNull();
  });

  // An unreachable server and a genuinely absent extension both read as `false` here, but
  // only the former is worth re-probing, which is what the monitor gates on.
  it("separates an undetermined probe from a completed negative", async () => {
    expect(getRagAvailabilityState()).toBeNull();

    await detectRagAvailability(stubClient(async () => [{ available: false }]));
    expect(getRagAvailabilityState()).toBeNull();
  });
});
