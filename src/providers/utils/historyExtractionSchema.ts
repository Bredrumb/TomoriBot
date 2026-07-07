/**
 * Schema definitions for channel history extraction (SimpleMem-style atomic fact extraction).
 * Provides both Zod validation schemas and JSON schema objects for Google/OpenRouter providers.
 */

import { z } from "zod";

/**
 * Zod schema for a single extracted memory entry (atomic fact).
 * Each entry represents one self-contained piece of information with resolved references.
 */
export const HistoryMemoryEntrySchema = z.object({
  /** The self-contained restatement with all pronouns resolved */
  lossless_restatement: z.string().min(10).max(1000),
});

/** Type for a single extracted memory entry */
export type HistoryMemoryEntry = z.infer<typeof HistoryMemoryEntrySchema>;

/**
 * Zod schema for the complete extraction result containing all memories from a window
 */
export const HistoryExtractionResultSchema = z.object({
  memories: z.array(HistoryMemoryEntrySchema),
});

/** Type for the complete extraction batch result */
export type HistoryExtractionResult = z.infer<typeof HistoryExtractionResultSchema>;

/**
 * Builds the JSON schema object for structured output providers.
 * Used by Google's responseSchema and OpenRouter's json_schema.schema.
 *
 * @returns JSON schema describing the extraction result format
 */
export function buildHistoryExtractionResponseSchema(): Record<string, unknown> {
  return {
    type: "object" as const,
    properties: {
      memories: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            lossless_restatement: {
              type: "string" as const,
              description: "Self-contained restatement of a fact with pronouns resolved to proper names",
            },
          },
          required: ["lossless_restatement"],
        },
      },
    },
    required: ["memories"],
  };
}
