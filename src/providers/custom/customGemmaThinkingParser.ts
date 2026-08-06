/**
 * Gemma 4 Thinking Block Parser
 *
 * KoboldCPP correctly splits Gemma 4's thinking tokens into `reasoning_content`
 * for pure-text responses, but when a tool call follows the thinking block the
 * entire chunk arrives as raw `delta.content`:
 *
 *   <|channel>thought\n[reasoning]\n<channel|>[answer]<|tool_call>...<tool_call|>
 *
 * This parser strips the `<|channel>thought...<channel|>` block from `delta.content`
 * and routes its contents to the thought log, leaving only the answer (and any
 * tool call tokens) in the visible text for downstream parsers.
 *
 * Two variants exist across Gemma 4 model sizes:
 *   - Thinking ON:  <|channel>thought\n[reasoning]\n<channel|>[answer]
 *   - Thinking OFF: <|channel>thought\n<channel|>[answer]  (empty suppressor: 26B/31B only)
 *
 * Empty suppressor blocks are dropped silently (no thought log entry created).
 *
 * Set CUSTOM_GEMMA_THINKING_PARSER_ENABLED=false to disable if a non-Gemma model
 * produces similar token strings unexpectedly.
 */

import { log } from "@/utils/misc/logger";
import type { ThoughtLogEntry } from "@/types/provider/interfaces";

/**
 * KoboldCPP renders the <|channel> special token differently depending on context:
 *   - "<|channel>thought": canonical form (shown in KoboldCPP's own UI / terminal log)
 *   - "</s><thought": API stream form (the token decoded to "</s>" + plain text "<thought")
 * Both share the same END_TOKEN, so we scan for whichever start variant arrives first.
 */
const START_TOKENS = ["</s><thought", "<|channel>thought"] as const;
const END_TOKEN = "<channel|>";

export const GEMMA_THINKING_PARSER_ENABLED =
  (process.env.CUSTOM_GEMMA_THINKING_PARSER_ENABLED ?? "true").toLowerCase() !== "false";

export interface GemmaThinkingResult {
  /** Visible text to pass to downstream parsers (e.g. GemmaToolCallParser). */
  visibleText: string;
  /** Thought log entries extracted from the thinking block, if any. */
  thoughts: ThoughtLogEntry[];
}

export class GemmaThinkingParser {
  private mode: "idle" | "accumulating" = "idle";
  /**
   * Tail held back during idle scanning for a partial START_TOKEN prefix.
   * Only non-empty when the last chunk ended with characters that are a genuine
   * prefix of START_TOKEN (e.g. `<`, `<|`, `<|channel`).
   */
  private scanHoldback = "";
  /** Raw content accumulated between START_TOKEN and END_TOKEN. */
  private thinkBuffer = "";

  /**
   * Feed one text chunk from `delta.content`.
   * Returns visible text (for downstream parsers) and any extracted thoughts.
   */
  feed(text: string): GemmaThinkingResult {
    if (this.mode === "idle") {
      return this.scanForStart(text);
    }
    return this.accumulate(text);
  }

  /**
   * Called when the stream ends. Releases any held-back visible text and
   * recovers partial thinking content from a truncated accumulation buffer.
   */
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

  /**
   * Returns the longest suffix of `text` that is a prefix of any start token variant,
   * excluding full matches (already handled by indexOf above).
   * Checked against all START_TOKENS so a chunk boundary inside either variant is safe.
   */
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
