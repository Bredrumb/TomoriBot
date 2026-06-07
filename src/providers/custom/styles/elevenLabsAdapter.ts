import { synthesizeSpeechWithElevenLabs } from "@/utils/audio/elevenLabsTts";
import type { ElevenLabsTtsResult } from "@/utils/audio/elevenLabsTts";

export interface ElevenLabsAdapterRequest {
  apiKey: string;
  voiceId: string;
  script: string;
}

/**
 * Thin adapter that wraps `synthesizeSpeechWithElevenLabs` for use via the
 * custom endpoint pathway. Reads `speech_voice_id`.
 */
export async function synthesizeSpeechViaElevenLabsAdapter(
  request: ElevenLabsAdapterRequest,
): Promise<ElevenLabsTtsResult> {
  return synthesizeSpeechWithElevenLabs({
    apiKey: request.apiKey,
    voiceId: request.voiceId,
    script: request.script,
  });
}
