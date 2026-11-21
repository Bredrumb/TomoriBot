import type { StructuredContextItem } from "@/types/misc/context";

const CHARS_PER_TOKEN_TEXT = 4;

const CHARS_PER_TOKEN_JSON = 3.5;

export interface TokenUsage {
  // Normalized total including cacheReadTokens and cacheWriteTokens so downstream callers never add them twice or
  // branch per provider.
  inputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  // Normalized output total including reasoning tokens (such as Gemini thoughtsTokenCount) because providers bill
  // them at the output rate.
  outputTokens: number;
  costUsd?: number;
}

export function normalizeProviderUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;

  if (u.usage && typeof u.usage === "object") {
    const nested = normalizeProviderUsage(u.usage);
    if (nested) return nested;
  }

  const num = (...keys: string[]): number => {
    for (const key of keys) {
      const value = u[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return 0;
  };

  // Input: OpenAI/OpenRouter prompt tokens, Anthropic input, Gemini prompt count.
  let inputTokens = num("prompt_tokens", "promptTokens", "input_tokens", "inputTokens", "promptTokenCount");
  const optionalCount = (...values: unknown[]): number | undefined =>
    values.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const details = u.prompt_tokens_details ?? u.promptTokensDetails;
  const promptDetails = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const cacheReadTokens = optionalCount(
    u.cacheReadTokens,
    u.cache_read_input_tokens,
    promptDetails.cached_tokens,
    promptDetails.cachedTokens,
    u.cachedContentTokenCount,
    u.prompt_cache_hit_tokens,
  );
  const cacheWriteTokens = optionalCount(
    u.cacheWriteTokens,
    u.cache_creation_input_tokens,
    promptDetails.cache_write_tokens,
    promptDetails.cacheWriteTokens,
  );
  // Add cache counts only for Anthropic because its input_tokens excludes cached input.
  if (typeof u.input_tokens === "number") {
    inputTokens += (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
  }
  // Add Gemini thoughtsTokenCount because reasoning tokens are billed at the output rate outside candidatesTokenCount.
  const outputTokens =
    num("completion_tokens", "completionTokens", "output_tokens", "outputTokens", "candidatesTokenCount") +
    num("thoughtsTokenCount");

  if (inputTokens <= 0 && outputTokens <= 0) return null;
  const usage: TokenUsage = { inputTokens, outputTokens };
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = Math.min(cacheReadTokens, Math.max(0, inputTokens));
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = Math.min(cacheWriteTokens, Math.max(0, inputTokens));
  const cost = optionalCount(u.costUsd, u.cost);
  if (cost !== undefined) usage.costUsd = cost;
  return usage;
}

// Every segment's inputTokens is summed because each tool-loop iteration is a separate billed request, and partial
// cache or cost fields are dropped.
export function sumTurnUsage(streamResults: ReadonlyArray<{ usage?: TokenUsage }>): TokenUsage | null {
  let total: TokenUsage | null = null;
  for (const result of streamResults) {
    const usage = result.usage;
    if (!usage) continue;
    if (!total) {
      total = { ...usage };
      continue;
    }
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    for (const field of ["cacheReadTokens", "cacheWriteTokens", "costUsd"] as const) {
      if (total[field] !== undefined && usage[field] !== undefined) total[field] += usage[field];
      else delete total[field];
    }
  }
  return total;
}

export function charsToTokensText(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_TEXT);
}

export function charsToTokensJson(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_JSON);
}

export function getMcpToolSchemaFraction(
  tools: readonly Record<string, unknown>[],
  mcpNames: readonly string[],
  indent = 0,
): number {
  if (mcpNames.length === 0) return 0;

  const names = new Set<unknown>(mcpNames);
  let totalChars = 0;
  let mcpChars = 0;
  for (const tool of tools) {
    const declarations = Array.isArray(tool.functionDeclarations)
      ? (tool.functionDeclarations as Record<string, unknown>[])
      : [tool];
    for (const declaration of declarations) {
      const openAiFunction = declaration.function as Record<string, unknown> | undefined;
      const chars = JSON.stringify(declaration, null, indent).length;
      totalChars += chars;
      if (names.has(openAiFunction?.name ?? declaration.name)) mcpChars += chars;
    }
  }
  return mcpChars / Math.max(1, totalChars);
}

export function estimateContextItemsTokens(contextItems: StructuredContextItem[]): number {
  let totalChars = 0;
  for (const item of contextItems) {
    for (const part of item.parts) {
      if (part.type === "text") {
        totalChars += part.text.length;
      }
    }
  }
  return charsToTokensText(totalChars);
}
