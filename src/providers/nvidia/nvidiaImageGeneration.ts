import type {
  ProviderNativeImageGenerationRequest,
  ProviderNativeImageGenerationResult,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { NVIDIA_IMAGE_GENERATION_BASE_URL } from "@/providers/nvidia/nvidiaConstants";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

function parseNumberEnv(name: string, fallbackValue: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallbackValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < min || parsedValue > max) {
    log.warn(`[NVIDIA] Invalid ${name} value "${rawValue}". Falling back to ${fallbackValue}.`);
    return fallbackValue;
  }

  return parsedValue;
}

const FLUX_STEPS = parseNumberEnv("NVIDIA_IMAGE_STEPS", 30, 1, 50);
const FLUX_CFG_SCALE = parseNumberEnv("NVIDIA_IMAGE_CFG_SCALE", 3.5, 0, 10);

interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Every ratio maps onto one of the five resolutions FLUX.1-dev's model card publishes, because
 * an arbitrary width/height pair outside that set is rejected with a 400. Ratios without an exact
 * bucket (3:4, 4:5, 5:4, 21:9) resolve to the nearest published one rather than failing.
 */
const FLUX_DIMENSIONS: Record<string, ImageDimensions> = {
  "1:1": { width: 1024, height: 1024 },
  "2:3": { width: 832, height: 1216 },
  "3:2": { width: 1216, height: 832 },
  "3:4": { width: 832, height: 1216 },
  "4:3": { width: 1216, height: 832 },
  "4:5": { width: 832, height: 1216 },
  "5:4": { width: 1216, height: 832 },
  "9:16": { width: 768, height: 1344 },
  "16:9": { width: 1344, height: 768 },
  "21:9": { width: 1344, height: 768 },
};

interface NvidiaImageModelSpec {
  /** Path segment appended to {@link NVIDIA_IMAGE_GENERATION_BASE_URL}. */
  path: string;
  /** False when the endpoint has no negative-prompt field, so callers can be told it was dropped. */
  supportsNegativePrompt: boolean;
  buildBody: (request: ProviderNativeImageGenerationRequest) => Record<string, unknown>;
}

/**
 * NVIDIA wraps each image model with its upstream repository's native request signature and never
 * normalized them, so a shared body literal cannot serve more than one model: FLUX takes
 * `width`/`height`, SDXL takes `text_prompts[]`, and the retired SD3 line took `aspect_ratio`.
 * Adding a model means adding a spec here, not editing the request path.
 */
const NVIDIA_IMAGE_MODEL_SPECS: Record<string, NvidiaImageModelSpec> = {
  "black-forest-labs/flux.1-dev": {
    path: "black-forest-labs/flux.1-dev",
    supportsNegativePrompt: false,
    buildBody: (request) => {
      const dimensions = FLUX_DIMENSIONS[request.aspectRatio] ?? FLUX_DIMENSIONS["1:1"];
      return {
        prompt: request.prompt,
        mode: "text-to-image",
        cfg_scale: request.cfg ?? FLUX_CFG_SCALE,
        width: dimensions.width,
        height: dimensions.height,
        seed: request.seed ?? 0,
        steps: FLUX_STEPS,
      };
    },
  },
};

/** Raised when the selected codename has no spec, which happens once NVIDIA retires a model. */
export class NvidiaImageModelUnavailableError extends Error {
  constructor(readonly model: string) {
    super(
      `NVIDIA image model "${model}" is no longer available. NVIDIA retired it from their hosted catalog. ` +
        "Pick a current model with /model image.",
    );
    this.name = "NvidiaImageModelUnavailableError";
  }
}

/**
 * Resolve the endpoint URL and request body for one image request.
 *
 * Pure and exported so the per-model body shapes can be unit-tested without issuing HTTP calls.
 * @returns The target URL, the JSON body, and whether the model dropped a supplied negative prompt
 * @throws {NvidiaImageModelUnavailableError} When the codename has no registered spec
 */
export function resolveNvidiaImageRequest(request: ProviderNativeImageGenerationRequest): {
  url: string;
  body: Record<string, unknown>;
  droppedNegativePrompt: boolean;
} {
  const spec = NVIDIA_IMAGE_MODEL_SPECS[request.model];
  if (!spec) {
    throw new NvidiaImageModelUnavailableError(request.model);
  }

  return {
    url: request.endpointUrl || `${NVIDIA_IMAGE_GENERATION_BASE_URL}/${spec.path}`,
    body: spec.buildBody(request),
    droppedNegativePrompt: Boolean(request.negativePrompt) && !spec.supportsNegativePrompt,
  };
}

function extractBase64Image(result: unknown): string | null {
  const record = typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
  if (!record) {
    return null;
  }

  if (typeof record.image === "string") {
    return record.image;
  }

  if (Array.isArray(record.artifacts)) {
    for (const artifact of record.artifacts) {
      if (typeof artifact !== "object" || artifact === null) {
        continue;
      }
      const candidate = artifact as Record<string, unknown>;
      if (typeof candidate.base64 === "string") {
        return candidate.base64;
      }
      if (typeof candidate.b64_json === "string") {
        return candidate.b64_json;
      }
    }
  }

  if (Array.isArray(record.data)) {
    for (const entry of record.data) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.b64_json === "string") {
        return candidate.b64_json;
      }
      if (typeof candidate.base64 === "string") {
        return candidate.base64;
      }
    }
  }

  if (Array.isArray(record.images)) {
    for (const entry of record.images) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.base64 === "string") {
        return candidate.base64;
      }
    }
  }

  return null;
}

function extractImageUrl(result: unknown): string | null {
  const record = typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
  if (!record) {
    return null;
  }

  if (typeof record.url === "string") {
    return record.url;
  }

  if (Array.isArray(record.data)) {
    for (const entry of record.data) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.url === "string") {
        return candidate.url;
      }
    }
  }

  if (Array.isArray(record.images)) {
    for (const entry of record.images) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.url === "string") {
        return candidate.url;
      }
    }
  }

  return null;
}

function extractMimeTypeFromResult(result: unknown): string | null {
  const record = typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
  if (!record) {
    return null;
  }

  if (typeof record.mime_type === "string") {
    return record.mime_type;
  }

  if (typeof record.mimeType === "string") {
    return record.mimeType;
  }

  if (Array.isArray(record.artifacts)) {
    for (const artifact of record.artifacts) {
      if (typeof artifact !== "object" || artifact === null) {
        continue;
      }
      const candidate = artifact as Record<string, unknown>;
      if (typeof candidate.mime_type === "string") {
        return candidate.mime_type;
      }
      if (typeof candidate.mimeType === "string") {
        return candidate.mimeType;
      }
    }
  }

  return null;
}

async function fetchImageUrlAsBase64(imageUrl: string): Promise<ProviderNativeImageGenerationResult> {
  const imageResponse = await safeDownload(imageUrl, {
    maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
    timeoutMs: 15_000,
  });
  if (!imageResponse.success || !imageResponse.buffer) {
    log.error("Failed to fetch NVIDIA generated image URL", new Error(imageResponse.details ?? "download failed"), {
      errorType: "NvidiaImageFetchError",
      metadata: { imageUrl },
    });
    return { imageData: null, mimeType: null };
  }

  const contentType = imageResponse.contentType ?? "image/jpeg";
  const mimeType = contentType.split(";")[0].trim();
  const imageData = imageResponse.buffer.toString("base64");

  return {
    imageData,
    mimeType,
  };
}

export async function generateNvidiaNativeImage(
  request: ProviderNativeImageGenerationRequest,
): Promise<ProviderNativeImageGenerationResult> {
  const { url, body, droppedNegativePrompt } = resolveNvidiaImageRequest(request);

  if (request.referenceImages && request.referenceImages.length > 0) {
    log.warn("NVIDIA image generation currently ignores reference images. Proceeding with text-only generation.", {
      model: request.model,
      referenceCount: request.referenceImages.length,
    });
  }

  if (droppedNegativePrompt) {
    log.warn("NVIDIA image model has no negative-prompt field. Dropping it from the request.", {
      model: request.model,
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, image/jpeg",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error("NVIDIA image generation request failed", new Error(errorBody), {
      errorType: "NvidiaImageGenerationHttpError",
      metadata: {
        model: request.model,
        status: response.status,
        aspectRatio: request.aspectRatio,
      },
    });
    // NVIDIA puts the only actionable detail (retired function, missing account entitlement,
    // rejected dimensions) in the body, so a bare status line strands the user with no next step.
    throw new Error(`NVIDIA image generation failed: ${response.status} ${response.statusText}. ${errorBody}`);
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.toLowerCase().startsWith("image/")) {
    const mimeType = contentType.split(";")[0].trim();
    const imageData = Buffer.from(await response.arrayBuffer()).toString("base64");
    return {
      imageData,
      mimeType,
    };
  }

  const result = (await response.json()) as unknown;
  const base64Image = extractBase64Image(result);
  if (base64Image) {
    return {
      imageData: base64Image,
      mimeType: extractMimeTypeFromResult(result) ?? "image/jpeg",
    };
  }

  const imageUrl = extractImageUrl(result);
  if (imageUrl) {
    return await fetchImageUrlAsBase64(imageUrl);
  }

  log.warn("NVIDIA image generation returned no image payload", {
    model: request.model,
    aspectRatio: request.aspectRatio,
  });
  return {
    imageData: null,
    mimeType: null,
  };
}
