import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { getRagAvailabilityState, resetRagAvailabilityCache } from "@/utils/db/ragAvailability";

const realClient = await import("@/utils/db/client");

const stubSql = Object.assign(
  async (strings: TemplateStringsArray) =>
    strings.join("").includes("pg_available_extensions") ? [{ available: true }] : [{}],
  { end: async () => undefined },
);

describe("initDatabase with schema management disabled", () => {
  const previous = process.env.DATABASE_SCHEMA_MANAGEMENT_ENABLED;

  beforeEach(() => {
    process.env.DATABASE_SCHEMA_MANAGEMENT_ENABLED = "false";
    resetRagAvailabilityCache();
    mock.module("@/utils/db/client", () => ({ ...realClient, sql: stubSql }));
  });

  afterEach(() => {
    mock.module("@/utils/db/client", () => realClient);
    resetRagAvailabilityCache();
    if (previous === undefined) delete process.env.DATABASE_SCHEMA_MANAGEMENT_ENABLED;
    else process.env.DATABASE_SCHEMA_MANAGEMENT_ENABLED = previous;
  });

  it("settles pgvector availability at boot so RAG is not gated until the monitor's first tick", async () => {
    const { initDatabase } = await import("@/init/database");

    await initDatabase("production");

    expect(getRagAvailabilityState()).toBe(true);
  });
});
