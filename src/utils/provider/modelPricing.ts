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

export function formatPricePerMillion(value: number): string {
  if (value < 0.01) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatModelPricing(locale: string, pricing: ModelPricing): string {
  if (pricing.input === 0 && pricing.output === 0) {
    return localizer(locale, "commands.providers.model_price_free");
  }
  return localizer(locale, "commands.providers.model_price_tokens", {
    input: formatPricePerMillion(pricing.input),
    output: formatPricePerMillion(pricing.output),
  });
}
