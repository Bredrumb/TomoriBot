// Seeds official preset avatars (the image at each persona's `avatarPath`) into
// the shared `presets/` storage prefix and records the resulting URL + content
// hash on `persona_presets`. Pointer ALTER personas then live-resolve this
// shared avatar by (preset_lineage_id, preset_language), and the main-avatar
// fan-out reconciler uses the hash to gate Discord guild-avatar PATCHes.
//
// This is the avatar analogue of presetSpriteSeed.ts: same content-addressed,
// upload-once, idempotent model. See docs/subsystems/persona-presets.md.

import { createHash } from "node:crypto";
import type { SQL } from "bun";
import { resolveAvatarPath } from "@/utils/image/avatarHelper";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import { buildPresetAvatarRelativeKey, uploadPresetAvatarToStorage } from "@/utils/storage/avatarStorage";
import { personaSections } from "./personas";
import type { PersonaInput } from "./types";

/** Length of the content hash embedded in shared avatar filenames + version token. */
const CONTENT_HASH_LENGTH = 12;

/**
 * Seeds every catalog persona's avatar into shared storage, uploading each image
 * once and stamping `preset_avatar_shared_url` + `preset_avatar_hash` on the
 * matching `persona_presets` row. Never throws, because a failed image is logged and
 * skipped so a single bad asset cannot abort startup.
 *
 * @param client - Active DB client/transaction
 */
export async function seedPersonaAvatarsFromCatalog(client: SQL): Promise<void> {
  const personas = personaSections.flatMap((section) => section.rows);
  // Every locale variant of a preset resolves to the same storage key, so without this an art
  // change re-uploads identical bytes once per authored locale.
  const uploadedThisRun = new Map<string, string>();
  for (const persona of personas) {
    await seedOneAvatar(client, persona, uploadedThisRun);
  }
}

/**
 * Seeds a single preset avatar: reads + normalizes the image, uploads it only
 * when its content changed (content-addressed filename), and stamps the shared
 * URL + hash onto the preset row.
 */
async function seedOneAvatar(client: SQL, persona: PersonaInput, uploadedThisRun: Map<string, string>): Promise<void> {
  // Read + normalize the persona's avatar image to PNG. `avatarPath` is the
  //    persona's catalog directory; resolveAvatarPath picks the first image in it.
  let pngBuffer: Buffer;
  try {
    const rawBuffer = await resolveAvatarPath(persona.avatarPath);
    pngBuffer = await convertToPNG(rawBuffer);
  } catch (error) {
    log.warn(`[Preset Avatars] Skipping ${persona.name}: cannot read/convert avatar at ${persona.avatarPath}`, error);
    return;
  }

  // Compared against the whole relative key, not the filename: a row written under the retired
  // per-language key ends with the same filename, so a suffix test would pin it to its old path.
  const contentHash = createHash("sha1").update(pngBuffer).digest("hex").slice(0, CONTENT_HASH_LENGTH);
  const expectedKey = buildPresetAvatarRelativeKey({ lineageId: persona.lineageId, contentHash });

  const [existing] = await client<Array<{ preset_avatar_shared_url: string | null }>>`
    SELECT preset_avatar_shared_url
    FROM persona_presets
    WHERE preset_lineage_id = ${persona.lineageId}
      AND preset_language = ${persona.language}
    LIMIT 1
  `;

  const existingUrl = existing?.preset_avatar_shared_url ?? null;
  let sharedUrl: string;
  if (existingUrl?.endsWith(expectedKey)) {
    // Same content already uploaded, so skip the (network) upload, refresh metadata only.
    sharedUrl = existingUrl;
  } else {
    const alreadyUploaded = uploadedThisRun.get(expectedKey);
    const uploadedUrl =
      alreadyUploaded ??
      (await uploadPresetAvatarToStorage({
        lineageId: persona.lineageId,
        contentHash,
        buffer: pngBuffer,
      }));
    if (!uploadedUrl) {
      log.warn(`[Preset Avatars] Skipping ${persona.name}: avatar upload failed`);
      return;
    }
    uploadedThisRun.set(expectedKey, uploadedUrl);
    sharedUrl = uploadedUrl;
  }

  // Stamp the shared URL + version hash onto the preset row. The hash is the
  //    fan-out gate: a changed avatar yields a new hash, so the reconciler
  //    re-PATCHes only the servers that have not yet received it.
  await client`
    UPDATE persona_presets
    SET
      preset_avatar_shared_url = ${sharedUrl},
      preset_avatar_hash = ${contentHash}
    WHERE preset_lineage_id = ${persona.lineageId}
      AND preset_language = ${persona.language}
  `;
}
