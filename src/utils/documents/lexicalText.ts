export const DOCUMENT_TEXT_SEARCH_CONFIG = "russian";

const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const cjkRuns = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu;
const han = /\p{Script=Han}/u;

function tokenize(text: string, includeHanUnigrams: boolean): string {
  return text.normalize("NFC").replace(cjkRuns, (run) => {
    const characters = Array.from(graphemes.segment(run), ({ segment }) => segment);
    const terms: string[] = [];
    for (let index = 0; index < characters.length; index++) {
      if (includeHanUnigrams || characters.length === 1) {
        if (han.test(characters[index])) terms.push(characters[index]);
      }
      if (index + 1 < characters.length) terms.push(characters[index] + characters[index + 1]);
    }
    return ` ${terms.join(" ")} `;
  });
}

export function buildDocumentLexicalText(documentName: string, content: string, headingPath?: string): string {
  return tokenize([documentName, headingPath, content].filter(Boolean).join("\n"), true);
}

export function buildDocumentLexicalQuery(query: string): string {
  return tokenize(query, false);
}
