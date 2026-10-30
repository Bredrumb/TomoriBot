import { type Client, type Sticker, StickerFormatType } from "discord.js";

export interface StickerImage {
  url: string;
  mimeType: string;
  filename: string;
}

/**
 * The image a vision model can read for a sticker, or null for a Lottie sticker, which is a JSON
 * animation with no raster form. The URL comes from discord.js because GIF stickers exist only on
 * the media proxy, and the CDN answers 404 for them under any extension.
 */
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
