import type { NovelAIParameters } from "@/providers/novelai/novelaiService";
import type { NovelAITokenizerFamily } from "@/utils/provider/localTokenizerRegistry";
import type { AssembledServerConfig, NaiPresetRow } from "@/types/db/schema";
import { naiPresetSections } from "@/db/seed/catalog/naiPresets";
import type { NaiModelTarget } from "@/db/seed/catalog/types";

interface NovelAIProfilePolicy {
  codename: string;
  endpoint: "/oa/v1/completions" | "/ai/generate-stream";
  tokenizer: NovelAITokenizerFamily;
  contextByTier: Readonly<Record<number, number>>;
  defaultOutputTokens: number;
  outputCeiling: number | null;
  nativeFramingTokens: number;
  sentenceCompletionReserve: number;
  characterPrefix: boolean;
  thinkingByDefault: boolean;
  stopStrings: readonly string[];
  sentenceBuffering: boolean;
  normalizeMessages: boolean;
  parameters: () => NovelAIParameters;
  samplingPresetTarget: NaiModelTarget | null;
}

export type NovelAIModelProfile = NovelAIProfilePolicy &
  ({ renderer: "xialong"; systemPrompt: string } | { renderer: "glm" | "story" });

function defaultSamplingParameters(target: NaiModelTarget): NovelAIParameters {
  const preset = naiPresetSections
    .flatMap((section) => section.rows)
    .find((row) => row.modelTarget === target && row.isDefault);
  if (!preset) throw new Error(`Missing NovelAI sampling default for ${target}`);
  return structuredClone(preset.parameters);
}

function getStoryParameters(target: "kayra" | "erato"): NovelAIParameters {
  return {
    ...defaultSamplingParameters(target),
    cfg_scale: 1,
    generate_until_sentence: true,
    use_string: true,
    bracket_ban: true,
    stop_sequences: [],
  };
}

function getGlmParameters(): NovelAIParameters {
  return {
    max_length: 4096,
    min_length: 1,
    temperature: 1.0,
    top_k: 40,
    top_p: 0.95,
    top_a: 1,
    tail_free_sampling: 1,
    typical_p: 1,
    repetition_penalty: 0,
    repetition_penalty_range: 0,
    repetition_penalty_slope: 0,
    repetition_penalty_frequency: 0,
    repetition_penalty_presence: 0.5,
    cfg_scale: 1,
    phrase_rep_pen: "medium",
    use_string: true,
    stop_sequences: [],
  };
}

// Native completions exceeded their requested length by 20 tokens, so reserve 64 until production traces justify another value.
const NATIVE_SENTENCE_RESERVE = 64;
const XIALONG_SYSTEM_PROMPT =
  "You are Xialong (夏龍), an AI model finetuned by Anlatan. You follow the user's instructions precisely while bringing creativity, nuance, and depth to every response. Adapt your voice and style to match what the task demands.";

// Base windows follow published tiers because rollover recall is unverified, while native output follows the API's 2,048-token ceiling and Kayra reserves its extra input token.
const profiles: Readonly<Record<string, NovelAIModelProfile>> = {
  "glm-4-6": {
    codename: "glm-4-6",
    endpoint: "/oa/v1/completions",
    renderer: "glm",
    tokenizer: "novelai_glm",
    contextByTier: { 1: 8192, 2: 28672, 3: 28672 },
    defaultOutputTokens: 1024,
    outputCeiling: null,
    nativeFramingTokens: 0,
    sentenceCompletionReserve: 0,
    characterPrefix: true,
    thinkingByDefault: true,
    stopStrings: ["<|user|>", "<|observation|>", "<|system|>", "</think>"],
    sentenceBuffering: true,
    normalizeMessages: true,
    parameters: getGlmParameters,
    samplingPresetTarget: null,
  },
  "xialong-v1": {
    codename: "xialong-v1",
    endpoint: "/oa/v1/completions",
    renderer: "xialong",
    systemPrompt: XIALONG_SYSTEM_PROMPT,
    tokenizer: "novelai_glm",
    contextByTier: { 3: 28672 },
    defaultOutputTokens: 1024,
    outputCeiling: null,
    nativeFramingTokens: 0,
    sentenceCompletionReserve: 0,
    characterPrefix: false,
    thinkingByDefault: false,
    stopStrings: ["<|user|>", "<|observation|>", "<|system|>", "</think>"],
    sentenceBuffering: true,
    normalizeMessages: true,
    parameters: () => ({
      ...getGlmParameters(),
      ...defaultSamplingParameters("xialong"),
    }),
    samplingPresetTarget: "xialong",
  },
  "kayra-v1": {
    codename: "kayra-v1",
    endpoint: "/ai/generate-stream",
    renderer: "story",
    tokenizer: "novelai_nerdstash_v2",
    contextByTier: { 1: 4096, 2: 8192, 3: 8192 },
    defaultOutputTokens: 150,
    outputCeiling: 2048,
    nativeFramingTokens: 1,
    sentenceCompletionReserve: NATIVE_SENTENCE_RESERVE,
    characterPrefix: true,
    thinkingByDefault: false,
    stopStrings: [],
    sentenceBuffering: false,
    normalizeMessages: true,
    parameters: () => getStoryParameters("kayra"),
    samplingPresetTarget: "kayra",
  },
  "llama-3-erato-v1": {
    codename: "llama-3-erato-v1",
    endpoint: "/ai/generate-stream",
    renderer: "story",
    tokenizer: "novelai_llama3",
    contextByTier: { 3: 8192 },
    defaultOutputTokens: 150,
    outputCeiling: 2048,
    nativeFramingTokens: 0,
    sentenceCompletionReserve: NATIVE_SENTENCE_RESERVE,
    characterPrefix: true,
    thinkingByDefault: false,
    stopStrings: [],
    sentenceBuffering: false,
    normalizeMessages: true,
    parameters: () => getStoryParameters("erato"),
    samplingPresetTarget: "erato",
  },
};

export function getNovelAIProfile(codename: string): NovelAIModelProfile {
  const profile = profiles[codename];
  if (!profile) throw new Error(`Unknown NovelAI model: ${codename}`);
  return profile;
}

export function getNovelAISamplerConfig(
  model: string,
  preset?: NaiPresetRow | null,
): Pick<AssembledServerConfig, "llm_temperature" | "llm_top_k" | "llm_top_p" | "llm_min_p"> & {
  nai_preset_name: string | null;
} {
  const defaults = getNovelAIProfile(model).parameters();
  const params = preset?.parameters ?? defaults;
  return {
    nai_preset_name: preset?.preset_name ?? null,
    llm_temperature: typeof params.temperature === "number" ? params.temperature : (defaults.temperature ?? 1),
    llm_top_k: typeof params.top_k === "number" ? Math.round(params.top_k) : (defaults.top_k ?? 0),
    llm_top_p: typeof params.top_p === "number" ? params.top_p : (defaults.top_p ?? 1),
    llm_min_p: typeof params.min_p === "number" ? params.min_p : (defaults.min_p ?? 0),
  };
}

export function enableNovelAIPresetSamplers(disabled: Readonly<AssembledServerConfig["llm_disabled_params"]>) {
  return disabled.filter((key) => !["temperature", "topK", "topP", "minP"].includes(key));
}
