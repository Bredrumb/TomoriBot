import { z } from "zod";

export function buildRoleplaySchema() {
  return {
    type: "object" as const,
    properties: {
      overall_scene_summary: { type: "string" as const },
    },
    required: ["overall_scene_summary"],
  };
}

export const CompactRoleplaySummarySchema = z.object({
  overall_scene_summary: z.string(),
});
