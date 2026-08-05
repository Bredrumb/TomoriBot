export const THINK_CLOSE_TAG = "</think>";

/**
 * Optional vendor namespace prefix, e.g. the `mm:` in `<mm:think>`. One segment
 * starting with a letter, then word chars / dots / hyphens, ending in a colon.
 */
const NAMESPACE = "(?:[A-Za-z][\\w.-]*:)?";

/** The literal word inside the tag; used for partial (split-chunk) detection. */
const THINK_WORD = "think";

/**
 * Global, case-insensitive matcher for *complete* open or close think tags.
 * Suitable for final-pass cleanup that removes any stray tag from visible text.
 */
export const REASONING_TAG_GLOBAL_RE = new RegExp(`</?${NAMESPACE}${THINK_WORD}>`, "gi");

/** A located tag occurrence within a larger string. */
export interface ReasoningTagMatch {
  /** Absolute start index of the `<` in the searched string. */
  index: number;
  /** Length of the matched tag (varies with namespace). */
  length: number;
}

/** The two kinds of trailing partial a chunk boundary can split. */
type ReasoningTagPartialKind = "open" | "close";

/** A trailing partial think tag awaiting more streamed input to complete. */
export interface TrailingReasoningTagPrefix {
  /** Absolute start index of the `<` that begins the partial. */
  index: number;
  /** Whether the partial looks like an opening or closing tag. */
  kind: ReasoningTagPartialKind;
}

/**
 * Upper bound on how long a trailing `<…` run we will treat as a potential
 * partial tag. Prevents unbounded buffering when content contains a stray `<`
 * followed by a long token that never resolves into a tag.
 */
const MAX_TRAILING_PARTIAL_LEN = 64;

function execFrom(pattern: string, text: string, from: number): ReasoningTagMatch | null {
  // Fresh regex per call keeps `lastIndex` state local (reentrancy-safe).
  const re = new RegExp(pattern, "gi");
  re.lastIndex = Math.max(0, from);
  const match = re.exec(text);
  return match ? { index: match.index, length: match[0].length } : null;
}

/** Find the first opening think tag at or after `from`. */
export function findReasoningTagOpen(text: string, from = 0): ReasoningTagMatch | null {
  return execFrom(`<${NAMESPACE}${THINK_WORD}>`, text, from);
}

/** Find the first closing think tag at or after `from`. */
export function findReasoningTagClose(text: string, from = 0): ReasoningTagMatch | null {
  return execFrom(`</${NAMESPACE}${THINK_WORD}>`, text, from);
}

/** True when `s` could still grow into the literal `think` word. */
function isThinkWordPrefix(s: string): boolean {
  return THINK_WORD.startsWith(s.toLowerCase());
}

/**
 * Detect a think tag that a stream chunk split mid-marker, e.g. a chunk ending
 * in `<mm:thi` whose remainder (`nk>`) arrives next. Returns where the partial
 * begins and whether it looks like an open or close tag, or `null` when the
 * trailing text cannot be the start of any think tag.
 *
 * Disambiguation mirrors the original literal logic:
 *   - `</…`            → close
 *   - a bare `<`       → close (preserves prior close-first matching)
 *   - `<word…`         → open
 *
 * A run is only treated as a partial when it can still extend into a valid tag:
 * with a namespace colon present, the segment after the last colon must be a
 * prefix of `think`; without a colon, the run must be a prefix of `think` or a
 * still-forming namespace.
 */
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

/** Convenience predicate: does the buffer end with a partial think tag? */
export function endsWithReasoningTagPrefix(text: string): boolean {
  return findTrailingReasoningTagPrefix(text) !== null;
}
