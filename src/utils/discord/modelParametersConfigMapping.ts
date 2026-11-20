import type { ThinkingLevelValue } from "@/constants/thinkingLevels";

/**
 * Sampler values submitted from the personal model-parameters panel.
 * null means the user cleared the field.
 */
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
