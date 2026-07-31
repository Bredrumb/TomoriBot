/**
 * GIF Processing Utility
 * Extracts keyframes from animated GIFs and converts them to compressed JPEG images
 * for use with LLM providers that don't support GIF format
 */

import { parseGIF, decompressFrames } from "gifuct-js";
import sharp from "sharp";
import { log } from "../misc/logger";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

/** Maximum width for resized keyframe images (pixels). Images maintain aspect ratio and won't be upscaled. */
const MAX_KEYFRAME_WIDTH = 800;

/** JPEG compression quality (0-100) for extracted GIF keyframes. Higher = better quality, larger payload. */
const JPEG_QUALITY = (() => {
  const parsed = Number.parseInt(process.env.GIF_JPEG_QUALITY || "80", 10);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 80;
})();

/** Maximum number of keyframes to extract from a GIF. Prevents extremely long GIFs from overwhelming context. */
const MAX_KEYFRAMES = (() => {
  const parsed = Number.parseInt(process.env.GIF_MAX_KEYFRAMES || "10", 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 10;
})();

/**
 * Extract every Nth frame as a keyframe.
 * E.g., 10 means extract frames 0, 10, 20, 30, etc. (plus first and last)
 */
const FRAME_INTERVAL = 10;

/** Processing timeout in milliseconds. Prevents hanging on corrupted or extremely large GIFs. */
const PROCESSING_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.GIF_PROCESSING_TIMEOUT_MS || "30000", 10);
  return Number.isFinite(parsed) ? Math.max(1000, parsed) : 30000;
})();

/**
 * Represents a processed GIF keyframe
 */
export interface ProcessedGifFrame {
  /** Base64-encoded JPEG image data */
  data: string;
  /** MIME type (always 'image/jpeg' for processed frames) */
  mimeType: string;
  /** Frame number (0-indexed) */
  frameNumber: number;
  /** Total number of frames in the original GIF */
  totalFrames: number;
  /** Original frame index in the GIF */
  originalFrameIndex: number;
}

/**
 * Configuration for GIF keyframe extraction
 */
export interface GifProcessorConfig {
  /** Maximum width for resized images (maintains aspect ratio) */
  maxWidth?: number;
  /** JPEG quality (0-100) */
  jpegQuality?: number;
  /** Maximum number of keyframes to extract */
  maxKeyframes?: number;
  /** Extract every Nth frame */
  frameInterval?: number;
  /** Processing timeout in milliseconds */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<GifProcessorConfig> = {
  maxWidth: MAX_KEYFRAME_WIDTH,
  jpegQuality: JPEG_QUALITY,
  maxKeyframes: MAX_KEYFRAMES,
  frameInterval: FRAME_INTERVAL,
  timeoutMs: PROCESSING_TIMEOUT_MS,
};

/**
 *
 * Algorithm:
 * 1. Always includes first frame (index 0)
 * 2. Always includes last frame
 * 3. Includes every Nth frame in between (default N=10)
 * 4. Caps total frames at maxKeyframes
 *
 * @param gifSource - URL or Buffer containing the GIF data
 * @param config - Optional configuration for processing
 * @returns Array of processed keyframes with metadata
 * @throws Error if GIF processing fails
 */
export async function extractGifKeyframes(
  gifSource: string | Buffer,
  config: GifProcessorConfig = {},
): Promise<ProcessedGifFrame[]> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  const startTime = Date.now();
  const sourceDesc = typeof gifSource === "string" ? gifSource : `Buffer (${gifSource.length} bytes)`;
  log.info(
    `GIF Processor: Starting keyframe extraction - Source: ${sourceDesc}, Config: ${JSON.stringify(finalConfig)}`,
  );

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`GIF processing timeout after ${finalConfig.timeoutMs}ms`));
      }, finalConfig.timeoutMs);
    });

    const extractionPromise = extractFramesInternal(gifSource, finalConfig);
    const frames = await Promise.race([extractionPromise, timeoutPromise]);

    const processingTime = Date.now() - startTime;
    log.success(`GIF Processor: Extracted ${frames.length} keyframes in ${processingTime}ms`);

    return frames;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    log.error(`GIF Processor: Failed to extract keyframes after ${processingTime}ms`, error as Error);
    throw error;
  }
}

/**
 * Internal function to extract and process GIF frames
 * Separated for cleaner timeout handling
 */
async function extractFramesInternal(
  gifSource: string | Buffer,
  config: Required<GifProcessorConfig>,
): Promise<ProcessedGifFrame[]> {
  let gifBuffer: Buffer;
  if (typeof gifSource === "string") {
    log.info(`GIF Processor: Fetching GIF from URL: ${gifSource}`);
    const response = await safeDownload(gifSource, {
      maxSizeMB: MEDIA_LIMITS.MAX_GIF_SIZE_MB,
      timeoutMs: 20_000,
    });
    if (!response.success || !response.buffer) {
      throw new Error(`Failed to fetch GIF: ${response.details ?? response.error ?? "unknown error"}`);
    }
    gifBuffer = response.buffer;
    log.info(`GIF Processor: Fetched ${gifBuffer.length} bytes`);
  } else {
    gifBuffer = gifSource;
  }

  // Parse and decompress the GIF
  // parseGIF expects ArrayBuffer, convert Buffer to ArrayBuffer
  const uint8Array = new Uint8Array(gifBuffer);
  const gif = parseGIF(uint8Array.buffer);
  const allFramesData = decompressFrames(gif, true); // buildPatch=true for RGBA data

  const totalFrames = allFramesData.length;
  log.info(`GIF Processor: Total frames in GIF: ${totalFrames}`);

  if (totalFrames === 1) {
    log.info("GIF Processor: Single-frame GIF detected, processing as static image");
    const processedFrame = await processFrame(allFramesData[0], 0, 1, 0, totalFrames, config);
    return [processedFrame];
  }

  const frameIndices = calculateKeyframeIndices(totalFrames, config.frameInterval, config.maxKeyframes);

  log.info(`GIF Processor: Selected ${frameIndices.length} keyframes: [${frameIndices.join(", ")}]`);

  const processedFrames: ProcessedGifFrame[] = [];
  for (let i = 0; i < frameIndices.length; i++) {
    const frameIndex = frameIndices[i];
    const frameData = allFramesData[frameIndex];
    const processedFrame = await processFrame(frameData, i, frameIndices.length, frameIndex, totalFrames, config);
    processedFrames.push(processedFrame);
  }

  return processedFrames;
}

/**
 * Calculate which frame indices to extract as keyframes
 * Always includes first and last frame, plus every Nth frame in between
 *
 * @param totalFrames - Total number of frames in the GIF
 * @param maxFrames - Maximum number of keyframes to return
 * @returns Array of frame indices to extract (sorted)
 */
function calculateKeyframeIndices(totalFrames: number, interval: number, maxFrames: number): number[] {
  const indices = new Set<number>();

  // Always include first frame
  indices.add(0);

  // Always include last frame
  indices.add(totalFrames - 1);

  for (let i = interval; i < totalFrames - 1; i += interval) {
    indices.add(i);
  }

  const sortedIndices = Array.from(indices).sort((a, b) => a - b);

  if (sortedIndices.length > maxFrames) {
    const result = [0, totalFrames - 1];
    const remainingSlots = maxFrames - 2;
    const step = Math.floor((sortedIndices.length - 2) / remainingSlots);

    for (let i = 1; i < sortedIndices.length - 1; i += step) {
      if (result.length >= maxFrames) break;
      result.push(sortedIndices[i]);
    }

    return result.sort((a, b) => a - b);
  }

  return sortedIndices;
}

/**
 * Process a single GIF frame: convert to JPEG and compress
 *
 * @param totalOutputFrames - Total number of frames in the output (keyframes)
 * @param originalFrameIndex - Original frame index in the source GIF
 * @param totalSourceFrames - Total number of frames in the original source GIF
 */
async function processFrame(
  frameData: {
    patch: Uint8ClampedArray;
    dims: { width: number; height: number; top: number; left: number };
  },
  frameNumber: number,
  totalOutputFrames: number,
  originalFrameIndex: number,
  totalSourceFrames: number,
  config: Required<GifProcessorConfig>,
): Promise<ProcessedGifFrame> {
  // Convert RGBA pixel data to raw buffer
  // gifuct-js provides patch as Uint8ClampedArray with RGBA pixel data
  const { patch, dims } = frameData;
  const frameBuffer = Buffer.from(patch.buffer);

  const processedBuffer = await sharp(frameBuffer, {
    raw: {
      width: dims.width,
      height: dims.height,
      channels: 4, // RGBA
    },
  })
    .resize(config.maxWidth, undefined, {
      fit: "inside", // Maintain aspect ratio
      withoutEnlargement: true, // Don't upscale small images
    })
    .jpeg({
      quality: config.jpegQuality,
      progressive: true, // Progressive JPEG for better web performance
    })
    .toBuffer();

  const base64Data = processedBuffer.toString("base64");

  const originalSize = frameBuffer.length;
  const compressedSize = processedBuffer.length;
  const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

  log.info(
    `GIF Processor: Processed frame ${frameNumber + 1}/${totalOutputFrames} ` +
      `(original index ${originalFrameIndex + 1}/${totalSourceFrames}): ` +
      `${originalSize} → ${compressedSize} bytes (${compressionRatio}% reduction)`,
  );

  return {
    data: base64Data,
    mimeType: "image/jpeg",
    frameNumber,
    totalFrames: totalSourceFrames,
    originalFrameIndex,
  };
}
