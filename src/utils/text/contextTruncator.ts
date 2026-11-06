import type { StructuredContextItem } from "@/types/misc/context";
import { ContextItemTag } from "@/types/misc/context";
import { DEFAULT_MESSAGE_FETCH_LIMIT, historyWindowStride } from "@/utils/discord/messageFetchLimit";
import {
  applyPromptLayoutInserts,
  getCacheablePrefixBoundary,
  getPromptLayoutInsert,
} from "@/utils/text/context/promptLayout";

/**
 * Estimates the input token count from a list of context items.
 *
 * Uses a 4-characters-per-token approximation applied only to text parts.
 * Image and video parts are excluded, so their token cost is absorbed by the
 * 10% safety margin in {@link truncateDialogueHistory}.
 *
 */
function estimateInputTokens(items: StructuredContextItem[]): number {
  let totalChars = 0;
  for (const item of items) {
    for (const part of item.parts) {
      if (part.type === "text") {
        totalChars += part.text.length;
      }
    }
  }
  return Math.floor(totalChars / 4);
}

/**
 * The estimated input tokens history may fill before truncation starts. The 10% margin absorbs
 * tokenizer estimation error, and `/context` draws its free space against this same figure.
 */
export function computeSafeInputBudget(contextLength: number, maxCompletionTokens: number): number {
  return Math.floor((contextLength - maxCompletionTokens) * 0.9);
}

type TruncationResult = {
  truncated: StructuredContextItem[];
  historyPairsDropped: number;
  sampleItemsDropped: number;
  totalDropped: number;
};

/** Drops oldest history exchanges in stride batches, preserving samples and the newest user request. */
export function truncateDialogueHistory(
  contextItems: StructuredContextItem[],
  contextLength: number,
  maxCompletionTokens: number,
  reservedTailItems: StructuredContextItem[] = [],
  messageFetchLimit = DEFAULT_MESSAGE_FETCH_LIMIT,
): TruncationResult {
  const safeInputBudget =
    computeSafeInputBudget(contextLength, maxCompletionTokens) - estimateInputTokens(reservedTailItems);

  const items = [...contextItems];
  let historyPairsDropped = 0;
  const sampleItemsDropped = 0;

  const findNewestDialogueUserIndex = (): number => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (
        items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY &&
        items[i].role === "user" &&
        !getPromptLayoutInsert(items[i])
      ) {
        return i;
      }
    }
    return -1;
  };

  const dropOldestDroppableHistoryExchange = (): boolean => {
    const newestDialogueUserIdx = findNewestDialogueUserIndex();
    let oldestDroppableUserIdx = -1;

    for (let i = 0; i < items.length; i++) {
      if (
        i !== newestDialogueUserIdx &&
        items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY &&
        items[i].role === "user" &&
        !getPromptLayoutInsert(items[i])
      ) {
        oldestDroppableUserIdx = i;
        break;
      }
    }

    if (oldestDroppableUserIdx === -1) {
      return false;
    }

    let followingModelIdx = -1;
    for (let i = oldestDroppableUserIdx + 1; i < items.length; i++) {
      if (i === newestDialogueUserIdx) {
        break;
      }
      if (items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY && items[i].role === "model") {
        followingModelIdx = i;
        break;
      }
    }

    if (followingModelIdx !== -1) {
      const retained = items
        .slice(oldestDroppableUserIdx, followingModelIdx + 1)
        .filter((item) => getPromptLayoutInsert(item) !== undefined);
      items.splice(oldestDroppableUserIdx, followingModelIdx - oldestDroppableUserIdx + 1, ...retained);
    } else {
      items.splice(oldestDroppableUserIdx, 1);
    }
    historyPairsDropped++;
    return true;
  };

  // Drop a full stride so later exchanges can grow without moving the retained start.
  const exchangesPerStride = historyWindowStride(messageFetchLimit) / 2;
  while (estimateInputTokens(items) > safeInputBudget) {
    let dropped = 0;
    while (dropped < exchangesPerStride && dropOldestDroppableHistoryExchange()) {
      dropped++;
    }
    if (dropped === 0) break;
  }
  if (historyPairsDropped > 0 && (getCacheablePrefixBoundary(contextItems) || contextItems.some(getPromptLayoutInsert)))
    applyPromptLayoutInserts(items, []);

  return {
    truncated: items,
    historyPairsDropped,
    sampleItemsDropped,
    totalDropped: historyPairsDropped + sampleItemsDropped,
  };
}
