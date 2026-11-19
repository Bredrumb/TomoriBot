import { log } from "@/utils/misc/logger";
import type { FunctionCall } from "@/types/provider/interfaces";

interface GemmaDialect {
  start: string;
  end: string;
  parse: (block: string) => FunctionCall | null;
}

export interface GemmaFeedResult {
  visibleText: string;
  functionCall: FunctionCall | null;
}

export interface GemmaFlushResult {
  pendingText: string;
  functionCall: FunctionCall | null;
}

export class GemmaToolCallParser {
  private mode: "idle" | "accumulating" = "idle";
  private scanHoldback = "";
  private toolBuffer = "";
  private activeDialect: GemmaDialect | null = null;

  private readonly dialects: GemmaDialect[] = [
    {
      start: "<|tool_call>",
      end: "<tool_call|>",
      parse: (block) => this.parseSpecialTokenBlock(block),
    },
    {
      start: "<tool_code>",
      end: "</tool_code>",
      parse: (block) => this.parseToolCodeBlock(block),
    },
  ];

  get isAccumulating(): boolean {
    return this.mode === "accumulating";
  }

  feed(text: string): GemmaFeedResult {
    if (this.mode === "idle") {
      return this.scanForStart(text);
    }
    return this.accumulate(text);
  }

  flush(): GemmaFlushResult {
    if (this.mode !== "accumulating") {
      const pendingText = this.scanHoldback;
      this.reset();
      return { pendingText, functionCall: null };
    }

    log.info("CustomGemmaToolParser: Stream ended during tool call accumulation — attempting truncated parse");
    const functionCall = this.activeDialect?.parse(this.toolBuffer) ?? null;
    this.reset();

    if (!functionCall) {
      log.warn("CustomGemmaToolParser: Truncated parse failed — discarding partial tool call");
    }
    return { pendingText: "", functionCall };
  }

  private scanForStart(text: string): GemmaFeedResult {
    const combined = this.scanHoldback + text;

    // Pick the earliest dialect start token so a later dialect deeper in the chunk never preempts an earlier block.
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
      const visibleText = combined.slice(0, bestIdx);
      this.scanHoldback = "";
      this.activeDialect = bestDialect;
      this.toolBuffer = combined.slice(bestIdx + bestDialect.start.length);
      this.mode = "accumulating";
      return this.checkForEnd(visibleText);
    }

    // Hold back only a trailing start-token prefix so split dialect markers survive chunk boundaries.
    const holdback = this.longestSuffixPrefix(combined);
    this.scanHoldback = holdback;
    return { visibleText: combined.slice(0, combined.length - holdback.length), functionCall: null };
  }

  private accumulate(text: string): GemmaFeedResult {
    this.toolBuffer += text;
    return this.checkForEnd("");
  }

  private checkForEnd(prependVisible: string): GemmaFeedResult {
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
      log.warn(`CustomGemmaToolParser: Failed to parse block — emitting as text: ${block.slice(0, 200)}`);
      return { visibleText: prependVisible + block, functionCall: null };
    }

    return { visibleText: prependVisible, functionCall };
  }

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

  private parseSpecialTokenBlock(block: string): FunctionCall | null {
    const full = block.match(/^call:(\w+)\{([\s\S]*)\}$/);
    if (full) {
      return this.buildCall(full[1], full[2]);
    }

    const open = block.match(/^call:(\w+)\{([\s\S]*)$/);
    if (open) {
      log.info(`CustomGemmaToolParser: Recovering truncated call for "${open[1]}"`);
      return this.buildCall(open[1], open[2]);
    }

    log.warn(`CustomGemmaToolParser: Unrecognised block format: ${block.slice(0, 200)}`);
    return null;
  }

  private buildCall(name: string, argsStr: string): FunctionCall {
    const args: Record<string, unknown> = {};
    const matchedKeys = new Set<string>();

    for (const m of argsStr.matchAll(/(\w+):\s*<\|"\|>([\s\S]*?)<\|"\|>/g)) {
      args[m[1]] = m[2];
      matchedKeys.add(m[1]);
    }

    for (const m of argsStr.matchAll(/(\w+):\s*"([\s\S]*?)"/g)) {
      if (matchedKeys.has(m[1])) continue;
      args[m[1]] = m[2];
      matchedKeys.add(m[1]);
    }

    // Mask quoted spans so embedded colons inside strings never match as bare scalars.
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

  private parseToolCodeBlock(block: string): FunctionCall | null {
    let body = block.trim();

    // Gemma occasionally emits tool_code inside print(...), so unwrap that outer call first.
    const printWrap = body.match(/^print\(\s*([\s\S]*?)\s*\)$/);
    if (printWrap) {
      body = printWrap[1].trim();
    }

    // Match greedily to the last ')' so nested parentheses inside argument values stay in argsStr.
    const full = body.match(/^(\w+)\s*\(([\s\S]*)\)$/);
    if (full) {
      return this.buildPythonCall(full[1], full[2]);
    }

    const open = body.match(/^(\w+)\s*\(([\s\S]*)$/);
    if (open) {
      log.info(`CustomGemmaToolParser: Recovering truncated tool_code call for "${open[1]}"`);
      return this.buildPythonCall(open[1], open[2]);
    }

    log.warn(`CustomGemmaToolParser: Unrecognised tool_code block format: ${block.slice(0, 200)}`);
    return null;
  }

  private buildPythonCall(name: string, argsStr: string): FunctionCall {
    const args: Record<string, unknown> = {};
    const matchedKeys = new Set<string>();

    for (const m of argsStr.matchAll(/(\w+)\s*=\s*"([\s\S]*?)"/g)) {
      args[m[1]] = m[2];
      matchedKeys.add(m[1]);
    }

    for (const m of argsStr.matchAll(/(\w+)\s*=\s*'([\s\S]*?)'/g)) {
      if (matchedKeys.has(m[1])) continue;
      args[m[1]] = m[2];
      matchedKeys.add(m[1]);
    }

    // Mask quoted spans so embedded `=` inside strings never match as bare scalars.
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
