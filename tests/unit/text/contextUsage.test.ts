import { describe, expect, test } from "bun:test";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import {
  CONTEXT_CELL_EMOJI,
  CONTEXT_GRID_COLUMNS,
  CONTEXT_GRID_ROWS,
  type ContextCellId,
  layoutContextGrid,
  measureContextUsage,
} from "@/utils/text/promptInspection/contextUsage";

function textItem(tag: ContextItemTag | undefined, chars: number): StructuredContextItem {
  return { role: "system", parts: [{ type: "text", text: "x".repeat(chars) }], metadataTag: tag };
}

function countCells(rows: readonly string[], id: ContextCellId): number {
  return rows.join("").split(CONTEXT_CELL_EMOJI[id]).length - 1;
}

function allCells(rows: readonly string[]): string[] {
  return Array.from(rows.join(""));
}

describe("measureContextUsage", () => {
  test("groups tags into segments and treats untagged preset items as instructions", () => {
    const usage = measureContextUsage(
      [
        textItem(ContextItemTag.SYSTEM_HUMANIZER_RULES, 8),
        textItem(undefined, 4),
        textItem(ContextItemTag.DIALOGUE_SAMPLE, 12),
        textItem(ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY, 16),
        textItem(ContextItemTag.DIALOGUE_HISTORY, 20),
      ],
      null,
    );

    expect(usage.segments).toEqual([
      { id: "instructions", tokens: 3 },
      { id: "persona", tokens: 3 },
      { id: "memory", tokens: 4 },
      { id: "conversation", tokens: 5 },
    ]);
    expect(usage.inputTokens).toBe(15);
  });

  test("adds provider tool schemas to the verbatim tool text", () => {
    const tools = [{ type: "function", function: { name: "weather", description: "x".repeat(40) } }];
    const usage = measureContextUsage([textItem(ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS, 8)], tools);

    expect(usage.segments).toEqual([{ id: "tools", tokens: 2 + Math.ceil(JSON.stringify(tools).length / 3.5) }]);
  });

  test("skips media parts, whose token cost differs per provider", () => {
    const usage = measureContextUsage(
      [
        {
          role: "user",
          metadataTag: ContextItemTag.DIALOGUE_HISTORY,
          parts: [{ type: "image", uri: "https://example.com/image.png", mimeType: "image/png" }],
        },
      ],
      null,
    );

    expect(usage.segments).toEqual([]);
  });
});

describe("layoutContextGrid", () => {
  test("always fills a full grid", () => {
    const usage = measureContextUsage([textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 123)], null);
    const grid = layoutContextGrid(usage, { contextLength: 1000, outputReserve: 100 });

    expect(grid.rows).toHaveLength(CONTEXT_GRID_ROWS);
    for (const row of grid.rows) {
      expect(Array.from(row)).toHaveLength(CONTEXT_GRID_COLUMNS);
    }
  });

  test("ends free space where truncation starts, drawing the reply reserve and margin as reserved", () => {
    // Truncation starts at floor((1000 - 100) * 0.9) = 810 estimated tokens, so 190 are reserved.
    const usage = measureContextUsage([textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 400)], null);
    const grid = layoutContextGrid(usage, { contextLength: 1000, outputReserve: 100 });

    expect(grid.parts).toEqual([
      { id: "conversation", tokens: 400 },
      { id: "free", tokens: 410 },
      { id: "reserved", tokens: 190 },
    ]);
    expect(countCells(grid.rows, "conversation")).toBe(40);
    expect(countCells(grid.rows, "free")).toBe(41);
    expect(countCells(grid.rows, "reserved")).toBe(19);
  });

  test("keeps a visible cell for a segment far below one percent", () => {
    const usage = measureContextUsage(
      [textItem(ContextItemTag.SYSTEM_PERSONALITY, 4), textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 50_000)],
      null,
    );
    const grid = layoutContextGrid(usage, { contextLength: 1_000_000, outputReserve: 8192 });

    expect(countCells(grid.rows, "persona")).toBe(1);
    expect(allCells(grid.rows)).toHaveLength(CONTEXT_GRID_ROWS * CONTEXT_GRID_COLUMNS);
  });

  test("shows no free space once the prompt is past the truncation budget", () => {
    const usage = measureContextUsage([textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 950)], null);
    const grid = layoutContextGrid(usage, { contextLength: 1000, outputReserve: 100 });

    expect(countCells(grid.rows, "free")).toBe(0);
    expect(allCells(grid.rows)).toHaveLength(CONTEXT_GRID_ROWS * CONTEXT_GRID_COLUMNS);
  });

  test("shows only the prompt's composition when the window is unknown", () => {
    const usage = measureContextUsage(
      [textItem(ContextItemTag.SYSTEM_HUMANIZER_RULES, 4 * 25), textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 75)],
      null,
    );
    const grid = layoutContextGrid(usage, null);

    expect(grid.parts.map((part) => part.id)).toEqual(["instructions", "conversation"]);
    expect(countCells(grid.rows, "instructions")).toBe(25);
    expect(countCells(grid.rows, "conversation")).toBe(75);
  });
});
