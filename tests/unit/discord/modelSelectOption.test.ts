import { beforeAll, describe, expect, it } from "bun:test";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";
import { buildModelSelectOption } from "@/utils/discord/ui/modelSelectOption";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

const LONG_DESCRIPTION = "A capable general model for roleplay, long conversations, and tool calling. ".repeat(3);

describe("buildModelSelectOption", () => {
  it("leads with the token price and marks the default in every locale", () => {
    expectForEveryLocale((locale) => {
      const option = buildModelSelectOption(
        locale,
        "openrouter",
        {
          id: 7,
          name: "deepseek/deepseek-v4-flash",
          description: LONG_DESCRIPTION,
          pricing: { input: 0.14, output: 2.5 },
          isDefault: true,
        },
        7,
      );
      const price = localizedCopy(locale, "commands.providers.model_price_tokens", {
        input: "$0.140",
        output: "$2.50",
      });
      expect(option.label).toBe(
        localizedCopy(locale, "commands.providers.model_default_label", { model: "deepseek/deepseek-v4-flash" }),
      );
      expect(option.description?.startsWith(price)).toBe(true);
      expect(option.description?.length).toBeLessThanOrEqual(100);
      expect(option.default).toBe(true);
    });
  });

  it("labels zero-priced models as free", () => {
    const option = buildModelSelectOption(
      "en-US",
      "openrouter",
      { id: 1, name: "free-model", description: null, pricing: { input: 0, output: 0 } },
      null,
    );
    expect(option.description).toBe(localizedCopy("en-US", "commands.providers.model_price_free"));
    expect(option.label).toBe("free-model");
  });

  it("shows an explicit price label in place of the catalog rate", () => {
    const label = localizedCopy("en-US", "commands.providers.model_price_free_tier");
    const option = buildModelSelectOption(
      "en-US",
      "google",
      {
        id: 3,
        name: "gemini-3.8-flash",
        description: "Fast model",
        pricing: { input: 0.75, output: 3.75 },
        priceLabel: label,
      },
      null,
    );
    expect(option.description?.startsWith(label)).toBe(true);
    expect(option.description?.endsWith("Fast model")).toBe(true);
  });

  it("omits the description when a model has neither a price nor a description", () => {
    const option = buildModelSelectOption("en-US", "google", { id: 2, name: "unpriced", description: null }, null);
    expect(option.description).toBeUndefined();
  });
});
