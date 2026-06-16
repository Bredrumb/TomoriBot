import { log } from "@/utils/misc/logger";

const MAX_PENDING_CONTENT_CHARS = 180;

export interface ReasoningContentSpillResult {
  content: string;
  spilledThought?: string;
  changed: boolean;
}

/**
 * Guards the transition from provider-side reasoning fields to visible content.
 * Some OpenAI-compatible backends move the last fragment of reasoning into the
 * first content delta. The common shape is a short lowercase/meta sentence
 * immediately glued to the real answer, e.g. `the reveal.Wrrrf...`.
 */
export class ReasoningContentSpillGuard {
  private sawReasoningBeforeVisible = false;
  private visibleContentStarted = false;
  private pendingContent = "";

  public constructor(private readonly loggerName: string) {}

  public reset(): void {
    this.sawReasoningBeforeVisible = false;
    this.visibleContentStarted = false;
    this.pendingContent = "";
  }

  public observeReasoning(reasoning?: string | null): void {
    if (this.visibleContentStarted || typeof reasoning !== "string" || reasoning.length === 0) {
      return;
    }

    this.sawReasoningBeforeVisible = true;
  }

  public filterContent(content: string): ReasoningContentSpillResult {
    if (!content) {
      return {
        content,
        changed: false,
      };
    }

    if (this.visibleContentStarted || !this.sawReasoningBeforeVisible) {
      this.visibleContentStarted = true;
      return {
        content,
        changed: false,
      };
    }

    const candidate = `${this.pendingContent}${content}`;
    this.pendingContent = "";
    const decision = this.evaluateFirstVisibleContent(candidate);

    if (decision.type === "hold") {
      this.pendingContent = candidate;
      return {
        content: "",
        changed: true,
      };
    }

    this.visibleContentStarted = decision.content.length > 0;
    if (decision.spilledThought) {
      log.warn(`${this.loggerName}: stripped likely reasoning spill before first visible content`);
    }

    return {
      content: decision.content,
      spilledThought: decision.spilledThought,
      changed: decision.content !== content || Boolean(decision.spilledThought),
    };
  }

  public flush(): ReasoningContentSpillResult {
    if (!this.pendingContent) {
      return {
        content: "",
        changed: false,
      };
    }

    const content = this.pendingContent;
    this.pendingContent = "";
    this.visibleContentStarted = content.length > 0;
    return {
      content,
      changed: true,
    };
  }

  private evaluateFirstVisibleContent(
    candidate: string,
  ): { type: "hold" } | { type: "emit"; content: string; spilledThought?: string } {
    const leadingWhitespace = candidate.match(/^\s*/)?.[0] ?? "";
    const core = candidate.slice(leadingWhitespace.length);
    if (!core) {
      return { type: "hold" };
    }

    if (!isLowercaseStart(core)) {
      return { type: "emit", content: candidate };
    }

    const firstBoundaryIndex = findFirstSentenceBoundaryIndex(core);
    if (firstBoundaryIndex === -1) {
      return core.length < MAX_PENDING_CONTENT_CHARS ? { type: "hold" } : { type: "emit", content: candidate };
    }

    // An odd number of backticks before the boundary means it sits inside an inline-code
    // span (or a still-open one mid-stream), so a dotted code identifier — `obj.Method`,
    // `variable.Name` — is intentional, not a spill. Leave it alone. (Code at the very
    // start of content is already preserved by the lowercase-start gate above, since a
    // leading backtick is not lowercase.)
    const backticksBeforeBoundary = (core.slice(0, firstBoundaryIndex).match(/`/g) ?? []).length;
    if (backticksBeforeBoundary % 2 === 1) {
      return { type: "emit", content: candidate };
    }

    // Consume a run of trailing sentence punctuation (ellipsis, "?!", "。！") so the
    // remainder begins at the next real character rather than mid-"..." — otherwise
    // `wait...Hello` would strip `wait.` and leak the stray `..` into the answer.
    let sentenceEnd = firstBoundaryIndex + 1;
    while (sentenceEnd < core.length && /[.!?。！？]/u.test(core[sentenceEnd] ?? "")) {
      sentenceEnd++;
    }
    if (sentenceEnd >= core.length) {
      return core.length < MAX_PENDING_CONTENT_CHARS ? { type: "hold" } : { type: "emit", content: candidate };
    }

    const firstSentence = core.slice(0, sentenceEnd);
    const remainder = core.slice(sentenceEnd);
    const trimmedRemainder = remainder.trimStart();
    if (!trimmedRemainder) {
      return { type: "hold" };
    }

    // A *glued* boundary — sentence punctuation with NO following whitespace — is the
    // fingerprint of a backend concatenating its reasoning-tail buffer onto the
    // content-head with no separator (e.g. `must do.Hello!`). Genuine prose always puts
    // a space after a sentence period, so a *spaced* boundary is the model's own text
    // and is emitted untouched. Combined with this guard's outer gates (first visible
    // content, reasoning seen first, lowercase start), the glue alone is a strong enough
    // spill signal — no meta/continuation vocabulary list required (those were brittle,
    // English-only, and only ever propped up the ambiguous spaced case).
    // A *glued* boundary — sentence punctuation with NO following whitespace — is the spill
    // fingerprint, regardless of how many words precede it: `wait. Actually` (spaced) is the
    // model writing two sentences, but `wait.Actually` (glued) is a reasoning seam. Genuine
    // prose always puts a space after a sentence period, so a spaced boundary is emitted
    // untouched. Bare (non-backticked) dotted identifiers like `pd.DataFrame` written in
    // prose are accepted collateral of this aggressiveness — code is expected in backticks,
    // which the inline-code guard above protects.
    const isGluedBoundary = remainder.length === trimmedRemainder.length;
    if (isGluedBoundary && looksLikeAnswerStart(trimmedRemainder)) {
      return {
        type: "emit",
        content: trimmedRemainder,
        spilledThought: `${leadingWhitespace}${firstSentence}`.trim(),
      };
    }

    return { type: "emit", content: candidate };
  }
}

/**
 * True when `text` begins like the start of a real answer rather than the continuation
 * of a lowercase prose fragment. Treats markdown/quote/bracket openers, uppercase or
 * caseless letters (so CJK and other non-Latin scripts qualify), and emoji as
 * answer-like. Lowercase Latin letters, digits, and bare punctuation are NOT answer
 * starts, so a glued boundary before them is left intact.
 */
function looksLikeAnswerStart(text: string): boolean {
  if (!text) return false;
  // Openers: * _ ( [ { straight/curly double+single quotes, CJK quote/paren marks.
  if (/^[*_([{"'“”‘’「『（]/u.test(text)) return true;
  if (/^\p{Lu}/u.test(text)) return true; // uppercase letter (Latin, Cyrillic, etc.)
  if (/^[\p{Lo}\p{Lt}]/u.test(text)) return true; // caseless/titlecase letters (CJK, Hangul, Kana…)
  if (/^\p{Extended_Pictographic}/u.test(text)) return true; // emoji / pictographs
  return false;
}

function isLowercaseStart(text: string): boolean {
  const first = text.trimStart()[0];
  return Boolean(first && first === first.toLowerCase() && first !== first.toUpperCase());
}

function findFirstSentenceBoundaryIndex(text: string): number {
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (!char || !/[.!?。！？]/u.test(char)) {
      continue;
    }

    if (char === "." && /\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? "")) {
      continue;
    }

    return index;
  }

  return -1;
}
