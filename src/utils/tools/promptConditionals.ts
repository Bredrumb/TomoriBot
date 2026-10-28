type PromptConditionNamespace = "capability" | "tool" | "tool_family";

export interface PromptConditionPredicate {
  namespace: PromptConditionNamespace;
  name: string;
  inverted: boolean;
}

type ConditionalHeader =
  | { type: "tomori"; rawCondition: string; predicate: PromptConditionPredicate }
  | { type: "st"; unless: boolean; condition: string };

interface ConditionalBlock {
  openTag: string;
  elseTag: string;
  closeTag: string;
  truthy: PromptConditionalNode[];
  falsy: PromptConditionalNode[];
}

type PromptConditionalNode = { type: "text"; text: string } | (ConditionalHeader & ConditionalBlock);

interface ConditionalFrame {
  header: ConditionalHeader | null;
  unless: boolean;
  openTag: string;
  elseTag: string;
  truthy: PromptConditionalNode[];
  falsy: PromptConditionalNode[];
  activeBranch: "truthy" | "falsy";
  malformed: boolean;
}

type ConditionalDirective =
  | { kind: "open"; dialect: "tomori" | "st"; unless: boolean; condition: string; end: number }
  | { kind: "malformed"; end: number }
  | { kind: "else"; exact: boolean; end: number }
  | { kind: "close"; unless: boolean; exact: boolean; end: number };

export interface PromptConditionalRenderOptions {
  evaluate(predicate: PromptConditionPredicate): Promise<boolean | undefined> | boolean | undefined;
  warn(message: string): void;
}

export interface StConditionalRenderOptions {
  resolveCondition(expression: string): string;
  /** Applied to each kept text run in source order, so a declaration is visible to every later condition. */
  transformText?(text: string): string;
  warn(message: string): void;
}

const ST_OPEN_REGEX = /\{\{\s*#(if|unless)\b/iy;
const TOMORI_OPEN_REGEX = /\{\{\s*if\b([^{}]*)\}\}/iy;
const ELSE_REGEX = /\{\{\s*else\b([^{}]*)\}\}/iy;
const CLOSE_REGEX = /\{\{\s*\/(if|unless)\b([^{}]*)\}\}/iy;
const TOMORI_DIRECTIVE_REGEX = /\{\{\s*(?:if\b|\/(?:if|unless)\b|else\b)/i;
const ST_DIRECTIVE_REGEX = /\{\{\s*#(?:if|unless)\b/i;
const CONDITION_REGEX = /^(!)?(capability|tool|tool_family):([a-z0-9][a-z0-9_.-]*)$/i;

// Presets are untrusted 2 MB uploads, so nesting is capped to keep both recursive renderers far from the stack limit.
const MAX_CONDITIONAL_DEPTH = 32;

const FALSY_ST_CONDITION_VALUES = new Set(["", "false", "0"]);

const ENDS_WITH_BLANK_LINE = /\n[^\S\n]*\n[^\S\n]*$/;
const LEADING_BLANK_LINE = /^[^\S\n]*\n[^\S\n]*\n/;

function parsePredicate(rawCondition: string): PromptConditionPredicate | null {
  const match = rawCondition.trim().match(CONDITION_REGEX);
  if (!match) return null;

  return {
    namespace: match[2].toLowerCase() as PromptConditionNamespace,
    name: match[3].toLowerCase(),
    inverted: match[1] === "!",
  };
}

function findNestedTagEnd(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length - 1; index++) {
    if (text.startsWith("{{", index)) {
      depth++;
      index++;
    } else if (text.startsWith("}}", index)) {
      if (depth === 0) return index + 2;
      depth--;
      index++;
    }
  }
  return -1;
}

function matchDirective(text: string, index: number): ConditionalDirective | null {
  ST_OPEN_REGEX.lastIndex = index;
  const stOpen = ST_OPEN_REGEX.exec(text);
  if (stOpen) {
    const conditionStart = ST_OPEN_REGEX.lastIndex;
    const end = findNestedTagEnd(text, conditionStart);
    if (end === -1) return { kind: "malformed", end: text.length };
    return {
      kind: "open",
      dialect: "st",
      unless: stOpen[1].toLowerCase() === "unless",
      condition: text.slice(conditionStart, end - 2).trim(),
      end,
    };
  }

  TOMORI_OPEN_REGEX.lastIndex = index;
  const tomoriOpen = TOMORI_OPEN_REGEX.exec(text);
  if (tomoriOpen) {
    return {
      kind: "open",
      dialect: "tomori",
      unless: false,
      condition: tomoriOpen[1].trim(),
      end: TOMORI_OPEN_REGEX.lastIndex,
    };
  }

  ELSE_REGEX.lastIndex = index;
  const elseTag = ELSE_REGEX.exec(text);
  if (elseTag) return { kind: "else", exact: elseTag[1].trim() === "", end: ELSE_REGEX.lastIndex };

  CLOSE_REGEX.lastIndex = index;
  const closeTag = CLOSE_REGEX.exec(text);
  if (closeTag) {
    return {
      kind: "close",
      unless: closeTag[1].toLowerCase() === "unless",
      exact: closeTag[2].trim() === "",
      end: CLOSE_REGEX.lastIndex,
    };
  }

  return null;
}

function buildHeader(directive: Extract<ConditionalDirective, { kind: "open" }>): ConditionalHeader | null {
  if (directive.condition.length === 0) return null;
  if (directive.dialect === "st") {
    return { type: "st", unless: directive.unless, condition: directive.condition };
  }
  const predicate = parsePredicate(directive.condition);
  return predicate ? { type: "tomori", rawCondition: directive.condition, predicate } : null;
}

function appendNode(root: PromptConditionalNode[], stack: ConditionalFrame[], node: PromptConditionalNode): void {
  const frame = stack.at(-1);
  if (!frame) {
    root.push(node);
    return;
  }

  frame[frame.activeBranch].push(node);
}

function parseConditionalNodes(text: string, warn: (message: string) => void): PromptConditionalNode[] | null {
  const root: PromptConditionalNode[] = [];
  const stack: ConditionalFrame[] = [];
  let cursor = 0;
  let index = text.indexOf("{{");

  while (index !== -1) {
    const directive = matchDirective(text, index);
    if (!directive) {
      index = text.indexOf("{{", index + 2);
      continue;
    }

    if (index > cursor) {
      appendNode(root, stack, { type: "text", text: text.slice(cursor, index) });
    }
    const tag = text.slice(index, directive.end);

    if (directive.kind === "malformed") {
      warn("Omitted an unterminated SillyTavern opening tag");
    } else if (directive.kind === "open") {
      if (stack.length >= MAX_CONDITIONAL_DEPTH) {
        warn(`Prompt conditionals nest deeper than ${MAX_CONDITIONAL_DEPTH} levels; text left unrendered`);
        return null;
      }
      const header = buildHeader(directive);
      stack.push({
        header,
        unless: directive.unless,
        openTag: tag,
        elseTag: "",
        truthy: [],
        falsy: [],
        activeBranch: "truthy",
        malformed: header === null,
      });
    } else if (directive.kind === "else") {
      const frame = stack.at(-1);
      if (!frame) {
        warn("Found {{else}} without a matching {{if}} block");
      } else if (!directive.exact || frame.activeBranch === "falsy") {
        frame.malformed = true;
      } else {
        frame.activeBranch = "falsy";
        frame.elseTag = tag;
      }
    } else {
      const frame = stack.pop();
      if (!frame) {
        warn(`Found ${tag} without a matching opening block`);
      } else if (!frame.header || frame.malformed || !directive.exact || directive.unless !== frame.unless) {
        warn(`Omitted malformed prompt conditional: ${frame.openTag}`);
      } else {
        appendNode(root, stack, {
          ...frame.header,
          openTag: frame.openTag,
          elseTag: frame.elseTag,
          closeTag: tag,
          truthy: frame.truthy,
          falsy: frame.falsy,
        });
      }
    }

    cursor = directive.end;
    index = text.indexOf("{{", cursor);
  }

  if (cursor < text.length) {
    appendNode(root, stack, { type: "text", text: text.slice(cursor) });
  }

  for (let frame = stack.pop(); frame; frame = stack.pop()) {
    if (frame.header?.type === "st" && !frame.malformed) {
      warn(`Closed an unclosed SillyTavern conditional at the end of its node: ${frame.openTag}`);
      appendNode(root, stack, {
        ...frame.header,
        openTag: frame.openTag,
        elseTag: frame.elseTag,
        closeTag: "",
        truthy: frame.truthy,
        falsy: frame.falsy,
      });
    } else {
      warn(`Omitted unclosed prompt conditional: ${frame.openTag}`);
    }
  }

  return root;
}

function reemitBlock(block: ConditionalBlock, truthy: string, falsy: string): string {
  return `${block.openTag}${truthy}${block.elseTag}${falsy}${block.closeTag}`;
}

async function renderNodes(nodes: PromptConditionalNode[], options: PromptConditionalRenderOptions): Promise<string> {
  let output = "";
  // An emptied paragraph drops its following separator so adjacent blank lines do not stack.
  let dropLeadingBlankLine = false;

  for (const node of nodes) {
    if (node.type === "text") {
      output += dropLeadingBlankLine ? node.text.replace(LEADING_BLANK_LINE, "") : node.text;
      dropLeadingBlankLine = false;
      continue;
    }

    if (node.type === "st") {
      output += reemitBlock(node, await renderNodes(node.truthy, options), await renderNodes(node.falsy, options));
      dropLeadingBlankLine = false;
      continue;
    }

    const evaluated = await options.evaluate(node.predicate);
    if (evaluated === undefined) {
      options.warn(`Unknown prompt condition: ${node.rawCondition}`);
    }
    const matches = evaluated === undefined ? false : node.predicate.inverted ? !evaluated : evaluated;
    const branch = await renderNodes(matches ? node.truthy : node.falsy, options);
    output += branch;
    dropLeadingBlankLine = branch === "" && ENDS_WITH_BLANK_LINE.test(output);
  }

  return output;
}

function renderStNodes(nodes: PromptConditionalNode[], options: StConditionalRenderOptions): string {
  let output = "";
  let dropLeadingBlankLine = false;

  for (const node of nodes) {
    if (node.type === "text") {
      const text = options.transformText?.(node.text) ?? node.text;
      output += dropLeadingBlankLine ? text.replace(LEADING_BLANK_LINE, "") : text;
      dropLeadingBlankLine = false;
      continue;
    }

    if (node.type === "tomori") {
      output += reemitBlock(node, renderStNodes(node.truthy, options), renderStNodes(node.falsy, options));
      dropLeadingBlankLine = false;
      continue;
    }

    const resolved = options.resolveCondition(node.condition).trim().toLowerCase();
    const matches = !FALSY_ST_CONDITION_VALUES.has(resolved) !== node.unless;
    const branch = renderStNodes(matches ? node.truthy : node.falsy, options);
    output += branch;
    dropLeadingBlankLine = branch === "" && ENDS_WITH_BLANK_LINE.test(output);
  }

  return output;
}

function flattenNodes(nodes: PromptConditionalNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text;
      const condition = node.type === "st" ? ` ${node.condition} ` : "";
      return `${condition}${flattenNodes(node.truthy)}${flattenNodes(node.falsy)}`;
    })
    .join("");
}

export async function renderPromptConditionals(text: string, options: PromptConditionalRenderOptions): Promise<string> {
  if (!text || !TOMORI_DIRECTIVE_REGEX.test(text)) {
    return text;
  }

  const nodes = parseConditionalNodes(text, options.warn);
  return nodes ? renderNodes(nodes, options) : text;
}

export function renderStConditionals(text: string, options: StConditionalRenderOptions): string {
  if (!text || (!ST_DIRECTIVE_REGEX.test(text) && !TOMORI_DIRECTIVE_REGEX.test(text))) {
    return options.transformText?.(text) ?? text;
  }
  const nodes = parseConditionalNodes(text, options.warn);
  return nodes ? renderStNodes(nodes, options) : text;
}

export function flattenConditionals(text: string, warn: (message: string) => void): string {
  const nodes = parseConditionalNodes(text, warn);
  return nodes ? flattenNodes(nodes) : text;
}
