import { describe, expect, it } from "bun:test";
import {
  findMarkdownCodeRanges,
  isGenericSpeakerStopLabel,
  truncateBeforeGenericSpeakerLine,
} from "@/utils/text/processors/llmOutputProcessor";

// ─── findMarkdownCodeRanges ──────────────────────────────────────────────────

describe("findMarkdownCodeRanges", () => {
  it("returns empty array when no backticks present", () => {
    expect(findMarkdownCodeRanges("hello world")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(findMarkdownCodeRanges("")).toEqual([]);
  });

  describe("inline code spans", () => {
    it("detects a single inline code span", () => {
      const ranges = findMarkdownCodeRanges("`code`");
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toEqual({ start: 0, end: 6 });
    });

    it("detects multiple inline code spans", () => {
      const ranges = findMarkdownCodeRanges("`a` and `b`");
      expect(ranges).toHaveLength(2);
      expect(ranges[0]).toEqual({ start: 0, end: 3 });
      expect(ranges[1]).toEqual({ start: 8, end: 11 });
    });

    it("extends to end of string on unclosed backtick", () => {
      const text = "`open";
      const ranges = findMarkdownCodeRanges(text);
      expect(ranges).toHaveLength(1);
      expect(ranges[0].start).toBe(0);
      expect(ranges[0].end).toBe(text.length);
    });
  });

  describe("triple-backtick code blocks", () => {
    it("detects a fenced code block", () => {
      const text = "```\nhello\n```";
      const ranges = findMarkdownCodeRanges(text);
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toEqual({ start: 0, end: text.length });
    });

    it("detects code block with language tag", () => {
      const text = "```ts\nconst x = 1;\n```";
      const ranges = findMarkdownCodeRanges(text);
      expect(ranges).toHaveLength(1);
      expect(ranges[0].start).toBe(0);
      expect(ranges[0].end).toBe(text.length);
    });
  });

  describe("mixed inline and block", () => {
    it("detects both inline code and a code block in the same string", () => {
      const text = "`inline` then ```block``` here";
      const ranges = findMarkdownCodeRanges(text);
      expect(ranges).toHaveLength(2);
    });
  });
});

// ─── isGenericSpeakerStopLabel ───────────────────────────────────────────────

describe("isGenericSpeakerStopLabel", () => {
  describe("valid speaker labels", () => {
    it("accepts 'User'", () => {
      expect(isGenericSpeakerStopLabel("User")).toBe(true);
    });
    it("accepts 'Assistant'", () => {
      expect(isGenericSpeakerStopLabel("Assistant")).toBe(true);
    });
    it("accepts labels with underscores", () => {
      expect(isGenericSpeakerStopLabel("Character_Name")).toBe(true);
    });
    it("accepts labels with numbers", () => {
      expect(isGenericSpeakerStopLabel("Speaker2")).toBe(true);
    });
    it("accepts labels with leading/trailing whitespace (trimmed internally)", () => {
      expect(isGenericSpeakerStopLabel("  User  ")).toBe(true);
    });
  });

  describe("invalid speaker labels", () => {
    it("rejects empty string", () => {
      expect(isGenericSpeakerStopLabel("")).toBe(false);
    });
    it("rejects whitespace-only string", () => {
      expect(isGenericSpeakerStopLabel("   ")).toBe(false);
    });
    it("rejects labels starting with '['", () => {
      expect(isGenericSpeakerStopLabel("[User]")).toBe(false);
    });
    it("rejects labels starting with '<'", () => {
      expect(isGenericSpeakerStopLabel("<tag>")).toBe(false);
    });
    it("rejects labels longer than 64 characters", () => {
      expect(isGenericSpeakerStopLabel("a".repeat(65))).toBe(false);
    });
    it("accepts labels exactly 64 characters long", () => {
      expect(isGenericSpeakerStopLabel("a".repeat(64))).toBe(true);
    });
  });
});

// ─── truncateBeforeGenericSpeakerLine ────────────────────────────────────────

describe("truncateBeforeGenericSpeakerLine", () => {
  describe("no speaker present — pass through unchanged", () => {
    it("returns text unchanged when no speaker line found", () => {
      const result = truncateBeforeGenericSpeakerLine("Hello world");
      expect(result).toEqual({ text: "Hello world", stopTriggered: false });
    });

    it("returns empty string unchanged", () => {
      const result = truncateBeforeGenericSpeakerLine("");
      expect(result).toEqual({ text: "", stopTriggered: false });
    });

    it("does not trigger on a lone colon mid-sentence", () => {
      const result = truncateBeforeGenericSpeakerLine("time: 3pm");
      expect(result.stopTriggered).toBe(false);
    });
  });

  describe("speaker at a newline — truncate", () => {
    it("truncates at '\\nUser:'", () => {
      const result = truncateBeforeGenericSpeakerLine("Some text\nUser: more text");
      expect(result.text).toBe("Some text");
      expect(result.stopTriggered).toBe(true);
      expect(result.matchedSpeaker).toBe("User");
    });

    it("truncates at '\\nAssistant:'", () => {
      const result = truncateBeforeGenericSpeakerLine("Reply here\nAssistant: continuation");
      expect(result.text).toBe("Reply here");
      expect(result.stopTriggered).toBe(true);
      expect(result.matchedSpeaker).toBe("Assistant");
    });

    it("truncates at the first speaker line when multiple are present", () => {
      const result = truncateBeforeGenericSpeakerLine("Intro\nUser: A\nAssistant: B");
      expect(result.text).toBe("Intro");
      expect(result.matchedSpeaker).toBe("User");
    });
  });

  describe("speaker inside code block — skip", () => {
    it("does not trigger on speaker label inside triple-backtick block", () => {
      const text = "```\nUser: in code\n```\nActual text";
      const result = truncateBeforeGenericSpeakerLine(text);
      expect(result.stopTriggered).toBe(false);
      expect(result.text).toBe(text);
    });

    it("does not trigger on speaker label inside inline code", () => {
      const text = "Here is `User: example` and more text";
      const result = truncateBeforeGenericSpeakerLine(text);
      expect(result.stopTriggered).toBe(false);
    });
  });

  describe("includeStart option — also checks first line", () => {
    it("triggers on first-line speaker when includeStart is true", () => {
      const result = truncateBeforeGenericSpeakerLine("User: starts here", { includeStart: true });
      expect(result.stopTriggered).toBe(true);
      expect(result.matchedSpeaker).toBe("User");
      expect(result.text).toBe("");
    });

    it("does NOT trigger on first-line speaker when includeStart is false (default)", () => {
      const result = truncateBeforeGenericSpeakerLine("User: starts here");
      expect(result.stopTriggered).toBe(false);
    });
  });
});
