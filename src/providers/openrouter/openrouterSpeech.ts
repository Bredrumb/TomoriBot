import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { beginProviderRequest, type ProviderRequestHold } from "@/utils/provider/providerRequestHook";
import { findOpenRouterSpeechModel } from "@/providers/openrouter/openrouterSpeechModels";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { log } from "@/utils/misc/logger";
import {
  checkSpeechStatus,
  HOSTED_SPEECH_LIMITS,
  HostedSpeechError,
  readSpeechJson,
  speechErrorBody,
  validateSpeechAudio,
  type SpeechOperation,
} from "@/utils/speech/hostedSpeech";

// Live Seed and Fish generations returned 404 from the generation endpoint until 4-8 s after the audio response.
const COST_LOOKUP_DELAYS_MS = [4_000, 2_000, 2_000, 4_000, 8_000, 16_000] as const;
const generationCostSchema = z.object({
  data: z.object({ total_cost: z.number().finite().nonnegative().nullable().optional() }),
});

export async function synthesizeOpenRouterSpeech(request: OpenRouterSpeechRequest): Promise<Buffer> {
  request.signal.throwIfAborted();
  const hold = await beginProviderRequest({
    apiKey: request.apiKey,
    path: "/audio/speech",
    body: {
      model: request.model,
      input: buildSpeechBody(request).input,
    },
  });
  let settling = false;
  try {
    if (request.signal.aborted) {
      hold?.reportCost(0);
      request.signal.throwIfAborted();
    }
    const { audio, generationId } = await synthesizeSpeech(request, hold);
    settling = true;
    // Capturing only the callback keeps a clone's reference WAV out of the settlement closure.
    const { onCostSettled } = request;
    // Settlement ignores the request signal because OpenRouter has already billed the audio by this point.
    void settleOpenRouterSpeechCost(request.apiKey, request.model, generationId).then((cost) => {
      if (cost !== undefined) hold?.reportCost(cost);
      hold?.release(true);
      onCostSettled?.(cost);
    });
    return audio;
  } finally {
    if (!settling) hold?.release(false);
  }
}

// Settlement is process-local, so a restart inside the lookup window drops that clip's usage row; persist pending generation IDs if unattributed voice spend reappears.
export async function settleOpenRouterSpeechCost(
  apiKey: string,
  model: string,
  generationId: string | undefined,
  delaysMs: readonly number[] = COST_LOOKUP_DELAYS_MS,
): Promise<number | undefined> {
  let failure: { reason: string; status?: number; error?: unknown } = { reason: "missing_generation_id" };
  if (generationId) {
    const url = `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`;
    const headers = { Authorization: `Bearer ${apiKey}`, ...buildOpenRouterAttributionHeaders() };
    try {
      for (const delay of delaysMs) {
        await sleep(delay);
        const signal = AbortSignal.timeout(HOSTED_SPEECH_LIMITS.costTimeoutMs);
        const response = await fetch(url, { headers, redirect: "error", signal });
        if (!response.ok) {
          await response.body?.cancel();
          failure = { reason: "lookup_status", status: response.status };
          if (response.status === 404 || response.status >= 500) continue;
          break;
        }
        const parsed = generationCostSchema.safeParse(
          await readSpeechJson(response, signal, HOSTED_SPEECH_LIMITS.metadataBytes),
        );
        if (!parsed.success) {
          failure = { reason: "malformed_metadata", status: response.status };
          break;
        }
        if (parsed.data.data.total_cost != null) return parsed.data.data.total_cost;
        failure = { reason: "cost_pending", status: response.status };
      }
    } catch (error) {
      failure = { reason: "lookup_failed", error };
    }
  }
  log.warn(
    "OpenRouter speech cost did not settle",
    failure.error,
    { metadata: { model, generationId, reason: failure.reason, status: failure.status } },
    { retain: true, redactValues: [apiKey] },
  );
  return undefined;
}

// Seed interprets its single prompt instead of reading it aloud and ignores OpenRouter's instructions field, so voice
// description and direction both go inside it.
export function buildSeedDesignPrompt(description: string, script: string, direction?: string): string {
  const delivery = direction?.trim();
  // An inner double quote would end the spoken line early, so Seed would read the rest as direction.
  const line = script.trim().replaceAll('"', "'");
  return `Speaker (${description.trim()}) says${delivery ? `, ${delivery}` : ""}: "${line}"`;
}

type OpenRouterSpeechRequest = {
  model: string;
  apiKey: string;
  signal: AbortSignal;
  maxBytes: number;
  operations: SpeechOperation[];
  onCostSettled?: (cost: number | undefined) => void;
} & (
  | { shape: "clone"; script: string; direction?: string; reference: Buffer; transcript: string | null }
  | { shape: "design"; description: string; script: string; direction?: string }
);

function buildSpeechBody(request: OpenRouterSpeechRequest): Record<string, unknown> {
  if (request.shape === "design") {
    return {
      model: request.model,
      input: buildSeedDesignPrompt(request.description, request.script, request.direction),
      response_format: "mp3",
    };
  }
  return {
    model: request.model,
    input: request.script,
    instructions: request.direction,
    response_format: "mp3",
    input_references: [
      { type: "input_audio", input_audio: { data: `data:audio/wav;base64,${request.reference.toString("base64")}` } },
      ...(request.transcript ? [{ type: "text", text: request.transcript }] : []),
    ],
  };
}

export async function throwOpenRouterAudioError(
  response: Response,
  apiKey: string,
  signal: AbortSignal,
): Promise<never> {
  const rawBody = await readBoundedResponse(response, HOSTED_SPEECH_LIMITS.metadataBytes, signal).then(
    (buffer) => buffer.toString("utf8"),
    () => undefined,
  );
  const body = rawBody === undefined ? undefined : speechErrorBody(rawBody, apiKey);
  const limit = rawBody === undefined ? null : readOpenRouterLimitError(response.status, response.headers, rawBody);
  try {
    checkSpeechStatus(response, body);
  } catch (error) {
    if (limit && error instanceof HostedSpeechError)
      throw new HostedSpeechError(error.kind, error.providerStatus, error.providerBody, {
        cause: limit,
        code: error.providerCode,
      });
    throw error;
  }
  throw new HostedSpeechError("provider_error", response.status, body);
}

async function synthesizeSpeech(
  request: OpenRouterSpeechRequest,
  hold?: ProviderRequestHold,
): Promise<{ audio: Buffer; generationId?: string }> {
  const spec = findOpenRouterSpeechModel(request.model);
  if (!spec || spec.shape !== request.shape) throw new HostedSpeechError("invalid_request");
  if (
    spec.shape === "design" &&
    request.shape === "design" &&
    (request.script.trim().length > spec.scriptCharacters ||
      buildSeedDesignPrompt(request.description, request.script, request.direction).length > spec.promptCharacters)
  ) {
    throw new HostedSpeechError("script_too_long");
  }
  request.signal.throwIfAborted();
  const operation: SpeechOperation = { operation: "synthesize", success: false };
  request.operations.push(operation);
  const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      ...buildOpenRouterAttributionHeaders(),
    },
    redirect: "error",
    signal: request.signal,
    body: JSON.stringify(buildSpeechBody(request)),
  });
  operation.status = response.status;
  const generationId = response.headers.get("X-Generation-Id");
  if (generationId && /^[a-zA-Z0-9_-]{1,200}$/.test(generationId)) operation.generationId = generationId;
  if (!response.ok) {
    hold?.reportCost(0);
    await throwOpenRouterAudioError(response, request.apiKey, request.signal);
  }
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "audio/mpeg") {
    await response.body?.cancel();
    throw new HostedSpeechError("malformed_response");
  }
  const audio = await readBoundedResponse(response, request.maxBytes, request.signal);
  await validateSpeechAudio(audio, "audio/mpeg", request.maxBytes);
  operation.success = true;
  return { audio, generationId: operation.generationId };
}
