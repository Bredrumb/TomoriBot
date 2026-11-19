import type { Sticker } from "discord.js";

export const STICKER_UNUSABLE_ERROR_CODE = 50081;

// Rejections stay process-local so restarts clear restored boost tiers, and capped because nothing else prunes
// the set.
const MAX_REJECTED_STICKERS = 512;
const rejectedStickerIds = new Set<string>();

export function isStickerSendable(sticker: Pick<Sticker, "id" | "available">): boolean {
  // Partial stickers have available === null ("unknown"), so only explicit false means Discord marked the sticker
  // unusable.
  return sticker.available !== false && !rejectedStickerIds.has(sticker.id);
}

// Unusable or deleted guild stickers linger in Discord's cache, so recording send rejections keeps enumeration sites
// from re-offering them to the model.
export function markStickerRejected(stickerId: string): void {
  if (rejectedStickerIds.has(stickerId)) return;

  if (rejectedStickerIds.size >= MAX_REJECTED_STICKERS) {
    const oldest = rejectedStickerIds.values().next();
    if (!oldest.done) rejectedStickerIds.delete(oldest.value);
  }

  rejectedStickerIds.add(stickerId);
}

export function isStickerUnusableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === STICKER_UNUSABLE_ERROR_CODE
  );
}

export function clearRejectedStickers(): void {
  rejectedStickerIds.clear();
}
