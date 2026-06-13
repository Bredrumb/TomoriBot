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
 *   bun run check-seed-catalogs
 *   bun run scripts/checks/checkSeedCatalogs.ts
 */
import { readFileSync } from "node:fs";
import { personaSections } from "../../src/db/seed/catalog/personas";
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
    "await seedPersonaSpritesFromCatalog(client);",
    "await seedPersonaAvatarsFromCatalog(client);",
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

/**
 * Validates catalog-authored preset sprites without touching storage: each
 * sprite needs a non-empty name (<= 64 chars) and image file, and names must be
 * unique within a persona (they collapse to a unique sprite_key at seed time).
 */
function validatePresetSprites(): string[] {
  const errors: string[] = [];
  for (const section of personaSections) {
    for (const persona of section.rows) {
      if (!persona.sprites) {
        continue;
      }
      const seenNames = new Set<string>();
      for (const sprite of persona.sprites) {
        const trimmedName = sprite.name?.trim() ?? "";
        if (trimmedName.length === 0 || trimmedName.length > 64) {
          errors.push(`preset_sprites/${persona.name}: invalid sprite name "${sprite.name}" (1-64 chars)`);
        }
        const nameKey = trimmedName.toLowerCase();
        if (seenNames.has(nameKey)) {
          errors.push(`preset_sprites/${persona.name}: duplicate sprite name "${sprite.name}"`);
        }
        seenNames.add(nameKey);
        if (!sprite.file?.trim()) {
          errors.push(`preset_sprites/${persona.name}/${sprite.name}: missing image file`);
        }
      }
    }
  }
  return errors;
}

const violations = [
  ...validateModels(),
  ...validatePersonas(),
  ...validatePresetSprites(),
  ...validateSystemPrompts(),
  ...validateNaiPresets(),
  ...validateStartupSeedOrder(),
];

if (violations.length > 0) {
  console.error("[check-seed-catalogs] seed catalog invariant violations:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("[check-seed-catalogs] seed catalogs OK");
