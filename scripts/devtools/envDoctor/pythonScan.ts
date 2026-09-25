import { isEnvName, roleForPath } from "./policy";
import {
  blankHashComments,
  collectStringLiterals,
  emptyScanResult,
  evaluateArithmetic,
  lineIndexer,
  originOf,
  splitArguments,
} from "./textUtils";
import type { Fallback, ScanResult, SourceFile } from "./types";

const BUILTIN_READERS = ["os.getenv", "os.environ.get", "os.environ.setdefault", "environ.get"];
const NESTED_READ = /(?:os\.getenv|os\.environ\.get)\s*\(\s*["']([A-Z][A-Z0-9_]*)["']/g;
const QUOTED = /^(?:"([^"]*)"|'([^']*)')$/s;

interface PythonDef {
  name: string;
  params: string[];
  start: number;
  end: number;
  body: string;
}

interface PythonRead {
  names: string[];
  start: number;
  end: number;
  nestedNames: string[];
  consumerIndices: number[];
}

/**
 * Scans Python for `os.getenv`, `os.environ.get`, `os.environ[...]`, and same-file helpers whose
 * parameter reaches one of those. Nested defaults (`os.getenv("A", os.getenv("B", "1"))`) and `or`
 * chains are reported as aliases because both names feed one value.
 */
export function scanPython(file: SourceFile): ScanResult {
  const result = emptyScanResult();
  const role = roleForPath(file.path, "python");
  const text = blankHashComments(file.text, { tripleQuotes: true, hashNeedsSpace: false });
  const lineOf = lineIndexer(text);
  const moduleConstants = new Map<string, string>();
  for (const match of text.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([\d_.]+))\s*$/gm)) {
    moduleConstants.set(match[1], match[2] ?? match[3] ?? match[4]);
  }

  const defs = findDefs(text);
  const helpers = findHelpers(defs);
  const readers = [...BUILTIN_READERS, ...helpers.keys()];
  const readerPattern = new RegExp(
    `(?<![\\w.])(?<!\\bdef\\s{1,20})(${readers.map((name) => name.replaceAll(".", "\\.")).join("|")})\\s*\\(`,
    "g",
  );

  const evaluateDefault = (raw: string): { fallback: Fallback; nested: string[] } => {
    const trimmed = raw.trim();
    const nested = [...trimmed.matchAll(NESTED_READ)].map((match) => match[1]);
    const literal = QUOTED.exec(trimmed);
    if (literal) return { fallback: { value: literal[1] ?? literal[2] }, nested };
    if (trimmed === "True" || trimmed === "False") return { fallback: { value: trimmed.toLowerCase() }, nested };
    if (trimmed === "None") return { fallback: { value: "" }, nested };
    const wrapped = /^(?:str|int|float)\((.*)\)$/s.exec(trimmed);
    const arithmetic = evaluateArithmetic(wrapped ? wrapped[1] : trimmed);
    if (arithmetic !== undefined) return { fallback: { value: arithmetic }, nested };
    const constant = moduleConstants.get(trimmed);
    if (constant !== undefined) return { fallback: { value: constant }, nested };
    const innerDefault = /^(?:os\.getenv|os\.environ\.get)\s*\(\s*["'][A-Z][A-Z0-9_]*["']\s*,(.*)\)$/s.exec(trimmed);
    if (innerDefault) return { fallback: evaluateDefault(innerDefault[1]).fallback, nested };
    return { fallback: { unrecoverable: trimmed.replace(/\s+/g, " ").slice(0, 60) }, nested };
  };

  const reads: PythonRead[] = [];
  for (const match of text.matchAll(readerPattern)) {
    const reader = match[1];
    const start = match.index ?? 0;
    const { args, end } = splitArguments(text, start + match[0].length - 1);
    const nameIndex = helpers.get(reader) ?? 0;
    const rawName = args[nameIndex]?.trim();
    if (!rawName) continue;
    const site = { file: file.path, line: lineOf(start), ...originOf(file) };
    const literal = QUOTED.exec(rawName);
    const fString = /^f(?:"([^"{]*)\{[^}]*\}([^"]*)"|'([^'{]*)\{[^}]*\}([^']*)')$/.exec(rawName);
    let name: string | undefined;
    if (literal) {
      name = literal[1] ?? literal[2];
    } else if (fString) {
      result.dynamicPatterns.push({
        ...site,
        prefix: fString[1] ?? fString[3] ?? "",
        suffix: fString[2] ?? fString[4] ?? "",
        language: "python",
        role,
      });
      continue;
    } else if (moduleConstants.has(rawName)) {
      name = moduleConstants.get(rawName);
    } else if (defs.some((def) => start >= def.start && start < def.end && def.params.includes(rawName))) {
      continue;
    } else {
      result.unresolved.push({ ...site, language: "python", role, expression: rawName.slice(0, 80) });
      continue;
    }
    if (!name || !isEnvName(name)) continue;
    const defaultArg = args[nameIndex + 1];
    const evaluated = defaultArg === undefined ? undefined : evaluateDefault(defaultArg);
    const isHelper = helpers.has(reader);
    reads.push({
      names: [name],
      start,
      end,
      nestedNames: evaluated?.nested ?? [],
      consumerIndices: [result.consumers.length],
    });
    result.consumers.push({
      ...site,
      name,
      language: "python",
      role,
      kind: isHelper ? "helper" : "direct",
      ...(isHelper ? { helper: reader } : {}),
      ...(evaluated ? { fallback: evaluated.fallback } : {}),
    });
  }

  for (const match of text.matchAll(/os\.environ\[\s*(?:"([^"]+)"|'([^']+)')\s*\]/g)) {
    const name = match[1] ?? match[2];
    const after = text.slice((match.index ?? 0) + match[0].length).trimStart();
    if (!isEnvName(name) || (after.startsWith("=") && !after.startsWith("=="))) continue;
    result.consumers.push({
      file: file.path,
      line: lineOf(match.index ?? 0),
      ...originOf(file),
      name,
      language: "python",
      role,
      kind: "direct",
    });
  }

  collectAliases(text, reads, file, result, lineOf);
  collectStringLiterals(text, file, "python", role, result, new Set(reads.flatMap((read) => read.names)));
  return result;
}

function findDefs(text: string): PythonDef[] {
  return [...text.matchAll(/^([ \t]*)def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm)].map((match) => {
    const indent = match[1].length;
    const start = match.index ?? 0;
    const headerEnd = text.indexOf("\n", start);
    const afterHeader = headerEnd === -1 ? text.length : headerEnd + 1;
    const dedent = new RegExp(`^[ \\t]{0,${indent}}(?=\\S)`, "m").exec(text.slice(afterHeader));
    const end = dedent ? afterHeader + dedent.index : text.length;
    const params = match[3]
      .split(",")
      .map((param) => param.split(/[:=]/)[0].replace(/^\*+/, "").trim())
      .filter((param) => /^[A-Za-z_]\w*$/.test(param) && param !== "self");
    return { name: match[2], params, start, end, body: text.slice(afterHeader, end) };
  });
}

/** A def is a helper when a parameter reaches an env reader, directly or via another helper. */
function findHelpers(defs: PythonDef[]): Map<string, number> {
  const helpers = new Map<string, number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const def of defs) {
      if (helpers.has(def.name)) continue;
      const readers = ["os\\.getenv", "os\\.environ\\.get", ...helpers.keys()];
      const index = def.params.findIndex(
        (param) =>
          new RegExp(`(?:${readers.join("|")})\\s*\\(\\s*${param}\\b`).test(def.body) ||
          new RegExp(`os\\.environ\\[\\s*${param}\\s*\\]`).test(def.body),
      );
      if (index >= 0) {
        helpers.set(def.name, index);
        changed = true;
      }
    }
  }
  return helpers;
}

/** Links reads joined by `or`, plus nested defaults, into alias groups. */
function collectAliases(
  text: string,
  reads: PythonRead[],
  file: SourceFile,
  result: ScanResult,
  lineOf: (offset: number) => number,
): void {
  const groups: PythonRead[][] = [];
  for (const read of [...reads].sort((a, b) => a.start - b.start)) {
    const previousGroup = groups.at(-1);
    const previous = previousGroup?.at(-1);
    if (
      previousGroup &&
      previous &&
      /^(\s*\.\s*\w+\(\s*\))*\s*\)?\s*or\s*\(?\s*$/.test(text.slice(previous.end, read.start))
    ) {
      previousGroup.push(read);
    } else {
      groups.push([read]);
    }
  }
  for (const group of groups) {
    const names = [...new Set(group.flatMap((read) => [...read.names, ...read.nestedNames]))];
    if (names.length < 2) continue;
    const last = group[group.length - 1];
    const tail = /^(?:\s*\.\s*\w+\(\s*\))*\s*\)?\s*or\s*(?:"([^"]*)"|'([^']*)')/.exec(text.slice(last.end));
    if (tail) {
      for (const index of group.flatMap((read) => read.consumerIndices)) {
        result.consumers[index].fallback ??= { value: tail[1] ?? tail[2] };
      }
    }
    result.aliases.push({
      file: file.path,
      line: lineOf(group[0].start),
      ...originOf(file),
      names,
      language: "python",
    });
  }
}
