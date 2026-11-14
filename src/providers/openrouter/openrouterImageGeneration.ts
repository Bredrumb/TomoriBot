import { isOpenRouterGeminiModelCodename } from "@/utils/provider/openrouterModelCapabilities";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { log, redactLogString } from "@/utils/misc/logger";
import { z } from "zod";
import { formatProviderErrorCodeForDisplay } from "@/utils/provider/providerErrorClassification";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { fetchWithProviderRequest } from "@/utils/provider/providerRequestHook";
import {
  buildChatImageRequest,
  readChatImageResponse,
  IMAGE_GENERATION_RESPONSE_MAX_BYTES,
  imageUsageCostSchema,
} from "@/utils/provider/chatImageGeneration";

const OPENROUTER_ORIGIN = "https://openrouter.ai";
const OPENROUTER_CHAT_URL = `${OPENROUTER_ORIGIN}/api/v1/chat/completions`;
const OPENROUTER_IMAGES_URL = `${OPENROUTER_ORIGIN}/api/v1/images`;
const IMAGE_ERROR_RESPONSE_MAX_BYTES = 1024 * 1024;

interface OpenRouterImageReference {
  mimeType: string;
  data: string;
}

export interface OpenRouterImageGenerationRequest {
  apiKey: string;
  modelCodename: string;
  prompt: string;
  aspectRatio: string;
  referenceImages?: OpenRouterImageReference[];
  abortSignal?: AbortSignal;
}

export interface OpenRouterImageGenerationResult {
  imageData: string | null;
  mimeType: string | null;
  costUsd?: number;
}

export function usesChatCompletionsImageGeneration(modelCodename: string): boolean {
  return isOpenRouterGeminiModelCodename(modelCodename);
}

function buildOpenRouterImageRequest(
  request: Pick<OpenRouterImageGenerationRequest, "modelCodename" | "prompt" | "aspectRatio" | "referenceImages">,
): { url: string; body: Record<string, unknown> } {
  const { modelCodename, prompt, aspectRatio, referenceImages } = request;
  if (usesChatCompletionsImageGeneration(modelCodename)) {
    const body = buildChatImageRequest({ model: modelCodename, prompt, aspectRatio, referenceImages });
    return {
      url: OPENROUTER_CHAT_URL,
      body: {
        ...body,
        image_config: {
          ...body.image_config,
          ...(modelCodename === "google/gemini-nano-banana-2.1" ? { image_size: "1K" } : {}),
        },
      },
    };
  }
  return {
    url: OPENROUTER_IMAGES_URL,
    body: {
      model: modelCodename,
      prompt,
      aspect_ratio: aspectRatio,
      ...(referenceImages?.length
        ? {
            input_references: referenceImages.map((image) => ({
              type: "image_url",
              image_url: { url: `data:${image.mimeType};base64,${image.data}` },
            })),
          }
        : {}),
    },
  };
}

function buildRequestFailure(
  modelCodename: string,
  status: number,
  statusText: string,
  headers: Headers,
  body: string,
  apiKey: string,
): Error {
  const safeBody = redactLogString(apiKey ? body.replaceAll(apiKey, "[REDACTED]") : body);

  let parsedMessage = "";
  let providerCode: string | number | undefined;
  try {
    const parsed = z
      .object({
        error: z
          .union([
            z.string(),
            z.object({ message: z.string().optional(), code: z.union([z.string(), z.number()]).optional() }),
          ])
          .optional(),
        message: z.string().optional(),
      })
      .safeParse(JSON.parse(safeBody));
    if (parsed.success) {
      const providerError = parsed.data.error;
      parsedMessage =
        (typeof providerError === "string" ? providerError : providerError?.message) || parsed.data.message || "";
      providerCode = typeof providerError === "object" ? providerError.code : undefined;
    }
  } catch {}

  const statusLabel = `${status} ${statusText}`.trim();
  const friendlyMessage = parsedMessage || statusLabel;
  const message = `OpenRouter API request failed (${statusLabel}) for model "${modelCodename}": ${friendlyMessage}`;
  return Object.assign(
    new Error(redactLogString(apiKey ? message.replaceAll(apiKey, "[REDACTED]") : message), {
      cause: readOpenRouterLimitError(status, headers, body) ?? undefined,
    }),
    { status, code: formatProviderErrorCodeForDisplay(providerCode) },
  );
}

async function generateViaChatCompletions(
  request: OpenRouterImageGenerationRequest,
): Promise<OpenRouterImageGenerationResult> {
  const { apiKey, modelCodename, abortSignal } = request;
  const { url, body } = buildOpenRouterImageRequest(request);
  const response = await fetchWithProviderRequest(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(abortSignal ? { signal: abortSignal } : {}),
  });

  if (!response.ok) {
    const errorText = (await readBoundedResponse(response, IMAGE_ERROR_RESPONSE_MAX_BYTES)).toString("utf8");
    const failure = buildRequestFailure(
      modelCodename,
      response.status,
      response.statusText,
      response.headers,
      errorText,
      apiKey,
    );
    log.warn("OpenRouter chat image request failed", failure, {
      metadata: { model: modelCodename, status: response.status },
    });
    throw failure;
  }

  return readChatImageResponse(response, abortSignal);
}

async function generateViaImagesEndpoint(
  request: OpenRouterImageGenerationRequest,
): Promise<OpenRouterImageGenerationResult> {
  const { apiKey, modelCodename, abortSignal } = request;
  const { url, body } = buildOpenRouterImageRequest(request);
  const response = await fetchWithProviderRequest(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...buildOpenRouterAttributionHeaders(),
    },
    body: JSON.stringify(body),
    ...(abortSignal ? { signal: abortSignal } : {}),
  });

  if (!response.ok) {
    const errorText = (await readBoundedResponse(response, IMAGE_ERROR_RESPONSE_MAX_BYTES)).toString("utf8");
    const failure = buildRequestFailure(
      modelCodename,
      response.status,
      response.statusText,
      response.headers,
      errorText,
      apiKey,
    );
    log.warn("OpenRouter image request failed", failure, {
      metadata: { model: modelCodename, status: response.status },
    });
    throw failure;
  }

  const result = z
    .object({
      data: z.array(z.object({ b64_json: z.string().optional(), media_type: z.string().nullish() })).optional(),
      usage: imageUsageCostSchema,
    })
    .parse(JSON.parse((await readBoundedResponse(response, IMAGE_GENERATION_RESPONSE_MAX_BYTES)).toString("utf8")));
  const first = result?.data?.[0];
  const base64 = typeof first?.b64_json === "string" ? first.b64_json : null;
  const costUsd = result.usage?.cost ?? undefined;
  if (!base64) {
    return { imageData: null, mimeType: null, costUsd };
  }

  // media_type is omitted only when the format cannot be determined; callers default to PNG.
  return { imageData: base64, mimeType: typeof first?.media_type === "string" ? first.media_type : null, costUsd };
}

export async function generateOpenRouterImage(
  request: OpenRouterImageGenerationRequest,
): Promise<OpenRouterImageGenerationResult> {
  const viaChat = usesChatCompletionsImageGeneration(request.modelCodename);
  log.info(
    `[OpenRouter] Sending image request to model "${request.modelCodename}" via ${viaChat ? "chat/completions" : "images"} (aspect ratio: ${request.aspectRatio}, refs: ${request.referenceImages?.length ?? 0})`,
  );

  return viaChat ? await generateViaChatCompletions(request) : await generateViaImagesEndpoint(request);
}
