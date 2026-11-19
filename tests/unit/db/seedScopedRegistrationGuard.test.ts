import { describe, expect, it } from "bun:test";
import { buildModelSeedStatements } from "@/db/seed/catalog/modelSeed";

// Curated models publish globally over workspace registrations, so only deprecated rows leave scoped ones untouched.

describe("model seed scoped-registration guard", () => {
  const expectedGuards: Record<string, string> = {
    llms: "WHERE COALESCE(llms.is_scoped_registration, false) = false",
    image_diffusion_models: "WHERE COALESCE(image_diffusion_models.is_scoped_registration, false) = false",
    video_generation_models: "WHERE COALESCE(video_generation_models.is_scoped_registration, false) = false",
    embedding_models: "WHERE COALESCE(embedding_models.is_scoped_registration, false) = false",
  };

  const statements = buildModelSeedStatements();

  it("guards every backing model table's upsert", () => {
    for (const [table, guard] of Object.entries(expectedGuards)) {
      const statement = statements.find((s) => s.startsWith(`INSERT INTO ${table} `));
      expect(statement, `no seed statement for table ${table}`).toBeDefined();

      expect(statement).toContain("ON CONFLICT");
      expect(statement).toContain(guard);
      expect(statement).toContain("OR EXCLUDED.is_deprecated = false");
    }
  });

  it("never resets is_scoped_registration without the guard", () => {
    // Clearing `is_scoped_registration` without the curated-row WHERE guard would hijack scoped registrations.
    for (const statement of statements) {
      if (statement.includes("is_scoped_registration = false")) {
        expect(statement).toContain("WHERE COALESCE(");
        expect(statement).toContain("is_scoped_registration, false) = false");
      }
    }
  });
});
