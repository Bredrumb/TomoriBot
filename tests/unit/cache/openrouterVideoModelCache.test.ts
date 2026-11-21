import { describe, expect, it } from "bun:test";
import { parseOpenRouterVideoModelList } from "@/utils/cache/openrouterVideoModelCache";

describe("OpenRouter video model metadata parsing", () => {
  it("parses the stable video model capability fields", () => {
    expect(
      parseOpenRouterVideoModelList({
        data: [
          {
            id: "Google/Veo-Test",
            supported_resolutions: ["720p", "1080p"],
            supported_aspect_ratios: ["16:9", "9:16"],
            supported_durations: [4, 6, 8],
            supported_frame_images: ["first_frame", "last_frame", "unknown"],
            generate_audio: true,
            allowed_passthrough_parameters: ["negativePrompt"],
          },
        ],
      }),
    ).toEqual([
      {
        id: "google/veo-test",
        supportedResolutions: ["720p", "1080p"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedDurations: [4, 6, 8],
        supportedFrameImages: ["first_frame", "last_frame"],
        generateAudio: true,
        allowedPassthroughParameters: ["negativePrompt"],
      },
    ]);
  });

  it("rejects responses without a data array", () => {
    expect(() => parseOpenRouterVideoModelList({ error: "unavailable" })).toThrow("missing data array");
  });
});
