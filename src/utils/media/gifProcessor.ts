import { parseGIF, decompressFrames } from "gifuct-js";
import sharp from "sharp";
import { log } from "../misc/logger";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

const MAX_KEYFRAME_WIDTH = 800;

const GIF_JPEG_QUALITY = 80;

const GIF_MAX_KEYFRAMES = 10;

const FRAME_INTERVAL = 10;

const PROCESSING_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.GIF_PROCESSING_TIMEOUT_MS || "30000", 10);
  return Number.isFinite(parsed) ? Math.max(1000, parsed) : 30000;
})();

export interface ProcessedGifFrame {
  data: string;
  mimeType: string;
  frameNumber: number;
  totalFrames: number;
  originalFrameIndex: number;
}

export interface GifProcessorConfig {
  maxWidth?: number;
  jpegQuality?: number;
  maxKeyframes?: number;
  frameInterval?: number;
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<GifProcessorConfig> = {
  maxWidth: MAX_KEYFRAME_WIDTH,
  jpegQuality: GIF_JPEG_QUALITY,
  maxKeyframes: GIF_MAX_KEYFRAMES,
  frameInterval: FRAME_INTERVAL,
  timeoutMs: PROCESSING_TIMEOUT_MS,
};

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

  const uint8Array = new Uint8Array(gifBuffer);
  const gif = parseGIF(uint8Array.buffer);
  const allFramesData = decompressFrames(gif, true);

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

function calculateKeyframeIndices(totalFrames: number, interval: number, maxFrames: number): number[] {
  const indices = new Set<number>();

  indices.add(0);

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
  const { patch, dims } = frameData;
  const frameBuffer = Buffer.from(patch.buffer);

  const processedBuffer = await sharp(frameBuffer, {
    raw: {
      width: dims.width,
      height: dims.height,
      channels: 4,
    },
  })
    .resize(config.maxWidth, undefined, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: config.jpegQuality,
      progressive: true,
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
