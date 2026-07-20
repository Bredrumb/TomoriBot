import { log } from "@/utils/misc/logger";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";

const OPENROUTER_VIDEO_MODELS_URL = "https://openrouter.ai/api/v1/videos/models";

export type OpenRouterFrameType = "first_frame" | "last_frame";

export interface OpenRouterVideoModelCapabilities {
  id: string;
  supportedResolutions: string[];
  supportedAspectRatios: string[];
  supportedDurations: number[];
  supportedFrameImages: OpenRouterFrameType[];
  generateAudio: boolean | null;
  allowedPassthroughParameters: string[];
}

const videoModelCache = new Map<string, OpenRouterVideoModelCapabilities>();
let cacheReady = false;
let refreshPromise: Promise<boolean> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function readNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    : [];
}

function readFrameTypes(value: unknown): OpenRouterFrameType[] {
  return readStringArray(value).filter(
    (entry): entry is OpenRouterFrameType => entry === "first_frame" || entry === "last_frame",
  );
}

export function parseOpenRouterVideoModelList(payload: unknown): OpenRouterVideoModelCapabilities[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Unexpected OpenRouter video models response: missing data array");
  }

  const models: OpenRouterVideoModelCapabilities[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim().length === 0) {
      continue;
    }

    models.push({
      id: entry.id.trim().toLowerCase(),
      supportedResolutions: readStringArray(entry.supported_resolutions),
      supportedAspectRatios: readStringArray(entry.supported_aspect_ratios),
      supportedDurations: readNumberArray(entry.supported_durations),
      supportedFrameImages: readFrameTypes(entry.supported_frame_images),
      generateAudio: typeof entry.generate_audio === "boolean" ? entry.generate_audio : null,
      allowedPassthroughParameters: readStringArray(entry.allowed_passthrough_parameters),
    });
  }

  return models;
}

async function refreshOpenRouterVideoModelCache(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch(OPENROUTER_VIDEO_MODELS_URL, {
        headers: {
          Accept: "application/json",
          ...buildOpenRouterAttributionHeaders(),
        },
      });
      if (!response.ok) {
        throw new Error(`OpenRouter video models API returned ${response.status}: ${response.statusText}`);
      }

      const models = parseOpenRouterVideoModelList(await response.json());
      const nextCache = new Map(models.map((model) => [model.id, model]));
      if (nextCache.size === 0) {
        throw new Error("OpenRouter video models API returned no usable models");
      }

      videoModelCache.clear();
      for (const [id, model] of nextCache) {
        videoModelCache.set(id, model);
      }
      cacheReady = true;
      log.success(`OpenRouter video model cache initialized: ${videoModelCache.size} models`);
      return true;
    } catch (error) {
      log.warn("Failed to refresh OpenRouter video model cache", error as Error);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function initializeOpenRouterVideoModelCache(): Promise<void> {
  await refreshOpenRouterVideoModelCache();
}

export function getOpenRouterVideoModelCapabilities(
  modelCodename: string,
): OpenRouterVideoModelCapabilities | undefined {
  return videoModelCache.get(modelCodename.trim().toLowerCase());
}

export async function getOrFetchOpenRouterVideoModelCapabilities(
  modelCodename: string,
): Promise<OpenRouterVideoModelCapabilities | undefined> {
  const normalizedCodename = modelCodename.trim().toLowerCase();
  const cached = videoModelCache.get(normalizedCodename);
  if (cached) {
    return cached;
  }

  if (!cacheReady || !videoModelCache.has(normalizedCodename)) {
    await refreshOpenRouterVideoModelCache();
  }

  return videoModelCache.get(normalizedCodename);
}

export function clearOpenRouterVideoModelCache(): void {
  videoModelCache.clear();
  cacheReady = false;
}
