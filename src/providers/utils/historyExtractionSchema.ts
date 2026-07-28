/**
 * Schema definitions for channel history extraction (SimpleMem-style atomic fact extraction).
 * Provides both Zod validation schemas and JSON schema objects for Google/OpenRouter providers.
 */

import { z } from "zod";

/**
 * Zod schema for a single extracted memory entry (atomic fact).
 * Each entry represents one self-contained piece of information with resolved references.
 *
 * Accepts a bare string as well as the object form. The entry has exactly one required
 * field, and models routinely collapse such a single-field object down to the field's value
 * — observed with Gemini via OpenRouter returning `memories: ["fact", ...]`. The collapsed
 * form is unambiguous, so it is repaired here rather than failing the whole window.
 */
export const HistoryMemoryEntrySchema = z.preprocess(
  (value) => (typeof value === "string" ? { lossless_restatement: value } : value),
  z.object({
    /**
     * The self-contained restatement with all pronouns resolved.
     *
     * Only emptiness is rejected. A short fact ("I like Kim") is still a valid extraction,
     * so there is no lower bound beyond "not blank"; whitespace-only entries are trimmed
     * away and dropped.
     */
    lossless_restatement: z.string().trim().min(1).max(1000),
  }),
);

/** Type for a single extracted memory entry */
export type HistoryMemoryEntry = z.infer<typeof HistoryMemoryEntrySchema>;

/**
 * Zod schema for the complete extraction result containing all memories from a window.
 *
 * Validates entries individually and keeps the good ones, reporting how many were
 * discarded. A single malformed entry used to fail the whole window through
 * `z.array(HistoryMemoryEntrySchema)`, throwing away every valid fact alongside it — the
 * count is surfaced instead of the loss being silent.
 */
export const HistoryExtractionResultSchema = z
  .object({
    memories: z.array(z.unknown()),
  })
  .transform((raw) => {
    const memories: HistoryMemoryEntry[] = [];
    let discarded = 0;

    for (const entry of raw.memories) {
      const parsed = HistoryMemoryEntrySchema.safeParse(entry);
      if (parsed.success) {
        memories.push(parsed.data);
        continue;
      }
      discarded++;
    }

    return { memories, discarded };
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
        description: "Extracted facts. Each element must be an object, not a bare string.",
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
