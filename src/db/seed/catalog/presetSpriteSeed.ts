// Seeds official preset sprites (src/db/seed/catalog/personas/{name}/sprites/*)
// into the shared `preset_sprites` table. Each image is uploaded ONCE to the
// immutable `presets/` storage prefix; pointer personas across every server then
// resolve it live by (preset_lineage_id, preset_language). See
// docs/subsystems/persona-presets.md.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SQL } from "bun";
import { sql } from "@/utils/db/client";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import {
  normalizePersonaSpriteDisplayName,
  normalizePersonaSpriteInstructions,
  normalizePersonaSpriteKey,
} from "@/utils/persona/sprites";
import { buildPresetSpriteRelativeKey, uploadPresetSpriteToStorage } from "@/utils/storage/avatarStorage";
import { personaSections } from "./personas";
import { resolveSharedPresetAssetReference } from "./presetAssetReference";
import type { PersonaInput, PresetSpriteInput } from "./types";

const CONTENT_HASH_LENGTH = 12;

export type PresetSpriteSeedSummary = {
  presets: number;
  declarations: number;
  seeded: number;
  failed: number;
  removed: number;
};

// Failed uploads remain distinct from seeded keys so the reconcile pass protects stored rows instead of treating them
// as removed.
type SpriteSeedOutcome = { status: "seeded"; spriteKey: string } | { status: "failed" };

// Per-sprite failures are logged and skipped rather than thrown so one bad image never aborts startup, returning
// counts for the caller to report.
export async function seedPersonaSpritesFromCatalog(client: SQL): Promise<PresetSpriteSeedSummary> {
  const personas = personaSections.flatMap((section) => section.rows);
  // Every locale variant of a preset resolves to the same storage key, so without this an art
  // change re-uploads identical bytes once per authored locale.
  const uploadedThisRun = new Map<string, string>();
  const summary: PresetSpriteSeedSummary = { presets: 0, declarations: 0, seeded: 0, failed: 0, removed: 0 };

  for (const persona of personas) {
    // Omitting the field keeps the preset out of the reconcile entirely, which is how a preset
    // that should not manage these rows opts out.
    if (persona.sprites === undefined) {
      continue;
    }

    summary.presets += 1;

    if (persona.sprites.length === 0) {
      // An empty array declares "this preset has no sprites", but the catalog carries no key set to
      // scope a delete to, so there is no way to tell its rows from another preset's. Leave them.
      log.warn(
        `[Preset Sprites] ${persona.name} (${persona.language}) declares an empty sprite set; ` +
          "existing rows are left in place. Omit the sprites field to keep the preset out of the reconcile.",
      );
      continue;
    }

    const seededKeys: string[] = [];
    // Keys the catalog declares but this run could not upload. They stay inside the protected set
    // so a storage outage cannot be read as a catalog removal.
    const unseededKeys: string[] = [];
    for (const sprite of persona.sprites) {
      summary.declarations += 1;
      const outcome = await seedOneSprite(client, persona, sprite, uploadedThisRun);
      if (outcome.status === "seeded") {
        seededKeys.push(outcome.spriteKey);
      } else {
        const declaredKey = normalizePersonaSpriteKey(sprite.name);
        // A name that normalizes to nothing occupies no key in `sprite_key`, so it cannot protect a
        // row and must not be added to the protected set as raw text: an unnormalized value would
        // silently fail every comparison it takes part in.
        if (declaredKey) {
          unseededKeys.push(declaredKey);
        }
      }
    }

    summary.seeded += seededKeys.length;
    summary.failed += unseededKeys.length;
    summary.removed += await reconcileRemovedSprites(
      client,
      { lineageId: persona.lineageId, language: persona.language, personaName: persona.name },
      [...seededKeys, ...unseededKeys],
      seededKeys.length > 0,
    );
  }

  if (summary.declarations > 0 && summary.seeded === 0) {
    // Every declaration failed, so the reconcile pass skipped every variant and no row was removed.
    // Whether the cause is storage or an unusable catalog, the run must not look like a clean boot.
    await log.error(
      `[Preset Sprites] Seeded 0 of ${summary.declarations} sprite declarations across ${summary.presets} preset variants. ` +
        "No rows were removed; the upload path or the catalog images are unavailable.",
      undefined,
      { errorType: "PresetSpriteSeedEmpty" },
    );
  } else if (summary.failed > 0) {
    // Some declarations failed, so those variants reconciled without the missing keys. The stored
    // rows survive, and this run's success line would otherwise read as fully clean.
    log.warn(
      `[Preset Sprites] ${summary.failed} of ${summary.declarations} sprite declarations failed; ` +
        "their stored rows were preserved and the remaining keys were reconciled.",
    );
  }

  return summary;
}

async function seedOneSprite(
  client: SQL,
  persona: PersonaInput,
  sprite: PresetSpriteInput,
  uploadedThisRun: Map<string, string>,
): Promise<SpriteSeedOutcome> {
  const displayName = normalizePersonaSpriteDisplayName(sprite.name);
  const spriteKey = normalizePersonaSpriteKey(sprite.name);
  if (!displayName || !spriteKey) {
    log.warn(`[Preset Sprites] Skipping ${persona.name}: invalid sprite name "${sprite.name}"`);
    return { status: "failed" };
  }

  const usageInstructions = normalizePersonaSpriteInstructions(sprite.usageInstructions);
  const isIdentity = sprite.isIdentity === true;

  const imagePath = path.join(process.cwd(), persona.avatarPath, sprite.file);
  let pngBuffer: Buffer;
  try {
    const rawBuffer = await readFile(imagePath);
    pngBuffer = await convertToPNG(rawBuffer);
  } catch (error) {
    log.warn(`[Preset Sprites] Skipping ${persona.name}/${sprite.name}: cannot read/convert ${imagePath}`, error);
    return { status: "failed" };
  }

  const contentHash = createHash("sha1").update(pngBuffer).digest("hex").slice(0, CONTENT_HASH_LENGTH);
  const expectedKey = buildPresetSpriteRelativeKey({ lineageId: persona.lineageId, spriteKey, contentHash });

  const [existing] = await client<Array<{ avatar_url: string }>>`
    SELECT avatar_url
    FROM preset_sprites
    WHERE preset_lineage_id = ${persona.lineageId}
      AND preset_language = ${persona.language}
      AND sprite_key = ${spriteKey}
    LIMIT 1
  `;

  const avatarUrl = await resolveSharedPresetAssetReference({
    expectedKey,
    existingReference: existing?.avatar_url ?? null,
    uploadedThisRun,
    upload: () =>
      uploadPresetSpriteToStorage({
        lineageId: persona.lineageId,
        spriteKey,
        contentHash,
        buffer: pngBuffer,
      }),
    logFailure: (error) => {
      const message = `[Preset Sprites] Skipping ${persona.name}/${sprite.name}: image upload failed`;
      if (error) {
        log.warn(message, error);
      } else {
        log.warn(message);
      }
    },
  });
  if (!avatarUrl) {
    return { status: "failed" };
  }

  await client`
    INSERT INTO preset_sprites (
      preset_lineage_id, preset_language, sprite_name, sprite_key, avatar_url, usage_instructions, is_identity
    )
    VALUES (
      ${persona.lineageId},
      ${persona.language},
      ${displayName},
      ${spriteKey},
      ${avatarUrl},
      ${usageInstructions},
      ${isIdentity}
    )
    ON CONFLICT (preset_lineage_id, preset_language, sprite_key) DO UPDATE
    SET
      sprite_name = EXCLUDED.sprite_name,
      avatar_url = EXCLUDED.avatar_url,
      usage_instructions = EXCLUDED.usage_instructions,
      is_identity = EXCLUDED.is_identity,
      updated_at = NOW()
  `;

  return { status: "seeded", spriteKey };
}

// Only DB rows are deleted because shared storage images are immutable, and seededAny plus full catalogKeys prevent
// mass failures from wiping rows.
export async function reconcileRemovedSprites(
  client: SQL,
  scope: { lineageId: number; language: string; personaName: string },
  catalogKeys: readonly string[],
  seededAny: boolean,
): Promise<number> {
  if (!seededAny) {
    // A storage or asset outage cannot be told apart from a catalog that genuinely dropped every
    // key, so this is the branch that decides in favor of the rows.
    log.warn(
      `[Preset Sprites] ${scope.personaName} (${scope.language}) seeded none of ${catalogKeys.length} ` +
        "declared sprite keys; stored rows preserved instead of reconciled.",
    );
    return 0;
  }

  const removed = await client<Array<{ sprite_key: string }>>`
    DELETE FROM preset_sprites
    WHERE preset_lineage_id = ${scope.lineageId}
      AND preset_language = ${scope.language}
      AND NOT (sprite_key = ANY(${sql.array([...catalogKeys], "text")}))
    RETURNING sprite_key
  `;

  return removed.length;
}
