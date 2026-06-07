import { describe, expect, it } from "bun:test";
import { applyAssistantPrefixCompletion, providerRequiresPrefixCompletion } from "@/providers/utils/strictChatCompat";

// Golden-body regression for the assistant prefix-completion seam that deepseek/zai/zaicoding now
// delegate to OpenAICompatibleStreamAdapter. The adapter resolves:
//   enablePrefix = providerRequiresPrefixCompletion(provider) || (llm.supports_prefix_completion ?? false)
//   if (enablePrefix) applyAssistantPrefixCompletion(requestBody, outputPrefill)
// This proves the three built-ins still emit `prefix: true` on the trailing prefill turn (ON via
// the safety net even with the column unread), byte-identical to their previous inline blocks,
// while a non-prefix provider with the column OFF emits no prefix.

/** Reproduce the adapter seam: build a representative body and apply the resolved prefix flag. */
function buildBody(provider: string, llmFlag: boolean, prefill: string): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    model: "m",
    stream: true,
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: prefill },
    ],
  };
  const enablePrefix = providerRequiresPrefixCompletion(provider) || llmFlag;
  if (enablePrefix) {
    applyAssistantPrefixCompletion(requestBody, prefill.trim());
  }
  return requestBody;
}

describe("built-in prefix-completion golden bodies", () => {
  const prefill = "Sure, here";

  for (const provider of ["deepseek", "zai", "zaicoding"]) {
    it(`${provider}: sets prefix:true on the trailing assistant turn (column OFF, safety net ON)`, () => {
      const body = buildBody(provider, false, prefill);
      expect(body).toEqual({
        model: "m",
        stream: true,
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: prefill, prefix: true },
        ],
      });
    });
  }

  it("non-prefix provider with column OFF emits no prefix", () => {
    const body = buildBody("nvidia", false, prefill);
    expect((body.messages as Array<Record<string, unknown>>).at(-1)?.prefix).toBeUndefined();
  });

  it("non-prefix provider with the endpoint column ON opts in", () => {
    const body = buildBody("custom", true, prefill);
    expect((body.messages as Array<Record<string, unknown>>).at(-1)?.prefix).toBe(true);
  });
});
