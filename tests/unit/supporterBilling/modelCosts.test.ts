import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";
import { describeSupporterModelChoices, formatRatio, unitCost } from "@/modules/supporter-billing/discord/modelCosts";
import * as supporterFunding from "@/modules/supporter-billing/runtime/funding";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

function stubTierDefaults(defaults: Record<string, unknown> | null): void {
  const spy = spyOn(supporterFunding, "resolveSupporterFunding").mockResolvedValue(
    (defaults
      ? { ok: true, tier: { defaultModelByCapability: defaults } }
      : { ok: false, reason: "missing_subscription" }) as never,
  );
  restores.push(() => spy.mockRestore());
}

const SCOPE = { kind: "personal" as const, ownerId: 4 };

describe("subscription model cost ratios", () => {
  it("weights text input by measured reply shape and marks the tier default", async () => {
    stubTierDefaults({ text: "deepseek/deepseek-v4-flash" });
    const costs = await describeSupporterModelChoices({
      scope: SCOPE,
      capability: "text",
      locale: "en-US",
      choices: [
        { id: 1, name: "deepseek/deepseek-v4-flash", pricing: { input: 0.1, output: 0.5 } },
        { id: 2, name: "pricier/model", pricing: { input: 0.3, output: 1.5 } },
        { id: 3, name: "free/model:free", pricing: { input: 0, output: 0 } },
        { id: 4, name: "unpriced/model", pricing: null },
      ],
    });
    expect(costs.get(1)).toEqual({ priceLabel: null, isDefault: true });
    expect(costs.get(2)).toEqual({
      priceLabel: localizedCopy("en-US", "commands.providers.subscription_model_allowance", { ratio: "3" }),
      isDefault: false,
    });
    expect(costs.get(3)?.priceLabel).toBe(localizedCopy("en-US", "commands.providers.model_price_free"));
    expect(costs.get(4)).toEqual({ priceLabel: null, isDefault: false });
  });

  it("hides every price when the scope has no subscription tier", async () => {
    stubTierDefaults(null);
    const costs = await describeSupporterModelChoices({
      scope: SCOPE,
      capability: "text",
      locale: "en-US",
      choices: [{ id: 1, name: "deepseek/deepseek-v4-flash", pricing: { input: 0.1, output: 0.5 } }],
    });
    expect(costs.get(1)).toEqual({ priceLabel: null, isDefault: false });
  });

  it("compares the voice slot against its own design or clone default", async () => {
    stubTierDefaults({ text: "x/y", voice: { design: "bytedance-seed/seed-audio-1-0", clone: "fish-audio/s2.1-pro" } });
    const costs = await describeSupporterModelChoices({
      scope: SCOPE,
      capability: "speech-clone",
      locale: "en-US",
      choices: [
        {
          id: 7,
          name: "fish-audio/s2.1-pro",
          pricing: [
            { unit: "character", price: 15 },
            { unit: "audio_second", price: 0 },
          ],
        },
        {
          id: 8,
          name: "fish-audio/drama-3",
          pricing: [
            { unit: "character", price: 2 },
            { unit: "audio_second", price: 0 },
          ],
        },
      ],
    });
    expect(costs.get(7)?.isDefault).toBe(true);
    expect(costs.get(8)?.priceLabel).toBe(
      localizedCopy("en-US", "commands.providers.subscription_model_allowance", { ratio: "0.1" }),
    );
  });

  it("converts image and video tokens to per-generation units only when the count is known", () => {
    expect(unitCost("google/gemini-2.5-flash-image", [{ unit: "image_token", price: 30 }])).toEqual({
      unit: "image",
      value: (30 / 1_000_000) * 1_290,
    });
    expect(unitCost("openai/gpt-5.4-image-2", [{ unit: "image_token", price: 30 }])).toBeNull();
    expect(unitCost("bytedance/seedance-1-5-pro", [{ unit: "video_token", price: 2.4 }])?.unit).toBe("video_second");
    expect(
      unitCost("mixed/speech", [
        { unit: "character", price: 15 },
        { unit: "audio_second", price: 0.002 },
      ]),
    ).toBeNull();
  });

  it("formats ratios with each locale's number style", () => {
    expectForEveryLocale((locale) => {
      expect(formatRatio(locale, 2.54)).toBe(new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(2.5));
      expect(formatRatio(locale, 0.043)).toBe(new Intl.NumberFormat(locale).format(0.04));
      expect(formatRatio(locale, 18.4)).toBe("18");
    });
  });
});
