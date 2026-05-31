import { GoogleGenAI, type GoogleGenAI as GoogleGenAIType } from "@google/genai";
import type { Content, GenerateContentConfig, Part } from "@google/genai";
import type { z } from "zod";
import {
  ExpressionBatchResultSchema,
  buildExpressionResponseSchema,
  type ExpressionBatchResult,
} from "@/providers/utils/structuredOutput";
import type { ProviderStructuredJsonRequest, StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";

type GoogleStructuredOutputRequest = ProviderStructuredJsonRequest;
type GenericStructuredOutputRequest = ProviderStructuredJsonRequest;

/**
 * Call Google Gemini with structured output using a generic JSON schema.
 * Unlike the expression-specific variant, this accepts any Zod schema and
 * response schema, enabling reuse for history extraction and other tasks.
 */
export async function callGoogleStructuredJSON<T>(
  request: GenericStructuredOutputRequest,
  responseSchema: Record<string, unknown>,
  zodSchema: z.ZodType<T>,
  client?: GoogleGenAIType,
): Promise<StructuredOutputResult<T>> {
  try {
    const genAI = client ?? new GoogleGenAI({ apiKey: request.apiKey });
    const parts: Part[] = [{ text: request.userPrompt }];

    if (request.images) {
      for (const image of request.images) {
        try {
          const optimized = await fetchAndOptimizeImage(image.url, "image/png");
          parts.push({
            inlineData: { data: optimized.data, mimeType: optimized.mimeType },
          });
        } catch (fetchError) {
          log.error(`Error fetching image ${image.name}`, fetchError as Error, {
            errorType: "ImageFetchError",
            metadata: { imageName: image.name, imageUrl: image.url },
          });
        }
      }
    }

    const generationConfig: GenerateContentConfig = {
      temperature: request.temperature ?? 1.0,
      maxOutputTokens: request.maxOutputTokens ?? 8192,
      responseMimeType: "application/json",
      responseSchema,
      systemInstruction: request.systemPrompt,
    };

    const contents: Content = { role: "user", parts };
    const result = await genAI.models.generateContent({
      model: request.model,
      contents: [contents],
      config: generationConfig,
    });

    const responseText = result.text?.trim() ?? "";
    if (!responseText) {
      log.error("Google structured JSON returned empty response", new Error("Empty response"), {
        errorType: "GoogleStructuredJSONEmptyResponse",
        metadata: {
          model: request.model,
          finishReason: result.candidates?.[0]?.finishReason,
        },
      });
      return {
        success: false,
        error: "Google returned an empty structured output response.",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      const finishReason = result.candidates?.[0]?.finishReason;
      log.error("Google structured JSON parse failed", parseError as Error, {
        errorType: "GoogleStructuredJSONParseError",
        metadata: {
          model: request.model,
          finishReason,
          responseLength: responseText.length,
          responsePreview: responseText.slice(0, 1000),
        },
      });
      return {
        success: false,
        error:
          finishReason === "MAX_TOKENS"
            ? "Google returned truncated JSON (MAX_TOKENS). Please retry with a smaller batch."
            : "Invalid JSON response from Google.",
      };
    }

    const validationResult = zodSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error("Google structured JSON validation failed", validationResult.error);
      return {
        success: false,
        error: `Invalid response structure: ${validationResult.error.message}`,
      };
    }

    return { success: true, data: validationResult.data };
  } catch (error) {
    log.error("Error calling Google structured JSON", error as Error, {
      errorType: "GoogleStructuredJSONError",
      metadata: { model: request.model },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Call Google Gemini with structured output using native responseSchema
 * (expression-classification specific wrapper).
 */
export async function callGoogleStructuredOutput(
  request: GoogleStructuredOutputRequest,
  client?: GoogleGenAIType,
): Promise<StructuredOutputResult<ExpressionBatchResult>> {
  const images = request.images ?? [];

  try {
    const genAI = client ?? new GoogleGenAI({ apiKey: request.apiKey });
    const parts: Part[] = [{ text: request.userPrompt }];

    for (const image of images) {
      try {
        const optimized = await fetchAndOptimizeImage(image.url, "image/png");
        parts.push({
          inlineData: {
            data: optimized.data,
            mimeType: optimized.mimeType,
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

    const responseSchema = buildExpressionResponseSchema();
    const generationConfig: GenerateContentConfig = {
      temperature: request.temperature ?? 1.0,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema,
      systemInstruction: request.systemPrompt,
    };

    const contents: Content = {
      role: "user",
      parts,
    };

    const result = await genAI.models.generateContent({
      model: request.model,
      contents: [contents],
      config: generationConfig,
    });

    const responseText = result.text?.trim() ?? "";
    if (!responseText) {
      log.error("Google structured output returned empty response", new Error("Empty response"), {
        errorType: "GoogleStructuredOutputEmptyResponse",
        metadata: {
          model: request.model,
          imageCount: images.length,
          finishReason: result.candidates?.[0]?.finishReason,
          finishMessage: result.candidates?.[0]?.finishMessage,
        },
      });
      return {
        success: false,
        error: "Google returned an empty structured output response.",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      const finishReason = result.candidates?.[0]?.finishReason;
      log.error("Google structured output JSON parse failed", parseError as Error, {
        errorType: "GoogleStructuredOutputParseError",
        metadata: {
          model: request.model,
          imageCount: images.length,
          finishReason,
          finishMessage: result.candidates?.[0]?.finishMessage,
          responseLength: responseText.length,
          responsePreview: responseText.slice(0, 1000),
        },
      });
      return {
        success: false,
        error:
          finishReason === "MAX_TOKENS"
            ? "Google returned truncated JSON (MAX_TOKENS). Please retry with a smaller batch."
            : "Invalid JSON response from Google.",
      };
    }

    const validationResult = ExpressionBatchResultSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error("Google structured output validation failed", validationResult.error);
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
    log.error("Error calling Google structured output", error as Error, {
      errorType: "GoogleStructuredOutputError",
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
