import { describe, expect, test } from "bun:test";
import {
  extractPresetGenerationFields,
  PRESET_ATTRIBUTE_COUNT,
  PRESET_DIALOGUE_PAIR_COUNT,
  PRESET_SCHEMA_MISS_CODES,
  presetGenerationFailureErrorType,
  presetGenerationFailureMessage,
  sanitizeSampleDialogueText,
  validatePresetGenerationFields,
} from "@/providers/utils/presetCommon";

/**
 * The preset contract lives in one helper that every provider calls, so these tests are the
 * only place the accepted shape and the user-facing failure text are stated. A provider that
 * regresses the counts is caught here rather than at the export schema, where the error names
 * a field path instead of the instruction the user needs.
 */
describe("preset generation field contract", () => {
  const valid = {
    attribute_list: ["a", "b", "c", "d", "e", "f"],
    sample_dialogues_in: ["1", "2", "3", "4", "5"],
    sample_dialogues_out: ["1", "2", "3", "4", "5"],
  };

  test("accepts a payload matching the prompt's counts", () => {
    const result = validatePresetGenerationFields(valid);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preset.attribute_list).toHaveLength(PRESET_ATTRIBUTE_COUNT);
      expect(result.preset.sample_dialogues_out).toHaveLength(PRESET_DIALOGUE_PAIR_COUNT);
    }
  });

  test("strips speaker prefixes from both dialogue lists", () => {
    const result = validatePresetGenerationFields({
      ...valid,
      sample_dialogues_in: ["User: hello", "{user}: hi", "plain", "{char}: mine", "Character: theirs"],
      sample_dialogues_out: ["Character: hey", "{{char}}: yo", "plain", "User: wrong side", "{character}: also wrong"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preset.sample_dialogues_in).toEqual(["hello", "hi", "plain", "mine", "theirs"]);
      expect(result.preset.sample_dialogues_out).toEqual(["hey", "yo", "plain", "wrong side", "also wrong"]);
    }
  });

  test("reports which field was the wrong length", () => {
    const short = validatePresetGenerationFields({ ...valid, attribute_list: ["a", "b"] });

    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.failure).toEqual({ code: "ATTRIBUTE_LIST", received: 2 });
      expect(presetGenerationFailureErrorType(short.failure)).toBe("VALIDATION_ERROR");
    }
  });

  test("treats a missing field as a schema miss rather than a parse failure", () => {
    const result = validatePresetGenerationFields({ attribute_list: valid.attribute_list });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("INCOMPLETE");
      expect(presetGenerationFailureErrorType(result.failure)).toBe("INVALID_JSON");
    }
  });

  test("rejects a bare array, which is not a preset object", () => {
    expect(validatePresetGenerationFields([valid]).ok).toBe(false);
  });

  test("keeps the user-facing messages the export schema cannot express", () => {
    const attributeMessage = presetGenerationFailureMessage({ code: "ATTRIBUTE_LIST", received: 3 });

    expect(attributeMessage).toContain(String(PRESET_ATTRIBUTE_COUNT));
    expect(presetGenerationFailureMessage({ code: "PARSE_FAILED" })).toContain("incomplete");
  });

  test("separates a schema miss from an unreadable response", () => {
    // Providers branch on this to decide whether the user needs their provider named or the
    // contract restated, so every code has to land on the intended side.
    for (const code of ["ATTRIBUTE_LIST", "DIALOGUES_IN", "DIALOGUES_OUT"] as const) {
      expect(presetGenerationFailureErrorType({ code })).toBe("VALIDATION_ERROR");
      expect(PRESET_SCHEMA_MISS_CODES).toContain(code);
    }

    for (const code of ["UNPARSABLE", "PARSE_FAILED", "INCOMPLETE"] as const) {
      expect(presetGenerationFailureErrorType({ code })).toBe("INVALID_JSON");
      expect(PRESET_SCHEMA_MISS_CODES).not.toContain(code);
    }
  });
});

describe("preset generation response extraction", () => {
  const validJson = JSON.stringify({
    attribute_list: ["a", "b", "c", "d", "e", "f"],
    sample_dialogues_in: ["1", "2", "3", "4", "5"],
    sample_dialogues_out: ["1", "2", "3", "4", "5"],
  });

  test("parses a well-formed response", () => {
    const result = extractPresetGenerationFields(validJson, JSON.parse, () => {});

    expect(result.ok).toBe(true);
  });

  test("recovers the finished fields from a response cut off mid-payload", () => {
    // Cut inside the last dialogue, so the attributes and the whole input list survived.
    const truncated = `${validJson.slice(0, validJson.lastIndexOf('"5"]'))}"5`;

    const result = extractPresetGenerationFields(truncated, JSON.parse, () => {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual({ code: "DIALOGUES_OUT", received: 4 });
    }
  });

  test("drops a field whose first element never arrived", () => {
    const truncated = `{"attribute_list": ["a", "b", "c", "d", "e", "f"], "sample_dialogues_in": ["1", "2", "3", "4", "5"], "sample_dialogues_out": [`;

    const result = extractPresetGenerationFields(truncated, JSON.parse, () => {});

    // An empty list is dropped rather than closed, because closing it would hand the caller
    // a field the model never produced.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("INCOMPLETE");
    }
  });

  test("reports a payload no parser can read as a parse failure", () => {
    const result = extractPresetGenerationFields("not json at all", JSON.parse, () => {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("PARSE_FAILED");
      expect(presetGenerationFailureErrorType(result.failure)).toBe("INVALID_JSON");
    }
  });

  test("carries a provider's own parser through, including its repair", () => {
    const providerParser = (raw: string): unknown => JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));

    const result = extractPresetGenerationFields(`\`\`\`json\n${validJson}\n\`\`\``, providerParser, () => {});

    expect(result.ok).toBe(true);
  });

  test("surfaces the parser's own message, which the failure code cannot carry", () => {
    const details: string[] = [];

    extractPresetGenerationFields("<html>gateway timeout</html>", JSON.parse, (detail) => details.push(detail));

    // An HTML error page from a proxy parses as badly as a truncation but reads nothing like
    // one, so the parser's reason has to survive alongside the code.
    expect(details).toHaveLength(1);
    expect(details[0]).toContain("Unrecognized token");
  });

  test("stays silent when the parser succeeds", () => {
    const details: string[] = [];

    extractPresetGenerationFields(validJson, JSON.parse, (detail) => details.push(detail));

    expect(details).toEqual([]);
  });
});

describe("sample dialogue sanitization", () => {
  test("leaves an empty dialogue empty rather than producing whitespace", () => {
    expect(sanitizeSampleDialogueText("")).toBe("");
  });
});
