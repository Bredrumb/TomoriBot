import {
  randomTriggerSchema,
  reminderSchema,
  serverEmojiSchema,
  serverStickerSchema,
  type RandomTriggerRow,
  type ReminderRow,
  type ServerEmojiRow,
  type ServerStickerRow,
} from "@/types/db/schema";
import { sql, withCachedPlanRetry } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { emitScheduledWorkNudge } from "@/timers/scheduledWorkSignals";
export async function loadServerEmojis(internalServerId: number): Promise<ServerEmojiRow[] | null> {
  try {
    const emojiRows = await sql`
			SELECT *
			FROM server_emojis
			WHERE server_id = ${internalServerId}
		`;

    if (!emojiRows || emojiRows.length === 0) {
      return null;
    }

    const parsedEmojis = serverEmojiSchema.array().safeParse(emojiRows);

    if (!parsedEmojis.success) {
      log.error(`Failed to validate emojis for server ID ${internalServerId}:`, parsedEmojis.error.flatten());
      return null;
    }

    return parsedEmojis.data;
  } catch (error) {
    log.error(`Error loading emojis for server ID ${internalServerId}:`, error);
    return null;
  }
}

/**
 * Loads all available LLM models from the database.
 * @param includeDeprecated - Whether to include deprecated models in the results (default: false).
 * @returns An array of validated LlmRow objects, or null if none found or error.
 */
export async function loadServerStickers(serverDiscId: string): Promise<ServerStickerRow[] | null> {
  try {
    // 1. Get the internal server_id from server_disc_id
    const [server] = await sql`
            SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId} LIMIT 1
        `;

    if (!server?.server_id) {
      log.warn(`Server not found in DB with Discord ID: ${serverDiscId} when trying to load stickers.`);
      return null; // Server itself not found
    }
    // biome-ignore lint/style/noNonNullAssertion: server check guarantees server_id (Rule 8)
    const serverId = server.server_id!;

    // 2. Fetch all stickers for that server_id, selecting only necessary fields
    const stickersData = await sql`
            SELECT sticker_id, server_id, sticker_disc_id, sticker_name, sticker_desc, emotion_key, format_type, is_global, created_at, updated_at
            FROM server_stickers
            WHERE server_id = ${serverId}
        `; // Rule 16: Explicit columns

    if (!stickersData) {
      // This case should ideally not happen with current bun-postgres; an empty array is more likely.
      log.warn(`Stickers data was unexpectedly null for server ID: ${serverId} (Discord ID: ${serverDiscId})`);
      return []; // Treat as no stickers found
    }
    if (stickersData.length === 0) {
      log.info(`No stickers found in DB for server ID: ${serverId} (Discord ID: ${serverDiscId})`);
      return []; // Explicitly return empty array if no stickers
    }

    // 3. Validate each sticker row (Rule 6, Rule 5 - data integrity for function calling)
    const validatedStickers: ServerStickerRow[] = [];
    for (const sticker of stickersData) {
      const parsed = serverStickerSchema.safeParse(sticker);
      if (parsed.success) {
        validatedStickers.push(parsed.data);
      } else {
        log.warn(
          `Invalid sticker data found in DB for server ${serverId}, sticker_disc_id ${sticker.sticker_disc_id}: ${JSON.stringify(sticker)}. Errors: ${parsed.error.flatten()}`,
        );
        // Optionally skip adding invalid stickers
      }
    }
    log.info(`Loaded ${validatedStickers.length} stickers for server ID ${serverId}.`);
    return validatedStickers;
  } catch (error) {
    log.error(`Error loading stickers for server Discord ID ${serverDiscId}:`, error);
    return null; // Error during DB operation
  }
}

/**
 * Loads all reminders that are due for execution (reminder_time <= current time)
 * @returns Array of due ReminderRow objects, or null if error
 */
export async function getDueReminders(): Promise<ReminderRow[] | null> {
  return await withCachedPlanRetry(async () => {
    try {
      // Query for reminders that are due (reminder_time <= now)
      const reminderData = await sql`
				SELECT * FROM reminders
				WHERE reminder_time <= CURRENT_TIMESTAMP
				ORDER BY reminder_time ASC
			`;

      if (!reminderData) {
        log.warn("Reminders data was unexpectedly null when fetching due reminders");
        return [];
      }

      if (reminderData.length === 0) {
        // log.info("No due reminders found");
        return [];
      }

      // Validate each reminder row
      const validatedReminders: ReminderRow[] = [];
      for (const reminder of reminderData) {
        const parsed = reminderSchema.safeParse(reminder);
        if (parsed.success) {
          validatedReminders.push(parsed.data);
        } else {
          log.warn(
            `Invalid reminder data found in DB for reminder_id ${reminder.reminder_id}: ${JSON.stringify(reminder)}. Errors: ${parsed.error.flatten()}`,
          );
        }
      }

      log.info(`Found ${validatedReminders.length} due reminders`);
      return validatedReminders;
    } catch (error) {
      log.error("Error loading due reminders from database:", error);
      return null;
    }
  }, "load due reminders");
}

export async function getNextReminderTime(): Promise<Date | null> {
  return await withCachedPlanRetry(async () => {
    try {
      const [result] = await sql<{ next_reminder_time: Date | string | null }[]>`
				SELECT reminder_time AS next_reminder_time
				FROM reminders
				ORDER BY reminder_time ASC
				LIMIT 1
			`;

      const nextReminderTime = result?.next_reminder_time;
      if (!nextReminderTime) {
        return null;
      }

      if (nextReminderTime instanceof Date) {
        return nextReminderTime;
      }

      const parsedReminderTime = new Date(nextReminderTime);
      return Number.isNaN(parsedReminderTime.getTime()) ? null : parsedReminderTime;
    } catch (error) {
      log.error("Error loading next reminder time from database:", error);
      return null;
    }
  }, "load next reminder time");
}

/**
 * Loads a specific reminder by its ID
 * @param reminderId - The ID of the reminder to load
 * @returns The ReminderRow object if found, null otherwise
 */
export async function getReminderById(reminderId: number): Promise<ReminderRow | null> {
  try {
    const [reminderData] = await sql`
			SELECT * FROM reminders
			WHERE reminder_id = ${reminderId}
			LIMIT 1
		`;

    if (!reminderData) {
      log.info(`Reminder not found with ID: ${reminderId}`);
      return null;
    }

    // Validate the reminder data
    const parsed = reminderSchema.safeParse(reminderData);
    if (!parsed.success) {
      log.warn(
        `Invalid reminder data found in DB for reminder_id ${reminderId}: ${JSON.stringify(reminderData)}. Errors: ${parsed.error.flatten()}`,
      );
      return null;
    }

    log.info(`Loaded reminder with ID: ${reminderId}`);
    return parsed.data;
  } catch (error) {
    log.error(`Error loading reminder with ID ${reminderId}:`, error);
    return null;
  }
}

/**
 * Gets the count of active reminders for a specific user
 * @param userDiscordId - The Discord ID of the user
 * @returns The count of active reminders for the user, or 0 if error
 */
export async function getUserReminderCount(userDiscordId: string): Promise<number> {
  try {
    const [result] = await sql`
			SELECT COUNT(*) as reminder_count
			FROM reminders
			WHERE user_discord_id = ${userDiscordId}
		`;

    return Number(result?.reminder_count || 0);
  } catch (error) {
    log.error(`Error counting reminders for user ${userDiscordId}:`, error);
    return 0;
  }
}

/**
 * Deletes a reminder from the database by its ID
 * @param reminderId - The ID of the reminder to delete
 * @returns True if reminder was deleted, false otherwise
 */
export async function deleteReminderById(reminderId: number): Promise<boolean> {
  try {
    const result = await sql`
			DELETE FROM reminders
			WHERE reminder_id = ${reminderId}
			RETURNING reminder_id
		`;

    if (result && result.length > 0) {
      log.success(`Reminder deleted successfully (ID: ${reminderId})`);
      emitScheduledWorkNudge(`reminder-delete:${reminderId}`);
      return true;
    } else {
      log.warn(`No reminder found to delete with ID: ${reminderId}`);
      return false;
    }
  } catch (error) {
    log.error(`Error deleting reminder with ID ${reminderId}:`, error);
    return false;
  }
}

/**
 * Loads pending reminders for a specific user (reminders that haven't been triggered yet)
 * @param userDiscordId - The Discord ID of the user
 * @param serverDiscId - The Discord ID of the server (optional, to filter by server)
 * @returns Array of pending ReminderRow objects, or null if error
 */
export async function getPendingRemindersForUser(
  userDiscordId: string,
  serverDiscId?: string,
): Promise<ReminderRow[] | null> {
  try {
    // 1. Query for pending reminders (reminder_time > now) for the user
    // If serverDiscId is provided, filter by that server as well
    let reminderData: unknown[];
    if (serverDiscId) {
      // Join with servers table to filter by server_disc_id
      reminderData = await sql`
				SELECT r.* FROM reminders r
				JOIN servers s ON r.server_id = s.server_id
				WHERE r.user_discord_id = ${userDiscordId}
				AND s.server_disc_id = ${serverDiscId}
				AND r.reminder_time > CURRENT_TIMESTAMP
				ORDER BY r.reminder_time ASC
			`;
    } else {
      // Get all pending reminders for user across all servers
      reminderData = await sql`
				SELECT * FROM reminders
				WHERE user_discord_id = ${userDiscordId}
				AND reminder_time > CURRENT_TIMESTAMP
				ORDER BY reminder_time ASC
			`;
    }

    if (!reminderData) {
      log.warn(`Reminders data was unexpectedly null when fetching pending reminders for user ${userDiscordId}`);
      return [];
    }

    if (reminderData.length === 0) {
      return [];
    }

    // 2. Validate each reminder row
    const validatedReminders: ReminderRow[] = [];
    for (const reminder of reminderData) {
      const parsed = reminderSchema.safeParse(reminder);
      if (parsed.success) {
        validatedReminders.push(parsed.data);
      } else {
        log.warn(
          `Invalid reminder data found in DB for reminder_id ${(reminder as Record<string, unknown>).reminder_id}: ${JSON.stringify(reminder)}. Errors: ${parsed.error.flatten()}`,
        );
      }
    }

    log.info(`Found ${validatedReminders.length} pending reminders for user ${userDiscordId}`);
    return validatedReminders;
  } catch (error) {
    log.error(`Error loading pending reminders for user ${userDiscordId}:`, error);
    return null;
  }
}

/**
 * Checks if a Brave Search API key is set for the server.
 * @param serverId - The internal server ID (from servers table)
 * @returns True if Brave API key exists, false otherwise
 */
export async function getBlacklistedMemberIds(serverId: number): Promise<string[]> {
  try {
    // 1. Query personalization_blacklist table for blacklisted members
    const result = await sql`
			SELECT user_disc_id FROM personalization_blacklist
			WHERE server_id = ${serverId}
			ORDER BY user_disc_id ASC
		`;

    // 2. Extract user_disc_id values from result
    if (!result || result.length === 0) {
      return [];
    }

    // 3. Map to array of Discord IDs
    const memberIds = result.map((row: unknown) => (row as { user_disc_id: string }).user_disc_id);
    log.info(`Found ${memberIds.length} blacklisted members for server ${serverId}`);
    return memberIds;
  } catch (error) {
    log.error(`Error loading blacklisted members for server ${serverId}:`, error);
    return [];
  }
}

// ─── Random Trigger Functions ────────────────────────────────────────────────

/**
 * Fetches all random triggers whose next_trigger_at has passed (due for execution).
 * Called by the shared scheduled work coordinator when due work is processed.
 *
 * @returns Array of due RandomTriggerRow records, or empty array on error.
 */
export async function getDueRandomTriggers(): Promise<RandomTriggerRow[]> {
  try {
    // 1. Fetch all triggers scheduled at or before now
    const rows = await sql`
			SELECT * FROM random_triggers
			WHERE next_trigger_at <= NOW()
			ORDER BY next_trigger_at ASC
		`;

    if (!rows.length) return [];

    // 2. Validate and return each row
    const validated: RandomTriggerRow[] = [];
    for (const row of rows) {
      const parsed = randomTriggerSchema.safeParse(row);
      if (parsed.success) {
        validated.push(parsed.data);
      } else {
        log.warn(`Skipping invalid random trigger row (id=${row.trigger_id}):`, parsed.error);
      }
    }
    return validated;
  } catch (error) {
    log.error("Error fetching due random triggers:", error);
    return [];
  }
}

export async function getNextRandomTriggerTime(): Promise<Date | null> {
  try {
    const [result] = await sql<{ next_trigger_time: Date | string | null }[]>`
			SELECT next_trigger_at AS next_trigger_time
			FROM random_triggers
			ORDER BY next_trigger_at ASC
			LIMIT 1
		`;

    const nextTriggerTime = result?.next_trigger_time;
    if (!nextTriggerTime) {
      return null;
    }

    if (nextTriggerTime instanceof Date) {
      return nextTriggerTime;
    }

    const parsedTriggerTime = new Date(nextTriggerTime);
    return Number.isNaN(parsedTriggerTime.getTime()) ? null : parsedTriggerTime;
  } catch (error) {
    log.error("Error fetching next random trigger time:", error);
    return null;
  }
}

/**
 * Fetches all random triggers configured for a given server.
 * Used by the remove command to build the selection list.
 *
 * @param serverId - The database server_id.
 * @returns Array of RandomTriggerRow records, or empty array on error.
 */
export async function getServerRandomTriggers(serverId: number): Promise<RandomTriggerRow[]> {
  try {
    // 1. Fetch all triggers for this server ordered by creation date
    const rows = await sql`
			SELECT * FROM random_triggers
			WHERE server_id = ${serverId}
			ORDER BY created_at ASC
		`;

    if (!rows.length) return [];

    // 2. Validate and return
    const validated: RandomTriggerRow[] = [];
    for (const row of rows) {
      const parsed = randomTriggerSchema.safeParse(row);
      if (parsed.success) {
        validated.push(parsed.data);
      } else {
        log.warn(`Skipping invalid random trigger row (id=${row.trigger_id}):`, parsed.error);
      }
    }
    return validated;
  } catch (error) {
    log.error(`Error fetching random triggers for server ${serverId}:`, error);
    return [];
  }
}

/**
 * Returns the count of random triggers for a server.
 * Used to enforce the per-server cap before inserting a new trigger.
 *
 * @param serverId - The database server_id.
 * @returns The count of triggers, or 0 on error.
 */
export async function getServerRandomTriggerCount(serverId: number): Promise<number> {
  try {
    // 1. Count triggers for this server
    const [row] = await sql<Array<{ count: string | number }>>`
			SELECT COUNT(*) AS count FROM random_triggers
			WHERE server_id = ${serverId}
		`;
    return Number(row?.count ?? 0);
  } catch (error) {
    log.error(`Error counting random triggers for server ${serverId}:`, error);
    return 0;
  }
}

/**
 * Looks up an existing trigger by the (server, channel, persona) triple.
 * Used to detect override cases in the add command.
 *
 * @param serverId - The database server_id.
 * @param channelDiscId - The Discord channel ID.
 * @param tomoriId - The persona's tomori_id (non-null; Random uses INSERT always).
 * @returns The existing RandomTriggerRow, or null if not found.
 */
export async function getRandomTriggerByPersonaAndChannel(
  serverId: number,
  channelDiscId: string,
  tomoriId: number,
): Promise<RandomTriggerRow | null> {
  try {
    // 1. Find matching trigger for the specific named persona in this channel
    const [row] = await sql`
			SELECT * FROM random_triggers
			WHERE server_id = ${serverId}
			  AND channel_disc_id = ${channelDiscId}
			  AND tomori_id = ${tomoriId}
			LIMIT 1
		`;

    if (!row) return null;

    // 2. Validate and return
    const parsed = randomTriggerSchema.safeParse(row);
    if (!parsed.success) {
      log.warn(`Invalid random trigger row for persona ${tomoriId} in channel ${channelDiscId}:`, parsed.error);
      return null;
    }
    return parsed.data;
  } catch (error) {
    log.error(
      `Error fetching random trigger for server ${serverId}, channel ${channelDiscId}, persona ${tomoriId}:`,
      error,
    );
    return null;
  }
}

/**
 * Fetches the channel-level LLM override for a specific server channel.
 * Returns null if no override is configured.
 *
 * @param serverId - Database server ID (integer)
 * @param channelDiscId - Discord channel ID (snowflake string)
 * @returns Resolved LlmRow for the override, or null if not set
 */
