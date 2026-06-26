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

export class VerbatimToolCallParser {
  private readonly toolSpecs: Map<string, VerbatimToolSpec>;
  private readonly maxBufferChars: number;
  private buffer = "";
  private visibleTextEmitted = false;

  constructor(options: VerbatimToolCallParserOptions) {
    this.toolSpecs = buildToolSpecMap(options.tools);
    this.maxBufferChars = Math.max(1, options.maxBufferChars);
  }

  get hasTools(): boolean {
    return this.toolSpecs.size > 0;
  }

  feed(text: string): VerbatimToolCallFeedResult {
    if (!text) {
      return { visibleText: "", functionCall: null };
    }

    if (this.visibleTextEmitted || this.toolSpecs.size === 0) {
      return { visibleText: text, functionCall: null };
    }

    this.buffer += text;
    if (this.buffer.length > this.maxBufferChars) {
      log.warn(
        `VerbatimToolCallParser: held text exceeded VERBATIM_TOOL_CALL_MAX_BUFFER_CHARS=${this.maxBufferChars}; emitting as visible text`,
      );
      return this.emitBufferedText();
    }

    return this.tryParseBufferedPrefix();
  }

  flush(): VerbatimToolCallFlushResult {
    const pendingText = this.buffer;
    this.reset();
    return { pendingText, functionCall: null };
  }

  reset(): void {
    this.buffer = "";
    this.visibleTextEmitted = false;
  }

  private tryParseBufferedPrefix(): VerbatimToolCallFeedResult {
    const trimmedStart = this.buffer.trimStart();
    if (!trimmedStart) {
      return { visibleText: "", functionCall: null };
    }

    if (!trimmedStart.startsWith("`")) {
      return this.emitBufferedText();
    }

    if (trimmedStart === "`" || trimmedStart === "``") {
      return { visibleText: "", functionCall: null };
    }

    if (trimmedStart.startsWith("```")) {
      return this.tryParseFence(trimmedStart);
    }

    if (trimmedStart.startsWith("``")) {
      return this.emitBufferedText();
    }

    return this.tryParseInlineCode(trimmedStart);
  }

  private tryParseInlineCode(trimmedStart: string): VerbatimToolCallFeedResult {
    const closingIndex = trimmedStart.indexOf("`", 1);
    if (closingIndex === -1) {
      return { visibleText: "", functionCall: null };
    }

    const trailingText = trimmedStart.slice(closingIndex + 1);
    if (trailingText.trim()) {
      return this.emitBufferedText();
    }

    return this.parseCompletedCode(trimmedStart.slice(1, closingIndex));
  }

  private tryParseFence(trimmedStart: string): VerbatimToolCallFeedResult {
    const closingIndex = trimmedStart.indexOf("```", 3);
    if (closingIndex === -1) {
      return { visibleText: "", functionCall: null };
    }

    const trailingText = trimmedStart.slice(closingIndex + 3);
    if (trailingText.trim()) {
      return this.emitBufferedText();
    }

    const fencedBody = stripFenceLanguageLine(trimmedStart.slice(3, closingIndex));
    return this.parseCompletedCode(fencedBody);
  }

  private parseCompletedCode(code: string): VerbatimToolCallFeedResult {
    const functionCall = this.parseToolCall(code);
    if (!functionCall) {
      return this.emitBufferedText();
    }

    this.buffer = "";
    log.info(`VerbatimToolCallParser: Parsed verbatim tool call "${functionCall.name}"`);
    return { visibleText: "", functionCall };
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

  private emitBufferedText(): VerbatimToolCallFeedResult {
    const visibleText = this.buffer;
    this.buffer = "";
    if (visibleText.length > 0) {
      this.visibleTextEmitted = true;
    }
    return { visibleText, functionCall: null };
  }
}

export function buildToolSpecMap(tools: Array<Record<string, unknown>>): Map<string, VerbatimToolSpec> {
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

export function getVerbatimToolCallMaxBufferChars(): number {
  const rawValue = process.env.VERBATIM_TOOL_CALL_MAX_BUFFER_CHARS ?? "8192";
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8192;
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

function stripFenceLanguageLine(code: string): string {
  const normalized = code.replace(/^\r?\n/, "");
  const newlineIndex = normalized.indexOf("\n");
  if (newlineIndex === -1) {
    return normalized;
  }

  const firstLine = normalized.slice(0, newlineIndex).trim();
  if (firstLine && /^[A-Za-z0-9_-]+$/.test(firstLine)) {
    return normalized.slice(newlineIndex + 1);
  }
  return normalized;
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
