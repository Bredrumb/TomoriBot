/**
 * NovelAI REST API Service
 * Direct HTTP implementation for NovelAI text generation API
 * Supports streaming via Server-Sent Events (SSE)
 */

import { z } from "zod";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import { mergeStopStrings } from "@/providers/utils/stopStrings";
import { log, redactLogString } from "@/utils/misc/logger";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";

const NOVELAI_API_BASE_URL = "https://text.novelai.net";
/** Default timeout for NovelAI API requests in milliseconds */
const REQUEST_TIMEOUT = Number.parseInt(process.env.NOVELAI_REQUEST_TIMEOUT_MS || "60000", 10);

/** Per-read inactivity timeout for streaming: if no data arrives within this window, abort.
 *  Prevents indefinite hangs when NAI's server stops sending chunks mid-stream. */
const STREAM_READ_TIMEOUT_MS = Number.parseInt(process.env.NOVELAI_STREAM_READ_TIMEOUT_MS || "30000", 10);

/**
 * Cancels a response body that is still open after the read loop ended.
 *
 * `releaseLock` only detaches the reader: the body stays open and keeps its buffers and connection.
 * The inactivity timeout above exits the loop without `done`, which is exactly that case, so an
 * unfinished read is cancelled rather than merely released.
 */
async function cancelUnfinishedReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  completed: boolean,
): Promise<void> {
  if (completed) return;
  await reader.cancel().catch(() => undefined);
}

async function* readNovelAISseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  try {
    while (true) {
      let readTimer: ReturnType<typeof setTimeout> | undefined;
      let result: Awaited<ReturnType<typeof reader.read>>;
      try {
        result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            readTimer = setTimeout(
              () => reject(new Error(`NovelAI stream read timed out after ${STREAM_READ_TIMEOUT_MS}ms of inactivity`)),
              STREAM_READ_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (readTimer) clearTimeout(readTimer);
      }
      if (result.done) {
        completed = true;
        buffer += decoder.decode();
        if (buffer.trim()) yield buffer.replace(/\r$/, "");
        return;
      }
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) yield line.replace(/\r$/, "");
    }
  } finally {
    await cancelUnfinishedReader(reader, completed);
    reader.releaseLock();
  }
}

/**
 * NovelAI generation parameters
 * Based on reference implementation and API documentation
 */
export interface NovelAIParameters {
  bad_words_ids?: number[][];
  bracket_ban?: boolean;
  cfg_scale?: number;
  cfg_uc?: string;
  force_emotion?: boolean;
  generate_until_sentence?: boolean;
  logit_bias_exp?: Array<{
    sequence: number[];
    bias: number;
    ensure_sequence_finish: boolean;
    generate_once: boolean;
  }>;
  max_length?: number;
  min_length?: number;
  min_p?: number;
  mirostat_lr?: number | null;
  mirostat_tau?: number | null;
  order?: number[];
  phrase_rep_pen?: "off" | "very_light" | "light" | "medium" | "aggressive" | "very_aggressive";
  prefix?: string;
  repetition_penalty?: number;
  repetition_penalty_frequency?: number;
  repetition_penalty_presence?: number;
  repetition_penalty_range?: number;
  repetition_penalty_slope?: number;
  repetition_penalty_whitelist?: number[];
  stop_sequences?: number[][];
  tail_free_sampling?: number;
  temperature?: number;
  top_a?: number;
  top_g?: number;
  top_k?: number;
  top_p?: number;
  typical_p?: number | null;
  use_string?: boolean;
}

/**
 * NovelAI generation request body
 */
export interface NovelAIGenerationRequest {
  input: string;
  model: string;
  parameters: NovelAIParameters;
  prefix?: string;
  /** Additional stop strings for OpenAI-compatible models (e.g., GLM-4.6). */
  openAIStopStrings?: string[];
}

/**
 * NovelAI SSE stream chunk
 */
export interface NovelAIStreamChunk {
  token?: string;
  final?: boolean;
  error?: string;
  /** Populated from OpenAI-compatible endpoint: "stop", "length", or null */
  finishReason?: string;
  termination?: "stop" | "length" | "eof" | "inactivity";
}

/**
 * OpenAI-compatible completion request (for glm-4-6 and other newer models)
 */
interface OpenAICompletionRequest {
  model: string;
  prompt: string | string[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  min_p?: number;
  stop?: string | string[];
  stream?: boolean;
  seed?: number;
}

/**
 * OpenAI-compatible SSE chunk
 */
const openAIStreamChunkSchema = z.object({
  choices: z
    .array(z.object({ text: z.string().optional(), finish_reason: z.string().nullable().optional() }))
    .optional(),
});

export interface ApiRequestConfig {
  apiKey: string;
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * Based on reference implementation with sensible defaults for roleplay
 */
// Use https://novelai.net/tokenizer to find stop sequences
/**
 * Previously converted temperature from a Gemini-centric scale to NovelAI model scale.
 * Now a direct passthrough: temperature is used as-is across all providers.
 *
 */
function convertTemperatureToNovelAI(temperature: number, _model: string): number {
  return temperature;
}

/**
 * Get parameters for a specific model with optional sampling overrides
 * DB values with neutral defaults are omitted (topK=0, topP=1.0, minP=0.0)
 * so the model preset values are preserved when the user hasn't configured them.
 *
 * Merge priority (lowest → highest):
 * 1. Model hardcoded defaults (getKayraParameters / getGlmParameters)
 * 2. NAI-specific preset overrides (order, tail_free_sampling, phrase_rep_pen, etc.)
 * 3. DB schema values (temperature, topK, topP, minP): always win if non-neutral
 *
 * @param temperature - Optional temperature in Gemini scale (will be converted to NovelAI scale)
 * @param topK - Optional top-K sampling override (0 = use model preset)
 * @param topP - Optional top-P sampling override (1.0 = use model preset)
 * @param minP - Optional min-P sampling override (0.0 = use model preset)
 * @param presetOverrides - Optional NAI-specific preset fields to merge (non-schema params only)
 */
export function getParametersForModel(
  model: string,
  temperature?: number,
  topK?: number,
  topP?: number,
  minP?: number,
  presetOverrides?: Partial<NovelAIParameters>,
): NovelAIParameters {
  const params = getNovelAIProfile(model).parameters();

  // Merge NAI-specific preset fields (order, TFS, phrase_rep_pen, mirostat, etc.)
  //    These override the hardcoded defaults but are themselves overridden by DB schema values.
  if (presetOverrides && Object.keys(presetOverrides).length > 0) {
    Object.assign(params, presetOverrides);
  }

  // Apply DB schema overrides (highest priority: always win if non-neutral)
  // Override temperature if provided (convert from Gemini scale to NovelAI scale)
  if (temperature !== undefined) {
    params.temperature = convertTemperatureToNovelAI(temperature, model);
  }

  if (topK !== undefined && topK > 0) {
    params.top_k = topK;
  }
  if (topP !== undefined && topP < 1.0) {
    params.top_p = topP;
  }
  if (minP !== undefined && minP > 0) {
    params.min_p = minP;
  }

  return params;
}

/**
 * Check if a model requires the OpenAI-compatible API endpoint
 * @returns True if model uses OpenAI endpoint, false for native NovelAI endpoint
 */
export function usesOpenAIEndpoint(model: string): boolean {
  return getNovelAIProfile(model).endpoint === "/oa/v1/completions";
}

/**
 * Convert NovelAI parameters to OpenAI-compatible format
 */
export function convertToOpenAIParams(
  naiParams: NovelAIParameters,
  additionalStopStrings?: string[],
): Partial<OpenAICompletionRequest> {
  const mergedStops = mergeStopStrings(undefined, additionalStopStrings);

  return {
    max_tokens: naiParams.max_length,
    temperature: naiParams.temperature,
    top_p: naiParams.top_p,
    top_k: naiParams.top_k,
    min_p: naiParams.min_p,
    frequency_penalty: naiParams.repetition_penalty_frequency,
    presence_penalty: naiParams.repetition_penalty_presence,
    repetition_penalty: naiParams.repetition_penalty,
    // Specialized GLM stop strings are resolved centrally in providers/utils/stopStrings.ts.
    stop: mergedStops,
  };
}

/**
 * Start streaming generation using OpenAI-compatible API endpoint
 */
async function* novelaiGenerateStreamOpenAI(
  prompt: string,
  model: string,
  parameters: NovelAIParameters,
  config: ApiRequestConfig,
  additionalStopStrings?: string[],
): AsyncGenerator<NovelAIStreamChunk, void, unknown> {
  const { apiKey, timeout = REQUEST_TIMEOUT } = config;

  try {
    const url = `${NOVELAI_API_BASE_URL}/oa/v1/completions`;

    log.info("Starting NovelAI streaming generation (OpenAI-compatible API)");

    const openaiParams = convertToOpenAIParams(parameters, additionalStopStrings);

    const requestBody: OpenAICompletionRequest = {
      model,
      prompt,
      stream: true,
      ...openaiParams,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: config.signal ? AbortSignal.any([controller.signal, config.signal]) : controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = redactLogString(
        (await response.text().catch(() => "Unknown error")).replaceAll(apiKey, "[REDACTED]"),
      );
      log.warn(`NovelAI OpenAI streaming request failed: ${response.status} ${errorText}`);

      const error: Error & { statusCode?: number } = new Error(
        `NovelAI API request failed with status ${response.status}: ${errorText}`,
      );
      error.statusCode = response.status;
      throw error;
    }

    if (!response.body) {
      log.warn("NovelAI OpenAI streaming response has no body");
      const error: Error & { statusCode?: number } = new Error("NovelAI response body is null");
      throw error;
    }

    for await (const line of readNovelAISseLines(response.body)) {
      if (!line.trim() || line.startsWith(":")) {
        continue; // Skip empty lines and comments
      }

      if (line.startsWith("data: ")) {
        const data = line.slice(6); // Remove 'data: ' prefix

        if (data === "[DONE]") {
          yield { final: true, termination: "stop" };
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          throw new Error(`Malformed NovelAI stream event: ${redactLogString(data.replaceAll(apiKey, "[REDACTED]"))}`);
        }

        if (parsed && typeof parsed === "object") {
          const record = parsed as Record<string, unknown>;
          if (record.error) {
            const errorPayload = record.error;
            const rawMessage =
              typeof errorPayload === "object" && errorPayload !== null && "message" in errorPayload
                ? String((errorPayload as { message: unknown }).message)
                : String(errorPayload);
            const message = redactLogString(rawMessage.replaceAll(apiKey, "[REDACTED]"));
            log.warn(`NovelAI OpenAI stream returned error: ${message}`);
            throw new Error(message);
          }

          const chunk = openAIStreamChunkSchema.parse(parsed);
          const finishReason = chunk.choices?.[0]?.finish_reason ?? undefined;

          if (chunk.choices?.[0]?.text) {
            yield {
              token: chunk.choices[0].text,
              final: false,
            };
          }

          if (finishReason) {
            yield { final: true, finishReason, termination: finishReason === "length" ? "length" : "stop" };
            return;
          }
        }
      }
    }
    yield { final: true, termination: "eof" };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        log.warn(`NovelAI OpenAI streaming request timed out after ${timeout}ms`);
        const timeoutError: Error & { statusCode?: number } = new Error("Request timed out");
        timeoutError.statusCode = 504;
        throw timeoutError;
      } else if (error.message.includes("stream read timed out")) {
        // Per-read inactivity timeout because NAI stopped sending data mid-stream.
        // Yield a final chunk so the stream adapter can flush any buffered text
        // (e.g., incomplete sentence trailing buffer) and terminate cleanly.
        log.warn(`NovelAI OpenAI: ${error.message}; yielding final chunk to flush buffers`);
        yield { final: true, termination: "inactivity" };
      } else {
        log.warn("NovelAI OpenAI streaming error:", error);
        throw error;
      }
    } else {
      throw new Error("Unknown error occurred");
    }
  }
}

/**
 * Start streaming generation from NovelAI using native SSE endpoint
 */
async function* novelaiGenerateStreamNative(
  request: NovelAIGenerationRequest,
  config: ApiRequestConfig,
): AsyncGenerator<NovelAIStreamChunk, void, unknown> {
  const { apiKey, timeout = REQUEST_TIMEOUT } = config;

  try {
    const url = `${NOVELAI_API_BASE_URL}/ai/generate-stream`;

    log.info("Starting NovelAI streaming generation");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      signal: config.signal ? AbortSignal.any([controller.signal, config.signal]) : controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = redactLogString(
        (await response.text().catch(() => "Unknown error")).replaceAll(apiKey, "[REDACTED]"),
      );
      log.warn(`NovelAI streaming request failed: ${response.status} ${errorText}`);

      const error: Error & { statusCode?: number } = new Error(
        `NovelAI API request failed with status ${response.status}: ${errorText}`,
      );
      error.statusCode = response.status;
      throw error;
    }

    if (!response.body) {
      log.warn("NovelAI streaming response has no body");
      const error: Error & { statusCode?: number } = new Error("Response body is empty");
      throw error;
    }

    for await (const line of readNovelAISseLines(response.body)) {
      if (!line.trim() || line.startsWith(":")) {
        continue;
      }

      if (line.startsWith("data: ")) {
        const data = line.slice(6); // Remove "data: " prefix
        if (data === "[DONE]") {
          yield { final: true, termination: "stop" };
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch (_parseError) {
          throw new Error("Malformed NovelAI stream event");
        }

        if (typeof parsed === "string") {
          yield { token: parsed };
        } else if (parsed && typeof parsed === "object") {
          const record = parsed as Record<string, unknown>;
          if (typeof record.token === "string") {
            yield { token: record.token };
          } else if (record.error) {
            const errorMsg = redactLogString(
              (typeof record.error === "string" ? record.error : JSON.stringify(record.error)).replaceAll(
                apiKey,
                "[REDACTED]",
              ),
            );
            log.warn(`NovelAI stream returned error: ${errorMsg}`);
            throw new Error(errorMsg);
          }
        }
      }
    }
    yield { final: true, termination: "eof" };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        log.warn("NovelAI streaming timed out");
        const timeoutError: Error & { statusCode?: number } = new Error("Request timed out");
        timeoutError.statusCode = 504;
        throw timeoutError;
      } else if (error.message.includes("stream read timed out")) {
        // Per-read inactivity timeout because NAI stopped sending data mid-stream
        log.warn(`NovelAI Native: ${error.message}; yielding final chunk to flush buffers`);
        yield { final: true, termination: "inactivity" };
      } else {
        log.warn("NovelAI streaming failed:", error);
        throw error;
      }
    } else {
      throw new Error("Unknown error occurred");
    }
  }
}

/**
 * Start streaming generation from NovelAI
 * Routes to the appropriate endpoint based on the model
 */
export async function* novelaiGenerateStream(
  request: NovelAIGenerationRequest,
  config: ApiRequestConfig,
): AsyncGenerator<NovelAIStreamChunk, void, unknown> {
  if (usesOpenAIEndpoint(request.model)) {
    yield* novelaiGenerateStreamOpenAI(
      request.input,
      request.model,
      request.parameters,
      config,
      request.openAIStopStrings,
    );
  } else {
    yield* novelaiGenerateStreamNative(request, config);
  }
}

/**
 * Validate NovelAI API key by fetching user information
 * Uses GET /user/information which works for all account types
 * (subscribed, trial, Anlas-only) without triggering a generation.
 * @returns True if valid, throws error with details if invalid
 * @throws Error with statusCode and message on validation failure
 */
export async function validateNovelAIApiKey(apiKey: string): Promise<boolean> {
  log.info("Validating NovelAI API key");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${NOVELAI_ACCOUNT_API_BASE_URL}/user/information`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      log.success("NovelAI API key is valid");
      return true;
    }

    // Non-OK response: key is invalid or something else went wrong.
    // Carry the response body into the error message: NovelaiStreamAdapter
    // classifies some failures by matching the body text (e.g. trial-account
    // recaptcha 400s), and it is what makes host/endpoint migrations
    // self-diagnosing rather than surfacing as a bare "Bad Request".
    const errorText = redactLogString(
      (await response.text().catch(() => "Unknown error")).replaceAll(apiKey, "[REDACTED]"),
    );
    const error: Error & { statusCode?: number } = new Error(
      `API request failed: ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
    );
    error.statusCode = response.status;

    log.warn(`NovelAI API key validation failed with status ${response.status}: ${errorText}`);
    throw error;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error && "statusCode" in err) {
      throw err;
    }

    const error: Error & { statusCode?: number } = new Error(
      err instanceof Error ? err.message : "Validation request failed",
    );
    error.statusCode = 408;
    throw error;
  }
}

/**
 * Check if an error is related to API key issues
 */
export function isNovelAIApiKeyError(error: string, statusCode?: number): boolean {
  const keywordErrors = ["unauthorized", "invalid api key", "authentication", "bearer"];

  return statusCode === 401 || keywordErrors.some((keyword) => error.toLowerCase().includes(keyword));
}

/**
 * Check if an error is related to insufficient credits
 */
export function isNovelAICreditsError(error: string, statusCode?: number): boolean {
  const creditsKeywords = ["insufficient", "credits", "quota", "billing"];

  return statusCode === 402 || creditsKeywords.some((keyword) => error.toLowerCase().includes(keyword));
}

/**
 * Check if an error is related to rate limiting
 */
export function isNovelAIRateLimitError(error: string, statusCode?: number): boolean {
  const rateLimitKeywords = ["rate limit", "too many requests"];

  return statusCode === 429 || rateLimitKeywords.some((keyword) => error.toLowerCase().includes(keyword));
}

/**
 * Base URL for NovelAI account-management endpoints (/user/*).
 *
 * NovelAI retired third-party access to the legacy api.novelai.net host: every
 * /user/* route there now answers a valid persistent token with
 * HTTP 400 "Please refresh NovelAI.net. If using a third-party tool, update to
 * the image URL." The route paths themselves are unchanged and are served by
 * both text.novelai.net and image.novelai.net; the text host is used here so
 * account calls share an origin with text generation.
 */
const NOVELAI_ACCOUNT_API_BASE_URL = "https://text.novelai.net";

const novelAISubscriptionSchema = z.object({
  tier: z.number().int().nonnegative(),
  active: z.boolean(),
  usage: z
    .object({
      isNegative: z.boolean(),
      percent: z.number().finite(),
      timeUntilNextPercent: z.number().finite(),
    })
    .optional(),
});

export type NovelAISubscription = z.infer<typeof novelAISubscriptionSchema>;

/**
 * Fetches the current NovelAI subscription for a given API key.
 *
 * Uses the account management routes (/user/*), which are served by the same
 * host as text generation. See NOVELAI_ACCOUNT_API_BASE_URL for why the legacy
 * api.novelai.net host can no longer be used.
 *
 * Returns only validated subscription facts consumed by caching and the usage command.
 */
export async function requestNovelAISubscription(apiKey: string): Promise<NovelAISubscription | null> {
  const url = `${NOVELAI_ACCOUNT_API_BASE_URL}/user/subscription`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = redactLogString((await response.text()).replaceAll(apiKey, "[REDACTED]"));
      throw Object.assign(new Error(`NovelAI subscription HTTP ${response.status}: ${body}`), {
        statusCode: response.status,
      });
    }

    const parsed = novelAISubscriptionSchema.safeParse(await response.json());
    if (!parsed.success) {
      log.warn("NovelAI subscription response failed validation; subscription information unavailable.");
      return null;
    }
    return parsed.data;
  } catch (error) {
    const message = redactLogString(
      (error instanceof Error ? error.message : String(error)).replaceAll(apiKey, "[REDACTED]"),
    );
    const statusCode =
      error instanceof Error && error.name === "AbortError"
        ? 504
        : error && typeof error === "object" && "statusCode" in error
          ? error.statusCode
          : undefined;
    throw Object.assign(new Error(message), { statusCode });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchNovelAISubscription(apiKey: string): Promise<NovelAISubscription | null> {
  try {
    return await requestNovelAISubscription(apiKey);
  } catch (error) {
    await reportProviderFailure({
      summary: "NovelAI subscription lookup failed",
      errorType: "ProviderSubscriptionLookup",
      error,
      expected: true,
      detail: error instanceof Error ? error.message : undefined,
      dimensions: { provider: "novelai", operation: "subscription" },
    });
    return null;
  }
}
