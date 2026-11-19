// Kept free of `discord.js` imports so tool execution paths can budget Discord text without loading the Discord
// client runtime.

// Zero-width space literal that renders invisibly, so inserting it stops backtick runs from parsing as a markdown
// fence.
export const FENCE_GUARD = "​";

// Every backtick run is interleaved because replacing only triple backticks leaves longer runs with a closing fence
// tail and is non-idempotent.
export function neutralizeFenceRuns(content: string): string {
  return content.replace(/`{2,}/g, (run) => run.split("").join(FENCE_GUARD));
}

// Codepoints are counted by spreading the string rather than using UTF-16 length, because Discord's backend measures
// limits in codepoints.
export function getDiscordTextLength(text: string): number {
  return [...text].length;
}

export function truncateDiscordText(text: string, maxLength: number, suffix = "..."): string {
  if (maxLength <= 0) return "";
  const totalLength = getDiscordTextLength(text);
  if (totalLength <= maxLength) {
    return text;
  }

  const suffixLength = getDiscordTextLength(suffix);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

  if (maxLength <= suffixLength) {
    let result = "";
    let count = 0;
    for (const { segment } of segmenter.segment(text)) {
      const segLen = getDiscordTextLength(segment);
      if (count + segLen > maxLength) break;
      result += segment;
      count += segLen;
    }
    return result;
  }

  const available = maxLength - suffixLength;
  let result = "";
  let count = 0;
  for (const { segment } of segmenter.segment(text)) {
    const segLen = getDiscordTextLength(segment);
    if (count + segLen > available) break;
    result += segment;
    count += segLen;
  }
  return `${result}${suffix}`;
}
