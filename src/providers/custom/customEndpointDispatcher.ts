import type {
  ProviderNativeImageGenerationResult,
  ProviderNativeVideoGenerationResult,
} from "@/types/provider/featureInterfaces";
import {
  generateComfyUiImageViaEndpoint,
  generateComfyUiVideoViaEndpoint,
} from "@/providers/custom/customComfyUiEndpoint";
import { buildCustomHeaders } from "@/providers/custom/customOpenAICompatibleUtils";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";

type GenerateCustomImageEndpointParams = Parameters<typeof generateComfyUiImageViaEndpoint>[0];
type GenerateCustomVideoEndpointParams = Parameters<typeof generateComfyUiVideoViaEndpoint>[0];

export async function generateCustomImageViaEndpoint(
  params: GenerateCustomImageEndpointParams,
): Promise<ProviderNativeImageGenerationResult> {
  const { endpoint, apiKey, prompt, negativePrompt, aspectRatio, referenceImages } = params;

  if (endpoint.api_style === "comfyui") {
    return generateComfyUiImageViaEndpoint(params);
  }

  const response = await fetchUserRemoteUrl(`${endpoint.endpoint_url.replace(/\/+$/, "")}/images/generations`, {
    method: "POST",
    headers: buildCustomHeaders(apiKey),
    body: JSON.stringify({
      model: endpoint.model_name,
      prompt,
      ...(negativePrompt ? { negative_prompt: negativePrompt, negativePrompt } : {}),
      size: aspectRatio,
      ...(referenceImages?.length ? { reference_images: referenceImages } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Custom image generation failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };

  return {
    imageData: payload.data?.[0]?.b64_json ?? null,
    mimeType: "image/png",
  };
}

export async function generateCustomVideoViaEndpoint(
  params: GenerateCustomVideoEndpointParams,
): Promise<ProviderNativeVideoGenerationResult> {
  const {
    endpoint,
    apiKey,
    prompt,
    aspectRatio,
    durationSeconds,
    resolution,
    referenceImages,
    generateAudio,
    audioPrompt,
    loop,
  } = params;

  if (endpoint.api_style === "comfyui") {
    return generateComfyUiVideoViaEndpoint(params);
  }

  const response = await fetchUserRemoteUrl(`${endpoint.endpoint_url.replace(/\/+$/, "")}/videos/generations`, {
    method: "POST",
    headers: buildCustomHeaders(apiKey),
    body: JSON.stringify({
      model: endpoint.model_name,
      prompt,
      aspect_ratio: aspectRatio,
      duration: durationSeconds,
      resolution,
      generate_audio: generateAudio,
      audio_prompt: audioPrompt,
      loop: loop === true,
      ...(referenceImages?.length ? { reference_images: referenceImages } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Custom video generation failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const base64Data = payload.data?.[0]?.b64_json ?? null;

  return {
    videoData: base64Data ? Buffer.from(base64Data, "base64") : null,
    mimeType: "video/mp4",
  };
}
