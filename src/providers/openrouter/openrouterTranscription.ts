import { z } from "zod";
import { throwOpenRouterAudioError } from "@/providers/openrouter/openrouterSpeech";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { fetchWithProviderRequest } from "@/utils/provider/providerRequestHook";
import {
  HOSTED_SPEECH_LIMITS,
  HostedSpeechError,
  readSpeechJson,
  type SpeechOperation,
} from "@/utils/speech/hostedSpeech";

const transcriptionResponseSchema = z.object({
  text: z.string(),
  usage: z
    .object({
      seconds: z.number().nonnegative().nullish(),
      input_tokens: z.number().nonnegative().nullish(),
      output_tokens: z.number().nonnegative().nullish(),
      total_tokens: z.number().nonnegative().nullish(),
      cost: z.number().nonnegative().nullish(),
    })
    .nullish(),
});

export interface HostedTranscriptionRequest {
  model: string;
  apiKey: string;
  /** MP3 bytes; callers transcode first so every catalogue model accepts the format. */
  audio: Buffer;
  signal: AbortSignal;
  operations: SpeechOperation[];
}

export async function transcribeOpenRouterAudio(request: HostedTranscriptionRequest): Promise<string> {
  request.signal.throwIfAborted();
  const operation: SpeechOperation = { operation: "transcribe", success: false };
  request.operations.push(operation);
  const response = await fetchWithProviderRequest("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      ...buildOpenRouterAttributionHeaders(),
    },
    redirect: "error",
    signal: request.signal,
    body: JSON.stringify({
      model: request.model,
      input_audio: { data: request.audio.toString("base64"), format: "mp3" },
    }),
  });
  operation.status = response.status;
  const generationId = response.headers.get("X-Generation-Id");
  if (generationId && /^[a-zA-Z0-9_-]{1,200}$/.test(generationId)) operation.generationId = generationId;
  if (!response.ok) await throwOpenRouterAudioError(response, request.apiKey, request.signal);
  const parsed = transcriptionResponseSchema.safeParse(
    await readSpeechJson(response, request.signal, HOSTED_SPEECH_LIMITS.transcriptResponseBytes),
  );
  if (!parsed.success) throw new HostedSpeechError("malformed_response");
  const usage = parsed.data.usage;
  if (usage) {
    operation.usage = {
      total_input_tokens: usage.input_tokens ?? undefined,
      total_output_tokens: usage.output_tokens ?? undefined,
      total_tokens: usage.total_tokens ?? undefined,
    };
    if (usage.cost != null) operation.actualCost = usage.cost;
  }
  operation.success = true;
  return parsed.data.text;
}
