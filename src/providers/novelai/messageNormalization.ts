import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { findMarkdownCodeRanges } from "@/utils/text/processors/llmOutputProcessor";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";

const LOWERCASE_LATIN_START = /^(?=\p{Script=Latin})\p{Ll}/u;
const EMOJI_EDGE = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|\uFE0F|\u20E3/u;
// Face detection covers symbol-bearing kaomoji and common ASCII faces with linear scans; extend it when chat samples expose another shape.
const FACE_END =
  /(?:¯\\_\([^\n()]+\)_\/¯|[:;=8][-^']?[)(DPp/]|[\^>Tt;][-_.oO][\^<Tt;]|[^\s\p{Script=Latin}]_[^\s\p{Script=Latin}])$/u;
const BRACKETED_FACE_END = /[)）](?:づ|ノ|ง|[\\/¯_])*$/u;

function protectedTextRanges(text: string): Array<{ start: number; end: number }> {
  return [
    ...findMarkdownCodeRanges(text),
    ...Array.from(
      [
        ...text.matchAll(
          /(?:https?:\/\/|ftps?:\/\/|www\.)[^\s<>]+|<[^>\n]*>|@[\p{L}\p{N}_.-]+|~~~[\s\S]*?(?:~~~|$)/giu,
        ),
        ...text.matchAll(/^(?: {4}|\t)[^\r\n]*/gmu),
      ],
      (match) => ({
        start: match.index,
        end: match.index + match[0].length,
      }),
    ),
  ];
}

function restorePersonaNames(text: string, personaNames: readonly string[]): string {
  const protectedRanges = protectedTextRanges(text);
  const isProtected = (index: number) => protectedRanges.some((range) => index >= range.start && index < range.end);
  const names = new Map(personaNames.filter(Boolean).map((name) => [name.toLowerCase(), name]));
  const namePattern = [...names.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  if (namePattern) {
    text = text.replace(
      new RegExp(`(?<![\\p{L}\\p{N}_])(?:${namePattern})(?![\\p{L}\\p{N}_])`, "giu"),
      (match, offset: number) => (isProtected(offset) ? match : (names.get(match.toLowerCase()) ?? match)),
    );
  }
  return text;
}

function normalizeBody(text: string, personaNames: readonly string[]): string {
  text = restorePersonaNames(text, personaNames);
  const protectedRanges = protectedTextRanges(text);
  const isProtected = (index: number) => protectedRanges.some((range) => index >= range.start && index < range.end);
  text = text.replace(
    /(?<![\\\p{L}\p{N}])([*]{1,3}|_{1,2}|~~|\|\|)(?=\S)([\s\S]*?\S)\1/gu,
    (match, delimiter: string, body: string, offset: number) => {
      if (isProtected(offset) || /^[*_~|]+$/u.test(body)) return match;
      const content = restorePersonaNames(body, personaNames);
      return `${delimiter}${/(?:^|[.!?][ \t]*|\n[ \t]*)$/u.test(text.slice(0, offset)) ? normalizeProse(content) : content}${delimiter}`;
    },
  );
  return normalizeProse(text);
}

function normalizeProse(text: string): string {
  const protectedRanges = protectedTextRanges(text);
  return text.replace(/[^\r\n]+/gu, (line, offset: number) => {
    if (
      protectedRanges.some((range) => range.start < offset && offset < range.end) ||
      /^(?: {4}|\t|[ \t]*(?:[-+*][ \t]+|\d+[.)][ \t]+|#{1,6}(?:[ \t]+|$)|>|(?:-+|\*{3,}|_{3,}|=+)[ \t]*$))/u.test(
        line,
      ) ||
      /(?<![\\|])\|(?!\|)/u.test(line) ||
      /^\r?\n[ \t]*(?:=+|-+)[ \t]*(?:\r?\n|$)/u.test(text.slice(offset + line.length))
    )
      return line;
    return normalizeProseLine(line);
  });
}

function normalizeProseLine(text: string): string {
  const protectedRanges = protectedTextRanges(text);
  const isProtected = (index: number) => protectedRanges.some((range) => index >= range.start && index < range.end);
  const body = text.trim();
  if (!body) return text;
  const proseStart = body.replace(/^[*_~|]+/u, "");
  const first = Array.from(proseStart)[0] ?? "";
  if (
    body.startsWith("```") ||
    body.startsWith("~~~") ||
    /^(?:https?:\/\/|www\.|@|<[@#:]|<a:|<https?:\/\/)/iu.test(body) ||
    EMOJI_EDGE.test(first) ||
    /^[\d#*]\uFE0F?\u20E3/u.test(body) ||
    (/^\p{L}/u.test(proseStart) && !/^\p{Script=Latin}/u.test(proseStart))
  )
    return text;

  const bodyOffset = text.indexOf(body);
  let normalized = body.replace(
    /(^[*_~|]*|[.!?][*_~|]*[ \t]+[*_~|]*|\n[ \t]*[*_~|]*)(?=\p{Script=Latin})(\p{Ll})/gu,
    (match, prefix: string, letter: string, offset: number) =>
      isProtected(bodyOffset + offset + prefix.length) ? match : `${prefix}${letter.toUpperCase()}`,
  );
  const proseEnd = body.replace(/[*_~|]+$/u, "");
  const codeAtEnd = findMarkdownCodeRanges(body).some((range) => range.end === proseEnd.length);
  const faceClose = proseEnd.match(BRACKETED_FACE_END)?.index;
  const faceOpen =
    faceClose === undefined
      ? -1
      : Math.max(proseEnd.lastIndexOf("(", faceClose), proseEnd.lastIndexOf("（", faceClose));
  const bracketedFace = faceOpen >= 0 && /[^\p{L}\p{N}\s]/u.test(proseEnd.slice(faceOpen + 1, faceClose));
  const last = Array.from(proseEnd).at(-1) ?? "";
  if (
    !/[.!?…。！？:;]["'”’\])}*_~|]*$/u.test(body) &&
    !/(?:https?:\/\/|www\.|<https?:\/\/)[^\s]*$/iu.test(proseEnd) &&
    !/<a?:\w+:\d+>$/.test(proseEnd) &&
    !EMOJI_EDGE.test(last) &&
    !FACE_END.test(proseEnd) &&
    !bracketedFace &&
    !codeAtEnd &&
    !body.endsWith("~~~")
  )
    normalized += ".";
  return text.slice(0, text.indexOf(body)) + normalized + text.slice(text.indexOf(body) + body.length);
}

export function normalizeNovelAIContextText(item: StructuredContextItem, personaNames: readonly string[]): string {
  const text = item.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const isDialogue =
    item.metadataTag === ContextItemTag.DIALOGUE_HISTORY || item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE;
  const label = isDialogue ? text.match(/^([^\n:]+):([ \t]*)/u) : null;
  if (!label || /^[*_~|]/u.test(label[1])) return normalizeBody(text, personaNames);
  const canonicalName = personaNames.find((name) => name.toLowerCase() === label[1].toLowerCase());
  const speaker = canonicalName ?? label[1].replace(LOWERCASE_LATIN_START, (letter) => letter.toUpperCase());
  return `${speaker}:${label[2]}${normalizeBody(text.slice(label[0].length), personaNames)}`;
}
