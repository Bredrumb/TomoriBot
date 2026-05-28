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

    const sentenceEnd = firstBoundaryIndex + 1;
    if (sentenceEnd >= core.length) {
      return core.length < MAX_PENDING_CONTENT_CHARS ? { type: "hold" } : { type: "emit", content: candidate };
    }

    const firstSentence = core.slice(0, sentenceEnd);
    const remainder = core.slice(sentenceEnd);
    const trimmedRemainder = remainder.trimStart();
    if (!trimmedRemainder) {
      return { type: "hold" };
    }

    const isGluedBoundary = remainder.length === trimmedRemainder.length;
    const looksLikeAnswerStart = /^[A-Z*_(["'“「]/u.test(trimmedRemainder);
    const firstSentenceLooksMeta = /\b(answer|reply|response|reveal|persona|character|style|playful|straight)\b/i.test(
      firstSentence,
    );
    const firstSentenceLooksContinuation =
      /^(?:actually|also|and|anyway|basically|but|confirming|ending|finally|giving|leaving|making|meaning|originally|resulting|revealing|since|so|then|therefore|thus|totaling|which|with)\b/i.test(
        firstSentence.trim(),
      );

    if (looksLikeAnswerStart && (firstSentenceLooksMeta || (isGluedBoundary && firstSentenceLooksContinuation))) {
      return {
        type: "emit",
        content: trimmedRemainder,
        spilledThought: `${leadingWhitespace}${firstSentence}`.trim(),
      };
    }

    return { type: "emit", content: candidate };
  }
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
