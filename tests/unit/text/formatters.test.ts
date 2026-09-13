import { describe, expect, it } from "bun:test";
import { humanizeString } from "@/utils/text/processors/formatters";

describe("humanizeString", () => {
  it("always strips semicolons", () => {
    for (let i = 0; i < 20; i++) {
      expect(humanizeString("wait; really?").join("")).not.toContain(";");
    }
  });

  it("leaves commas and emphasis marks fully intact when suppressPunctuationNoise is set", () => {
    const input = "well, i mean, sure, why not! right?";
    for (let i = 0; i < 20; i++) {
      expect(humanizeString(input, { suppressPunctuationNoise: true })).toEqual([input]);
    }
  });

  it("resolves each comma to remove, flush, or keep, never dropping a word", () => {
    const input = "well, i mean, sure, why not";
    for (let i = 0; i < 50; i++) {
      const segments = humanizeString(input);
      // A flush drops the comma's own separating space, so joining segments back with a single
      // space reconstructs the same spacing whether or not a flush happened anywhere.
      const normalized = segments.join(" ").replace(/,/g, "").replace(/\s+/g, " ").trim();
      expect(normalized).toBe("well i mean sure why not");
    }
  });

  it("never strips a ! or ? mark, even when it rolls a flush", () => {
    const input = "wait! really? sure";
    for (let i = 0; i < 50; i++) {
      const segments = humanizeString(input);
      const normalized = segments.join(" ").replace(/\s+/g, " ").trim();
      expect(normalized).toBe(input);
    }
  });

  it("treats a run of consecutive marks as a single flush decision", () => {
    const input = "no?! seriously";
    for (let i = 0; i < 50; i++) {
      const segments = humanizeString(input);
      expect(segments.join("")).toContain("?!");
    }
  });

  it("never returns an empty segment", () => {
    for (let i = 0; i < 50; i++) {
      for (const segment of humanizeString("wait! sure, ok?")) {
        expect(segment.length).toBeGreaterThan(0);
      }
    }
  });

  it("never returns an empty array, even when the input collapses to nothing", () => {
    for (const input of ["", "   ", ";;;", ","]) {
      for (let i = 0; i < 20; i++) {
        const segments = humanizeString(input);
        expect(segments.length).toBeGreaterThan(0);
        expect(segments[0]).toBeDefined();
      }
    }
  });

  it("never splits or strips a thousands-separator comma", () => {
    const input = "it costs $1,000,000 today";
    for (let i = 0; i < 50; i++) {
      expect(humanizeString(input)).toEqual([input]);
    }
  });

  it("never flushes inside markdown bold, italic, a quoted span, or a markdown link", () => {
    const inputs = [
      "**wait, are you sure?**",
      "*really? yes!*",
      '"wait, no!" she said',
      "check [this, now!](https://example.com/path)",
    ];
    for (const input of inputs) {
      for (let i = 0; i < 30; i++) {
        const segments = humanizeString(input);
        expect(segments).toHaveLength(1);
      }
    }
  });

  it("keeps inline code containing quotes and commas untouched", () => {
    const input = 'run `print("hello, world!")` please';
    for (let i = 0; i < 30; i++) {
      expect(humanizeString(input)[0]).toContain('print("hello, world!")');
    }
  });

  it("applies the same remove/flush/keep roll to Japanese comma and emphasis marks", () => {
    const input = "待って、本当に？そうか！";
    for (let i = 0; i < 50; i++) {
      const segments = humanizeString(input);
      const normalized = segments.join("").replace(/、/g, "");
      expect(normalized).toBe("待って本当に？そうか！");
    }
  });

  it("never flushes inside a ||spoiler|| span", () => {
    const input = "||surprise, right?!||";
    for (let i = 0; i < 30; i++) {
      expect(humanizeString(input)).toHaveLength(1);
    }
  });

  it("strips a semicolon inside a span the same way regardless of suppressPunctuationNoise", () => {
    const input = "(wait; really) sure";
    for (let i = 0; i < 20; i++) {
      expect(humanizeString(input)[0]).not.toContain(";");
      expect(humanizeString(input, { suppressPunctuationNoise: true })[0]).not.toContain(";");
    }
  });

  it("reinserts restored content verbatim even when it contains $-replacement patterns", () => {
    const inputs = [
      "check (this cost $1 and $& stayed literal) today",
      "see `awk '{print $&}'` for the pattern",
      "https://example.com/path?ref=$&literal",
    ];
    for (const input of inputs) {
      for (let i = 0; i < 20; i++) {
        expect(humanizeString(input, { suppressPunctuationNoise: true })).toEqual([input]);
      }
    }
  });

  it("never splits or strips ASCII marks that are part of a token rather than prose", () => {
    const inputs = [
      "hey <@!123456789> look",
      "type !help to start",
      "x?y is a regex",
      "really?... ok",
      "pick a,b or c",
    ];
    for (const input of inputs) {
      for (let i = 0; i < 50; i++) {
        expect(humanizeString(input)).toEqual([input]);
      }
    }
  });

  it("still protects a balanced aside that follows an unclosed parenthesis", () => {
    const input = "ok :( but (wait, really?!) sure";
    for (let i = 0; i < 50; i++) {
      expect(humanizeString(input).join("\n")).toContain("(wait, really?!)");
    }
  });

  it("round-trips text resembling a flush marker or its former escape token", () => {
    const inputs = ["it's a __TOMORI_FLUSH_LITERAL__ token", "raw __TOMORI_FLUSH__ token", "pua  char"];
    for (const input of inputs) {
      for (let i = 0; i < 20; i++) {
        expect(humanizeString(input)).toEqual([input]);
      }
    }
  });

  it("never splits on the flush sentinel if it appears verbatim inside restored content", () => {
    const input = "check (this contains __TOMORI_FLUSH__ literally) ok";
    for (let i = 0; i < 20; i++) {
      const segments = humanizeString(input, { suppressPunctuationNoise: true });
      expect(segments).toEqual([input]);
    }
  });
});
