import { describe, expect, it } from "bun:test";
import { collectStrictChatFlagViolations, validateModels } from "@/db/seed/catalog/modelSeed";
import type { LlmInput } from "@/db/seed/catalog/types";

// Verifies the check-models per-provider required-flag invariant: anthropic must set
// strictRoleAlternation; deepseek/zai/zaicoding must set supportsPrefixCompletion.

function row(overrides: Partial<LlmInput> & Pick<LlmInput, "provider" | "codename">): LlmInput {
  return { desc: null, ja: null, ...overrides };
}

describe("collectStrictChatFlagViolations", () => {
  it("passes when required flags are present", () => {
    const rows: LlmInput[] = [
      row({ provider: "anthropic", codename: "claude-x", strictRoleAlternation: true }),
      row({ provider: "deepseek", codename: "ds-x", supportsPrefixCompletion: true }),
      row({ provider: "zai", codename: "zai/glm", supportsPrefixCompletion: true }),
      row({ provider: "zaicoding", codename: "glm", supportsPrefixCompletion: true }),
      row({ provider: "google", codename: "gemini" }), // no requirement
    ];
    expect(collectStrictChatFlagViolations(rows)).toEqual([]);
  });

  it("flags an anthropic model missing strictRoleAlternation", () => {
    const violations = collectStrictChatFlagViolations([row({ provider: "anthropic", codename: "claude-x" })]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("strictRoleAlternation");
  });

  it("flags a deepseek/zai/zaicoding model missing supportsPrefixCompletion", () => {
    for (const provider of ["deepseek", "zai", "zaicoding"]) {
      const violations = collectStrictChatFlagViolations([row({ provider, codename: "m" })]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("supportsPrefixCompletion");
    }
  });
});

describe("validateModels (real catalog)", () => {
  it("has no strict chat-completion invariant violations", () => {
    // The full catalog must satisfy every invariant, including the new required flags.
    expect(validateModels()).toEqual([]);
  });
});
