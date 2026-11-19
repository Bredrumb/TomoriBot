import JSZip from "jszip";
import { z } from "zod";
import type { PersonaSpriteRow } from "@/types/db/schema";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";
import { log } from "@/utils/misc/logger";
import { getDeclaredUncompressedSize, resolveZipEntryFile } from "@/utils/zip/zipEntryGuards";

const SPRITE_ARCHIVE_VERSION = 1;
const SPRITE_ARCHIVE_EXPORT_TYPE = "persona_sprites";
const SPRITE_ARCHIVE_MANIFEST_NAME = "manifest.json";
const SPRITE_ARCHIVE_IMAGE_DIR = "sprites";

// DB ids and storage references are intentionally excluded from exported sprite entries because they are meaningless
// on another server.
const spriteArchiveEntrySchema = z.object({
  sprite_name: z.string().min(1).max(64),
  sprite_key: z.string().min(1).max(64),
  usage_instructions: z.string().max(1000).default(""),
  is_identity: z.boolean().default(false),
  file: z.string().min(1).max(256),
});

type SpriteArchiveEntry = z.infer<typeof spriteArchiveEntrySchema>;

const spriteArchiveManifestSchema = z.object({
  export_type: z.literal(SPRITE_ARCHIVE_EXPORT_TYPE),
  version: z.number().int().positive(),
  exported_at: z.string().optional(),
  // Source persona is informational only (display + suggested filename); the
  // importer always picks an explicit target persona, so this is never trusted.
  source_persona: z
    .object({
      nickname: z.string().optional(),
      persona_id: z.number().int().optional(),
    })
    .optional(),
  sprites: z.array(spriteArchiveEntrySchema),
});

type SpriteArchiveManifest = z.infer<typeof spriteArchiveManifestSchema>;

export type BuiltSpriteArchive = {
  buffer: Buffer;
  spriteCount: number;
};

export type SpriteArchiveBuildEntry = {
  sprite: PersonaSpriteRow;
  pngBuffer: Buffer;
};

export type SpriteArchiveReadLimits = {
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

type SpriteArchiveReadEntry = {
  meta: SpriteArchiveEntry;
  pngBuffer: Buffer;
};

export type SpriteArchiveReadResult =
  | {
      ok: true;
      sourceNickname: string | null;
      entries: SpriteArchiveReadEntry[];
    }
  | {
      ok: false;
      reason:
        | "invalid_zip"
        | "missing_manifest"
        | "invalid_manifest"
        | "incompatible_version"
        | "empty"
        | "too_many_entries"
        | "missing_image"
        | "file_too_large"
        | "total_too_large";
    };

export async function buildSpriteArchive(options: {
  personaNickname: string;
  personaId: number;
  entries: SpriteArchiveBuildEntry[];
}): Promise<BuiltSpriteArchive> {
  const zip = new JSZip();
  const imageFolder = zip.folder(SPRITE_ARCHIVE_IMAGE_DIR);
  if (!imageFolder) {
    // JSZip.folder only returns null on an invalid name; our constant is valid,
    // so this is effectively unreachable but typed defensively.
    throw new Error("Failed to create sprite image folder in archive");
  }

  const manifestEntries: SpriteArchiveEntry[] = [];
  const usedFilenames = new Set<string>();
  options.entries.forEach((entry, index) => {
    const filename = buildUniqueImageFilename(entry.sprite, index, usedFilenames);
    imageFolder.file(filename, entry.pngBuffer);
    manifestEntries.push({
      sprite_name: entry.sprite.sprite_name,
      sprite_key: entry.sprite.sprite_key,
      usage_instructions: entry.sprite.usage_instructions ?? "",
      is_identity: entry.sprite.is_identity ?? false,
      file: `${SPRITE_ARCHIVE_IMAGE_DIR}/${filename}`,
    });
  });

  const manifest: SpriteArchiveManifest = {
    export_type: SPRITE_ARCHIVE_EXPORT_TYPE,
    version: SPRITE_ARCHIVE_VERSION,
    exported_at: new Date().toISOString(),
    source_persona: {
      nickname: options.personaNickname,
      persona_id: options.personaId,
    },
    sprites: manifestEntries,
  };
  zip.file(SPRITE_ARCHIVE_MANIFEST_NAME, `${JSON.stringify(manifest, null, 2)}\n`);

  // Generate the bytes. DEFLATE is cheap here (PNGs are already compressed,
  //    but the manifest and any incidental redundancy still benefit).
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  return {
    buffer: buffer as Buffer,
    spriteCount: manifestEntries.length,
  };
}

export async function readSpriteArchive(
  zipBuffer: Buffer,
  limits: SpriteArchiveReadLimits,
): Promise<SpriteArchiveReadResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (error) {
    log.warn("Failed to load sprite archive zip", error);
    return { ok: false, reason: "invalid_zip" };
  }

  // Locate the manifest (case-insensitive, ignoring any folder prefix some
  //    archivers add) and parse it as JSON.
  const manifestFile = findManifestFile(zip);
  if (!manifestFile) {
    return { ok: false, reason: "missing_manifest" };
  }
  const maxManifestBytes = 4096 + limits.maxEntries * 8192;
  const manifestSize = getDeclaredUncompressedSize(manifestFile);
  if (manifestSize === null || manifestSize > maxManifestBytes) {
    return { ok: false, reason: "invalid_manifest" };
  }

  let manifestJson: unknown;
  try {
    const manifestText = await manifestFile.async("string");
    if (Buffer.byteLength(manifestText, "utf8") > maxManifestBytes) {
      return { ok: false, reason: "invalid_manifest" };
    }
    manifestJson = JSON.parse(manifestText);
  } catch (error) {
    log.warn("Failed to parse sprite archive manifest JSON", error);
    return { ok: false, reason: "invalid_manifest" };
  }

  const parsedManifest = spriteArchiveManifestSchema.safeParse(manifestJson);
  if (!parsedManifest.success) {
    log.warn(`Invalid sprite archive manifest: ${parsedManifest.error.message}`);
    return { ok: false, reason: "invalid_manifest" };
  }
  const manifest = parsedManifest.data;

  // Reject archives produced by a newer, incompatible format version.
  if (manifest.version > SPRITE_ARCHIVE_VERSION) {
    return { ok: false, reason: "incompatible_version" };
  }

  if (manifest.sprites.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (manifest.sprites.length > limits.maxEntries) {
    return { ok: false, reason: "too_many_entries" };
  }

  const entries: SpriteArchiveReadEntry[] = [];
  let totalBytes = 0;
  for (const meta of manifest.sprites) {
    const imageFile = resolveZipEntryFile(zip, meta.file);
    if (!imageFile) {
      return { ok: false, reason: "missing_image" };
    }

    // Best-effort pre-read size check using JSZip's declared uncompressed
    //     size, so an oversized entry is rejected before it is decompressed.
    const declaredSize = getDeclaredUncompressedSize(imageFile);
    if (declaredSize !== null && declaredSize > limits.maxFileBytes) {
      return { ok: false, reason: "file_too_large" };
    }

    const pngBuffer = (await imageFile.async("nodebuffer")) as Buffer;

    if (pngBuffer.length > limits.maxFileBytes) {
      return { ok: false, reason: "file_too_large" };
    }
    totalBytes += pngBuffer.length;
    if (totalBytes > limits.maxTotalBytes) {
      return { ok: false, reason: "total_too_large" };
    }

    entries.push({ meta, pngBuffer });
  }

  return {
    ok: true,
    sourceNickname: manifest.source_persona?.nickname ?? null,
    entries,
  };
}

function buildUniqueImageFilename(sprite: PersonaSpriteRow, index: number, used: Set<string>): string {
  const prefix = String(index + 1).padStart(2, "0");
  const safeKey = sanitizeAttachmentFilenamePart(sprite.sprite_key, {
    fallback: "sprite",
    maxLength: 40,
  });
  let filename = `${prefix}-${safeKey}.png`;
  // Guard against the (rare) case where sanitization collapses two keys to the
  // same string; the index prefix already makes this near-impossible, but stay
  // defensive so no image silently overwrites another.
  let suffix = 1;
  while (used.has(filename)) {
    filename = `${prefix}-${safeKey}-${suffix}.png`;
    suffix += 1;
  }
  used.add(filename);
  return filename;
}

function findManifestFile(zip: JSZip): JSZip.JSZipObject | null {
  return resolveZipEntryFile(zip, SPRITE_ARCHIVE_MANIFEST_NAME);
}
