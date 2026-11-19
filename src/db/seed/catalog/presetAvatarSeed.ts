import { createHash } from "node:crypto";
import type { SQL } from "bun";
import { resolveAvatarPath } from "@/utils/image/avatarHelper";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import { buildPresetAvatarRelativeKey, uploadPresetAvatarToStorage } from "@/utils/storage/avatarStorage";
import { personaSections } from "./personas";
import { resolveSharedPresetAssetReference } from "./presetAssetReference";
import type { PersonaInput } from "./types";

const CONTENT_HASH_LENGTH = 12;

// Failed uploads are logged and skipped instead of throwing because one bad preset avatar must not abort startup.
export async function seedPersonaAvatarsFromCatalog(
  client: SQL,
): Promise<{ declarations: number; seeded: number; failed: number }> {
  const personas = personaSections.flatMap((section) => section.rows);
  const uploadedThisRun = new Map<string, string>();
  let seeded = 0;
  for (const persona of personas) {
    if (await seedOneAvatar(client, persona, uploadedThisRun)) seeded += 1;
  }
  return { declarations: personas.length, seeded, failed: personas.length - seeded };
}

async function seedOneAvatar(
  client: SQL,
  persona: PersonaInput,
  uploadedThisRun: Map<string, string>,
): Promise<boolean> {
  let pngBuffer: Buffer;
  try {
    const rawBuffer = await resolveAvatarPath(persona.avatarPath);
    pngBuffer = await convertToPNG(rawBuffer);
  } catch (error) {
    log.warn(`[Preset Avatars] Skipping ${persona.name}: cannot read/convert avatar at ${persona.avatarPath}`, error);
    return false;
  }

  const contentHash = createHash("sha1").update(pngBuffer).digest("hex").slice(0, CONTENT_HASH_LENGTH);
  const expectedKey = buildPresetAvatarRelativeKey({ lineageId: persona.lineageId, contentHash });

  const [existing] = await client<Array<{ preset_avatar_shared_url: string | null }>>`
    SELECT preset_avatar_shared_url
    FROM persona_presets
    WHERE preset_lineage_id = ${persona.lineageId}
      AND preset_language = ${persona.language}
    LIMIT 1
  `;

  const sharedUrl = await resolveSharedPresetAssetReference({
    expectedKey,
    existingReference: existing?.preset_avatar_shared_url ?? null,
    uploadedThisRun,
    upload: () =>
      uploadPresetAvatarToStorage({
        lineageId: persona.lineageId,
        contentHash,
        buffer: pngBuffer,
      }),
    logFailure: (error) => {
      const message = `[Preset Avatars] Skipping ${persona.name}: avatar upload failed`;
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

  // preset_avatar_hash gates main-avatar fan-out so the reconciler only re-PATCHes servers with a stale hash.
  const updated = await client`
    UPDATE persona_presets
    SET
      preset_avatar_shared_url = ${sharedUrl},
      preset_avatar_hash = ${contentHash}
    WHERE preset_lineage_id = ${persona.lineageId}
      AND preset_language = ${persona.language}
    RETURNING persona_preset_id
  `;
  return updated.length > 0;
}
