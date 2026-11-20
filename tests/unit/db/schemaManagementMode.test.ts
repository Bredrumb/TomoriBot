import { describe, expect, it } from "bun:test";
import { isDatabaseSchemaManagementEnabled } from "@/init/database";

describe("database schema management mode", () => {
  it("preserves schema initialization by default for self-hosted deployments", () => {
    expect(isDatabaseSchemaManagementEnabled(undefined)).toBe(true);
  });

  it("disables runtime DDL for the Azure application container", () => {
    expect(isDatabaseSchemaManagementEnabled("false")).toBe(false);
    expect(isDatabaseSchemaManagementEnabled("0")).toBe(false);
  });
});
