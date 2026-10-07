import type { StreamResult } from "@/types/provider/interfaces";

/** Normalized public prose and its original presentation, held until the turn chooses it. */
export interface PendingStreamResponse {
  text: string;
  deliver(abortSignal?: AbortSignal): Promise<StreamResult>;
}
