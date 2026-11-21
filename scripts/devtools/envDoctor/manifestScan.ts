import { isEnvName } from "./policy";
import {
  blankHashComments,
  emptyScanResult,
  findExpansions,
  lineIndexer,
  originOf,
  pushExpansions,
  stripQuotes,
} from "./textUtils";
import type { DeclarationSite, ScanResult, SourceFile } from "./types";

interface YamlVisitor {
  envBlockKeys: string[];
  /** Called for every mapping key with the keys above it and any inline value. */
  onKey?: (path: string[], key: string, inlineValue: string, line: number) => void;
  onEnvEntry: (path: string[], name: string, rawValue: string | undefined, line: number) => void;
}

/**
 * Walks indentation-structured YAML and reports entries inside env blocks. Handles the map form
 * (`KEY: value`) and the list form (`- KEY=value`), which Compose accepts interchangeably.
 */
function walkYaml(text: string, visitor: YamlVisitor): void {
  const stack: { indent: number; key: string }[] = [];
  let envIndent: number | null = null;
  let envPath: string[] = [];
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const content = rawLine.trim();
    if (content.length === 0) return;
    const indent = rawLine.length - rawLine.trimStart().length;
    if (envIndent !== null) {
      if (indent > envIndent) {
        const entry =
          /^-\s+["']?([A-Za-z_][A-Za-z0-9_]*)(?:=(.*?))?["']?$/.exec(content) ??
          /^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.*)$/.exec(content);
        if (entry && isEnvName(entry[1])) {
          visitor.onEnvEntry(
            envPath,
            entry[1],
            entry[2] === undefined || entry[2] === "" ? undefined : entry[2],
            index + 1,
          );
        }
        return;
      }
      envIndent = null;
    }
    const keyMatch = /^(?:-\s+)?([A-Za-z0-9_.-]+):(?:\s+(.*)|$)/.exec(content);
    if (!keyMatch) return;
    while (stack.length > 0 && (stack[stack.length - 1] as { indent: number }).indent >= indent) stack.pop();
    const path = stack.map((entry) => entry.key);
    const inlineValue = (keyMatch[2] ?? "").trim();
    visitor.onKey?.(path, keyMatch[1], inlineValue, index + 1);
    stack.push({ indent, key: keyMatch[1] });
    if (visitor.envBlockKeys.includes(keyMatch[1]) && inlineValue.length === 0) {
      envIndent = indent;
      envPath = path;
    }
  });
}

interface ComposeService {
  build: boolean;
  dockerfile?: string;
  image: string;
  environment: DeclarationSite[];
}

/**
 * Scans a Compose file. Compose interpolates `${NAME}` from the host environment and the adjacent
 * `.env` before parsing, so every expansion is a read. `environment:` keys on a service built from
 * the root `Dockerfile` (or running the TomoriBot image) override the bot's `.env`; keys on any
 * other service are consumed by that third-party image, not by the bot.
 */
export function scanCompose(file: SourceFile): ScanResult {
  const result = emptyScanResult();
  const text = blankHashComments(file.text, { tripleQuotes: false, hashNeedsSpace: true });
  pushExpansions(findExpansions(text, { dollarEscape: true }), lineIndexer(text), file, "compose", result);

  const services = new Map<string, ComposeService>();
  const serviceFor = (name: string): ComposeService => {
    const existing = services.get(name);
    if (existing) return existing;
    const created: ComposeService = { build: false, image: "", environment: [] };
    services.set(name, created);
    return created;
  };

  walkYaml(text, {
    envBlockKeys: ["environment"],
    onKey: (path, key, inlineValue) => {
      if (path[0] !== "services") return;
      if (path.length === 2 && key === "build") serviceFor(path[1]).build = true;
      if (path.length === 2 && key === "image") serviceFor(path[1]).image = inlineValue;
      if (path.length === 3 && path[2] === "build" && key === "dockerfile")
        serviceFor(path[1]).dockerfile = inlineValue;
    },
    onEnvEntry: (path, name, rawValue, line) => {
      if (path[0] !== "services" || path.length < 2) return;
      const value = rawValue === undefined ? undefined : stripQuotes(rawValue.trim());
      const interpolates = value
        ? findExpansions(value, { dollarEscape: true }).map((expansion) => expansion.name)
        : [];
      serviceFor(path[1]).environment.push({
        name,
        file: file.path,
        line,
        ...originOf(file),
        layer: "compose-environment",
        service: path[1],
        ...(value !== undefined && interpolates.length === 0 ? { value } : {}),
        ...(interpolates.length > 0 ? { interpolates } : {}),
      });
    },
  });

  for (const [serviceName, service] of services) {
    const runsBot =
      (service.build && (service.dockerfile === undefined || service.dockerfile === "Dockerfile")) ||
      /TOMORIBOT_IMAGE|tomoribot/i.test(service.image);
    for (const declaration of service.environment) {
      result.declarations.push(declaration);
      if (!runsBot) {
        result.consumers.push({
          file: declaration.file,
          line: declaration.line,
          ...(declaration.origin ? { origin: declaration.origin } : {}),
          name: declaration.name,
          language: "compose",
          role: "infra",
          kind: "external-image",
          helper: `service ${serviceName}`,
        });
      }
    }
  }
  return result;
}

/**
 * Records `env:` keys in a GitHub workflow as a CI layer, and `$NAME` reads in its steps. Both only
 * enrich variables found elsewhere; workflow-local step variables are not inventoried.
 */
export function scanWorkflow(file: SourceFile): ScanResult {
  const result = emptyScanResult();
  const text = blankHashComments(file.text, { tripleQuotes: false, hashNeedsSpace: true });
  const withoutExpressions = text.replace(/\$\{\{[\s\S]*?\}\}/g, (expression) => expression.replace(/[^\n]/g, " "));
  pushExpansions(
    findExpansions(withoutExpressions, { dollarEscape: false }),
    lineIndexer(withoutExpressions),
    file,
    "workflow",
    result,
  );
  walkYaml(text, {
    envBlockKeys: ["env"],
    onEnvEntry: (_path, name, rawValue, line) => {
      const value = rawValue?.trim();
      result.declarations.push({
        name,
        file: file.path,
        line,
        ...originOf(file),
        layer: "workflow-env",
        ...(value && !value.includes("${{") ? { value: stripQuotes(value) } : {}),
      });
    },
  });
  return result;
}

/** Records container env entries (`name = "X"` followed by `value = …`) as a deployment layer. */
export function scanTerraform(file: SourceFile): ScanResult {
  const result = emptyScanResult();
  const lines = file.text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const name = /^\s*name\s*=\s*"([A-Z][A-Z0-9_]*)"/.exec(line)?.[1];
    if (!name || !isEnvName(name)) return;
    const window = lines.slice(index + 1, index + 4).join("\n");
    const value = /\bvalue\s*=\s*(.+)/.exec(window)?.[1]?.trim();
    if (value === undefined && !/\b(valueFrom|value_source|secret)\b/.test(window)) return;
    const literal = value === undefined ? null : /^"([^"$]*)"$/.exec(value);
    result.declarations.push({
      name,
      file: file.path,
      line: index + 1,
      ...originOf(file),
      layer: "terraform-env",
      ...(literal ? { value: literal[1] } : {}),
    });
  });
  return result;
}
