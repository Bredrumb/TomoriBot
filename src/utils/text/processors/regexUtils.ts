export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildBotSpeakerLabelPattern(botName: string): RegExp {
  return new RegExp(
    `^\\s*(?:${escapeRegExp(botName)}|\\{\\{?char\\}\\}?|\\{\\{?bot\\}\\}?)((?:\\s*\\([^)]+\\))?)\\s*[:：]\\s*`,
    "iu",
  );
}

// Requires the "u" regex flag; includes \p{M} because Apple Discord clients send NFD combining marks that would
// otherwise fake mid-word boundaries.
export function wrapWithWordBoundary(pattern: string): string {
  return `(?<![\\p{L}\\p{N}\\p{M}_])${pattern}(?![\\p{L}\\p{N}\\p{M}_])`;
}

const UNSPACED_SCRIPT_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

// Callers bypass wrapWithWordBoundary when true because Han and kana lack spaces and Hangul attaches particles to
// nouns, causing boundary checks to fail.
export function isUnspacedScriptText(text: string): boolean {
  return UNSPACED_SCRIPT_PATTERN.test(text);
}
