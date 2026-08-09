type PromptConditionNamespace = "capability" | "tool";

export interface PromptConditionPredicate {
  namespace: PromptConditionNamespace;
  name: string;
  inverted: boolean;
}

type PromptConditionalNode =
  | { type: "text"; text: string }
  | {
      type: "conditional";
      rawCondition: string;
      predicate: PromptConditionPredicate;
      truthy: PromptConditionalNode[];
      falsy: PromptConditionalNode[];
    };

interface ConditionalFrame {
  rawCondition: string;
  predicate: PromptConditionPredicate | null;
  truthy: PromptConditionalNode[];
  falsy: PromptConditionalNode[];
  activeBranch: "truthy" | "falsy";
  malformed: boolean;
}

export interface PromptConditionalRenderOptions {
  evaluate(predicate: PromptConditionPredicate): Promise<boolean | undefined> | boolean | undefined;
  warn(message: string): void;
}

const CONDITIONAL_DIRECTIVE_REGEX = /\{\{\s*(\/?if\b[^{}]*|else\b[^{}]*)\s*\}\}/gi;
const CONDITION_REGEX = /^(!)?(capability|tool):([a-z0-9][a-z0-9_.-]*)$/i;

function parsePredicate(rawCondition: string): PromptConditionPredicate | null {
  const match = rawCondition.trim().match(CONDITION_REGEX);
  if (!match) return null;

  return {
    namespace: match[2].toLowerCase() as PromptConditionNamespace,
    name: match[3].toLowerCase(),
    inverted: match[1] === "!",
  };
}

function appendNode(root: PromptConditionalNode[], stack: ConditionalFrame[], node: PromptConditionalNode): void {
  const frame = stack.at(-1);
  if (!frame) {
    root.push(node);
    return;
  }

  frame[frame.activeBranch].push(node);
}

function parseConditionalNodes(text: string, warn: (message: string) => void): PromptConditionalNode[] {
  const root: PromptConditionalNode[] = [];
  const stack: ConditionalFrame[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CONDITIONAL_DIRECTIVE_REGEX)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      appendNode(root, stack, { type: "text", text: text.slice(cursor, index) });
    }

    const directive = match[1].trim();
    const lowerDirective = directive.toLowerCase();

    if (lowerDirective.startsWith("if")) {
      const rawCondition = directive.slice(2).trim();
      stack.push({
        rawCondition,
        predicate: parsePredicate(rawCondition),
        truthy: [],
        falsy: [],
        activeBranch: "truthy",
        malformed: rawCondition.length === 0,
      });
    } else if (lowerDirective.startsWith("else")) {
      const frame = stack.at(-1);
      if (!frame) {
        warn("Found {{else}} without a matching {{if}} block");
      } else if (lowerDirective !== "else" || frame.activeBranch === "falsy") {
        frame.malformed = true;
      } else {
        frame.activeBranch = "falsy";
      }
    } else {
      const frame = stack.pop();
      if (!frame) {
        warn("Found {{/if}} without a matching {{if}} block");
      } else if (lowerDirective !== "/if" || frame.malformed || !frame.predicate) {
        warn(`Omitted malformed prompt conditional: {{if ${frame.rawCondition}}}`);
      } else {
        appendNode(root, stack, {
          type: "conditional",
          rawCondition: frame.rawCondition,
          predicate: frame.predicate,
          truthy: frame.truthy,
          falsy: frame.falsy,
        });
      }
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    appendNode(root, stack, { type: "text", text: text.slice(cursor) });
  }

  for (const frame of stack) {
    warn(`Omitted unclosed prompt conditional: {{if ${frame.rawCondition}}}`);
  }

  return root;
}

async function renderNodes(nodes: PromptConditionalNode[], options: PromptConditionalRenderOptions): Promise<string> {
  const rendered: string[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      rendered.push(node.text);
      continue;
    }

    const evaluated = await options.evaluate(node.predicate);
    if (evaluated === undefined) {
      options.warn(`Unknown prompt condition: ${node.rawCondition}`);
    }
    const matches = evaluated === undefined ? false : node.predicate.inverted ? !evaluated : evaluated;
    rendered.push(await renderNodes(matches ? node.truthy : node.falsy, options));
  }

  return rendered.join("");
}

/**
 * Renders TomoriBot's scoped prompt conditionals while preserving selected branch text verbatim.
 */
export async function renderPromptConditionals(text: string, options: PromptConditionalRenderOptions): Promise<string> {
  if (!text || /\{\{\s*#if\b/i.test(text) || !/\{\{\s*(?:\/?if\b|else\b)/i.test(text)) {
    return text;
  }

  return renderNodes(parseConditionalNodes(text, options.warn), options);
}
