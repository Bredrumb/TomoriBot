import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS,
  resolvePresetGenerationMaxOutputTokens,
} from "@/utils/provider/maxOutputTokens";

/**
 * The preset budget is larger than a chat reply's because the schema sizes the payload up to 16
 * string fields. It must still respect a ceiling the server set, or a capped deployment starts
 * sending requests larger than it allowed.
 */
describe("preset generation output budget", () => {
  test("uses the preset default when the server set no ceiling", () => {
    expect(resolvePresetGenerationMaxOutputTokens()).toBe(DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS);
    expect(resolvePresetGenerationMaxOutputTokens({ configured: null })).toBe(
      DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS,
    );
  });

  test("honors a server ceiling lower than the preset default", () => {
    expect(resolvePresetGenerationMaxOutputTokens({ configured: 4096 })).toBe(4096);
  });

  test("does not raise a small ceiling back up to the preset default", () => {
    // The ceiling is a cap, not a starting point: a server that allows 512 output tokens must
    // not have preset generation ask for 32 times that.
    expect(resolvePresetGenerationMaxOutputTokens({ configured: 512 })).toBe(512);
  });

  test("never exceeds the model's own reported ceiling", () => {
    expect(resolvePresetGenerationMaxOutputTokens({ modelCeiling: 8192 })).toBe(8192);
    expect(resolvePresetGenerationMaxOutputTokens({ configured: 4096, modelCeiling: 2048 })).toBe(2048);
  });

  test("ignores a non-positive ceiling rather than producing a zero budget", () => {
    expect(resolvePresetGenerationMaxOutputTokens({ configured: 0 })).toBe(DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS);
    expect(resolvePresetGenerationMaxOutputTokens({ configured: -1 })).toBe(
      DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS,
    );
  });
});
