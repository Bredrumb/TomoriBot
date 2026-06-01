import { describe, expect, it } from "bun:test";
import { ReasoningContentSpillGuard } from "@/providers/utils/reasoningContentSpillGuard";

describe("ReasoningContentSpillGuard", () => {
  it("strips a reasoning tail glued to the first visible answer", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("Let me go with figuring it out and being playful with ");

    expect(guard.filterContent("the reveal.Wrrrf... lemme chew on this bone.")).toEqual({
      content: "Wrrrf... lemme chew on this bone.",
      spilledThought: "the reveal.",
      changed: true,
    });
  });

  it("waits for the next chunk before deciding on a lowercase first fragment", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("hidden reasoning");

    expect(guard.filterContent("the reveal.")).toEqual({
      content: "",
      changed: true,
    });
    expect(guard.filterContent("Wrrrf...")).toEqual({
      content: "Wrrrf...",
      spilledThought: "the reveal.",
      changed: true,
    });
  });

  it("does not treat decimal points as sentence boundaries while holding a reasoning tail", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("then the bat would be ");

    expect(guard.filterContent("totaling $1.20.")).toEqual({
      content: "",
      changed: true,
    });
    expect(guard.filterContent("Bel")).toEqual({
      content: "Bel",
      spilledThought: "totaling $1.20.",
      changed: true,
    });
  });

  it("does not strip a normal lowercase answer sentence", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("hidden reasoning");

    expect(guard.filterContent("the ball costs five cents. The bat costs $1.05.")).toEqual({
      content: "the ball costs five cents. The bat costs $1.05.",
      changed: false,
    });
  });
});
