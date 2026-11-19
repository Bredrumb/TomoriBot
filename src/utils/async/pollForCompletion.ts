import { log } from "@/utils/misc/logger";

interface PollResult<T> {
  done: boolean;
  result?: T;
  error?: string;
}

export interface PollOptions<T> {
  pollFn: () => Promise<PollResult<T>>;
  intervalMs: number;
  maxAttempts: number;
  onPoll?: (attempt: number) => void;
  logLabel?: string;
  // Local polling stops at the next wait or attempt boundary when aborted, without cancelling the remote job itself.
  abortSignal?: AbortSignal;
}

function waitForNextPoll(intervalMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollForCompletion<T>(options: PollOptions<T>): Promise<T> {
  const { pollFn, intervalMs, maxAttempts, onPoll, logLabel, abortSignal } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await waitForNextPoll(intervalMs, abortSignal);
    }
    if (abortSignal?.aborted) {
      throw new Error(`${logLabel ?? "Poll"}: polling was cancelled`);
    }

    onPoll?.(attempt);

    const pollResult = await pollFn();

    if (pollResult.done) {
      if (pollResult.error) {
        throw new Error(pollResult.error);
      }
      if (pollResult.result === undefined) {
        throw new Error(`${logLabel ?? "Poll"}: operation completed but returned no result`);
      }
      return pollResult.result;
    }

    // Log progress periodically (every 5th attempt)
    if (attempt % 5 === 0) {
      log.info(`${logLabel ?? "Poll"}: still waiting (attempt ${attempt}/${maxAttempts})`);
    }
  }

  const totalWaitSec = Math.round((maxAttempts * intervalMs) / 1000);
  throw new Error(`${logLabel ?? "Poll"}: operation timed out after ${maxAttempts} attempts (~${totalWaitSec}s)`);
}
