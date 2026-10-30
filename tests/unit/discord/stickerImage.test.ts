import { describe, expect, it } from "bun:test";
import { REST, StickerFormatType } from "discord.js";
import { stickerImage } from "@/utils/discord/stickerImage";

const rest = new REST();
const sticker = (format: StickerFormatType) => ({ id: "1564436323337773098", name: "wave", format });

describe("stickerImage", () => {
  it("serves GIF stickers from the media proxy, where the CDN answers 404", () => {
    expect(stickerImage(rest, sticker(StickerFormatType.GIF))).toEqual({
      url: "https://media.discordapp.net/stickers/1564436323337773098.gif",
      mimeType: "image/gif",
      filename: "wave.gif",
    });
  });

  it.each([StickerFormatType.PNG, StickerFormatType.APNG])("serves format %p as a CDN PNG", (format) => {
    expect(stickerImage(rest, sticker(format))).toEqual({
      url: "https://cdn.discordapp.com/stickers/1564436323337773098.png",
      mimeType: "image/png",
      filename: "wave.png",
    });
  });

  it("has no image for a Lottie sticker", () => {
    expect(stickerImage(rest, sticker(StickerFormatType.Lottie))).toBeNull();
  });
});
