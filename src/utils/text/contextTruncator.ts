import type { StructuredContextItem } from "@/types/misc/context";
import { ContextItemTag } from "@/types/misc/context";
import { DEFAULT_MESSAGE_FETCH_LIMIT, historyWindowStride } from "@/utils/discord/messageFetchLimit";
import {
  applyPromptLayoutInserts,
  getCacheablePrefixBoundary,
  getPromptLayoutInsert,
} from "@/utils/text/context/promptLayout";

// Text parts use a 4 chars per token estimate and omit media, because the 10% margin in `truncateDialogueHistory`
// absorbs image and video cost.
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

// The 0.9 multiplier reserves a 10% margin for tokenizer estimation error, because `/context` also derives its
// free-space figure from this budget.
export function computeSafeInputBudget(contextLength: number, maxCompletionTokens: number): number {
  return Math.floor((contextLength - maxCompletionTokens) * 0.9);
}

export interface ContextTruncationReport {
  historyPairsDropped: number;
  transcriptTrimmed: boolean;
  inputTokensBefore: number;
  inputTokensAfter: number;
  inputBudget: number;
}

type TruncationResult = {
  truncated: StructuredContextItem[];
  report: ContextTruncationReport;
  sampleItemsDropped: number;
  totalDropped: number;
};

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
  const inputTokensBefore = estimateInputTokens(items);
  let inputTokensAfter = inputTokensBefore;
  let historyPairsDropped = 0;
  const sampleItemsDropped = 0;
  let transcriptTrimmed = false;

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
  while (inputTokensAfter > safeInputBudget) {
    let dropped = 0;
    while (dropped < exchangesPerStride && dropOldestDroppableHistoryExchange()) {
      dropped++;
    }
    if (dropped === 0) break;
    inputTokensAfter = estimateInputTokens(items);
  }
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item.boomerangTranscript) continue;
    const otherChars = items.reduce(
      (sum, entry, entryIndex) =>
        sum +
        (entryIndex === index
          ? 0
          : entry.parts.reduce((count, part) => count + (part.type === "text" ? part.text.length : 0), 0)),
      0,
    );
    const availableChars = Math.max(0, safeInputBudget * 4 - otherChars);
    const text = item.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
    if (text.length > availableChars) {
      transcriptTrimmed = true;
      items[index] = {
        ...item,
        parts: [{ type: "text", text: availableChars > 0 ? text.slice(-availableChars) : "" }],
      };
    }
  }
  const repositionInserts =
    historyPairsDropped > 0 && (getCacheablePrefixBoundary(contextItems) || contextItems.some(getPromptLayoutInsert));
  if (repositionInserts) {
    applyPromptLayoutInserts(items, []);
  }

  return {
    truncated: items,
    report: {
      historyPairsDropped,
      transcriptTrimmed,
      inputTokensBefore,
      inputTokensAfter: transcriptTrimmed || repositionInserts ? estimateInputTokens(items) : inputTokensAfter,
      inputBudget: safeInputBudget,
    },
    sampleItemsDropped,
    totalDropped: historyPairsDropped + sampleItemsDropped,
  };
}
