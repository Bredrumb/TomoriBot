import { describe, expect, it } from "bun:test";
import { selectUnclaimedTriggerWords } from "@/utils/text/triggerWords";

describe("selectUnclaimedTriggerWords", () => {
  it("drops candidates already owned by another persona (case-insensitive)", () => {
    // The shared "tomori" is owned by the main persona, so an alter keeps only its name.
    const kept = selectUnclaimedTriggerWords(["Tomori", "Lilya"], ["tomori", "rose"], { lowercase: false });
    expect(kept).toEqual(["Lilya"]);
  });

  it("preserves original casing of kept words when lowercase is false", () => {
    const kept = selectUnclaimedTriggerWords(["Aphel"], [], { lowercase: false });
    expect(kept).toEqual(["Aphel"]);
  });

  it("lowercases kept words by default", () => {
    const kept = selectUnclaimedTriggerWords(["Aphel"], []);
    expect(kept).toEqual(["aphel"]);
  });

  it("de-duplicates candidates against each other", () => {
    const kept = selectUnclaimedTriggerWords(["lilya", "Lilya", "LILYA"], [], { lowercase: false });
    expect(kept).toEqual(["lilya"]);
  });

  it("skips blank, whitespace-only, and quote-wrapped-empty candidates", () => {
    const kept = selectUnclaimedTriggerWords(["", "   ", '""', "valid"], [], { lowercase: false });
    expect(kept).toEqual(["valid"]);
  });

  it("strips surrounding quotes before comparing against claimed words", () => {
    // '"tomori"' normalizes to "tomori", which is already claimed.
    const kept = selectUnclaimedTriggerWords(['"tomori"', "lilya"], ["tomori"], { lowercase: false });
    expect(kept).toEqual(["lilya"]);
  });

  it("returns an empty array when every candidate is already claimed", () => {
    // Mirrors a second identical alter: both its words are owned by higher-priority personas.
    const kept = selectUnclaimedTriggerWords(["tomori", "rose"], ["tomori", "rose"], { lowercase: false });
    expect(kept).toEqual([]);
  });

  it("accepts a Set of claimed words", () => {
    const claimed = new Set(["tomori"]);
    const kept = selectUnclaimedTriggerWords(["tomori", "lilya"], claimed, { lowercase: false });
    expect(kept).toEqual(["lilya"]);
  });
});
