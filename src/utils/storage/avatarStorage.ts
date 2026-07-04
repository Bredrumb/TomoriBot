/**
 * Persona avatar storage utilities.
 *
 * Production stores avatars in GCS (if AVATAR_GCS_BUCKET is set) or S3 (if AVATAR_S3_BUCKET is set).
 * Non-production stores avatars on the local filesystem under data/avatars.
 */

import { Storage } from "@google-cloud/storage";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";
import { PERSONA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { log } from "@/utils/misc/logger";

/**
 * Shared object-storage prefix segment for official preset assets (e.g. preset
 * sprites). Everything under this segment is uploaded once and referenced by
 * many servers' pointer personas, so it is treated as IMMUTABLE and is never
 * deleted by the per-persona cleanup paths (see {@link isSharedPresetAssetReference}).
 */
const SHARED_PRESET_SEGMENT = "presets";

type AvatarUploadOptions = {
  personaId: number;
  serverDiscId?: string;
  label?: string;
  buffer: Buffer;
  assetKind?: "avatar" | "sprite";
};

type AvatarStorageConfig =
  | { backend: "gcs"; bucket: string; prefix: string; publicBaseUrl: string }
  | { backend: "s3"; bucket: string; prefix: string; publicBaseUrl: string; region: string; endpoint?: string };

const IS_PRODUCTION = process.env.RUN_ENV === "production";
const LOCAL_AVATAR_BASE_DIR = path.resolve(process.cwd(), "data", "avatars");
const LOCAL_AVATAR_ROOT_PREFIX = "data/avatars/";
let cachedGcsStorage: Storage | null = null;
let cachedS3Client: S3Client | null = null;
let cachedS3Region: string | null = null;
let cachedS3Endpoint: string | undefined;

function getAvatarStorageConfig(): AvatarStorageConfig | null {
  if (!IS_PRODUCTION) {
    return null;
  }

  // GCS takes priority when AVATAR_GCS_BUCKET is set
  const gcsBucket = process.env.AVATAR_GCS_BUCKET?.trim();
  if (gcsBucket) {
    const prefix = (process.env.AVATAR_GCS_PREFIX || process.env.AVATAR_S3_PREFIX || "avatars")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const publicBaseUrl = process.env.AVATAR_PUBLIC_BASE_URL?.trim() || `https://storage.googleapis.com/${gcsBucket}`;
    return { backend: "gcs", bucket: gcsBucket, prefix, publicBaseUrl };
  }

  // S3 fallback
  const s3Bucket = process.env.AVATAR_S3_BUCKET?.trim();
  if (!s3Bucket) {
    log.warn(
      "[Avatar Storage] Neither AVATAR_GCS_BUCKET nor AVATAR_S3_BUCKET is set; falling back to Discord CDN URLs.",
    );
    return null;
  }

  const region = process.env.AVATAR_S3_REGION?.trim() || process.env.AWS_REGION?.trim() || "us-east-1";
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const prefix = (process.env.AVATAR_S3_PREFIX || "avatars").replace(/^\/+/, "").replace(/\/+$/, "");
  const publicBaseUrl = process.env.AVATAR_PUBLIC_BASE_URL?.trim() || `https://${s3Bucket}.s3.${region}.amazonaws.com`;
  return { backend: "s3", bucket: s3Bucket, prefix, publicBaseUrl, region, endpoint };
}

function getGcsStorage(): Storage {
  if (!cachedGcsStorage) {
    cachedGcsStorage = new Storage();
  }
  return cachedGcsStorage;
}

function getS3Client(region: string, endpoint?: string): S3Client {
  if (!cachedS3Client || cachedS3Region !== region || cachedS3Endpoint !== endpoint) {
    cachedS3Region = region;
    cachedS3Endpoint = endpoint;
    cachedS3Client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }
  return cachedS3Client;
}

function buildAvatarObjectKey(config: AvatarStorageConfig, options: AvatarUploadOptions): string {
  const timestamp = Date.now();
  const serverSegment = options.serverDiscId ? `servers/${options.serverDiscId}` : "servers/unknown";
  if (options.assetKind === "sprite") {
    return `${config.prefix}/${serverSegment}/personas/${options.personaId}/sprites/${timestamp}.png`;
  }
  return `${config.prefix}/${serverSegment}/personas/${options.personaId}/${timestamp}.png`;
}

function buildPublicUrl(config: AvatarStorageConfig, key: string): string {
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  return `${baseUrl}/${key}`;
}

function buildLocalStoredPath(options: AvatarUploadOptions): string {
  const timestamp = Date.now();
  const serverSegment = options.serverDiscId || "unknown";
  const pathSegments = ["data", "avatars", "servers", serverSegment, "personas", String(options.personaId)];
  if (options.assetKind === "sprite") {
    pathSegments.push("sprites");
  }
  pathSegments.push(`${timestamp}.png`);

  return path.posix.join(...pathSegments);
}

function getAssetLabel(options: AvatarUploadOptions): string {
  return options.assetKind === "sprite" ? "persona sprite" : "persona avatar";
}

function getAssetLogLabel(options: AvatarUploadOptions): string {
  const label = options.label ? ` (${options.label})` : "";
  return `${getAssetLabel(options)}${label}`;
}

function normalizeStoredPath(storedPath: string): string {
  return storedPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveLocalAvatarPath(storedPath: string): string | null {
  const normalizedPath = normalizeStoredPath(storedPath);
  const resolvedPath = path.resolve(process.cwd(), normalizedPath);
  const relativePath = path.relative(LOCAL_AVATAR_BASE_DIR, resolvedPath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return resolvedPath;
  }

  log.warn(`[Avatar Storage] Rejected path outside data/avatars: ${storedPath}`);
  return null;
}

function extractKeyFromAvatarUrl(config: AvatarStorageConfig, url: string): string | null {
  try {
    if (config.backend === "gcs") {
      // GCS public URLs: https://storage.googleapis.com/BUCKET/PREFIX/...
      // Strip the publicBaseUrl prefix to recover the object key.
      const baseUrl = config.publicBaseUrl.replace(/\/+$/, "");
      if (!url.startsWith(`${baseUrl}/`)) {
        return null;
      }
      const key = url.slice(baseUrl.length + 1);
      return key.startsWith(`${config.prefix}/`) ? key : null;
    }

    // S3: match on hostname (supports custom CDN domains, virtual-hosted style, and path-style)
    const parsed = new URL(url);
    const baseHost = new URL(config.publicBaseUrl).hostname;
    const hostname = parsed.hostname;
    const pathName = parsed.pathname.replace(/^\/+/, "");

    if (hostname !== baseHost) {
      const s3Host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
      const s3HostLegacy = `${config.bucket}.s3.amazonaws.com`;
      if (hostname !== s3Host && hostname !== s3HostLegacy) {
        return null;
      }
    }

    return pathName.startsWith(`${config.prefix}/`) ? pathName : null;
  } catch {
    return null;
  }
}

function getNonProductionPublicBaseUrl(): string | null {
  if (IS_PRODUCTION) {
    return null;
  }

  const baseUrl = process.env.AVATAR_PUBLIC_BASE_URL?.trim();
  return baseUrl && baseUrl.length > 0 ? baseUrl.replace(/\/+$/, "") : null;
}

export function isLocalPersonaAvatarPath(reference?: string | null): boolean {
  if (!reference) {
    return false;
  }

  return resolveLocalAvatarPath(reference) !== null;
}

export function resolvePersonaAvatarPublicUrl(reference?: string | null): string | null {
  if (!reference) {
    return null;
  }

  const trimmedReference = reference.trim();
  if (!trimmedReference) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedReference)) {
    return trimmedReference;
  }

  const publicBaseUrl = getNonProductionPublicBaseUrl();
  if (!publicBaseUrl) {
    return null;
  }

  const normalizedPath = normalizeStoredPath(trimmedReference);
  if (!normalizedPath.startsWith(LOCAL_AVATAR_ROOT_PREFIX)) {
    return null;
  }

  const relativePath = normalizedPath.slice(LOCAL_AVATAR_ROOT_PREFIX.length);
  return `${publicBaseUrl}/${relativePath}`;
}

export async function loadStoredPersonaAvatarBuffer(reference: string): Promise<Buffer | null> {
  const trimmedReference = reference.trim();
  if (!trimmedReference) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedReference)) {
    const downloadResult = await safeDownload(trimmedReference, {
      maxSizeMB: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB,
    });

    if (!downloadResult.success || !downloadResult.buffer) {
      return null;
    }

    return downloadResult.buffer;
  }

  const absolutePath = resolveLocalAvatarPath(trimmedReference);
  if (!absolutePath) {
    return null;
  }

  try {
    return await fs.readFile(absolutePath);
  } catch (error) {
    log.warn(`[Avatar Storage] Failed to load local persona avatar ${trimmedReference}`, error);
    return null;
  }
}

export async function loadStoredPersonaAvatarDataUri(reference: string): Promise<string | null> {
  const buffer = await loadStoredPersonaAvatarBuffer(reference);
  if (!buffer) {
    return null;
  }

  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function uploadPersonaAvatarToStorage(options: AvatarUploadOptions): Promise<string | null> {
  const assetLogLabel = getAssetLogLabel(options);

  if (IS_PRODUCTION) {
    const config = getAvatarStorageConfig();
    if (!config) {
      return null;
    }

    const key = buildAvatarObjectKey(config, options);

    if (config.backend === "gcs") {
      try {
        await getGcsStorage()
          .bucket(config.bucket)
          .file(key)
          .save(options.buffer, {
            contentType: "image/png",
            metadata: { cacheControl: "public, max-age=31536000, immutable" },
          });
        const publicUrl = buildPublicUrl(config, key);
        log.success(`[Avatar Storage] Uploaded ${assetLogLabel} to GCS (${publicUrl})`);
        return publicUrl;
      } catch (error) {
        await log.error(`[Avatar Storage] Failed to upload ${assetLogLabel} to GCS`, error, {
          errorType: "GcsUploadError",
          metadata: { bucket: config.bucket, key },
        });
        return null;
      }
    }

    // S3 path
    try {
      await getS3Client(config.region, config.endpoint).send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: options.buffer,
          ContentType: "image/png",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      const publicUrl = buildPublicUrl(config, key);
      log.success(`[Avatar Storage] Uploaded ${assetLogLabel} to S3 (${publicUrl})`);
      return publicUrl;
    } catch (error) {
      log.warn(`[Avatar Storage] Failed to upload ${assetLogLabel} to S3`, error);
      return null;
    }
  }

  // Non-production: store under data/avatars/ and return the normalized local path.
  // Callers store this path in webhook_avatar_url; downstream code resolves it to
  // a public URL (if AVATAR_PUBLIC_BASE_URL is set) or loads the buffer directly
  // to mutate the shared webhook avatar before each send.
  const storedPath = buildLocalStoredPath(options);
  const absolutePath = resolveLocalAvatarPath(storedPath);
  if (!absolutePath) {
    return null;
  }

  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, options.buffer);
    log.success(`[Avatar Storage] Stored ${assetLogLabel} at ${storedPath}`);
    return normalizeStoredPath(storedPath);
  } catch (error) {
    log.warn(`[Avatar Storage] Failed to store ${assetLogLabel} locally`, error);
    return null;
  }
}

export async function uploadPersonaSpriteToStorage(
  options: Omit<AvatarUploadOptions, "assetKind">,
): Promise<string | null> {
  return await uploadPersonaAvatarToStorage({
    ...options,
    assetKind: "sprite",
  });
}

/**
 * Builds the deterministic, content-addressed filename for a preset sprite image.
 * Including the content hash means identical art yields the same name (so a
 * re-seed is a no-op) while changed art yields a new name (so the URL changes and
 * pointer personas pick it up live). The sprite key is sanitized for path safety.
 *
 * @param spriteKey - Normalized sprite lookup key
 * @param contentHash - Short hash of the PNG bytes
 * @returns A path-safe filename like `mad-ab12cd34ef56.png`
 */
export function buildPresetSpriteFilename(spriteKey: string, contentHash: string): string {
  const safeKey = sanitizeAttachmentFilenamePart(spriteKey, { fallback: "sprite", maxLength: 40 });
  return `${safeKey}-${contentHash}.png`;
}

/** Build the storage-relative key/path for a shared preset sprite. */
function buildPresetSpriteRelativeKey(options: {
  lineageId: number;
  language: string;
  spriteKey: string;
  contentHash: string;
}): string {
  const safeLanguage = sanitizeAttachmentFilenamePart(options.language, { fallback: "lang", maxLength: 16 });
  const filename = buildPresetSpriteFilename(options.spriteKey, options.contentHash);
  return `${SHARED_PRESET_SEGMENT}/${options.lineageId}/${safeLanguage}/sprites/${filename}`;
}

/**
 * Builds the deterministic, content-addressed filename for a shared preset
 * avatar image. Parallels {@link buildPresetSpriteFilename}: identical art keeps
 * the same name (re-seed is a no-op) while changed art yields a new name (so the
 * shared URL changes and pointer personas pick the new avatar up live).
 *
 * @param contentHash - Short hash of the PNG bytes
 * @returns A path-safe filename like `avatar-ab12cd34ef56.png`
 */
export function buildPresetAvatarFilename(contentHash: string): string {
  return `avatar-${contentHash}.png`;
}

/** Build the storage-relative key/path for a shared preset avatar. */
function buildPresetAvatarRelativeKey(options: { lineageId: number; language: string; contentHash: string }): string {
  const safeLanguage = sanitizeAttachmentFilenamePart(options.language, { fallback: "lang", maxLength: 16 });
  const filename = buildPresetAvatarFilename(options.contentHash);
  return `${SHARED_PRESET_SEGMENT}/${options.lineageId}/${safeLanguage}/${filename}`;
}

/**
 * Uploads a buffer to a relative key under the immutable shared `presets/`
 * prefix, picking the configured backend (GCS → S3 → local filesystem). Shared
 * by the preset sprite and preset avatar uploaders so the three storage paths
 * stay identical. Returns a public URL in production, or the local stored path
 * in non-production.
 *
 * @returns The stored reference (URL or local path), or null on failure
 */
async function uploadSharedPresetObject(relativeKey: string, buffer: Buffer, logLabel: string): Promise<string | null> {
  if (IS_PRODUCTION) {
    const config = getAvatarStorageConfig();
    if (!config) {
      return null;
    }

    const key = `${config.prefix}/${relativeKey}`;
    if (config.backend === "gcs") {
      try {
        await getGcsStorage()
          .bucket(config.bucket)
          .file(key)
          .save(buffer, {
            contentType: "image/png",
            metadata: { cacheControl: "public, max-age=31536000, immutable" },
          });
        const publicUrl = buildPublicUrl(config, key);
        log.success(`[Avatar Storage] Uploaded ${logLabel} to GCS (${publicUrl})`);
        return publicUrl;
      } catch (error) {
        await log.error(`[Avatar Storage] Failed to upload ${logLabel} to GCS`, error, {
          errorType: "GcsUploadError",
          metadata: { bucket: config.bucket, key },
        });
        return null;
      }
    }

    try {
      await getS3Client(config.region, config.endpoint).send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: buffer,
          ContentType: "image/png",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      const publicUrl = buildPublicUrl(config, key);
      log.success(`[Avatar Storage] Uploaded ${logLabel} to S3 (${publicUrl})`);
      return publicUrl;
    } catch (error) {
      log.warn(`[Avatar Storage] Failed to upload ${logLabel} to S3`, error);
      return null;
    }
  }

  // Non-production: store under data/avatars/presets/... so the local webhook
  // renderer can load it (the loader only trusts paths under data/avatars/).
  const storedPath = `${LOCAL_AVATAR_ROOT_PREFIX}${relativeKey}`;
  const absolutePath = resolveLocalAvatarPath(storedPath);
  if (!absolutePath) {
    return null;
  }
  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);
    log.success(`[Avatar Storage] Stored ${logLabel} at ${storedPath}`);
    return normalizeStoredPath(storedPath);
  } catch (error) {
    log.warn(`[Avatar Storage] Failed to store ${logLabel} locally`, error);
    return null;
  }
}

/**
 * Uploads a shared preset sprite image to the immutable `presets/` storage prefix.
 *
 * The image is shared across every server whose pointer persona resolves this
 * preset, so the key is deterministic (lineage/language/key + content hash) and
 * the upload is overwrite-safe and idempotent. Returns a public URL in
 * production, or the local stored path in non-production.
 *
 * @returns The stored reference (URL or local path), or null on failure
 */
export async function uploadPresetSpriteToStorage(options: {
  lineageId: number;
  language: string;
  spriteKey: string;
  contentHash: string;
  buffer: Buffer;
}): Promise<string | null> {
  const relativeKey = buildPresetSpriteRelativeKey(options);
  const logLabel = `preset sprite (lineage ${options.lineageId}/${options.language}/${options.spriteKey})`;
  return await uploadSharedPresetObject(relativeKey, options.buffer, logLabel);
}

/**
 * Uploads a shared preset avatar image to the immutable `presets/` storage prefix.
 *
 * Mirrors {@link uploadPresetSpriteToStorage}: one content-addressed copy is
 * referenced by every server whose pointer persona resolves this preset, so an
 * alter avatar never needs a per-server upload. Lives at
 * `presets/{lineage}/{language}/avatar-{hash}.png`.
 *
 * @returns The stored reference (URL or local path), or null on failure
 */
export async function uploadPresetAvatarToStorage(options: {
  lineageId: number;
  language: string;
  contentHash: string;
  buffer: Buffer;
}): Promise<string | null> {
  const relativeKey = buildPresetAvatarRelativeKey(options);
  const logLabel = `preset avatar (lineage ${options.lineageId}/${options.language})`;
  return await uploadSharedPresetObject(relativeKey, options.buffer, logLabel);
}

/**
 * Detects whether a stored reference points at a SHARED preset asset (under the
 * immutable `presets/` prefix). Such assets are referenced by many servers'
 * pointer personas, so per-persona delete paths must never remove them.
 *
 * @param reference - A stored avatar/sprite reference (URL or local path)
 * @returns true when the reference is a shared preset asset
 */
export function isSharedPresetAssetReference(reference?: string | null): boolean {
  const trimmed = reference?.trim();
  if (!trimmed) {
    return false;
  }

  // Local form: data/avatars/presets/...
  const normalized = normalizeStoredPath(trimmed);
  if (normalized.startsWith(`${LOCAL_AVATAR_ROOT_PREFIX}${SHARED_PRESET_SEGMENT}/`)) {
    return true;
  }

  // URL form: match the preset layout segment regardless of host/prefix. Both
  // shared asset kinds live under presets/{lineage}/{language}/: sprites in a
  // `sprites/` subfolder, avatars as a top-level `avatar-{hash}.png` file.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const pathName = new URL(trimmed).pathname.replace(/^\/+/, "");
      return new RegExp(`(^|/)${SHARED_PRESET_SEGMENT}/[^/]+/[^/]+/(sprites/|avatar-)`).test(pathName);
    } catch {
      return false;
    }
  }

  return false;
}

export async function deletePersonaAvatarFromStorage(reference: string): Promise<boolean> {
  const target = reference.trim();
  if (!target) {
    return false;
  }

  // Shared preset assets are immutable and referenced by many servers' pointer
  // personas. A per-persona delete (sprite replace/remove, re-default reset)
  // must never remove them or it would break every other server. Skip silently.
  if (isSharedPresetAssetReference(target)) {
    log.info(`[Avatar Storage] Skipping delete of shared preset asset ${target}`);
    return false;
  }

  if (/^https?:\/\//i.test(target)) {
    if (!IS_PRODUCTION) {
      return false;
    }

    const config = getAvatarStorageConfig();
    if (!config) {
      return false;
    }

    const key = extractKeyFromAvatarUrl(config, target);
    if (!key) {
      return false;
    }

    if (config.backend === "gcs") {
      try {
        await getGcsStorage().bucket(config.bucket).file(key).delete();
        log.info(`[Avatar Storage] Deleted avatar object ${key} from GCS`);
        return true;
      } catch (error) {
        log.warn(`[Avatar Storage] Failed to delete avatar object ${key} from GCS`, error);
        return false;
      }
    }

    // S3 path
    try {
      await getS3Client(config.region, config.endpoint).send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
      log.info(`[Avatar Storage] Deleted avatar object ${key} from S3`);
      return true;
    } catch (error) {
      log.warn(`[Avatar Storage] Failed to delete avatar object ${key} from S3`, error);
      return false;
    }
  }

  const absolutePath = resolveLocalAvatarPath(target);
  if (!absolutePath) {
    return false;
  }

  try {
    await fs.unlink(absolutePath);
    log.info(`[Avatar Storage] Deleted local persona avatar ${normalizeStoredPath(target)}`);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }

    log.warn(`[Avatar Storage] Failed to delete local persona avatar ${target}`, error);
    return false;
  }
}

export async function deletePersonaSpriteFromStorage(reference: string): Promise<boolean> {
  return await deletePersonaAvatarFromStorage(reference);
}
