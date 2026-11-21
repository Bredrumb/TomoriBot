import { describe, expect, it } from "bun:test";
import { NVIDIA_MIN_P_UNSUPPORTED_MODELS } from "@/providers/nvidia/nvidiaConstants";

describe("NVIDIA sampling support", () => {
  it("tracks NVIDIA models whose backend rejects min_p", () => {
    expect(NVIDIA_MIN_P_UNSUPPORTED_MODELS.has("nvidia/nemotron-3-ultra-550b-a55b")).toBe(true);
  });
});
