// Seeds official preset sprites (src/db/seed/catalog/personas/{name}/sprites/*)
// into the shared `preset_sprites` table. Each image is uploaded ONCE to the
// immutable `presets/` storage prefix; pointer personas across every server then
// resolve it live by (preset_lineage_id, preset_language). See
// docs/subsystems/persona-presets.md.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SQL } from "bun";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import {
  normalizePersonaSpriteDisplayName,
  normalizePersonaSpriteInstructions,
  normalizePersonaSpriteKey,
} from "@/utils/persona/sprites";
import { buildPresetSpriteFilename, uploadPresetSpriteToStorage } from "@/utils/storage/avatarStorage";
import { personaSections } from "./personas";
import type { PersonaInput, PresetSpriteInput } from "./types";

/** Length of the content hash embedded in shared sprite filenames. */
const CONTENT_HASH_LENGTH = 12;

/**
 * Seeds all catalog-authored preset sprites into `preset_sprites`, uploading
 * each image once and reconciling removed sprites. Never throws — a failed image
 * is logged and skipped so a single bad asset cannot abort startup.
 *
 * @param client - Active DB client/transaction
 */
export async function seedPersonaSpritesFromCatalog(client: SQL): Promise<void> {
  const personas = personaSections.flatMap((section) => section.rows);
  for (const persona of personas) {
    // Only personas that explicitly author a sprites array participate. Omitting
    // the field entirely is a no-op; an empty array reconciles to "no sprites".
    if (persona.sprites === undefined) {
      continue;
    }

    const seededKeys: string[] = [];
    for (const sprite of persona.sprites) {
      const spriteKey = await seedOneSprite(client, persona, sprite);
      if (spriteKey) {
        seededKeys.push(spriteKey);
      }
    }

    await reconcileRemovedSprites(client, persona, seededKeys);
  }
}

/**
 * Seeds a single preset sprite: reads + normalizes the image, uploads it only
 * when its content changed (content-addressed filename), and upserts the row.
 *
 * @returns The sprite's lookup key on success, or null when skipped
 */
async function seedOneSprite(client: SQL, persona: PersonaInput, sprite: PresetSpriteInput): Promise<string | null> {
  const displayName = normalizePersonaSpriteDisplayName(sprite.name);
  const spriteKey = normalizePersonaSpriteKey(sprite.name);
  if (!displayName || !spriteKey) {
    log.warn(`[Preset Sprites] Skipping ${persona.name}: invalid sprite name "${sprite.name}"`);
    return null;
  }

  const usageInstructions = normalizePersonaSpriteInstructions(sprite.usageInstructions);
  const isIdentity = sprite.isIdentity === true;

  // 1. Read + normalize the source image to PNG.
  const imagePath = path.join(process.cwd(), persona.avatarPath, sprite.file);
  let pngBuffer: Buffer;
  try {
    const rawBuffer = await readFile(imagePath);
    pngBuffer = await convertToPNG(rawBuffer);
  } catch (error) {
    log.warn(`[Preset Sprites] Skipping ${persona.name}/${sprite.name}: cannot read/convert ${imagePath}`, error);
    return null;
  }

  // 2. Content-address the image. If the existing row already references this
  //    exact content, skip the (network) upload and only refresh metadata.
  const contentHash = createHash("sha1").update(pngBuffer).digest("hex").slice(0, CONTENT_HASH_LENGTH);
  const expectedSuffix = buildPresetSpriteFilename(spriteKey, contentHash);

  const [existing] = await client<Array<{ avatar_url: string }>>`
    SELECT avatar_url
    FROM preset_sprites
    WHERE preset_lineage_id = ${persona.lineageId}
      AND preset_language = ${persona.language}
      AND sprite_key = ${spriteKey}
    LIMIT 1
  `;

  const existingUrl = existing?.avatar_url ?? null;
  let avatarUrl: string;
  if (existingUrl?.endsWith(expectedSuffix)) {
    // Same content already uploaded — skip the (network) upload, refresh metadata only.
    avatarUrl = existingUrl;
  } else {
    const uploadedUrl = await uploadPresetSpriteToStorage({
      lineageId: persona.lineageId,
      language: persona.language,
      spriteKey,
      contentHash,
      buffer: pngBuffer,
    });
    if (!uploadedUrl) {
      log.warn(`[Preset Sprites] Skipping ${persona.name}/${sprite.name}: image upload failed`);
      return null;
    }
    avatarUrl = uploadedUrl;
  }

  // 3. Upsert the row (shared URL + metadata).
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

  return spriteKey;
}

/**
 * Deletes `preset_sprites` rows for a preset whose sprite_key is no longer in the
 * catalog, so removing a sprite from the catalog removes it from pointer personas
 * too. Shared images are left in storage (immutable); only the rows are removed.
 */
async function reconcileRemovedSprites(client: SQL, persona: PersonaInput, seededKeys: string[]): Promise<void> {
  if (seededKeys.length === 0) {
    // Empty/failed set: drop every sprite for this preset.
    await client`
      DELETE FROM preset_sprites
      WHERE preset_lineage_id = ${persona.lineageId}
        AND preset_language = ${persona.language}
    `;
    return;
  }

  await client`
    DELETE FROM preset_sprites
    WHERE preset_lineage_id = ${persona.lineageId}
      AND preset_language = ${persona.language}
      AND NOT (sprite_key = ANY(${seededKeys}))
  `;
}
