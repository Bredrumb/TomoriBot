import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { formatModelPricing, type ChoicePricing } from "@/utils/provider/modelPricing";
import { providerOptionModelDescription } from "@/utils/provider/providerOptionRegistry";
import { localizer } from "@/utils/text/localizer";

export interface ModelSelectChoice {
  id: number;
  name: string;
  description?: string | null;
  pricing?: ChoicePricing | null;
  isDefault?: boolean;
  priceLabel?: string | null;
}

/** The price leads because Discord truncates option descriptions at 100 characters. */
export function modelOptionDetail(
  locale: string,
  provider: string,
  choice: Pick<ModelSelectChoice, "description" | "pricing" | "priceLabel">,
): string | undefined {
  const price =
    choice.priceLabel !== undefined
      ? choice.priceLabel
      : choice.pricing
        ? formatModelPricing(locale, choice.pricing)
        : null;
  const description = choice.description || providerOptionModelDescription(locale, provider);
  return [price, description].filter(Boolean).join(" · ") || undefined;
}

export function buildModelSelectOption(
  locale: string,
  provider: string,
  choice: ModelSelectChoice,
  currentModelId: number | null,
) {
  const detail = modelOptionDetail(locale, provider, choice);
  return {
    value: String(choice.id),
    label: safeSelectOptionText(
      choice.isDefault
        ? localizer(locale, "commands.providers.model_default_label", { model: choice.name })
        : choice.name,
      100,
    ),
    description: detail ? safeSelectOptionText(detail, 100) : undefined,
    default: choice.id === currentModelId,
  };
}
