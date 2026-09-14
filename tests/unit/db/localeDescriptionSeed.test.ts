import { describe, expect, it } from "bun:test";
import { buildModelSeedStatements } from "@/db/seed/catalog/modelSeed";
import { buildNaiPresetSeedStatements } from "@/db/seed/catalog/naiSeed";
import { buildSystemPromptSeedStatements } from "@/db/seed/catalog/systemPromptSeed";

describe("locale description catalog writes", () => {
  it("writes JSONB and refreshes it on conflict for all six tables", () => {
    const statements = [
      ...buildModelSeedStatements(),
      ...buildNaiPresetSeedStatements(),
      ...buildSystemPromptSeedStatements().filter((statement) => statement.startsWith("INSERT")),
    ];
    expect(statements.length).toBeGreaterThanOrEqual(6);
    for (const statement of statements) {
      expect(statement).toContain("descriptions");
      expect(statement).toContain("::jsonb");
      expect(statement).toContain('"en-US"');
      expect(statement).toContain('"ja"');
      expect(statement).toContain("descriptions = EXCLUDED.descriptions");
    }
  });
});
