import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";
import { llmModelRepo } from "@/utils/db/repositories";
import { diffusionModelSchema } from "@/types/db/schema";
import { formatModelPricing } from "@/utils/provider/modelPricing";
import {
  cachedOpenRouterMediaRates,
  openRouterImageRates,
  openRouterSpeechRates,
  openRouterVideoRates,
  warmOpenRouterMediaPricing,
} from "@/utils/provider/openrouterMediaPricing";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => fetchSpy?.mockRestore());

describe("OpenRouter media rates", () => {
  it("prices video at the default resolution and falls back to the resolution-free SKU", () => {
    expect(
      openRouterVideoRates("alibaba/wan-2.6", {
        text_to_video_duration_seconds_480p: "0.04",
        text_to_video_duration_seconds_720p: "0.08",
        image_to_video_duration_seconds_720p: "0.10",
      }),
    ).toEqual([{ unit: "video_second", price: 0.08 }]);
    expect(
      openRouterVideoRates("minimax/hailuo-3-max", {
        duration_seconds: "0.08",
        duration_seconds_480p: "0.05",
        duration_seconds_768p: "0.08",
      }),
    ).toEqual([{ unit: "video_second", price: 0.08 }]);
    expect(
      openRouterVideoRates("x-ai/grok-imagine-video-1.5-lite", {
        cents_per_image_input: "1",
        cents_per_video_output_second_480p: "2",
        cents_per_video_output_second_720p: "3",
      }),
    ).toEqual([{ unit: "video_second", price: 0.02 }]);
    expect(
      openRouterVideoRates("google/veo-3.1", {
        duration_seconds_with_audio: "0.40",
        duration_seconds_without_audio: "0.20",
        duration_seconds_with_audio_4k: "0.60",
      }),
    ).toEqual([{ unit: "video_second", price: 0.4 }]);
    expect(
      openRouterVideoRates("bytedance/seedance-1-5-pro", {
        video_tokens: "0.0000024",
        video_tokens_without_audio: "0.0000012",
      }),
    ).toEqual([{ unit: "video_token", price: 2.4 }]);
  });

  it("shows no video price when no output-length SKU is recognized", () => {
    expect(
      openRouterVideoRates("black-forest-labs/flux-video-upscale", {
        cents_per_megapixel_second_precise: "3.5",
      }),
    ).toBeNull();
    expect(openRouterVideoRates("runway/gen-4.5", undefined)).toBeNull();
  });

  it("uses the highest output-image rate across endpoints", () => {
    expect(
      openRouterImageRates([
        { pricing: [{ billable: "output_image", unit: "token", cost_usd: 0.000066 }] },
        { pricing: [{ billable: "output_image", unit: "token", cost_usd: 0.00006 }] },
      ]),
    ).toEqual([{ unit: "image_token", price: 66 }]);
    expect(
      openRouterImageRates([
        {
          pricing: [
            { billable: "output_image", unit: "image", cost_usd: 0.04 },
            { billable: "input_image", unit: "image", cost_usd: 0 },
          ],
        },
      ]),
    ).toEqual([{ unit: "image", price: 0.04 }]);
    expect(openRouterImageRates([{ pricing: [{ billable: "output_image", unit: "megapixel", cost_usd: 1 }] }])).toBe(
      null,
    );
  });

  it("prices speech per character and per output second", () => {
    expect(openRouterSpeechRates({ prompt: "0.000015", completion: "0" })).toEqual([
      { unit: "character", price: 15 },
      { unit: "audio_second", price: 0 },
    ]);
    expect(openRouterSpeechRates({ prompt: "0", completion: "0.0025" })).toEqual([
      { unit: "character", price: 0 },
      { unit: "audio_second", price: 0.0025 },
    ]);
  });

  it("formats billed media rates and calls zero-priced media free in every locale", () => {
    expectForEveryLocale((locale) => {
      expect(
        formatModelPricing(locale, [
          { unit: "character", price: 15 },
          { unit: "audio_second", price: 0 },
        ]),
      ).toBe(localizedCopy(locale, "commands.providers.model_price_characters", { price: "$15.00" }));
      expect(formatModelPricing(locale, [{ unit: "character", price: 0 }])).toBe(
        localizedCopy(locale, "commands.providers.model_price_free"),
      );
    });
  });

  it("never fetches while a picker reads prices, and serves what the warm-up cached", async () => {
    const requested: string[] = [];
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          requested.push(String(input));
          if (String(input).includes("output_modalities=speech")) {
            return Response.json({
              data: [{ id: "fish-audio/s2.1-pro", pricing: { prompt: "0.000015", completion: "0" } }],
            });
          }
          return Response.json({
            id: "test/cold-image",
            endpoints: [{ pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.03 }] }],
          });
        },
        { preconnect: () => undefined },
      ),
    );
    const diffusion = spyOn(llmModelRepo, "loadAvailableDiffusionModels").mockResolvedValue([
      diffusionModelSchema.parse({ diffusion_model_id: 41, provider: "openrouter", codename: "test/cold-image" }),
    ]);
    try {
      expect(cachedOpenRouterMediaRates("image", "test/cold-image")).toBeNull();
      expect(cachedOpenRouterMediaRates("video", "test/cold-video")).toBeNull();
      expect(requested).toEqual([]);

      await warmOpenRouterMediaPricing();
      expect(cachedOpenRouterMediaRates("image", "test/cold-image")).toEqual([{ unit: "image", price: 0.03 }]);
    } finally {
      diffusion.mockRestore();
    }
  });
});
