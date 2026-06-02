import { DEFAULT_THINKING_LEVEL, type ThinkingLevelValue } from "@/constants/thinkingLevels";
import type { SavedProviderConfigRow } from "@/types/db/schema";

/**
 * Raw sampler option values from the /model parameters slash command.
 * null means the option was not provided by the user.
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

/** Sampler fields written into the saved provider config by /model parameters. */
export interface ModelParameterSamplerPatch {
  llm_temperature: number | null | undefined;
  llm_top_p: number | null | undefined;
  llm_top_k: number | null | undefined;
  llm_frequency_penalty: number | null | undefined;
  llm_presence_penalty: number | null | undefined;
  llm_min_p: number | null | undefined;
  /** null when both option and saved config are absent. */
  llm_max_output_tokens: number | null;
  thinking_level: ThinkingLevelValue;
}

/** The sampler-relevant slice of a saved provider config row. */
export type ModelParameterSavedConfigSnapshot = Pick<
  SavedProviderConfigRow,
  | "llm_temperature"
  | "llm_top_p"
  | "llm_top_k"
  | "llm_frequency_penalty"
  | "llm_presence_penalty"
  | "llm_min_p"
  | "llm_max_output_tokens"
  | "thinking_level"
>;

/**
 * Overlays slash command option values onto a saved provider config sampler snapshot.
 * Each field takes the user-provided value when non-null, otherwise falls back to the
 * saved config value. max_output_tokens falls to null (not undefined) when both are
 * absent. Non-sampler provider fields (api_key, llm_id, server_id, etc.) are not
 * included in the returned patch — the caller merges it into the full config with spread.
 */
export function buildModelParametersSamplerPatch(
  options: ModelParameterOptions,
  savedConfig: ModelParameterSavedConfigSnapshot,
): ModelParameterSamplerPatch {
  return {
    llm_temperature: options.temperature ?? savedConfig.llm_temperature,
    llm_top_p: options.top_p ?? savedConfig.llm_top_p,
    llm_top_k: options.top_k ?? savedConfig.llm_top_k,
    llm_frequency_penalty: options.frequency_penalty ?? savedConfig.llm_frequency_penalty,
    llm_presence_penalty: options.presence_penalty ?? savedConfig.llm_presence_penalty,
    llm_min_p: options.min_p ?? savedConfig.llm_min_p,
    llm_max_output_tokens: options.max_output_tokens ?? savedConfig.llm_max_output_tokens ?? null,
    thinking_level: options.thinking_level ?? savedConfig.thinking_level ?? DEFAULT_THINKING_LEVEL,
  };
}
