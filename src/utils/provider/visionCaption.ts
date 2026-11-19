import {
  getProviderContentRejectionCode,
  providerContentRejectionSchema,
} from "@/utils/provider/providerErrorClassification";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import type { ToolFailure } from "@/types/tool/interfaces";
import { createProviderToolFailure } from "@/utils/provider/providerToolFailure";
import { withProviderUsageContext } from "@/utils/provider/providerUsage";
import {
  createProviderUsageRecorder,
  findProviderRequestDeniedError,
  type ProviderRequestDeniedError,
} from "@/utils/provider/providerUsage";

import { GoogleGenAI, type Part } from "@google/genai";
import { llmModelRepo } from "@/utils/db/repositories";
import { redactLogString } from "@/utils/misc/logger";
import { getResolvedCapabilityModelId, resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import { toDeepseekApiModelName } from "@/providers/deepseek/deepseekShared";
import { resolveVisionCaptionMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { getEndpointRemotePolicy } from "@/utils/security/remoteUrlSecurity";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import {
  toZaiApiModelName,
  ZAI_CODING_CHAT_COMPLETIONS_URL,
  ZAI_GENERAL_CHAT_COMPLETIONS_URL,
} from "@/providers/zai/zaiShared";
import { createVertexClient, parseVertexCompositeKey } from "@/providers/vertex/vertexClient";
import { createVertexexpressClient } from "@/providers/vertexexpress/vertexexpressClient";
import type { LlmRow } from "@/types/db/schema";
import { normalizeProviderUsage, type TokenUsage } from "@/utils/text/tokenEstimate";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { fetchWithProviderRequest } from "@/utils/provider/providerRequestHook";

// Raw base64 payload paired with its MIME type because provider adapters embed data directly alongside mimeType.
export interface VisionImage {
  data: string;
  mimeType: string;
}

// Explicit map with no OpenAI fallback so an unsupported provider is rejected instead of leaking a foreign bearer key
// to OpenAI.
const PROVIDER_CHAT_COMPLETIONS_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  zai: ZAI_GENERAL_CHAT_COMPLETIONS_URL,
  zaicoding: ZAI_CODING_CHAT_COMPLETIONS_URL,
  deepseek: "https://api.deepseek.com/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
};

const GOOGLE_SDK_PROVIDERS = new Set(["google", "vertex", "vertexexpress"]);

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// Caps a single caption call at 60s by default because persona generation leaves little Discord interaction margin
// for a stalled provider.
const parsedVisionCaptionTimeoutMs = Number.parseInt(process.env.VISION_CAPTION_TIMEOUT_MS ?? "", 10);
const VISION_CAPTION_TIMEOUT_MS =
  Number.isFinite(parsedVisionCaptionTimeoutMs) && parsedVisionCaptionTimeoutMs > 0
    ? parsedVisionCaptionTimeoutMs
    : 60_000;

type VisionCallFailureReason =
  | "credentials_unavailable"
  | "no_vision_model"
  | "unsupported_provider"
  | "request_failed"
  | "empty_response";

export interface VisionCallResult {
  ok: boolean;
  text?: string;
  provider?: string;
  model?: string;
  failure?: { reason: VisionCallFailureReason; detail?: string };
  requestDenied?: ProviderRequestDeniedError;
  toolFailure?: ToolFailure;
}

// Mismatched model IDs reload from DB because cached vision_llm predates personal BYOK overrides, pairing the
// credential transport with its codename.
async function resolveVisionModelForCredentials(
  creds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>,
  cachedVisionLlm: LlmRow | null | undefined,
): Promise<LlmRow | null> {
  const resolvedModelId = getResolvedCapabilityModelId(creds, "vision");
  if (resolvedModelId && resolvedModelId !== cachedVisionLlm?.llm_id) {
    return await llmModelRepo.loadById(resolvedModelId);
  }
  return cachedVisionLlm ?? null;
}

// Custom endpoints use customEndpointModelName because llm_codename is a local catalog key rejected by backends;
// backends ignoring model keep llmCodename.
export function resolveVisionApiModelName(
  provider: string,
  llmCodename: string,
  customEndpointModelName?: string | null,
): string {
  const normalized = normalizeProviderName(provider);

  if (normalized === "zai" || normalized === "zaicoding") {
    return toZaiApiModelName(llmCodename);
  }

  if (normalized === "deepseek") {
    return toDeepseekApiModelName(llmCodename);
  }

  return customEndpointModelName?.trim() || llmCodename;
}

// Callers enforcing their own deadline must pass timeoutMs rather than only abortSignal, since fallback
// VISION_CAPTION_TIMEOUT_MS can silently win.
export async function analyzeImageWithVisionModel(input: {
  serverId: number;
  locale?: string;
  image: VisionImage;
  prompt: string;
  // Cached vision row is only a fast-path hint, because a resolved credential for a different model reloads the
  // matching row instead.
  cachedVisionLlm?: LlmRow | null;
  userId?: number | null;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<VisionCallResult> {
  const timeoutMs =
    typeof input.timeoutMs === "number" && input.timeoutMs > 0 ? input.timeoutMs : VISION_CAPTION_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = input.abortSignal ? AbortSignal.any([input.abortSignal, timeoutSignal]) : timeoutSignal;

  let creds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>;
  try {
    creds = await resolveCapabilityCredentials(input.serverId, "vision", { userId: input.userId ?? null });
  } catch (error) {
    return {
      ok: false,
      requestDenied: findProviderRequestDeniedError(error) ?? undefined,
      failure: {
        reason: "credentials_unavailable",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const visionLlm = await resolveVisionModelForCredentials(creds, input.cachedVisionLlm);
  if (!visionLlm) {
    return { ok: false, failure: { reason: "no_vision_model" } };
  }

  // The credential and the model row are paired by resolveVisionModelForCredentials, so the
  // provider chosen here and the codename sent to it always describe the same model.
  const provider = normalizeProviderName(visionLlm.llm_provider);
  const model = resolveVisionApiModelName(provider, visionLlm.llm_codename, creds.customEndpoint?.model_name);

  try {
    const text = await withProviderUsageContext(creds.usageContext, async () =>
      dispatchVisionRequest(provider, creds.provider, creds.apiKey, model, input.image, input.prompt, signal, creds),
    );
    if (!text.trim()) {
      return { ok: false, provider, model, failure: { reason: "empty_response" } };
    }
    return { ok: true, text, provider, model };
  } catch (error) {
    if (error instanceof UnsupportedVisionProviderError) {
      return { ok: false, provider, model, failure: { reason: "unsupported_provider", detail: error.message } };
    }
    const requestDenied = findProviderRequestDeniedError(error, creds.usageContext) ?? undefined;
    const toolFailure = requestDenied
      ? undefined
      : createProviderToolFailure(error, {
          locale: input.locale ?? "en-US",
          provider,
          credentialScope: creds.source,
          kind: signal.aborted ? "timeout" : undefined,
        }).failure;
    const detail = error instanceof Error ? error.message : String(error);
    if (!requestDenied)
      await reportProviderFailure({
        summary: "Vision request failed",
        errorType: "VisionRequestFailed",
        error: undefined,
        detail: redactLogString(creds.apiKey ? detail.replaceAll(creds.apiKey, "[REDACTED]") : detail),
        expected:
          signal.aborted ||
          providerContentRejectionSchema.safeParse(toolFailure?.code).success ||
          ["401", "402", "403", "429", "timeout", "authentication", "quota", "rate_limit", "content_blocked"].includes(
            toolFailure?.code ?? "",
          ),
        serverId: input.serverId,
        userId: input.userId,
        dimensions: { operation: "vision", provider, model, code: toolFailure?.code ?? "unknown" },
      });
    return {
      ok: false,
      provider,
      model,
      requestDenied,
      toolFailure,
      failure: {
        reason: "request_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

class UnsupportedVisionProviderError extends Error {
  constructor(public provider: string) {
    super(`Provider "${provider}" has no vision transport.`);
    this.name = "UnsupportedVisionProviderError";
  }
}

async function dispatchVisionRequest(
  provider: string,
  rawProvider: string,
  apiKey: string,
  model: string,
  image: VisionImage,
  prompt: string,
  signal: AbortSignal,
  creds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>,
): Promise<string> {
  if (GOOGLE_SDK_PROVIDERS.has(provider)) {
    return await callGoogleSdkVision(provider, apiKey, model, image, prompt, signal);
  }

  if (provider === "anthropic") {
    return await callAnthropicVision(apiKey, model, image, prompt, signal);
  }

  // The custom check needs the stored name, not the canonical one: a custom provider is keyed
  // by connection (`custom:17`), and canonicalizing it to `custom` first would lose the
  // connection the endpoint URL is looked up from.
  const endpointUrl = resolveChatCompletionsUrl(rawProvider, creds.customEndpoint?.endpoint_url ?? null);
  if (!endpointUrl) {
    throw new UnsupportedVisionProviderError(provider);
  }

  return await callOpenAiCompatibleVision(
    apiKey,
    model,
    endpointUrl,
    image,
    prompt,
    signal,
    createProviderUsageRecorder(creds.usageContext, model),
  );
}

// Provider must be the stored name without prior canonicalization, because custom endpoints use custom:<connectionId>
// and return null otherwise.
export function resolveChatCompletionsUrl(provider: string, customEndpointUrl?: string | null): string | null {
  const knownUrl = PROVIDER_CHAT_COMPLETIONS_URLS[provider.trim().toLowerCase()];
  if (knownUrl) return knownUrl;

  if (isCustomProvider(provider)) {
    const url = customEndpointUrl?.trim();
    if (!url) return null;
    return url.endsWith("/chat/completions") ? url : `${url.replace(/\/$/, "")}/chat/completions`;
  }

  return null;
}

async function callGoogleSdkVision(
  provider: string,
  apiKey: string,
  model: string,
  image: VisionImage,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const client = buildGoogleClient(provider, apiKey);

  const parts: Part[] = [{ text: prompt }, { inlineData: { data: image.data, mimeType: image.mimeType } }];

  const result = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: { abortSignal: signal, maxOutputTokens: resolveVisionCaptionMaxOutputTokens() },
  });

  const rejection = getProviderContentRejectionCode(result);
  if (rejection) throw Object.assign(new Error("Vision request blocked by the provider"), { code: rejection });
  const text = result.text;
  if (!text) {
    throw new Error("Vision model returned an empty response.");
  }
  return text;
}

function buildGoogleClient(provider: string, apiKey: string): GoogleGenAI {
  if (provider === "vertex") {
    return createVertexClient(parseVertexCompositeKey(apiKey));
  }
  if (provider === "vertexexpress") {
    return createVertexexpressClient(apiKey);
  }
  return new GoogleGenAI({ apiKey });
}

async function callAnthropicVision(
  apiKey: string,
  model: string,
  image: VisionImage,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetchUserRemoteUrl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: resolveVisionCaptionMaxOutputTokens(),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Anthropic vision returned ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = (data.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");

  if (!text) {
    throw new Error("Anthropic vision returned an empty response. The model may not support image inputs.");
  }
  return text;
}

export async function callOpenAiCompatibleVision(
  apiKey: string,
  model: string,
  endpointUrl: string,
  image: VisionImage,
  prompt: string,
  signal: AbortSignal,
  onUsage?: (usage: TokenUsage) => void,
): Promise<string> {
  const response = await fetchWithProviderRequest(
    endpointUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(endpointUrl === PROVIDER_CHAT_COMPLETIONS_URLS.openrouter && buildOpenRouterAttributionHeaders()),
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
            ],
          },
        ],
        max_tokens: resolveVisionCaptionMaxOutputTokens(),
      }),
      signal,
    },
    (input, init) => fetchUserRemoteUrl(input, init, getEndpointRemotePolicy()),
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Vision API returned ${response.status}: ${errorText}`, {
      cause: readOpenRouterLimitError(response.status, response.headers, errorText) ?? undefined,
    });
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }>; usage?: unknown };
  const usage = normalizeProviderUsage(data.usage);
  if (usage) onUsage?.(usage);
  const content = data.choices?.[0]?.message?.content;

  if (typeof content === "string" && content) {
    return content;
  }

  // Some compatible endpoints return content parts rather than a bare string.
  if (Array.isArray(content)) {
    const joined = content
      .filter(
        (part): part is { type?: string; text?: string } =>
          typeof part === "object" && part !== null && (part as { type?: string }).type === "text",
      )
      .map((part) => part.text ?? "")
      .join("");
    if (joined) return joined;
  }

  throw new Error("Vision API returned an empty response. The model may not support image inputs.");
}
