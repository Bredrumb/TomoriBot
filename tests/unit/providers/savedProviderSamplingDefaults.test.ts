import { describe, expect, it } from "bun:test";
import { NVIDIA_MIN_P_UNSUPPORTED_MODELS } from "@/providers/nvidia/nvidiaConstants";
import { resolveSavedProviderDefaultMinP } from "@/utils/provider/samplingControl";

describe("saved provider sampling defaults", () => {
  it("defaults NVIDIA min_p to 0 for new saved provider configs", () => {
    expect(resolveSavedProviderDefaultMinP("nvidia", 0.05)).toBe(0);
  });

  it("preserves an explicit existing NVIDIA min_p value", () => {
    expect(resolveSavedProviderDefaultMinP("nvidia", 0.05, 0.02)).toBe(0.02);
  });

  it("uses the base min_p for other providers", () => {
    expect(resolveSavedProviderDefaultMinP("openrouter", 0.05)).toBe(0.05);
  });

  it("tracks NVIDIA models whose backend rejects min_p", () => {
    expect(NVIDIA_MIN_P_UNSUPPORTED_MODELS.has("nvidia/nemotron-3-ultra-550b-a55b")).toBe(true);
  });
});
