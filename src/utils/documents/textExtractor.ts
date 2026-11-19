import type { PdfParseReply } from "@/utils/documents/pdfParseWorker";
import { log } from "@/utils/misc/logger";
import { safeDownload } from "@/utils/security/safeDownload";
import { normalizeDocumentText } from "@/utils/documents/documentService";
import { memoryGuard } from "@/utils/security/rateLimiter";

const BINARY_MIME_PREFIXES = ["image/", "video/", "audio/"] as const;

// Blocklisted extensions reject binary files when Discord sends ambiguous MIME types such as
// application/octet-stream, so code and markup pass.
const BINARY_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tiff",
  ".tif",
  ".avif",
  ".heic",
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".webm",
  ".flv",
  ".wmv",
  ".m4v",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".aac",
  ".m4a",
  ".wma",
  ".opus",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".rar",
  ".7z",
  ".xz",
  ".zst",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".apk",
  ".ipa",
  ".pyc",
  ".class",
  ".wasm",
  ".o",
  ".a",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".dat",
  ".bin",
  ".docx",
  ".xlsx",
  ".pptx",
  ".doc",
  ".xls",
  ".ppt",
  ".odt",
  ".ods",
  ".odp",
]);

export function isExtractableDocument(contentType: string | null, filename: string): boolean {
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith(".pdf") || contentType === "application/pdf") return true;

  if (contentType && BINARY_MIME_PREFIXES.some((prefix) => contentType.startsWith(prefix))) {
    return false;
  }

  const dotIdx = lowerName.lastIndexOf(".");
  if (dotIdx !== -1 && BINARY_EXTENSIONS.has(lowerName.slice(dotIdx))) {
    return false;
  }

  // Accept everything else: any text-based MIME type (text/*) or unknown
  //    extension falls through here and will be decoded as UTF-8.
  return true;
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  contentType?: string | null,
): Promise<string> {
  const lowerName = filename.toLowerCase();
  const isPdf = contentType === "application/pdf" || lowerName.endsWith(".pdf");

  if (isPdf) return parsePdfWithDeadline(buffer, PDF_PARSE_TIMEOUT_MS);

  return buffer.toString("utf8");
}

// The size cap bounds bytes, not parse time: a crafted PDF under the cap can loop in pdf.js. An
// ordinary document parses in a few seconds, so this only stops pathological files.
const PDF_PARSE_TIMEOUT_MS = 20_000;

export class PdfParseTimeoutError extends Error {}

// Worker termination enforces the deadline instead of an in-process timeout because pdf-parse has no abort and would
// otherwise stall the event loop.
export function parsePdfWithDeadline(buffer: Buffer, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Resolved beside this source file. Tools and commands are imported from `src/` at runtime even
    // under `dist/index.js`, so this module never lands in the bundle; a static import from the
    // entry point would make this URL point into `dist/`, where no worker file is emitted.
    const worker = new Worker(new URL("./pdfParseWorker.ts", import.meta.url));
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      worker.terminate();
      settle();
    };
    const timer = setTimeout(
      () => finish(() => reject(new PdfParseTimeoutError(`PDF parse exceeded ${timeoutMs} ms`))),
      timeoutMs,
    );
    worker.onmessage = (event: MessageEvent<PdfParseReply>) => {
      const reply = event.data;
      finish(() => ("text" in reply ? resolve(reply.text) : reject(new Error(reply.error))));
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message)));
    worker.postMessage(new Uint8Array(buffer));
  });
}

export interface ExtractTextResult {
  success: boolean;
  text?: string;
  truncated: boolean;
  originalLength?: number;
  error?: "size_exceeded" | "extraction_failed" | "memory_pressure" | "timeout" | "download_failed" | "empty_document";
}

export async function extractTextFromUrl(
  url: string,
  filename: string,
  contentType: string | null,
  options: {
    maxSizeBytes: number;
    maxTextLength: number;
    knownSize?: number;
    timeoutMs?: number;
  },
): Promise<ExtractTextResult> {
  const memCheck = memoryGuard.checkMemory();
  if (memCheck.status === "warning" || memCheck.status === "critical") {
    log.warn(`textExtractor: Blocked extraction due to memory pressure (${memCheck.status})`);
    return { success: false, truncated: false, error: "memory_pressure" };
  }

  // Download the file with size and timeout protections
  const maxSizeMB = options.maxSizeBytes / (1024 * 1024);
  const downloadResult = await safeDownload(url, {
    maxSizeMB,
    timeoutMs: options.timeoutMs ?? 15000,
    knownSize: options.knownSize,
  });

  if (!downloadResult.success || !downloadResult.buffer) {
    const errorType =
      downloadResult.error === "size_exceeded"
        ? "size_exceeded"
        : downloadResult.error === "timeout"
          ? "timeout"
          : "download_failed";
    log.warn(`textExtractor: Download failed for ${filename}: ${downloadResult.error} - ${downloadResult.details}`);
    return { success: false, truncated: false, error: errorType };
  }

  let rawText: string;
  try {
    rawText = await extractTextFromBuffer(downloadResult.buffer, filename, contentType);
  } catch (error) {
    log.error(`textExtractor: Failed to extract text from ${filename}`, error as Error);
    return { success: false, truncated: false, error: "extraction_failed" };
  }

  const normalizedText = normalizeDocumentText(rawText);

  if (!normalizedText || normalizedText.trim().length === 0) {
    return { success: false, truncated: false, error: "empty_document" };
  }

  const truncated = normalizedText.length > options.maxTextLength;
  const finalText = truncated ? normalizedText.slice(0, options.maxTextLength) : normalizedText;

  return {
    success: true,
    text: finalText,
    truncated,
    originalLength: truncated ? normalizedText.length : undefined,
  };
}
