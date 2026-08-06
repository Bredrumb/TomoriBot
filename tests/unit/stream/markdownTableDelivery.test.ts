import { describe, expect, it } from "bun:test";
import { autoCloseIncompleteMarkers, findRegularOverflowFlushIndex } from "@/utils/discord/stream/bufferManager";
import { extractMarkdownTableSegments, findMarkdownTableBlockAt } from "@/utils/text/markdownTable";

/**
 * Counts the body rows the table renderer would draw for the first table in `text`.
 * A row lost to buffer damage shows up here as a smaller count.
 */
function renderedRowCount(text: string): number {
  const tableSegment = extractMarkdownTableSegments(text).find((segment) => segment.type === "table");
  return tableSegment?.type === "table" ? tableSegment.table.rows.length : 0;
}

/** Counts how many distinct tables survive in `text`. */
function tableCount(text: string): number {
  return extractMarkdownTableSegments(text).filter((segment) => segment.type === "table").length;
}

const FLUSH_TARGET = 1000;

describe("autoCloseIncompleteMarkers with markdown tables", () => {
  // A table is ALWAYS held to the final flush (EOF never terminates a table block), so
  // every table-bearing response runs through this repair. Appending a closer after the
  // last row used to change that row's cell count and drop it from the rendered image.
  it.each([
    ["an underscore in a cell", "Here you go:\n| Field | Type |\n|---|---|\n| user_id | int |\n| name | text |"],
    ["a footnote asterisk in a cell", "Here you go:\n| Model | Notes |\n|---|---|\n| Opus | Best* |\n| Haiku | Fast |"],
    [
      "an unbalanced paren in a cell",
      "Here you go:\n| Model | Notes |\n|---|---|\n| Opus | Best (by far |\n| Haiku | Fast |",
    ],
    ["an odd quote in a cell", 'Here you go:\n| Model | Notes |\n|---|---|\n| Opus | The "best |\n| Haiku | Fast |'],
  ])("keeps every row when a table contains %s", (_label, buffer) => {
    const repaired = autoCloseIncompleteMarkers(buffer);

    expect(renderedRowCount(repaired)).toBe(renderedRowCount(buffer));
    expect(renderedRowCount(repaired)).toBe(2);
  });

  it("closes a marker opened in prose before the table without touching the table", () => {
    const repaired = autoCloseIncompleteMarkers("See (this one:\n| A | B |\n|---|---|\n| 1 | 2 |");

    expect(repaired).toBe("See (this one:)\n| A | B |\n|---|---|\n| 1 | 2 |");
    expect(renderedRowCount(repaired)).toBe(1);
  });

  it("closes a marker opened in prose after the table", () => {
    const repaired = autoCloseIncompleteMarkers("Table:\n| A | B |\n|---|---|\n| 1 | 2 |\nAnd (a note");

    expect(repaired).toBe("Table:\n| A | B |\n|---|---|\n| 1 | 2 |\nAnd (a note)");
    expect(renderedRowCount(repaired)).toBe(1);
  });

  it("does not park closers on the separator between two tables", () => {
    const buffer = "See (this:\n| A | B |\n|---|---|\n| 1 | 2 |\n\n| C | D |\n|---|---|\n| 3 | 4 |";

    const repaired = autoCloseIncompleteMarkers(buffer);

    expect(repaired).toBe("See (this:)\n| A | B |\n|---|---|\n| 1 | 2 |\n\n| C | D |\n|---|---|\n| 3 | 4 |");
    expect(tableCount(repaired)).toBe(2);
  });

  it("leaves a buffer that is nothing but a table completely untouched", () => {
    const buffer = "| A | B |\n|---|---|\n| user_id | 2 |";

    expect(autoCloseIncompleteMarkers(buffer)).toBe(buffer);
  });

  it.each([
    ["He said (hello", "He said (hello)"],
    ["Some *emphasis", "Some *emphasis*"],
    ['A "quote', 'A "quote"'],
    ["A [link](http://x", "A [link](http://x)"],
  ])("repairs plain prose exactly as before: %s", (buffer, expected) => {
    expect(autoCloseIncompleteMarkers(buffer)).toBe(expected);
  });
});

describe("findRegularOverflowFlushIndex with markdown tables", () => {
  const tableHeader = "| Model | Provider | Speed | Cost | Notes |\n|---|---|---|---|---|\n";
  const tableRows = Array.from(
    { length: 24 },
    (_, index) => `| model-${index} | p-${index} | fast | cheap | notes for model ${index} |`,
  ).join("\n");
  const table = `${tableHeader}${tableRows}`;

  it("moves the cut back before a table when prose precedes it", () => {
    const buffer = `${"Intro prose sentence. ".repeat(12)}\n${table}\nDone.`;

    const flushIndex = findRegularOverflowFlushIndex(buffer, FLUSH_TARGET);

    // Nothing of the table may leave in the first message...
    expect(tableCount(buffer.slice(0, flushIndex))).toBe(0);
    // ...and the retained buffer keeps every row for a single rendered image.
    expect(renderedRowCount(buffer.slice(flushIndex))).toBe(24);
  });

  it("moves the cut past a table that starts at the head of the buffer", () => {
    const buffer = `${table}\nThat's everything.`;

    const flushIndex = findRegularOverflowFlushIndex(buffer, FLUSH_TARGET);

    expect(renderedRowCount(buffer.slice(0, flushIndex))).toBe(24);
    expect(buffer.slice(flushIndex).trim()).toBe("That's everything.");
  });

  it("returns 0 to hold the buffer when the only cut would split a table", () => {
    expect(findRegularOverflowFlushIndex(table, FLUSH_TARGET)).toBe(0);
  });

  it("still cuts plain prose near the target length", () => {
    const prose = "This is a normal sentence without tables. ".repeat(40);

    const flushIndex = findRegularOverflowFlushIndex(prose, FLUSH_TARGET);

    expect(flushIndex).toBeGreaterThan(FLUSH_TARGET - 300);
    expect(flushIndex).toBeLessThan(FLUSH_TARGET + 200);
  });
});

describe("findMarkdownTableBlockAt", () => {
  const buffer = "Intro\n| A | B |\n|---|---|\n| 1 | 2 |\nOutro";
  const tableStart = buffer.indexOf("| A |");
  const tableEnd = buffer.indexOf("Outro");

  it("reports the enclosing block for an offset inside a table", () => {
    expect(findMarkdownTableBlockAt(buffer, tableStart + 5)).toEqual({ start: tableStart, end: tableEnd });
  });

  it("treats the block's own boundaries as safe cut points", () => {
    expect(findMarkdownTableBlockAt(buffer, tableStart)).toBeNull();
    expect(findMarkdownTableBlockAt(buffer, tableEnd)).toBeNull();
  });

  it("returns null for offsets in surrounding prose", () => {
    expect(findMarkdownTableBlockAt(buffer, 2)).toBeNull();
    expect(findMarkdownTableBlockAt(buffer, buffer.length - 1)).toBeNull();
  });

  it("protects a table that is still streaming", () => {
    const streaming = "Intro\n| A | B |\n|---|---|\n| 1 | 2 |";

    expect(findMarkdownTableBlockAt(streaming, streaming.length - 4)).not.toBeNull();
  });
});
