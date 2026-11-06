import type { Attachment, Message } from "discord.js";
import { ZodError } from "zod";
import { safeDownload } from "@/utils/security/safeDownload";
import { ResponseSizeError } from "@/utils/security/boundedResponse";
import {
  getElevenLabsSttConfig,
  normalizeTranscriptText,
  reportElevenLabsFailure,
} from "@/utils/audio/elevenLabsShared";
import { convertAudioToTranscriptionMp3 } from "@/utils/audio/ffmpegConvert";
import { transcribeViaElevenLabsAdapter } from "@/providers/custom/styles/transcriptionElevenLabsAdapter";
import { transcribeViaOpenAIAdapter } from "@/providers/custom/styles/transcriptionOpenAIAdapter";
import { createGoogleSpeechTransport } from "@/providers/google/googleSpeech";
import { transcribeOpenRouterAudio } from "@/providers/openrouter/openrouterTranscription";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { resolveTranscriptionTargets, type TranscriptionTarget } from "@/utils/provider/speechEndpointResolver";
import {
  HostedSpeechError,
  isExpectedHostedSpeechFailure,
  type HostedSpeechErrorKind,
  type SpeechOperation,
} from "@/utils/speech/hostedSpeech";

const AUDIO_EXTENSION_REGEX = /\.(aac|flac|m4a|mp3|mpga|oga|ogg|opus|wav)$/i;

/** OpenRouter's upstream transcription providers stop at 60 seconds, so waiting longer cannot help. */
const HOSTED_TRANSCRIPTION_TIMEOUT_MS = 60_000;
/** OpenRouter rejects inline audio past its 25 MB upload cap on most providers. */
const HOSTED_TRANSCRIPTION_MAX_AUDIO_BYTES = 24 * 1024 * 1024;

type AudioAttachmentFailureReason =
  | "no_endpoint"
  | "missing_api_key"
  | "download_failed"
  | "stt_failed"
  | "empty_transcript";

export interface AudioAttachmentTranscriptionResult {
  hasAudio: boolean;
  transcriptText: string | null;
  attachmentName: string | null;
  mimeType: string | null;
  failureReason?: AudioAttachmentFailureReason;
  failureDetails?: string;
}

/** Returns true if the attachment is an audio file by MIME type or extension. */
export function isAudioAttachment(attachment: Pick<Attachment, "contentType" | "name">): boolean {
  const mimeType = attachment.contentType?.toLowerCase() ?? "";
  if (mimeType.startsWith("audio/")) {
    return true;
  }
  if (mimeType.startsWith("video/") || mimeType.startsWith("image/")) {
    return false;
  }

  return AUDIO_EXTENSION_REGEX.test(attachment.name ?? "");
}

function getFirstAudioAttachment(message: Message): Attachment | null {
  for (const attachment of message.attachments.values()) {
    if (isAudioAttachment(attachment)) {
      return attachment;
    }
  }

  return null;
}

type AttemptResult =
  | { status: "success"; transcriptText: string }
  | { status: "empty" }
  | { status: "failed"; reason: "missing_api_key" | "stt_failed"; details?: string };

async function transcribeWithEndpoint(
  target: Extract<TranscriptionTarget, { kind: "custom-endpoint" }>,
  attachment: Attachment,
  audio: Buffer,
  serverId: number,
): Promise<AttemptResult> {
  const apiStyle = target.endpoint.api_style;
  if ((apiStyle === "elevenlabs-transcription" || target.endpoint.requires_auth) && !target.apiKey) {
    return { status: "failed", reason: "missing_api_key" };
  }
  const request = {
    apiKey: target.apiKey,
    audioBuffer: audio,
    filename: attachment.name ?? "audio",
    mimeType: attachment.contentType ?? undefined,
  };
  const result =
    apiStyle === "openai-compatible-transcription"
      ? await transcribeViaOpenAIAdapter({ ...request, endpoint: target.endpoint })
      : await transcribeViaElevenLabsAdapter(request);
  if (!result.success) {
    // An unreachable user-run OpenAI-compatible endpoint is an expected refusal, so only hosted ElevenLabs is reported.
    if (apiStyle !== "openai-compatible-transcription") {
      await reportElevenLabsFailure("transcription", result, { serverId });
    }
    return { status: "failed", reason: "stt_failed", details: result.details };
  }
  return result.transcriptText ? { status: "success", transcriptText: result.transcriptText } : { status: "empty" };
}

async function transcribeWithHostedModel(
  target: Extract<TranscriptionTarget, { kind: "hosted-model" }>,
  mp3: () => Promise<Buffer>,
  context: { serverId: number; userId?: number },
): Promise<AttemptResult> {
  const signal = AbortSignal.timeout(HOSTED_TRANSCRIPTION_TIMEOUT_MS);
  const operations: SpeechOperation[] = [];
  const startedAt = Date.now();
  try {
    const audio = await mp3();
    const text =
      target.model.provider === "openrouter"
        ? await transcribeOpenRouterAudio({
            model: target.model.codename,
            apiKey: target.apiKey,
            audio,
            signal,
            operations,
          })
        : await createGoogleSpeechTransport(target.model.provider, target.apiKey).transcribe(
            audio,
            target.model.codename,
            signal,
            operations,
          );
    const transcriptText = normalizeTranscriptText(text, getElevenLabsSttConfig().maxTranscriptChars);
    return transcriptText ? { status: "success", transcriptText } : { status: "empty" };
  } catch (error) {
    const errorKind: HostedSpeechErrorKind = signal.aborted
      ? "timeout"
      : error instanceof HostedSpeechError
        ? error.kind
        : error instanceof ZodError || error instanceof ResponseSizeError
          ? "malformed_response"
          : operations.length === 0
            ? "invalid_request"
            : "provider_error";
    const providerStatus = error instanceof HostedSpeechError ? error.providerStatus : undefined;
    await reportProviderFailure({
      summary: "Hosted transcription failed",
      errorType: "TranscriptionOperationFailed",
      error,
      expected: isExpectedHostedSpeechFailure(errorKind, providerStatus),
      detail: error instanceof HostedSpeechError ? error.providerDetail : undefined,
      serverId: context.serverId,
      userId: context.userId,
      dimensions: {
        operation: "transcription",
        provider: target.model.provider,
        model: target.model.codename,
        owner: target.owner.kind,
        errorKind,
        origin: providerStatus === undefined ? "local" : "provider",
        ...(providerStatus !== undefined ? { providerStatus } : {}),
      },
      metadata: {
        operations: operations.map(({ operation, status, success }) => ({ operation, status, success })),
        elapsedMs: Date.now() - startedAt,
      },
    });
    return { status: "failed", reason: "stt_failed", details: `Hosted transcription failed: ${errorKind}.` };
  }
}

/**
 * Transcribes a message's first audio attachment through the sender's and then the server's target.
 *
 * Only a failed attempt moves on to the next target; audio that transcribes to nothing is final.
 */
export async function transcribeMessageAudioAttachment(
  message: Message,
  serverId: number,
  userId?: number,
): Promise<AudioAttachmentTranscriptionResult> {
  const attachment = getFirstAudioAttachment(message);
  if (!attachment) {
    return {
      hasAudio: false,
      transcriptText: null,
      attachmentName: null,
      mimeType: null,
    };
  }
  const base = {
    hasAudio: true,
    attachmentName: attachment.name ?? null,
    mimeType: attachment.contentType ?? null,
  };

  const targets = await resolveTranscriptionTargets(serverId, userId);
  if (targets.length === 0) {
    return { ...base, transcriptText: null, failureReason: "no_endpoint" };
  }

  const config = getElevenLabsSttConfig();
  const downloadResult = await safeDownload(attachment.url, {
    maxSizeMB: config.maxSizeMb,
    timeoutMs: config.timeoutMs,
    knownSize: attachment.size,
  });
  if (!downloadResult.success || !downloadResult.buffer) {
    return {
      ...base,
      transcriptText: null,
      failureReason: "download_failed",
      failureDetails: downloadResult.details,
    };
  }
  const audio = downloadResult.buffer;
  let converted: Promise<Buffer> | undefined;
  const mp3 = () => {
    converted ??= convertAudioToTranscriptionMp3(audio, { maxBytes: HOSTED_TRANSCRIPTION_MAX_AUDIO_BYTES });
    return converted;
  };

  let failure: Extract<AttemptResult, { status: "failed" }> = { status: "failed", reason: "stt_failed" };
  for (const target of targets) {
    const attempt =
      target.kind === "custom-endpoint"
        ? await transcribeWithEndpoint(target, attachment, audio, serverId)
        : await transcribeWithHostedModel(target, mp3, { serverId, userId });
    if (attempt.status === "success") return { ...base, transcriptText: attempt.transcriptText };
    if (attempt.status === "empty") return { ...base, transcriptText: null, failureReason: "empty_transcript" };
    failure = attempt;
  }
  return { ...base, transcriptText: null, failureReason: failure.reason, failureDetails: failure.details };
}
