import { synthesizeSpeechWithElevenLabs } from "@/utils/audio/elevenLabsTts";
import type { ElevenLabsTtsResult } from "@/utils/audio/elevenLabsTts";

export interface ElevenLabsAdapterRequest {
  apiKey: string;
  voiceId: string;
  script: string;
  // voiceSettings must be omitted rather than set to an empty object so the request body stays identical to
  // ElevenLabs defaults.
  voiceSettings?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export async function synthesizeSpeechViaElevenLabsAdapter(
  request: ElevenLabsAdapterRequest,
): Promise<ElevenLabsTtsResult> {
  return synthesizeSpeechWithElevenLabs({
    apiKey: request.apiKey,
    voiceId: request.voiceId,
    script: request.script,
    ...(request.voiceSettings ? { voiceSettings: request.voiceSettings } : {}),
    ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
  });
}
