import { describe, expect, it } from "bun:test";
import { NvidiaImageModelUnavailableError, resolveNvidiaImageRequest } from "@/providers/nvidia/nvidiaImageGeneration";
import type { ProviderNativeImageGenerationRequest } from "@/types/provider/featureInterfaces";

const FLUX_MODEL = "black-forest-labs/flux.1-dev";

function createRequest(
  overrides: Partial<ProviderNativeImageGenerationRequest> = {},
): ProviderNativeImageGenerationRequest {
  return {
    apiKey: "test-key",
    model: FLUX_MODEL,
    prompt: "a quiet street at dusk",
    aspectRatio: "1:1",
    ...overrides,
  };
}

describe("NVIDIA image request resolution", () => {
  it("targets the per-function genai gateway rather than the OpenAI-compatible surface", () => {
    const { url } = resolveNvidiaImageRequest(createRequest());
    expect(url).toBe("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev");
  });

  it("honours an explicit endpoint override", () => {
    const { url } = resolveNvidiaImageRequest(createRequest({ endpointUrl: "https://example.test/v1/img" }));
    expect(url).toBe("https://example.test/v1/img");
  });

  it("sends FLUX width/height instead of the retired SD3 aspect_ratio field", () => {
    const { body } = resolveNvidiaImageRequest(createRequest({ aspectRatio: "16:9" }));
    expect(body).toMatchObject({ mode: "text-to-image", width: 1344, height: 768 });
    expect(body).not.toHaveProperty("aspect_ratio");
  });

  it("maps every supported ratio onto a resolution FLUX publishes", () => {
    const published = new Set(["1024x1024", "832x1216", "1216x832", "768x1344", "1344x768"]);
    for (const aspectRatio of ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]) {
      const { body } = resolveNvidiaImageRequest(createRequest({ aspectRatio }));
      expect(published).toContain(`${body.width}x${body.height}`);
    }
  });

  it("falls back to square for an unrecognized ratio", () => {
    const { body } = resolveNvidiaImageRequest(createRequest({ aspectRatio: "7:3" }));
    expect(body).toMatchObject({ width: 1024, height: 1024 });
  });

  it("prefers a caller-supplied cfg over the env default", () => {
    const { body } = resolveNvidiaImageRequest(createRequest({ cfg: 7 }));
    expect(body.cfg_scale).toBe(7);
  });

  it("reports a dropped negative prompt because FLUX has no field for it", () => {
    const { body, droppedNegativePrompt } = resolveNvidiaImageRequest(createRequest({ negativePrompt: "blurry" }));
    expect(droppedNegativePrompt).toBe(true);
    expect(body).not.toHaveProperty("negative_prompt");
  });

  it("does not flag a drop when no negative prompt was supplied", () => {
    expect(resolveNvidiaImageRequest(createRequest()).droppedNegativePrompt).toBe(false);
  });

  it("rejects a codename NVIDIA retired instead of emitting a request that would 404", () => {
    expect(() => resolveNvidiaImageRequest(createRequest({ model: "stabilityai/stable-diffusion-3-medium" }))).toThrow(
      NvidiaImageModelUnavailableError,
    );
  });
});
