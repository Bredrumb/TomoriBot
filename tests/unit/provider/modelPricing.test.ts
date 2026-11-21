import { beforeAll, describe, expect, it } from "bun:test";
import { localizedCopy } from "../../helpers/localeCases";
import { freeModelPriceLabel } from "@/utils/provider/modelPricing";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

const PAID_RATE = { input: 0.75, output: 3.75 };

describe("freeModelPriceLabel", () => {
  it("labels a priced Gemini free-tier model", () => {
    expect(freeModelPriceLabel("en-US", "google", true, PAID_RATE)).toBe(
      localizedCopy("en-US", "commands.providers.model_price_free_tier"),
    );
  });

  it("labels an unpriced free Google model as free", () => {
    expect(freeModelPriceLabel("en-US", "google", true, null)).toBe(
      localizedCopy("en-US", "commands.providers.model_price_free"),
    );
  });

  it("leaves paid-only Gemini models, Vertex, and other providers on their rates", () => {
    expect(freeModelPriceLabel("en-US", "google", false, PAID_RATE)).toBeUndefined();
    expect(freeModelPriceLabel("en-US", "vertex", true, PAID_RATE)).toBeUndefined();
    expect(freeModelPriceLabel("en-US", "nvidia", true, PAID_RATE)).toBeUndefined();
    expect(freeModelPriceLabel("en-US", "nvidia", true, null)).toBeUndefined();
  });
});
