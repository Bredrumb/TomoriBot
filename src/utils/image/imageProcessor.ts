import sharp from "sharp";
import { recordChatTurnFetch } from "@/utils/chat/turnLatency";
import { log } from "../misc/logger";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";
import { safeDownload } from "@/utils/security/safeDownload";

// Images exceeding these limits are downscaled before being sent to providers
// to prevent stream timeouts (especially on slower models like Qwen via OpenRouter).

const IMAGE_CONTEXT_MAX_BYTES = Number.parseInt(process.env.IMAGE_CONTEXT_MAX_BYTES ?? "2097152", 10);

const IMAGE_CONTEXT_MAX_DIMENSION = Number.parseInt(process.env.IMAGE_CONTEXT_MAX_DIMENSION ?? "2048", 10);

const IMAGE_CONTEXT_JPEG_QUALITY = 85;

const IMAGE_FETCH_TIMEOUT_MS = Number.parseInt(process.env.IMAGE_FETCH_TIMEOUT_MS ?? "20000", 10);

export interface OptimizedImage {
  data: string;
  mimeType: string;
}

interface FetchedImage {
  data: string;
  mimeType?: string;
  contentType?: string;
}

const IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const imageCache = new Map<string, FetchedImage>();
const inFlightImages = new Map<string, Promise<FetchedImage>>();
let imageCacheBytes = 0;

function getImageCacheKey(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !["cdn.discordapp.com", "media.discordapp.net"].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return undefined;
    }
    for (const parameter of ["ex", "is", "hm"]) parsed.searchParams.delete(parameter);
    return parsed.href;
  } catch {
    return undefined;
  }
}

export function clearImageCache(): void {
  imageCache.clear();
  inFlightImages.clear();
  imageCacheBytes = 0;
}

export function getImageCacheSize(): number {
  return imageCache.size;
}

function storeImage(key: string, image: FetchedImage): void {
  const bytes = Buffer.byteLength(image.data);
  if (bytes > IMAGE_CACHE_MAX_BYTES) return;
  while (imageCacheBytes + bytes > IMAGE_CACHE_MAX_BYTES) {
    const oldest = imageCache.entries().next();
    if (oldest.done) break;
    imageCache.delete(oldest.value[0]);
    imageCacheBytes -= Buffer.byteLength(oldest.value[1].data);
  }
  imageCache.set(key, image);
  imageCacheBytes += bytes;
}

async function fetchCachedImage(url: string): Promise<FetchedImage> {
  const key = getImageCacheKey(url);
  if (!key) return fetchImage(url);
  const cached = imageCache.get(key) ?? inFlightImages.get(key);
  if (cached) {
    const validation = await validateRemoteUrl(url);
    if (!validation.valid) throw new Error("Image URL refused by policy");
    return cached;
  }
  const pending = fetchImage(url).then((image) => {
    if (inFlightImages.get(key) === pending) storeImage(key, image);
    return image;
  });
  inFlightImages.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightImages.get(key) === pending) inFlightImages.delete(key);
  }
}

function detectImageMimeType(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") {
      return "image/gif";
    }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 16 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brands = buffer.subarray(8, Math.min(buffer.length, 32)).toString("ascii");
    if (brands.includes("avif") || brands.includes("avis")) {
      return "image/avif";
    }
  }
  return undefined;
}

function normalizeMimeType(mimeType: string | undefined): string | undefined {
  const normalized = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
}

// Byte-size and header-only metadata checks gate JPEG downscaling so large images do not time out provider streams
// while small ones avoid decoding.
export async function fetchAndOptimizeImage(url: string, sourceMimeType?: string): Promise<OptimizedImage> {
  const image = await fetchCachedImage(url);
  return {
    data: image.data,
    mimeType: image.mimeType ?? normalizeMimeType(sourceMimeType) ?? image.contentType ?? "image/jpeg",
  };
}

async function fetchImage(url: string): Promise<FetchedImage> {
  const downloadStartedAt = performance.now();
  const downloadResult = await safeDownload(url, {
    maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
    timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
  });
  if (!url.startsWith("data:") && downloadResult.error !== "blocked_by_policy") {
    recordChatTurnFetch("image", performance.now() - downloadStartedAt);
  }
  if (!downloadResult.success || !downloadResult.buffer) {
    throw new Error(`Image fetch failed: ${downloadResult.details ?? downloadResult.error ?? "unknown error"}`);
  }

  const buffer = downloadResult.buffer;
  const rawSize = buffer.byteLength;
  // Prefer payload signatures over filenames or headers because Discord can mislabel formats providers decode strictly.
  const finalMimeType = detectImageMimeType(buffer);
  const contentType = normalizeMimeType(downloadResult.contentType);

  if (rawSize <= IMAGE_CONTEXT_MAX_BYTES) {
    return { data: buffer.toString("base64"), mimeType: finalMimeType, contentType };
  }

  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const longestSide = Math.max(width, height);

    if (longestSide <= IMAGE_CONTEXT_MAX_DIMENSION) {
      return { data: buffer.toString("base64"), mimeType: finalMimeType, contentType };
    }

    const optimizedBuffer = await sharp(buffer)
      .resize({
        width: IMAGE_CONTEXT_MAX_DIMENSION,
        height: IMAGE_CONTEXT_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: IMAGE_CONTEXT_JPEG_QUALITY })
      .toBuffer();

    return {
      data: optimizedBuffer.toString("base64"),
      mimeType: "image/jpeg",
    };
  } catch (sharpError) {
    log.warn(
      `Image optimization failed, sending raw (${(rawSize / 1024 / 1024).toFixed(1)} MB): ${sharpError instanceof Error ? sharpError.message : String(sharpError)}`,
    );
    return { data: buffer.toString("base64"), mimeType: finalMimeType, contentType };
  }
}

export async function optimizeImageBuffer(buffer: Buffer, sourceMimeType: string): Promise<OptimizedImage> {
  const rawSize = buffer.byteLength;

  if (rawSize <= IMAGE_CONTEXT_MAX_BYTES) {
    return { data: buffer.toString("base64"), mimeType: sourceMimeType };
  }

  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const longestSide = Math.max(width, height);

    if (longestSide <= IMAGE_CONTEXT_MAX_DIMENSION) {
      return { data: buffer.toString("base64"), mimeType: sourceMimeType };
    }

    const optimizedBuffer = await sharp(buffer)
      .resize({
        width: IMAGE_CONTEXT_MAX_DIMENSION,
        height: IMAGE_CONTEXT_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: IMAGE_CONTEXT_JPEG_QUALITY })
      .toBuffer();

    return {
      data: optimizedBuffer.toString("base64"),
      mimeType: "image/jpeg",
    };
  } catch (sharpError) {
    log.warn(
      `Image buffer optimization failed, sending raw (${(rawSize / 1024 / 1024).toFixed(1)} MB): ${sharpError instanceof Error ? sharpError.message : String(sharpError)}`,
    );
    return { data: buffer.toString("base64"), mimeType: sourceMimeType };
  }
}

const NAI_REFERENCE_CANVASES = [
  { width: 1024, height: 1536 },
  { width: 1472, height: 1472 },
  { width: 1536, height: 1024 },
] as const;

function selectClosestNaiReferenceCanvas(width: number, height: number): { width: number; height: number } {
  const aspectRatio = width / height;

  return NAI_REFERENCE_CANVASES.reduce((bestCanvas, candidateCanvas) => {
    const bestDistance = Math.abs(Math.log(aspectRatio / (bestCanvas.width / bestCanvas.height)));
    const candidateDistance = Math.abs(Math.log(aspectRatio / (candidateCanvas.width / candidateCanvas.height)));

    return candidateDistance < bestDistance ? candidateCanvas : bestCanvas;
  });
}

export async function centerCropToSquare(buffer: Buffer): Promise<Buffer> {
  try {
    const metadata = await sharp(buffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error("Unable to read image dimensions");
    }

    const squareSize = Math.min(metadata.width, metadata.height);

    const left = Math.floor((metadata.width - squareSize) / 2);
    const top = Math.floor((metadata.height - squareSize) / 2);

    const croppedBuffer = await sharp(buffer)
      .extract({
        left,
        top,
        width: squareSize,
        height: squareSize,
      })
      .png()
      .toBuffer();

    return croppedBuffer;
  } catch (error) {
    log.error("Failed to crop image to square:", error);
    throw new Error(`Image processing failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// NovelAI's reference pipeline expects black-padded canonical canvases rather than arbitrary dimensions, so this
// mirrors its preprocessing.
export async function normalizeNaiReferenceImage(buffer: Buffer): Promise<Buffer> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Unable to read image dimensions");
    }

    const canvas = selectClosestNaiReferenceCanvas(metadata.width, metadata.height);

    const normalizedBuffer = await sharp(buffer)
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .resize(canvas.width, canvas.height, {
        fit: "contain",
        position: "centre",
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .png()
      .toBuffer();

    return normalizedBuffer;
  } catch (error) {
    log.error("Failed to normalize NovelAI reference image:", error);
    throw new Error(
      `NovelAI reference normalization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

export async function convertToPNG(buffer: Buffer): Promise<Buffer> {
  try {
    const pngBuffer = await sharp(buffer).png().toBuffer();
    return pngBuffer;
  } catch (error) {
    log.error("Failed to convert image to PNG:", error);
    throw new Error(`Image conversion failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
