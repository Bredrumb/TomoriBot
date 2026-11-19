import { describe, expect, it } from "bun:test";
import { applyAssistantPrefixCompletion, providerRequiresPrefixCompletion } from "@/providers/utils/strictChatCompat";

// Mirrors OpenAICompatibleStreamAdapter's prefix-completion seam so built-ins default to `prefix: true` even when
// the column is false.

function buildBody(
  provider: string,
  llmFlag: boolean,
  prefill: string,
  requiresReasoningContent?: boolean,
): Record<string, unknown> {
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
    applyAssistantPrefixCompletion(requestBody, prefill.trim(), requiresReasoningContent);
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

  it("deepseek (only, via requiresReasoningContentReplay) also stamps reasoning_content on the prefix turn", () => {
    // DeepSeek thinking mode rejects a `prefix: true` turn missing `reasoning_content` (HTTP 400), so only DeepSeek
    // sets requiresReasoningContentReplay.
    const deepseekBody = buildBody("deepseek", false, prefill, true);
    expect(deepseekBody).toEqual({
      model: "m",
      stream: true,
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: prefill, prefix: true, reasoning_content: "" },
      ],
    });

    for (const provider of ["zai", "zaicoding"]) {
      const body = buildBody(provider, false, prefill, false);
      expect((body.messages as Array<Record<string, unknown>>).at(-1)?.reasoning_content).toBeUndefined();
    }
  });
});
