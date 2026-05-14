/**
 * ServerRepository — manages servers, whitelists, reminders, random triggers,
 * emojis/stickers, and the personalization blacklist.
 *
 * Also owns the atomic setupServer transaction (creates server + tomori rows).
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import type { Guild } from "discord.js";
import type {
  ServerEmojiRow,
  ServerStickerRow,
  ReminderRow,
  RandomTriggerRow,
  SetupConfig,
  SetupResult,
} from "@/types/db/schema";
import {
  loadServerEmojis,
  loadServerStickers,
  getBlacklistedMemberIds,
  getDueReminders,
  getNextReminderTime,
  getReminderById,
  getUserReminderCount,
  deleteReminderById,
  getPendingRemindersForUser,
  getDueRandomTriggers,
  getNextRandomTriggerTime,
  getServerRandomTriggers,
  getServerRandomTriggerCount,
  getRandomTriggerByPersonaAndChannel,
} from "@/utils/db/repositories/serverReadSql";
import { getBraveApiKeyStatus } from "@/utils/db/repositories/toolReadSql";
import { isBlacklisted } from "@/utils/db/repositories/userReadSql";
import {
  setupServer,
  addReminder,
  rescheduleReminder,
  updateReminder,
  insertRandomTrigger,
  upsertRandomTrigger,
  deleteRandomTrigger,
  rescheduleRandomTrigger,
} from "@/utils/db/repositories/serverWriteSql";
import {
  checkChannelWhitelist,
  upsertChannelWhitelist,
  removeChannelWhitelist,
  getAllWhitelistChannels,
} from "@/utils/db/channelWhitelist";
import {
  replacePersonaWhitelistChannels,
  removeChannelPersonaWhitelist,
  getPersonaWhitelistChannels,
  getAllWhitelistPersonas,
  isPersonaAllowedByWhitelistStatus,
  filterPersonasByWhitelist,
} from "@/utils/db/personaWhitelist";
import {
  upsertRoleWhitelist,
  removeRoleWhitelist,
  getAllWhitelistRoles,
  isRoleWhitelisted,
} from "@/utils/db/roleWhitelist";
import type { IRepository } from "./IRepository";

/** Portable server export shape (expanded in Phase 6 #16.7). */
export type ServerExportShape = {
  server_disc_id: string;
};

/** RandomTriggerData mirrors the trigger write helper input. */
type RandomTriggerData = Parameters<typeof insertRandomTrigger>[0];

export class ServerRepository implements IRepository<ServerExportShape> {
  // ── server setup ───────────────────────────────────────────────────────────

  /**
   * Atomically sets up a new server: creates server, tomori, config, and emoji rows.
   *
   * @param guild  - Discord Guild (null for DM contexts)
   * @param config - Setup configuration
   */
  async setup(guild: Guild | null, config: SetupConfig): Promise<SetupResult> {
    return setupServer(guild, config);
  }

  // ── emoji / sticker reads ──────────────────────────────────────────────────

  /**
   * Loads all synced server emojis by internal server ID.
   *
   * @param internalServerId - Internal server DB ID
   */
  async loadEmojis(internalServerId: number): Promise<ServerEmojiRow[] | null> {
    return loadServerEmojis(internalServerId);
  }

  /**
   * Loads all synced server stickers by Discord server snowflake.
   *
   * @param serverDiscId - Discord server snowflake
   */
  async loadStickers(serverDiscId: string): Promise<ServerStickerRow[] | null> {
    return loadServerStickers(serverDiscId);
  }

  // ── blacklist ──────────────────────────────────────────────────────────────

  /**
   * Returns true if the user is blacklisted from the given server.
   *
   * @param serverDiscId - Discord server snowflake
   * @param userDiscId   - Discord user snowflake
   */
  async isBlacklisted(serverDiscId: string, userDiscId: string): Promise<boolean> {
    return isBlacklisted(serverDiscId, userDiscId);
  }

  /**
   * Returns all blacklisted user Discord IDs for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async getBlacklistedMemberIds(serverId: number): Promise<string[]> {
    return getBlacklistedMemberIds(serverId);
  }

  // ── reminders ─────────────────────────────────────────────────────────────

  /** Returns all reminders that are due to fire now. */
  async getDueReminders(): Promise<ReminderRow[] | null> {
    return getDueReminders();
  }

  /** Returns the timestamp of the next scheduled reminder, or null if none. */
  async getNextReminderTime(): Promise<Date | null> {
    return getNextReminderTime();
  }

  /**
   * Loads a single reminder by ID.
   *
   * @param reminderId - Reminder DB ID
   */
  async getReminderById(reminderId: number): Promise<ReminderRow | null> {
    return getReminderById(reminderId);
  }

  /**
   * Returns the count of active reminders for a Discord user.
   *
   * @param userDiscordId - Discord user snowflake
   */
  async getUserReminderCount(userDiscordId: string): Promise<number> {
    return getUserReminderCount(userDiscordId);
  }

  /**
   * Deletes a reminder by ID.
   *
   * @param reminderId - Reminder DB ID
   */
  async deleteReminderById(reminderId: number): Promise<boolean> {
    return deleteReminderById(reminderId);
  }

  /**
   * Returns pending (not yet fired) reminders for a Discord user.
   *
   * @param args - Forwarded to underlying getPendingRemindersForUser
   */
  async getPendingRemindersForUser(
    ...args: Parameters<typeof getPendingRemindersForUser>
  ): Promise<ReminderRow[] | null> {
    return getPendingRemindersForUser(...args);
  }

  /**
   * Creates a new reminder.
   *
   * @param reminderData - Reminder fields
   */
  async addReminder(reminderData: Parameters<typeof addReminder>[0]): Promise<ReminderRow | null> {
    return addReminder(reminderData);
  }

  /**
   * Reschedules an existing reminder to a new time.
   *
   * @param reminderId      - Reminder DB ID
   * @param nextReminderTime - New fire time
   */
  async rescheduleReminder(reminderId: number, nextReminderTime: Date): Promise<ReminderRow | null> {
    return rescheduleReminder(reminderId, nextReminderTime);
  }

  /**
   * Updates mutable fields on an existing reminder.
   *
   * @param reminderData - Reminder fields including reminder_id
   */
  async updateReminder(reminderData: Parameters<typeof updateReminder>[0]): Promise<ReminderRow | null> {
    return updateReminder(reminderData);
  }

  // ── random triggers ────────────────────────────────────────────────────────

  /** Returns all random triggers that are due to fire now. */
  async getDueTriggers(): Promise<RandomTriggerRow[]> {
    return getDueRandomTriggers();
  }

  /** Returns the timestamp of the next scheduled random trigger, or null if none. */
  async getNextTriggerTime(): Promise<Date | null> {
    return getNextRandomTriggerTime();
  }

  /**
   * Loads all random triggers for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async getServerTriggers(serverId: number): Promise<RandomTriggerRow[]> {
    return getServerRandomTriggers(serverId);
  }

  /**
   * Returns the count of random triggers configured for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async getServerTriggerCount(serverId: number): Promise<number> {
    return getServerRandomTriggerCount(serverId);
  }

  /**
   * Loads a single random trigger by persona and channel.
   *
   * @param args - Forwarded to underlying getRandomTriggerByPersonaAndChannel
   */
  async getTriggerByPersonaAndChannel(
    ...args: Parameters<typeof getRandomTriggerByPersonaAndChannel>
  ): Promise<RandomTriggerRow | null> {
    return getRandomTriggerByPersonaAndChannel(...args);
  }

  /**
   * Inserts a new random trigger.
   *
   * @param data - Trigger configuration
   */
  async insertTrigger(data: RandomTriggerData): Promise<RandomTriggerRow | null> {
    return insertRandomTrigger(data);
  }

  /**
   * Updates an existing random trigger by ID with new configuration data.
   *
   * @param triggerId - ID of the trigger to update
   * @param data      - New trigger configuration
   */
  async upsertTrigger(triggerId: number, data: RandomTriggerData): Promise<RandomTriggerRow | null> {
    return upsertRandomTrigger(triggerId, data);
  }

  /**
   * Deletes a random trigger by ID.
   *
   * @param triggerId - Trigger DB ID
   */
  async deleteTrigger(triggerId: number): Promise<boolean> {
    return deleteRandomTrigger(triggerId);
  }

  /**
   * Reschedules a random trigger's next fire time.
   *
   * @param args - Forwarded to underlying rescheduleRandomTrigger
   */
  async rescheduleTrigger(
    ...args: Parameters<typeof rescheduleRandomTrigger>
  ): ReturnType<typeof rescheduleRandomTrigger> {
    return rescheduleRandomTrigger(...args);
  }

  // ── Brave API key ──────────────────────────────────────────────────────────

  /**
   * Returns true if a Brave Search API key is configured for the server.
   *
   * @param serverId - Internal server DB ID
   */
  async getBraveApiKeyStatus(serverId: number): Promise<boolean> {
    return getBraveApiKeyStatus(serverId);
  }

  // ── channel whitelist ──────────────────────────────────────────────────────

  async checkChannelWhitelist(
    ...args: Parameters<typeof checkChannelWhitelist>
  ): ReturnType<typeof checkChannelWhitelist> {
    return checkChannelWhitelist(...args);
  }

  async upsertChannelWhitelist(
    ...args: Parameters<typeof upsertChannelWhitelist>
  ): ReturnType<typeof upsertChannelWhitelist> {
    return upsertChannelWhitelist(...args);
  }

  async removeChannelWhitelist(serverId: number, channelDiscId: string): Promise<boolean> {
    return removeChannelWhitelist(serverId, channelDiscId);
  }

  async getAllWhitelistChannels(
    ...args: Parameters<typeof getAllWhitelistChannels>
  ): ReturnType<typeof getAllWhitelistChannels> {
    return getAllWhitelistChannels(...args);
  }

  // ── persona whitelist ──────────────────────────────────────────────────────

  async replacePersonaWhitelistChannels(
    ...args: Parameters<typeof replacePersonaWhitelistChannels>
  ): ReturnType<typeof replacePersonaWhitelistChannels> {
    return replacePersonaWhitelistChannels(...args);
  }

  async removeChannelPersonaWhitelist(
    ...args: Parameters<typeof removeChannelPersonaWhitelist>
  ): ReturnType<typeof removeChannelPersonaWhitelist> {
    return removeChannelPersonaWhitelist(...args);
  }

  async getPersonaWhitelistChannels(
    ...args: Parameters<typeof getPersonaWhitelistChannels>
  ): ReturnType<typeof getPersonaWhitelistChannels> {
    return getPersonaWhitelistChannels(...args);
  }

  async getAllWhitelistPersonas(
    ...args: Parameters<typeof getAllWhitelistPersonas>
  ): ReturnType<typeof getAllWhitelistPersonas> {
    return getAllWhitelistPersonas(...args);
  }

  isPersonaAllowedByWhitelistStatus(
    ...args: Parameters<typeof isPersonaAllowedByWhitelistStatus>
  ): ReturnType<typeof isPersonaAllowedByWhitelistStatus> {
    return isPersonaAllowedByWhitelistStatus(...args);
  }

  filterPersonasByWhitelist<T extends { tomori_id?: number | null | undefined }>(
    personas: T[],
    whitelistStatus: Parameters<typeof filterPersonasByWhitelist>[1],
  ): T[] {
    return filterPersonasByWhitelist(personas, whitelistStatus);
  }

  // ── role whitelist ─────────────────────────────────────────────────────────

  async upsertRoleWhitelist(...args: Parameters<typeof upsertRoleWhitelist>): ReturnType<typeof upsertRoleWhitelist> {
    return upsertRoleWhitelist(...args);
  }

  async removeRoleWhitelist(serverId: number, roleDiscId: string): Promise<boolean> {
    return removeRoleWhitelist(serverId, roleDiscId);
  }

  async getAllWhitelistRoles(
    ...args: Parameters<typeof getAllWhitelistRoles>
  ): ReturnType<typeof getAllWhitelistRoles> {
    return getAllWhitelistRoles(...args);
  }

  async isRoleWhitelisted(serverId: number, roleDiscId: string): Promise<boolean> {
    return isRoleWhitelisted(serverId, roleDiscId);
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Server export is handled by ImportExportRepository (full server export).
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   *
   * @param ownerId - Discord server snowflake (unused until Phase 6)
   */
  async toExportShape(ownerId: string | number): Promise<ServerExportShape | null> {
    return { server_disc_id: String(ownerId) };
  }

  /**
   * Server import is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   */
  async fromExportShape(_ownerId: string | number, _data: ServerExportShape): Promise<boolean> {
    return false;
  }
}

/** Singleton instance — import this in callers. */
export const serverRepository = new ServerRepository();
