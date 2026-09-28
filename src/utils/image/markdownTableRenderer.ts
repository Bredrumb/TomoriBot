import sharp from "sharp";
import type { ParsedMarkdownTable, MarkdownTableAlignment } from "@/utils/text/markdownTable";
import { log } from "@/utils/misc/logger";

const MARKDOWN_TABLE_RENDER_MAX_WIDTH = 1400;
const MARKDOWN_TABLE_RENDER_MAX_HEIGHT = 5000;
const HEADER_FONT_SIZE = 24;
const BODY_FONT_SIZE = 22;
const BORDER_WIDTH = 1;
const OUTER_PADDING = 24;
const CELL_PADDING_X = 18;
const CELL_PADDING_Y = 14;
const LINE_HEIGHT = 30;
const TABLE_BG = "#070709";
const HEADER_BG = "#151821";
const ROW_BG = "#0d1016";
const ALT_ROW_BG = "#11151d";
const BORDER_COLOR = "#2a3140";
const HEADER_TEXT = "#f5f7fb";
const BODY_TEXT = "#d6dbe6";
const FONT_FAMILY = "Consolas, Menlo, 'Liberation Mono', monospace";
const CHAR_WIDTH_FACTOR = 0.61;

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapLongToken(token: string, maxChars: number): string[] {
  if (token.length <= maxChars) return [token];

  const parts: string[] = [];
  for (let index = 0; index < token.length; index += maxChars) {
    parts.push(token.slice(index, index + maxChars));
  }
  return parts;
}

function wrapText(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r/g, "");
  const logicalLines = normalized.split("\n");
  const wrapped: string[] = [];

  for (const logicalLine of logicalLines) {
    if (!logicalLine) {
      wrapped.push("");
      continue;
    }

    const tokens = logicalLine.split(/(\s+)/).filter((token) => token.length > 0);
    let currentLine = "";

    for (const token of tokens) {
      if (token.trim().length === 0) {
        if (currentLine && currentLine.length < maxChars) {
          currentLine += token;
        }
        continue;
      }

      if (token.length > maxChars) {
        if (currentLine.trim()) {
          wrapped.push(currentLine.trimEnd());
          currentLine = "";
        }
        wrapped.push(...wrapLongToken(token, maxChars));
        continue;
      }

      const candidate = currentLine ? `${currentLine}${token}` : token;
      if (candidate.length <= maxChars) {
        currentLine = candidate;
      } else {
        if (currentLine.trim()) {
          wrapped.push(currentLine.trimEnd());
        }
        currentLine = token;
      }
    }

    if (currentLine.trim() || currentLine.length > 0) {
      wrapped.push(currentLine.trimEnd());
    }
  }

  return wrapped.length > 0 ? wrapped : [""];
}

function calculateColumnCharBudgets(table: ParsedMarkdownTable, availableContentWidth: number): number[] {
  const charWidth = BODY_FONT_SIZE * CHAR_WIDTH_FACTOR;
  const availableChars = Math.max(table.columnCount * 8, Math.floor(availableContentWidth / charWidth));

  const naturalChars = table.header.map((header, index) => {
    let maxChars = header.length;
    for (const row of table.rows) {
      maxChars = Math.max(maxChars, row[index]?.length ?? 0);
    }
    return Math.max(6, Math.min(maxChars, 48));
  });

  const minChars = table.header.map((header) => Math.max(6, Math.min(14, Math.max(header.length, 6))));
  const budgets = [...naturalChars];

  while (budgets.reduce((sum, value) => sum + value, 0) > availableChars) {
    let candidateIndex = -1;
    let candidateWidth = -1;

    for (let index = 0; index < budgets.length; index++) {
      if (budgets[index] <= minChars[index]) continue;
      if (budgets[index] > candidateWidth) {
        candidateIndex = index;
        candidateWidth = budgets[index];
      }
    }

    if (candidateIndex === -1) {
      break;
    }

    budgets[candidateIndex] -= 1;
  }

  return budgets;
}

function getAnchor(alignment: MarkdownTableAlignment): "start" | "middle" | "end" {
  switch (alignment) {
    case "center":
      return "middle";
    case "right":
      return "end";
    default:
      return "start";
  }
}

function getTextX(cellX: number, cellWidth: number, alignment: MarkdownTableAlignment): number {
  switch (alignment) {
    case "center":
      return cellX + cellWidth / 2;
    case "right":
      return cellX + cellWidth - CELL_PADDING_X;
    default:
      return cellX + CELL_PADDING_X;
  }
}

export async function renderMarkdownTableToPng(table: ParsedMarkdownTable): Promise<Buffer | null> {
  const maxWidth = MARKDOWN_TABLE_RENDER_MAX_WIDTH;
  const maxHeight = MARKDOWN_TABLE_RENDER_MAX_HEIGHT;

  const usableWidth = Math.max(
    table.columnCount * (CELL_PADDING_X * 2 + BODY_FONT_SIZE * 8),
    maxWidth - OUTER_PADDING * 2 - BORDER_WIDTH * table.columnCount,
  );
  const columnCharBudgets = calculateColumnCharBudgets(table, usableWidth - CELL_PADDING_X * 2 * table.columnCount);
  const columnContentWidths = columnCharBudgets.map((budget) =>
    Math.max(BODY_FONT_SIZE * 6, budget * BODY_FONT_SIZE * CHAR_WIDTH_FACTOR),
  );
  const columnWidths = columnContentWidths.map((width) => Math.ceil(width + CELL_PADDING_X * 2));

  const wrappedHeader = table.header.map((cell, index) => wrapText(cell, columnCharBudgets[index]));
  const wrappedRows = table.rows.map((row) => row.map((cell, index) => wrapText(cell, columnCharBudgets[index])));

  const headerHeight =
    Math.max(...wrappedHeader.map((lines) => Math.max(lines.length, 1))) * LINE_HEIGHT + CELL_PADDING_Y * 2;
  const rowHeights = wrappedRows.map(
    (row) => Math.max(...row.map((lines) => Math.max(lines.length, 1))) * LINE_HEIGHT + CELL_PADDING_Y * 2,
  );

  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const imageWidth = Math.ceil(tableWidth + OUTER_PADDING * 2);
  const tableHeight = headerHeight + rowHeights.reduce((sum, height) => sum + height, 0);
  const imageHeight = Math.ceil(tableHeight + OUTER_PADDING * 2);

  if (imageHeight > maxHeight) {
    log.warn(`[MarkdownTable] Skipping render because image height ${imageHeight}px exceeds limit ${maxHeight}px`);
    return null;
  }

  const rects: string[] = [];
  const texts: string[] = [];

  let y = OUTER_PADDING;
  let x = OUTER_PADDING;
  for (let columnIndex = 0; columnIndex < table.columnCount; columnIndex++) {
    const cellWidth = columnWidths[columnIndex];
    rects.push(
      `<rect x="${x}" y="${y}" width="${cellWidth}" height="${headerHeight}" fill="${HEADER_BG}" stroke="${BORDER_COLOR}" stroke-width="${BORDER_WIDTH}" />`,
    );

    const textX = getTextX(x, cellWidth, table.alignments[columnIndex] ?? "left");
    const anchor = getAnchor(table.alignments[columnIndex] ?? "left");
    const tspans = wrappedHeader[columnIndex]
      .map((line, lineIndex) => {
        const dy = lineIndex === 0 ? "0" : `${LINE_HEIGHT}`;
        return `<tspan x="${textX}" dy="${dy}">${escapeXml(line)}</tspan>`;
      })
      .join("");

    texts.push(
      `<text x="${textX}" y="${y + CELL_PADDING_Y}" font-family="${FONT_FAMILY}" font-size="${HEADER_FONT_SIZE}" font-weight="700" fill="${HEADER_TEXT}" text-anchor="${anchor}" dominant-baseline="hanging">${tspans}</text>`,
    );

    x += cellWidth;
  }

  y += headerHeight;
  for (let rowIndex = 0; rowIndex < wrappedRows.length; rowIndex++) {
    x = OUTER_PADDING;
    const fill = rowIndex % 2 === 0 ? ROW_BG : ALT_ROW_BG;
    const rowHeight = rowHeights[rowIndex];

    for (let columnIndex = 0; columnIndex < table.columnCount; columnIndex++) {
      const cellWidth = columnWidths[columnIndex];
      rects.push(
        `<rect x="${x}" y="${y}" width="${cellWidth}" height="${rowHeight}" fill="${fill}" stroke="${BORDER_COLOR}" stroke-width="${BORDER_WIDTH}" />`,
      );

      const textX = getTextX(x, cellWidth, table.alignments[columnIndex] ?? "left");
      const anchor = getAnchor(table.alignments[columnIndex] ?? "left");
      const lines = wrappedRows[rowIndex][columnIndex] ?? [""];
      const tspans = lines
        .map((line, lineIndex) => {
          const dy = lineIndex === 0 ? "0" : `${LINE_HEIGHT}`;
          return `<tspan x="${textX}" dy="${dy}">${escapeXml(line)}</tspan>`;
        })
        .join("");

      texts.push(
        `<text x="${textX}" y="${y + CELL_PADDING_Y}" font-family="${FONT_FAMILY}" font-size="${BODY_FONT_SIZE}" fill="${BODY_TEXT}" text-anchor="${anchor}" dominant-baseline="hanging">${tspans}</text>`,
      );

      x += cellWidth;
    }

    y += rowHeight;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}">
      <rect x="0" y="0" width="${imageWidth}" height="${imageHeight}" fill="${TABLE_BG}" />
      ${rects.join("\n")}
      ${texts.join("\n")}
    </svg>
  `;

  return await sharp(Buffer.from(svg)).png().toBuffer();
}
