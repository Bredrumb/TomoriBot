import type { SQL } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import {
  detectRagAvailability,
  getRagAvailabilityState,
  isRagAvailable,
  probeRagUsable,
  resetRagAvailabilityCache,
} from "@/utils/db/ragAvailability";

/**
 * Minimal stand-in for the tagged-template call the probe makes. Passing a client other
 * than the module's own `sql` also keeps the process-wide cache untouched, so these cases
 * cannot bleed into one another.
 */
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
  // The re-probe only ever runs when startup detection failed, which is also the run where
  // `initializeDatabase` skipped creating the RAG schema. Reporting usable on the extension
  // alone would hand document commands a database with no `document_chunks` table.
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
  // Reading the gate must never touch the database: it sits on the per-chat-turn context
  // build, so any I/O here becomes a Postgres round-trip per message. `ragAvailabilityMonitor`
  // owns recovery instead.
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
