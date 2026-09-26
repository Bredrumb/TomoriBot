import type { CustomEndpointApiStyle, CustomEndpointRow } from "@/types/db/schema";

export interface ImageEndpointSupports {
  txt2img: boolean;
  img2img: boolean;
  inpaint: boolean;
  negative_prompt: boolean;
}

const COMFYUI_DEFAULT_IMAGE_SUPPORTS: ImageEndpointSupports = {
  txt2img: true,
  img2img: true,
  inpaint: false,
  negative_prompt: true,
};

const GENERIC_DEFAULT_IMAGE_SUPPORTS: ImageEndpointSupports = {
  txt2img: true,
  img2img: false,
  inpaint: false,
  negative_prompt: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBooleanField(record: Record<string, unknown> | null, fieldName: string, fallback: boolean): boolean {
  const value = record?.[fieldName];
  return typeof value === "boolean" ? value : fallback;
}

function readNegativePromptSupport(record: Record<string, unknown> | null, fallback: boolean): boolean {
  if (!record) {
    return fallback;
  }

  if (typeof record.negative_prompt === "boolean") {
    return record.negative_prompt;
  }
  if (typeof record.negativePrompt === "boolean") {
    return record.negativePrompt;
  }
  if (typeof record.supports_negative_prompt === "boolean") {
    return record.supports_negative_prompt;
  }

  return fallback;
}

function readImageSupportRecord(extraConfig: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(extraConfig.workflow_supports)) {
    return extraConfig.workflow_supports;
  }
  if (isRecord(extraConfig.image_modes)) {
    return extraConfig.image_modes;
  }

  return null;
}

export function getDefaultImageEndpointSupports(apiStyle: CustomEndpointApiStyle): ImageEndpointSupports {
  return { ...(apiStyle === "comfyui" ? COMFYUI_DEFAULT_IMAGE_SUPPORTS : GENERIC_DEFAULT_IMAGE_SUPPORTS) };
}

export function readImageEndpointSupports(
  endpoint: Pick<CustomEndpointRow, "api_style" | "extra_config">,
): ImageEndpointSupports {
  const defaults = getDefaultImageEndpointSupports(endpoint.api_style);
  const supportRecord = readImageSupportRecord(endpoint.extra_config as Record<string, unknown>);

  return {
    txt2img: readBooleanField(supportRecord, "txt2img", defaults.txt2img),
    img2img: readBooleanField(supportRecord, "img2img", defaults.img2img),
    inpaint: endpoint.api_style === "comfyui" ? readBooleanField(supportRecord, "inpaint", defaults.inpaint) : false,
    negative_prompt: readNegativePromptSupport(supportRecord, defaults.negative_prompt),
  };
}

export function imageEndpointSupportsFromSubmittedValues(
  values: string[] | undefined,
  apiStyle: CustomEndpointApiStyle,
): ImageEndpointSupports {
  const defaults = getDefaultImageEndpointSupports(apiStyle);
  const selected = new Set(
    values ??
      Object.entries(defaults)
        .filter(([, enabled]) => enabled)
        .map(([support]) => support),
  );
  const inpaint = apiStyle === "comfyui" && selected.has("inpaint");
  const hasGenerationMode = selected.has("txt2img") || selected.has("img2img") || inpaint;

  return {
    txt2img: hasGenerationMode ? selected.has("txt2img") : true,
    img2img: selected.has("img2img"),
    inpaint,
    negative_prompt: selected.has("negative_prompt"),
  };
}
