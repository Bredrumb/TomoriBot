import {
  parsePrivateStructuredOutput,
  privateStructuredFailure,
  readStructuredResponse,
} from "@/providers/utils/structuredReview";
import type { z } from "zod";
import type {
  ProviderStructuredJsonRequest,
  StructuredOutputResult,
  StructuredImageFailureDiagnostics,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { buildAnthropicThinkingRequest } from "@/utils/provider/thinkingControl";
import {
  readProviderErrorBody,
  redactProviderDetail,
  reportProviderFailure,
} from "@/utils/provider/providerErrorMetrics";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import sharp from "sharp";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
const ANTHROPIC_MAX_BASE64_IMAGE_BYTES = 10_000_000;

// The output format grammar rejects these keywords with a 400. Dropping them only loosens decoding:
// the caller's Zod schema still enforces every one of them on the parsed reply.
const UNSUPPORTED_OUTPUT_SCHEMA_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
]);

class AnthropicImagePreparationError extends Error {
  constructor(readonly diagnostics: StructuredImageFailureDiagnostics) {
    super("No images could be prepared for Anthropic.");
  }
}

async function buildAnthropicMessages(request: ProviderStructuredJsonRequest): Promise<{
  system: string;
  messages: Array<Record<string, unknown>>;
  skippedImages: StructuredImageFailureDiagnostics[];
}> {
  const { systemPrompt, userPrompt, images } = request;
  const messages: Array<Record<string, unknown>> = [];
  const skippedImages: StructuredImageFailureDiagnostics[] = [];

  if (images && images.length > 0) {
    const contentBlocks: Array<Record<string, unknown>> = [{ type: "text", text: userPrompt }];

    for (const [imageIndex, image] of images.entries()) {
      request.abortSignal?.throwIfAborted();
      let failureStage: StructuredImageFailureDiagnostics["failureStage"] = "image-download";
      try {
        const optimized = await fetchAndOptimizeImage(image.url, image.mimeType);
        request.abortSignal?.throwIfAborted();
        failureStage = "image-decode";
        const metadata = await sharp(Buffer.from(optimized.data, "base64")).metadata();
        failureStage = "image-format";
        if (!metadata.format || !["jpeg", "png", "gif", "webp"].includes(metadata.format)) {
          throw new Error("Unsupported image format");
        }
        failureStage = "image-size";
        if (optimized.data.length > ANTHROPIC_MAX_BASE64_IMAGE_BYTES)
          throw new Error("Image exceeds base64 size limit");
        contentBlocks.push({
          type: "text",
          text: `Image ${imageIndex + 1}${image.name ? ` (${JSON.stringify(image.name)})` : ""}:`,
        });
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: `image/${metadata.format}`,
            data: optimized.data,
          },
        });
      } catch (error) {
        request.abortSignal?.throwIfAborted();
        const status = error instanceof Error ? /\bHTTP ([1-5]\d{2})\b/.exec(error.message)?.[1] : undefined;
        const diagnostics: StructuredImageFailureDiagnostics = {
          failureStage,
          imageIndex,
          imageName: image.name ? redactProviderDetail(image.name, request.apiKey) : undefined,
          imageCount: images.length,
          httpStatus: status ? Number(status) : undefined,
        };
        skippedImages.push(diagnostics);
        await reportProviderFailure({
          summary: "Anthropic image preparation failed",
          error: new Error("Image input unavailable"),
          errorType: "AnthropicStructuredImageError",
          expected: true,
          dimensions: { provider: "anthropic", operation: "structured-image", category: diagnostics.failureStage },
          metadata: { model: request.model, correlation: request.correlationId, ...diagnostics },
        });
        contentBlocks.push({
          type: "text",
          text: `Image ${imageIndex + 1} is unavailable. Omit this image from the results; do not infer its contents.`,
        });
      }
    }
    if (skippedImages.length === images.length) throw new AnthropicImagePreparationError(skippedImages[0]);

    messages.push({ role: "user", content: contentBlocks });
  } else {
    messages.push({ role: "user", content: userPrompt });
  }

  return { system: systemPrompt, messages, skippedImages };
}

/**
 * Rewrites standard JSON Schema into the subset `output_config.format` accepts: `oneOf` becomes
 * `anyOf` and every object is closed with `additionalProperties: false`, which the API requires.
 */
function toAnthropicOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toAnthropicOutputSchema);
  if (!schema || typeof schema !== "object") return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_OUTPUT_SCHEMA_KEYWORDS.has(key)) continue;
    // Property names are data, so a field called `maxLength` must survive the keyword filter.
    result[key === "oneOf" ? "anyOf" : key] =
      key === "properties" && value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, toAnthropicOutputSchema(entry)]))
        : toAnthropicOutputSchema(value);
  }
  if (result.type === "object") result.additionalProperties = false;
  return result;
}

class PrivateStructuredHttpError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(detail);
  }
}

async function callAnthropicApi(
  request: ProviderStructuredJsonRequest,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": request.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
    signal: request.abortSignal,
  });

  if (!response.ok) {
    if (request.privateOutput) {
      throw new PrivateStructuredHttpError(response.status, await readProviderErrorBody(response, request.apiKey));
    }
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  return (await readStructuredResponse(request, response)) as Record<string, unknown>;
}

function extractResponseText(response: Record<string, unknown>): string {
  const content = response.content as Array<Record<string, unknown>> | undefined;
  return (content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
    .trim();
}

/**
 * Call Anthropic with native structured outputs (`output_config.format`). Forced tool use is not an
 * option: Sonnet 5.5, Opus 5.5 and Fable 5.1 reject a forced `tool_choice` with a 400.
 */
export async function callAnthropicStructuredJSON<T>(
  request: ProviderStructuredJsonRequest,
  responseSchema: Record<string, unknown>,
  zodSchema: z.ZodType<T>,
): Promise<StructuredOutputResult<T>> {
  try {
    const { system, messages, skippedImages } = await buildAnthropicMessages(request);
    const thinking =
      request.thinkingLevel === undefined
        ? undefined
        : buildAnthropicThinkingRequest(request.model, request.thinkingLevel);

    const response = await callAnthropicApi(request, {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? 8192,
      system,
      messages,
      ...(thinking?.thinking && { thinking: thinking.thinking }),
      output_config: {
        ...thinking?.output_config,
        format: { type: "json_schema", schema: toAnthropicOutputSchema(responseSchema) },
      },
      stream: false,
    });

    const responseText = extractResponseText(response);
    if (request.privateOutput) {
      const result = parsePrivateStructuredOutput(
        request,
        responseText,
        zodSchema,
        response.usage,
        response.stop_reason === "refusal",
      );
      return result.success && skippedImages.length > 0 ? { ...result, skippedImages } : result;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      log.error("Anthropic structured JSON parse failed", parseError as Error, {
        errorType: "AnthropicStructuredJSONParseError",
        metadata: {
          model: request.model,
          stopReason: response.stop_reason,
          responsePreview: responseText.slice(0, 500),
        },
      });
      return {
        success: false,
        error:
          response.stop_reason === "max_tokens"
            ? "Anthropic returned truncated JSON (max_tokens). Please retry with a smaller batch."
            : "Invalid JSON response from Anthropic.",
      };
    }

    const validationResult = zodSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error("Anthropic structured JSON validation failed", validationResult.error);
      return {
        success: false,
        error: `Invalid response structure: ${validationResult.error.message}`,
      };
    }

    return {
      success: true,
      data: validationResult.data,
      ...(skippedImages.length > 0 ? { skippedImages } : {}),
    };
  } catch (error) {
    if (request.abortSignal?.aborted) return privateStructuredFailure(request);
    if (error instanceof AnthropicImagePreparationError) {
      const diagnostics = error.diagnostics;
      return {
        success: false,
        error: error.message,
        failure: "transport",
        httpStatus: diagnostics.httpStatus,
        diagnostics,
      };
    }
    if (request.privateOutput)
      return privateStructuredFailure(
        request,
        "transport",
        error instanceof PrivateStructuredHttpError ? error.status : undefined,
        undefined,
        undefined,
        error instanceof PrivateStructuredHttpError ? error.message : undefined,
      );
    log.error("Error calling Anthropic structured JSON", error as Error, {
      errorType: "AnthropicStructuredJSONError",
      metadata: { model: request.model },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
