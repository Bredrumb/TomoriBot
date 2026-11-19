import { log } from "@/utils/misc/logger";
import type { CustomEndpointRow } from "@/types/db/schema";
import { stripElevenLabsExpressionTags } from "@/utils/audio/elevenLabsShared";
import { loadStoredVoiceSampleBuffer } from "@/utils/storage/voiceSampleStorage";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { stripTtsUnsupportedEmojiAttempts } from "@/utils/text/emojiHelper";
import { loadVoiceSampleById } from "@/utils/db/repositories/SpeechRepository";
import { resolveTtsSynthesizeTimeoutMs } from "@/providers/custom/styles/ttsSynthesizeTimeout";
import { getEndpointRemotePolicy } from "@/utils/security/remoteUrlSecurity";

const TTS_SYNTHESIZE_TIMEOUT_MS = resolveTtsSynthesizeTimeoutMs();

const ANY_BRACKET_TAG_REGEX = /\[([^\]\r\n]{1,40})\]/g;
const CHATTERBOX_TURBO_TAGS = new Set([
  "clear throat",
  "sigh",
  "shush",
  "cough",
  "groan",
  "sniff",
  "gasp",
  "chuckle",
  "laugh",
]);

export type TtsCloneErrorKind =
  | "invalid_request"
  | "missing_sample"
  | "sample_read_failed"
  | "request_failed"
  | "timeout"
  | "invalid_response";

export interface TtsCloneResult {
  success: boolean;
  audioBuffer?: Buffer;
  // Bare MIME type without parameters because Discord rejects voice message waveform metadata otherwise.
  contentType?: string;
  extension?: string;
  cleanedCaptionText?: string;
  errorKind?: TtsCloneErrorKind;
  // Endpoint error bodies and headers stay in logs because they can echo the request key, so only the status goes
  // here for replies and tools.
  details?: string;
}

export interface TtsCloneRequest {
  endpoint: CustomEndpointRow;
  voiceSampleId: number;
  script: string;
  // Empty string means local endpoints require no auth.
  apiKey: string;
  voiceInstructions?: string;
  chatterbox?: {
    turboEnabled: boolean;
    cfgWeight: number;
    exaggeration: number;
  };
  abortSignal?: AbortSignal;
}

function resolveExtensionFromContentType(contentType: string): string {
  const bare = contentType.split(";")[0].trim().toLowerCase();
  if (bare === "audio/wav" || bare === "audio/wave" || bare === "audio/x-wav") return "wav";
  if (bare === "audio/ogg" || bare === "audio/opus") return "ogg";
  return "mp3";
}

function stripAllBracketTags(text: string): string {
  return text
    .replace(ANY_BRACKET_TAG_REGEX, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function normalizeTtsWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function stringifyErrorDetail(detail: unknown): string | null {
  if (!detail) return null;
  if (typeof detail === "string") return detail;

  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function stripUnsupportedChatterboxTurboTags(text: string): string {
  return normalizeTtsWhitespace(
    text.replace(ANY_BRACKET_TAG_REGEX, (match, rawTag: string) => {
      const normalizedTag = rawTag.trim().toLowerCase();
      return CHATTERBOX_TURBO_TAGS.has(normalizedTag) ? match : "";
    }),
  );
}

function isIrodoriTtsEndpoint(endpoint: CustomEndpointRow): boolean {
  return [endpoint.label, endpoint.model_name, endpoint.endpoint_url].some((value) =>
    value?.toLowerCase().includes("irodori"),
  );
}

// Endpoint rows carry no engine ID, so this sniffs user-configured text to hide Chatterbox-only controls rather than
// silently doing nothing.
export function isChatterboxEndpoint(endpoint: CustomEndpointRow | null | undefined): boolean {
  if (!endpoint) return false;
  return [endpoint.label, endpoint.model_name, endpoint.endpoint_url].some((value) =>
    value?.toLowerCase().includes("chatterbox"),
  );
}

export interface TtsCloneBufferRequest {
  endpoint: CustomEndpointRow;
  // Reference audio bytes must already be normalized by the caller because this adapter encodes the buffer directly
  // without transcoding.
  refAudio: Buffer;
  refText: string | null;
  script: string;
  // Empty string when local endpoints require no auth.
  apiKey: string;
  voiceInstructions?: string;
  chatterbox?: {
    turboEnabled: boolean;
    cfgWeight: number;
    exaggeration: number;
  };
  abortSignal?: AbortSignal;
}

// Ad-hoc uploads from /generate voice-message lack a voice_samples row, so this direct buffer path must remain
// separate from the sample wrapper.
export async function synthesizeSpeechViaTtsCloneBuffer(request: TtsCloneBufferRequest): Promise<TtsCloneResult> {
  const { endpoint, refAudio, refText, script, apiKey, voiceInstructions, chatterbox, abortSignal } = request;

  const scriptMarkup = (endpoint.extra_config.script_markup as string | undefined) ?? "plain";
  const supportsInstruct = Boolean(endpoint.extra_config.supports_instruct);
  const preserveUnicodeEmojis = scriptMarkup === "emoji" || isIrodoriTtsEndpoint(endpoint);

  // Prepare script: strip all bracket tags for "plain" endpoints and
  //    standard Chatterbox, because only Turbo handles bracket descriptors.
  //    Turbo gets a conservative whitelist so unsupported bracket text is not spoken aloud.
  //    For other bracket-tags/emoji endpoints, strip only for the caption text.
  let processedScript: string;
  let captionText: string;
  // Callers attach the persona's Chatterbox settings to every clone request, with Turbo defaulting
  // on, so applying them unconditionally would strip Fish S2 Pro's free-form expression tags down
  // to Turbo's whitelist.
  const chatterboxTagRules = isChatterboxEndpoint(endpoint) ? chatterbox : undefined;
  const shouldStripBracketTagsForTts = scriptMarkup === "plain" || chatterboxTagRules?.turboEnabled === false;
  if (shouldStripBracketTagsForTts) {
    processedScript = stripAllBracketTags(script);
    captionText = processedScript;
  } else if (chatterboxTagRules?.turboEnabled === true) {
    processedScript = stripUnsupportedChatterboxTurboTags(script);
    captionText = stripElevenLabsExpressionTags(processedScript);
  } else {
    processedScript = script;
    captionText = stripElevenLabsExpressionTags(script);
  }

  processedScript = stripTtsUnsupportedEmojiAttempts(processedScript, { preserveUnicodeEmojis });
  captionText = stripTtsUnsupportedEmojiAttempts(captionText, { preserveUnicodeEmojis });

  if (!processedScript) {
    return {
      success: false,
      errorKind: "invalid_request",
      details: "Voice script was empty after removing unsupported emoji markup.",
    };
  }

  const body: Record<string, unknown> = {
    text: processedScript,
    ref_audio: refAudio.toString("base64"),
    ref_text: refText,
    language: null,
  };

  if (chatterbox) {
    body.chatterbox_turbo = chatterbox.turboEnabled;
    body.cfg_weight = chatterbox.cfgWeight;
    body.exaggeration = chatterbox.exaggeration;
  }

  if (supportsInstruct) {
    body.instruct = voiceInstructions?.trim() || null;
  }

  const endpointUrl = endpoint.endpoint_url.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), TTS_SYNTHESIZE_TIMEOUT_MS);
    try {
      response = await fetchUserRemoteUrl(
        `${endpointUrl}/synthesize`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: abortSignal ? AbortSignal.any([abortController.signal, abortSignal]) : abortController.signal,
        },
        getEndpointRemotePolicy(),
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError" && !abortSignal?.aborted;
    log.warn(`[TtsClone] Request to ${endpointUrl}/synthesize ${isTimeout ? "timed out" : "failed"}`, error);
    return {
      success: false,
      errorKind: isTimeout ? "timeout" : "request_failed",
      details: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    let errorDetails = `HTTP ${response.status}`;
    try {
      const errorBody = (await response.json()) as { error?: unknown; detail?: unknown };
      const structuredDetail = stringifyErrorDetail(errorBody.error ?? errorBody.detail);
      if (structuredDetail) errorDetails += `: ${structuredDetail}`;
    } catch {}
    log.warn(`[TtsClone] ${endpointUrl}/synthesize returned error: ${errorDetails}`);
    return { success: false, errorKind: "request_failed", details: `HTTP ${response.status}` };
  }

  const rawContentType = response.headers.get("content-type") ?? "audio/wav";
  // Bare MIME type only: Discord rejects waveform metadata for non-bare types.
  const contentType = rawContentType.split(";")[0].trim();

  if (!contentType.startsWith("audio/")) {
    log.warn(`[TtsClone] Unexpected content-type from /synthesize: ${rawContentType}`);
    return {
      success: false,
      errorKind: "invalid_response",
      details: "The TTS server did not return audio.",
    };
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.length === 0) {
    return { success: false, errorKind: "invalid_response", details: "Empty audio response from TTS server." };
  }

  return {
    success: true,
    audioBuffer,
    contentType,
    extension: resolveExtensionFromContentType(contentType),
    cleanedCaptionText: captionText,
  };
}

export async function synthesizeSpeechViaTtsClone(request: TtsCloneRequest): Promise<TtsCloneResult> {
  const { endpoint, voiceSampleId, script, apiKey, voiceInstructions, chatterbox, abortSignal } = request;

  const voiceSample = await loadVoiceSampleById(voiceSampleId);

  if (!voiceSample) {
    log.warn(`[TtsClone] Voice sample ${voiceSampleId} not found in DB`);
    return {
      success: false,
      errorKind: "missing_sample",
      details: `Voice sample ${voiceSampleId} not found in database.`,
    };
  }

  const sample = voiceSample;

  const refAudioBuffer = await loadStoredVoiceSampleBuffer(sample.file_path);
  if (!refAudioBuffer) {
    log.warn(`[TtsClone] Failed to read voice sample ${voiceSampleId} from ${sample.file_path}`);
    return {
      success: false,
      errorKind: "sample_read_failed",
      details: `Could not read voice sample ${voiceSampleId} from storage.`,
    };
  }

  return synthesizeSpeechViaTtsCloneBuffer({
    endpoint,
    refAudio: refAudioBuffer,
    refText: sample.ref_text ?? null,
    script,
    apiKey,
    ...(voiceInstructions ? { voiceInstructions } : {}),
    ...(chatterbox ? { chatterbox } : {}),
    ...(abortSignal ? { abortSignal } : {}),
  });
}
