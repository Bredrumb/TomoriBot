import { log } from "@/utils/misc/logger";
import type { CustomEndpointRow } from "@/types/db/schema";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { getEndpointRemotePolicy } from "@/utils/security/remoteUrlSecurity";

const OPENAI_STT_TIMEOUT_MS =
  Number.parseInt(process.env.OPENAI_STT_TIMEOUT_MS ?? "", 10) > 0
    ? Number.parseInt(process.env.OPENAI_STT_TIMEOUT_MS ?? "", 10)
    : 60_000;

type OpenAITranscriptionErrorKind = "request_failed" | "timeout" | "empty_transcript" | "invalid_response";

export interface OpenAITranscriptionResult {
  success: boolean;
  transcriptText?: string | null;
  errorKind?: OpenAITranscriptionErrorKind;
  details?: string;
}

export interface OpenAITranscriptionRequest {
  endpoint: CustomEndpointRow;
  // Empty string acts as the sentinel for unauthenticated endpoints because apiKey is required.
  apiKey: string;
  audioBuffer: Buffer;
  filename: string;
  mimeType?: string | null;
}

export async function transcribeViaOpenAIAdapter(
  request: OpenAITranscriptionRequest,
): Promise<OpenAITranscriptionResult> {
  const { endpoint, apiKey, audioBuffer, filename, mimeType } = request;

  const modelName = (endpoint.extra_config.model as string | undefined) ?? "whisper-1";
  const languageHint = (endpoint.extra_config.language as string | undefined) ?? null;
  const baseUrl = endpoint.endpoint_url.replace(/\/+$/, "");
  // Legacy endpoints or custom paths can omit /v1 while new ones include it, so only prepend /v1 when absent.
  const targetUrl = /\/v1$/i.test(baseUrl) ? `${baseUrl}/audio/transcriptions` : `${baseUrl}/v1/audio/transcriptions`;

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: mimeType ?? "application/octet-stream" }),
    filename,
  );
  form.append("model", modelName);
  form.append("response_format", "json");
  if (languageHint) {
    form.append("language", languageHint);
  }

  const headers: Record<string, string> = {};
  if (endpoint.requires_auth && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), OPENAI_STT_TIMEOUT_MS);
    try {
      response = await fetchUserRemoteUrl(
        targetUrl,
        {
          method: "POST",
          headers,
          body: form,
          signal: abortController.signal,
        },
        getEndpointRemotePolicy(),
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    log.warn(`[OpenAISTT] Request to ${targetUrl} ${isTimeout ? "timed out" : "failed"}`, error);
    return {
      success: false,
      errorKind: isTimeout ? "timeout" : "request_failed",
      details: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    let errorDetails = `HTTP ${response.status}`;
    try {
      const errorBody = (await response.json()) as { error?: string | { message?: string } };
      const msg = typeof errorBody.error === "string" ? errorBody.error : (errorBody.error?.message ?? null);
      if (msg) errorDetails += `: ${msg}`;
    } catch {}
    log.warn(`[OpenAISTT] Transcription endpoint returned error: ${errorDetails}`);
    return { success: false, errorKind: "request_failed", details: errorDetails };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return {
      success: false,
      errorKind: "invalid_response",
      details: "Could not parse JSON from transcription response.",
    };
  }

  const text = (data as { text?: string })?.text?.trim() ?? null;
  if (!text) {
    return { success: false, errorKind: "empty_transcript" };
  }

  return { success: true, transcriptText: text };
}
