// Matches an optional vendor namespace prefix such as the mm: in <mm:think> because some providers emit namespaced
// think tags.
const NAMESPACE = "(?:[A-Za-z][\\w.-]*:)?";

const THINK_WORD = "think";

export const REASONING_TAG_GLOBAL_RE = new RegExp(`</?${NAMESPACE}${THINK_WORD}>`, "gi");

export interface ReasoningTagMatch {
  index: number;
  length: number;
}

type ReasoningTagPartialKind = "open" | "close";

export interface TrailingReasoningTagPrefix {
  index: number;
  kind: ReasoningTagPartialKind;
}

// Caps trailing partial tag matching at 64 chars so a stray < before a long non-tag token cannot cause unbounded
// stream buffering.
const MAX_TRAILING_PARTIAL_LEN = 64;

function execFrom(pattern: string, text: string, from: number): ReasoningTagMatch | null {
  // Fresh regex per call keeps `lastIndex` state local (reentrancy-safe).
  const re = new RegExp(pattern, "gi");
  re.lastIndex = Math.max(0, from);
  const match = re.exec(text);
  return match ? { index: match.index, length: match[0].length } : null;
}

export function findReasoningTagOpen(text: string, from = 0): ReasoningTagMatch | null {
  return execFrom(`<${NAMESPACE}${THINK_WORD}>`, text, from);
}

export function findReasoningTagClose(text: string, from = 0): ReasoningTagMatch | null {
  return execFrom(`</${NAMESPACE}${THINK_WORD}>`, text, from);
}

function isThinkWordPrefix(s: string): boolean {
  return THINK_WORD.startsWith(s.toLowerCase());
}

// A bare trailing < resolves to close rather than open because callers expect prior close-first matching when a tag
// splits at <.
export function findTrailingReasoningTagPrefix(text: string): TrailingReasoningTagPrefix | null {
  // Isolate a trailing `<` (optional `/`) followed only by tag-interior chars.
  const match = /<\/?[A-Za-z0-9_.:-]*$/.exec(text);
  if (!match) {
    return null;
  }

  const candidate = text.slice(match.index);
  if (candidate.length > MAX_TRAILING_PARTIAL_LEN) {
    return null;
  }

  const hasSlash = candidate[1] === "/";
  const run = candidate.slice(hasSlash ? 2 : 1);

  const colonIdx = run.lastIndexOf(":");
  const plausible =
    colonIdx === -1
      ? run.length === 0 || isThinkWordPrefix(run) || /^[A-Za-z][\w.-]*$/.test(run)
      : isThinkWordPrefix(run.slice(colonIdx + 1));
  if (!plausible) {
    return null;
  }

  const kind: ReasoningTagPartialKind = hasSlash || run.length === 0 ? "close" : "open";
  return { index: match.index, kind };
}

export function endsWithReasoningTagPrefix(text: string): boolean {
  return findTrailingReasoningTagPrefix(text) !== null;
}
