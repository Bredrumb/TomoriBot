import type { Client } from "discord.js";
import { getCachedUserRow, invalidateUserCache } from "@/utils/cache/userCache";
import { userRepository } from "@/utils/db/repositories";
import { backfillDocumentLexicalTextBatch } from "@/utils/documents/documentService";
import { backfillLegacyChannelScopes } from "@/utils/memory/legacyChannelScopeBackfill";
import { log } from "@/utils/misc/logger";

const BATCH_DELAY_MS = 1000;
const RETRY_DELAY_MS = 60_000;

let running = false;

async function resolveLegacyChannelScopes(client: Client): Promise<void> {
  try {
    const { scoped, unmatched, deferred } = await backfillLegacyChannelScopes((id) => client.guilds.cache.get(id));
    if (scoped + unmatched + deferred === 0) return;
    log.info(
      `Legacy channel scope backfill: ${scoped} scoped, ${unmatched} unmatched (active in every channel until an admin picks channels), ${deferred} deferred`,
    );
  } catch (error) {
    log.error("Legacy channel scope backfill failed; pending rows retry on the next boot", error as Error);
  }
}

function startDocumentLexicalBackfill(): void {
  if (running) return;
  running = true;
  let selected = 0;
  let updated = 0;
  const run = async (): Promise<void> => {
    try {
      const batch = await backfillDocumentLexicalTextBatch();
      selected += batch.selected;
      updated += batch.updated;
      log.metric("document_lexical_backfill", { selected: batch.selected, updated: batch.updated });
      if (batch.selected > 0) {
        setTimeout(() => void run(), BATCH_DELAY_MS).unref();
      } else {
        running = false;
      }
    } catch {
      log.warn("Document lexical backfill failed; pending rows will retry", undefined, {
        metadata: { selected, updated, failed: 1 },
      });
      setTimeout(() => void run(), RETRY_DELAY_MS).unref();
    }
  };
  setTimeout(() => void run(), BATCH_DELAY_MS).unref();
}

async function mergeWebhookUsers(client: Client): Promise<void> {
  const botUser = client.user;
  if (!botUser) return;
  try {
    if (!(await userRepository.hasPendingWebhookUserCleanup())) return;
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
}

export default async (client: Client): Promise<void> => {
  await resolveLegacyChannelScopes(client);
  startDocumentLexicalBackfill();
  await mergeWebhookUsers(client);
};
