import { readdirSync } from "node:fs";
import { join } from "node:path";
import { hasLocaleKey, localizer } from "@/utils/text/localizer";

// Locales are read from disk instead of calling getSupportedLocales() because tests enumerate them before
// initializeLocalizer() runs.
export const RUNTIME_LOCALES: readonly string[] = readdirSync(join(process.cwd(), "src", "locales"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const MAX_REPORTED_FAILURES = 20;

// Wrapped whitespace pattern includes \\n for JSON.stringify payloads and repeated -# or > prefixes because
// withLinePrefix emits them on wrapped lines.
const WRAPPED_WHITESPACE = String.raw`(?:\s|\\n)+(?:(?:-# |> )(?:\s)*)?`;

type CopyVariables = Record<string, string | number>;

// Must throw on missing keys because localizer() falls back to returning the raw key string, which would falsely
// match buggy output.
export function localizedCopy(locale: string, key: string, variables: CopyVariables = {}): string {
  if (!hasLocaleKey(locale, key)) throw new Error(`Unknown locale key in assertion: ${locale} ${key}`);
  return localizer(locale, key, variables);
}

export function localizedProse(locale: string, key: string, variables: CopyVariables = {}): RegExp {
  const words = localizedCopy(locale, key, variables).trim().split(/\s+/).map(proseWordPattern);
  return new RegExp(words.join(WRAPPED_WHITESPACE), "u");
}

// Japanese and Chinese have no spaces, so formatPanelProse wraps between any two characters in these scripts.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const OPTIONAL_WRAP = String.raw`(?:(?:\n|\\n)(?:(?:-# |> )(?:\s)*)?)?`;

function proseWordPattern(word: string): string {
  const parts = (word.match(/\{\w+\}|./gsu) ?? []).map((part) =>
    /^\{\w+\}$/.test(part) ? ".+?" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/"/g, String.raw`\\?"`),
  );
  return parts.join(UNSPACED_SCRIPT.test(word) ? OPTIONAL_WRAP : "");
}

export interface CaseFailureCollector {
  check(label: string, run: () => void): void;
  expectNoFailures(): void;
}

export function collectCaseFailures(): CaseFailureCollector {
  const failures: string[] = [];
  let checked = 0;
  return {
    check(label, run) {
      checked++;
      try {
        run();
      } catch (error) {
        failures.push(`${label}: ${Bun.stripANSI(error instanceof Error ? error.message : String(error))}`);
      }
    },
    expectNoFailures() {
      if (failures.length === 0) return;
      const shown = failures.slice(0, MAX_REPORTED_FAILURES).join("\n\n");
      const hidden = failures.length - MAX_REPORTED_FAILURES;
      throw new Error(
        `${failures.length} of ${checked} cases failed:\n\n${shown}${hidden > 0 ? `\n\n...and ${hidden} more` : ""}`,
      );
    },
  };
}

export function expectForEveryLocale(
  check: (locale: string) => void,
  locales: readonly string[] = RUNTIME_LOCALES,
): void {
  const cases = collectCaseFailures();
  for (const locale of locales) cases.check(locale, () => check(locale));
  cases.expectNoFailures();
}
