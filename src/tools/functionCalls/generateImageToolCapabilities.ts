import type { CustomEndpointRow } from "@/types/db/schema";
import type { ToolAssemblyState } from "@/types/tool/interfaces";
import { sql } from "@/utils/db/client";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";
import { log } from "@/utils/misc/logger";
import { resolveCustomEndpointForProvider } from "@/utils/provider/customEndpointService";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { resolveProviderFeatureImplementation } from "@/utils/provider/providerInfoRegistry";

export interface ImageToolCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  inpaint: boolean;
  outpaint: boolean;
  sourceLabel: string;
}

const TEXT_ONLY_IMAGE_CAPABILITIES: Omit<ImageToolCapabilities, "sourceLabel"> = {
  textToImage: true,
  imageToImage: false,
  inpaint: false,
  outpaint: false,
};

const REFERENCE_IMAGE_CAPABILITIES: Omit<ImageToolCapabilities, "sourceLabel"> = {
  textToImage: true,
  imageToImage: true,
  inpaint: false,
  outpaint: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBooleanField(record: Record<string, unknown>, fieldName: string, fallback: boolean): boolean {
  return typeof record[fieldName] === "boolean" ? record[fieldName] : fallback;
}

function readEndpointImageModeConfig(endpoint: CustomEndpointRow): Record<string, unknown> | null {
  const imageModes = endpoint.extra_config.image_modes;
  if (isRecord(imageModes)) {
    return imageModes;
  }

  const workflowSupports = endpoint.extra_config.workflow_supports;
  return isRecord(workflowSupports) ? workflowSupports : null;
}

function resolveCustomEndpointImageCapabilities(endpoint: CustomEndpointRow): ImageToolCapabilities {
  const imageModeConfig = readEndpointImageModeConfig(endpoint);

  if (endpoint.api_style === "comfyui") {
    const textToImage = imageModeConfig ? readBooleanField(imageModeConfig, "txt2img", true) : true;
    const imageToImage = imageModeConfig ? readBooleanField(imageModeConfig, "img2img", true) : true;
    const inpaint = imageModeConfig ? readBooleanField(imageModeConfig, "inpaint", false) : false;
    const outpaint = imageModeConfig ? readBooleanField(imageModeConfig, "outpaint", inpaint) : inpaint;

    return {
      textToImage,
      imageToImage,
      inpaint,
      outpaint,
      sourceLabel: endpoint.display_name,
    };
  }

  if (imageModeConfig) {
    const inpaint = readBooleanField(imageModeConfig, "inpaint", false);
    return {
      textToImage: readBooleanField(imageModeConfig, "txt2img", true),
      imageToImage: readBooleanField(imageModeConfig, "img2img", false),
      inpaint,
      outpaint: readBooleanField(imageModeConfig, "outpaint", false),
      sourceLabel: endpoint.display_name,
    };
  }

  return {
    ...TEXT_ONLY_IMAGE_CAPABILITIES,
    sourceLabel: endpoint.display_name,
  };
}

function resolveStaticProviderImageCapabilities(provider: string): ImageToolCapabilities | null {
  const normalizedProvider = provider.trim().toLowerCase();

  if (
    normalizedProvider === "google" ||
    normalizedProvider === "openrouter" ||
    normalizedProvider === "vertex" ||
    normalizedProvider === "vertexexpress"
  ) {
    return {
      ...REFERENCE_IMAGE_CAPABILITIES,
      sourceLabel: provider,
    };
  }

  const implementation = resolveProviderFeatureImplementation(normalizedProvider, "imageGeneration");
  if (implementation === "zai" || implementation === "nvidia") {
    return {
      ...TEXT_ONLY_IMAGE_CAPABILITIES,
      sourceLabel: provider,
    };
  }

  if (implementation === "google" || implementation === "openrouter") {
    return {
      ...REFERENCE_IMAGE_CAPABILITIES,
      sourceLabel: provider,
    };
  }

  return null;
}

async function resolveConfiguredDiffusionModelId(state: ToolAssemblyState): Promise<number | null> {
  if (state.diffusion_model_id != null) {
    return state.diffusion_model_id;
  }

  const serverId = Number.parseInt(state.server_id, 10);
  if (!Number.isInteger(serverId) || serverId <= 0) {
    return null;
  }

  const [row] = await sql<[{ diffusion_model_id: number | null }]>`
    SELECT diffusion_model_id
    FROM server_model_configs
    WHERE server_id = ${serverId}
    LIMIT 1
  `;

  return row?.diffusion_model_id ?? null;
}

export async function resolveImageToolCapabilities(state: ToolAssemblyState): Promise<ImageToolCapabilities | null> {
  const diffusionModelId = await resolveConfiguredDiffusionModelId(state);
  if (!diffusionModelId) {
    return null;
  }

  const diffusionModel = await llmModelRepo.loadDiffusionModelById(diffusionModelId);
  if (!diffusionModel) {
    return null;
  }

  const provider = diffusionModel.provider.trim().toLowerCase();
  if (isCustomProvider(provider)) {
    const endpoint = await resolveCustomEndpointForProvider(provider, "image");
    if (!endpoint) {
      log.warn(`Image tool assembly could not resolve custom endpoint for provider ${provider}`);
      return null;
    }
    return resolveCustomEndpointImageCapabilities(endpoint);
  }

  return resolveStaticProviderImageCapabilities(provider);
}
