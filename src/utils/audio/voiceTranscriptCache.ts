const VOICE_TRANSCRIPT_CACHE_TTL_MS = 120 * 60 * 1_000;

export interface VoiceTranscriptEntry {
  transcript: string;
  source: "user_stt" | "tts";
}

interface StoredEntry extends VoiceTranscriptEntry {
  cachedAt: number;
}

const cache = new Map<string, StoredEntry>();

export function getCachedVoiceTranscript(messageId: string): VoiceTranscriptEntry | null {
  const entry = cache.get(messageId);
  if (!entry) return null;

  if (Date.now() - entry.cachedAt > VOICE_TRANSCRIPT_CACHE_TTL_MS) {
    cache.delete(messageId);
    return null;
  }

  return { transcript: entry.transcript, source: entry.source };
}

export function setCachedVoiceTranscript(messageId: string, transcript: string, source: "user_stt" | "tts"): void {
  cache.set(messageId, { transcript, source, cachedAt: Date.now() });
}

export function clearVoiceTranscriptCache(): void {
  cache.clear();
}

export function getVoiceTranscriptCacheSize(): number {
  return cache.size;
}
