import { describe, expect, it } from "bun:test";
import { BASE_TRIGGER_WORDS, isBaseTriggerWordMatch } from "@/utils/chat/errorVisibility";

// Derive a Latin base word from BASE_TRIGGER_WORDS because it reads env at import time and Japanese words bypass
// boundary matching.
const latinBaseWord = BASE_TRIGGER_WORDS.find((word) => /^[a-z]+$/i.test(word));

describe("isBaseTriggerWordMatch", () => {
  it.skipIf(!latinBaseWord)("matches a base trigger word on its own", () => {
    expect(isBaseTriggerWordMatch(`hey ${latinBaseWord}, are you there?`)).toBe(true);
  });

  it.skipIf(!latinBaseWord)("does not match a base trigger word abutting an accented letter", () => {
    // Boundary semantics themselves live in tests/unit/text/regexUtils.test.ts; this only
    // pins that this call site routes through the Unicode-aware boundary.
    expect(isBaseTriggerWordMatch(`this message only contains the unrelated word prä${latinBaseWord}`)).toBe(false);
  });
});
