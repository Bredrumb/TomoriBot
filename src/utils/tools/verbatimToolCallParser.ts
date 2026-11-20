import type { FunctionCall } from "@/types/provider/interfaces";
import { log } from "@/utils/misc/logger";

interface ToolSchemaLike {
  type?: unknown;
  properties?: unknown;
  required?: unknown;
}

interface VerbatimToolSpec {
  name: string;
  required: string[];
  properties: Record<string, ToolSchemaLike>;
  singleStringParamName: string | null;
}

export interface VerbatimToolCallParserOptions {
  tools: Array<Record<string, unknown>>;
  maxBufferChars: number;
}

export interface VerbatimToolCallFeedResult {
  visibleText: string;
  functionCall: FunctionCall | null;
}

export interface VerbatimToolCallFlushResult {
  pendingText: string;
  functionCall: FunctionCall | null;
}

const CODE_OPENER_SUFFIX = /`{1,3}[A-Za-z0-9_-]*\s*$/;
// Match triple-backtick fence languages separately from inline backticks so the language tag cannot eat the tool name.
const CODE_OPENER_PREFIX = /^\s*(?:```[A-Za-z0-9_-]*\r?\n|`{1,3})\s*/;
const CODE_CLOSER_PREFIX = /^\s*`{1,3}\s*/;

// Prose and a functionCall are never returned in the same feed() result because the stream adapter discards
// visibleText whenever functionCall is set.
export class VerbatimToolCallParser {
  private readonly toolSpecs: Map<string, VerbatimToolSpec>;
  private readonly anchorRegex: RegExp | null;
  private readonly toolNames: string[];
  private readonly maxBufferChars: number;
  private buffer = "";
  private mode: "scanning" | "accumulating" = "scanning";

  constructor(options: VerbatimToolCallParserOptions) {
    this.toolSpecs = buildToolSpecMap(options.tools);
    this.toolNames = [...this.toolSpecs.keys()];
    this.anchorRegex = buildAnchorRegex(this.toolNames);
    this.maxBufferChars = Math.max(1, options.maxBufferChars);
  }

  get hasTools(): boolean {
    return this.toolSpecs.size > 0;
  }

  feed(text: string): VerbatimToolCallFeedResult {
    if (!text) {
      return { visibleText: "", functionCall: null };
    }

    if (!this.anchorRegex) {
      return { visibleText: text, functionCall: null };
    }

    this.buffer += text;

    if (this.buffer.length > this.maxBufferChars) {
      log.warn(
        `VerbatimToolCallParser: held text exceeded VERBATIM_TOOL_CALL_MAX_BUFFER_CHARS=${this.maxBufferChars}; emitting as visible text`,
      );
      return this.drainBuffer();
    }

    return this.mode === "accumulating" ? this.tryCompleteCall() : this.scanForAnchor();
  }

  flush(): VerbatimToolCallFlushResult {
    if (this.mode === "accumulating") {
      const result = this.tryCompleteCall();
      const pendingText = result.visibleText + this.buffer;
      this.reset();
      return { pendingText, functionCall: result.functionCall };
    }

    const pendingText = this.buffer;
    this.reset();
    return { pendingText, functionCall: null };
  }

  reset(): void {
    this.buffer = "";
    this.mode = "scanning";
  }

  private scanForAnchor(): VerbatimToolCallFeedResult {
    const regex = this.anchorRegex as RegExp;
    regex.lastIndex = 0;
    const match = regex.exec(this.buffer);

    if (match) {
      const anchorIndex = match.index;
      // Include any preceding wrapper opener in the buffer so failed parses emit raw text intact without stray ticks.
      const beforeAnchor = this.buffer.slice(0, anchorIndex);
      const openerMatch = beforeAnchor.match(CODE_OPENER_SUFFIX);
      const splitAt = openerMatch ? anchorIndex - openerMatch[0].length : anchorIndex;

      const prose = this.buffer.slice(0, splitAt);
      this.buffer = this.buffer.slice(splitAt);
      this.mode = "accumulating";

      if (prose.length === 0) {
        return this.tryCompleteCall();
      }
      return { visibleText: prose, functionCall: null };
    }

    // No anchor: emit the safe prefix, holding back only a tail that could be
    // the start of a wrapper opener or a partial tool name on the next chunk.
    const holdback = this.computeHoldback(this.buffer);
    const visibleText = this.buffer.slice(0, this.buffer.length - holdback.length);
    this.buffer = holdback;
    return { visibleText, functionCall: null };
  }

  private tryCompleteCall(): VerbatimToolCallFeedResult {
    const opener = this.buffer.match(CODE_OPENER_PREFIX)?.[0] ?? "";
    const afterOpener = this.buffer.slice(opener.length);

    const openParenIndex = afterOpener.indexOf("(");
    if (openParenIndex === -1) {
      return { visibleText: "", functionCall: null };
    }

    const closeParenIndex = findBalancedCallEnd(afterOpener, openParenIndex);
    if (closeParenIndex === -1) {
      return { visibleText: "", functionCall: null };
    }

    const callText = afterOpener.slice(0, closeParenIndex + 1);
    const functionCall = this.parseToolCall(callText);
    if (!functionCall) {
      // Not a real call (e.g. invalid JSON args), so surface the raw text instead
      // of silently dropping it, then resume scanning for a later anchor.
      return this.drainBuffer();
    }

    this.buffer = afterOpener.slice(closeParenIndex + 1).replace(CODE_CLOSER_PREFIX, "");
    this.mode = "scanning";
    log.info(`VerbatimToolCallParser: Parsed verbatim tool call "${functionCall.name}"`);
    return { visibleText: "", functionCall };
  }

  private computeHoldback(buffer: string): string {
    // Include full tool names up to name.length in the holdback because the opening "(" may arrive in the next chunk.
    let namePart = "";
    for (const name of this.toolNames) {
      for (let len = Math.min(buffer.length, name.length); len > namePart.length; len--) {
        if (buffer.endsWith(name.slice(0, len))) {
          namePart = buffer.slice(buffer.length - len);
          break;
        }
      }
    }

    // A full tool name followed only by trailing whitespace: the anchor
    // permits `name\s*(`, so the "(" may still arrive on the next chunk.
    if (!namePart) {
      const trailingWhitespace = buffer.match(/\s+$/)?.[0] ?? "";
      if (trailingWhitespace) {
        const beforeWhitespace = buffer.slice(0, buffer.length - trailingWhitespace.length);
        for (const name of this.toolNames) {
          if (beforeWhitespace.endsWith(name)) {
            namePart = name + trailingWhitespace;
            break;
          }
        }
      }
    }

    // A wrapper opener directly before the partial name (or at the very end)
    // might be wrapping a call still arriving on the next chunk.
    const beforeName = buffer.slice(0, buffer.length - namePart.length);
    const opener = beforeName.match(CODE_OPENER_SUFFIX)?.[0] ?? "";
    return opener + namePart;
  }

  private drainBuffer(): VerbatimToolCallFeedResult {
    const visibleText = this.buffer;
    this.buffer = "";
    this.mode = "scanning";
    return { visibleText, functionCall: null };
  }

  private parseToolCall(code: string): FunctionCall | null {
    const body = code.trim();
    const callMatch = body.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/);
    if (!callMatch) {
      log.warn(`VerbatimToolCallParser: Rejected non-call code span: ${body.slice(0, 200)}`);
      return null;
    }

    const [, name, argsTextRaw] = callMatch;
    const spec = this.toolSpecs.get(name);
    if (!spec) {
      log.warn(`VerbatimToolCallParser: Rejected unknown tool "${name}"`);
      return null;
    }

    const argsText = argsTextRaw.trim();
    if (!argsText) {
      if (spec.required.length > 0) {
        log.warn(`VerbatimToolCallParser: Rejected no-arg call for "${name}" with required params`);
        return null;
      }
      return { name, args: {} };
    }

    if (argsText.startsWith("{") && argsText.endsWith("}")) {
      const parsedArgs = parseJsonObject(argsText);
      if (!parsedArgs) {
        log.warn(`VerbatimToolCallParser: Rejected invalid JSON object args for "${name}"`);
        return null;
      }
      return { name, args: parsedArgs };
    }

    if (argsText.startsWith('"') && argsText.endsWith('"')) {
      if (!spec.singleStringParamName) {
        log.warn(`VerbatimToolCallParser: Rejected string shorthand for multi-arg tool "${name}"`);
        return null;
      }
      const parsedValue = parseJsonString(argsText);
      if (parsedValue === null) {
        log.warn(`VerbatimToolCallParser: Rejected invalid JSON string shorthand for "${name}"`);
        return null;
      }
      return { name, args: { [spec.singleStringParamName]: parsedValue } };
    }

    log.warn(`VerbatimToolCallParser: Rejected unsupported argument syntax for "${name}"`);
    return null;
  }
}

function buildToolSpecMap(tools: Array<Record<string, unknown>>): Map<string, VerbatimToolSpec> {
  const specs = new Map<string, VerbatimToolSpec>();

  for (const tool of tools) {
    const declaration = getFunctionDeclaration(tool);
    if (!declaration) continue;

    const nameValue = declaration.name;
    if (typeof nameValue !== "string" || !nameValue) continue;

    const parameters = isRecord(declaration.parameters) ? (declaration.parameters as ToolSchemaLike) : {};
    const properties = isRecord(parameters.properties) ? toToolPropertyMap(parameters.properties) : {};
    const required = Array.isArray(parameters.required)
      ? parameters.required.filter((value): value is string => typeof value === "string")
      : [];
    const singleStringParamName =
      required.length === 1 && properties[required[0]]?.type === "string" ? required[0] : null;

    specs.set(nameValue, {
      name: nameValue,
      required,
      properties,
      singleStringParamName,
    });
  }

  return specs;
}

const VERBATIM_TOOL_CALL_MAX_BUFFER_CHARS = 8192;

export function getVerbatimToolCallMaxBufferChars(): number {
  return VERBATIM_TOOL_CALL_MAX_BUFFER_CHARS;
}

function buildAnchorRegex(names: string[]): RegExp | null {
  if (names.length === 0) {
    return null;
  }
  const alternation = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(`\\b(?:${alternation})\\s*\\(`, "g");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findBalancedCallEnd(text: string, openParenIndex: number): number {
  let depth = 0;
  let inString = false;

  for (let i = openParenIndex; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function getFunctionDeclaration(tool: Record<string, unknown>): Record<string, unknown> | null {
  if (tool.type === "function" && isRecord(tool.function)) {
    return tool.function;
  }
  if (typeof tool.name === "string") {
    return tool;
  }
  return null;
}

function toToolPropertyMap(value: Record<string, unknown>): Record<string, ToolSchemaLike> {
  const result: Record<string, ToolSchemaLike> = {};
  for (const [key, schema] of Object.entries(value)) {
    if (isRecord(schema)) {
      result[key] = schema;
    }
  }
  return result;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonString(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
