import type { ThinkingLevelValue } from "@/constants/thinkingLevels";

// Sentinel `null` on a sampler field means the user explicitly cleared it, so callers treat it differently from an
// unsubmitted field.
export interface ModelParameterOptions {
  temperature: number | null;
  top_p: number | null;
  top_k: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  min_p: number | null;
  max_output_tokens: number | null;
  thinking_level: ThinkingLevelValue | null;
}
