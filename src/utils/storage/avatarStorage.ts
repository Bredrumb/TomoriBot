import { Storage } from "@google-cloud/storage";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";
import { PERSONA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { extractCloudObjectKeyFromUrl } from "@/utils/storage/cloudObjectStorage";
import { log } from "@/utils/misc/logger";

// Shared preset assets under this prefix are immutable and excluded from per-persona cleanup because many servers'
// pointer personas reference them.
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
    return `${config.prefix}/${serverSegment}/personas/${options.personaId}/sprites/${randomUUID()}.png`;
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
  pathSegments.push(`${options.assetKind === "sprite" ? randomUUID() : timestamp}.png`);

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
  return extractCloudObjectKeyFromUrl(config, url);
}

function getNonProductionPublicBaseUrl(): string | null {
  if (IS_PRODUCTION) {
    return null;
  }

  const baseUrl = process.env.AVATAR_PUBLIC_BASE_URL?.trim();
  return baseUrl && baseUrl.length > 0 ? baseUrl.replace(/\/+$/, "") : null;
}

export function isAvatarStorageUrl(url: string): boolean {
  const config = getAvatarStorageConfig();
  return config !== null && extractKeyFromAvatarUrl(config, url) !== null;
}

// Reference must verify the deployment storage host or stay under the local presets directory because callers skip
// per-owner checks.
export async function loadSharedPresetAssetBuffer(reference: string): Promise<Buffer | null> {
  const target = reference.trim();
  if (!isSharedPresetAssetReference(target)) {
    return null;
  }
  if (/^https?:\/\//i.test(target)) {
    return isAvatarStorageUrl(target) ? await loadStoredPersonaAvatarBuffer(target) : null;
  }

  const resolvedPath = path.resolve(process.cwd(), normalizeStoredPath(target));
  const relativePath = path.relative(path.join(LOCAL_AVATAR_BASE_DIR, SHARED_PRESET_SEGMENT), resolvedPath);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  return await loadStoredPersonaAvatarBuffer(target);
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
      await log.error(`[Avatar Storage] Failed to upload ${assetLogLabel} to S3`, error, {
        errorType: "S3UploadError",
        metadata: { bucket: config.bucket, key },
      });
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

// Filename includes the content hash so identical art makes re-seeds idempotent while changed art yields a new URL
// for pointer personas.
export function buildPresetSpriteFilename(spriteKey: string, contentHash: string): string {
  const safeKey = sanitizeAttachmentFilenamePart(spriteKey, { fallback: "sprite", maxLength: 40 });
  return `${safeKey}-${contentHash}.png`;
}

// Language is omitted from the storage key because all locale variants share identical image bytes while
// preset_sprites rows remain localized.
export function buildPresetSpriteRelativeKey(options: {
  lineageId: number;
  spriteKey: string;
  contentHash: string;
}): string {
  const filename = buildPresetSpriteFilename(options.spriteKey, options.contentHash);
  return `${SHARED_PRESET_SEGMENT}/${options.lineageId}/sprites/${filename}`;
}

export function buildPresetAvatarFilename(contentHash: string): string {
  return `avatar-${contentHash}.png`;
}

export function buildPresetCharacterReferenceRelativeKey(options: { lineageId: number; contentHash: string }): string {
  return `${SHARED_PRESET_SEGMENT}/${options.lineageId}/character-reference-${options.contentHash}.png`;
}

// Preset avatar keys omit language because the avatar art is identical across all locale variants of a preset.
export function buildPresetAvatarRelativeKey(options: { lineageId: number; contentHash: string }): string {
  const filename = buildPresetAvatarFilename(options.contentHash);
  return `${SHARED_PRESET_SEGMENT}/${options.lineageId}/${filename}`;
}

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
      await log.error(`[Avatar Storage] Failed to upload ${logLabel} to S3`, error, {
        errorType: "S3UploadError",
        metadata: { bucket: config.bucket, key },
      });
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

export async function uploadPresetSpriteToStorage(options: {
  lineageId: number;
  spriteKey: string;
  contentHash: string;
  buffer: Buffer;
}): Promise<string | null> {
  const relativeKey = buildPresetSpriteRelativeKey(options);
  const logLabel = `preset sprite (lineage ${options.lineageId}/${options.spriteKey})`;
  return await uploadSharedPresetObject(relativeKey, options.buffer, logLabel);
}

export async function uploadPresetAvatarToStorage(options: {
  lineageId: number;
  contentHash: string;
  buffer: Buffer;
}): Promise<string | null> {
  const relativeKey = buildPresetAvatarRelativeKey(options);
  const logLabel = `preset avatar (lineage ${options.lineageId})`;
  return await uploadSharedPresetObject(relativeKey, options.buffer, logLabel);
}

export async function uploadPresetCharacterReferenceToStorage(options: {
  lineageId: number;
  contentHash: string;
  buffer: Buffer;
}): Promise<string | null> {
  const relativeKey = buildPresetCharacterReferenceRelativeKey(options);
  const logLabel = `preset character reference (lineage ${options.lineageId})`;
  return await uploadSharedPresetObject(relativeKey, options.buffer, logLabel);
}

// Shared preset assets are referenced by pointer personas across many servers, so per-persona delete paths must check
// this and never remove them.
export function isSharedPresetAssetReference(reference?: string | null): boolean {
  const trimmed = reference?.trim();
  if (!trimmed) {
    return false;
  }

  const normalized = normalizeStoredPath(trimmed);
  if (normalized.startsWith(`${LOCAL_AVATAR_ROOT_PREFIX}${SHARED_PRESET_SEGMENT}/`)) {
    return true;
  }

  // The optional middle segment keeps the retired per-language preset layout protected until every environment re-seeds.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const pathName = new URL(trimmed).pathname.replace(/^\/+/, "");
      return new RegExp(`(^|/)${SHARED_PRESET_SEGMENT}/[^/]+/([^/]+/)?(sprites/|avatar-|character-reference-)`).test(
        pathName,
      );
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
        await log.error(`[Avatar Storage] Failed to delete avatar object ${key} from GCS`, error, {
          errorType: "GcsDeleteError",
          metadata: { bucket: config.bucket, key },
        });
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
      await log.error(`[Avatar Storage] Failed to delete avatar object ${key} from S3`, error, {
        errorType: "S3DeleteError",
        metadata: { bucket: config.bucket, key },
      });
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
