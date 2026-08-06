import { translate } from "bing-translate-api";
import type { Client, Message } from "discord.js";
import { translate as googleTranslate } from "google-translate-api-x";
import { log } from "../../utils/misc/logger";
import { sendTranslationEmbed } from "../../utils/discord/embedHelper";
import type { BingResponse, GoogleResponse } from "../../types/misc/translation";
import { TranslationProvider } from "../../types/discord/embed";

/**
 * Automatically translates Japanese messages to English using multiple providers.
 */
const handler = async (_client: Client, message: Message): Promise<void> => {
  try {
    // Skip if message has translation flag or is from a bot
    // EXPERIMENTAL FEATURE ONLY FOR TESTING
    if (
      message.content.includes("><") ||
      message.author.bot ||
      (message.guildId !== process.env.TESTSRV_ID && message.guildId !== process.env.HAVENSRV_ID) ||
      message.channelId === process.env.TESTCH_ID
    ) {
      return;
    }

    // Check for Japanese text using a native regex (matches Kanji, Hiragana, or Katakana)
    // Kanji: \u4E00-\u9FFF
    // Hiragana: \u3040-\u309F
    // Katakana: \u30A0-\u30FF
    // This ensures we only proceed if any Japanese character is present.
    if (!/[\u3040-\u30FF\u4E00-\u9FFF]/.test(message.content)) {
      return;
    }

    log.info("Japanese message detected, translating...");

    const [bingResult, googleResult] = await Promise.all([
      translate(message.content, undefined, "en") as Promise<BingResponse>,
      googleTranslate(message.content, {
        to: "en",
        forceBatch: false,
      }) as Promise<GoogleResponse>,
    ]);

    await sendTranslationEmbed(message, {
      text: message.content,
      translations: {
        [TranslationProvider.GOOGLE]: googleResult.text,
        [TranslationProvider.BING]: bingResult.translation,
      },
      initialProvider: TranslationProvider.GOOGLE,
      timeout: 90000,
    });
  } catch (_error) {
    log.error("Translation error");
  }
};

export default handler;
