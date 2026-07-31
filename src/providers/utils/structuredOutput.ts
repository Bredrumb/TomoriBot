/**
 * Shared structured-output schemas and builders.
 * Provider-specific structured-output HTTP/runtime helpers belong in the
 * corresponding provider folders.
 */

import { z } from "zod";
import { getAllEmotionKeys } from "@/types/misc/emotions";

/**
 * Zod schema for a single expression (emoji or sticker) classification result
 */
const ExpressionClassificationSchema = z.object({
  name: z.string().describe("The emoji or sticker name (case-insensitive match)"),
  emotion_key: z
    .enum(getAllEmotionKeys() as [string, ...string[]])
    .describe("One of the 28 emotion categories that best matches the visual expression"),
  description: z
    .string()
    .min(10)
    .max(200)
    .describe("One concise sentence describing the visual appearance (10-200 characters)"),
});

/**
 * Zod schema for the complete LLM response containing multiple expression classifications
 */
export const ExpressionBatchResultSchema = z.object({
  expressions: z.array(ExpressionClassificationSchema),
});
/**
 * Type for the complete batch result
 */
export type ExpressionBatchResult = z.infer<typeof ExpressionBatchResultSchema>;

/**
 * Build JSON schema object for structured output (shared across providers)
 */
export function buildExpressionResponseSchema() {
  return {
    type: "object" as const,
    properties: {
      expressions: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            name: {
              type: "string" as const,
              description: "The emoji or sticker name (case-insensitive match)",
            },
            emotion_key: {
              type: "string" as const,
              enum: getAllEmotionKeys(),
              description: "One of the 28 emotion categories that best matches the visual expression",
            },
            description: {
              type: "string" as const,
              description: "One concise sentence describing the visual appearance",
            },
          },
          required: ["name", "emotion_key", "description"],
        },
      },
    },
    required: ["expressions"],
  };
}
