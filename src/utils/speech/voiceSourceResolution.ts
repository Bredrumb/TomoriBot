import { safeSelectOptionText } from "@/utils/discord/ui/interactionCore";
import { resolveVoiceSourceCapabilities, type VoiceSourceTarget } from "@/utils/speech/voiceSourceCapabilities";

export { resolveVoiceSourceCapabilities } from "@/utils/speech/voiceSourceCapabilities";

export type VoiceSourceId = "upload" | "typed-design" | "persona-sample" | "persona-design" | "elevenlabs";

type VoiceSourceShape = "clone" | "design" | "elevenlabs";

// Discord select and radio option limit per field, so labels and descriptions exceeding 100 chars are rejected.
export const VOICE_SOURCE_OPTION_TEXT_LIMIT = 100;

export interface VoiceSourceCandidate {
  id: VoiceSourceId;
  shape: VoiceSourceShape;
  sampleId?: number;
  designPrompt?: string;
  voiceId?: string;
  displayText?: string;
}

// Narrowed to only the persona fields read here so tests and callers can pass plain partial objects.
export interface VoiceSourcePersona {
  speech_voice_sample_id?: number | null;
  speech_voice_design_prompt?: string | null;
  speech_voice_id?: string | null;
  speech_voice_name?: string | null;
  voice_source_priority?: "design" | "clone";
}

export interface VoiceSourceResolutionInput {
  targets: { design: VoiceSourceTarget | null; clone: VoiceSourceTarget | null };
  legacyElevenLabsAvailable?: boolean;
  persona: VoiceSourcePersona;
  personaSampleName?: string | null;
  uploadFilename?: string | null;
  typedDesignPrompt?: string | null;
}

export function formatVoiceSourceOptionDescription(modePrefix: string, text: string): string {
  const fullPrefix = `${modePrefix} | `;
  return `${fullPrefix}${safeSelectOptionText(text, VOICE_SOURCE_OPTION_TEXT_LIMIT - fullPrefix.length)}`;
}

export function resolveVoiceSourceCandidates(input: VoiceSourceResolutionInput): VoiceSourceCandidate[] {
  const { targets, persona } = input;
  const { acceptsCloneShape } = resolveVoiceSourceCapabilities(targets.clone);
  const { acceptsDesignShape } = resolveVoiceSourceCapabilities(targets.design);
  const candidates: VoiceSourceCandidate[] = [];

  const uploadFilename = input.uploadFilename?.trim() ?? "";
  if (uploadFilename && acceptsCloneShape) {
    candidates.push({ id: "upload", shape: "clone", displayText: uploadFilename });
  }

  const typedDesignPrompt = input.typedDesignPrompt?.trim() ?? "";
  if (typedDesignPrompt && acceptsDesignShape) {
    candidates.push({ id: "typed-design", shape: "design", designPrompt: typedDesignPrompt });
  }

  const stored: VoiceSourceCandidate[] = [];
  const personaSampleId = persona.speech_voice_sample_id ?? null;
  if (personaSampleId && acceptsCloneShape) {
    stored.push({
      id: "persona-sample",
      shape: "clone",
      sampleId: personaSampleId,
      displayText: input.personaSampleName?.trim() || undefined,
    });
  }

  const personaDesignPrompt = persona.speech_voice_design_prompt?.trim() ?? "";
  if (personaDesignPrompt && acceptsDesignShape) {
    stored.push({ id: "persona-design", shape: "design", designPrompt: personaDesignPrompt });
  }

  const elevenLabsVoiceId = persona.speech_voice_id?.trim() ?? "";
  if (
    elevenLabsVoiceId &&
    ((targets.clone && "api_style" in targets.clone && targets.clone.api_style === "elevenlabs") ||
      (!targets.clone && input.legacyElevenLabsAvailable))
  ) {
    stored.push({
      id: "elevenlabs",
      shape: "elevenlabs",
      voiceId: elevenLabsVoiceId,
      displayText: persona.speech_voice_name?.trim() || undefined,
    });
  }
  const priority = persona.voice_source_priority ?? "design";
  stored.sort(
    (left, right) =>
      Number((left.shape === "design" ? "design" : "clone") !== priority) -
      Number((right.shape === "design" ? "design" : "clone") !== priority),
  );
  candidates.push(...stored);

  return candidates;
}

export function selectDefaultVoiceSource(candidates: readonly VoiceSourceCandidate[]): VoiceSourceCandidate | null {
  return candidates[0] ?? null;
}
