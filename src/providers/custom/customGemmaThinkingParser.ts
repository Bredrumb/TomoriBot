import { log } from "@/utils/misc/logger";
import type { ThoughtLogEntry } from "@/types/provider/interfaces";

// KoboldCPP decodes the canonical <|channel>thought token to </s><thought in API streams, so both start variants are
// scanned before the shared end token.
const START_TOKENS = ["</s><thought", "<|channel>thought"] as const;
const END_TOKEN = "<channel|>";

export const GEMMA_THINKING_PARSER_ENABLED =
  (process.env.CUSTOM_GEMMA_THINKING_PARSER_ENABLED ?? "true").toLowerCase() !== "false";

export interface GemmaThinkingResult {
  visibleText: string;
  thoughts: ThoughtLogEntry[];
}

export class GemmaThinkingParser {
  private mode: "idle" | "accumulating" = "idle";
  private scanHoldback = "";
  private thinkBuffer = "";

  feed(text: string): GemmaThinkingResult {
    if (this.mode === "idle") {
      return this.scanForStart(text);
    }
    return this.accumulate(text);
  }

  flush(): GemmaThinkingResult {
    if (this.mode !== "accumulating") {
      const visibleText = this.scanHoldback;
      this.reset();
      return { visibleText, thoughts: [] };
    }

    // Stream ended mid-accumulation, so treat buffered content as a partial thought.
    log.info("CustomGemmaThinkingParser: Stream ended during thinking accumulation — recovering partial thought");
    const content = this.thinkBuffer.replace(/^\n/, "").trim();
    this.reset();

    const thoughts: ThoughtLogEntry[] = content.length > 0 ? [{ kind: "raw", content }] : [];
    return { visibleText: "", thoughts };
  }

  private scanForStart(text: string): GemmaThinkingResult {
    const combined = this.scanHoldback + text;

    let earliest = -1;
    let matchedLen = 0;
    for (const token of START_TOKENS) {
      const idx = combined.indexOf(token);
      if (idx !== -1 && (earliest === -1 || idx < earliest)) {
        earliest = idx;
        matchedLen = token.length;
      }
    }

    if (earliest !== -1) {
      const visibleBefore = combined.slice(0, earliest);
      this.scanHoldback = "";
      this.thinkBuffer = combined.slice(earliest + matchedLen);
      this.mode = "accumulating";
      return this.checkForEnd(visibleBefore);
    }

    // No full match. Hold back only the minimum tail that is a genuine prefix
    // of any start token variant, to handle tokens split across chunk boundaries.
    const holdback = this.longestSuffixPrefixOfAny(combined);
    this.scanHoldback = holdback;
    return { visibleText: combined.slice(0, combined.length - holdback.length), thoughts: [] };
  }

  private accumulate(text: string): GemmaThinkingResult {
    this.thinkBuffer += text;
    return this.checkForEnd("");
  }

  private checkForEnd(prependVisible: string): GemmaThinkingResult {
    const endIdx = this.thinkBuffer.indexOf(END_TOKEN);
    if (endIdx === -1) {
      return { visibleText: prependVisible, thoughts: [] };
    }

    let content = this.thinkBuffer.slice(0, endIdx);
    const remaining = this.thinkBuffer.slice(endIdx + END_TOKEN.length);
    this.reset();

    // Gemma always emits a newline immediately after "thought", so trim it.
    if (content.startsWith("\n")) {
      content = content.slice(1);
    }

    // Build thought entry; drop empty suppressors (26B/31B thinking OFF).
    const thoughts: ThoughtLogEntry[] = content.trim().length > 0 ? [{ kind: "raw", content }] : [];

    // Scan remaining text for any subsequent thinking blocks (e.g. multi-turn).
    const rest = this.scanForStart(remaining);

    return {
      visibleText: prependVisible + rest.visibleText,
      thoughts: [...thoughts, ...rest.thoughts],
    };
  }

  private longestSuffixPrefixOfAny(text: string): string {
    let longest = "";
    for (const token of START_TOKENS) {
      for (let len = Math.min(text.length, token.length - 1); len > 0; len--) {
        if (text.endsWith(token.slice(0, len))) {
          if (len > longest.length) {
            longest = text.slice(text.length - len);
          }
          break;
        }
      }
    }
    return longest;
  }

  private reset(): void {
    this.mode = "idle";
    this.scanHoldback = "";
    this.thinkBuffer = "";
  }
}
