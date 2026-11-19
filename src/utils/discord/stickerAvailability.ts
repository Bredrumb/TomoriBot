import type { Sticker } from "discord.js";

export const STICKER_UNUSABLE_ERROR_CODE = 50081;

// Rejections are process-local on purpose: a restart refetches every guild's stickers, which is
// also the moment a restored boost tier should get a clean slate. Capped because the bot runs
// long uptimes on a memory-constrained host and nothing else ever prunes this set.
const MAX_REJECTED_STICKERS = 512;
const rejectedStickerIds = new Set<string>();

export function isStickerSendable(sticker: Pick<Sticker, "id" | "available">): boolean {
  // `available` is null on a partial sticker, which means "unknown", not "locked": only an
  // explicit false is Discord reporting the slot as unusable, so narrowing this to `=== true`
  // would silently suppress every sticker the bot has not fully fetched.
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
