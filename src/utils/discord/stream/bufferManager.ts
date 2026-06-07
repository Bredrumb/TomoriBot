import { HumanizerDegree } from "@/types/db/schema";
import type { StreamConfig } from "@/types/stream/interfaces";
import { type ChunkProcessingResult, DISCORD_STREAMING_CONSTANTS, type StreamState } from "@/types/stream/types";
import { log } from "@/utils/misc/logger";
import { createSentenceSplitRegex } from "@/utils/text/processors/chunkProcessor";
import { hasTrailingIncompleteMarkdownTable } from "@/utils/text/markdownTable";

function shouldDelayTrailingPeriodFlush(buffer: string, periodMatch: RegExpExecArray): boolean {
  const periodEndIndex = periodMatch.index + periodMatch[0].length;
  return periodMatch[0] === "." && periodEndIndex === buffer.length;
}

export function findRegularOverflowFlushIndex(buffer: string, targetLength: number): number {
  if (!buffer) return 0;

  const target = Math.min(Math.max(1, targetLength), buffer.length);
  const backwardWindowStart = Math.max(0, target - 300);
  const forwardWindowEnd = Math.min(buffer.length, target + 200);

  const isSentenceBoundary = (index: number): boolean => {
    const ch = buffer[index];
    if (!ch) return false;

    if (ch === "\n") return true;
    if (!/[.!?。！？]/.test(ch)) return false;

    const nextChar = buffer[index + 1];
    return nextChar === undefined || /\s/.test(nextChar);
  };

  for (let i = target; i < forwardWindowEnd; i++) {
    if (isSentenceBoundary(i)) return i + 1;
  }

  for (let i = target - 1; i >= backwardWindowStart; i--) {
    if (isSentenceBoundary(i)) return i + 1;
  }

  for (let i = target - 1; i >= backwardWindowStart; i--) {
    if (/\s/.test(buffer[i])) return i + 1;
  }
  for (let i = target; i < forwardWindowEnd; i++) {
    if (/\s/.test(buffer[i])) return i + 1;
  }

  return target;
}

export function drainThinkBlocksFromBuffer(state: StreamState): void {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (state.isInsideThinkBlock) {
      if (state.buffer.length > 0) {
        state.thinkBlockBuffer += state.buffer;
        state.buffer = "";
      }

      const closeIdx = state.thinkBlockBuffer.indexOf("</think>");
      if (closeIdx === -1) {
        break;
      }

      const thinkContent = state.thinkBlockBuffer.slice(0, closeIdx).trim();
      if (thinkContent) {
        state.thoughtRawSegments.push(thinkContent);
        log.info(`Stream: Captured ${thinkContent.length} chars of think block content for thought log`);
      }

      const afterClose = state.thinkBlockBuffer.slice(closeIdx + "</think>".length);
      state.thinkBlockBuffer = "";
      state.isInsideThinkBlock = false;
      state.buffer += afterClose;
    } else {
      const openIdx = state.buffer.indexOf("<think>");
      const closeIdx = state.buffer.indexOf("</think>");

      if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
        const thinkContent = state.buffer.slice(0, closeIdx).trim();
        if (thinkContent) {
          state.thoughtRawSegments.push(thinkContent);
          log.info(`Stream: Captured ${thinkContent.length} chars before stray </think> for thought log`);
        }

        state.buffer = state.buffer.slice(closeIdx + "</think>".length);
        continue;
      }

      if (openIdx === -1) {
        break;
      }

      state.thinkBlockBuffer = state.buffer.slice(openIdx + "<think>".length);
      state.buffer = state.buffer.slice(0, openIdx);
      state.isInsideThinkBlock = true;
    }
  }
}

export function stripSummaryTag(content: string): string {
  return content.replace(/<summary>[\s\S]*?<\/summary>/i, "").trim();
}

export function drainDetailsBlocksFromBuffer(state: StreamState): void {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (state.isInsideDetailsBlock) {
      if (state.buffer.length > 0) {
        state.detailsBlockBuffer += state.buffer;
        state.buffer = "";
      }

      const closeIdx = state.detailsBlockBuffer.indexOf("</details>");
      if (closeIdx === -1) {
        break;
      }

      let detailsContent = state.detailsBlockBuffer.slice(0, closeIdx).trim();
      if (detailsContent) {
        detailsContent = stripSummaryTag(detailsContent);
        if (detailsContent) {
          state.detailsSegments.push(detailsContent);
          log.info(`Stream: Captured ${detailsContent.length} chars of details block content for STM`);
        }
      }

      const afterClose = state.detailsBlockBuffer.slice(closeIdx + "</details>".length);
      state.detailsBlockBuffer = "";
      state.isInsideDetailsBlock = false;
      state.buffer += afterClose;
    } else {
      const openMatch = state.buffer.match(/<details(?:\s[^>]*)?>/);
      if (!openMatch || openMatch.index === undefined) {
        break;
      }

      const openIdx = openMatch.index;
      const fullTag = openMatch[0];
      state.detailsBlockBuffer = state.buffer.slice(openIdx + fullTag.length);
      state.buffer = state.buffer.slice(0, openIdx);
      state.isInsideDetailsBlock = true;
    }
  }
}

export function hasIncompleteSemanticMarkers(buffer: string): boolean {
  let parenDepth = 0;
  for (const char of buffer) {
    if (char === "(") parenDepth++;
    else if (char === ")") parenDepth--;
  }
  if (parenDepth !== 0) {
    log.info(`Stream: Buffer has unbalanced parentheses (depth: ${parenDepth})`);
    return true;
  }

  const regularQuoteCount = (buffer.match(/"/g) || []).length;
  if (regularQuoteCount % 2 !== 0) {
    log.info("Stream: Buffer has unclosed quotes");
    return true;
  }

  const japOpenCount = (buffer.match(/「/g) || []).length;
  const japCloseCount = (buffer.match(/」/g) || []).length;
  if (japOpenCount !== japCloseCount) {
    log.info("Stream: Buffer has unbalanced Japanese quotes");
    return true;
  }

  const openBrackets = (buffer.match(/\[/g) || []).length;
  const closeBrackets = (buffer.match(/\]/g) || []).length;
  const openParens = (buffer.match(/\(/g) || []).length;
  const closeParens = (buffer.match(/\)/g) || []).length;

  if (openBrackets > closeBrackets || openParens > closeParens) {
    if (buffer.includes("[") && (buffer.includes("](") || buffer.endsWith("]("))) {
      log.info("Stream: Buffer might contain incomplete markdown link");
      return true;
    }
  }

  if (buffer.match(/https?:$|https?:\/$|https?:\/\/$/)) {
    log.info("Stream: Buffer ends with incomplete URL protocol");
    return true;
  }

  if (hasTrailingIncompleteMarkdownTable(buffer)) {
    log.info("Stream: Buffer ends with an incomplete markdown table");
    return true;
  }

  const THINK_OPEN = "<think>";
  for (let len = THINK_OPEN.length - 1; len >= 1; len--) {
    if (buffer.endsWith(THINK_OPEN.slice(0, len))) {
      log.info("Stream: Buffer ends with partial <think> tag prefix");
      return true;
    }
  }

  const THINK_CLOSE = "</think>";
  for (let len = THINK_CLOSE.length - 1; len >= 1; len--) {
    if (buffer.endsWith(THINK_CLOSE.slice(0, len))) {
      log.info("Stream: Buffer ends with partial </think> tag prefix");
      return true;
    }
  }

  if (/<details(?:\s[^>]*)?$/.test(buffer)) {
    log.info("Stream: Buffer ends with partial or unclosed <details> tag");
    return true;
  }

  const DETAILS_PREFIX = "<details";
  for (let len = DETAILS_PREFIX.length - 1; len >= 1; len--) {
    if (buffer.endsWith(DETAILS_PREFIX.slice(0, len))) {
      log.info("Stream: Buffer ends with partial <details> tag prefix");
      return true;
    }
  }

  return false;
}

export function autoCloseIncompleteMarkers(buffer: string): string {
  let fixedBuffer = buffer;
  const fixes: string[] = [];

  let parenDepth = 0;
  for (const char of fixedBuffer) {
    if (char === "(") parenDepth++;
    else if (char === ")") parenDepth--;
  }
  if (parenDepth > 0) {
    fixedBuffer += ")".repeat(parenDepth);
    fixes.push(`${parenDepth} closing parentheses`);
  }

  const regularQuoteCount = (fixedBuffer.match(/"/g) || []).length;
  if (regularQuoteCount % 2 !== 0) {
    fixedBuffer += '"';
    fixes.push("closing quote");
  }

  const japOpenCount = (fixedBuffer.match(/「/g) || []).length;
  const japCloseCount = (fixedBuffer.match(/」/g) || []).length;
  if (japOpenCount > japCloseCount) {
    const missingCount = japOpenCount - japCloseCount;
    fixedBuffer += "」".repeat(missingCount);
    fixes.push(`${missingCount} Japanese closing quote(s)`);
  }

  const doubleStar = (fixedBuffer.match(/\*\*/g) || []).length;
  if (doubleStar % 2 !== 0) {
    fixedBuffer += "**";
    fixes.push("markdown bold (**)");
  }

  const doubleUnderscore = (fixedBuffer.match(/__/g) || []).length;
  if (doubleUnderscore % 2 !== 0) {
    fixedBuffer += "__";
    fixes.push("markdown bold (__)");
  }

  const singleStars = (fixedBuffer.match(/(?<!\*)\*(?!\*)/g) || []).length;
  if (singleStars % 2 !== 0) {
    fixedBuffer += "*";
    fixes.push("markdown italic (*)");
  }

  const singleUnderscores = (fixedBuffer.match(/(?<!_)_(?!_)/g) || []).length;
  if (singleUnderscores % 2 !== 0) {
    fixedBuffer += "_";
    fixes.push("markdown italic (_)");
  }

  const doubleTilde = (fixedBuffer.match(/~~/g) || []).length;
  if (doubleTilde % 2 !== 0) {
    fixedBuffer += "~~";
    fixes.push("markdown strikethrough (~~)");
  }

  if (fixedBuffer.match(/\[[^\]]+\]\([^)]*$/)) {
    fixedBuffer += ")";
    fixes.push("markdown link closing parenthesis");
  } else if (fixedBuffer.match(/\[[^\]]*$/)) {
    fixedBuffer += "](#)";
    fixes.push("markdown link closing bracket and empty URL");
  }

  if (fixes.length > 0) {
    log.info(
      `Stream Auto-Close: Applied fixes - ${fixes.join(", ")} to buffer: "${buffer.substring(0, 100)}${buffer.length > 100 ? "..." : ""}"`,
    );
  }

  return fixedBuffer;
}

export function processBufferContent(state: StreamState, config: StreamConfig): ChunkProcessingResult {
  if (state.isInsideThinkBlock || state.isInsideDetailsBlock) {
    return {
      shouldFlush: false,
      updatedBuffer: state.buffer,
      newCodeBlockState: undefined,
    };
  }

  if (state.isInsideCodeBlock) {
    const closingBackticksIndex = state.buffer.indexOf("```", 3);

    if (closingBackticksIndex !== -1) {
      return {
        shouldFlush: true,
        segmentToFlush: state.buffer.substring(0, closingBackticksIndex + 3),
        updatedBuffer: state.buffer.substring(closingBackticksIndex + 3),
        newCodeBlockState: false,
        breakType: "code_close",
      };
    }

    if (state.buffer.length >= DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_CODE_BLOCK) {
      return {
        shouldFlush: true,
        segmentToFlush: state.buffer,
        updatedBuffer: "",
        newCodeBlockState: false,
        breakType: "overflow",
      };
    }

    return {
      shouldFlush: false,
      updatedBuffer: state.buffer,
      newCodeBlockState: true,
    };
  }

  const openingBackticksIndex = state.buffer.indexOf("```");
  const newlineIndex = state.buffer.indexOf("\n");
  state.hasSemanticMarkers = hasIncompleteSemanticMarkers(state.buffer);

  let periodEndIndex = -1;
  if (config.humanizerDegree === HumanizerDegree.HEAVY) {
    const sentenceRegex = createSentenceSplitRegex();
    const periodMatch = sentenceRegex.exec(state.buffer);
    if (periodMatch && !shouldDelayTrailingPeriodFlush(state.buffer, periodMatch)) {
      periodEndIndex = periodMatch.index + periodMatch[0].length;
    }
  }

  let earliestBreakIndex = -1;
  let breakType: ChunkProcessingResult["breakType"];

  if (openingBackticksIndex !== -1) {
    earliestBreakIndex = openingBackticksIndex;
    breakType = "code_open";
  }
  if (newlineIndex !== -1 && (earliestBreakIndex === -1 || newlineIndex < earliestBreakIndex)) {
    earliestBreakIndex = newlineIndex;
    breakType = "newline";
  }
  if (periodEndIndex !== -1 && (earliestBreakIndex === -1 || periodEndIndex < earliestBreakIndex)) {
    earliestBreakIndex = periodEndIndex;
    breakType = "period";
  }

  if (earliestBreakIndex === -1) {
    return {
      shouldFlush: false,
      updatedBuffer: state.buffer,
      newCodeBlockState: undefined,
    };
  }

  if (breakType === "code_open") {
    if (earliestBreakIndex > 0) {
      return {
        shouldFlush: true,
        segmentToFlush: state.buffer.substring(0, earliestBreakIndex),
        updatedBuffer: state.buffer.substring(earliestBreakIndex),
        newCodeBlockState: false,
        breakType,
      };
    }

    const closingInSegment = state.buffer.indexOf("```", 3);
    if (closingInSegment !== -1) {
      return {
        shouldFlush: true,
        segmentToFlush: state.buffer.substring(0, closingInSegment + 3),
        updatedBuffer: state.buffer.substring(closingInSegment + 3),
        newCodeBlockState: false,
        breakType: "code_close",
      };
    }

    return {
      shouldFlush: false,
      updatedBuffer: state.buffer,
      newCodeBlockState: true,
    };
  }

  if (breakType === "newline" && !state.hasSemanticMarkers) {
    const nextCharIndex = earliestBreakIndex + 1;
    if (nextCharIndex >= state.buffer.length) {
      return {
        shouldFlush: false,
        updatedBuffer: state.buffer,
        newCodeBlockState: false,
      };
    }

    let flushEndIndex = nextCharIndex;
    const punctuationCarry = state.buffer.substring(nextCharIndex).match(/^\s*(?!\.{2,})[.,!?;。！？、，]+/);
    if (punctuationCarry) {
      flushEndIndex += punctuationCarry[0].length;
    }

    const segmentToFlush = state.buffer.substring(0, flushEndIndex);
    if (!hasIncompleteSemanticMarkers(segmentToFlush)) {
      return {
        shouldFlush: true,
        segmentToFlush,
        updatedBuffer: state.buffer.substring(flushEndIndex),
        newCodeBlockState: false,
        breakType,
      };
    }
  } else if (breakType === "period" && !state.hasSemanticMarkers) {
    const segmentToFlush = state.buffer.substring(0, periodEndIndex);
    if (!hasIncompleteSemanticMarkers(segmentToFlush)) {
      return {
        shouldFlush: true,
        segmentToFlush,
        updatedBuffer: state.buffer.substring(periodEndIndex),
        newCodeBlockState: false,
        breakType,
      };
    }
  }

  return {
    shouldFlush: false,
    updatedBuffer: state.buffer,
    newCodeBlockState: undefined,
  };
}
