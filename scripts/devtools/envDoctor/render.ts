import { REDACTED, isSecretName } from "./policy";
import type { DeclarationSite, EnvDoctorReport, Location, VariableReport } from "./types";

function at(site: Location): string {
  return `${site.origin ? `${site.origin}:` : ""}${site.file}:${site.line}`;
}

/** Every printed value goes through here, so a secret-named variable can never leak one. */
export function displayValue(name: string, value: string): string {
  if (isSecretName(name)) return REDACTED;
  return value === "" ? "(empty)" : JSON.stringify(value);
}

function describeDeclaration(declaration: DeclarationSite): string {
  const where = at(declaration);
  const value =
    declaration.value !== undefined
      ? ` = ${displayValue(declaration.name, declaration.value)}`
      : declaration.interpolates
        ? ` = from \${${declaration.interpolates.join("}, ${")}}`
        : "";
  const scope = [
    declaration.tier,
    declaration.section,
    declaration.service ? `service ${declaration.service}` : undefined,
  ]
    .filter(Boolean)
    .join(" / ");
  return `${declaration.layer} ${where}${scope ? ` [${scope}]` : ""}${value}`;
}

/** Renders one variable's full evidence. */
export function renderVariable(variable: VariableReport): string {
  const lines: string[] = [];
  const { classification } = variable;
  lines.push(`${variable.name}${variable.secret ? " (secret-named: values redacted)" : ""}`);
  lines.push(`  classification: ${classification.candidate} (${classification.confidence})`);
  for (const reason of classification.reasons) lines.push(`    - ${reason}`);
  if (variable.exception) lines.push(`  exception: ${variable.exception}`);
  lines.push(`  declared:${variable.declarations.length === 0 ? " nowhere" : ""}`);
  for (const declaration of variable.declarations) lines.push(`    ${describeDeclaration(declaration)}`);
  lines.push(`  consumers:${variable.consumers.length === 0 ? " none found" : ""}`);
  for (const consumer of variable.consumers) {
    const fallback = consumer.fallback
      ? "value" in consumer.fallback
        ? `, fallback ${displayValue(variable.name, consumer.fallback.value)}`
        : `, fallback not static (${isSecretName(variable.name) ? REDACTED : consumer.fallback.unrecoverable})`
      : "";
    const via = consumer.helper ? ` via ${consumer.helper}` : "";
    lines.push(`    ${at(consumer)} ${consumer.language}/${consumer.role} ${consumer.kind}${via}${fallback}`);
  }
  for (const pattern of variable.dynamicMatches) {
    lines.push(
      `    ${at(pattern)} ${pattern.language}/${pattern.role} dynamic name ${pattern.prefix}*${pattern.suffix}`,
    );
  }
  if (variable.documentedDefaults.length > 0) {
    lines.push(
      `  documented default: ${variable.documentedDefaults
        .map((site) => `${displayValue(variable.name, site.value)} (${site.source}, ${at(site)})`)
        .join("; ")}`,
    );
  }
  if (variable.codeFallbacks.length > 0) {
    lines.push(
      `  code fallback: ${variable.codeFallbacks.map((site) => `${displayValue(variable.name, site.value)} (${at(site)})`).join("; ")}`,
    );
  }
  for (const group of variable.aliasGroups)
    lines.push(`  shares a setting with: ${group.filter((name) => name !== variable.name).join(", ")}`);
  if (variable.docsMentions.length > 0) lines.push(`  docs: ${variable.docsMentions.join(", ")}`);
  return lines.join("\n");
}

function section(title: string, count: number, body: string[]): string {
  return [`\n${title} (${count})`, ...(body.length > 0 ? body : ["  none"])].join("\n");
}

/** Renders the review summary: counts, every diagnostic, and the uncertainty behind them. */
export function renderSummary(report: EnvDoctorReport, options: { limit: number }): string {
  const { diagnostics } = report;
  const byName = new Map(report.variables.map((variable) => [variable.name, variable]));
  const cap = <T>(items: T[]): T[] => (options.limit > 0 ? items.slice(0, options.limit) : items);
  const more = (items: unknown[]): string[] =>
    options.limit > 0 && items.length > options.limit
      ? [`  ... ${items.length - options.limit} more (use --limit 0)`]
      : [];

  const out: string[] = [];
  out.push("env-doctor: read-only environment inventory. Classification is a review aid, not a removal verdict.");
  out.push(
    `Scanned: ${Object.entries(report.scanned)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => `${count} ${kind}`)
      .join(", ")}`,
  );
  out.push(`Release deployment files: ${report.releaseSource ?? "unavailable"}`);
  out.push(`Variables: ${report.variables.length} (${report.platformNamesIgnored} platform names ignored)`);

  const tally = new Map<string, Map<string, number>>();
  for (const variable of report.variables) {
    const { candidate, confidence } = variable.classification;
    const inner = tally.get(candidate) ?? new Map<string, number>();
    inner.set(confidence, (inner.get(confidence) ?? 0) + 1);
    tally.set(candidate, inner);
  }
  out.push("Classification candidates:");
  for (const candidate of ["deployment", "runtime-preference", "algorithmic-invariant", "dead", "undecided"]) {
    const inner = tally.get(candidate) ?? new Map();
    const total = [...inner.values()].reduce((sum: number, count: number) => sum + count, 0);
    const detail = ["high", "medium", "low"]
      .filter((level) => inner.has(level))
      .map((level) => `${level} ${inner.get(level)}`);
    out.push(`  ${candidate}: ${total}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`);
  }

  out.push(
    section(
      "Declared but apparently unread",
      diagnostics.declaredUnread.length,
      cap(diagnostics.declaredUnread).map((name) => {
        const variable = byName.get(name) as VariableReport;
        const where = variable.declarations.map(at).slice(0, 2).join(", ");
        return `  ${name} [${variable.classification.candidate}, ${variable.classification.confidence}] ${where}\n      ${variable.classification.reasons.join("; ")}`;
      }),
    ),
  );
  out.push(...more(diagnostics.declaredUnread));

  out.push(
    section(
      "Read but undocumented in .env.example or .env.optional.example",
      diagnostics.readUndocumented.length,
      cap(diagnostics.readUndocumented).map((name) => {
        const variable = byName.get(name) as VariableReport;
        const reads = variable.consumers.filter((site) => site.kind !== "literal-reference");
        return `  ${name} [${variable.classification.candidate}] ${reads.slice(0, 2).map(at).join(", ")}${reads.length > 2 ? ` +${reads.length - 2}` : ""}`;
      }),
    ),
  );
  out.push(...more(diagnostics.readUndocumented));

  out.push(
    section(
      "Conflicting defaults",
      diagnostics.conflictingDefaults.length,
      cap(diagnostics.conflictingDefaults).map((conflict) => {
        const values = conflict.values.map(
          (entry) => `${JSON.stringify(entry.value)} at ${entry.sites.map(at).join(", ")}`,
        );
        return `  ${conflict.name}\n      ${values.join("\n      ")}`;
      }),
    ),
  );
  out.push(...more(diagnostics.conflictingDefaults));

  out.push(
    section(
      "Multiple names feeding one setting",
      diagnostics.aliasGroups.length,
      cap(diagnostics.aliasGroups).map(
        (group) => `  ${group.names.join(" <- ")}  ${group.sites.map(at).slice(0, 3).join(", ")}`,
      ),
    ),
  );
  out.push(...more(diagnostics.aliasGroups));

  out.push(`\nLive .env: ${diagnostics.liveEnvStatus}`);
  out.push(
    section(
      "Live .env entries with no known consumer (names only)",
      diagnostics.liveEnvUnconsumed.length,
      diagnostics.liveEnvUnconsumed.map((name) => `  ${name}`),
    ),
  );

  const uncertainty: string[] = [];
  for (const surface of diagnostics.unavailable)
    uncertainty.push(`  unavailable: ${surface.surface}: ${surface.reason}`);
  for (const site of diagnostics.parseFailures) uncertainty.push(`  parse errors: ${at(site)}`);
  for (const site of diagnostics.unresolvedReads) {
    uncertainty.push(
      `  dynamic read ${at(site)} (${site.expression})${site.registeredReason ? ` registered: ${site.registeredReason}` : " UNREGISTERED: blocks dead verdicts"}`,
    );
  }
  for (const drift of diagnostics.exceptionDrift) uncertainty.push(`  exception drift: ${drift}`);
  out.push(section("Uncertainty", uncertainty.length, uncertainty));
  out.push("\nDetail for one variable: bun run env-doctor --var NAME. Full inventory: --all or --json.");
  return out.join("\n");
}
