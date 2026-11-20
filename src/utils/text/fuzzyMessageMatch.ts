import type { Collection, Message } from "discord.js";

/** Discord snowflakes are 17 to 20 digits; anything else is a name or an opaque key. */
export const DISCORD_ID_PATTERN = /^\d{17,20}$/;

/**
 * How far a candidate may sit from the requested id and still count as it. Discord
 * snowflakes are time-ordered, so an id one off from a real message is the model retyping
 * a digit rather than naming a different message.
 */
export const MAX_FUZZY_DISTANCE = 1000n;

/**
 * Find the nearest message when the model retyped a message id with a small typo.
 *
 * The nearest candidate wins only when it is strictly closer than the current best and not
 * the requested id itself, so an exact hit is never replaced by a neighbour.
 *
 * A candidate that cannot be read as a snowflake abandons the search rather than being
 * skipped, matching the fail-closed behaviour of the per-site loops this replaced. Discord
 * only ever hands out snowflake ids, so the case is unreachable in practice and either
 * answer is a miss for a model that already named an unreadable id.
 *
 * @returns The closest match and its distance, or null when nothing is close enough.
 */
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
