import type { Client } from "discord.js";
import { getCachedUserRow, invalidateUserCache } from "@/utils/cache/userCache";
import { userRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";

/** Folds migration 131's shared-webhook users rows into the bot account once, so a deploy needs no manual step. */
export default async (client: Client): Promise<void> => {
  const botUser = client.user;
  if (!botUser) return;
  try {
    const botRow =
      (await getCachedUserRow(botUser.id)) ?? (await userRepository.register(botUser.id, botUser.username));
    if (botRow?.user_id === undefined) throw new Error("Bot users row unavailable");

    const deletedDiscIds = await userRepository.mergeWebhookUsersIntoBot(botRow.user_id);
    if (deletedDiscIds === null) return;
    for (const discId of deletedDiscIds) invalidateUserCache(discId);
    log.info(`Webhook users cleanup: merged and deleted ${deletedDiscIds.length} row(s) into the bot account`);
  } catch (error) {
    log.error("Webhook users cleanup failed; the queue retries on the next boot", error as Error);
  }
};
