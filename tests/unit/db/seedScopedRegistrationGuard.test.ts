import { describe, expect, it } from "bun:test";
import { buildModelSeedStatements } from "@/db/seed/catalog/modelSeed";

// Locks in the scoped-registration protection on the per-boot catalog reseed.
//
// Each model table's `ON CONFLICT ... DO UPDATE` must carry a WHERE guard that
// skips rows a scope has promoted to a scoped OpenRouter registration
// (is_scoped_registration = true). Without it, the reseed would reset
// is_scoped_registration = false and re-apply is_deprecated on every restart,
// silently reverting a user's deprecated-model registration. See
// docs/subsystems/database-schema.md (OpenRouter scoped registrations).

describe("model seed scoped-registration guard", () => {
  // Map each backing table to the guard clause its ON CONFLICT must contain.
  const expectedGuards: Record<string, string> = {
    llms: "WHERE COALESCE(llms.is_scoped_registration, false) = false",
    image_diffusion_models: "WHERE COALESCE(image_diffusion_models.is_scoped_registration, false) = false",
    video_generation_models: "WHERE COALESCE(video_generation_models.is_scoped_registration, false) = false",
    embedding_models: "WHERE COALESCE(embedding_models.is_scoped_registration, false) = false",
  };

  const statements = buildModelSeedStatements();

  it("guards every backing model table's upsert", () => {
    for (const [table, guard] of Object.entries(expectedGuards)) {
      // Find the statement targeting this table.
      const statement = statements.find((s) => s.startsWith(`INSERT INTO ${table} `));
      expect(statement, `no seed statement for table ${table}`).toBeDefined();

      // It must promote on conflict AND only touch curated (non-scoped) rows.
      expect(statement).toContain("ON CONFLICT");
      expect(statement).toContain(guard);
    }
  });

  it("never resets is_scoped_registration without the guard", () => {
    // The dangerous combination is `is_scoped_registration = false` in the SET
    // clause without the WHERE guard that confines it to curated rows. If any
    // statement clears the flag, it must also carry its guard.
    for (const statement of statements) {
      if (statement.includes("is_scoped_registration = false")) {
        expect(statement).toContain("WHERE COALESCE(");
        expect(statement).toContain("is_scoped_registration, false) = false");
      }
    }
  });
});
