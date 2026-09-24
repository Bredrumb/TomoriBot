import { describe, expect, it } from "bun:test";
import { MAX_PROMPT_PREVIEW, formatPromptPreview } from "@/utils/metrics/status/sharedFormatters";
import { getDiscordTextLength } from "@/utils/text/discordTextLimits";
import { localizer } from "@/utils/text/localizer";

describe("formatPromptPreview", () => {
  const locale = "en-US";
  const clippedNotice = localizer(locale, "commands.status.field_preview_clipped");

  it("enforces the 1,024 codepoint Discord embed field limit across varied input sizes", () => {
    const testSizes = [0, 1, 900, 1023, 1024, 3800, 10000];

    for (const size of testSizes) {
      const input = "a".repeat(size);
      const preview = formatPromptPreview(input, locale);
      const length = getDiscordTextLength(preview);

      expect(length).toBeLessThanOrEqual(1024);

      if (size <= 900) {
        expect(preview.includes(clippedNotice)).toBe(false);
      } else {
        expect(preview.includes(clippedNotice)).toBe(true);
      }
    }
  });

  it("preserves astral plane emoji clusters without producing lone surrogates", () => {
    const astralChar = "🎉";
    const input = astralChar.repeat(1200);
    const preview = formatPromptPreview(input, locale);

    expect(getDiscordTextLength(preview)).toBeLessThanOrEqual(1024);
    expect(preview.includes(clippedNotice)).toBe(true);

    const hasLoneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(preview);
    expect(hasLoneSurrogate).toBe(false);
  });

  it("neutralizes backtick runs so the code fence is never broken", () => {
    const runLengths = [3, 4, 5, 6, 8];

    for (const runLength of runLengths) {
      const input = `pre ${"`".repeat(runLength)} post`;
      const preview = formatPromptPreview(input, locale);

      expect(getDiscordTextLength(preview)).toBeLessThanOrEqual(1024);
      expect(preview.startsWith("```\n")).toBe(true);

      const closingFenceIndex = preview.indexOf("\n```");
      expect(closingFenceIndex).toBeGreaterThan(0);

      const interior = preview.slice(4, closingFenceIndex);
      expect(interior.includes("```")).toBe(false);
    }
  });

  it("caps an over-long prompt at the smaller of the preview limit and the embed field budget", () => {
    const input = "x".repeat(MAX_PROMPT_PREVIEW * 2);
    const preview = formatPromptPreview(input, locale);

    expect(preview.includes(clippedNotice)).toBe(true);
    expect(getDiscordTextLength(preview)).toBeLessThanOrEqual(1024);

    const bodyEnd = preview.indexOf("\n```\n");
    expect(bodyEnd).toBeGreaterThan(0);
    const body = preview.slice(4, bodyEnd);
    // The fence scaffolding and the clipped notice are what keep the field inside 1,024
    // codepoints, so the body gives up that room before the preview limit itself binds.
    // The clipped body is the head of the input plus the truncation ellipsis.
    expect(body.endsWith("...")).toBe(true);
    expect(input.startsWith(body.slice(0, -3))).toBe(true);
    expect(body.length).toBeLessThan(MAX_PROMPT_PREVIEW);
  });
});
