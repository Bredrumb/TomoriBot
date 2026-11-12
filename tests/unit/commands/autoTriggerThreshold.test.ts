import { describe, expect, it } from "bun:test";
import {
  formatThresholdInput,
  MAX_THRESHOLD,
  MIN_RANDOM_THRESHOLD,
  MIN_THRESHOLD,
  parseThresholdInput,
  rollAutochatTarget,
  THRESHOLD_INPUT_MAX_LENGTH,
  validateThresholdInput,
} from "@/utils/discord/autoTriggerThreshold";

describe("/server auto-trigger threshold write plan", () => {
  describe("validateThresholdInput", () => {
    it("(0, 0) is valid and identifies as always-reply mode", () => {
      const result = validateThresholdInput(0, 0);
      expect(result.isValid).toBe(true);
      expect(result.isAlwaysReplyMode).toBe(true);
      expect(result.isRangeMode).toBe(false);
    });

    it("(n, n) with n >= 1 is valid fixed mode — not always-reply, not range", () => {
      const result = validateThresholdInput(50, 50);
      expect(result.isValid).toBe(true);
      expect(result.isAlwaysReplyMode).toBe(false);
      expect(result.isRangeMode).toBe(false);
    });

    it("(min, max) with min < max is valid range mode", () => {
      const result = validateThresholdInput(10, 100);
      expect(result.isValid).toBe(true);
      expect(result.isAlwaysReplyMode).toBe(false);
      expect(result.isRangeMode).toBe(true);
    });

    it("boundary: (1, 100) is valid range mode", () => {
      const result = validateThresholdInput(MIN_RANDOM_THRESHOLD, MAX_THRESHOLD);
      expect(result.isValid).toBe(true);
      expect(result.isRangeMode).toBe(true);
    });

    it("boundary: (100, 100) is valid fixed mode", () => {
      const result = validateThresholdInput(100, 100);
      expect(result.isValid).toBe(true);
      expect(result.isAlwaysReplyMode).toBe(false);
    });

    it("(0, 1) is invalid — mixed always-reply threshold with positive max", () => {
      const result = validateThresholdInput(0, 1);
      expect(result.isValid).toBe(false);
      expect(result.isAlwaysReplyMode).toBe(false);
    });

    it("(0, 100) is invalid — zero threshold requires zero max for always-reply mode", () => {
      const result = validateThresholdInput(0, 100);
      expect(result.isValid).toBe(false);
    });

    it("(5, 3) is invalid — max cannot be less than min", () => {
      const result = validateThresholdInput(5, 3);
      expect(result.isValid).toBe(false);
    });

    it("exposed constants match the command's min/max option constraints", () => {
      expect(MIN_THRESHOLD).toBe(0);
      expect(MIN_RANDOM_THRESHOLD).toBe(1);
      expect(MAX_THRESHOLD).toBe(100);
    });
  });

  describe("parseThresholdInput", () => {
    it("reads a flat number as a fixed count", () => {
      expect(parseThresholdInput("50")).toEqual({ threshold: 50, maxThreshold: 50 });
    });

    it("reads zero as always-reply", () => {
      expect(parseThresholdInput("0")).toEqual({ threshold: 0, maxThreshold: 0 });
    });

    it("reads a hyphenated range as min and max", () => {
      expect(parseThresholdInput("50-60")).toEqual({ threshold: 50, maxThreshold: 60 });
    });

    it("collapses an equal-ended range to the fixed pair the validator already accepts", () => {
      expect(parseThresholdInput("50-50")).toEqual({ threshold: 50, maxThreshold: 50 });
    });

    it("tolerates spaces around the hyphen and the ends", () => {
      expect(parseThresholdInput(" 5 - 6 ")).toEqual({ threshold: 5, maxThreshold: 6 });
    });

    it("keeps the modal field cap wide enough for a padded maximum range", () => {
      const padded = "  100  -  100  ";
      expect(padded.length).toBeLessThanOrEqual(THRESHOLD_INPUT_MAX_LENGTH);
      expect(parseThresholdInput(padded)).toEqual({ threshold: 100, maxThreshold: 100 });
    });

    it("returns null for text that is neither a number nor a range", () => {
      for (const value of ["", "abc", "5-", "-5", "1-2-3", "50.5", "+5", "1 000"]) {
        expect(parseThresholdInput(value)).toBeNull();
      }
    });

    it("leaves range validity to validateThresholdInput", () => {
      const parsed = parseThresholdInput("0-5");
      const validation = parsed ? validateThresholdInput(parsed.threshold, parsed.maxThreshold) : null;
      expect(parsed).toEqual({ threshold: 0, maxThreshold: 5 });
      expect(validation?.isValid).toBe(false);
    });
  });

  describe("formatThresholdInput", () => {
    it("prefills each mode in the same shape the field accepts", () => {
      expect(formatThresholdInput(0, 0)).toBe("0");
      expect(formatThresholdInput(50, 50)).toBe("50");
      expect(formatThresholdInput(50, 60)).toBe("50-60");
    });

    it("round-trips every valid pair through the parser", () => {
      for (const [threshold, maxThreshold] of [
        [0, 0],
        [1, 1],
        [100, 100],
        [1, 100],
      ] as const) {
        expect(parseThresholdInput(formatThresholdInput(threshold, maxThreshold))).toEqual({ threshold, maxThreshold });
      }
    });
  });

  describe("rollAutochatTarget", () => {
    it("returns the exact value for equal min and max (fixed mode)", () => {
      expect(rollAutochatTarget(42, 42)).toBe(42);
    });

    it("returns 0 when minThreshold is 0 (degenerate guard)", () => {
      expect(rollAutochatTarget(0, 0)).toBe(0);
    });

    it("returns 0 when maxThreshold is 0 (degenerate guard)", () => {
      expect(rollAutochatTarget(5, 0)).toBe(0);
    });

    it("returns a value within [min, max] inclusive for a range", () => {
      for (let i = 0; i < 50; i++) {
        const target = rollAutochatTarget(10, 20);
        expect(target).toBeGreaterThanOrEqual(10);
        expect(target).toBeLessThanOrEqual(20);
      }
    });

    it("returns an integer for a range", () => {
      const target = rollAutochatTarget(1, 100);
      expect(Number.isInteger(target)).toBe(true);
    });
  });
});
