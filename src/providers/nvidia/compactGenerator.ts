/**
 * Conversation compaction for the NVIDIA NIM provider.
 *
 * - Plain-text conversation summaries via direct POST to the NVIDIA
 *   chat-completions endpoint, with optional image support via
 *   fetchAndOptimizeImage.
 * - Roleplay structured summaries delegated to callNvidiaStructuredJSON,
 *   which handles the full json_schema → json_object → plain fallback chain.
 */
import { log } from "@/utils/misc/logger";
import type {
  CompactConversationResult,
  CompactRoleplayResult,
  ProviderCompactSummaryRequest,
} from "@/types/provider/featureInterfaces";
import { callNvidiaStructuredJSON } from "@/providers/nvidia/nvidiaStructuredOutput";
import { NVIDIA_CHAT_COMPLETIONS_URL } from "@/providers/nvidia/nvidiaConstants";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import { buildRoleplaySchema, CompactRoleplaySummarySchema } from "@/providers/utils/compactCommon";

type NvidiaContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type NvidiaMessage = { role: "system"; content: string } | { role: "user"; content: string | NvidiaContentPart[] };

/**
 * Build the user content for a compact summary request, optionally
 * fetching and embedding images as optimized base64 data URLs.
 */
async function buildNvidiaCompactUserContent(
  userPrompt: string,
  images?: Array<{ url: string }>,
): Promise<string | NvidiaContentPart[]> {
  if (!images || images.length === 0) {
    return userPrompt;
  }

  const parts: NvidiaContentPart[] = [{ type: "text", text: userPrompt }];

  for (const image of images) {
    try {
      const optimized = await fetchAndOptimizeImage(image.url);
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${optimized.mimeType};base64,${optimized.data}`,
        },
      });
    } catch (fetchError) {
      log.error(`Error fetching NVIDIA compact summary image ${image.url}`, fetchError as Error, {
        errorType: "NvidiaCompactImageFetchError",
        metadata: { imageUrl: image.url },
      });
    }
  }

  return parts.length === 1 ? userPrompt : parts;
}

/**
 * Generate a plain-text conversation summary using the NVIDIA NIM API.
 *
 * @param request - Compact summary request with model, prompts, auth, and optional images
 * @returns Plain-text summary or an error object
 */
export async function generateConversationSummaryNvidia(
  request: ProviderCompactSummaryRequest,
): Promise<CompactConversationResult> {
  try {
    if (!request.apiKey || request.apiKey.trim().length < 10) {
      return { error: "Invalid NVIDIA API key" };
    }

    const userContent = await buildNvidiaCompactUserContent(request.userPrompt, request.images);

    const messages: NvidiaMessage[] = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: userContent });

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: 4096,
      stream: false,
    };

    // Send the request
    const response = await fetch(NVIDIA_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("NVIDIA compact summary request failed", new Error(errorBody), {
        errorType: "NvidiaCompactHttpError",
        metadata: {
          model: request.model,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `NVIDIA request failed (${response.status}): ${response.statusText}`,
      };
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = result.choices?.[0]?.message?.content;
    const responseText =
      typeof content === "string"
        ? content.trim()
        : Array.isArray(content)
          ? content
              .filter(
                (part) =>
                  typeof part === "object" &&
                  part !== null &&
                  "type" in part &&
                  (part as { type?: string }).type === "text" &&
                  "text" in part,
              )
              .map((part) => (part as { text: string }).text)
              .join("")
              .trim()
          : "";

    if (!responseText) {
      return { error: "NVIDIA returned an empty response." };
    }

    return { summary: responseText };
  } catch (error) {
    log.error("NVIDIA compact summary failed", error as Error);
    return {
      error: error instanceof Error ? error.message : "Unknown NVIDIA error",
    };
  }
}

/**
 * Generate a structured roleplay summary using the NVIDIA NIM API.
 *
 * Delegates to callNvidiaStructuredJSON, which handles the full
 * json_schema → json_object → plain fallback chain automatically.
 *
 * @param request - Compact summary request with model, prompts, auth, and optional images
 * @returns Structured roleplay summary or an error object
 */
export async function generateRoleplaySummaryNvidia(
  request: ProviderCompactSummaryRequest,
): Promise<CompactRoleplayResult> {
  const result = await callNvidiaStructuredJSON(
    {
      apiKey: request.apiKey,
      model: request.model,
      systemPrompt: request.systemPrompt ?? "",
      userPrompt: request.userPrompt,
      images: request.images,
      temperature: request.temperature,
      schemaName: "roleplay_summary",
    },
    buildRoleplaySchema(),
    CompactRoleplaySummarySchema,
  );

  if (!result.success) {
    return { error: result.error };
  }

  return { summary: result.data };
}
