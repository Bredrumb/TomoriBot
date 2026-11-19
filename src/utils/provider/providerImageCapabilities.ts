import type { DiffusionModelRow } from "@/types/db/schema";
import type { ImageEndpointSupports } from "@/utils/provider/customImageEndpointSupport";
import { resolveProviderFeatureImplementation } from "@/utils/provider/providerInfoRegistry";

export type DeclaredImageSupports = Pick<
  DiffusionModelRow,
  "supports_txt2img" | "supports_img2img" | "supports_inpaint" | "supports_negative_prompt"
>;

const TEXT_ONLY_IMAGE_SUPPORTS: ImageEndpointSupports = {
  txt2img: true,
  img2img: false,
  inpaint: false,
  negative_prompt: false,
};

const REFERENCE_IMAGE_SUPPORTS: ImageEndpointSupports = {
  txt2img: true,
  img2img: true,
  inpaint: false,
  negative_prompt: false,
};

// Null means "not declarable" (such as NovelAI using its own tool), so callers must not substitute an empty
// capability set.
export function getCuratedProviderImageDefaults(provider: string): ImageEndpointSupports | null {
  const normalizedProvider = provider.trim().toLowerCase();

  if (
    normalizedProvider === "google" ||
    normalizedProvider === "openrouter" ||
    normalizedProvider === "vertex" ||
    normalizedProvider === "vertexexpress"
  ) {
    return { ...REFERENCE_IMAGE_SUPPORTS };
  }

  const implementation = resolveProviderFeatureImplementation(normalizedProvider, "imageGeneration");
  if (implementation === "zai" || implementation === "nvidia") {
    return { ...TEXT_ONLY_IMAGE_SUPPORTS };
  }
  if (implementation === "google" || implementation === "openrouter") {
    return { ...REFERENCE_IMAGE_SUPPORTS };
  }

  return null;
}

// Declaration columns stay nullable so undeclared models track updated provider defaults instead of freezing
// write-time values.
export function resolveCuratedImageSupports(
  provider: string,
  declared?: DeclaredImageSupports | null,
): ImageEndpointSupports | null {
  const defaults = getCuratedProviderImageDefaults(provider);
  if (!defaults) return null;

  return {
    txt2img: declared?.supports_txt2img ?? defaults.txt2img,
    img2img: declared?.supports_img2img ?? defaults.img2img,
    inpaint: declared?.supports_inpaint ?? defaults.inpaint,
    negative_prompt: declared?.supports_negative_prompt ?? defaults.negative_prompt,
  };
}

// Separate from imageEndpointSupportsFromSubmittedValues because that disables inpainting outside ComfyUI, whereas
// curated providers use their own API.
export function curatedImageSupportsFromSubmittedValues(
  values: string[] | undefined,
  provider: string,
): ImageEndpointSupports | null {
  const defaults = getCuratedProviderImageDefaults(provider);
  if (!defaults) return null;

  const selected = new Set(
    values ??
      Object.entries(defaults)
        .filter(([, enabled]) => enabled)
        .map(([support]) => support),
  );
  const hasGenerationMode = selected.has("txt2img") || selected.has("img2img") || selected.has("inpaint");

  return {
    txt2img: hasGenerationMode ? selected.has("txt2img") : true,
    img2img: selected.has("img2img"),
    inpaint: selected.has("inpaint"),
    negative_prompt: selected.has("negative_prompt"),
  };
}
