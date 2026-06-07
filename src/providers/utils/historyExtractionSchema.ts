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
  /** The self-contained restatement with all pronouns resolved and absolute timestamps */
  lossless_restatement: z.string().min(10).max(1000),

  /** Keywords for indexing and retrieval */
  keywords: z.array(z.string()),

  /** Absolute timestamp if mentioned or inferable, null otherwise */
  timestamp: z.string().nullable(),

  /** Location/setting if mentioned, null otherwise */
  location: z.string().nullable(),

  /** People/characters involved (with resolved names, no pronouns) */
  persons: z.array(z.string()),

  /** Named entities (items, places, events, etc.) */
  entities: z.array(z.string()),

  /** High-level topic category */
  topic: z.string().nullable(),
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
              description:
                "Self-contained restatement of a fact with all pronouns resolved to proper names and absolute timestamps where possible",
            },
            keywords: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "Keywords for retrieval (names, topics, important terms)",
            },
            timestamp: {
              type: "string" as const,
              nullable: true,
              description: "Absolute timestamp (ISO 8601) if mentioned or inferable, null otherwise",
            },
            location: {
              type: "string" as const,
              nullable: true,
              description: "Location or setting if mentioned, null otherwise",
            },
            persons: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "People or characters involved, with resolved names (no pronouns)",
            },
            entities: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "Named entities: items, places, events, abilities, etc.",
            },
            topic: {
              type: "string" as const,
              nullable: true,
              description: "High-level topic category for the fact",
            },
          },
          required: ["lossless_restatement", "keywords", "timestamp", "location", "persons", "entities", "topic"],
        },
      },
    },
    required: ["memories"],
  };
}
