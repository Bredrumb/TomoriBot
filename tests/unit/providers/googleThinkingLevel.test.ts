import { describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@google/genai";
import { buildGoogleThinkingConfig } from "@/utils/provider/thinkingControl";

const MINIMAL_REJECTING_MODELS = [
  "gemini-3-pro-preview",
  "gemini-3.1-pro",
  "gemini-3.5-pro",
  "gemini-3.1-pro-preview-customtools",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
];

describe("buildGoogleThinkingConfig", () => {
  it("caps extra-high at the existing high enum or token budget", () => {
    expect(buildGoogleThinkingConfig("gemini-3.1-pro", "xhigh")).toEqual({ thinkingLevel: ThinkingLevel.HIGH });
    expect(buildGoogleThinkingConfig("gemini-2.5-pro", "xhigh")).toEqual({ thinkingBudget: 8192 });
  });

  // These models answer MINIMAL with a 400, so the lowest levels must clamp to LOW for them.
  it("never sends MINIMAL to a model that rejects it", () => {
    for (const model of MINIMAL_REJECTING_MODELS) {
      for (const level of ["none", "minimal"]) {
        expect(buildGoogleThinkingConfig(model, level)).toEqual({ thinkingLevel: ThinkingLevel.LOW });
      }
    }
  });

  it("keeps MINIMAL for Flash models that accept it", () => {
    for (const model of ["gemini-3-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash"]) {
      expect(buildGoogleThinkingConfig(model, "minimal")).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    }
  });
});
