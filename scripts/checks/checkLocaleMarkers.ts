import { PROTOCOL_KEYS, buildProtocolLookup } from "@/utils/discord/embedProtocol";
import {
  getLocaleSubKeys,
  getSupportedLocales,
  hasLocaleKey,
  initializeLocalizer,
  localizer,
} from "@/utils/text/localizer";

const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
};

export interface ProtocolMarkerIssue {
  type: "collision" | "placeholder_mismatch" | "missing_literal_anchor" | "missing_key";
  message: string;
  key?: string;
  locale?: string;
}

export interface ProtocolMarkerSummary {
  localesChecked: string[];
  totalProtocolKeys: number;
  issues: ProtocolMarkerIssue[];
}

/**
 * Validates protocol marker and title configuration across authored locales.
 */
export async function validateProtocolMarkers(targetLocales?: string[]): Promise<ProtocolMarkerSummary> {
  await initializeLocalizer();

  const authoredLocales = targetLocales ?? getSupportedLocales();
  const issues: ProtocolMarkerIssue[] = [];

  // Discover dynamic reward and punish protocol keys across authored locales
  const allEntries = [...PROTOCOL_KEYS];
  for (const locale of authoredLocales) {
    for (const namespace of ["commands.reward", "commands.punish"] as const) {
      for (const name of getLocaleSubKeys(locale, namespace)) {
        const key = `${namespace}.${name}.embed_title`;
        if (hasLocaleKey(locale, key) && !allEntries.some((entry) => entry.key === key)) {
          allEntries.push({
            key,
            kind: namespace === "commands.reward" ? "reward" : "punish",
          });
        }
      }
    }
  }

  // Verify presence of all protocol keys across authored locales
  for (const locale of authoredLocales) {
    for (const entry of allEntries) {
      if (!hasLocaleKey(locale, entry.key)) {
        issues.push({
          type: "missing_key",
          key: entry.key,
          locale,
          message: `Protocol key "${entry.key}" is missing in authored locale "${locale}"`,
        });
      }
    }
  }

  // Test reverse lookup assembly to catch collisions, placeholder differences, and missing anchors
  try {
    buildProtocolLookup(allEntries, authoredLocales, (locale, key) =>
      hasLocaleKey(locale, key) ? localizer(locale, key) : undefined,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Protocol title collision")) {
      issues.push({ type: "collision", message });
    } else if (message.includes("Protocol template placeholders differ")) {
      issues.push({ type: "placeholder_mismatch", message });
    } else if (message.includes("Protocol title template has no literal anchor")) {
      issues.push({ type: "missing_literal_anchor", message });
    } else {
      issues.push({ type: "collision", message });
    }
  }

  return {
    localesChecked: authoredLocales,
    totalProtocolKeys: allEntries.length,
    issues,
  };
}

/** Prints the protocol marker section of `check-locales` and returns whether it passed. */
export async function reportProtocolMarkers(): Promise<boolean> {
  log.info("Validating embed protocol keys and markers across authored locales…");
  const summary = await validateProtocolMarkers();

  if (summary.issues.length > 0) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`❌ PROTOCOL MARKER VALIDATION ISSUES (${summary.issues.length})`);
    console.log("=".repeat(80));
    for (const issue of summary.issues) {
      console.log(`  • [${issue.type.toUpperCase()}] ${issue.message}`);
    }
    console.log(`\n${"=".repeat(80)}`);
    log.error(`Protocol marker check FAILED: ${summary.issues.length} issue(s)`);
    return false;
  }
  log.success(
    `Protocol marker check PASSED: ${summary.totalProtocolKeys} keys verified across [${summary.localesChecked.join(", ")}] with 0 collisions or mismatches`,
  );
  return true;
}
