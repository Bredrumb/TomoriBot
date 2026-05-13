import type { AnyThreadChannel, BaseGuildTextChannel, Client, Message } from "discord.js";
import type { WebhookCreateErrorReason } from "@/utils/discord/webhookManager";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode } from "@/utils/misc/logger";
import { log } from "@/utils/misc/logger";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";

const WEBHOOK_ERROR_COOLDOWN_MS = parseIntegerEnvFlag(process.env.WEBHOOK_ERROR_COOLDOWN_MS, 600000, 1000);
const webhookErrorCooldowns = new Map<string, number>();

function parseIntegerEnvFlag(value: string | undefined, defaultValue: number, minimum: number): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(parsed, minimum);
}

function shouldSendWebhookError(channelId: string): boolean {
  const now = Date.now();
  const lastSent = webhookErrorCooldowns.get(channelId) ?? 0;

  if (now - lastSent < WEBHOOK_ERROR_COOLDOWN_MS) {
    return false;
  }

  webhookErrorCooldowns.set(channelId, now);
  return true;
}

export async function sendWebhookErrorEmbed(
  channel: BaseGuildTextChannel | AnyThreadChannel,
  locale: string,
  reason: WebhookCreateErrorReason,
): Promise<void> {
  if (!shouldSendWebhookError(channel.id)) {
    return;
  }

  const titleKey =
    reason === "missing_permissions"
      ? "general.errors.webhook_missing_permissions_title"
      : reason === "max_webhooks"
        ? "general.errors.webhook_limit_title"
        : "general.errors.webhook_unknown_error_title";
  const descriptionKey =
    reason === "missing_permissions"
      ? "general.errors.webhook_missing_permissions_description"
      : reason === "max_webhooks"
        ? "general.errors.webhook_limit_description"
        : "general.errors.webhook_unknown_error_description";

  await sendStandardEmbed(channel, locale, {
    color: ColorCode.WARN,
    titleKey,
    descriptionKey,
  });
}

export function createChatResponseSink(context: ChatTurnContext): ChatResponseSink {
  return {
    async emitStreamResult() {
      return;
    },
    async emitError(error: unknown) {
      log.warn(`Chat response sink observed an error for message ${context.message.id}`, error);
    },
    async finalize(_result: GenerationTurnResult) {
      return;
    },
  };
}

export async function handleStopResponse(originalStopMessage: Message, client: Client): Promise<void> {
  try {
    log.info(
      `Generating stop response for message ${originalStopMessage.id} in channel ${originalStopMessage.channel.id}`,
    );

    const { default: tomoriChat } = await import("@/events/messageCreate/tomoriChat");
    await tomoriChat(client, originalStopMessage, true, true, false, undefined, undefined, true, 0, false);
  } catch (error) {
    log.error("Failed to handle stop response:", error);
  }
}
