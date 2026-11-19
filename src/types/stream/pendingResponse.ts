import type { StreamResult } from "@/types/provider/interfaces";

// Shared across tool-loop passes rather than reset per stream, so held-prose caps apply to the entire turn.
export interface PendingResponseLimit {
  maxBytes: number;
  maxSegments: number;
}

// Truncation reasons: the first two mirror ordinary streaming send caps, while `retention_limit` is the fixed
// held-text ceiling.
export type PendingResponseTruncation = "send_message_limit" | "flush_limit" | "retention_limit";

export interface PendingStreamResponse {
  text: string;
  // Counts UTF-8 bytes of the raw replay segments rather than `text`, because this enforces the turn's retention
  // ceiling.
  retainedBytes: number;
  segments: number;
  truncation?: PendingResponseTruncation;
  deliver(abortSignal?: AbortSignal): Promise<StreamResult>;
}
