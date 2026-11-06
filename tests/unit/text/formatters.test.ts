import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { humanizerSettingsFromDegree } from "@/constants/humanizer";
import { applyStableHumanizer, humanizeString } from "@/utils/text/processors/formatters";

const ALL_ON = { lowercase: true, punctuation: true };

describe("humanizeString", () => {
  it("strips semicolons when punctuation is on", () => {
    for (let i = 0; i < 20; i++) {
      expect(humanizeString("wait; really?", ALL_ON).join("")).not.toContain(";");
    }
  });

  it("leaves commas and emphasis marks fully intact when suppressPunctuationNoise is set", () => {
    const input = "well, i mean, sure, why not! right?";
    for (let i = 0; i < 20; i++) {
      expect(humanizeString(input, { ...ALL_ON, suppressPunctuationNoise: true })).toEqual([input]);
    }
  });

  it("resolves each comma to remove, flush, or keep, never dropping a word", () => {
    const input = "well, i mean, sure, why not";
    for (let i = 0; i < 50; i++) {
      const segments = humanizeString(input, ALL_ON);
      // A flush drops the comma's own separating space, so joining segments back with a single
      // space reconstructs the same spacing whether or not a flush happened anywhere.
      const normalized = segments.join(" ").replace(/,/g, "").replace(/\s+/g, " ").trim();
      expect(normalized).toBe("well i mean sure why not");
    }
  });

  it("never strips a ! or ? mark, even when it rolls a flush", () => {
    const input = "wait! really? sure";
    for (let i = 0; i < 50; i++) {
      const segments = humanizeString(input, ALL_ON);
      const normalized = segments.join(" ").replace(/\s+/g, " ").trim();
      expect(normalized).toBe(input);
    }
  });

  it("treats a run of consecutive marks as a single flush decision", () => {
    const input = "no?! seriously";
    for (let i = 0; i < 50; i++) {
      const segments = humanizeString(input, ALL_ON);
      expect(segments.join("")).toContain("?!");
    }
  });

  it("never returns an empty segment", () => {
    for (let i = 0; i < 50; i++) {
      for (const segment of humanizeString("wait! sure, ok?", ALL_ON)) {
        expect(segment.length).toBeGreaterThan(0);
      }
    }
  });

  it("never returns an empty array, even when the input collapses to nothing", () => {
    for (const input of ["", "   ", ";;;", ","]) {
      for (let i = 0; i < 20; i++) {
        const segments = humanizeString(input, ALL_ON);
        expect(segments.length).toBeGreaterThan(0);
        expect(segments[0]).toBeDefined();
      }
    }
  });

  it("never splits or strips a thousands-separator comma", () => {
    const input = "it costs $1,000,000 today";
    for (let i = 0; i < 50; i++) {
      expect(humanizeString(input, ALL_ON)).toEqual([input]);
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
        const segments = humanizeString(input, ALL_ON);
        expect(segments).toHaveLength(1);
      }
    }
  });

  it("keeps inline code containing quotes and commas untouched", () => {
    const input = 'run `print("hello, world!")` please';
    for (let i = 0; i < 30; i++) {
      expect(humanizeString(input, ALL_ON)[0]).toContain('print("hello, world!")');
    }
  });

  it("applies the same remove/flush/keep roll to Japanese comma and emphasis marks", () => {
    const input = "待って、本当に？そうか！";
    for (let i = 0; i < 50; i++) {
      const segments = humanizeString(input, ALL_ON);
      const normalized = segments.join("").replace(/、/g, "");
      expect(normalized).toBe("待って本当に？そうか！");
    }
  });

  it("never flushes inside a ||spoiler|| span", () => {
    const input = "||surprise, right?!||";
    for (let i = 0; i < 30; i++) {
      expect(humanizeString(input, ALL_ON)).toHaveLength(1);
    }
  });

  it("strips a semicolon inside a span the same way regardless of suppressPunctuationNoise", () => {
    const input = "(wait; really) sure";
    for (let i = 0; i < 20; i++) {
      expect(humanizeString(input, ALL_ON)[0]).not.toContain(";");
      expect(humanizeString(input, { ...ALL_ON, suppressPunctuationNoise: true })[0]).not.toContain(";");
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
        expect(humanizeString(input, { ...ALL_ON, suppressPunctuationNoise: true })).toEqual([input]);
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
        expect(humanizeString(input, ALL_ON)).toEqual([input]);
      }
    }
  });

  it("still protects a balanced aside that follows an unclosed parenthesis", () => {
    const input = "ok :( but (wait, really?!) sure";
    for (let i = 0; i < 50; i++) {
      expect(humanizeString(input, ALL_ON).join("\n")).toContain("(wait, really?!)");
    }
  });

  it("round-trips text resembling a flush marker or its former escape token", () => {
    const inputs = ["it's a __TOMORI_FLUSH_LITERAL__ token", "raw __TOMORI_FLUSH__ token", "pua  char"];
    for (const input of inputs) {
      for (let i = 0; i < 20; i++) {
        expect(humanizeString(input, ALL_ON)).toEqual([input]);
      }
    }
  });

  it("never splits on the flush sentinel if it appears verbatim inside restored content", () => {
    const input = "check (this contains __TOMORI_FLUSH__ literally) ok";
    for (let i = 0; i < 20; i++) {
      const segments = humanizeString(input, { ...ALL_ON, suppressPunctuationNoise: true });
      expect(segments).toEqual([input]);
    }
  });
});

// With the humanizer probabilities, 0.1 removes a comma and flushes emphasis, 0.5 flushes a comma
// and keeps emphasis, and 0.9 keeps both.
const ROLL_REMOVE_COMMA_FLUSH_EMPHASIS = 0.1;
const ROLL_FLUSH_COMMA_KEEP_EMPHASIS = 0.5;

describe("humanizeString script parity", () => {
  afterEach(() => {
    mock.restore();
  });

  function rollAlways(value: number): void {
    spyOn(Math, "random").mockReturnValue(value);
  }

  it("lowercases every cased script, keeps acronyms, and leaves uncased scripts alone", () => {
    const suppress = { ...ALL_ON, suppressPunctuationNoise: true };
    expect(humanizeString("Hello, HOW are You", suppress)).toEqual(["hello, HOW are you"]);
    expect(humanizeString("Ça va ? Привет, КАК ДЕЛА. Γεια ΣΟΥ", suppress)).toEqual([
      "ça va ? привет, КАК ДЕЛА. γεια ΣΟΥ",
    ]);
    expect(humanizeString("こんにちは、世界。안녕하세요", suppress)).toEqual(["こんにちは、世界。안녕하세요"]);
  });

  it("protects sender prefixes and inline code in every script", () => {
    const suppress = { ...ALL_ON, suppressPunctuationNoise: true };
    expect(humanizeString("(Mirri): Hello", suppress)).toEqual(["(Mirri): hello"]);
    expect(humanizeString("Жуно: Привет", suppress)).toEqual(["Жуно: привет"]);
    expect(humanizeString("ともり: やあ", suppress)).toEqual(["ともり: やあ"]);
    rollAlways(ROLL_FLUSH_COMMA_KEEP_EMPHASIS);
    expect(humanizeString('Скажи `печать("Привет, мир")` сейчас', ALL_ON)).toEqual([
      'скажи `печать("Привет, мир")` сейчас',
    ]);
  });

  it("rolls full-width and halfwidth ideographic commas like 、", () => {
    rollAlways(ROLL_REMOVE_COMMA_FLUSH_EMPHASIS);
    expect(humanizeString("你好，世界､再见、朋友", ALL_ON)).toEqual(["你好世界再见朋友"]);
    mock.restore();
    rollAlways(ROLL_FLUSH_COMMA_KEEP_EMPHASIS);
    expect(humanizeString("你好，世界", ALL_ON)).toEqual(["你好", "世界"]);
  });

  it("strips the full-width semicolon like the ASCII one", () => {
    expect(humanizeString("等等；真的", { ...ALL_ON, suppressPunctuationNoise: true })).toEqual(["等等真的"]);
  });

  it("flushes emphasis the same way in Chinese, English, Spanish, and French", () => {
    rollAlways(ROLL_REMOVE_COMMA_FLUSH_EMPHASIS);
    expect(humanizeString("真的吗？好的！再见", ALL_ON)).toEqual(["真的吗？", "好的！", "再见"]);
    expect(humanizeString("really? ok! bye", ALL_ON)).toEqual(["really?", "ok!", "bye"]);
    expect(humanizeString("¡Hola! ¿Qué tal?", ALL_ON)).toEqual(["¡hola!", "¿qué tal?"]);
    expect(humanizeString("Bonjour ! Ça va ?", ALL_ON)).toEqual(["bonjour !", "ça va ?"]);
  });

  it("never flushes inside any paired quotation", () => {
    rollAlways(ROLL_FLUSH_COMMA_KEEP_EMPHASIS);
    for (const [open, close] of [
      ["«", "»"],
      ["‹", "›"],
      ["“", "”"],
      ["「", "」"],
      ["『", "』"],
      ["｢", "｣"],
      ["〈", "〉"],
      ["《", "》"],
    ]) {
      expect(humanizeString(`il dit ${open}oui, non${close} ok`, ALL_ON)).toHaveLength(1);
    }
    expect(humanizeString("Il a dit «Bonjour, monde» et il est parti.", ALL_ON)).toHaveLength(1);
    expect(humanizeString("그는 〈안녕, 세계〉라고 말했다.", ALL_ON)).toHaveLength(1);
    expect(humanizeString("Oui, «Bonjour, monde»", ALL_ON)).toEqual(["oui", "«bonjour, monde»"]);
  });

  it("does not treat a typographic apostrophe as a quotation", () => {
    rollAlways(ROLL_FLUSH_COMMA_KEEP_EMPHASIS);
    expect(humanizeString("don’t, ok", ALL_ON)).toEqual(["don’t", "ok"]);
  });
});

describe("humanizeString toggles", () => {
  afterEach(() => {
    mock.restore();
  });

  it("keeps casing with lowercase off while punctuation still rolls", () => {
    spyOn(Math, "random").mockReturnValue(ROLL_FLUSH_COMMA_KEEP_EMPHASIS);
    expect(humanizeString("Wait; Hello, World", { lowercase: false, punctuation: true })).toEqual([
      "Wait Hello",
      "World",
    ]);
  });

  it("keeps every punctuation mark and never splits with punctuation off", () => {
    spyOn(Math, "random").mockReturnValue(ROLL_REMOVE_COMMA_FLUSH_EMPHASIS);
    expect(humanizeString("Wait; Hello, World! ok", { lowercase: true, punctuation: false })).toEqual([
      "wait; hello, world! ok",
    ]);
  });
});

describe("applyStableHumanizer", () => {
  it("returns the text untouched when neither text toggle is on", () => {
    expect(applyStableHumanizer("Wait; Hello, World!", humanizerSettingsFromDegree(2))).toBe("Wait; Hello, World!");
  });

  it("applies only the deterministic part, so repeated builds stay byte-identical", () => {
    const heavy = humanizerSettingsFromDegree(3);
    const first = applyStableHumanizer("Wait; Hello, World! ok", heavy);
    expect(first).toBe("wait hello, world! ok");
    for (let i = 0; i < 20; i++) {
      expect(applyStableHumanizer("Wait; Hello, World! ok", heavy)).toBe(first);
    }
  });
});

describe("humanizeString roll thresholds", () => {
  afterEach(() => {
    mock.restore();
  });

  function outcomeAt(roll: number): string[] {
    spyOn(Math, "random").mockReturnValue(roll);
    return humanizeString("well, sure! ok", ALL_ON);
  }

  it("removes a comma below 0.4 and flushes it from 0.4 up to 0.6", () => {
    expect(outcomeAt(0.39)).toEqual(["well sure!", "ok"]);
    mock.restore();
    expect(outcomeAt(0.4)).toEqual(["well", "sure!", "ok"]);
  });

  it("keeps a comma above 0.6 and flushes emphasis only below 0.5", () => {
    expect(outcomeAt(0.49)).toEqual(["well", "sure!", "ok"]);
    mock.restore();
    expect(outcomeAt(0.5)).toEqual(["well", "sure! ok"]);
    mock.restore();
    expect(outcomeAt(0.61)).toEqual(["well, sure! ok"]);
  });
});
