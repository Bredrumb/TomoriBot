import { z } from "zod";
import { getDefaultOpenRouterVideoResolution } from "@/providers/openrouter/openrouterVideoRequest";
import { openRouterPriceSchema } from "@/utils/cache/openrouterCatalog";
import {
  getCachedOpenRouterImageEndpoints,
  getOrFetchOpenRouterImageEndpoints,
} from "@/utils/cache/openrouterImageModelCache";
import {
  getCachedOpenRouterSpeechModel,
  refreshOpenRouterSpeechModelCacheIfStale,
} from "@/utils/cache/openrouterSpeechModelCache";
import { getCachedOpenRouterVideoModelCapabilities } from "@/utils/cache/openrouterVideoModelCache";
import { llmModelRepo } from "@/utils/db/repositories";
import type { MediaRate } from "@/utils/provider/modelPricing";

export type OpenRouterMediaKind = "image" | "video" | "speech";

const skuRatesSchema = z.record(z.string(), openRouterPriceSchema);
const speechRatesSchema = z.object({
  prompt: openRouterPriceSchema.optional(),
  completion: openRouterPriceSchema.optional(),
});

// Output-length SKUs only: reference-image, video-input, continuation, and megapixel SKUs bill optional extras.
const VIDEO_SECOND_SKUS = new Set([
  "cents_per_video_output_second",
  "cents_per_second_output",
  "duration_seconds",
  "duration_seconds_with_audio",
  "duration_seconds_without_audio",
  "text_to_video_duration_seconds",
]);

/**
 * Reads only what the OpenRouter caches already hold, because model pickers open as modals inside
 * Discord's 3-second acknowledgement window; `warmOpenRouterMediaPricing` fills them off that path.
 */
export function cachedOpenRouterMediaRates(kind: OpenRouterMediaKind, codename: string): MediaRate[] | null {
  switch (kind) {
    case "image": {
      const endpoints = getCachedOpenRouterImageEndpoints(codename);
      return endpoints ? openRouterImageRates(endpoints) : null;
    }
    case "video": {
      const model = getCachedOpenRouterVideoModelCapabilities(codename);
      return model ? openRouterVideoRates(codename, model.pricing) : null;
    }
    case "speech": {
      const model = getCachedOpenRouterSpeechModel(codename);
      return model ? openRouterSpeechRates(model.pricing) : null;
    }
  }
}

/**
 * Warms catalog image prices and the speech list (video prices arrive with the video catalog);
 * member-registered image models are skipped, so warm scoped rows too if their missing prices matter.
 */
export async function warmOpenRouterMediaPricing(): Promise<void> {
  const images = (await llmModelRepo.loadAvailableDiffusionModels("openrouter")) ?? [];
  await Promise.all([
    refreshOpenRouterSpeechModelCacheIfStale(),
    ...images.map((model) => getOrFetchOpenRouterImageEndpoints(model.codename)),
  ]);
}

export function openRouterMediaRates(provider: string, kind: OpenRouterMediaKind, codename: string) {
  return provider === "openrouter" ? cachedOpenRouterMediaRates(kind, codename) : null;
}

export function openRouterImageRates(
  endpoints: ReadonlyArray<{ pricing: ReadonlyArray<{ billable: string; unit: string; cost_usd: number }> }>,
): MediaRate[] | null {
  let perImage: number | undefined;
  let perMillionTokens: number | undefined;
  for (const endpoint of endpoints) {
    for (const price of endpoint.pricing) {
      if (price.billable !== "output_image") continue;
      if (price.unit === "image") perImage = Math.max(perImage ?? 0, price.cost_usd);
      else if (price.unit === "token") perMillionTokens = Math.max(perMillionTokens ?? 0, price.cost_usd * 1_000_000);
      else return null;
    }
  }
  const rates: MediaRate[] = [];
  if (perImage !== undefined) rates.push({ unit: "image", price: perImage });
  if (perMillionTokens !== undefined) rates.push({ unit: "image_token", price: perMillionTokens });
  return rates.length > 0 ? rates : null;
}

/**
 * Prices video at the resolution the generate tool requests by default, falling back to the
 * resolution-free SKU; the highest matching rate wins so audio-included pricing is never understated.
 */
export function openRouterVideoRates(codename: string, pricing: unknown): MediaRate[] | null {
  const parsed = skuRatesSchema.safeParse(pricing);
  if (!parsed.success) return null;
  const skus = parsed.data;
  if (skus.video_tokens !== undefined) return [{ unit: "video_token", price: skus.video_tokens * 1_000_000 }];

  const resolution = getDefaultOpenRouterVideoResolution(codename);
  let atResolution: number | undefined;
  let unsuffixed: number | undefined;
  for (const [sku, value] of Object.entries(skus)) {
    const match = sku.match(/^(.+?)(?:_(\d+[pk]))?$/i);
    if (!match || !VIDEO_SECOND_SKUS.has(match[1])) continue;
    const perSecond = match[1].startsWith("cents_") ? value / 100 : value;
    const suffix = match[2]?.toLowerCase();
    if (!suffix) unsuffixed = Math.max(unsuffixed ?? 0, perSecond);
    else if (suffix === resolution) atResolution = Math.max(atResolution ?? 0, perSecond);
  }
  const perSecond = atResolution ?? unsuffixed;
  return perSecond === undefined ? null : [{ unit: "video_second", price: perSecond }];
}

export function openRouterSpeechRates(pricing: unknown): MediaRate[] | null {
  const parsed = speechRatesSchema.safeParse(pricing);
  if (!parsed.success) return null;
  return [
    { unit: "character", price: (parsed.data.prompt ?? 0) * 1_000_000 },
    { unit: "audio_second", price: parsed.data.completion ?? 0 },
  ];
}
