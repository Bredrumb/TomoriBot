/**
 * Seed catalog invariant check.
 *
 * Validates src/db/seed/catalog/*.ts WITHOUT touching the database. The same
 * checks run at startup in the catalog seeders; this script lets CI /
 * pre-commit catch malformed seed data before it reaches a running bot.
 *
 * Exits non-zero if any invariant is violated.
 *
 * Usage:
 *   bun run check-models
 *   bun run scripts/checks/checkModelCatalog.ts
 */
import { readFileSync } from "node:fs";
import { validateNaiPresets } from "../../src/db/seed/catalog/naiSeed";
import { validatePersonas } from "../../src/db/seed/catalog/personaSeed";
import { validateModels } from "../../src/db/seed/catalog/modelSeed";
import { validateSystemPrompts } from "../../src/db/seed/catalog/systemPromptSeed";

function validateStartupSeedOrder(): string[] {
  const errors: string[] = [];
  const initializeDatabaseSource = readFileSync(
    new URL("../../src/utils/db/initializeDatabase.ts", import.meta.url),
    "utf8",
  );
  const expectedCalls = [
    "await seedModelsFromCatalog(client);",
    "await seedPersonasFromCatalog(client);",
    "await seedSystemPromptsFromCatalog(client);",
    "await seedNaiPresetsFromCatalog(client);",
  ];

  let previousIndex = -1;
  for (const call of expectedCalls) {
    const index = initializeDatabaseSource.indexOf(call);
    if (index === -1) {
      errors.push(`initializeDatabase: missing startup seed call ${call}`);
      continue;
    }
    if (index < previousIndex) {
      errors.push("initializeDatabase: startup seed calls must run models → personas → system prompts → NAI presets");
      break;
    }
    previousIndex = index;
  }

  if (initializeDatabaseSource.includes("executeSqlDirectory(")) {
    errors.push("initializeDatabase: SQL seed-directory loading should stay removed; seed catalogs own startup seeding");
  }

  return errors;
}

const violations = [
  ...validateModels(),
  ...validatePersonas(),
  ...validateSystemPrompts(),
  ...validateNaiPresets(),
  ...validateStartupSeedOrder(),
];

if (violations.length > 0) {
  console.error("[check-models] seed catalog invariant violations:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("[check-models] seed catalogs OK");
