import { describe, expect, it } from "bun:test";
import { parseDatabaseSecrets } from "@/utils/db/databaseSecrets";

describe("database-only lifecycle secrets", () => {
  it("accepts the PostgreSQL fields without application credentials", () => {
    expect(
      parseDatabaseSecrets({
        POSTGRES_HOST: "database.example.com",
        POSTGRES_PORT: 5432,
        POSTGRES_USER: "migration_admin",
        POSTGRES_PASSWORD: "unique-password",
        POSTGRES_DB: "tomodb",
      }),
    ).toEqual({
      POSTGRES_HOST: "database.example.com",
      POSTGRES_PORT: "5432",
      POSTGRES_USER: "migration_admin",
      POSTGRES_PASSWORD: "unique-password",
      POSTGRES_DB: "tomodb",
    });
  });

  it("rejects a missing PostgreSQL field", () => {
    expect(() =>
      parseDatabaseSecrets({
        POSTGRES_HOST: "database.example.com",
        POSTGRES_PORT: "5432",
        POSTGRES_USER: "migration_admin",
        POSTGRES_PASSWORD: "unique-password",
      }),
    ).toThrow("POSTGRES_DB");
  });

  it("rejects an invalid PostgreSQL port", () => {
    expect(() =>
      parseDatabaseSecrets({
        POSTGRES_HOST: "database.example.com",
        POSTGRES_PORT: "not-a-port",
        POSTGRES_USER: "migration_admin",
        POSTGRES_PASSWORD: "unique-password",
        POSTGRES_DB: "tomodb",
      }),
    ).toThrow("POSTGRES_PORT");
  });

  it("rejects non-string credentials", () => {
    expect(() =>
      parseDatabaseSecrets({
        POSTGRES_HOST: "database.example.com",
        POSTGRES_PORT: "5432",
        POSTGRES_USER: "migration_admin",
        POSTGRES_PASSWORD: 12345,
        POSTGRES_DB: "tomodb",
      }),
    ).toThrow("POSTGRES_PASSWORD");
  });
});
