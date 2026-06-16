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

  it("strips a tagless glued seam whose first sentence matches no vocabulary list", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("Length should stay moderate so it shouldn't run excessive paragraph");

    // "must do" hits neither the old meta nor continuation lists; the glued period is
    // the only signal, and it is sufficient on its own.
    expect(guard.filterContent("s either.Yes indeed I have!")).toEqual({
      content: "Yes indeed I have!",
      spilledThought: "s either.",
      changed: true,
    });
  });

  it("treats an emoji answer start after a glued period as a spill seam", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("hidden reasoning");

    expect(guard.filterContent("lemme think.😊 hi there")).toEqual({
      content: "😊 hi there",
      spilledThought: "lemme think.",
      changed: true,
    });
  });

  it("treats a CJK answer start after a glued period as a spill seam", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("hidden reasoning");

    expect(guard.filterContent("must do.こんにちは")).toEqual({
      content: "こんにちは",
      spilledThought: "must do.",
      changed: true,
    });
  });

  it("consumes an ellipsis run so no stray dots leak into the answer", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("hidden reasoning");

    expect(guard.filterContent("let me wait...Hello")).toEqual({
      content: "Hello",
      spilledThought: "let me wait...",
      changed: true,
    });
  });

  it("preserves a dotted code identifier inside an inline-code span", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("hidden reasoning");

    // The period sits inside backticks, so it is intentional code, not a spill seam.
    expect(guard.filterContent("use the `obj.Method` helper")).toEqual({
      content: "use the `obj.Method` helper",
      changed: false,
    });
  });

  it("strips a single-word glued seam — word count does not matter, only the missing space", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("hidden reasoning");

    expect(guard.filterContent("wait.Actually let me reconsider")).toEqual({
      content: "Actually let me reconsider",
      spilledThought: "wait.",
      changed: true,
    });
  });

  it("leaves a spaced boundary (the model writing two real sentences) untouched", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("hidden reasoning");

    expect(guard.filterContent("wait. Actually let me reconsider")).toEqual({
      content: "wait. Actually let me reconsider",
      changed: false,
    });
  });

  it("does NOT strip a spaced boundary even when the first sentence reads as meta", () => {
    const guard = new ReasoningContentSpillGuard("test");
    guard.reset();
    guard.observeReasoning("hidden reasoning");

    // Spaced boundary = genuine prose shape. The old meta-word list would have stripped
    // "the playful answer." here; the glued-only rule correctly emits it untouched.
    expect(guard.filterContent("the playful answer. Hello there.")).toEqual({
      content: "the playful answer. Hello there.",
      changed: false,
    });
  });
});
