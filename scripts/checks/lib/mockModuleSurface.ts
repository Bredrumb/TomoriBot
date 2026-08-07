/**
 * Bun module-mock surface and lifetime audit.
 *
 * `mock.module()` replacements persist for the entire Bun process. High-fanout
 * modules therefore need both a complete export surface and scoped behavioral
 * overrides that fall back to real behavior after the declaring file.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { ts } from "ts-morph";

export const HIGH_RISK_MOCK_MODULES = new Set([
  "@/utils/cache/tomoriStateCache",
  "@/utils/chat/contextAnnotations",
  "@/utils/db/client",
  "@/utils/db/repositories",
  "@/utils/discord/streamOrchestrator",
  "@/utils/discord/ui/embeds",
  "@/utils/discord/ui/modals",
  "@/utils/discord/ui/personaWorkflow",
  "@/utils/provider/providerInfoRegistry",
  "@/utils/security/crypto",
  "@/utils/text/localizer",
]);

/**
 * Modules that must never be mocked at module level, not even full-surface and leak-scoped.
 *
 * Scoping fixes leaked *behavior*, but the module record stays replaced for the rest of the
 * process, and that alone is enough to break a later file: `spyOn` on an export of a replaced
 * module installs nothing, silently, so the spy records zero calls while the real implementation
 * runs. `log` is a singleton whose members production resolves at call time, so `stubLogMembers()`
 * in `tests/helpers/mockSurface.ts` covers every case a module mock was serving here.
 */
export const FORBIDDEN_MOCK_MODULES = new Set(["@/utils/misc/logger"]);

export const MOCK_MODULE_SURFACE_REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

export type MockModuleSurfaceViolationKind =
  | "forbidden-module"
  | "missing-hoisted-real-import"
  | "missing-real-spread"
  | "unscoped-behavior";

export interface MockModuleSurfaceViolation {
  /** Repo-relative path with POSIX separators. */
  file: string;
  /** 1-based source line. */
  line: number;
  /** 1-based source column. */
  moduleSpecifier: string;
  kind: MockModuleSurfaceViolationKind;
  message: string;
}

export interface MockModuleSurfaceAuditResult {
  violations: MockModuleSurfaceViolation[];
  scannedFiles: number;
  guardedMocks: number;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
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

function factoryObjectLiteral(factory: ts.Expression | undefined): ts.ObjectLiteralExpression | null {
  if (!factory) return null;
  const unwrapped = unwrapExpression(factory);
  if (!ts.isArrowFunction(unwrapped) && !ts.isFunctionExpression(unwrapped)) return null;

  if (!ts.isBlock(unwrapped.body)) {
    const body = unwrapExpression(unwrapped.body);
    return ts.isObjectLiteralExpression(body) ? body : null;
  }

  for (const statement of unwrapped.body.statements) {
    if (!ts.isReturnStatement(statement) || !statement.expression) continue;
    const returned = unwrapExpression(statement.expression);
    if (ts.isObjectLiteralExpression(returned)) return returned;
  }
  return null;
}

function collectNamespaceImports(sourceFile: ts.SourceFile): Map<string, Set<string>> {
  const imports = new Map<string, Set<string>>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const binding = statement.importClause?.namedBindings;
    if (!binding || !ts.isNamespaceImport(binding)) continue;

    const aliases = imports.get(statement.moduleSpecifier.text) ?? new Set<string>();
    aliases.add(binding.name.text);
    imports.set(statement.moduleSpecifier.text, aliases);
  }
  return imports;
}

function collectScopedRegistrars(sourceFile: ts.SourceFile): Set<string> {
  const registrars = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(unwrapExpression(node.initializer))
    ) {
      const initializer = unwrapExpression(node.initializer) as ts.CallExpression;
      const callee = unwrapExpression(initializer.expression);
      if (ts.isIdentifier(callee) && callee.text === "createScopedModuleMocker") {
        registrars.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return registrars;
}

function moduleCallReceiver(call: ts.CallExpression): string | null {
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "module") return null;
  const receiver = unwrapExpression(callee.expression);
  return ts.isIdentifier(receiver) ? receiver.text : null;
}

/**
 * Scan one test source for unsafe mocks of curated high-fanout modules.
 */
export function scanMockModuleSurfaceSource(
  content: string,
  file = "tests/unknown.test.ts",
): MockModuleSurfaceViolation[] {
  const normalizedFile = normalizePath(file);
  const sourceFile = ts.createSourceFile(normalizedFile, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const namespaceImports = collectNamespaceImports(sourceFile);
  const scopedRegistrars = collectScopedRegistrars(sourceFile);
  const violations: MockModuleSurfaceViolation[] = [];

  const addViolation = (
    call: ts.CallExpression,
    moduleSpecifier: string,
    kind: MockModuleSurfaceViolationKind,
    message: string,
  ): void => {
    const location = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
    violations.push({
      file: normalizedFile,
      line: location.line + 1,
      column: location.character + 1,
      moduleSpecifier,
      kind,
      message,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const receiver = moduleCallReceiver(node);
      const specifierExpression = node.arguments[0] ? unwrapExpression(node.arguments[0]) : null;
      if (receiver && specifierExpression && ts.isStringLiteralLike(specifierExpression)) {
        const moduleSpecifier = specifierExpression.text;
        if (FORBIDDEN_MOCK_MODULES.has(moduleSpecifier)) {
          addViolation(
            node,
            moduleSpecifier,
            "forbidden-module",
            `Do not module-mock "${moduleSpecifier}". Use \`stubLogMembers()\` from ` +
              "tests/helpers/mockSurface instead: a replaced module record makes a later file's " +
              "`spyOn` silently install nothing.",
          );
        } else if (HIGH_RISK_MOCK_MODULES.has(moduleSpecifier)) {
          const realAliases = namespaceImports.get(moduleSpecifier) ?? new Set<string>();
          const object = factoryObjectLiteral(node.arguments[1]);
          const matchingSpreads =
            object?.properties.filter(
              (property) =>
                ts.isSpreadAssignment(property) &&
                ts.isIdentifier(unwrapExpression(property.expression)) &&
                realAliases.has((unwrapExpression(property.expression) as ts.Identifier).text),
            ) ?? [];

          if (realAliases.size === 0) {
            addViolation(
              node,
              moduleSpecifier,
              "missing-hoisted-real-import",
              `Add a hoisted \`import * as real from "${moduleSpecifier}"\` namespace.`,
            );
          }

          if (matchingSpreads.length === 0) {
            addViolation(
              node,
              moduleSpecifier,
              "missing-real-spread",
              "Spread the matching hoisted-real namespace in the module factory.",
            );
          }

          const hasBehavioralOverrides =
            object === null ||
            object.properties.some(
              (property) =>
                !(
                  ts.isSpreadAssignment(property) &&
                  ts.isIdentifier(unwrapExpression(property.expression)) &&
                  realAliases.has((unwrapExpression(property.expression) as ts.Identifier).text)
                ),
            );
          if (hasBehavioralOverrides && !scopedRegistrars.has(receiver)) {
            addViolation(
              node,
              moduleSpecifier,
              "unscoped-behavior",
              "Register behavioral overrides through createScopedModuleMocker so they fall back after the file.",
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const absolute = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(absolute) : Promise.resolve([absolute]);
    }),
  );
  return nested.flat();
}

/** Audit every test file in the real repository. */
export async function auditMockModuleSurfaces(
  repoRoot = MOCK_MODULE_SURFACE_REPO_ROOT,
): Promise<MockModuleSurfaceAuditResult> {
  const testsRoot = resolve(repoRoot, "tests");
  const candidates = (await listFiles(testsRoot)).filter((file) => file.endsWith(".test.ts"));
  candidates.sort((a, b) => a.localeCompare(b));

  const violations: MockModuleSurfaceViolation[] = [];
  let guardedMocks = 0;
  for (const absolute of candidates) {
    const relativePath = normalizePath(relative(repoRoot, absolute));
    const fileViolations = scanMockModuleSurfaceSource(await readFile(absolute, "utf8"), relativePath);
    violations.push(...fileViolations);

    const content = await readFile(absolute, "utf8");
    const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const receiver = moduleCallReceiver(node);
        const firstArgument = node.arguments[0] ? unwrapExpression(node.arguments[0]) : null;
        if (receiver && firstArgument && ts.isStringLiteralLike(firstArgument) && HIGH_RISK_MOCK_MODULES.has(firstArgument.text)) {
          guardedMocks++;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind),
  );
  return { violations, scannedFiles: candidates.length, guardedMocks };
}
