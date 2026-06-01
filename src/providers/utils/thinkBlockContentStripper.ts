import { log } from "@/utils/misc/logger";

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

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
        const startIdx = input.indexOf(THINK_OPEN, cursor);
        const endIdx = input.indexOf(THINK_CLOSE, cursor);

        if (startIdx === -1 && endIdx === -1) {
          const remaining = input.slice(cursor);
          const partialClose = findTrailingMarkerPrefix(remaining, [THINK_CLOSE]);
          if (partialClose) {
            this.pendingBoundaryText = remaining;
            this.pendingBoundaryKind = "outside-close";
            break;
          }

          const partialOpen = findTrailingMarkerPrefix(remaining, [THINK_OPEN]);
          if (partialOpen) {
            visibleText += remaining.slice(0, partialOpen.index);
            this.pendingBoundaryText = remaining.slice(partialOpen.index);
            this.pendingBoundaryKind = "outside-open";
            break;
          }

          visibleText += remaining;
          break;
        }

        if (endIdx !== -1 && (startIdx === -1 || endIdx < startIdx)) {
          captureThought(input.slice(cursor, endIdx));
          cursor = endIdx + THINK_CLOSE.length;
          continue;
        }

        if (startIdx !== -1) {
          visibleText += input.slice(cursor, startIdx);
          this.insideThinkBlock = true;
          this.hasCapturedThoughtInCurrentBlock = false;
          cursor = startIdx + THINK_OPEN.length;
        }
      } else {
        const remaining = input.slice(cursor);
        const endIdx = input.indexOf(THINK_CLOSE, cursor);
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

        if (useExplicitCloser) {
          captureThought(input.slice(cursor, endIdx));
          this.insideThinkBlock = false;
          this.hasCapturedThoughtInCurrentBlock = false;
          cursor = endIdx + THINK_CLOSE.length;
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

        const partialClose = findTrailingMarkerPrefix(remaining, [THINK_CLOSE]);
        if (partialClose) {
          captureThought(remaining.slice(0, partialClose.index));
          this.pendingBoundaryText = remaining.slice(partialClose.index);
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
      const partialClose = findTrailingMarkerPrefix(pendingBoundaryText, [THINK_CLOSE]);
      const thoughtText = partialClose ? pendingBoundaryText.slice(0, partialClose.index) : pendingBoundaryText;
      return {
        visibleText: "",
        thoughtText: this.options.captureThoughts === false ? "" : thoughtText,
        changed: true,
      };
    }

    if (pendingBoundaryKind === "outside-open") {
      const partialOpen = findTrailingMarkerPrefix(pendingBoundaryText, [THINK_OPEN]);
      return {
        visibleText: partialOpen ? pendingBoundaryText.slice(0, partialOpen.index) : pendingBoundaryText,
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

function findTrailingMarkerPrefix(text: string, markers: readonly string[]): { index: number; marker: string } | null {
  let bestMatch: { index: number; marker: string; length: number } | null = null;

  for (const marker of markers) {
    for (let length = marker.length - 1; length >= 1; length--) {
      const prefix = marker.slice(0, length);
      if (!text.endsWith(prefix)) {
        continue;
      }

      if (!bestMatch || length > bestMatch.length) {
        bestMatch = {
          index: text.length - length,
          marker,
          length,
        };
      }
      break;
    }
  }

  return bestMatch ? { index: bestMatch.index, marker: bestMatch.marker } : null;
}
