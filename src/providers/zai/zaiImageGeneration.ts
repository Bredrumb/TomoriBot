import type {
  ProviderNativeImageGenerationRequest,
  ProviderNativeImageGenerationResult,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { toZaiApiModelName, ZAI_GENERAL_IMAGES_GENERATIONS_URL } from "@/providers/zai/zaiShared";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

/**
 * Aspect ratio to pixel size mapping for Z.ai image generation.
 * These sizes are tuned for the Z.ai GLM image model.
 */
const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  "1:1": "1280x1280",
  "2:3": "1056x1568",
  "3:2": "1568x1056",
  "3:4": "1056x1568",
  "4:3": "1472x1088",
  "4:5": "1088x1472",
  "5:4": "1472x1088",
  "9:16": "960x1728",
  "16:9": "1728x960",
  "21:9": "1728x960",
};

const DEFAULT_SIZE = "1280x1280";

/**
 * Generate an image using Z.ai's native image generation API.
 * Converts the aspect ratio to pixel dimensions and fetches the resulting image URL.
 *
 * @param request - Image generation request containing apiKey, model, prompt, and aspectRatio
 * @returns Generated image as base64 data with its MIME type, or null values on failure
 */
export async function generateZaiNativeImage(
  request: ProviderNativeImageGenerationRequest,
): Promise<ProviderNativeImageGenerationResult> {
  const apiModel = toZaiApiModelName(request.model);
  const size = ASPECT_RATIO_TO_SIZE[request.aspectRatio] ?? DEFAULT_SIZE;

  // Log warning if reference images were provided — Z.ai doesn't support img2img
  if (request.referenceImages && request.referenceImages.length > 0) {
    log.warn(
      "Z.ai image generation does not support reference images (img2img). Proceeding with text-only generation.",
      {
        model: apiModel,
        referenceCount: request.referenceImages.length,
      },
    );
  }

  // Send generation request to Z.ai
  const response = await fetch(request.endpointUrl || ZAI_GENERAL_IMAGES_GENERATIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: apiModel,
      prompt: request.prompt,
      size,
      quality: "hd",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error("Z.ai image generation request failed", new Error(errorBody), {
      errorType: "ZaiImageGenerationHttpError",
      metadata: {
        model: apiModel,
        status: response.status,
        size,
      },
    });
    throw new Error(`Z.ai image generation failed: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as {
    data?: Array<{ url?: string }>;
  };

  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) {
    log.warn("Z.ai image generation returned no image URL", {
      model: apiModel,
    });
    return { imageData: null, mimeType: null };
  }

  const imageResponse = await safeDownload(imageUrl, {
    maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
    timeoutMs: 15_000,
  });
  if (!imageResponse.success || !imageResponse.buffer) {
    log.error("Failed to fetch generated image from Z.ai URL", new Error(imageResponse.details ?? "download failed"), {
      errorType: "ZaiImageFetchError",
      metadata: { model: apiModel, imageUrl },
    });
    return { imageData: null, mimeType: null };
  }

  const contentType = imageResponse.contentType ?? "image/png";
  const mimeType = contentType.split(";")[0].trim();

  const base64 = imageResponse.buffer.toString("base64");

  return {
    imageData: base64,
    mimeType,
  };
}
