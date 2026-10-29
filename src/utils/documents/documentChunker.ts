import { z } from "zod";

export interface DocumentHeading {
  depth: number;
  title: string;
}

export interface DocumentHeadingPath {
  sections: DocumentHeading[];
}

export interface StructuredDocumentChunk {
  content: string;
  headingPath: DocumentHeadingPath | null;
}

// These measured budgets keep the fixture peak at 464 E5 tokens because CJK and dense runs count triple.
export const DOCUMENT_CHUNK_TARGET = 900;
export const DOCUMENT_CHUNK_MAX = 1400;
// Bound repeated heading context because an authored title can exceed the entire embedding budget.
const HEADING_INPUT_MAX = 180;
const DENSE_RUN_MIN_LENGTH = 64;
const headingPathSchema = z.object({
  sections: z.array(z.object({ depth: z.number().int().min(1).max(6), title: z.string() })),
});
const tableSeparator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const sentences = new Intl.Segmenter("und", { granularity: "sentence" });
const words = new Intl.Segmenter("und", { granularity: "word" });

function* weightedCharacters(text: string): Generator<{ character: string; weight: number }> {
  for (const [run] of text.matchAll(/\S+|\s+/gu)) {
    const dense = !/^\s/u.test(run) && run.length >= DENSE_RUN_MIN_LENGTH;
    for (const character of run) yield { character, weight: dense || cjk.test(character) ? 3 : 1 };
  }
}

export function documentTextWeight(text: string): number {
  let weight = 0;
  for (const item of weightedCharacters(text)) weight += item.weight;
  return weight;
}

function prefixWithin(text: string, budget: number): string {
  let result = "";
  let weight = 0;
  for (const item of weightedCharacters(text)) {
    weight += item.weight;
    if (weight > budget) break;
    result += item.character;
  }
  return result;
}

export function documentHeadingText(path: DocumentHeadingPath | null | undefined): string {
  return (
    (path == null ? undefined : headingPathSchema.parse(path).sections)
      ?.map(({ depth, title }) => `${"#".repeat(depth)} ${title}`)
      .join(" > ") ?? ""
  );
}

export function formatDocumentEmbeddingInput(content: string, path?: DocumentHeadingPath | null): string {
  const heading = prefixWithin(documentHeadingText(path), HEADING_INPUT_MAX);
  return heading ? `${heading}\n\n${content}` : content;
}

function splitText(text: string, maximum: number): string[] {
  if (documentTextWeight(text) <= maximum) return [text];
  const result: string[] = [];
  let pending = "";
  const add = (part: string) => {
    if (pending && documentTextWeight(pending + part) > maximum) {
      result.push(pending);
      pending = "";
    }
    pending += part;
  };
  for (const { segment: sentence } of sentences.segment(text)) {
    if (documentTextWeight(sentence) <= maximum) {
      add(sentence);
      continue;
    }
    for (const { segment: word } of words.segment(sentence)) {
      let remaining = word;
      while (documentTextWeight(remaining) > maximum) {
        if (pending) {
          result.push(pending);
          pending = "";
        }
        const piece = prefixWithin(remaining, maximum);
        result.push(piece);
        remaining = remaining.slice(piece.length);
      }
      add(remaining);
    }
  }
  if (pending) result.push(pending);
  return result;
}

export function chunkStructuredDocument(text: string): StructuredDocumentChunk[] {
  const chunks: StructuredDocumentChunk[] = [];
  let headings: DocumentHeading[] = [];
  let pending = "";
  let pendingPath: DocumentHeadingPath | null = null;
  const path = () => (headings.length ? { sections: [...headings] } : null);
  const flush = () => {
    if (pending.trim()) chunks.push({ content: pending.trim(), headingPath: pendingPath });
    pending = "";
  };
  const budget = () => DOCUMENT_CHUNK_MAX - documentTextWeight(formatDocumentEmbeddingInput("", path()));
  const append = (block: string, separator = "\n\n") => {
    for (const part of splitText(block, budget())) {
      const combined = pending ? `${pending}${separator}${part}` : part;
      if (pending && (documentTextWeight(pending) >= DOCUMENT_CHUNK_TARGET || documentTextWeight(combined) > budget()))
        flush();
      if (!pending) pendingPath = path();
      pending = pending ? `${pending}${separator}${part}` : part;
    }
  };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const separator = i > 0 && lines[i - 1].trim() ? "\n" : "\n\n";
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if (heading) {
      flush();
      const depth = heading[1].length;
      headings = headings.filter((item) => item.depth < depth);
      headings.push({ depth, title: heading[2] });
      append(line);
      i++;
      continue;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      flush();
      const opener = line;
      const marker = fence[1];
      const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
      i++;
      const body: string[] = [];
      while (i < lines.length && !closing.test(lines[i])) body.push(lines[i++]);
      const closer = i < lines.length ? lines[i++] : marker;
      const wrapper = documentTextWeight(`${opener}\n\n${closer}`);
      if (wrapper >= budget() - 3) {
        // Fence delimiters that cannot fit beside content become indented code, preserving the complete source.
        for (const sourceLine of [opener, ...body, closer]) {
          for (const piece of splitText(sourceLine, budget() - 4)) {
            chunks.push({ content: `    ${piece}`, headingPath: path() });
          }
        }
        continue;
      }
      const open = opener;
      const close = closer;
      const available = budget() - documentTextWeight(`${open}\n\n${close}`);
      let fragment = "";
      const emit = () => {
        chunks.push({ content: `${open}\n${fragment}\n${close}`, headingPath: path() });
        fragment = "";
      };
      for (const codeLine of body) {
        for (const piece of splitText(`${codeLine}\n`, available)) {
          if (fragment && documentTextWeight(fragment + piece) > available) emit();
          fragment += piece;
        }
      }
      if (fragment || body.length === 0) emit();
      continue;
    }
    const isTable = i + 1 < lines.length && line.includes("|") && tableSeparator.test(lines[i + 1]);
    if (isTable) {
      flush();
      const header = `${line}\n${lines[i + 1]}`;
      i += 2;
      if (documentTextWeight(header) + 4 >= budget()) {
        // A header larger than the chunk budget is preserved as prose because it cannot accompany any row.
        append(header);
        flush();
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) append(lines[i++]);
        flush();
        continue;
      }
      const available = budget() - documentTextWeight(`${header}\n`);
      let fragment = header;
      const emit = () => {
        chunks.push({ content: fragment, headingPath: path() });
        fragment = header;
      };
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        for (const piece of splitText(lines[i++], available - 1)) {
          if (fragment !== header && documentTextWeight(`${fragment}\n${piece}`) > budget()) emit();
          fragment += `\n${piece}`;
        }
      }
      emit();
      continue;
    }
    const block = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^ {0,3}(?:#{1,6}\s|`{3,}|~{3,})/.test(lines[i]) &&
      !/^\s*(?:[-+*]\s|\d+[.)]\s|[\p{L}][\p{L}\p{N} _-]{0,79}:\s)/u.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && tableSeparator.test(lines[i + 1]))
    ) {
      block.push(lines[i++]);
    }
    append(block.join("\n"), separator);
  }
  flush();
  return chunks;
}
