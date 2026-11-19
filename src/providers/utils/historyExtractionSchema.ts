import { z } from "zod";

// Bare strings are normalized to objects because models such as Gemini via OpenRouter collapse single-field objects
// into string arrays.
const HistoryMemoryEntrySchema = z.preprocess(
  (value) => (typeof value === "string" ? { lossless_restatement: value } : value),
  z.object({
    // Minimum length stays 1 after trimming because short facts such as 'I like Kim' are valid extractions and only
    // blank entries should fail.
    lossless_restatement: z.string().trim().min(1).max(1000),
  }),
);

export type HistoryMemoryEntry = z.infer<typeof HistoryMemoryEntrySchema>;

// Entries are validated individually via safeParse because z.array(HistoryMemoryEntrySchema) would reject the whole
// window on one bad item.
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
