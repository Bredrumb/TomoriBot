import { describe, expect, it } from "bun:test";
import type { CustomEndpointApiStyle, CustomEndpointRow } from "@/types/db/schema";
import {
  imageEndpointSupportsFromSubmittedValues,
  readImageEndpointSupports,
} from "@/utils/provider/customImageEndpointSupport";

function endpoint(
  apiStyle: CustomEndpointApiStyle,
  extraConfig: Record<string, unknown> = {},
): Pick<CustomEndpointRow, "api_style" | "extra_config"> {
  return {
    api_style: apiStyle,
    extra_config: extraConfig,
  };
}

describe("custom image endpoint support metadata", () => {
  it("defaults ComfyUI image endpoints to negative-prompt support", () => {
    expect(readImageEndpointSupports(endpoint("comfyui"))).toEqual({
      txt2img: true,
      img2img: true,
      inpaint: false,
      negative_prompt: true,
    });
  });

  it("defaults generic image endpoints to text-to-image without negative prompts", () => {
    expect(readImageEndpointSupports(endpoint("openai-compatible"))).toEqual({
      txt2img: true,
      img2img: false,
      inpaint: false,
      negative_prompt: false,
    });
  });

  it("reads stored workflow support flags", () => {
    expect(
      readImageEndpointSupports(
        endpoint("comfyui", {
          workflow_supports: {
            txt2img: true,
            img2img: false,
            inpaint: true,
            negative_prompt: false,
          },
        }),
      ),
    ).toEqual({
      txt2img: true,
      img2img: false,
      inpaint: true,
      negative_prompt: false,
    });
  });

  it("keeps text-to-image enabled when only negative prompt is selected", () => {
    expect(imageEndpointSupportsFromSubmittedValues(["negative_prompt"], "openai-compatible")).toEqual({
      txt2img: true,
      img2img: false,
      inpaint: false,
      negative_prompt: true,
    });
  });
});
