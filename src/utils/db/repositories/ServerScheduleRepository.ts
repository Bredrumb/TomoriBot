/**
 * ServerScheduleRepository — manages the `reminders` and `random_triggers` tables,
 * plus the Phase 6 `server_trigger_behavior_configs` and
 * `server_auto_trigger_configs` tables.
 *
 * Split from ServerRepository in Phase 5.5e Stage C. Scheduling is cleanly
 * separable from server identity: reminders and random triggers share no tables
 * with server setup, emojis, stickers, or webhooks.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import {
  type ErrorContext,
  type RandomTriggerRow,
  randomTriggerSchema,
  type ReminderRow,
  reminderSchema,
} from "@/types/db/schema";
import { sql, withCachedPlanRetry } from "@/utils/db/client";
import { emitScheduledWorkNudge } from "@/timers/scheduledWorkSignals";
import { log } from "@/utils/misc/logger";
import type { IRepository } from "./IRepository";

// ── schedule config table row shapes ────────────────────────────────

/** Row shape for server_trigger_behavior_configs (Phase 6). */
export type ServerTriggerBehaviorConfigsRow = {
  always_reply_enabled: boolean;
  deliberate_trigger_mode: boolean;
  cooldown_type: number;
  cooldown_length: number;
};

/** Row shape for server_auto_trigger_configs (Phase 6, post-013 migration). */
export type ServerAutoTriggerConfigsRow = {
  autoch_disc_ids: string[];
  autoch_threshold: number;
  autoch_threshold_max: number;
};

/** Composite export shape for ServerScheduleRepository's Phase 6 tables. */
export type ServerScheduleExportShape = {
  trigger_behavior: ServerTriggerBehaviorConfigsRow | null;
  auto_trigger: ServerAutoTriggerConfigsRow | null;
};

export type ReminderSelectionRow = {
  reminder_id: number;
  reminder_purpose: string;
  reminder_time: Date;
  repetition_interval_hours: number | null;
  self_reminder: boolean | null;
  channel_disc_id: string;
  created_by_user_id: number | null;
  created_by_nickname: string | null;
  user_discord_id: string;
  user_nickname: string;
  persona_nickname: string | null;
};

/** Data shape for creating or updating a random trigger. */
interface RandomTriggerData {
  serverId: number;
  channelDiscId: string;
  personaId: number | null;
  timerHours: number;
  randomOffsetRange: number | null;
  chancePercent: number;
  silenceThresholdHours: number | null;
  respondToSelf: boolean;
  customPrompt: string | null;
  failureThreshold: number | null;
}

export class ServerScheduleRepository implements IRepository<ServerScheduleExportShape> {
  // ── reminder reads ─────────────────────────────────────────────────────────

  /** Returns all reminders that are due to fire now. */
  async getDueReminders(): Promise<ReminderRow[] | null> {
    return this.sqlGetDueReminders();
  }

  /** Returns the timestamp of the next scheduled reminder, or null if none. */
  async getNextReminderTime(): Promise<Date | null> {
    return this.sqlGetNextReminderTime();
  }

  /**
   * Loads a single reminder by ID.
   *
   * @param reminderId - Reminder DB ID
   */
  async getReminderById(reminderId: number): Promise<ReminderRow | null> {
    return this.sqlGetReminderById(reminderId);
  }

  /**
   * Returns the count of active reminders for a Discord user.
   *
   * @param userDiscordId - Discord user snowflake
   */
  async getUserReminderCount(userDiscordId: string): Promise<number> {
    return this.sqlGetUserReminderCount(userDiscordId);
  }

  /**
   * Deletes a reminder by ID.
   *
   * @param reminderId - Reminder DB ID
   */
  async deleteReminderById(reminderId: number): Promise<boolean> {
    return this.sqlDeleteReminderById(reminderId);
  }

  /**
   * Returns pending (not yet fired) reminders for a Discord user.
   *
   * @param userDiscordId - Discord user snowflake
   * @param serverDiscId  - Optional Discord server snowflake (filters to that server)
   */
  async getPendingRemindersForUser(userDiscordId: string, serverDiscId?: string): Promise<ReminderRow[] | null> {
    return this.sqlGetPendingRemindersForUser(userDiscordId, serverDiscId);
  }

  /**
   * Loads reminders for command selection lists with optional owner filtering.
   *
   * @param serverId    - Internal server DB ID
   * @param ownerUserId - If provided, only returns reminders created by this user
   */
  async loadReminderSelections(serverId: number, ownerUserId?: number): Promise<ReminderSelectionRow[]> {
    return this.sqlLoadReminderSelections(serverId, ownerUserId);
  }

  // ── reminder writes ────────────────────────────────────────────────────────

  /**
   * Creates a new reminder.
   *
   * @param reminderData - Reminder fields
   */
  async addReminder(reminderData: {
    server_id: number;
    channel_disc_id: string;
    user_discord_id: string;
    user_nickname: string;
    reminder_purpose: string;
    reminder_time: Date;
    repetition_interval_hours?: number | null;
    self_reminder?: boolean | null;
    created_by_user_id: number | null;
    persona_id?: number | null;
  }): Promise<ReminderRow | null> {
    return this.sqlAddReminder(reminderData);
  }

  /**
   * Reschedules an existing reminder to a new time.
   *
   * @param reminderId      - Reminder DB ID
   * @param nextReminderTime - New fire time
   */
  async rescheduleReminder(reminderId: number, nextReminderTime: Date): Promise<ReminderRow | null> {
    return this.sqlRescheduleReminder(reminderId, nextReminderTime);
  }

  /**
   * Updates mutable fields on an existing reminder.
   *
   * @param reminderData - Reminder fields including reminder_id
   */
  async updateReminder(reminderData: {
    reminder_id: number;
    reminder_purpose: string;
    reminder_time: Date;
    repetition_interval_hours: number | null;
    self_reminder: boolean;
    user_discord_id: string;
    user_nickname: string;
    server_id: number;
    owner_user_id?: number;
  }): Promise<ReminderRow | null> {
    return this.sqlUpdateReminder(reminderData);
  }

  // ── random trigger reads ───────────────────────────────────────────────────

  /** Returns all random triggers that are due to fire now. */
  async getDueTriggers(): Promise<RandomTriggerRow[]> {
    return this.sqlGetDueRandomTriggers();
  }

  /** Returns the timestamp of the next scheduled random trigger, or null if none. */
  async getNextTriggerTime(): Promise<Date | null> {
    return this.sqlGetNextRandomTriggerTime();
  }

  /**
   * Loads all random triggers for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async getServerTriggers(serverId: number): Promise<RandomTriggerRow[]> {
    return this.sqlGetServerRandomTriggers(serverId);
  }

  /**
   * Returns the count of random triggers configured for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async getServerTriggerCount(serverId: number): Promise<number> {
    return this.sqlGetServerRandomTriggerCount(serverId);
  }

  /**
   * Loads a single random trigger by persona and channel.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord channel snowflake
   * @param personaId      - Persona's persona_id
   */
  async getTriggerByPersonaAndChannel(
    serverId: number,
    channelDiscId: string,
    personaId: number,
  ): Promise<RandomTriggerRow | null> {
    return this.sqlGetRandomTriggerByPersonaAndChannel(serverId, channelDiscId, personaId);
  }

  // ── random trigger writes ──────────────────────────────────────────────────

  /**
   * Inserts a new random trigger.
   *
   * @param data - Trigger configuration
   */
  async insertTrigger(data: RandomTriggerData): Promise<RandomTriggerRow | null> {
    return this.sqlInsertRandomTrigger(data);
  }

  /**
   * Updates an existing random trigger by ID with new configuration data.
   *
   * @param triggerId - ID of the trigger to update
   * @param data      - New trigger configuration
   */
  async upsertTrigger(triggerId: number, data: RandomTriggerData): Promise<RandomTriggerRow | null> {
    return this.sqlUpsertRandomTrigger(triggerId, data);
  }

  /**
   * Deletes a random trigger by ID.
   *
   * @param triggerId - Trigger DB ID
   */
  async deleteTrigger(triggerId: number): Promise<boolean> {
    return this.sqlDeleteRandomTrigger(triggerId);
  }

  /**
   * Reschedules a random trigger's next fire time.
   *
   * @param triggerId            - Trigger DB ID
   * @param timerHours           - Base interval in hours
   * @param randomOffsetRange    - Optional +/- jitter range
   * @param consecutiveFailures  - Current consecutive failure count to persist
   */
  async rescheduleTrigger(
    triggerId: number,
    timerHours: number,
    randomOffsetRange: number | null,
    consecutiveFailures: number,
  ): Promise<boolean> {
    return this.sqlRescheduleRandomTrigger(triggerId, timerHours, randomOffsetRange, consecutiveFailures);
  }

  // ── private SQL: reminder reads ────────────────────────────────────────────

  private async sqlGetDueReminders(): Promise<ReminderRow[] | null> {
    return await withCachedPlanRetry(async () => {
      try {
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
          return [];
        }

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

  private async sqlGetNextReminderTime(): Promise<Date | null> {
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

  private async sqlGetReminderById(reminderId: number): Promise<ReminderRow | null> {
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

  private async sqlGetUserReminderCount(userDiscordId: string): Promise<number> {
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

  private async sqlDeleteReminderById(reminderId: number): Promise<boolean> {
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
      }

      log.warn(`No reminder found to delete with ID: ${reminderId}`);
      return false;
    } catch (error) {
      log.error(`Error deleting reminder with ID ${reminderId}:`, error);
      return false;
    }
  }

  private async sqlGetPendingRemindersForUser(
    userDiscordId: string,
    serverDiscId?: string,
  ): Promise<ReminderRow[] | null> {
    try {
      // 1. Query for pending reminders (reminder_time > now) for the user
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

  private async sqlLoadReminderSelections(serverId: number, ownerUserId?: number): Promise<ReminderSelectionRow[]> {
    try {
      if (typeof ownerUserId === "number") {
        return await sql<ReminderSelectionRow[]>`
          SELECT
            r.reminder_id,
            r.reminder_purpose,
            r.reminder_time,
            r.repetition_interval_hours,
            r.self_reminder,
            r.channel_disc_id,
            r.created_by_user_id,
            r.user_discord_id,
            r.user_nickname,
            u.user_nickname AS created_by_nickname,
            t.persona_nickname AS persona_nickname
          FROM reminders r
          LEFT JOIN users u ON r.created_by_user_id = u.user_id
          LEFT JOIN personas t ON r.persona_id = t.persona_id
          WHERE r.server_id = ${serverId}
            AND r.created_by_user_id = ${ownerUserId}
          ORDER BY r.reminder_time ASC
        `;
      }

      return await sql<ReminderSelectionRow[]>`
        SELECT
          r.reminder_id,
          r.reminder_purpose,
          r.reminder_time,
          r.repetition_interval_hours,
          r.self_reminder,
          r.channel_disc_id,
          r.created_by_user_id,
          r.user_discord_id,
          r.user_nickname,
          u.user_nickname AS created_by_nickname,
          t.persona_nickname AS persona_nickname
        FROM reminders r
        LEFT JOIN users u ON r.created_by_user_id = u.user_id
        LEFT JOIN personas t ON r.persona_id = t.persona_id
        WHERE r.server_id = ${serverId}
        ORDER BY r.reminder_time ASC
      `;
    } catch (error) {
      log.error(`Error loading reminder selections for server ${serverId}:`, error);
      return [];
    }
  }

  // ── private SQL: reminder writes ───────────────────────────────────────────

  private async sqlAddReminder(reminderData: {
    server_id: number;
    channel_disc_id: string;
    user_discord_id: string;
    user_nickname: string;
    reminder_purpose: string;
    reminder_time: Date;
    repetition_interval_hours?: number | null;
    self_reminder?: boolean | null;
    created_by_user_id: number | null;
    persona_id?: number | null;
  }): Promise<ReminderRow | null> {
    try {
      log.info(
        `Creating reminder for user ${reminderData.user_nickname} (${reminderData.user_discord_id}) ` +
          `in server ${reminderData.server_id} at ${reminderData.reminder_time.toISOString()}`,
      );

      const [reminderResult] = await sql`
        INSERT INTO reminders (
          server_id,
          channel_disc_id,
          user_discord_id,
          user_nickname,
          reminder_purpose,
          reminder_time,
          repetition_interval_hours,
          self_reminder,
          created_by_user_id,
          persona_id
        ) VALUES (
          ${reminderData.server_id},
          ${reminderData.channel_disc_id},
          ${reminderData.user_discord_id},
          ${reminderData.user_nickname},
          ${reminderData.reminder_purpose},
          ${reminderData.reminder_time},
          ${reminderData.repetition_interval_hours ?? null},
          ${reminderData.self_reminder ?? false},
          ${reminderData.created_by_user_id},
          ${reminderData.persona_id ?? null}
        )
        RETURNING *
      `;

      if (!reminderResult) {
        log.warn("Failed to create reminder: No result returned from database");
        return null;
      }

      const validatedReminder = reminderSchema.safeParse(reminderResult);

      if (!validatedReminder.success) {
        const context: ErrorContext = {
          serverId: reminderData.server_id,
          userId: reminderData.created_by_user_id,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "addReminder",
            reminderPurpose: reminderData.reminder_purpose.substring(0, 100),
            targetUser: reminderData.user_discord_id,
            validationErrors: validatedReminder.error.flatten(),
          },
        };
        await log.error(
          `Failed to validate new reminder for user ${reminderData.user_discord_id}`,
          validatedReminder.error,
          context,
        );
        return null;
      }

      log.success(
        `Reminder successfully created (ID: ${validatedReminder.data.reminder_id}) ` +
          `for ${reminderData.user_nickname} at ${reminderData.reminder_time.toISOString()}`,
      );
      emitScheduledWorkNudge(`reminder-create:${validatedReminder.data.reminder_id ?? "unknown"}`);
      return validatedReminder.data;
    } catch (error) {
      const context: ErrorContext = {
        serverId: reminderData.server_id,
        userId: reminderData.created_by_user_id,
        errorType: "DatabaseInsertError",
        metadata: {
          operation: "addReminder",
          reminderPurpose: reminderData.reminder_purpose.substring(0, 100),
          targetUser: reminderData.user_discord_id,
        },
      };
      await log.error(`Error creating reminder for user ${reminderData.user_discord_id}`, error, context);
      return null;
    }
  }

  private async sqlRescheduleReminder(reminderId: number, nextReminderTime: Date): Promise<ReminderRow | null> {
    try {
      const [updatedReminder] = await sql`
        UPDATE reminders
        SET reminder_time = ${nextReminderTime},
            updated_at = CURRENT_TIMESTAMP
        WHERE reminder_id = ${reminderId}
        RETURNING *
      `;

      if (!updatedReminder) {
        log.warn(`Failed to reschedule reminder ${reminderId} (no row returned)`);
        return null;
      }

      const validatedReminder = reminderSchema.safeParse(updatedReminder);
      if (!validatedReminder.success) {
        const context: ErrorContext = {
          errorType: "SchemaValidationError",
          metadata: {
            operation: "rescheduleReminder",
            reminderId,
            validationErrors: validatedReminder.error.flatten(),
          },
        };
        await log.error(
          `Failed to validate reminder after reschedule (ID: ${reminderId})`,
          validatedReminder.error,
          context,
        );
        return null;
      }

      log.success(`Reminder rescheduled (ID: ${reminderId}) to ${nextReminderTime.toISOString()}`);
      emitScheduledWorkNudge(`reminder-reschedule:${reminderId}`);
      return validatedReminder.data;
    } catch (error) {
      const context: ErrorContext = {
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "rescheduleReminder",
          reminderId,
          nextReminderTime: nextReminderTime.toISOString(),
        },
      };
      await log.error(`Error rescheduling reminder ${reminderId}`, error, context);
      return null;
    }
  }

  private async sqlUpdateReminder(reminderData: {
    reminder_id: number;
    reminder_purpose: string;
    reminder_time: Date;
    repetition_interval_hours: number | null;
    self_reminder: boolean;
    user_discord_id: string;
    user_nickname: string;
    server_id: number;
    owner_user_id?: number;
  }): Promise<ReminderRow | null> {
    try {
      const baseUpdate = sql`
        UPDATE reminders
        SET
          reminder_purpose = ${reminderData.reminder_purpose},
          reminder_time = ${reminderData.reminder_time},
          repetition_interval_hours = ${reminderData.repetition_interval_hours},
          self_reminder = ${reminderData.self_reminder},
          user_discord_id = ${reminderData.user_discord_id},
          user_nickname = ${reminderData.user_nickname},
          updated_at = CURRENT_TIMESTAMP
        WHERE reminder_id = ${reminderData.reminder_id}
          AND server_id = ${reminderData.server_id}
      `;

      const updateQuery =
        typeof reminderData.owner_user_id === "number"
          ? sql`${baseUpdate} AND created_by_user_id = ${reminderData.owner_user_id} RETURNING *`
          : sql`${baseUpdate} RETURNING *`;

      const [updatedReminder] = await updateQuery;
      if (!updatedReminder) {
        log.warn(`Failed to update reminder ${reminderData.reminder_id} (no row returned)`);
        return null;
      }

      const validatedReminder = reminderSchema.safeParse(updatedReminder);
      if (!validatedReminder.success) {
        const context: ErrorContext = {
          serverId: reminderData.server_id,
          userId: reminderData.owner_user_id,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "updateReminder",
            reminderId: reminderData.reminder_id,
            validationErrors: validatedReminder.error.flatten(),
          },
        };
        await log.error(
          `Failed to validate reminder after update (ID: ${reminderData.reminder_id})`,
          validatedReminder.error,
          context,
        );
        return null;
      }

      log.success(`Reminder updated (ID: ${reminderData.reminder_id}) to ${reminderData.reminder_time.toISOString()}`);
      emitScheduledWorkNudge(`reminder-update:${reminderData.reminder_id}`);
      return validatedReminder.data;
    } catch (error) {
      const context: ErrorContext = {
        serverId: reminderData.server_id,
        userId: reminderData.owner_user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateReminder",
          reminderId: reminderData.reminder_id,
        },
      };
      await log.error(`Error updating reminder ${reminderData.reminder_id}`, error, context);
      return null;
    }
  }

  // ── private SQL: random trigger reads ─────────────────────────────────────

  private async sqlGetDueRandomTriggers(): Promise<RandomTriggerRow[]> {
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

  private async sqlGetNextRandomTriggerTime(): Promise<Date | null> {
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

  private async sqlGetServerRandomTriggers(serverId: number): Promise<RandomTriggerRow[]> {
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

  private async sqlGetServerRandomTriggerCount(serverId: number): Promise<number> {
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

  private async sqlGetRandomTriggerByPersonaAndChannel(
    serverId: number,
    channelDiscId: string,
    personaId: number,
  ): Promise<RandomTriggerRow | null> {
    try {
      // 1. Find matching trigger for the specific named persona in this channel
      const [row] = await sql`
        SELECT * FROM random_triggers
        WHERE server_id = ${serverId}
          AND channel_disc_id = ${channelDiscId}
          AND persona_id = ${personaId}
        LIMIT 1
      `;

      if (!row) return null;

      // 2. Validate and return
      const parsed = randomTriggerSchema.safeParse(row);
      if (!parsed.success) {
        log.warn(`Invalid random trigger row for persona ${personaId} in channel ${channelDiscId}:`, parsed.error);
        return null;
      }
      return parsed.data;
    } catch (error) {
      log.error(
        `Error fetching random trigger for server ${serverId}, channel ${channelDiscId}, persona ${personaId}:`,
        error,
      );
      return null;
    }
  }

  // ── private SQL: random trigger writes ────────────────────────────────────

  private async sqlInsertRandomTrigger(data: RandomTriggerData): Promise<RandomTriggerRow | null> {
    try {
      // 1. Insert trigger; schedule first roll after one full timer cycle
      const [row] = await sql`
        INSERT INTO random_triggers (
          server_id,
          channel_disc_id,
          persona_id,
          timer_hours,
          random_offset_range,
          chance_percent,
          silence_threshold_hours,
          respond_to_self,
          custom_prompt,
          failure_threshold,
          consecutive_failures,
          next_trigger_at
        ) VALUES (
          ${data.serverId},
          ${data.channelDiscId},
          ${data.personaId},
          ${data.timerHours},
          ${data.randomOffsetRange},
          ${data.chancePercent},
          ${data.silenceThresholdHours},
          ${data.respondToSelf},
          ${data.customPrompt},
          ${data.failureThreshold},
          0,
          NOW() + (${data.timerHours} * INTERVAL '1 hour')
        )
        RETURNING *
      `;

      if (!row) {
        log.error("sqlInsertRandomTrigger: INSERT returned no rows");
        return null;
      }

      // 2. Validate with schema
      const parsed = randomTriggerSchema.safeParse(row);
      if (!parsed.success) {
        log.error("sqlInsertRandomTrigger: schema validation failed:", parsed.error);
        return null;
      }

      log.success(`Random trigger created (id=${parsed.data.trigger_id}) for channel ${data.channelDiscId}`);
      emitScheduledWorkNudge(`random-trigger-create:${parsed.data.trigger_id ?? "unknown"}`);
      return parsed.data;
    } catch (error) {
      const context: ErrorContext = {
        serverId: data.serverId,
        errorType: "DatabaseInsertError",
        metadata: { operation: "insertRandomTrigger", ...data },
      };
      await log.error("Error inserting random trigger", error, context);
      return null;
    }
  }

  private async sqlUpsertRandomTrigger(triggerId: number, data: RandomTriggerData): Promise<RandomTriggerRow | null> {
    try {
      // 1. Update the trigger and reschedule the next roll from now
      const [row] = await sql`
        UPDATE random_triggers SET
          timer_hours             = ${data.timerHours},
          random_offset_range     = ${data.randomOffsetRange},
          chance_percent          = ${data.chancePercent},
          silence_threshold_hours = ${data.silenceThresholdHours},
          respond_to_self         = ${data.respondToSelf},
          custom_prompt           = ${data.customPrompt},
          failure_threshold       = ${data.failureThreshold},
          consecutive_failures    = 0,
          next_trigger_at         = NOW() + (${data.timerHours} * INTERVAL '1 hour')
        WHERE trigger_id = ${triggerId}
        RETURNING *
      `;

      if (!row) {
        log.warn(`sqlUpsertRandomTrigger: no row found for trigger_id=${triggerId}`);
        return null;
      }

      // 2. Validate with schema
      const parsed = randomTriggerSchema.safeParse(row);
      if (!parsed.success) {
        log.error("sqlUpsertRandomTrigger: schema validation failed:", parsed.error);
        return null;
      }

      log.success(`Random trigger updated (id=${triggerId})`);
      emitScheduledWorkNudge(`random-trigger-update:${triggerId}`);
      return parsed.data;
    } catch (error) {
      const context: ErrorContext = {
        serverId: data.serverId,
        errorType: "DatabaseUpdateError",
        metadata: { operation: "upsertRandomTrigger", triggerId, ...data },
      };
      await log.error("Error updating random trigger", error, context);
      return null;
    }
  }

  private async sqlDeleteRandomTrigger(triggerId: number): Promise<boolean> {
    try {
      await sql`
        DELETE FROM random_triggers
        WHERE trigger_id = ${triggerId}
      `;
      log.success(`Random trigger deleted (id=${triggerId})`);
      emitScheduledWorkNudge(`random-trigger-delete:${triggerId}`);
      return true;
    } catch (error) {
      const context: ErrorContext = {
        errorType: "DatabaseDeleteError",
        metadata: { operation: "deleteRandomTrigger", triggerId },
      };
      await log.error(`Error deleting random trigger ${triggerId}`, error, context);
      return false;
    }
  }

  private async sqlRescheduleRandomTrigger(
    triggerId: number,
    timerHours: number,
    randomOffsetRange: number | null,
    consecutiveFailures: number,
  ): Promise<boolean> {
    try {
      const normalizedOffsetRange = Math.max(0, randomOffsetRange ?? 0);
      const randomOffset =
        normalizedOffsetRange > 0
          ? Math.floor(Math.random() * (normalizedOffsetRange * 2 + 1)) - normalizedOffsetRange
          : 0;
      const nextTimerHours = Math.max(1, timerHours + randomOffset);

      // 1. Advance next_trigger_at and persist the current consecutive failure count
      const [row] = await sql`
        UPDATE random_triggers
        SET next_trigger_at      = NOW() + (${nextTimerHours} * INTERVAL '1 hour'),
            consecutive_failures = ${consecutiveFailures}
        WHERE trigger_id = ${triggerId}
        RETURNING trigger_id
      `;
      if (!row) {
        log.warn(`sqlRescheduleRandomTrigger: no row found for trigger_id=${triggerId}`);
        return false;
      }
      emitScheduledWorkNudge(`random-trigger-reschedule:${triggerId}`);
      return true;
    } catch (error) {
      const context: ErrorContext = {
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "rescheduleRandomTrigger",
          triggerId,
          timerHours,
          randomOffsetRange,
          consecutiveFailures,
        },
      };
      await log.error(`Error rescheduling random trigger ${triggerId}`, error, context);
      return false;
    }
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Reads trigger-behavior and auto-trigger configs for the given server.
   *
   * @param ownerId - Discord server snowflake
   */
  async toExportShape(ownerId: string | number): Promise<ServerScheduleExportShape | null> {
    const serverDiscId = String(ownerId);
    const serverId = await this.resolveServerId(serverDiscId);
    if (!serverId) return null;

    const [triggerBehavior, autoTrigger] = await Promise.all([
      this.sqlLoadTriggerBehaviorConfigs(serverId),
      this.sqlLoadAutoTriggerConfigs(serverId),
    ]);

    if (!triggerBehavior && !autoTrigger) return null;
    return { trigger_behavior: triggerBehavior, auto_trigger: autoTrigger };
  }

  /**
   * Restores ServerScheduleRepository-owned config table rows for a server.
   *
   * @param ownerId - Discord server snowflake
   * @param data    - Previously exported ServerScheduleExportShape
   */
  async fromExportShape(ownerId: string | number, data: ServerScheduleExportShape): Promise<boolean> {
    const serverDiscId = String(ownerId);
    const serverId = await this.resolveServerId(serverDiscId);
    if (!serverId) {
      log.error(`ServerScheduleRepository.fromExportShape: server ${serverDiscId} not found`);
      return false;
    }

    try {
      const ops: Promise<void>[] = [];

      if (data.trigger_behavior) ops.push(this.sqlUpsertTriggerBehaviorConfigs(serverId, data.trigger_behavior));
      if (data.auto_trigger) ops.push(this.sqlUpsertAutoTriggerConfigs(serverId, data.auto_trigger));

      await Promise.all(ops);
      return true;
    } catch (error) {
      log.error(`ServerScheduleRepository.fromExportShape: write failed for ${serverDiscId}:`, error);
      return false;
    }
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private async resolveServerId(serverDiscId: string): Promise<number | null> {
    const [row] = await sql`
      SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId} LIMIT 1
    `;
    return (row?.server_id as number | undefined) ?? null;
  }

  // ── config table reads ───────────────────────────────────────────

  private async sqlLoadTriggerBehaviorConfigs(serverId: number): Promise<ServerTriggerBehaviorConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT always_reply_enabled, deliberate_trigger_mode, cooldown_type, cooldown_length
        FROM server_trigger_behavior_configs
        WHERE server_id = ${serverId}
      `;
      return row ? (row as unknown as ServerTriggerBehaviorConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading server_trigger_behavior_configs for server ${serverId}:`, error);
      return null;
    }
  }

  private async sqlLoadAutoTriggerConfigs(serverId: number): Promise<ServerAutoTriggerConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT autoch_disc_ids, autoch_threshold, autoch_threshold_max
        FROM server_auto_trigger_configs
        WHERE server_id = ${serverId}
      `;
      return row ? (row as unknown as ServerAutoTriggerConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading server_auto_trigger_configs for server ${serverId}:`, error);
      return null;
    }
  }

  // ── config table upserts (new tables) ────────────────────────────

  private async sqlUpsertTriggerBehaviorConfigs(serverId: number, row: ServerTriggerBehaviorConfigsRow): Promise<void> {
    await sql`
      INSERT INTO server_trigger_behavior_configs (
        server_id, always_reply_enabled, deliberate_trigger_mode, cooldown_type, cooldown_length
      ) VALUES (
        ${serverId}, ${row.always_reply_enabled}, ${row.deliberate_trigger_mode},
        ${row.cooldown_type}, ${row.cooldown_length}
      )
      ON CONFLICT (server_id) DO UPDATE SET
        always_reply_enabled    = EXCLUDED.always_reply_enabled,
        deliberate_trigger_mode = EXCLUDED.deliberate_trigger_mode,
        cooldown_type           = EXCLUDED.cooldown_type,
        cooldown_length         = EXCLUDED.cooldown_length,
        updated_at              = NOW()
    `;
  }

  private async sqlUpsertAutoTriggerConfigs(serverId: number, row: ServerAutoTriggerConfigsRow): Promise<void> {
    await sql`
      INSERT INTO server_auto_trigger_configs (
        server_id, autoch_disc_ids, autoch_threshold, autoch_threshold_max
      ) VALUES (
        ${serverId}, ${sql.array(row.autoch_disc_ids, "TEXT")},
        ${row.autoch_threshold}, ${row.autoch_threshold_max}
      )
      ON CONFLICT (server_id) DO UPDATE SET
        autoch_disc_ids      = EXCLUDED.autoch_disc_ids,
        autoch_threshold     = EXCLUDED.autoch_threshold,
        autoch_threshold_max = EXCLUDED.autoch_threshold_max,
        updated_at           = NOW()
    `;
  }
}

/** Singleton instance — import this in callers. */
export const serverScheduleRepository = new ServerScheduleRepository();
