import * as ts from "typescript";
import { isEnvName, roleForPath } from "./policy";
import type { Fallback, ReadKind, ScanResult, SourceFile } from "./types";

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

interface ForwardEdge {
  caller: string;
  callerIndex: number;
  callee: string;
  calleeIndex: number;
}

const TRANSPARENT_METHODS = new Set(["trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase"]);
const CHAIN_OPERATORS = new Set([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken]);
const TRUTHY_LITERALS = new Set(["true", "1", "yes", "on"]);
const FALSY_LITERALS = new Set(["false", "0", "no", "off"]);
const ITERATOR_METHODS = new Set(["forEach", "map", "filter", "some", "every", "flatMap"]);
const VALUE_PARSER_PATTERN = /^(parse|read|resolve|get|to|coerce)[A-Z]/;
/** Their second argument is a radix, not a default. */
const RADIX_PARSERS = new Set(["parseInt", "parseFloat"]);

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parse(file: SourceFile): ts.SourceFile {
  return ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKindFor(file.path));
}

/** Matches `process.env`, `Bun.env`, and `import.meta.env`. */
function isEnvObject(node: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "env") {
    return false;
  }
  const target = node.expression;
  if (ts.isIdentifier(target)) {
    return target.text === "process" || target.text === "Bun";
  }
  return ts.isMetaProperty(target);
}

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function functionName(fn: FunctionLike): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name && ts.isIdentifier(fn.name)) {
    return fn.name.text;
  }
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
}

/** Finds the nearest enclosing function that declares `name` as a parameter. */
function owningFunction(node: ts.Node, name: string): { fn: FunctionLike; index: number } | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (isFunctionLike(current)) {
      const index = current.parameters.findIndex((param) => ts.isIdentifier(param.name) && param.name.text === name);
      if (index >= 0) {
        return { fn: current, index };
      }
    }
  }
  return undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

function stringValue(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text;
  }
  return undefined;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Env-name helpers keyed by file. A call resolves to the caller file's own function when it
 * declares one with that name, so a local value parser cannot be mistaken for a same-named name
 * helper defined elsewhere.
 */
export class HelperRegistry {
  private readonly byKey = new Map<string, number>();
  private readonly byName = new Map<string, number>();
  private readonly declared = new Map<string, Set<string>>();

  declare(file: string, name: string): void {
    const names = this.declared.get(file) ?? new Set<string>();
    names.add(name);
    this.declared.set(file, names);
  }

  resolveKey(file: string, name: string): string {
    return this.declared.get(file)?.has(name) ? `${file}::${name}` : `*::${name}`;
  }

  add(file: string, name: string, index: number): boolean {
    const key = `${file}::${name}`;
    if (this.byKey.has(key)) return false;
    this.byKey.set(key, index);
    if (!this.byName.has(name)) this.byName.set(name, index);
    return true;
  }

  /** Returns the name-parameter index when `name`, as seen from `file`, is an env helper. */
  indexFor(file: string, name: string): number | undefined {
    const key = this.resolveKey(file, name);
    return key.startsWith("*::") ? this.byName.get(name) : this.byKey.get(key);
  }
}

/**
 * Collects helper functions: any named function whose parameter reaches an env index, directly
 * or by forwarding into another helper's name parameter. Solved to a fixpoint across all files
 * because helpers are commonly defined in one module and wrapped in another.
 */
export function discoverHelpers(parsed: ts.SourceFile[]): HelperRegistry {
  const registry = new HelperRegistry();
  const edges: (ForwardEdge & { file: string })[] = [];

  for (const sourceFile of parsed) {
    const file = sourceFile.fileName;
    const declareNames = (node: ts.Node): void => {
      if (isFunctionLike(node)) {
        const name = functionName(node);
        if (name) registry.declare(file, name);
      }
      ts.forEachChild(node, declareNames);
    };
    declareNames(sourceFile);

    const visit = (node: ts.Node): void => {
      if (ts.isElementAccessExpression(node) && isEnvObject(node.expression) && !isWrite(node)) {
        const argument = unwrapExpression(node.argumentExpression);
        if (ts.isIdentifier(argument)) {
          const owner = owningFunction(node, argument.text);
          const name = owner && functionName(owner.fn);
          if (owner && name) registry.add(file, name, owner.index);
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = calleeName(node);
        if (callee) {
          node.arguments.forEach((arg, calleeIndex) => {
            const unwrapped = unwrapExpression(arg);
            if (!ts.isIdentifier(unwrapped)) return;
            const owner = owningFunction(node, unwrapped.text);
            const caller = owner && functionName(owner.fn);
            if (owner && caller && caller !== callee) {
              edges.push({ file, caller, callerIndex: owner.index, callee, calleeIndex });
            }
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (
        registry.indexFor(edge.file, edge.callee) === edge.calleeIndex &&
        registry.add(edge.file, edge.caller, edge.callerIndex)
      ) {
        changed = true;
      }
    }
  }
  return registry;
}

interface FileConstants {
  strings: Map<string, string>;
  literals: Map<string, string>;
  arrays: Map<string, string[]>;
}

function collectConstants(sourceFile: ts.SourceFile): FileConstants {
  const constants: FileConstants = { strings: new Map(), literals: new Map(), arrays: new Map() };
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const initializer = unwrapExpression(node.initializer);
      const text = stringValue(initializer);
      if (text !== undefined) {
        constants.strings.set(node.name.text, text);
      }
      if (ts.isArrayLiteralExpression(initializer)) {
        const values = initializer.elements.map((element) => stringValue(unwrapExpression(element as ts.Expression)));
        if (values.length > 0 && values.every((value): value is string => value !== undefined)) {
          constants.arrays.set(node.name.text, values);
        }
      }
      const literal = evaluateLiteral(initializer, constants);
      if (literal !== undefined) {
        constants.literals.set(node.name.text, literal);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constants;
}

/** Evaluates a literal or simple arithmetic default. Returns undefined for anything else. */
function evaluateLiteral(node: ts.Expression, constants: FileConstants): string | undefined {
  const expression = unwrapExpression(node);
  const text = stringValue(expression);
  if (text !== undefined) return text;
  if (ts.isNumericLiteral(expression)) return String(Number(expression.text.replaceAll("_", "")));
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken) {
    const operand = evaluateLiteral(expression.operand, constants);
    return operand !== undefined && Number.isFinite(Number(operand)) ? String(-Number(operand)) : undefined;
  }
  if (ts.isIdentifier(expression)) {
    return constants.literals.get(expression.text);
  }
  if (ts.isBinaryExpression(expression)) {
    const left = Number(evaluateLiteral(expression.left, constants));
    const right = Number(evaluateLiteral(expression.right, constants));
    if (!Number.isFinite(left) || !Number.isFinite(right)) return undefined;
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.AsteriskToken:
        return String(left * right);
      case ts.SyntaxKind.PlusToken:
        return String(left + right);
      case ts.SyntaxKind.MinusToken:
        return String(left - right);
      case ts.SyntaxKind.SlashToken:
        return String(left / right);
      default:
        return undefined;
    }
  }
  return undefined;
}

function fallbackFrom(node: ts.Expression, constants: FileConstants): Fallback {
  const value = evaluateLiteral(node, constants);
  if (value !== undefined) return { value };
  return { unrecoverable: unwrapExpression(node).getText().replace(/\s+/g, " ").slice(0, 60) };
}

/**
 * Climbs from a read through wrappers that keep its value (parentheses, `!`, casts, and string
 * normalizers such as `.trim()`), so the caller can inspect the operator that actually decides
 * the fallback.
 */
function climbTransparent(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;
  for (;;) {
    const parent = current.parent;
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === current &&
      TRANSPARENT_METHODS.has(parent.name.text) &&
      ts.isCallExpression(parent.parent) &&
      parent.parent.expression === parent
    ) {
      current = parent.parent;
      continue;
    }
    return current;
  }
}

function isChainBinary(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && CHAIN_OPERATORS.has(node.operatorToken.kind);
}

function flattenChain(node: ts.Expression, operands: ts.Expression[]): void {
  const expression = unwrapExpression(node);
  if (isChainBinary(expression)) {
    flattenChain(expression.left, operands);
    flattenChain(expression.right, operands);
    return;
  }
  operands.push(node);
}

interface PendingRead {
  names: string[];
  kind: ReadKind;
  helper?: string;
  node: ts.Expression;
  ownFallback?: Fallback;
}

/**
 * Scans TypeScript and JavaScript files. Reads are recognized through the env object, through any
 * helper found by {@link discoverHelpers}, and through same-file constants; every other string
 * that looks like a declared name is kept as a literal reference, which blocks a dead verdict
 * without being counted as proof of a read.
 */
export function scanTypeScript(files: SourceFile[]): ScanResult {
  const result: ScanResult = {
    consumers: [],
    declarations: [],
    dynamicPatterns: [],
    unresolved: [],
    aliases: [],
    parseFailures: [],
  };
  const parsed = files.map(parse);
  const helpers = discoverHelpers(parsed);

  parsed.forEach((sourceFile, fileIndex) => {
    const file = files[fileIndex];
    const role = roleForPath(file.path, "typescript");
    const constants = collectConstants(sourceFile);
    const lineOf = (node: ts.Node): number =>
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const location = (node: ts.Node) => ({
      file: file.path,
      line: lineOf(node),
      ...(file.origin ? { origin: file.origin } : {}),
    });
    const claimedLiterals = new Set<ts.Node>();

    // The TypeScript parser recovers from syntax errors silently; this internal list is the only
    // signal that part of a file may not have been read.
    const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
    if (parseDiagnostics && parseDiagnostics.length > 0) {
      result.parseFailures.push({ file: file.path, line: 1 });
    }

    const resolveNameExpression = (
      expression: ts.Expression,
      site: ts.Node,
    ): { names: string[]; kind: ReadKind } | "helper-body" | "dynamic" | "unresolved" => {
      const unwrapped = unwrapExpression(expression);
      const literal = stringValue(unwrapped);
      if (literal !== undefined) {
        claimedLiterals.add(unwrapped);
        return { names: [literal], kind: "direct" };
      }
      if (ts.isTemplateExpression(unwrapped)) {
        const suffix = unwrapped.templateSpans.length === 1 ? unwrapped.templateSpans[0].literal.text : "";
        result.dynamicPatterns.push({
          ...location(site),
          prefix: unwrapped.head.text,
          suffix,
          language: "typescript",
          role,
        });
        return "dynamic";
      }
      if (ts.isIdentifier(unwrapped)) {
        const owner = owningFunction(site, unwrapped.text);
        const ownerName = owner && functionName(owner.fn);
        if (owner && ownerName && helpers.indexFor(file.path, ownerName) === owner.index) {
          return "helper-body";
        }
        const constant = constants.strings.get(unwrapped.text);
        if (constant !== undefined) {
          return { names: [constant], kind: "constant" };
        }
        const iterated = resolveIteratedConstant(unwrapped, site, constants);
        if (iterated) {
          return { names: iterated, kind: "constant" };
        }
      }
      return "unresolved";
    };

    const chainOperands = new Set<ts.Node>();
    const recordUnresolved = (node: ts.Node, expression: ts.Node): void => {
      result.unresolved.push({
        ...location(node),
        language: "typescript",
        role,
        expression: expression.getText(sourceFile).slice(0, 80),
      });
    };

    const collectRead = (node: ts.Node): PendingRead | undefined => {
      if (ts.isPropertyAccessExpression(node) && isEnvObject(node.expression)) {
        return isEnvName(node.name.text) ? { names: [node.name.text], kind: "direct", node } : undefined;
      }
      if (ts.isElementAccessExpression(node) && isEnvObject(node.expression)) {
        const resolved = resolveNameExpression(node.argumentExpression, node);
        if (resolved === "helper-body" || resolved === "dynamic") return undefined;
        if (resolved === "unresolved") {
          if (!isWrite(node)) recordUnresolved(node, node.argumentExpression);
          return undefined;
        }
        return { names: resolved.names.filter(isEnvName), kind: resolved.kind, node };
      }
      if (ts.isCallExpression(node)) {
        const callee = calleeName(node);
        const index = callee === undefined ? undefined : helpers.indexFor(file.path, callee);
        if (callee === undefined || index === undefined || node.arguments.length <= index) return undefined;
        const nameArgument = unwrapExpression(node.arguments[index]);
        // Anything but a string, template, or identifier means this call reaches a different
        // function that shares the helper's name, such as a parser handed the value itself.
        if (
          stringValue(nameArgument) === undefined &&
          !ts.isTemplateExpression(nameArgument) &&
          !ts.isIdentifier(nameArgument)
        ) {
          return undefined;
        }
        const resolved = resolveNameExpression(nameArgument, node);
        if (resolved === "helper-body" || resolved === "dynamic") return undefined;
        if (resolved === "unresolved") {
          recordUnresolved(node, node.arguments[index]);
          return undefined;
        }
        const next = node.arguments[index + 1];
        const ownFallback =
          next && !ts.isArrayLiteralExpression(next) && !ts.isObjectLiteralExpression(next) && !isFunctionLike(next)
            ? fallbackFrom(next, constants)
            : undefined;
        return {
          names: resolved.names.filter(isEnvName),
          kind: resolved.kind === "direct" ? "helper" : resolved.kind,
          helper: callee,
          node,
          ...(ownFallback ? { ownFallback } : {}),
        };
      }
      return undefined;
    };

    const emit = (read: PendingRead, fallback: Fallback | undefined): void => {
      for (const name of read.names) {
        result.consumers.push({
          ...location(read.node),
          name,
          language: "typescript",
          role,
          kind: read.kind,
          ...(read.helper ? { helper: read.helper } : {}),
          ...(fallback ? { fallback } : {}),
        });
      }
    };

    const visit = (node: ts.Node): void => {
      if (isChainBinary(node) && !isChainBinary(climbTransparentParent(node))) {
        handleChain(node);
      }
      if (!chainOperands.has(node)) {
        const read = collectRead(node);
        if (read && read.names.length > 0 && !isWrite(node)) {
          const context = contextFallback(read.node as ts.Expression);
          emit(
            read.helper || !context.helper ? read : { ...read, helper: context.helper },
            preferGuardDefault(read.ownFallback ?? context.fallback, read.node, constants),
          );
        }
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (!claimedLiterals.has(node) && isEnvName(node.text) && !ts.isImportDeclaration(node.parent)) {
          result.consumers.push({
            ...location(node),
            name: node.text,
            language: "typescript",
            role,
            kind: "literal-reference",
          });
        }
      }
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && isEnvName(node.name.text)) {
        result.consumers.push({
          ...location(node),
          name: node.name.text,
          language: "typescript",
          role,
          kind: "literal-reference",
        });
      }
      ts.forEachChild(node, visit);
    };

    /**
     * A `??` or `||` chain resolves every env read in it to the same trailing fallback, and two or
     * more distinct names in one chain are aliases feeding a single setting.
     */
    const handleChain = (top: ts.BinaryExpression): void => {
      const operands: ts.Expression[] = [];
      flattenChain(top, operands);
      const reads: PendingRead[] = [];
      for (const operand of operands) {
        const candidate = unwrapReadOperand(operand);
        chainOperands.add(candidate);
        const read = collectRead(candidate);
        if (read && read.names.length > 0) {
          reads.push(read);
        }
      }
      if (reads.length === 0) return;
      if (isBooleanContext(top)) {
        for (const read of reads) emit(read, read.ownFallback);
        return;
      }
      const last = operands[operands.length - 1];
      const lastIsRead = reads.some((read) => read.node === unwrapReadOperand(last));
      const chainFallback = lastIsRead ? contextFallback(top).fallback : fallbackFrom(last, constants);
      for (const read of reads) {
        emit(read, preferGuardDefault(read.ownFallback ?? chainFallback, read.node, constants));
      }
      const names = [...new Set(reads.flatMap((read) => read.names))];
      if (names.length > 1) {
        result.aliases.push({ ...location(top), names, language: "typescript" });
      }
    };

    /**
     * Recovers a fallback from what surrounds a read: `??=`, a comparison with a boolean literal,
     * or a value parser such as `parseIntegerEnv(process.env.X, 80)` whose next argument is the
     * default.
     */
    const contextFallback = (read: ts.Expression): { fallback?: Fallback; helper?: string } => {
      const outer = climbTransparent(read);
      const parent = outer.parent;
      if (ts.isCallExpression(parent) && parent.expression !== outer) {
        const callee = calleeName(parent);
        const position = parent.arguments.indexOf(outer);
        const next = parent.arguments[position + 1];
        if (callee && VALUE_PARSER_PATTERN.test(callee) && !RADIX_PARSERS.has(callee) && next) {
          const value = evaluateLiteral(next, constants);
          return value === undefined ? { helper: callee } : { fallback: { value }, helper: callee };
        }
        return {};
      }
      if (!ts.isBinaryExpression(parent)) return {};
      const operator = parent.operatorToken.kind;
      if (
        (operator === ts.SyntaxKind.QuestionQuestionEqualsToken || operator === ts.SyntaxKind.BarBarEqualsToken) &&
        parent.left === outer
      ) {
        return { fallback: fallbackFrom(parent.right, constants) };
      }
      const isEquality =
        operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        operator === ts.SyntaxKind.EqualsEqualsToken ||
        operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        operator === ts.SyntaxKind.ExclamationEqualsToken;
      if (!isEquality) return {};
      const other = stringValue(unwrapExpression(parent.left === outer ? parent.right : parent.left));
      if (other === undefined) return {};
      if (TRUTHY_LITERALS.has(other.toLowerCase())) return { fallback: { value: "false" } };
      if (FALSY_LITERALS.has(other.toLowerCase())) return { fallback: { value: "true" } };
      return {};
    };

    visit(sourceFile);
  });

  return result;
}

/**
 * Recovers the `if (!raw) return DEFAULT_X;` idiom: in a function that reads exactly one env name,
 * a single distinct `return DEFAULT_*` resolving to a same-file literal is that name's fallback.
 * More than one read or more than one default value leaves the fallback unrecovered.
 */
function guardReturnFallback(read: ts.Node, constants: FileConstants): Fallback | undefined {
  let owner: ts.Node | undefined = read.parent;
  while (owner && !isFunctionLike(owner)) owner = owner.parent;
  if (!owner || !isFunctionLike(owner) || !owner.body) return undefined;

  const envNames = new Set<string>();
  const defaults = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== owner && isFunctionLike(node)) return;
    if (ts.isPropertyAccessExpression(node) && isEnvObject(node.expression)) envNames.add(node.name.text);
    if (ts.isElementAccessExpression(node) && isEnvObject(node.expression))
      envNames.add(node.argumentExpression.getText());
    if (ts.isReturnStatement(node) && node.expression) {
      const returned = unwrapExpression(node.expression);
      if (ts.isIdentifier(returned) && returned.text.startsWith("DEFAULT_")) {
        const value = constants.literals.get(returned.text);
        if (value !== undefined) defaults.add(value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner.body);
  return envNames.size === 1 && defaults.size === 1 ? { value: [...defaults][0] } : undefined;
}

/**
 * True when a chain's value is only tested for truthiness, as in `!!(A || B)`. Such a chain asks
 * whether any name is set, so its names are not aliases for one setting.
 */
function isBooleanContext(chain: ts.Node): boolean {
  let node: ts.Node = chain;
  while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
  const parent = node.parent;
  if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) return true;
  if ((ts.isIfStatement(parent) || ts.isWhileStatement(parent)) && parent.expression === node) return true;
  if (ts.isConditionalExpression(parent) && parent.condition === node) return true;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return true;
  return ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "Boolean";
}

/** `?? ""` only normalizes unset to empty, so a guard-return default is the more meaningful fallback. */
function preferGuardDefault(
  fallback: Fallback | undefined,
  read: ts.Node,
  constants: FileConstants,
): Fallback | undefined {
  if (fallback && !("value" in fallback && fallback.value === "")) return fallback;
  return guardReturnFallback(read, constants) ?? fallback;
}

function climbTransparentParent(node: ts.Node): ts.Node {
  let parent = node.parent;
  while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return parent;
}

/** Strips wrappers and string normalizers from a chain operand so the read node itself is compared. */
function unwrapReadOperand(node: ts.Expression): ts.Expression {
  let current = unwrapExpression(node);
  while (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    TRANSPARENT_METHODS.has(current.expression.name.text)
  ) {
    current = unwrapExpression(current.expression.expression);
  }
  return current;
}

function isWrite(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isDeleteExpression(parent)) return true;
  return (
    ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

/**
 * Resolves `key` in `for (const key of NAMES)` and `NAMES.forEach((key) => …)` when `NAMES` is a
 * same-file constant array of strings, which is how several modules copy or clear a fixed set of
 * variables.
 */
function resolveIteratedConstant(
  identifier: ts.Identifier,
  site: ts.Node,
  constants: FileConstants,
): string[] | undefined {
  const arrayOf = (expression: ts.Expression): string[] | undefined => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) return constants.arrays.get(unwrapped.text);
    if (ts.isArrayLiteralExpression(unwrapped)) {
      const values = unwrapped.elements.map((element) => stringValue(unwrapExpression(element as ts.Expression)));
      return values.every((value): value is string => value !== undefined) ? values : undefined;
    }
    return undefined;
  };

  for (let current = site.parent; current; current = current.parent) {
    if (ts.isForOfStatement(current) && ts.isVariableDeclarationList(current.initializer)) {
      const declared = current.initializer.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === identifier.text,
      );
      if (declared) return arrayOf(current.expression);
    }
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && current.parameters.length > 0) {
      const first = current.parameters[0];
      if (ts.isIdentifier(first.name) && first.name.text === identifier.text) {
        const call = current.parent;
        if (
          ts.isCallExpression(call) &&
          ts.isPropertyAccessExpression(call.expression) &&
          ITERATOR_METHODS.has(call.expression.name.text)
        ) {
          return arrayOf(call.expression.expression);
        }
        return undefined;
      }
    }
  }
  return undefined;
}
