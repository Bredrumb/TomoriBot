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
import { getEndpointRemotePolicy } from "@/utils/security/remoteUrlSecurity";
import { readImageRequestFormat } from "@/utils/provider/customImageEndpointSupport";
import {
  buildChatImageRequest,
  readChatImageResponse,
  IMAGE_GENERATION_RESPONSE_MAX_BYTES,
} from "@/utils/provider/chatImageGeneration";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { readProviderErrorBody } from "@/utils/provider/providerErrorMetrics";
import { z } from "zod";

type GenerateCustomImageEndpointParams = Parameters<typeof generateComfyUiImageViaEndpoint>[0];
type GenerateCustomVideoEndpointParams = Parameters<typeof generateComfyUiVideoViaEndpoint>[0];

export async function generateCustomImageViaEndpoint(
  params: GenerateCustomImageEndpointParams,
): Promise<ProviderNativeImageGenerationResult> {
  const { endpoint, apiKey, prompt, negativePrompt, aspectRatio, referenceImages, abortSignal } = params;

  if (endpoint.api_style === "comfyui") {
    return generateComfyUiImageViaEndpoint(params);
  }

  const viaChat = readImageRequestFormat(endpoint) === "chat-completions";
  const response = await fetchUserRemoteUrl(
    `${endpoint.endpoint_url.replace(/\/+$/, "")}/${viaChat ? "chat/completions" : "images/generations"}`,
    {
      method: "POST",
      headers: buildCustomHeaders(apiKey),
      body: JSON.stringify({
        ...(viaChat
          ? buildChatImageRequest({ model: endpoint.model_name, prompt, aspectRatio, referenceImages })
          : {
              model: endpoint.model_name,
              prompt,
              size: aspectRatio,
              ...(referenceImages?.length ? { reference_images: referenceImages } : {}),
            }),
        ...(negativePrompt ? { negative_prompt: negativePrompt, negativePrompt } : {}),
      }),
      signal: abortSignal,
    },
    getEndpointRemotePolicy(),
  );

  if (!response.ok) {
    const detail = await readProviderErrorBody(response, apiKey);
    throw Object.assign(
      new Error(`Custom image generation failed: ${response.status} ${response.statusText}: ${detail}`),
      {
        status: response.status,
      },
    );
  }

  if (viaChat) return readChatImageResponse(response, abortSignal, getEndpointRemotePolicy());

  const payload = z
    .object({ data: z.array(z.object({ b64_json: z.string().optional() })).optional() })
    .parse(
      JSON.parse(
        (await readBoundedResponse(response, IMAGE_GENERATION_RESPONSE_MAX_BYTES, abortSignal)).toString("utf8"),
      ),
    );

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
    fps,
    resolution,
    referenceImages,
    generateAudio,
    audioPrompt,
    loop,
    abortSignal,
  } = params;

  if (endpoint.api_style === "comfyui") {
    return generateComfyUiVideoViaEndpoint(params);
  }

  const response = await fetchUserRemoteUrl(
    `${endpoint.endpoint_url.replace(/\/+$/, "")}/videos/generations`,
    {
      method: "POST",
      headers: buildCustomHeaders(apiKey),
      body: JSON.stringify({
        model: endpoint.model_name,
        prompt,
        aspect_ratio: aspectRatio,
        duration: durationSeconds,
        // Only include fps when explicitly provided so endpoints that don't accept it are unaffected.
        ...(fps !== undefined ? { fps } : {}),
        resolution,
        generate_audio: generateAudio,
        audio_prompt: audioPrompt,
        loop: loop === true,
        ...(referenceImages?.length ? { reference_images: referenceImages } : {}),
      }),
      signal: abortSignal,
    },
    getEndpointRemotePolicy(),
  );

  if (!response.ok) {
    throw Object.assign(new Error(`Custom video generation failed: ${response.status} ${response.statusText}`), {
      status: response.status,
    });
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
