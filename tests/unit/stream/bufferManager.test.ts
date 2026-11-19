import { humanizerSettingsFromDegree } from "@/constants/humanizer";
import { describe, expect, it } from "bun:test";
import { createDefaultStreamState } from "@/types/stream/types";
import {
  autoCloseIncompleteMarkers,
  drainThinkBlocksFromBuffer,
  hasIncompleteSemanticMarkers,
  processBufferContent,
} from "@/utils/discord/stream/bufferManager";

describe("stream buffer think-block fallback", () => {
  it("routes text before a stray close tag into raw thoughts", () => {
    const state = createDefaultStreamState();
    state.buffer = "originally.</think>Bella: Eep!";

    drainThinkBlocksFromBuffer(state);

    expect(state.thoughtRawSegments).toEqual(["originally."]);
    expect(state.buffer).toBe("Bella: Eep!");
  });

  it("holds a partial close tag so a reasoning tail cannot flush visibly", () => {
    expect(hasIncompleteSemanticMarkers("originally.</thi")).toBe(true);
  });
});

describe("stream buffer parenthesis balance", () => {
  it("does not hold for an emoticon's orphan closing paren", () => {
    expect(hasIncompleteSemanticMarkers("we won B)")).toBe(false);
    expect(hasIncompleteSemanticMarkers("nice :)")).toBe(false);
    expect(hasIncompleteSemanticMarkers("sneaky >:)")).toBe(false);
  });

  it("holds for a genuinely unclosed parenthetical so an aside is not split mid-way", () => {
    expect(hasIncompleteSemanticMarkers("we won (barely")).toBe(true);
  });

  it("does not hold once the parenthetical closes", () => {
    expect(hasIncompleteSemanticMarkers("we won (barely)")).toBe(false);
  });

  it("still holds when an emoticon precedes a genuinely unclosed parenthetical", () => {
    expect(hasIncompleteSemanticMarkers("we won :) (barely")).toBe(true);
  });

  it("closes a later parenthetical even when an emoticon contributed an orphan closer", () => {
    expect(autoCloseIncompleteMarkers("we won B) (barely")).toBe("we won B) (barely)");
  });

  it("keeps the multi-message label boundary flushable when a line ends in an emoticon", () => {
    const buffer = "@Zallya bet sending the vibes right now B)\ntomori (silly): double message combo";

    expect(hasIncompleteSemanticMarkers(buffer)).toBe(false);
  });
});

describe("stream buffer emphasis markers", () => {
  it("holds while an emphasis run is open", () => {
    const unclosed = ["*...but if you're asking the answer's more than zero", "**still bold", "~~struck through"];
    const failures = unclosed.filter((buffer) => !hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  it("does not hold once the run closes", () => {
    const closed = [
      "*italic* and more",
      "**bold** and *italic*",
      "~~struck~~ and more",
      "an _emphasis_ aside",
      "**bold *italic***",
    ];
    const failures = closed.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  it("does not hold for markers that are not emphasis delimiters", () => {
    const plain = [
      "call the user_id column of snake_case_table",
      "2 * 3 = 6 and 4 * 5 = 20",
      "* first item\n* second item",
      "a footnote marker like Best* in prose",
      "what the f*** is this",
      "~approx twenty",
      "kiss :* ok",
    ];
    const failures = plain.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  it("does not hold for underscores, kaomoji, inline code, or URLs", () => {
    const ignored = [
      "_emphasis aside",
      "edit src/utils/_internal/x.ts",
      "the _id field and the _user field",
      "o_O ok",
      "ugh -_- fine",
      "yay ^_^ ok",
      "ugh >_< ok",
      "hmm ._. ok",
      "use `*args` here",
      "pass `**kwargs` too",
      "see https://site.dev/_next/x",
      "*_* wow",
    ];
    const failures = ignored.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  it("holds for a marker embedded in a spaceless script", () => {
    const unclosed = ["えっと*ため息をつきながら", "日本語*強調", "他說*重點", "안녕*강조"];
    const failures = unclosed.filter((buffer) => !hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  // ASCII "~~" glued to kana is a wave-dash elongation, and one unpaired elongation would otherwise
  // hold every remaining flush of the reply.
  it("does not hold for a tilde elongation glued to kana", () => {
    const plain = ["おはよ~~！今日もがんばる\n", "やだ~~w\n", "えへへ~~♪\n"];
    const failures = plain.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  it("still does not hold for a marker inside a spaced-script word", () => {
    const plain = ["f***ing hell", "2*3", "a*b"];
    const failures = plain.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });
});

describe("stream buffer mention handles", () => {
  it("holds while an @{handle} is open so a period inside the name cannot split it", () => {
    expect(hasIncompleteSemanticMarkers("yo @{Mirri J. ")).toBe(true);
  });

  it("releases once the handle closes", () => {
    expect(hasIncompleteSemanticMarkers("yo @{Mirri J. Juno} welcome")).toBe(false);
  });
});

describe("stream buffer Discord spoilers", () => {
  it("does not hold a line whose only pipes are spoilers", () => {
    expect(hasIncompleteSemanticMarkers("Mirri (The Voice): ||We like Miso.||\n")).toBe(false);
    expect(hasIncompleteSemanticMarkers("a ||b|| c ||d||")).toBe(false);
  });

  it("holds when a spoiler tag is opened but not yet closed", () => {
    expect(hasIncompleteSemanticMarkers("||We want to be picked up like that.")).toBe(true);
  });

  it("does not hold once the spoiler closes on the same line", () => {
    expect(hasIncompleteSemanticMarkers("||We want to be picked up like that.||")).toBe(false);
  });

  it("holds a multi-line spoiler that has not closed yet", () => {
    expect(hasIncompleteSemanticMarkers("||No. That is slop.\n[Panel 1] They push us down.")).toBe(true);
  });

  it("does not hold for logical OR inside inline code", () => {
    expect(hasIncompleteSemanticMarkers("Use `a || b` here\nMore text follows.")).toBe(false);
  });

  it("does not hold for adjacent pipes in a well-formed table", () => {
    expect(hasIncompleteSemanticMarkers("| name | mid | age |\n|---|---|---|\n| Bob || 50 |\n\nParagraph after.")).toBe(
      false,
    );
  });

  it("auto-closes an unclosed spoiler on final flush", () => {
    expect(autoCloseIncompleteMarkers("||Secret text")).toBe("||Secret text||");
  });

  it("does not auto-close inline code pipes on final flush before a table", () => {
    const input = "Use `a || b` for the fallback.\n\n| Feature | Supported |\n|---|---|\n| A | Yes |\n";
    expect(autoCloseIncompleteMarkers(input)).toBe(input);
  });

  it("still holds a real table header that contains a spoiler cell", () => {
    expect(hasIncompleteSemanticMarkers("| ||secret|| | score |\n")).toBe(true);
  });

  it("splits a spoiler line from the speaker label on the next line", () => {
    const state = createDefaultStreamState();
    state.buffer = "Mirri (The Voice): ||We like Miso.||\nMirri: ...Ignore that.";

    const result = processBufferContent(state, { humanizer: humanizerSettingsFromDegree(1) } as Parameters<
      typeof processBufferContent
    >[1]);

    expect(result.segmentToFlush).toBe("Mirri (The Voice): ||We like Miso.||\n");
    expect(result.updatedBuffer).toBe("Mirri: ...Ignore that.");
  });
});
