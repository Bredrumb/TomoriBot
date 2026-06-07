const DEFAULT_TTS_SYNTHESIZE_TIMEOUT_MS = 240_000;

function readPositiveIntegerEnv(name: string): number | null {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveTtsSynthesizeTimeoutMs(): number {
  return (
    readPositiveIntegerEnv("TTS_SYNTHESIZE_TIMEOUT_MS") ??
    readPositiveIntegerEnv("TTS_CLONE_TIMEOUT_MS") ??
    DEFAULT_TTS_SYNTHESIZE_TIMEOUT_MS
  );
}
