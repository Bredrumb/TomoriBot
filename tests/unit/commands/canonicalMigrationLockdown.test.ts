import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MIGRATED_CANONICAL_CALLERS, PRE_CANONICAL_PRIMITIVES } from "@/utils/discord/ui/personaWorkflow";

/**
 * Lock-down audit for the canonical one-message workflow. A command file listed in
 * `MIGRATED_CANONICAL_CALLERS` is built entirely on the canonical controller; it must
 * therefore never call a pre-canonical picker or modal primitive. Because those are the
 * ONLY ways to open a modal or render a picker outside the canonical controller, their
 * absence transitively guarantees no post-modal terminal state
 * (`replyInfoEmbed`/`followUp`) can escape the one canonical message.
 *
 * The audit drives off the allow-list rather than scanning everything, so the ~30 callers
 * still on `promptWithPaginatedModal` are untouched.
 */
describe("canonical migration lock-down", () => {
  const repoRoot = resolve(import.meta.dir, "..", "..", "..");

  it("keeps the allow-list and primitive list non-empty single sources of truth", () => {
    expect(MIGRATED_CANONICAL_CALLERS.length).toBeGreaterThan(0);
    expect(PRE_CANONICAL_PRIMITIVES).toContain("promptWithPaginatedModal");
    expect(PRE_CANONICAL_PRIMITIVES).toContain("promptForSavedProvider");
    expect(PRE_CANONICAL_PRIMITIVES).toContain("promptWithRawModal");
  });

  for (const relativePath of MIGRATED_CANONICAL_CALLERS) {
    it(`forbids ${relativePath} from calling any pre-canonical primitive`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), "utf8");
      // A word-boundary scan catches imports and call sites alike. A migrated file must
      // not even import these names — reaching for one is the exact band-aid this guards.
      const offenders = PRE_CANONICAL_PRIMITIVES.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
      expect(offenders).toEqual([]);
    });

    it(`confirms ${relativePath} enters the canonical engine`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), "utf8");
      // The positive assertion guards against a file that dropped the primitives but also
      // dropped the canonical entry point (i.e. became a no-op rather than a migration).
      expect(source).toContain("beginCanonicalPrivateWorkflow");
    });
  }
});
