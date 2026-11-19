// Request builders and context truncation must share this resolution because drifting over-reserves output budget and
// silently drops chat history.
import { parsePositiveIntegerEnv } from "@/utils/misc/envFlags";

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

// Kept at 16384 and decoupled from config.llm_max_output_tokens because short chat reply caps would otherwise
// silently truncate 16-field persona schemas.
export const DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS = 16384;

// Sized at 2048 for multi-paragraph appearance detail because 1024 can clip detailed character descriptions.
const DEFAULT_VISION_CAPTION_MAX_OUTPUT_TOKENS = 2048;

function resolveMaxOutputTokens(params: {
  configured: number | null | undefined;
  envRaw: string | undefined;
  fallback: number;
  providerReportedMax?: number;
}): number {
  const { configured, envRaw, fallback, providerReportedMax } = params;

  // Highest-priority intent: server override → provider env cap → caller fallback.
  const desired = (configured ?? parsePositiveIntegerEnv(envRaw) ?? fallback) || fallback;

  if (typeof providerReportedMax === "number" && providerReportedMax > 0) {
    return Math.max(1, Math.min(providerReportedMax, desired));
  }
  return Math.max(1, desired);
}

// Omitted OpenAI-compatible and custom endpoints keep a flat 4096 budget with no env cap, because edits here alter
// live requests as well as the reserve.
const CHAT_OUTPUT_BUDGETS: Readonly<Record<string, { envVar?: string; fallback: number }>> = {
  openrouter: { envVar: "OPENROUTER_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  google: { envVar: "GOOGLE_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  vertex: { envVar: "GOOGLE_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  vertexexpress: { envVar: "GOOGLE_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  anthropic: { envVar: "ANTHROPIC_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  novelai: { fallback: 2048 },
};
const OPENAI_COMPATIBLE_CHAT_OUTPUT_FALLBACK = 4096;

// Default output is capped at 25% of context because the truncator reserves reply tokens first, which on a 4096
// num_ctx would leave zero history.
const MAX_DEFAULT_OUTPUT_WINDOW_SHARE = 0.25;

// Shared by provider requests and the truncator so reply budget and reserve stay aligned, except NovelAI whose
// reserve follows its subscription tier.
export function resolveChatMaxOutputTokens(params: {
  provider: string;
  configured: number | null | undefined;
  modelMaxOutputTokens: number | null;
  contextWindow: number | null;
}): number {
  const budget = CHAT_OUTPUT_BUDGETS[params.provider];
  const providerFallback = budget?.fallback ?? OPENAI_COMPATIBLE_CHAT_OUTPUT_FALLBACK;
  const fallback = params.contextWindow
    ? Math.min(providerFallback, Math.floor(params.contextWindow * MAX_DEFAULT_OUTPUT_WINDOW_SHARE))
    : providerFallback;
  return resolveMaxOutputTokens({
    configured: params.configured,
    envRaw: budget?.envVar ? process.env[budget.envVar] : undefined,
    fallback,
    providerReportedMax: params.modelMaxOutputTokens ?? undefined,
  });
}

// Clamped by configured llm_max_output_tokens because preset schemas need more than a chat reply, yet exceeding a
// user cap causes rejections or excess billing.
export function resolvePresetGenerationMaxOutputTokens(params?: {
  configured?: number | null;
  modelCeiling?: number;
}): number {
  const configured = params?.configured;

  // A configured ceiling wins only when it is lower; otherwise the preset default applies.
  const desired =
    typeof configured === "number" && configured > 0
      ? Math.min(configured, DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS)
      : DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS;

  return resolveMaxOutputTokens({
    configured: desired,
    envRaw: undefined,
    fallback: desired,
    providerReportedMax: params?.modelCeiling,
  });
}

// Configured output caps are omitted here because short chat-reply caps would silently truncate appearance
// descriptions needed by persona generation.
export function resolveVisionCaptionMaxOutputTokens(providerReportedMax?: number): number {
  return resolveMaxOutputTokens({
    configured: undefined,
    envRaw: undefined,
    fallback: DEFAULT_VISION_CAPTION_MAX_OUTPUT_TOKENS,
    providerReportedMax,
  });
}
