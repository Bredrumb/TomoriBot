import { isEnvName, roleForPath } from "./policy";
import {
  blankHashComments,
  emptyScanResult,
  findExpansions,
  lineIndexer,
  originOf,
  pushExpansions,
  stripQuotes,
} from "./textUtils";
import type { DeclarationSite, Fallback, ScanResult, SourceFile } from "./types";

// Single-quoted text is blanked because shell never expands it, and assigned names need a default operator
// (${NAME:-v}) to count as overridable env reads.
export function scanShell(file: SourceFile): ScanResult {
  const result = emptyScanResult();
  const text = blankHashComments(file.text, { tripleQuotes: false, hashNeedsSpace: true }).replace(
    /'[^'\n]*'/g,
    (segment) => " ".repeat(segment.length),
  );
  const assigned = new Set<string>();
  for (const match of text.matchAll(
    /(?:^|[\s;&|(])(?:export\s+|local\s+|readonly\s+|declare\s+(?:-\w+\s+)*)?([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\+?=/gm,
  )) {
    assigned.add(match[1]);
  }
  for (const match of text.matchAll(/\b(?:for|read(?:\s+-\w+)*)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    assigned.add(match[1]);
  }
  // `NAME=value command` sets NAME for that one command, so a script that does this is supplying
  // the value to its own stub, not reading operator configuration.
  const selfProvided = new Set<string>();
  for (const match of text.matchAll(
    /(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=(?:"[^"\n]*"|'[^'\n]*'|[^\s;&|()]*)(?=[ \t]+[A-Za-z_./$])/gm,
  )) {
    selfProvided.add(match[1]);
  }
  pushExpansions(
    findExpansions(text, { dollarEscape: false }),
    lineIndexer(text),
    file,
    "shell",
    result,
    (expansion) => !selfProvided.has(expansion.name) && (expansion.hasDefaultOperator || !assigned.has(expansion.name)),
  );
  return result;
}

export function scanPowerShell(file: SourceFile): ScanResult {
  const result = emptyScanResult();
  const role = roleForPath(file.path, "powershell");
  const withoutBlockComments = file.text.replace(/<#[\s\S]*?#>/g, (block) => block.replace(/[^\n]/g, " "));
  const text = blankHashComments(withoutBlockComments, { tripleQuotes: false, hashNeedsSpace: false });
  const lineOf = lineIndexer(text);

  const fallbacks = new Map<string, Fallback>();
  for (const match of text.matchAll(
    /if\s*\(\s*\$env:([A-Za-z_]\w*)\s*\)\s*\{\s*\$env:\1\s*\}\s*else\s*\{\s*(?:"([^"]*)"|'([^']*)'|([^}]*))\}/g,
  )) {
    const literal = match[2] ?? match[3];
    fallbacks.set(
      `${match[1]}@${lineOf(match.index ?? 0)}`,
      literal !== undefined ? { value: literal } : { unrecoverable: (match[4] ?? "").trim().slice(0, 60) },
    );
  }

  const seen = new Set<string>();
  for (const match of text.matchAll(/\$env:([A-Za-z_]\w*)/gi)) {
    const name = match[1];
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 4);
    if (!isEnvName(name) || /^\s*=(?!=)/.test(after)) continue;
    const line = lineOf(match.index ?? 0);
    const key = `${name}@${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fallback = fallbacks.get(key);
    result.consumers.push({
      file: file.path,
      line,
      ...originOf(file),
      name,
      language: "powershell",
      role,
      kind: "direct",
      ...(fallback ? { fallback } : {}),
    });
  }
  for (const match of text.matchAll(/GetEnvironmentVariable\(\s*["']([A-Z][A-Z0-9_]*)["']/g)) {
    result.consumers.push({
      file: file.path,
      line: lineOf(match.index ?? 0),
      ...originOf(file),
      name: match[1],
      language: "powershell",
      role,
      kind: "direct",
    });
  }
  return result;
}

export function scanDockerfile(file: SourceFile): ScanResult {
  const result = emptyScanResult();
  const lines = file.text.split(/\r?\n/);
  const declare = (name: string, line: number, layer: DeclarationSite["layer"], value: string | undefined) => {
    if (!isEnvName(name)) return;
    result.declarations.push({
      name,
      file: file.path,
      line,
      ...originOf(file),
      layer,
      ...(value !== undefined ? { value } : {}),
    });
  };

  for (let index = 0; index < lines.length; index++) {
    const startLine = index + 1;
    let instruction = lines[index];
    while (/\\\s*$/.test(instruction) && index + 1 < lines.length) {
      index++;
      instruction = `${instruction.replace(/\\\s*$/, " ")}${lines[index]}`;
    }
    const keyword = /^\s*([A-Za-z]+)\s+(.*)$/s.exec(instruction);
    if (!keyword || instruction.trimStart().startsWith("#")) continue;
    const verb = keyword[1].toUpperCase();
    const rest = keyword[2].trim();
    if (verb === "ARG") {
      const arg = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/.exec(rest);
      if (arg) declare(arg[1], startLine, "dockerfile-arg", arg[2] === undefined ? undefined : stripQuotes(arg[2]));
      continue;
    }
    if (verb === "ENV") {
      const pairs = [...rest.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|'[^']*'|\S*)/g)];
      if (pairs.length > 0) {
        for (const pair of pairs) declare(pair[1], startLine, "dockerfile-env", stripQuotes(pair[2]));
      } else {
        const [name, ...value] = rest.split(/\s+/);
        declare(name, startLine, "dockerfile-env", value.join(" "));
      }
    }
    pushExpansions(findExpansions(instruction, { dollarEscape: false }), () => startLine, file, "dockerfile", result);
  }
  return result;
}
