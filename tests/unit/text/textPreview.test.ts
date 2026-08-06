import { describe, expect, it } from "bun:test";
import {
  buildTextPreview,
  CONFIRMATION_PREVIEW_BUDGET,
  CV2_TEXT_PREVIEW_BUDGET,
  textPreviewFooterKey,
  textPreviewFooterVars,
} from "@/utils/text/textPreview";

describe("buildTextPreview", () => {
  it("passes short text through untouched", () => {
    const preview = buildTextPreview("You are Ellen, a sharp-tongued librarian.");
    expect(preview.text).toBe("You are Ellen, a sharp-tongued librarian.");
    expect(preview.truncated).toBe(false);
    expect(preview.shownChars).toBe(41);
    expect(preview.totalChars).toBe(41);
  });

  it("trims surrounding whitespace before measuring", () => {
    const preview = buildTextPreview("\n\n  hello  \n");
    expect(preview.text).toBe("hello");
    expect(preview.totalChars).toBe(5);
  });

  it.each([[null], [undefined], [""], ["   \n  "]])("treats %p as having no content", (input) => {
    const preview = buildTextPreview(input);
    expect(preview.totalChars).toBe(0);
    expect(preview.text).toBe("");
    expect(preview.truncated).toBe(false);
  });

  it("neutralizes triple backticks so user text cannot escape the fence", () => {
    // A prompt containing its own code block would otherwise close the fence
    // the locale string wraps it in, mangling the rest of the card.
    const preview = buildTextPreview("intro\n```js\nalert(1)\n```\noutro");
    expect(preview.text).not.toContain("```");
    // Visible characters survive; only zero-width guards are interleaved.
    expect(preview.text.replaceAll("​", "")).toBe("intro\n```js\nalert(1)\n```\noutro");
  });

  it("neutralizes double backticks used as inline-code delimiters", () => {
    const preview = buildTextPreview("use ``code`` here");
    expect(preview.text).not.toContain("``");
  });

  it("leaves lone backticks alone", () => {
    // A single backtick cannot close a fence, so guarding it would only add noise.
    const preview = buildTextPreview("a ` b ` c");
    expect(preview.text).toBe("a ` b ` c");
  });

  it("truncates to the budget and reports counts against the original text", () => {
    const preview = buildTextPreview("x".repeat(7412));
    expect(preview.truncated).toBe(true);
    expect(preview.shownChars).toBe(CV2_TEXT_PREVIEW_BUDGET);
    expect(preview.totalChars).toBe(7412);
  });

  it("honors a caller-supplied budget", () => {
    const preview = buildTextPreview("abcdefghij", 4);
    expect(preview.text).toBe("abcd");
    expect(preview.truncated).toBe(true);
    expect(preview.shownChars).toBe(4);
    expect(preview.totalChars).toBe(10);
  });

  it("does not mark text sitting exactly on the budget as truncated", () => {
    const preview = buildTextPreview("abcd", 4);
    expect(preview.truncated).toBe(false);
    expect(preview.text).toBe("abcd");
  });

  it("leaves short confirmation previews unmarked", () => {
    // Regression guard for the old `{preview}...` locale strings, which claimed
    // truncation even for text far under the preview width.
    const preview = buildTextPreview("Speak warmly.", CONFIRMATION_PREVIEW_BUDGET);
    expect(preview.truncated).toBe(false);
    expect(textPreviewFooterKey(preview)).toBeUndefined();
  });

  it("marks confirmation previews that genuinely overflow", () => {
    const preview = buildTextPreview("y".repeat(4120), CONFIRMATION_PREVIEW_BUDGET);
    expect(preview.shownChars).toBe(CONFIRMATION_PREVIEW_BUDGET);
    expect(textPreviewFooterVars(preview)).toEqual({ shown: "200", total: "4,120" });
  });
});

describe("textPreviewFooter helpers", () => {
  it("omits the footer when nothing was cut", () => {
    expect(textPreviewFooterKey(buildTextPreview("short"))).toBeUndefined();
  });

  it("returns the shared truncation footer with separated counts", () => {
    const preview = buildTextPreview("x".repeat(7412));
    expect(textPreviewFooterKey(preview)).toBe("general.text_preview.truncated_footer");
    expect(textPreviewFooterVars(preview)).toEqual({ shown: "3,000", total: "7,412" });
  });
});
