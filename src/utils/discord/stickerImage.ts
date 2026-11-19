import { type Client, type Sticker, StickerFormatType } from "discord.js";

export interface StickerImage {
  url: string;
  mimeType: string;
  filename: string;
}

// Lottie stickers are JSON (non-raster) and GIF stickers only exist on Discord's media proxy (CDN 404s), so
// discord.js's URL builder is required.
export function stickerImage(
  rest: Client["rest"],
  sticker: Pick<Sticker, "id" | "name" | "format">,
): StickerImage | null {
  if (sticker.format === StickerFormatType.Lottie) return null;
  const extension = sticker.format === StickerFormatType.GIF ? "gif" : "png";
  return {
    url: rest.cdn.sticker(sticker.id, extension),
    mimeType: `image/${extension}`,
    filename: `${sticker.name}.${extension}`,
  };
}
