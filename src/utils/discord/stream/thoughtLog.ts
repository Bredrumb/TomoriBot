import type { StreamResult, ThoughtLogEntry, ThoughtLogPayload } from "@/types/provider/interfaces";
import type { StreamState } from "@/types/stream/types";

export function appendChunkThoughts(state: StreamState, thoughts?: ThoughtLogEntry[]): void {
  if (!thoughts || thoughts.length === 0) {
    return;
  }

  for (const thought of thoughts) {
    const content = thought.content;
    if (typeof content !== "string" || content.length === 0) {
      continue;
    }

    if (thought.kind === "summary") {
      state.thoughtSummarySegments.push(content);
      continue;
    }

    state.thoughtRawSegments.push(content);
  }
}

export function buildThoughtLogPayload(
  state: StreamState,
  generationDurationMs?: number,
): ThoughtLogPayload | undefined {
  const summary = state.thoughtSummarySegments.join("").trim();
  const raw = state.thoughtRawSegments.join("").trim();
  const normalizedDurationMs =
    typeof generationDurationMs === "number" && Number.isFinite(generationDurationMs) && generationDurationMs >= 0
      ? Math.round(generationDurationMs)
      : undefined;

  if (!summary && !raw && !state.firstReplyUrl && normalizedDurationMs === undefined) {
    return undefined;
  }

  return {
    summary: summary || undefined,
    raw: raw || undefined,
    firstReplyUrl: state.firstReplyUrl,
    generationDurationMs: normalizedDurationMs,
    servingProvider: state.servingProvider,
  };
}

export function wasEmptyStreamResponse(result: StreamResult & { messageSentCount?: number }): boolean {
  if ("messageSentCount" in result && typeof result.messageSentCount === "number") {
    return result.messageSentCount === 0;
  }

  return false;
}
