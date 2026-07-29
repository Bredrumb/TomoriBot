/**
 * Gemma 4 Embedded Tool Call Parser
 *
 * Gemma 4 running locally (e.g. via KoboldCPP at 4-bit quant) sometimes leaks its
 * internal tool-call vocabulary into `delta.content` instead of emitting a proper
 * `delta.tool_calls` structure. Two distinct leaked dialects have been observed:
 *
 * 1. Special-token form (matches the documented KoboldCPP jinja template):
 *      <|tool_call>call:update_short_term_memory{summary:<|"|>...<|"|>}<tool_call|>
 *
 * 2. Python-call form (Gemma's *trained* default the model drifts back to under
 *    heavy quantization, regardless of the configured template):
 *      <tool_code>update_short_term_memory(summary="...")</tool_code>
 *
 * This parser is a stateful chunk-by-chunk scanner that:
 * 1. Passes normal text through unchanged.
 * 2. Detects either dialect's start token and begins buffering (the matched
 *    dialect becomes "active" for the duration of the block).
 * 3. Parses the complete block once the active dialect's end token is found.
 * 4. Attempts a best-effort parse if the stream ends mid-block (truncation recovery).
 *
 * Each dialect is a self-contained `{ start, end, parse }` entry in `dialects`, so
 * a format can be removed by deleting one array element without touching the scanner.
 */

import { log } from "@/utils/misc/logger";
import type { FunctionCall } from "@/types/provider/interfaces";

/**
 * A single leaked tool-call format the scanner can recognise.
 * `parse` receives the raw text between `start` and `end` (or end-of-stream on
 * truncation) and returns a structured call, or null if it cannot be parsed.
 */
interface GemmaDialect {
  start: string;
  end: string;
  parse: (block: string) => FunctionCall | null;
}

export interface GemmaFeedResult {
  /** Visible text to emit (may be empty string). */
  visibleText: string;
  /** Completed function call, if one was fully parsed from this chunk. */
  functionCall: FunctionCall | null;
}

export interface GemmaFlushResult {
  /**
   * Any text that was held back at the end of the last idle chunk waiting for
   * a possible START_TOKEN continuation that never arrived. Must be emitted
   * before the stream terminates.
   */
  pendingText: string;
  /** Parsed function call recovered from a truncated accumulation buffer. */
  functionCall: FunctionCall | null;
}

export class GemmaToolCallParser {
  private mode: "idle" | "accumulating" = "idle";
  /**
   * Tail held back during idle scanning for a partial start-token prefix.
   * Only non-empty when the last chunk ended with a genuine prefix of some
   * dialect's start token (e.g. `<`, `<|`, `<|t`...). In practice this is almost
   * always empty because normal model output does not end with `<`.
   */
  private scanHoldback = "";
  /** Raw content accumulated between the active dialect's start and end tokens. */
  private toolBuffer = "";
  /** The dialect whose start token opened the current accumulation block. */
  private activeDialect: GemmaDialect | null = null;

  /**
   * Recognised leaked formats, in priority order. The scanner picks whichever
   * dialect's start token appears *earliest* in the stream, so ordering here only
   * breaks exact-position ties (which cannot happen — the start tokens differ).
   */
  private readonly dialects: GemmaDialect[] = [
    // Special-token form: <|tool_call>call:name{key:value}<tool_call|>
    {
      start: "<|tool_call>",
      end: "<tool_call|>",
      parse: (block) => this.parseSpecialTokenBlock(block),
    },
    // Python-call form: <tool_code>name(key="value")</tool_code>
    {
      start: "<tool_code>",
      end: "</tool_code>",
      parse: (block) => this.parseToolCodeBlock(block),
    },
  ];

  /** True while inside a tool call block (START seen, END not yet seen). */
  get isAccumulating(): boolean {
    return this.mode === "accumulating";
  }

  /**
   * Feed one text chunk from `delta.content`.
   * Returns visible text to emit and any completed tool call.
   */
  feed(text: string): GemmaFeedResult {
    if (this.mode === "idle") {
      return this.scanForStart(text);
    }
    return this.accumulate(text);
  }

  /**
   * Called when the stream ends. Returns any held-back visible text and any
   * function call recovered from a truncated accumulation buffer.
   */
  flush(): GemmaFlushResult {
    if (this.mode !== "accumulating") {
      const pendingText = this.scanHoldback;
      this.reset();
      return { pendingText, functionCall: null };
    }

    // Stream ended mid-accumulation — attempt a best-effort parse with the
    // dialect that opened the block.
    log.info("CustomGemmaToolParser: Stream ended during tool call accumulation — attempting truncated parse");
    const functionCall = this.activeDialect?.parse(this.toolBuffer) ?? null;
    this.reset();

    if (!functionCall) {
      log.warn("CustomGemmaToolParser: Truncated parse failed — discarding partial tool call");
    }
    return { pendingText: "", functionCall };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private scanForStart(text: string): GemmaFeedResult {
    const combined = this.scanHoldback + text;

    // Find the earliest start token among all dialects. Earliest wins so a later
    // dialect's token appearing deeper in the chunk never pre-empts an earlier one.
    let bestIdx = -1;
    let bestDialect: GemmaDialect | null = null;
    for (const dialect of this.dialects) {
      const idx = combined.indexOf(dialect.start);
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
        bestIdx = idx;
        bestDialect = dialect;
      }
    }

    if (bestDialect && bestIdx !== -1) {
      // Found it: emit text before the token, start accumulating after it.
      const visibleText = combined.slice(0, bestIdx);
      this.scanHoldback = "";
      this.activeDialect = bestDialect;
      this.toolBuffer = combined.slice(bestIdx + bestDialect.start.length);
      this.mode = "accumulating";
      // The end token may already be present in the same chunk.
      return this.checkForEnd(visibleText);
    }

    // No full match. Only hold back the minimum tail that is a genuine prefix of
    // some dialect's start token — normal prose never ends with `<` mid-token so
    // holdback is usually "".
    const holdback = this.longestSuffixPrefix(combined);
    this.scanHoldback = holdback;
    return { visibleText: combined.slice(0, combined.length - holdback.length), functionCall: null };
  }

  private accumulate(text: string): GemmaFeedResult {
    this.toolBuffer += text;
    return this.checkForEnd("");
  }

  private checkForEnd(prependVisible: string): GemmaFeedResult {
    // `activeDialect` is always set while accumulating (scanForStart assigns it).
    const dialect = this.activeDialect;
    if (!dialect) {
      return { visibleText: prependVisible, functionCall: null };
    }

    const endIdx = this.toolBuffer.indexOf(dialect.end);
    if (endIdx === -1) {
      return { visibleText: prependVisible, functionCall: null };
    }

    const block = this.toolBuffer.slice(0, endIdx);
    this.reset();

    const functionCall = dialect.parse(block);
    if (!functionCall) {
      // Parse failed — emit raw block as text so nothing is silently dropped.
      log.warn(`CustomGemmaToolParser: Failed to parse block — emitting as text: ${block.slice(0, 200)}`);
      return { visibleText: prependVisible + block, functionCall: null };
    }

    return { visibleText: prependVisible, functionCall };
  }

  /**
   * Returns the longest suffix of `text` that is also a prefix of *any* dialect's
   * start token, excluding a full start token itself (that case is handled by
   * indexOf in scanForStart). This is how we safely hold back only the minimum
   * necessary chars while a start token might still be completing on the next chunk.
   */
  private longestSuffixPrefix(text: string): string {
    let longest = "";
    for (const { start } of this.dialects) {
      for (let len = Math.min(text.length, start.length - 1); len > longest.length; len--) {
        if (text.endsWith(start.slice(0, len))) {
          longest = text.slice(text.length - len);
          break;
        }
      }
    }
    return longest;
  }

  /**
   * Parse the special-token dialect's block (between `<|tool_call>` and
   * `<tool_call|>`, or end of stream).
   *
   * Expected format: call:{toolName}{key:<|"|>value<|"|>, ...}
   */
  private parseSpecialTokenBlock(block: string): FunctionCall | null {
    // Try the full well-formed pattern: call:name{...}
    const full = block.match(/^call:(\w+)\{([\s\S]*)\}$/);
    if (full) {
      return this.buildCall(full[1], full[2]);
    }

    // Truncation recovery: closing brace may be missing.
    const open = block.match(/^call:(\w+)\{([\s\S]*)$/);
    if (open) {
      log.info(`CustomGemmaToolParser: Recovering truncated call for "${open[1]}"`);
      return this.buildCall(open[1], open[2]);
    }

    log.warn(`CustomGemmaToolParser: Unrecognised block format: ${block.slice(0, 200)}`);
    return null;
  }

  /**
   * Build a FunctionCall from a parsed tool name and raw args string.
   *
   * Gemma 4 produces two string-value formats depending on quant level:
   *   Format A (special token markers): key:<|"|>value<|"|>
   *   Format B (standard JSON-style):   key: "value"  or  key:"value"
   */
  private buildCall(name: string, argsStr: string): FunctionCall {
    const args: Record<string, unknown> = {};
    const matchedKeys = new Set<string>();

    // Format A — special token string markers: key:<|"|>value<|"|>
    for (const m of argsStr.matchAll(/(\w+):\s*<\|"\|>([\s\S]*?)<\|"\|>/g)) {
      args[m[1]] = m[2];
      matchedKeys.add(m[1]);
    }

    // Format B — standard double-quoted strings: key: "value" or key:"value"
    //    Lazy quantifier stops at the first closing quote to keep args separate.
    for (const m of argsStr.matchAll(/(\w+):\s*"([\s\S]*?)"/g)) {
      if (matchedKeys.has(m[1])) continue;
      args[m[1]] = m[2];
      matchedKeys.add(m[1]);
    }

    // Non-string args: key:rawValue (number / boolean / bare identifier).
    //    Mask out the already-captured quoted spans first so a `word:word`
    //    sequence *inside* a string value is not re-scanned as a phantom scalar.
    const residue = argsStr.replace(/(\w+):\s*<\|"\|>[\s\S]*?<\|"\|>/g, "").replace(/(\w+):\s*"[\s\S]*?"/g, "");
    for (const m of residue.matchAll(/(\w+):\s*([\w.-]+)/g)) {
      if (matchedKeys.has(m[1])) continue;

      const raw = m[2];
      if (raw === "true") args[m[1]] = true;
      else if (raw === "false") args[m[1]] = false;
      else if (!Number.isNaN(Number(raw))) args[m[1]] = Number(raw);
      else args[m[1]] = raw;
    }

    log.info(`CustomGemmaToolParser: Parsed "${name}" → ${JSON.stringify(args)}`);
    return { name, args };
  }

  /**
   * Parse the Python-call dialect's block (between `<tool_code>` and
   * `</tool_code>`, or end of stream).
   *
   * Expected format: name(key="value", count=3)
   * Gemma sometimes wraps the call in `print(...)`, which we unwrap one layer.
   */
  private parseToolCodeBlock(block: string): FunctionCall | null {
    let body = block.trim();

    // Unwrap a single print(...) layer if present: print(name(...)) → name(...)
    const printWrap = body.match(/^print\(\s*([\s\S]*?)\s*\)$/);
    if (printWrap) {
      body = printWrap[1].trim();
    }

    // Full well-formed pattern: name(...). Greedy up to the last ')' so nested
    //    parens inside argument values are kept inside the args string.
    const full = body.match(/^(\w+)\s*\(([\s\S]*)\)$/);
    if (full) {
      return this.buildPythonCall(full[1], full[2]);
    }

    // Truncation recovery: closing paren may be missing.
    const open = body.match(/^(\w+)\s*\(([\s\S]*)$/);
    if (open) {
      log.info(`CustomGemmaToolParser: Recovering truncated tool_code call for "${open[1]}"`);
      return this.buildPythonCall(open[1], open[2]);
    }

    log.warn(`CustomGemmaToolParser: Unrecognised tool_code block format: ${block.slice(0, 200)}`);
    return null;
  }

  /**
   * Build a FunctionCall from a Python-style keyword-argument list.
   *
   * Handles: key="value" / key='value' (strings), key=3 / key=true (scalars).
   * Mirrors buildCall's three-pass approach: strings first (so a quoted value
   * containing `=` or digits is never misread as a scalar), then bare scalars.
   */
  private buildPythonCall(name: string, argsStr: string): FunctionCall {
    const args: Record<string, unknown> = {};
    const matchedKeys = new Set<string>();

    // Double-quoted strings: key="value"
    for (const m of argsStr.matchAll(/(\w+)\s*=\s*"([\s\S]*?)"/g)) {
      args[m[1]] = m[2];
      matchedKeys.add(m[1]);
    }

    // Single-quoted strings: key='value' (Gemma uses either quote style).
    for (const m of argsStr.matchAll(/(\w+)\s*=\s*'([\s\S]*?)'/g)) {
      if (matchedKeys.has(m[1])) continue;
      args[m[1]] = m[2];
      matchedKeys.add(m[1]);
    }

    // Bare scalars: key=rawValue (number / Python bool / bare identifier).
    //    Mask out the already-captured quoted spans first so a `word=word`
    //    sequence *inside* a string value is not re-scanned as a phantom scalar.
    const residue = argsStr.replace(/(\w+)\s*=\s*"[\s\S]*?"/g, "").replace(/(\w+)\s*=\s*'[\s\S]*?'/g, "");
    for (const m of residue.matchAll(/(\w+)\s*=\s*([\w.-]+)/g)) {
      if (matchedKeys.has(m[1])) continue;

      const raw = m[2];
      if (raw === "true" || raw === "True") args[m[1]] = true;
      else if (raw === "false" || raw === "False") args[m[1]] = false;
      else if (!Number.isNaN(Number(raw))) args[m[1]] = Number(raw);
      else args[m[1]] = raw;
    }

    log.info(`CustomGemmaToolParser: Parsed tool_code "${name}" → ${JSON.stringify(args)}`);
    return { name, args };
  }

  private reset(): void {
    this.mode = "idle";
    this.scanHoldback = "";
    this.toolBuffer = "";
    this.activeDialect = null;
  }
}
