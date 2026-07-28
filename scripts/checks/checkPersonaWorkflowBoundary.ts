/**
 * Persona-picker workflow boundary audit (CLI).
 *
 * Run via `bun run check-persona-workflow-boundary`. Any violation exits
 * non-zero so command code cannot bypass the anchor workflow unnoticed.
 */

import {
  auditPersonaWorkflowBoundary,
  type PersonaWorkflowBoundaryViolation,
  type PersonaWorkflowViolationKind,
} from "./lib/personaWorkflowBoundary";

const KIND_TITLES: Record<PersonaWorkflowViolationKind, string> = {
  "low-level-picker-import": "LOW-LEVEL PICKER IMPORTS",
  "low-level-picker-call": "LOW-LEVEL PICKER CALLS",
  "low-level-picker-reference": "LOW-LEVEL PICKER REFERENCES",
  "preserved-selected-interaction": "MANUAL INTERACTION PRESERVATION",
  "empty-picker-on-select": "EMPTY PICKER CALLBACKS",
  "competing-persona-helper": "COMPETING PERSONA HELPERS",
};

function formatViolation(violation: PersonaWorkflowBoundaryViolation): string {
  return `${violation.file}:${violation.line}:${violation.column} ${violation.message}`;
}

async function run(): Promise<void> {
  const { violations, scannedFiles } = await auditPersonaWorkflowBoundary();

  for (const kind of Object.keys(KIND_TITLES) as PersonaWorkflowViolationKind[]) {
    const matching = violations.filter((violation) => violation.kind === kind);
    if (matching.length === 0) continue;

    console.log(`=== ${KIND_TITLES[kind]} ===`);
    for (const violation of matching) console.log(formatViolation(violation));
    console.log("");
  }

  if (violations.length > 0) {
    console.error(
      `❌ Found ${violations.length} persona workflow boundary ${violations.length === 1 ? "violation" : "violations"}. ` +
        "Migrate command and feature code to src/utils/discord/ui/personaWorkflow.ts.",
    );
    process.exit(1);
  }

  console.log(`✅ Persona workflow boundary is clean (${scannedFiles} source files scanned).`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

