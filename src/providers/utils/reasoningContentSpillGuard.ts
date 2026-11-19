import { log } from "@/utils/misc/logger";

const MAX_PENDING_CONTENT_CHARS = 180;

export interface ReasoningContentSpillResult {
  content: string;
  spilledThought?: string;
  changed: boolean;
}

// Some OpenAI-compatible backends spill trailing reasoning into the first content delta glued to the answer, so this
// guard isolates that transition.
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

    // Odd backticks place the boundary inside an inline-code span, so keep dotted code identifiers intact.
    const backticksBeforeBoundary = (core.slice(0, firstBoundaryIndex).match(/`/g) ?? []).length;
    if (backticksBeforeBoundary % 2 === 1) {
      return { type: "emit", content: candidate };
    }

    // Consume trailing punctuation runs together so ellipsis boundaries like wait...Hello do not leak stray dots.
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

    // Treat punctuation with no following space as a reasoning seam when followed by an answer start or preceded by a
    // multi-word clause, leaving single-word dotted identifiers untouched.
    const isGluedBoundary = remainder.length === trimmedRemainder.length;
    const fragmentIsMultiWordClause = /\s/u.test(firstSentence.trim());
    if (isGluedBoundary && (looksLikeAnswerStart(trimmedRemainder) || fragmentIsMultiWordClause)) {
      return {
        type: "emit",
        content: trimmedRemainder,
        spilledThought: `${leadingWhitespace}${firstSentence}`.trim(),
      };
    }

    return { type: "emit", content: candidate };
  }
}

// Uppercase, titlecase, and caseless-script letters (CJK, Hangul, Kana) count as answer starts, while lowercase
// Latin, digits, and bare punctuation do not so glued boundaries stay intact.
function looksLikeAnswerStart(text: string): boolean {
  if (!text) return false;
  if (/^[*_([{"'“”‘’「『（]/u.test(text)) return true;
  if (/^\p{Lu}/u.test(text)) return true;
  if (/^[\p{Lo}\p{Lt}]/u.test(text)) return true;
  if (/^\p{Extended_Pictographic}/u.test(text)) return true;
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
