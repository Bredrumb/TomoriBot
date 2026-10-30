import { createHash } from "node:crypto";
import path from "node:path";
import type { SQL } from "bun";
import { resolveAvatarPath } from "@/utils/image/avatarHelper";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import {
  buildPresetCharacterReferenceRelativeKey,
  uploadPresetCharacterReferenceToStorage,
} from "@/utils/storage/avatarStorage";
import { personaSections } from "./personas";
import { resolveSharedPresetAssetReference } from "./presetAssetReference";
import type { PersonaInput } from "./types";

/** Same hash length as the preset avatar seed, so both filenames read alike in storage. */
const CONTENT_HASH_LENGTH = 12;

/**
 * Seeds every catalog persona's character reference into shared storage and stamps
 * `preset_char_ref_shared_url` on its preset row. A persona without one is cleared, so removing the
 * declaration also removes it from pointer personas. Never throws, so one bad image cannot abort startup.
 */
export async function seedPersonaCharacterReferencesFromCatalog(
  client: SQL,
): Promise<{ declarations: number; seeded: number; failed: number }> {
  const personas = personaSections.flatMap((section) => section.rows);
  const uploadedThisRun = new Map<string, string>();
  let declarations = 0;
  let seeded = 0;
  for (const persona of personas) {
    if (!persona.characterReference) {
      await client`
        UPDATE persona_presets
        SET preset_char_ref_shared_url = NULL
        WHERE preset_lineage_id = ${persona.lineageId}
          AND preset_language = ${persona.language}
          AND preset_char_ref_shared_url IS NOT NULL
      `;
      continue;
    }
    declarations += 1;
    if (await seedOneCharacterReference(client, persona, persona.characterReference, uploadedThisRun)) seeded += 1;
  }
  return { declarations, seeded, failed: declarations - seeded };
}

async function seedOneCharacterReference(
  client: SQL,
  persona: PersonaInput,
  file: string,
  uploadedThisRun: Map<string, string>,
): Promise<boolean> {
  const imagePath = path.posix.join(persona.avatarPath, file);
  let pngBuffer: Buffer;
  try {
    pngBuffer = await convertToPNG(await resolveAvatarPath(imagePath));
  } catch (error) {
    log.warn(`[Preset Character References] Skipping ${persona.name}: cannot read/convert ${imagePath}`, error);
    return false;
  }

  const contentHash = createHash("sha1").update(pngBuffer).digest("hex").slice(0, CONTENT_HASH_LENGTH);
  const [existing] = await client<Array<{ preset_char_ref_shared_url: string | null }>>`
    SELECT preset_char_ref_shared_url
    FROM persona_presets
    WHERE preset_lineage_id = ${persona.lineageId}
      AND preset_language = ${persona.language}
    LIMIT 1
  `;

  const sharedUrl = await resolveSharedPresetAssetReference({
    expectedKey: buildPresetCharacterReferenceRelativeKey({ lineageId: persona.lineageId, contentHash }),
    existingReference: existing?.preset_char_ref_shared_url ?? null,
    uploadedThisRun,
    upload: () =>
      uploadPresetCharacterReferenceToStorage({ lineageId: persona.lineageId, contentHash, buffer: pngBuffer }),
    logFailure: (error) => {
      const message = `[Preset Character References] Skipping ${persona.name}: upload failed`;
      if (error) {
        log.warn(message, error);
      } else {
        log.warn(message);
      }
    },
  });
  if (!sharedUrl) {
    return false;
  }

  const updated = await client`
    UPDATE persona_presets
    SET preset_char_ref_shared_url = ${sharedUrl}
    WHERE preset_lineage_id = ${persona.lineageId}
      AND preset_language = ${persona.language}
    RETURNING persona_preset_id
  `;
  return updated.length > 0;
}
