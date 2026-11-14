import { describe, expect, it } from "bun:test";
import { THINKING_LEVEL_VALUES } from "@/constants/thinkingLevels";
import { buildAnthropicThinkingRequest } from "@/utils/provider/thinkingControl";

// Each answers a non-default `temperature` or any `top_p` with a 400, whatever the thinking mode.
const SAMPLING_LOCKED_MODELS = [
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-fable-5",
  "claude-fable-5-1",
];

describe("buildAnthropicThinkingRequest", () => {
  it("uses each model's accepted effort above high", () => {
    for (const [model, effort] of [
      ["claude-opus-5-5", "xhigh"],
      ["claude-sonnet-5-5", "xhigh"],
      ["claude-haiku-5-5", "xhigh"],
      ["claude-fable-5-2", "xhigh"],
      ["claude-opus-5", "xhigh"],
      ["claude-sonnet-5", "xhigh"],
      ["claude-opus-4-8", "xhigh"],
      ["claude-opus-4-7", "xhigh"],
      ["claude-opus-4-6", "max"],
      ["claude-sonnet-4-6", "max"],
      ["claude-mythos-preview", "max"],
    ] as const) {
      expect(buildAnthropicThinkingRequest(model, "xhigh")).toEqual({
        thinking: { type: "adaptive" },
        output_config: { effort },
        omitSampling: true,
      });
    }
    expect(buildAnthropicThinkingRequest("claude-haiku-4-5", "xhigh")).toEqual({ omitSampling: false });
  });

  it("never sends sampling parameters to a model that rejects them", () => {
    for (const model of SAMPLING_LOCKED_MODELS)
      for (const level of THINKING_LEVEL_VALUES)
        expect({ model, level, omit: buildAnthropicThinkingRequest(model, level).omitSampling }).toEqual({
          model,
          level,
          omit: true,
        });
  });

  it("turns thinking off only with the switch each model accepts", () => {
    // `disabled` is a 400 on these; Sonnet 5.5 names its own off switch and the rest cannot stop thinking.
    expect(buildAnthropicThinkingRequest("claude-sonnet-5-5", "none").thinking).toEqual({ type: "between_tools" });
    for (const model of ["claude-opus-5-5", "claude-fable-5", "claude-fable-5-1"])
      expect(buildAnthropicThinkingRequest(model, "none")).toMatchObject({
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
      });
    for (const model of ["claude-opus-4-7", "claude-sonnet-5", "claude-opus-5", "claude-sonnet-4-6"])
      expect(buildAnthropicThinkingRequest(model, "none").thinking).toEqual({ type: "disabled" });
  });

  it("keeps sampling with thinking off on models that still accept it", () => {
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-6"])
      expect(buildAnthropicThinkingRequest(model, "none").omitSampling).toBe(false);
  });
});
