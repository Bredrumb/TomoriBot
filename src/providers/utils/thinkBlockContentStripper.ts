import { log } from "@/utils/misc/logger";
import {
  findReasoningTagClose,
  findReasoningTagOpen,
  findTrailingReasoningTagPrefix,
} from "@/providers/utils/reasoningTags";

type PendingBoundaryKind = "outside-close" | "outside-open" | "inside-close";

interface ThinkBlockContentStripperOptions {
  loggerName: string;
  captureThoughts?: boolean;
}

export interface ThinkBlockStripResult {
  visibleText: string;
  thoughtText: string;
  changed: boolean;
}

/**
 * Stateful stripper for reasoning tags that leak through OpenAI-compatible
 * content deltas. It handles markers split across stream chunks, including
 * orphaned DeepSeek-style `</think>` closers.
 */
export class ThinkBlockContentStripper {
  private insideThinkBlock = false;
  private pendingBoundaryText = "";
  private pendingBoundaryKind: PendingBoundaryKind | null = null;
  private hasCapturedThoughtInCurrentBlock = false;
  private personaSpeakerLabelRegex: RegExp | null = null;

  public constructor(private readonly options: ThinkBlockContentStripperOptions) {}

  public reset(personaSpeakerLabelRegex?: RegExp | null): void {
    this.insideThinkBlock = false;
    this.pendingBoundaryText = "";
    this.pendingBoundaryKind = null;
    this.hasCapturedThoughtInCurrentBlock = false;
    this.personaSpeakerLabelRegex = personaSpeakerLabelRegex ?? null;
  }

  public strip(text: string): ThinkBlockStripResult {
    if (!text && !this.pendingBoundaryText) {
      return {
        visibleText: "",
        thoughtText: "",
        changed: false,
      };
    }

    const hadPendingBoundary = this.pendingBoundaryText.length > 0;
    const originalText = text;
    const input = hadPendingBoundary ? `${this.pendingBoundaryText}${text}` : text;
    this.pendingBoundaryText = "";
    this.pendingBoundaryKind = null;

    let visibleText = "";
    let thoughtText = "";
    let cursor = 0;

    const captureThought = (value: string): void => {
      if (!value) return;
      if (this.options.captureThoughts !== false) {
        thoughtText += value;
      }
      this.hasCapturedThoughtInCurrentBlock = true;
    };

    while (cursor < input.length) {
      if (!this.insideThinkBlock) {
        const openMatch = findReasoningTagOpen(input, cursor);
        const closeMatch = findReasoningTagClose(input, cursor);
        const startIdx = openMatch?.index ?? -1;
        const endIdx = closeMatch?.index ?? -1;

        if (startIdx === -1 && endIdx === -1) {
          const remaining = input.slice(cursor);
          const partial = findTrailingReasoningTagPrefix(remaining);
          if (partial?.kind === "close") {
            // Possible closing tag split across chunks: hold the whole remainder
            // so any preceding text routes to thoughts once the close arrives.
            this.pendingBoundaryText = remaining;
            this.pendingBoundaryKind = "outside-close";
            break;
          }

          if (partial?.kind === "open") {
            visibleText += remaining.slice(0, partial.index);
            this.pendingBoundaryText = remaining.slice(partial.index);
            this.pendingBoundaryKind = "outside-open";
            break;
          }

          visibleText += remaining;
          break;
        }

        if (closeMatch && endIdx !== -1 && (startIdx === -1 || endIdx < startIdx)) {
          captureThought(input.slice(cursor, endIdx));
          cursor = closeMatch.index + closeMatch.length;
          continue;
        }

        if (openMatch && startIdx !== -1) {
          visibleText += input.slice(cursor, startIdx);
          this.insideThinkBlock = true;
          this.hasCapturedThoughtInCurrentBlock = false;
          cursor = openMatch.index + openMatch.length;
        }
      } else {
        const remaining = input.slice(cursor);
        const closeMatch = findReasoningTagClose(input, cursor);
        const endIdx = closeMatch?.index ?? -1;
        const personaMatch = this.personaSpeakerLabelRegex?.exec(remaining) ?? null;
        const personaCloseAbsIdx = personaMatch !== null ? cursor + personaMatch.index : -1;
        const thoughtBeforePersona =
          personaCloseAbsIdx !== -1 ? input.slice(cursor, personaCloseAbsIdx).length > 0 : false;
        const personaCloserActive =
          personaCloseAbsIdx !== -1 && (this.hasCapturedThoughtInCurrentBlock || thoughtBeforePersona);

        const useExplicitCloser =
          endIdx !== -1 && (!personaCloserActive || personaCloseAbsIdx === -1 || endIdx <= personaCloseAbsIdx);
        const usePersonaCloser =
          personaCloserActive && personaCloseAbsIdx !== -1 && (endIdx === -1 || personaCloseAbsIdx < endIdx);

        if (useExplicitCloser && closeMatch) {
          captureThought(input.slice(cursor, endIdx));
          this.insideThinkBlock = false;
          this.hasCapturedThoughtInCurrentBlock = false;
          cursor = closeMatch.index + closeMatch.length;
          continue;
        }

        if (usePersonaCloser) {
          log.warn(`${this.options.loggerName}: <think> block closed implicitly by persona speaker label`);
          captureThought(input.slice(cursor, personaCloseAbsIdx));
          this.insideThinkBlock = false;
          this.hasCapturedThoughtInCurrentBlock = false;
          cursor = personaCloseAbsIdx;
          continue;
        }

        const partial = findTrailingReasoningTagPrefix(remaining);
        if (partial?.kind === "close") {
          captureThought(remaining.slice(0, partial.index));
          this.pendingBoundaryText = remaining.slice(partial.index);
          this.pendingBoundaryKind = "inside-close";
          break;
        }

        captureThought(remaining);
        break;
      }
    }

    return {
      visibleText,
      thoughtText,
      changed: hadPendingBoundary || visibleText !== originalText || thoughtText.length > 0,
    };
  }

  public flush(): ThinkBlockStripResult {
    if (!this.pendingBoundaryText && !this.insideThinkBlock) {
      return {
        visibleText: "",
        thoughtText: "",
        changed: false,
      };
    }

    const pendingBoundaryText = this.pendingBoundaryText;
    const pendingBoundaryKind = this.pendingBoundaryKind;
    this.pendingBoundaryText = "";
    this.pendingBoundaryKind = null;

    if (this.insideThinkBlock || pendingBoundaryKind === "inside-close") {
      this.insideThinkBlock = false;
      this.hasCapturedThoughtInCurrentBlock = false;
      return {
        visibleText: "",
        thoughtText: this.options.captureThoughts === false ? "" : pendingBoundaryText,
        changed: true,
      };
    }

    if (pendingBoundaryKind === "outside-close") {
      const partial = findTrailingReasoningTagPrefix(pendingBoundaryText);
      const thoughtText = partial ? pendingBoundaryText.slice(0, partial.index) : pendingBoundaryText;
      return {
        visibleText: "",
        thoughtText: this.options.captureThoughts === false ? "" : thoughtText,
        changed: true,
      };
    }

    if (pendingBoundaryKind === "outside-open") {
      const partial = findTrailingReasoningTagPrefix(pendingBoundaryText);
      return {
        visibleText: partial ? pendingBoundaryText.slice(0, partial.index) : pendingBoundaryText,
        thoughtText: "",
        changed: true,
      };
    }

    return {
      visibleText: pendingBoundaryText,
      thoughtText: "",
      changed: true,
    };
  }
}
