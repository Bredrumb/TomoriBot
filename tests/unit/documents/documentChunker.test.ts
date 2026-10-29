import { describe, expect, it } from "bun:test";
import {
  chunkStructuredDocument,
  documentTextWeight,
  DOCUMENT_CHUNK_MAX,
  formatDocumentEmbeddingInput,
  type DocumentHeading,
} from "@/utils/documents/documentChunker";
import { normalizeDocumentText } from "@/utils/documents/documentService";
import { RAG_DOCUMENTS } from "../../fixtures/rag";

function compact(text: string): string {
  return text.replace(/\s/g, "");
}

function assertPreserved(source: string, output: string): void {
  const expected = [...compact(source)];
  const actual = compact(output);
  let position = 0;
  for (const character of actual) if (character === expected[position]) position++;
  expect(position).toBe(expected.length);
}

function withoutRepeatedStructure(contents: string[]): string {
  const pieces: string[] = [];
  let previousFence = "";
  let previousTable = "";
  for (const content of contents) {
    const lines = content.split("\n");
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0]);
    if (fence) {
      if (previousFence === lines[0]) {
        pieces[pieces.length - 1] = pieces[pieces.length - 1].replace(/\n[^\n]*$/, "");
        lines.shift();
      }
      previousFence = content.split("\n")[0];
    } else previousFence = "";
    const table = lines.length > 1 && /^\|[- :|]+\|$/.test(lines[1]) ? lines.slice(0, 2).join("\n") : "";
    if (table && previousTable === table) lines.splice(0, 2);
    previousTable = table;
    pieces.push(lines.join("\n"));
  }
  return pieces.join("\n");
}

describe("structured new document chunks", () => {
  it("preserves every fixture, bounds embedding input, and retains actual section depths", () => {
    for (const doc of RAG_DOCUMENTS) {
      const source = normalizeDocumentText(doc.sourceText);
      const chunks = chunkStructuredDocument(source);
      expect(chunks.length, doc.key).toBeGreaterThan(0);
      expect(compact(withoutRepeatedStructure(chunks.map((c) => c.content))), doc.key).toBe(compact(source));
      const paths: DocumentHeading[][] = [[]];
      let headings: DocumentHeading[] = [];
      let fenced = false;
      for (const line of source.split("\n")) {
        if (/^\s*(`{3,}|~{3,})/.test(line)) fenced = !fenced;
        const match = !fenced && /^(#{1,6})\s+(.+)$/.exec(line);
        if (match) {
          const depth = match[1].length;
          headings = [...headings.filter((h) => h.depth < depth), { depth, title: match[2] }];
          paths.push(headings);
        }
      }
      const tableHeaders = [...source.matchAll(/(^[^\n]*\|[^\n]*\n\|?[- :|]+\|[^\n]*)/gm)].map((m) => m[1]);
      for (const chunk of chunks) {
        expect(
          documentTextWeight(formatDocumentEmbeddingInput(chunk.content, chunk.headingPath)),
          doc.key,
        ).toBeLessThanOrEqual(DOCUMENT_CHUNK_MAX);
        expect(paths, doc.key).toContainEqual(chunk.headingPath?.sections ?? []);
        const fenceLines = chunk.content.split("\n").filter((l) => /^\s*(`{3,}|~{3,})/.test(l));
        expect(fenceLines.length % 2, doc.key).toBe(0);
        if (fenceLines.length) {
          expect(fenceLines[0].trim()[0]).toBe((fenceLines.at(-1) ?? "").trim()[0]);
        }
        if (chunk.content.includes("|") && !fenceLines.length && tableHeaders.length) {
          expect(
            tableHeaders.some((header) => chunk.content.includes(header)),
            doc.key,
          ).toBe(true);
        }
        const sourceHeadings = [...chunk.content.matchAll(/^(#{1,6})\s+(.+)$/gm)];
        for (const heading of sourceHeadings)
          expect(chunk.headingPath?.sections).toContainEqual({ depth: heading[1].length, title: heading[2] });
      }
      for (const passage of doc.passages) {
        const match = /^(#{1,6})\s+(.+)\n/.exec(passage.text);
        if (!match) continue;
        const body = compact(passage.text.split("\n").slice(1).join("\n"));
        const matching = chunks.filter((c) =>
          c.headingPath?.sections.some((h) => h.depth === match[1].length && h.title === match[2]),
        );
        assertPreserved(body, matching.map((c) => c.content).join("\n"));
      }
    }
  });

  it("keeps list continuations and field blocks together when they fit", () => {
    const list = "- first item\n  continuation\n  - nested item\n    nested continuation";
    const fields = "Species: tide keeper\n  lives near the harbor\nCustom Label: carries a lamp";
    const chunks = chunkStructuredDocument(`# Card\n\n${list}\n\n${fields}`);
    expect(chunks.some((c) => c.content.includes(list))).toBe(true);
    expect(chunks.some((c) => c.content.includes(fields))).toBe(true);
  });

  it("splits long URLs, Unicode identifiers, table rows, and code lines without dropping characters", () => {
    for (const body of [`https://example.test/${"abcd".repeat(2000)}`, "𠮷".repeat(2000), "é".repeat(4000)]) {
      for (const text of [body, `| name | value |\n|---|---|\n| key | ${body} |`, `~~~text\n${body}\n~~~`]) {
        const chunks = chunkStructuredDocument(text);
        assertPreserved(text, chunks.map((c) => c.content).join("\n"));
        for (const chunk of chunks) expect(documentTextWeight(chunk.content)).toBeLessThanOrEqual(DOCUMENT_CHUNK_MAX);
      }
    }
  });

  it("handles single-column tables, unclosed fences, and oversized structural overhead", () => {
    const table = `| value |\n|---|\n| ${"text ".repeat(1000)} |`;
    const fragments = chunkStructuredDocument(table);
    for (const chunk of fragments) expect(chunk.content.startsWith("| value |\n|---|")).toBe(true);
    assertPreserved(table, fragments.map((c) => c.content).join("\n"));
    const broken = chunkStructuredDocument('```json\n{"lamp":true}');
    expect(broken[0].content.endsWith("```")).toBe(true);
    for (const source of [
      `${"~".repeat(2000)}\ncode\n${"~".repeat(2000)}`,
      `| ${"label".repeat(1000)} |\n|---|\n| value |`,
    ]) {
      const chunks = chunkStructuredDocument(source);
      assertPreserved(source, chunks.map((c) => c.content).join("\n"));
      for (const chunk of chunks) expect(documentTextWeight(chunk.content)).toBeLessThanOrEqual(DOCUMENT_CHUNK_MAX);
    }
  });

  it("preserves skipped levels and sibling labels without changing legacy embedding inputs", () => {
    const chunks = chunkStructuredDocument("# Root\n\n## Parent\n\n#### Deep\n\nfirst\n\n### Sibling\n\nsecond");
    expect(chunks.find((c) => c.content.includes("first"))?.headingPath?.sections.map((h) => h.depth)).toEqual([
      1, 2, 4,
    ]);
    expect(chunks.find((c) => c.content.includes("second"))?.headingPath?.sections.map((h) => h.depth)).toEqual([
      1, 2, 3,
    ]);
    const legacy = "  exact stored content\n";
    expect(formatDocumentEmbeddingInput(legacy, null)).toBe(legacy);
    const oversized = chunkStructuredDocument(`# ${"月".repeat(1000)}\n\n${"灯".repeat(2000)}`);
    for (const chunk of oversized)
      expect(documentTextWeight(formatDocumentEmbeddingInput(chunk.content, chunk.headingPath))).toBeLessThanOrEqual(
        DOCUMENT_CHUNK_MAX,
      );
  });
});
