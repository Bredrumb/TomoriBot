import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as realClient from "@/utils/db/client";
import { getRagAvailabilityState, resetRagAvailabilityCache } from "@/utils/db/ragAvailability";
import { useEnvSandbox } from "../../helpers/env";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

let usable = true;
const stubSql = Object.assign(
  async (strings: TemplateStringsArray) => (strings.join("").includes("usable") ? [{ usable }] : [{}]),
  {
    end: async () => undefined,
  },
);

const scopedMock = createScopedModuleMocker(mock, { "@/utils/db/client": realClient });
scopedMock.module("@/utils/db/client", () => ({ ...realClient, sql: stubSql }));

const { initDatabase } = await import("@/init/database");

useEnvSandbox(["DATABASE_SCHEMA_MANAGEMENT_ENABLED"]);

describe("initDatabase with schema management disabled", () => {
  beforeEach(() => {
    process.env.DATABASE_SCHEMA_MANAGEMENT_ENABLED = "false";
    resetRagAvailabilityCache();
    usable = true;
  });

  it("settles RAG availability at boot instead of waiting for the monitor's first tick", async () => {
    await initDatabase("production");

    expect(getRagAvailabilityState()).toBe(true);
  });

  it("leaves availability undetermined while document_chunks is missing, so the monitor keeps polling", async () => {
    usable = false;

    await initDatabase("production");

    expect(getRagAvailabilityState()).toBeNull();
  });
});
