import type { Collection, Message } from "discord.js";

// Bound to 17 to 20 digits because Discord snowflakes fall in that length range, separating them from names and
// opaque keys.
export const DISCORD_ID_PATTERN = /^\d{17,20}$/;

// Small numeric distance catches a model mistyping a digit rather than naming another message, because Discord
// snowflakes are time-ordered.
export const MAX_FUZZY_DISTANCE = 1000n;

// Unparseable snowflake candidates abort the search instead of skipping, preserving fail-closed behavior since
// Discord only issues snowflakes.
export function findFuzzyMessageMatch(
  messages: Collection<string, Message>,
  requestedId: string,
): { message: Message; diff: bigint } | null {
  try {
    const requestedBigInt = BigInt(requestedId);
    let bestMatch: Message | undefined;
    let bestDiff = MAX_FUZZY_DISTANCE;

    for (const [candidateId, candidateMessage] of messages) {
      const candidateBigInt = BigInt(candidateId);
      const diff =
        requestedBigInt > candidateBigInt ? requestedBigInt - candidateBigInt : candidateBigInt - requestedBigInt;
      if (diff > 0n && diff < bestDiff) {
        bestDiff = diff;
        bestMatch = candidateMessage;
      }
    }

    return bestMatch ? { message: bestMatch, diff: bestDiff } : null;
  } catch {
    return null;
  }
}
