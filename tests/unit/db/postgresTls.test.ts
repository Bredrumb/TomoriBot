import { describe, expect, it } from "bun:test";
import { resolveProductionPostgresTls } from "@/utils/db/client";

describe("production PostgreSQL TLS trust", () => {
  it("uses the operating-system trust store for Azure PostgreSQL", () => {
    const tls = resolveProductionPostgresTls("tomoribot-postgres.postgres.database.azure.com", "");

    expect(tls).toEqual({ rejectUnauthorized: true });
    expect(tls.ca).toBeUndefined();
  });

  it("fails closed when an explicitly configured CA bundle is missing", () => {
    expect(() =>
      resolveProductionPostgresTls("database.example.com", "C:/definitely-missing/tomoribot-postgres-ca.pem"),
    ).toThrow("Configured PostgreSQL CA bundle was not found");
  });
});
