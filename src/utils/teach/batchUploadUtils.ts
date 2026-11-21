import type { APIAttachment } from "discord.js";
import { safeDownload } from "@/utils/security/safeDownload";

const UTF8_BOM = "\uFEFF";
const BATCH_UPLOAD_MAX_SIZE_MB = 1;

const SAMPLE_USER_PREFIX = /^(?:\{user\}|\{\{user\}\})\s*:\s*(.+)$/i;
const SAMPLE_BOT_PREFIX = /^(?:\{bot\}|\{\{char\}\})\s*:?\s*(.+)$/i;

type TxtUploadReadError = "invalid_format" | "file_too_large" | "download_failed";

export interface TxtUploadReadResult {
  isValid: boolean;
  error?: TxtUploadReadError;
  text?: string;
}

export interface NumberedLine {
  lineNumber: number;
  content: string;
}

export interface SampleDialoguePair {
  userInput: string;
  botInput: string;
}

interface SampleDialogueParseError {
  code: "odd_line_count" | "invalid_user_prefix" | "invalid_bot_prefix";
  lineNumber: number;
}

export interface SampleDialogueParseResult {
  isValid: boolean;
  pairs: SampleDialoguePair[];
  error?: SampleDialogueParseError;
}

export function getNonEmptyNumberedLines(text: string): NumberedLine[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({
      lineNumber: index + 1,
      content: line.trim(),
    }))
    .filter((line) => line.content.length > 0);
}

export function dedupeCaseInsensitive(items: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(item.trim());
  }

  return deduped;
}

export function dedupeSampleDialoguePairs(pairs: SampleDialoguePair[]): SampleDialoguePair[] {
  const deduped: SampleDialoguePair[] = [];
  const seen = new Set<string>();

  for (const pair of pairs) {
    const key = `${pair.userInput.trim().toLowerCase()}|||${pair.botInput.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      userInput: pair.userInput.trim(),
      botInput: pair.botInput.trim(),
    });
  }

  return deduped;
}

export async function readTxtUpload(attachment: APIAttachment): Promise<TxtUploadReadResult> {
  const filename = attachment.filename?.toLowerCase() ?? "";
  if (!filename.endsWith(".txt")) {
    return {
      isValid: false,
      error: "invalid_format",
    };
  }

  const downloadResult = await safeDownload(attachment.url, {
    maxSizeMB: BATCH_UPLOAD_MAX_SIZE_MB,
    timeoutMs: 10000,
    knownSize: attachment.size,
  });

  if (!downloadResult.success || !downloadResult.buffer) {
    return {
      isValid: false,
      error: downloadResult.error === "size_exceeded" ? "file_too_large" : "download_failed",
    };
  }

  let text = downloadResult.buffer.toString("utf-8");
  if (text.startsWith(UTF8_BOM)) {
    text = text.slice(1);
  }

  return {
    isValid: true,
    text,
  };
}

export function parseSampleDialogueBatch(text: string): SampleDialogueParseResult {
  const lines = getNonEmptyNumberedLines(text);

  if (lines.length % 2 !== 0) {
    const lastLine = lines[lines.length - 1];
    return {
      isValid: false,
      pairs: [],
      error: {
        code: "odd_line_count",
        lineNumber: lastLine?.lineNumber ?? 1,
      },
    };
  }

  const pairs: SampleDialoguePair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const userLine = lines[i];
    const botLine = lines[i + 1];

    const userMatch = SAMPLE_USER_PREFIX.exec(userLine.content);
    if (!userMatch) {
      return {
        isValid: false,
        pairs: [],
        error: {
          code: "invalid_user_prefix",
          lineNumber: userLine.lineNumber,
        },
      };
    }

    const botMatch = SAMPLE_BOT_PREFIX.exec(botLine.content);
    if (!botMatch) {
      return {
        isValid: false,
        pairs: [],
        error: {
          code: "invalid_bot_prefix",
          lineNumber: botLine.lineNumber,
        },
      };
    }

    pairs.push({
      userInput: userMatch[1]?.trim() ?? "",
      botInput: botMatch[1]?.trim() ?? "",
    });
  }

  return {
    isValid: true,
    pairs,
  };
}
