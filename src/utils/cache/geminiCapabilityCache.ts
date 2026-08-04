import type { ModelTokenLimits } from "./openrouterCapabilityCache";

/**
 * Static map of known Google Gemini model codenames to their token limits.
 *
 * contextLength     = total context window (input + output tokens) per official Google docs.
 * maxCompletionTokens = what googleProvider.ts actually requests (maxOutputTokens: 8192).
 *
 * When a model is not present in this map, getGeminiTokenLimits() returns undefined
 * and truncation is silently skipped , so a safe fallback for future or unknown models.
 */
const GEMINI_TOKEN_LIMITS: Readonly<Record<string, ModelTokenLimits>> = {
  "gemini-2.0-flash": { contextLength: 1_048_576, maxCompletionTokens: 8192 },
  "gemini-2.5-flash-lite": {
    contextLength: 1_048_576,
    maxCompletionTokens: 8192,
  },
  "gemini-2.5-flash-preview-05-20": {
    contextLength: 1_048_576,
    maxCompletionTokens: 8192,
  },
  "gemini-2.5-flash-preview-09-2025": {
    contextLength: 1_048_576,
    maxCompletionTokens: 8192,
  },
  "gemini-2.5-flash": { contextLength: 1_048_576, maxCompletionTokens: 8192 },
  "gemini-2.5-pro": { contextLength: 1_048_576, maxCompletionTokens: 8192 },
  "gemini-3-flash": {
    contextLength: 1_048_576,
    maxCompletionTokens: 8192,
  },
  "gemini-3-flash-preview": {
    contextLength: 1_048_576,
    maxCompletionTokens: 8192,
  },
  "gemini-3-pro-preview": {
    contextLength: 1_048_576,
    maxCompletionTokens: 8192,
  },
  "gemini-3.1-pro-preview": {
    contextLength: 1_048_576,
    maxCompletionTokens: 8192,
  },
  "gemini-3.5-flash-lite": {
    contextLength: 1_048_576,
    maxCompletionTokens: 8192,
  },
  "gemma-4-31b-it": { contextLength: 262_144, maxCompletionTokens: 8192 },
  "gemma-4-26b-a4b-it": { contextLength: 262_144, maxCompletionTokens: 8192 },
  "gemma-3-27b-it": { contextLength: 131_072, maxCompletionTokens: 8192 },
};

/**
 * Gets the token limits for a known Google Gemini model.
 *
 * Uses a compile-time constant map : no async initialization required.
 * Returns undefined for models not in the map so truncation is skipped safely.
 *
 * @param modelCodename - Model codename (e.g., "gemini-2.5-flash")
 * @returns ModelTokenLimits if the model is known, undefined otherwise
 */
export function getGeminiTokenLimits(modelCodename: string): ModelTokenLimits | undefined {
  return GEMINI_TOKEN_LIMITS[modelCodename];
}
