// String fragments prevent the literal `mock.module` token from causing the isolation scanner to misclassify its own
// tooling.
export const MODULE_MOCK_MARKER = `mock${"."}module`;
export const SCOPED_MODULE_MOCK_MARKER = "createScopedModuleMocker";

const DB_HARNESS_MARKERS = [`setup${"/"}testDb`, `TEST_DB${"_"}READY`];

// Bun applies `mock.module` process-wide without restoring it between files, so matching files must run in an
// isolated process.
export function usesModuleMocks(source: string): boolean {
  const executableSource = withoutComments(source);
  return executableSource.includes(MODULE_MOCK_MARKER) || executableSource.includes(SCOPED_MODULE_MOCK_MARKER);
}

// Comment stripping prevents mock markers in prose from altering process isolation topology and hiding leaks that a
// single `bun test` process exposes.
function withoutComments(source: string): string {
  let result = "";
  let index = 0;
  let quote: '"' | "'" | "`" | undefined;

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (quote) {
      result += character;
      if (character === "\\") {
        result += next ?? "";
        index += 2;
        continue;
      }
      if (character === quote) quote = undefined;
      index++;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      index++;
      continue;
    }

    if (character === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index++;
      index += 2;
      continue;
    }

    result += character;
    index++;
  }

  return result;
}

// Only `tests/regression/` files may reach the test DB because unit lanes run concurrently and would race on shared
// fixed-id fixtures.
export function reachesTestDatabase(source: string): boolean {
  return DB_HARNESS_MARKERS.some((marker) => source.includes(marker));
}

// Process-wide mutations (including `delete` on `.env` keys) persist across files in one `bun test` process, so
// returned tokens must appear in restore hooks.
export function findProcessWideMutations(source: string): string[] {
  const tokens = new Set<string>();

  // Bun's fake clock is process-global until reset with a bare setSystemTime().
  if (/\bsetSystemTime\s*\(/.test(source)) tokens.add("setSystemTime");

  // Assignments (not comparisons) and deletes on globalThis or process.env.
  for (const match of source.matchAll(
    /\bdelete\s+(globalThis|process\.env)\.([A-Za-z_$][\w$]*)|\b(globalThis|process\.env)\.([A-Za-z_$][\w$]*)\s*=[^=]/g,
  )) {
    tokens.add(`${match[1] ?? match[3]}.${match[2] ?? match[4]}`);
  }

  for (const match of source.matchAll(
    /\bdelete\s+process\.env\[\s*([^\]]+?)\s*\]|\bprocess\.env\[\s*([^\]]+?)\s*\]\s*=[^=]/g,
  )) {
    const key = match[1] ?? match[2];
    const literalName = /^(["'`])([A-Za-z_$][\w$]*)\1$/.exec(key)?.[2];
    tokens.add(literalName ? `process.env.${literalName}` : `process.env[${key}]`);
  }

  if (/\bObject\.assign\(\s*process\.env\b/.test(source)) tokens.add("Object.assign(process.env");

  return [...tokens];
}

// Lightweight parenthesis-depth scanning is safe here because any truncated parse fails loud as an unrestored
// mutation rather than silently passing.
export function extractRestoreHookBodies(source: string): string {
  return extractCallSources(source, /\bafter(?:Each|All)\s*\(/g);
}

// Callers must pass a global `callStart` regex ending at `(` because the loop uses `.exec` and initializes
// parenthesis `depth = 1`.
function extractCallSources(source: string, callStart: RegExp): string {
  const bodies: string[] = [];

  for (let match = callStart.exec(source); match !== null; match = callStart.exec(source)) {
    let depth = 1;
    let index = match.index + match[0].length;

    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === "(") depth++;
      else if (char === ")") depth--;
      index++;
    }

    bodies.push(source.slice(match.index, index));
  }

  return bodies.join("\n");
}

// `useEnvSandbox` hides restore hooks in `tests/helpers/env.ts`, and computed env writes accept any call since static
// scanning cannot resolve runtime keys.
function isCoveredByEnvSandbox(token: string, executableSource: string): boolean {
  const isEnvToken = token.startsWith("process.env") || token === "Object.assign(process.env";
  if (isEnvToken && /\buseFullEnvSandbox\s*\(/.test(executableSource)) return true;
  const sandboxCalls = extractCallSources(executableSource, /\buseEnvSandbox\s*\(/g);
  if (sandboxCalls === "") return false;
  if (token.startsWith("process.env[") || token === "Object.assign(process.env") return true;
  const name = /^process\.env\.([\w$]+)$/.exec(token)?.[1];
  const listedNames = [...sandboxCalls.matchAll(/(["'`])([\w$]+)\1/g)].map((literal) => literal[2]);
  return name !== undefined && listedNames.includes(name);
}

// Mock-using files skip restore checks because the runner already isolates them in a private process where mutations
// cannot reach other files.
export function findUnrestoredMutations(source: string): string[] {
  if (usesModuleMocks(source)) return [];

  const hookBodies = extractRestoreHookBodies(source);
  const executableSource = withoutComments(source);
  return findProcessWideMutations(source).filter(
    (token) => !hookBodies.includes(token) && !isCoveredByEnvSandbox(token, executableSource),
  );
}
