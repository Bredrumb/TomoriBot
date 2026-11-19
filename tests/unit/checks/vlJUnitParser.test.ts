// Bun's JUnit reporter uses host path separators in both name and file, so normalizing only one fails on Windows and
// silently falls back to console parsing.
import { describe, expect, it } from "bun:test";
import { parseJUnitSuites } from "../../../scripts/checks/vl";

function junitXml(separator: string): string {
  const file = ["tests", "unit", "chat", "admission.test.ts"].join(separator);
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" assertions="4" failures="1" skipped="0" time="1.11">
  <testsuite name="${file}" file="${file}" tests="3" assertions="4" failures="1" skipped="0" time="0" hostname="">
    <testsuite name="shouldBlockReplyToOtherBot" file="${file}" line="35" tests="3" assertions="4" failures="1" skipped="0" time="0" hostname="">
      <testcase name="hydrates an authorless partial reply target" classname="shouldBlockReplyToOtherBot" time="0.0003" file="${file}" line="36" assertions="2" />
      <testcase name="allows an unresolved authorless reply target" classname="shouldBlockReplyToOtherBot" time="0.0001" file="${file}" line="58" assertions="1" />
    </testsuite>
  </testsuite>
</testsuites>`;
}

describe("parseJUnitSuites", () => {
  it("parses Windows-style backslash paths", () => {
    // Regression: `name` was compared raw against a normalized `file`, so the
    // file-level suite never matched and the whole document parsed as null.
    const items = parseJUnitSuites(junitXml("\\"));

    expect(items).not.toBeNull();
    expect(items).toHaveLength(1);
    expect(items?.[0].summary).toBe("(2 pass, 0 skip, 1 fail)");
  });

  it("parses POSIX-style forward-slash paths", () => {
    // The Linux CI runners emit forward slashes; the fix must not be Windows-only.
    const items = parseJUnitSuites(junitXml("/"));

    expect(items).not.toBeNull();
    expect(items).toHaveLength(1);
    expect(items?.[0].summary).toBe("(2 pass, 0 skip, 1 fail)");
  });

  it("produces identical results on both platforms", () => {
    expect(parseJUnitSuites(junitXml("\\"))).toEqual(parseJUnitSuites(junitXml("/")));
  });

  it("treats a failing suite as fatal and attaches a rerun hint", () => {
    const [item] = parseJUnitSuites(junitXml("/")) ?? [];

    expect(item.exitCode).toBe(1);
    expect(item.fatal).toBe(true);
    expect(item.hint).toBe("Run `bun test tests/unit/chat/admission.test.ts`");
  });

  it("does not mistake a nested describe suite for a file suite", () => {
    // The inner <testsuite> carries the same `file` attribute but a describe name,
    // so it must become the display name rather than a second reported file.
    const items = parseJUnitSuites(junitXml("\\"));

    expect(items).toHaveLength(1);
    expect(items?.[0].name).toBe("Should Block Reply To Other Bot");
  });

  it("classifies regression paths into the regression bucket", () => {
    const file = ["tests", "regression", "db", "user.regression.test.ts"].join("\\");
    const xml = `<testsuites name="bun test" tests="1" failures="0" skipped="0">
  <testsuite name="${file}" file="${file}" tests="1" assertions="1" failures="0" skipped="0" />
</testsuites>`;

    expect(parseJUnitSuites(xml)?.[0]._category).toBe("regression-test");
  });

  it("returns null when no file-level suite is present so the caller can fall back", () => {
    expect(parseJUnitSuites('<testsuites name="bun test" />')).toBeNull();
  });
});
