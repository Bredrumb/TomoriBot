import type { TomoriState } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";

export interface ModelPricing {
  input: number;
  output: number;
}

interface PricedModelRow {
  input_price_per_million?: number | null;
  output_price_per_million?: number | null;
}

/**
 * Per-million input and output prices from a catalog row, seeded from the typed catalog
 * (`src/db/seed/catalog/models.ts`). OpenRouter rows are refreshed from the live rates at startup.
 * A model with no catalog price resolves to null, so callers report pricing as unavailable instead
 * of guessing a rate.
 */
export function resolveRowPricing(row: PricedModelRow): ModelPricing | null {
  const input = row.input_price_per_million;
  const output = row.output_price_per_million;
  if (typeof input === "number" && typeof output === "number") {
    return { input, output };
  }
  return null;
}

export function resolveModelPricing(tomoriState: TomoriState): ModelPricing | null {
  return resolveRowPricing(tomoriState.llm);
}

export function formatUsdRate(value: number): string {
  if (value < 0.01) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * Token and character units are priced per million; the rest per single unit.
 * @public Release-only `src/modules/supporter-billing/discord/modelCosts.ts` imports this.
 */
export type MediaPriceUnit = "image" | "image_token" | "video_second" | "video_token" | "character" | "audio_second";

export interface MediaRate {
  unit: MediaPriceUnit;
  price: number;
}

export type ChoicePricing = ModelPricing | readonly MediaRate[];

const MEDIA_RATE_KEYS: Record<MediaPriceUnit, string> = {
  image: "commands.providers.model_price_per_image",
  image_token: "commands.providers.model_price_image_tokens",
  video_second: "commands.providers.model_price_per_video_second",
  video_token: "commands.providers.model_price_video_tokens",
  character: "commands.providers.model_price_characters",
  audio_second: "commands.providers.model_price_per_audio_second",
};

export function formatModelPricing(locale: string, pricing: ChoicePricing): string {
  if (isMediaRates(pricing)) {
    const billed = pricing.filter((rate) => rate.price > 0);
    if (billed.length === 0) return localizer(locale, "commands.providers.model_price_free");
    return billed
      .map((rate) => localizer(locale, MEDIA_RATE_KEYS[rate.unit], { price: formatUsdRate(rate.price) }))
      .join(", ");
  }
  if (pricing.input === 0 && pricing.output === 0) {
    return localizer(locale, "commands.providers.model_price_free");
  }
  return localizer(locale, "commands.providers.model_price_tokens", {
    input: formatUsdRate(pricing.input),
    output: formatUsdRate(pricing.output),
  });
}

/**
 * NVIDIA and custom free endpoints also set is_free, so the labels are scoped to Gemini AI, where an
 * unpriced free row is Gemma and has no paid tier.
 */
export function freeModelPriceLabel(
  locale: string,
  provider: string,
  isFree: boolean,
  pricing: ChoicePricing | null,
): string | undefined {
  if (!isFree || provider.toLowerCase() !== "google") return undefined;
  const key = pricing ? "commands.providers.model_price_free_tier" : "commands.providers.model_price_free";
  return localizer(locale, key);
}

function isMediaRates(pricing: ChoicePricing): pricing is readonly MediaRate[] {
  return Array.isArray(pricing);
}
