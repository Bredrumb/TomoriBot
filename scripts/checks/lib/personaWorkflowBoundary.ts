import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { ts } from "ts-morph";

const LOW_LEVEL_PICKER = "replyPaginatedPersonaChoicesV2";
const COMPETING_PERSONA_HELPER = "selectConditioningPersona";
const PRESERVE_SELECTED_INTERACTION = "preserveSelectedInteraction";
const PICKER_ON_SELECT = "onSelect";

export const INTERNAL_PERSONA_WORKFLOW_PATHS = new Map<string, string>([
  ["src/utils/discord/ui/interactionCore.ts", "low-level Discord interaction primitive"],
  ["src/utils/discord/ui/personaWorkflow.ts", "command-facing persona workflow implementation"],
]);

export const PERSONA_WORKFLOW_AUDIT_DIRS = ["src"] as const;

export const PERSONA_WORKFLOW_REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

export type PersonaWorkflowViolationKind =
  | "low-level-picker-import"
  | "low-level-picker-call"
  | "low-level-picker-reference"
  | "preserved-selected-interaction"
  | "empty-picker-on-select"
  | "self-acknowledging-on-selected"
  | "competing-persona-helper";

export interface PersonaWorkflowBoundaryViolation {
  file: string;
  line: number;
  column: number;
  kind: PersonaWorkflowViolationKind;
  symbol: string;
  message: string;
}

export interface PersonaWorkflowBoundaryAuditResult {
  violations: PersonaWorkflowBoundaryViolation[];
  scannedFiles: number;
}

export function normalizePersonaWorkflowPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }

  return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isEmptyFunction(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isArrowFunction(unwrapped) && !ts.isFunctionExpression(unwrapped)) return false;
  return ts.isBlock(unwrapped.body) && unwrapped.body.statements.length === 0;
}

function isTrueLiteral(expression: ts.Expression): boolean {
  return unwrapExpression(expression).kind === ts.SyntaxKind.TrueKeyword;
}

function isRestrictedImportIdentifier(node: ts.Identifier): boolean {
  return (
    ts.isImportSpecifier(node.parent) ||
    ts.isExportSpecifier(node.parent) ||
    ts.isImportClause(node.parent) ||
    ts.isNamespaceImport(node.parent)
  );
}

function isCallTargetIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.expression === node) return true;
  return ts.isPropertyAccessExpression(parent) && parent.name === node && ts.isCallExpression(parent.parent);
}

function isDeclarationIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node)
  );
}

function isLowLevelPickerCallee(expression: ts.Expression, aliases: ReadonlySet<string>): boolean {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee)) {
    return callee.text === LOW_LEVEL_PICKER || aliases.has(callee.text);
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text === LOW_LEVEL_PICKER;
  }
  if (ts.isElementAccessExpression(callee) && callee.argumentExpression) {
    const argument = unwrapExpression(callee.argumentExpression);
    return ts.isStringLiteralLike(argument) && argument.text === LOW_LEVEL_PICKER;
  }
  return false;
}

function objectHasProperty(object: ts.ObjectLiteralExpression, propertyName: string): boolean {
  return object.properties.some((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text === propertyName;
    return ts.isPropertyAssignment(property) && propertyNameText(property.name) === propertyName;
  });
}

function isDirectPickerOptionsObject(
  object: ts.ObjectLiteralExpression,
  lowLevelPickerAliases: ReadonlySet<string>,
): boolean {
  let expression: ts.Expression = object;
  while (
    ts.isParenthesizedExpression(expression.parent) ||
    ts.isAsExpression(expression.parent) ||
    ts.isSatisfiesExpression(expression.parent) ||
    ts.isTypeAssertionExpression(expression.parent)
  ) {
    expression = expression.parent;
  }

  const parent = expression.parent;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument) => unwrapExpression(argument) === object) &&
    isLowLevelPickerCallee(parent.expression, lowLevelPickerAliases)
  );
}

function looksLikePickerOptions(
  object: ts.ObjectLiteralExpression,
  lowLevelPickerAliases: ReadonlySet<string>,
): boolean {
  return (
    isDirectPickerOptionsObject(object, lowLevelPickerAliases) ||
    objectHasProperty(object, "personas") ||
    objectHasProperty(object, PRESERVE_SELECTED_INTERACTION)
  );
}

function collectImportedAliases(sourceFile: ts.SourceFile, importedName: string): Set<string> {
  const aliases = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      const originalName = element.propertyName?.text ?? element.name.text;
      if (originalName === importedName) aliases.add(element.name.text);
    }
  }

  return aliases;
}

// Calling `deferReply` or `reply` inside a selection callback fails on Discord because the workflow already owns the
// interaction via the anchor message.
const SELF_ACKNOWLEDGEMENT_CALLS = new Set(["deferReply", "reply"]);

const WORKFLOW_ON_SELECTED = "onSelected";

function callbackBodies(initializer: ts.Expression): ts.FunctionLikeDeclaration[] {
  const unwrapped = unwrapExpression(initializer);
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) return [unwrapped];
  if (ts.isConditionalExpression(unwrapped)) {
    return [...callbackBodies(unwrapped.whenTrue), ...callbackBodies(unwrapped.whenFalse)];
  }
  if (ts.isBinaryExpression(unwrapped)) {
    return [...callbackBodies(unwrapped.left), ...callbackBodies(unwrapped.right)];
  }
  return [];
}

function scriptKindForPath(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function scanPersonaWorkflowSource(
  content: string,
  file = "src/unknown.ts",
): PersonaWorkflowBoundaryViolation[] {
  const normalizedFile = normalizePersonaWorkflowPath(file);
  if (INTERNAL_PERSONA_WORKFLOW_PATHS.has(normalizedFile)) return [];

  const sourceFile = ts.createSourceFile(
    normalizedFile,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(normalizedFile),
  );
  const lowLevelPickerAliases = collectImportedAliases(sourceFile, LOW_LEVEL_PICKER);
  const competingHelperAliases = collectImportedAliases(sourceFile, COMPETING_PERSONA_HELPER);
  const violations: PersonaWorkflowBoundaryViolation[] = [];
  const seen = new Set<string>();

  const addViolation = (node: ts.Node, kind: PersonaWorkflowViolationKind, symbol: string, message: string): void => {
    const start = node.getStart(sourceFile);
    const key = `${kind}:${start}`;
    if (seen.has(key)) return;
    seen.add(key);

    const location = sourceFile.getLineAndCharacterOfPosition(start);
    violations.push({
      file: normalizedFile,
      line: location.line + 1,
      column: location.character + 1,
      kind,
      symbol,
      message,
    });
  };

  const walkForSelfAcknowledgement = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        if (SELF_ACKNOWLEDGEMENT_CALLS.has(method)) {
          addViolation(
            callee.name,
            "self-acknowledging-on-selected",
            method,
            `A selection callback must not call ${method}() on the interaction; the anchor workflow owns acknowledgement.`,
          );
        }
      }
    }
    ts.forEachChild(node, walkForSelfAcknowledgement);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === LOW_LEVEL_PICKER) {
      if (isRestrictedImportIdentifier(node)) {
        addViolation(
          node,
          "low-level-picker-import",
          LOW_LEVEL_PICKER,
          "Import the command-facing persona workflow instead of the low-level picker.",
        );
      } else if (isCallTargetIdentifier(node)) {
        addViolation(
          node,
          "low-level-picker-call",
          LOW_LEVEL_PICKER,
          "Invoke the command-facing persona workflow instead of the low-level picker.",
        );
      } else {
        addViolation(
          node,
          "low-level-picker-reference",
          LOW_LEVEL_PICKER,
          "Do not expose or retain references to the low-level picker outside its internal boundary.",
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      const isAliasedLowLevelCall = ts.isIdentifier(callee) && lowLevelPickerAliases.has(callee.text);
      const isStringIndexedLowLevelCall =
        ts.isElementAccessExpression(callee) &&
        Boolean(callee.argumentExpression) &&
        ts.isStringLiteralLike(unwrapExpression(callee.argumentExpression)) &&
        (unwrapExpression(callee.argumentExpression) as ts.StringLiteralLike).text === LOW_LEVEL_PICKER;

      if (isAliasedLowLevelCall || isStringIndexedLowLevelCall) {
        addViolation(
          callee,
          "low-level-picker-call",
          LOW_LEVEL_PICKER,
          "Invoke the command-facing persona workflow instead of the low-level picker.",
        );
      }

      if (ts.isIdentifier(callee) && competingHelperAliases.has(callee.text)) {
        addViolation(
          callee,
          "competing-persona-helper",
          COMPETING_PERSONA_HELPER,
          "Remove the competing persona-selection helper and use the anchor workflow.",
        );
      }
    }

    if (ts.isIdentifier(node) && node.text === COMPETING_PERSONA_HELPER) {
      const location = isRestrictedImportIdentifier(node)
        ? "import"
        : isCallTargetIdentifier(node)
          ? "call"
          : isDeclarationIdentifier(node)
            ? "declaration"
            : "reference";
      addViolation(
        node,
        "competing-persona-helper",
        COMPETING_PERSONA_HELPER,
        `Remove this competing persona-selection helper ${location} and use the anchor workflow.`,
      );
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      if (name === PRESERVE_SELECTED_INTERACTION && isTrueLiteral(node.initializer)) {
        addViolation(
          node,
          "preserved-selected-interaction",
          PRESERVE_SELECTED_INTERACTION,
          "The persona workflow owns selected-interaction preservation.",
        );
      }

      if (
        name === PICKER_ON_SELECT &&
        isEmptyFunction(node.initializer) &&
        ts.isObjectLiteralExpression(node.parent) &&
        looksLikePickerOptions(node.parent, lowLevelPickerAliases)
      ) {
        addViolation(
          node,
          "empty-picker-on-select",
          PICKER_ON_SELECT,
          "Remove the empty picker callback; selection is returned by the persona workflow.",
        );
      }

      if (name === WORKFLOW_ON_SELECTED) {
        for (const callback of callbackBodies(node.initializer)) {
          if (!callback.body) continue;
          walkForSelfAcknowledgement(callback.body);
        }
      }
    }

    if (
      ts.isMethodDeclaration(node) &&
      propertyNameText(node.name) === PICKER_ON_SELECT &&
      node.body?.statements.length === 0 &&
      ts.isObjectLiteralExpression(node.parent) &&
      looksLikePickerOptions(node.parent, lowLevelPickerAliases)
    ) {
      addViolation(
        node,
        "empty-picker-on-select",
        PICKER_ON_SELECT,
        "Remove the empty picker callback; selection is returned by the persona workflow.",
      );
    }

    if (ts.isMethodDeclaration(node) && propertyNameText(node.name) === WORKFLOW_ON_SELECTED && node.body) {
      walkForSelfAcknowledgement(node.body);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const absolute = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(absolute) : Promise.resolve([absolute]);
    }),
  );
  return files.flat();
}

export async function auditPersonaWorkflowBoundary(): Promise<PersonaWorkflowBoundaryAuditResult> {
  const candidates: string[] = [];
  for (const directory of PERSONA_WORKFLOW_AUDIT_DIRS) {
    const files = await listFiles(resolve(PERSONA_WORKFLOW_REPO_ROOT, directory));
    candidates.push(...files.filter((file) => /\.(?:[cm]?ts|tsx)$/.test(file)));
  }

  candidates.sort((a, b) => a.localeCompare(b));
  const violations: PersonaWorkflowBoundaryViolation[] = [];
  let scannedFiles = 0;

  for (const absolute of candidates) {
    const relativePath = normalizePersonaWorkflowPath(relative(PERSONA_WORKFLOW_REPO_ROOT, absolute));
    if (INTERNAL_PERSONA_WORKFLOW_PATHS.has(relativePath)) continue;
    scannedFiles++;
    violations.push(...scanPersonaWorkflowSource(await readFile(absolute, "utf8"), relativePath));
  }

  violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind),
  );
  return { violations, scannedFiles };
}
