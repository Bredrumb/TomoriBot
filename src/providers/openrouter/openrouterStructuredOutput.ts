import type { z } from "zod";
import {
  ExpressionBatchResultSchema,
  buildExpressionResponseSchema,
  type ExpressionBatchResult,
} from "@/providers/utils/structuredOutput";
import { stripAnthropicUnsupportedConstraints } from "@/providers/utils/presetCommon";
import type { ProviderStructuredJsonRequest, StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";

type OpenrouterStructuredOutputRequest = ProviderStructuredJsonRequest;
type GenericStructuredOutputRequest = ProviderStructuredJsonRequest;

type OpenrouterContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type OpenrouterMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenrouterContentPart[] };

/**
 * Call OpenRouter with structured output using a generic JSON schema.
 */
export async function callOpenrouterStructuredJSON<T>(
  request: GenericStructuredOutputRequest,
  responseSchema: Record<string, unknown>,
  zodSchema: z.ZodType<T>,
  schemaName: string,
): Promise<StructuredOutputResult<T>> {
  try {
    const contentParts: OpenrouterContentPart[] = [{ type: "text", text: request.userPrompt }];

    if (request.images) {
      for (const image of request.images) {
        try {
          const optimized = await fetchAndOptimizeImage(image.url);
          contentParts.push({
            type: "image_url",
            image_url: {
              url: `data:${optimized.mimeType};base64,${optimized.data}`,
            },
          });
        } catch (fetchError) {
          log.error(`Error fetching image ${image.name}`, fetchError as Error, {
            errorType: "ImageFetchError",
            metadata: { imageName: image.name, imageUrl: image.url },
          });
        }
      }
    }

    const userContent =
      contentParts.length === 1 && contentParts[0].type === "text" ? contentParts[0].text : contentParts;

    const messages: OpenrouterMessage[] = [
      {
        role: "system",
        content: request.systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ];

    const responseFormat = {
      type: "json_schema" as const,
      json_schema: {
        name: schemaName,
        description: `Structured output for ${schemaName}`,
        schema: responseSchema,
      },
    };

    const body = {
      ...(request.model !== "other-model" ? { model: request.model } : {}),
      messages,
      temperature: request.temperature ?? 1.0,
      max_tokens: request.maxOutputTokens ?? 8192,
      response_format: responseFormat,
      plugins: [{ id: "response-healing" }],
      stream: false,
    };

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("OpenRouter structured JSON request failed", new Error(errorBody), {
        errorType: "OpenrouterStructuredJSONHttpError",
        metadata: { model: request.model, status: response.status },
      });
      return {
        success: false,
        error: `OpenRouter request failed: ${response.status} ${response.statusText}`,
      };
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const messageContent = result.choices?.[0]?.message?.content;
    const responseText =
      typeof messageContent === "string"
        ? messageContent
        : Array.isArray(messageContent)
          ? messageContent
              .filter(
                (part): part is { type: "text"; text: string } =>
                  typeof part === "object" &&
                  part !== null &&
                  "type" in part &&
                  (part as { type?: string }).type === "text" &&
                  "text" in part &&
                  typeof (part as { text?: unknown }).text === "string",
              )
              .map((part) => part.text)
              .join("")
          : "";

    if (!responseText) {
      return {
        success: false,
        error: "OpenRouter returned an empty response.",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      log.error("OpenRouter structured JSON parse failed", parseError as Error, {
        errorType: "OpenrouterStructuredJSONParseError",
        metadata: { model: request.model, responseText },
      });
      return {
        success: false,
        error: "Invalid JSON response from OpenRouter.",
      };
    }

    const validationResult = zodSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error("OpenRouter structured JSON validation failed", validationResult.error);
      return {
        success: false,
        error: `Invalid response structure: ${validationResult.error.message}`,
      };
    }

    return { success: true, data: validationResult.data };
  } catch (error) {
    log.error("Error calling OpenRouter structured JSON", error as Error, {
      errorType: "OpenrouterStructuredJSONError",
      metadata: { model: request.model },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Call OpenRouter with structured output using response_format json_schema
 * (expression-classification specific wrapper).
 */
export async function callOpenrouterStructuredOutput(
  request: OpenrouterStructuredOutputRequest,
): Promise<StructuredOutputResult<ExpressionBatchResult>> {
  const images = request.images ?? [];

  try {
    const contentParts: OpenrouterContentPart[] = [{ type: "text", text: request.userPrompt }];

    for (const image of images) {
      try {
        const optimized = await fetchAndOptimizeImage(image.url);
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `data:${optimized.mimeType};base64,${optimized.data}`,
          },
        });
      } catch (fetchError) {
        log.error(`Error fetching image ${image.name}`, fetchError as Error, {
          errorType: "ImageFetchError",
          metadata: {
            imageName: image.name,
            imageUrl: image.url,
          },
        });
      }
    }

    const userContent =
      contentParts.length === 1 && contentParts[0].type === "text" ? contentParts[0].text : contentParts;

    const messages: OpenrouterMessage[] = [
      {
        role: "system",
        content: request.systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ];

    const rawExpressionSchema = buildExpressionResponseSchema();
    const responseSchema = request.model.startsWith("anthropic/")
      ? stripAnthropicUnsupportedConstraints(rawExpressionSchema)
      : rawExpressionSchema;
    const responseFormat = {
      type: "json_schema" as const,
      json_schema: {
        name: "expression_batch_result",
        description: "Batch classification results for emoji and sticker expressions",
        schema: responseSchema,
      },
    };

    const body = {
      ...(request.model !== "other-model" ? { model: request.model } : {}),
      messages,
      temperature: request.temperature ?? 1.0,
      max_tokens: 8192,
      response_format: responseFormat,
      plugins: [{ id: "response-healing" }],
      stream: false,
    };

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("OpenRouter structured output request failed", new Error(errorBody), {
        errorType: "OpenrouterStructuredOutputHttpError",
        metadata: {
          model: request.model,
          status: response.status,
        },
      });
      return {
        success: false,
        error: `OpenRouter request failed: ${response.status} ${response.statusText}`,
      };
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const messageContent = result.choices?.[0]?.message?.content;
    const responseText =
      typeof messageContent === "string"
        ? messageContent
        : Array.isArray(messageContent)
          ? messageContent
              .filter(
                (part): part is { type: "text"; text: string } =>
                  typeof part === "object" &&
                  part !== null &&
                  "type" in part &&
                  (part as { type?: string }).type === "text" &&
                  "text" in part &&
                  typeof (part as { text?: unknown }).text === "string",
              )
              .map((part) => part.text)
              .join("")
          : "";

    if (!responseText) {
      return {
        success: false,
        error: "OpenRouter returned an empty response.",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      log.error("OpenRouter structured output JSON parse failed", parseError as Error, {
        errorType: "OpenrouterStructuredOutputParseError",
        metadata: {
          model: request.model,
          responseText,
        },
      });
      return {
        success: false,
        error: "Invalid JSON response from OpenRouter.",
      };
    }

    const validationResult = ExpressionBatchResultSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error("OpenRouter structured output validation failed", validationResult.error);
      return {
        success: false,
        error: `Invalid response structure: ${validationResult.error.message}`,
      };
    }

    return {
      success: true,
      data: validationResult.data,
    };
  } catch (error) {
    log.error("Error calling OpenRouter structured output", error as Error, {
      errorType: "OpenrouterStructuredOutputError",
      metadata: {
        model: request.model,
        imageCount: images.length,
      },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
