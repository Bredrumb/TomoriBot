import type {
  ProviderNativeImageGenerationRequest,
  ProviderNativeImageGenerationResult,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { NVIDIA_IMAGE_GENERATION_BASE_URL } from "@/providers/nvidia/nvidiaConstants";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { readProviderErrorBody } from "@/utils/provider/providerErrorMetrics";

const FLUX_STEPS = 30;

const FLUX_CFG_SCALE = 3.5;

interface ImageDimensions {
  width: number;
  height: number;
}

// Ratios map to the nearest of FLUX.1-dev's five published resolutions because NVIDIA rejects arbitrary dimensions
// with HTTP 400.
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
  path: string;
  supportsNegativePrompt: boolean;
  buildBody: (request: ProviderNativeImageGenerationRequest) => Record<string, unknown>;
}

// Each NVIDIA image model keeps its own spec because NVIDIA never normalized upstream request schemas across models,
// so a shared body cannot serve new models.
const NVIDIA_IMAGE_MODEL_SPECS: Record<string, NvidiaImageModelSpec> = {
  "black-forest-labs/flux.1-dev": {
    path: "black-forest-labs/flux.1-dev",
    supportsNegativePrompt: false,
    buildBody: (request) => {
      const dimensions = FLUX_DIMENSIONS[request.aspectRatio] ?? FLUX_DIMENSIONS["1:1"];
      return {
        prompt: request.prompt,
        mode: "base",
        cfg_scale: request.cfg ?? FLUX_CFG_SCALE,
        width: dimensions.width,
        height: dimensions.height,
        steps: FLUX_STEPS,
      };
    },
  },
};

export class NvidiaImageModelUnavailableError extends Error {
  constructor(readonly model: string) {
    super(
      `NVIDIA image model "${model}" is no longer available. NVIDIA retired it from their hosted catalog. ` +
        "Pick a current model with /model image.",
    );
    this.name = "NvidiaImageModelUnavailableError";
  }
}

// Kept pure and exported so tests can verify per-model request bodies without issuing HTTP calls.
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
    const errorBody = await readProviderErrorBody(response, request.apiKey);
    // NVIDIA puts the only actionable detail (retired function, missing account entitlement,
    // rejected dimensions) in the body, so a bare status line strands the user with no next step.
    throw Object.assign(
      new Error(`NVIDIA image generation failed: ${response.status} ${response.statusText}. ${errorBody}`),
      {
        status: response.status,
      },
    );
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
