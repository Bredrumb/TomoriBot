/**
 * Text-preview convention audit (CLI).
 *
 * Run via `bun run check-text-preview` for a readable local report. The same
 * scanner is asserted in `tests/unit/checks/textPreview.test.ts`, which is what
 * actually gates CI — this CLI exists for developer ergonomics, mirroring
 * `checkPersonaWorkflowBoundary.ts`.
 *
 * Rule descriptions live in `lib/textPreviewAudit.ts`.
 */

import {
  auditTextPreview,
  KNOWN_UNGUARDED,
  REQUIRED_HELPER,
  type TextPreviewViolation,
  type TextPreviewViolationKind,
} from "./lib/textPreviewAudit";

const KIND_TITLES: Record<TextPreviewViolationKind, string> = {
  "baked-ellipsis": "UNCONDITIONAL ELLIPSIS IN LOCALE STRING",
  "unguarded-fenced-placeholder": `FENCED PLACEHOLDER NOT ROUTED THROUGH ${REQUIRED_HELPER}`,
};

const KIND_ADVICE: Record<TextPreviewViolationKind, string> = {
  "baked-ellipsis":
    "Drop the '...' from the locale string and attach textPreviewFooterKey()/textPreviewFooterVars() so truncation is reported only when it happens.",
  "unguarded-fenced-placeholder": `Build the interpolated value with ${REQUIRED_HELPER}() from @/utils/text/textPreview so backtick runs cannot escape the fence.`,
};

function formatViolation(violation: TextPreviewViolation): string {
  return `${violation.key} — ${violation.detail}`;
}

async function run(): Promise<void> {
  const { violations, scannedFiles } = await auditTextPreview();

  for (const kind of Object.keys(KIND_TITLES) as TextPreviewViolationKind[]) {
    const matching = violations.filter((violation) => violation.kind === kind);
    if (matching.length === 0) continue;

    console.log(`=== ${KIND_TITLES[kind]} ===`);
    for (const violation of matching) console.log(formatViolation(violation));
    console.log(`→ ${KIND_ADVICE[kind]}`);
    console.log("");
  }

  if (violations.length > 0) {
    console.error(
      `❌ Found ${violations.length} text-preview ${violations.length === 1 ? "violation" : "violations"}. ` +
        "Route previewed text through src/utils/text/textPreview.ts.",
    );
    process.exit(1);
  }

  console.log(
    `✅ Text-preview conventions are clean (${scannedFiles} source files scanned, ${KNOWN_UNGUARDED.size} pre-existing sites allowlisted).`,
  );
}

run().catch((error) => {
  console.error("Text-preview audit failed to run:", error);
  process.exit(1);
});
