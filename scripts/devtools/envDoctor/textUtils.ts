import { isEnvName, roleForPath } from "./policy";
import type { ConsumerRole, Fallback, ScanLanguage, ScanResult, SourceFile } from "./types";

export function emptyScanResult(): ScanResult {
  return { consumers: [], declarations: [], dynamicPatterns: [], unresolved: [], aliases: [], parseFailures: [] };
}

/** Returns a function mapping a character offset to its 1-based line number. */
export function lineIndexer(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

export function originOf(file: SourceFile): { origin?: string } {
  return file.origin ? { origin: file.origin } : {};
}

export function stripQuotes(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Blanks comments while preserving every offset, so later matches still report the right line.
 * Quote tracking keeps a `#` inside a string (a color, a URL fragment) from hiding the rest of the
 * line. With `hashNeedsSpace`, a `#` only starts a comment after whitespace, as in shell and YAML,
 * where `${#NAME}` and `a#b` are not comments.
 */
export function blankHashComments(text: string, options: { tripleQuotes: boolean; hashNeedsSpace: boolean }): string {
  const chars = [...text];
  let quote: string | null = null;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (quote) {
      if (char === "\\" && quote.length === 1) {
        i++;
        continue;
      }
      if (quote.length === 3 ? chars.slice(i, i + 3).join("") === quote : char === quote) {
        i += quote.length - 1;
        quote = null;
      } else if (quote.length === 1 && char === "\n") {
        quote = null;
      }
      continue;
    }
    const triple = chars.slice(i, i + 3).join("");
    if (options.tripleQuotes && (triple === '"""' || triple === "'''")) {
      quote = triple;
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#") {
      const previous = i === 0 ? "\n" : chars[i - 1];
      if (options.hashNeedsSpace && !/\s/.test(previous)) continue;
      while (i < chars.length && chars[i] !== "\n") {
        chars[i] = " ";
        i++;
      }
    }
  }
  return chars.join("");
}

/** Splits a call's argument list starting at its `(`, honoring nesting and quotes. */
export function splitArguments(text: string, openIndex: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = openIndex + 1;
  for (let i = openIndex + 1; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) {
      if (depth === 0) {
        if (text.slice(start, i).trim().length > 0) args.push(text.slice(start, i));
        return { args, end: i + 1 };
      }
      depth--;
    } else if (char === "," && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return { args, end: text.length };
}

/** Evaluates `10 * 1024 * 1024` style defaults without executing code. */
export function evaluateArithmetic(expression: string): string | undefined {
  const cleaned = expression.replaceAll("_", "").trim();
  if (!/^[\d.\s*+\-/()]+$/.test(cleaned) || !/\d/.test(cleaned)) return undefined;
  const tokens = cleaned.match(/\d+(?:\.\d+)?|[*+\-/()]/g) ?? [];
  let position = 0;
  const parseFactor = (): number => {
    const token = tokens[position++];
    if (token === "(") {
      const value = parseSum();
      position++;
      return value;
    }
    if (token === "-") return -parseFactor();
    return Number(token);
  };
  const parseProduct = (): number => {
    let value = parseFactor();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++];
      const right = parseFactor();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const parseSum = (): number => {
    let value = parseProduct();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = parseProduct();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const value = parseSum();
  return Number.isFinite(value) && position === tokens.length ? String(value) : undefined;
}

export interface Expansion {
  name: string;
  index: number;
  raw: string;
  fallback?: Fallback;
  hasDefaultOperator: boolean;
  /** Name whose expansion is the entire default, as in `${A:-${B}}`. */
  aliasOf?: string;
}

/**
 * Finds `${NAME...}` and `$NAME` expansions, including ones nested in a default. A default that
 * is exactly another expansion (`${A:-${B:-x}}`) makes the two names aliases; a default that
 * merely contains one (`${A:-${DIR}/x}`) does not, and its value is reported as unrecoverable.
 */
export function findExpansions(text: string, options: { dollarEscape: boolean }): Expansion[] {
  const expansions: Expansion[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "$") continue;
    if (options.dollarEscape && text[i + 1] === "$") {
      i++;
      continue;
    }
    if (text[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      for (; j < text.length && depth > 0; j++) {
        if (text[j] === "{" && text[j - 1] === "$") depth++;
        else if (text[j] === "}") depth--;
      }
      const raw = text.slice(i, j);
      const parsed = /^#?([A-Za-z_][A-Za-z0-9_]*)(.*)$/s.exec(text.slice(i + 2, j - 1));
      if (parsed) {
        const operator = /^(:?[-=?+])(.*)$/s.exec(parsed[2]);
        const hasDefaultOperator = operator !== null && /^:?[-=]$/.test(operator[1]);
        const defaultText = hasDefaultOperator && operator ? operator[2].trim() : undefined;
        const nested = defaultText ? findExpansions(defaultText, options) : [];
        let fallback: Fallback | undefined;
        let aliasOf: string | undefined;
        if (defaultText !== undefined) {
          if (nested.length > 0 && nested[0].raw === defaultText) {
            aliasOf = nested[0].name;
            fallback = nested[0].fallback;
          } else if (nested.length > 0) {
            fallback = { unrecoverable: defaultText.slice(0, 60) };
          } else {
            fallback = { value: stripQuotes(defaultText) };
          }
        }
        expansions.push({
          name: parsed[1],
          index: i,
          raw,
          hasDefaultOperator,
          ...(fallback ? { fallback } : {}),
          ...(aliasOf ? { aliasOf } : {}),
        });
        for (const inner of nested) expansions.push({ ...inner, index: i });
      }
      i = j - 1;
      continue;
    }
    const simple = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i + 1, i + 200));
    if (simple) {
      expansions.push({ name: simple[0], index: i, raw: `$${simple[0]}`, hasDefaultOperator: false });
      i += simple[0].length;
    }
  }
  return expansions;
}

/** Converts expansions into interpolation consumers and alias sites. */
export function pushExpansions(
  expansions: Expansion[],
  lineOf: (offset: number) => number,
  file: SourceFile,
  language: ScanLanguage,
  result: ScanResult,
  include: (expansion: Expansion) => boolean = () => true,
): void {
  const role = roleForPath(file.path, language);
  for (const expansion of expansions) {
    if (!isEnvName(expansion.name) || !include(expansion)) continue;
    const line = lineOf(expansion.index);
    result.consumers.push({
      file: file.path,
      line,
      ...originOf(file),
      name: expansion.name,
      language,
      role,
      kind: "interpolation",
      ...(expansion.fallback ? { fallback: expansion.fallback } : {}),
    });
    if (expansion.aliasOf) {
      result.aliases.push({
        file: file.path,
        line,
        ...originOf(file),
        names: [expansion.name, expansion.aliasOf],
        language,
      });
    }
  }
}

/**
 * Records quoted env-shaped strings not already read in the same file. The analyzer keeps only
 * those matching a known variable, so a literal can hold a variable open but never invent one.
 */
export function collectStringLiterals(
  text: string,
  file: SourceFile,
  language: ScanLanguage,
  role: ConsumerRole,
  result: ScanResult,
  alreadyRead: Set<string>,
): void {
  const lineOf = lineIndexer(text);
  for (const match of text.matchAll(/["']([A-Z][A-Z0-9_]+)["']/g)) {
    const name = match[1];
    if (!isEnvName(name) || alreadyRead.has(name)) continue;
    result.consumers.push({
      file: file.path,
      line: lineOf(match.index ?? 0),
      ...originOf(file),
      name,
      language,
      role,
      kind: "literal-reference",
    });
  }
}
