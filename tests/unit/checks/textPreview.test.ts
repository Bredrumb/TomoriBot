import { describe, expect, it } from "bun:test";
import {
  auditTextPreview,
  flattenLocale,
  hasFencedPlaceholder,
  KNOWN_UNGUARDED,
  REQUIRED_HELPER,
  scanBakedEllipsis,
  scanFencedPlaceholderUsage,
} from "../../../scripts/checks/lib/textPreviewAudit";

const FENCE = "```";

describe("text-preview scanner — baked ellipsis (rule 1)", () => {
  it("flags a placeholder followed by an ASCII ellipsis", () => {
    const violations = scanBakedEllipsis("a.b", `Saved:\n${FENCE}\n{preview}...\n${FENCE}`);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("baked-ellipsis");
  });

  it("flags the single-character ellipsis form too", () => {
    expect(scanBakedEllipsis("a.b", "{preview}…")).toHaveLength(1);
  });

  it("labels the violation with its locale so translations are distinguishable", () => {
    const [violation] = scanBakedEllipsis("a.b", "{preview}...", "ja");
    expect(violation.key).toBe("[ja] a.b");
  });

  it("ignores a placeholder with no trailing ellipsis", () => {
    expect(scanBakedEllipsis("a.b", `${FENCE}\n{preview}\n${FENCE}`)).toHaveLength(0);
  });

  it("ignores an ellipsis that is not attached to a placeholder", () => {
    // Prose ellipsis is a legitimate style choice, not a truncation claim.
    expect(scanBakedEllipsis("a.b", "Thinking... {preview}")).toHaveLength(0);
  });

  it("reports every offending placeholder in one string", () => {
    expect(scanBakedEllipsis("a.b", "{one}... and {two}...")).toHaveLength(2);
  });
});

describe("text-preview scanner — fenced placeholder (rule 2)", () => {
  const fenced = `Saved:\n${FENCE}\n{preview}\n${FENCE}`;

  it("recognizes a placeholder inside a fence", () => {
    expect(hasFencedPlaceholder(fenced)).toBe(true);
  });

  it("does not treat an unfenced placeholder as subject to the rule", () => {
    expect(hasFencedPlaceholder("**Preview:** {preview}")).toBe(false);
  });

  it("flags a consumer that does not use the required helper", () => {
    const sources = new Map([["src/commands/example.ts", `descriptionKey: "a.b", preview: raw.substring(0, 200)`]]);
    const violations = scanFencedPlaceholderUsage("a.b", fenced, sources);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain("src/commands/example.ts");
  });

  it("accepts a consumer that routes the value through the helper", () => {
    const sources = new Map([
      ["src/commands/example.ts", `descriptionKey: "a.b", preview: ${REQUIRED_HELPER}(raw).text`],
    ]);
    expect(scanFencedPlaceholderUsage("a.b", fenced, sources)).toHaveLength(0);
  });

  it("skips keys whose consumer cannot be located", () => {
    // Dynamic key construction is invisible to this static scan, so treating a
    // missing consumer as unsafe would be a guaranteed false positive.
    expect(scanFencedPlaceholderUsage("a.b", fenced, new Map())).toHaveLength(0);
  });

  it("skips allowlisted pre-existing sites", () => {
    const key = [...KNOWN_UNGUARDED][0];
    const sources = new Map([["src/commands/example.ts", `key is ${key} here`]]);
    expect(scanFencedPlaceholderUsage(key, fenced, sources)).toHaveLength(0);
  });

  it("flags each unguarded consumer separately", () => {
    const sources = new Map([
      ["src/commands/one.ts", `"a.b"`],
      ["src/commands/two.ts", `"a.b"`],
      ["src/commands/three.ts", `"a.b" ${REQUIRED_HELPER}`],
    ]);
    expect(scanFencedPlaceholderUsage("a.b", fenced, sources)).toHaveLength(2);
  });
});

describe("flattenLocale", () => {
  it("produces dotted keys for nested locale trees", () => {
    const out = new Map<string, string>();
    flattenLocale({ commands: { config: { title: "T" } } }, [], out);
    expect(out.get("commands.config.title")).toBe("T");
  });
});

describe("text-preview conventions — real source tree", () => {
  // The audit globs and reads every source file, so it runs ONCE and both
  // assertions share the result. This file sits in `bun run vl`'s shared unit
  // lane, where a second full scan would be pure added wall-clock time.
  const auditOnce = auditTextPreview();

  it("has no locale string claiming truncation that did not happen", async () => {
    const { violations } = await auditOnce;
    const baked = violations.filter((violation) => violation.kind === "baked-ellipsis");
    const detail = baked.map((violation) => `${violation.key} — ${violation.detail}`).join("\n");

    expect(
      baked,
      `Baked-ellipsis violations:\n${detail}\n\n` +
        "Fix: drop the '...' from the locale string and attach textPreviewFooterKey()/" +
        "textPreviewFooterVars() so truncation is reported only when it happens.\n" +
        "Every violation is listed above; the scanner lives in scripts/checks/lib/textPreviewAudit.ts.",
    ).toHaveLength(0);
  });

  it("has no fenced placeholder bypassing the shared preview helper", async () => {
    const { violations } = await auditOnce;
    const unguarded = violations.filter((violation) => violation.kind === "unguarded-fenced-placeholder");
    const detail = unguarded.map((violation) => `${violation.key} — ${violation.detail}`).join("\n");

    expect(
      unguarded,
      `Unguarded fenced placeholders:\n${detail}\n\n` +
        `Fix: build the interpolated value with ${REQUIRED_HELPER}() from @/utils/text/textPreview ` +
        "so backtick runs cannot escape the fence.\n" +
        "Every violation is listed above; the scanner lives in scripts/checks/lib/textPreviewAudit.ts.",
    ).toHaveLength(0);
  });
});
