import { describe, expect, it } from "bun:test";
import { createSentenceSplitRegex } from "@/utils/text/processors/chunkProcessor";

// The regex is a negative-lookbehind split: it matches sentence-ending periods
// that do NOT follow abbreviations, numbers, or acronyms. Tests verify both
// the "splits here" and "does NOT split here" cases, which are equally load-bearing.

describe("createSentenceSplitRegex", () => {
  let regex: RegExp;

  // Rebuild the regex before each test: the regex has state via lastIndex when
  // used with exec(), so a fresh instance avoids cross-test interference.
  const getRegex = () => createSentenceSplitRegex();

  describe("splits at standard sentence-ending periods", () => {
    it("splits 'Hello. World' into two parts", () => {
      regex = getRegex();
      const parts = "Hello. World".split(regex);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[0]).toBe("Hello");
    });

    it("splits at end-of-string period", () => {
      regex = getRegex();
      const parts = "Done.".split(regex);
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });

    it("splits multiple sentences", () => {
      regex = getRegex();
      const parts = "First. Second. Third.".split(regex).filter((s) => s?.trim());
      expect(parts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("does NOT split on title abbreviations", () => {
    it("does not split 'Dr. Smith'", () => {
      regex = getRegex();
      const parts = "Dr. Smith visited".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Dr. Smith visited");
    });

    it("does not split 'Mr. Jones'", () => {
      regex = getRegex();
      const parts = "Hello Mr. Jones".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Hello Mr. Jones");
    });

    it("does not split 'Mrs. Smith'", () => {
      regex = getRegex();
      const parts = "Mrs. Smith arrived".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Mrs. Smith arrived");
    });

    it("does not split 'Prof. Adams'", () => {
      regex = getRegex();
      const parts = "Prof. Adams taught".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Prof. Adams taught");
    });
  });

  describe("does NOT split on business abbreviations", () => {
    it("does not split 'Inc. founded'", () => {
      regex = getRegex();
      const parts = "Acme Inc. founded in 1990".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Acme Inc. founded in 1990");
    });

    it("does not split 'vs. opponent'", () => {
      regex = getRegex();
      const parts = "Team A vs. Team B".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Team A vs. Team B");
    });
  });

  describe("does NOT split on numbers", () => {
    it("does not split decimal number '3.14'", () => {
      regex = getRegex();
      const parts = "Pi is 3.14 approximately".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Pi is 3.14 approximately");
    });

    it("does not split numbered list like '1. Item'", () => {
      regex = getRegex();
      const parts = "Step 1. Do this".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Step 1. Do this");
    });
  });

  describe("acronym trailing-period behavior (known limitation)", () => {
    // The lookbehind guards mid-sequence dots (e.g. the dot between U and S in U.S.)
    // but the character immediately before the *final* trailing period is always a letter,
    // not a dot so the acronym guard does not fire on the trailing dot.
    // "U.S. is large" → the period after S IS matched and consumed by the split.
    it("splits trailing period of 'U.S.' (lookbehind does not cover the final dot)", () => {
      regex = getRegex();
      const text = "The U.S. is large";
      const parts = text.split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("The U.S is large");
    });
  });

  describe("splits on Japanese sentence period 。", () => {
    it("splits 'こんにちは。世界'", () => {
      regex = getRegex();
      const parts = "こんにちは。世界".split(regex).filter((s) => s?.trim());
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });

    it("splits mixed Japanese and English", () => {
      regex = getRegex();
      const parts = "Hello。World".split(regex).filter((s) => s?.trim());
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("does NOT split on latin abbreviations", () => {
    it("does not split 'etc. more'", () => {
      regex = getRegex();
      const parts = "blah etc. more stuff".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("blah etc. more stuff");
    });

    it("does not split 'e.g. example'", () => {
      regex = getRegex();
      const parts = "for e.g. this case".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("for e.g. this case");
    });
  });
});
