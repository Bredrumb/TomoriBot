import type { SupporterCapability } from "@/modules/supporter-billing/config";
import { resolveSupporterFunding } from "@/modules/supporter-billing/runtime/funding";
import { NANO_BANANA_1K_IMAGE_TOKENS } from "@/modules/supporter-billing/runtime/spendEstimates";
import { normalizeOpenRouterCodename } from "@/utils/cache/openrouterCatalog";
import type { ChoicePricing, MediaPriceUnit, MediaRate } from "@/utils/provider/modelPricing";
import type {
  ProviderOptionCapability,
  ProviderOptionModelChoicesInput,
  ProviderOptionModelCost,
} from "@/utils/provider/providerOptionRegistry";
import { localizer } from "@/utils/text/localizer";

// Measured from 274 subscription text replies (4.53M input, 178K output tokens); remeasure when the default text model changes.
const TEXT_INPUT_TOKENS_PER_OUTPUT_TOKEN = 25;

/**
 * Output-image tokens per image at each model's 1K default, since requests send no size; token-priced
 * models absent here show no ratio (GPT Image's "auto" quality spans roughly 270-23,700 tokens).
 */
const IMAGE_TOKENS_PER_IMAGE: Readonly<Record<string, number>> = {
  "google/gemini-2.5-flash-image": 1_290,
  "google/gemini-3-pro-image": 1_120,
  "google/gemini-3-pro-image-preview": 1_120,
  "google/gemini-3.1-flash-image": 1_120,
  "google/gemini-3.1-flash-image-preview": 1_120,
  "google/gemini-nano-banana-2.1": NANO_BANANA_1K_IMAGE_TOKENS,
};

// Seedance bills (pixels x frames) / 1024 tokens; at the default 720p 16:9 and 24 fps that is 21,600 tokens per second.
const VIDEO_TOKENS_PER_SECOND = (1280 * 720 * 24) / 1024;

interface UnitCost {
  unit: "reply" | "image" | "video_second" | "character" | "audio_second";
  value: number;
}

export async function describeSupporterModelChoices(
  input: ProviderOptionModelChoicesInput,
): Promise<ReadonlyMap<number, ProviderOptionModelCost>> {
  const defaultCodename = await resolveTierDefault(input.scope, input.capability);
  const normalizedDefault = defaultCodename ? normalizeOpenRouterCodename(defaultCodename) : null;
  const baseline = input.choices.find((choice) => normalizeOpenRouterCodename(choice.name) === normalizedDefault);
  const baselineCost = baseline ? unitCost(baseline.name, baseline.pricing) : null;

  const costs = new Map<number, ProviderOptionModelCost>();
  for (const choice of input.choices) {
    const isDefault = choice === baseline;
    const cost = unitCost(choice.name, choice.pricing);
    let priceLabel: string | null = null;
    if (!isDefault && cost?.value === 0) {
      priceLabel = localizer(input.locale, "commands.providers.model_price_free");
    } else if (!isDefault && cost && baselineCost && cost.unit === baselineCost.unit && baselineCost.value > 0) {
      priceLabel = localizer(input.locale, "commands.providers.subscription_model_allowance", {
        ratio: formatRatio(input.locale, cost.value / baselineCost.value),
      });
    }
    costs.set(choice.id, { priceLabel, isDefault });
  }
  return costs;
}

async function resolveTierDefault(
  scope: ProviderOptionModelChoicesInput["scope"],
  capability: ProviderOptionCapability,
): Promise<string | null> {
  const supporterCapability = toSupporterCapability(capability);
  if (!supporterCapability) return null;
  const funding = await resolveSupporterFunding({
    scope:
      scope.kind === "personal"
        ? { kind: "personal", userId: scope.ownerId }
        : { kind: "server", serverId: scope.ownerId },
    capability: supporterCapability,
  });
  if (!funding.ok) return null;
  const defaults = funding.tier.defaultModelByCapability;
  if (capability === "speech-design") return defaults.voice?.design ?? null;
  if (capability === "speech-clone") return defaults.voice?.clone ?? null;
  return defaults[supporterCapability as Exclude<SupporterCapability, "voice">] ?? null;
}

function toSupporterCapability(capability: ProviderOptionCapability): SupporterCapability | null {
  switch (capability) {
    case "text":
    case "vision":
    case "image":
    case "video":
    case "decision":
    case "embedding":
      return capability;
    case "speech-design":
    case "speech-clone":
      return "voice";
    default:
      return null;
  }
}

/** Reduces a price to one comparable unit; mixed or unconvertible units resolve null, so no ratio is shown. */
export function unitCost(codename: string, pricing: ChoicePricing | null | undefined): UnitCost | null {
  if (!pricing) return null;
  if (!isMediaRates(pricing)) {
    return { unit: "reply", value: pricing.input * TEXT_INPUT_TOKENS_PER_OUTPUT_TOKEN + pricing.output };
  }
  const billed = pricing.filter((rate) => rate.price > 0);
  if (billed.length === 0) return pricing.length > 0 ? { unit: toUnit(pricing[0].unit), value: 0 } : null;
  if (billed.length > 1) return null;
  const [rate] = billed;
  switch (rate.unit) {
    case "image_token": {
      const tokens = IMAGE_TOKENS_PER_IMAGE[normalizeOpenRouterCodename(codename)];
      return tokens ? { unit: "image", value: (rate.price / 1_000_000) * tokens } : null;
    }
    case "video_token":
      return { unit: "video_second", value: (rate.price / 1_000_000) * VIDEO_TOKENS_PER_SECOND };
    default:
      return { unit: toUnit(rate.unit), value: rate.price };
  }
}

function isMediaRates(pricing: ChoicePricing): pricing is readonly MediaRate[] {
  return Array.isArray(pricing);
}

function toUnit(unit: MediaPriceUnit): UnitCost["unit"] {
  switch (unit) {
    case "image":
    case "image_token":
      return "image";
    case "video_second":
    case "video_token":
      return "video_second";
    case "character":
      return "character";
    case "audio_second":
      return "audio_second";
  }
}

export function formatRatio(locale: string, ratio: number): string {
  const options: Intl.NumberFormatOptions =
    ratio < 1 ? { maximumSignificantDigits: 1 } : { maximumFractionDigits: ratio < 10 ? 1 : 0 };
  return new Intl.NumberFormat(locale, options).format(ratio);
}
