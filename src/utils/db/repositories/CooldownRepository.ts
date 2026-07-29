/**
 * CooldownRepository: manages the `cooldowns` table.
 *
 * Consolidates cooldownManager.ts, messageCooldown.ts, and cooldownsCleanup.ts
 * into a single repository. Callers import the `cooldownRepository` singleton.
 *
 * Public API surface:
 *   - checkMessageTriggerCooldownWithWhitelist / setMessageTriggerCooldownWithWhitelist
 *   - checkMessageTriggerCooldown / setMessageTriggerCooldown  (Message-object overloads)
 *   - getCooldownTypeFooterKey
 *   - cleanupExpiredCooldowns / clearAllCooldowns
 */
import { PermissionFlagsBits, type GuildMember, type Message } from "discord.js";
import { sql } from "@/utils/db/client";
import { CooldownType, type AssembledServerConfig } from "@/types/db/schema";
import type { WhitelistBlockReason } from "@/types/misc/channelWhitelist";
import { getCachedWhitelistStatus } from "@/utils/cache/channelWhitelistCache";
import { log } from "@/utils/misc/logger";

export interface CooldownCheckResult {
  isOnCooldown: boolean;
  remainingSeconds: number;
  cooldownType: CooldownType;
  /** True when whitelist restrictions block this trigger */
  blockedByWhitelist?: boolean;
  /** Which whitelist rule blocked the trigger when blockedByWhitelist is true */
  whitelistBlockReason?: WhitelistBlockReason;
}

export interface CooldownsCleanupResult {
  success: boolean;
  deletedCount: number;
  error?: string;
}

export class CooldownRepository {
  /**
   * Checks whether a slash-command category cooldown is active for a user.
   *
   * @param userId   - Discord user ID
   * @param category - Slash-command category
   */
  async hasCommandCategoryCooldown(userId: string, category: string): Promise<boolean> {
    const now = Date.now();
    const [cooldown] = await sql`
      SELECT expiry_time
      FROM cooldowns
      WHERE cooldown_type = ${CooldownType.COMMAND_CATEGORY}
        AND user_disc_id = ${userId}
        AND command_category = ${category}
        AND expiry_time > ${now}
    `;
    return Boolean(cooldown);
  }

  /**
   * Returns remaining slash-command category cooldown seconds for a user.
   *
   * @param userId   - Discord user ID
   * @param category - Slash-command category
   */
  async getRemainingCommandCategoryCooldownSeconds(userId: string, category: string): Promise<number> {
    const now = Date.now();
    const [cooldown] = await sql`
      SELECT expiry_time
      FROM cooldowns
      WHERE cooldown_type = ${CooldownType.COMMAND_CATEGORY}
        AND user_disc_id = ${userId}
        AND command_category = ${category}
        AND expiry_time > ${now}
    `;

    if (!cooldown) return 0;
    return Math.ceil((Number(cooldown.expiry_time) - now) / 1000);
  }

  /**
   * Upserts a slash-command category cooldown for a user.
   *
   * @param userId     - Discord user ID
   * @param category   - Slash-command category
   * @param durationMs - Cooldown duration in milliseconds
   */
  async setCommandCategoryCooldown(userId: string, category: string, durationMs: number): Promise<void> {
    const expiryTime = Date.now() + durationMs;

    await sql`
      INSERT INTO cooldowns (
        cooldown_type,
        user_disc_id,
        command_category,
        expiry_time
      )
      VALUES (
        ${CooldownType.COMMAND_CATEGORY},
        ${userId},
        ${category},
        ${expiryTime}
      )
      ON CONFLICT (cooldown_type, COALESCE(server_disc_id, ''), COALESCE(user_disc_id, ''), COALESCE(channel_disc_id, ''), COALESCE(command_category, ''))
      DO UPDATE SET expiry_time = ${expiryTime}
    `;
  }

  /**
   * Checks if a user is exempt from cooldowns based on type and permissions.
   * Server managers are exempt from cooldown types 1-3; only STRICT_SERVER_WIDE (4) has no exemptions.
   *
   * @param member       - Guild member to check
   * @returns True if the user is exempt
   */
  isExemptFromCooldown(member: GuildMember | null, cooldownType: CooldownType): boolean {
    if (cooldownType === CooldownType.OFF || cooldownType === CooldownType.STRICT_SERVER_WIDE) {
      return false;
    }
    return Boolean(member?.permissions.has(PermissionFlagsBits.ManageGuild));
  }

  /**
   * Checks whether an active cooldown record exists for the given scope.
   * Returns fail-open (not on cooldown) if the DB query fails.
   */
  private async checkCooldownDb(
    serverId: string,
    userId: string,
    channelId: string,
    cooldownType: CooldownType,
    member: GuildMember | null = null,
  ): Promise<CooldownCheckResult> {
    if (cooldownType === CooldownType.OFF) {
      log.info(`[Cooldown Check] Cooldown type is OFF - skipping cooldown check`);
      return { isOnCooldown: false, remainingSeconds: 0, cooldownType };
    }

    const disableExemptions = process.env.DISABLE_COOLDOWN_EXEMPTIONS === "true";
    log.info(
      `[Cooldown Check] DISABLE_COOLDOWN_EXEMPTIONS = ${process.env.DISABLE_COOLDOWN_EXEMPTIONS} (parsed as: ${disableExemptions})`,
    );

    const isExempt = !disableExemptions && this.isExemptFromCooldown(member, cooldownType);
    if (isExempt) {
      log.info(
        `[Cooldown Check] User ${userId} is EXEMPT from cooldown type ${cooldownType} (has ManageGuild permission)`,
      );
      return { isOnCooldown: false, remainingSeconds: 0, cooldownType };
    }

    if (disableExemptions && member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      log.warn(`[Cooldown Check] User ${userId} WOULD BE EXEMPT but exemptions are DISABLED for testing`);
    }

    log.info(`[Cooldown Check] User ${userId} is NOT exempt - proceeding to database check`);

    const userDiscIdParam = cooldownType === CooldownType.PER_USER ? userId : null;
    const channelDiscIdParam = cooldownType === CooldownType.PER_CHANNEL ? channelId : null;

    try {
      const now = Date.now();
      log.info(
        `[Cooldown Check] Querying database - type: ${cooldownType}, server: ${serverId}, user: ${userDiscIdParam}, channel: ${channelDiscIdParam}, now: ${now}`,
      );

      const [cooldown] = await sql`
        SELECT expiry_time
        FROM cooldowns
        WHERE cooldown_type = ${cooldownType}
        AND server_disc_id = ${serverId}
        AND (${userDiscIdParam}::TEXT IS NULL OR user_disc_id = ${userDiscIdParam})
        AND (${channelDiscIdParam}::TEXT IS NULL OR channel_disc_id = ${channelDiscIdParam})
        AND expiry_time > ${now}
      `;

      if (!cooldown) {
        log.info(`[Cooldown Check] No active cooldown found for type ${cooldownType} in server ${serverId}`);
        return { isOnCooldown: false, remainingSeconds: 0, cooldownType };
      }

      const remainingMs = Number(cooldown.expiry_time) - now;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      log.info(
        `[Cooldown Check] FOUND active cooldown - ${remainingSeconds}s remaining (expires: ${cooldown.expiry_time})`,
      );
      return { isOnCooldown: true, remainingSeconds, cooldownType };
    } catch (error) {
      log.warn("Failed to check cooldown", {
        cooldownType,
        serverId,
        userId: userDiscIdParam,
        channelId: channelDiscIdParam,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return { isOnCooldown: false, remainingSeconds: 0, cooldownType };
    }
  }

  /**
   * Upserts a cooldown record for the given scope.
   * Logs but does not throw on failure so cooldown errors never block message handling.
   */
  private async setCooldownDb(
    serverId: string,
    userId: string,
    channelId: string,
    cooldownType: CooldownType,
    cooldownLengthSeconds: number,
  ): Promise<void> {
    if (cooldownType === CooldownType.OFF) return;

    const cooldownDurationMs = cooldownLengthSeconds * 1000;
    const expiryTime = Date.now() + cooldownDurationMs;
    const userDiscIdParam = cooldownType === CooldownType.PER_USER ? userId : null;
    const channelDiscIdParam = cooldownType === CooldownType.PER_CHANNEL ? channelId : null;

    try {
      await sql`
        INSERT INTO cooldowns (
          cooldown_type,
          server_disc_id,
          user_disc_id,
          channel_disc_id,
          expiry_time
        )
        VALUES (
          ${cooldownType},
          ${serverId},
          ${userDiscIdParam},
          ${channelDiscIdParam},
          ${expiryTime}
        )
        ON CONFLICT (cooldown_type, COALESCE(server_disc_id, ''), COALESCE(user_disc_id, ''), COALESCE(channel_disc_id, ''), COALESCE(command_category, ''))
        DO UPDATE SET expiry_time = ${expiryTime}
      `;

      log.info(
        `[Cooldown Set] Successfully set cooldown - type: ${cooldownType}, server: ${serverId}, user: ${userDiscIdParam}, channel: ${channelDiscIdParam}, expires in ${cooldownLengthSeconds}s (expiryTime: ${expiryTime})`,
      );

      // Read-back verification to confirm the write committed
      const [verification] = await sql`
        SELECT expiry_time FROM cooldowns
        WHERE cooldown_type = ${cooldownType}
        AND server_disc_id = ${serverId}
        AND (${userDiscIdParam}::TEXT IS NULL OR user_disc_id = ${userDiscIdParam})
        AND (${channelDiscIdParam}::TEXT IS NULL OR channel_disc_id = ${channelDiscIdParam})
      `;

      if (verification) {
        log.info(`[Cooldown Set] VERIFIED - Cooldown exists in database with expiry_time: ${verification.expiry_time}`);
      } else {
        log.error(`[Cooldown Set] VERIFICATION FAILED - Cooldown not found in database after insert!`);
      }
    } catch (error) {
      log.warn("Failed to set cooldown", {
        cooldownType,
        serverId,
        userId: userDiscIdParam,
        channelId: channelDiscIdParam,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Checks cooldown for message triggers with whitelist awareness.
   * Resolves effective cooldown type from channel-specific overrides before querying.
   *
   * @param serverId             - Discord server/guild ID
   * @param userId               - Discord user ID
   * @param channelId            - Discord channel ID
   * @param globalCooldownType   - Global cooldown type from config
   * @param member               - Guild member (for exemption check)
   * @param bypassWhitelistGate  - Skip whitelist block for autochat-override channels
   * @returns CooldownCheckResult with cooldown status and remaining time
   */
  async checkMessageTriggerCooldownWithWhitelist(
    serverId: string,
    userId: string,
    channelId: string,
    globalCooldownType: CooldownType,
    member: GuildMember | null = null,
    bypassWhitelistGate = false,
  ): Promise<CooldownCheckResult> {
    const memberRoleDiscIds = member ? member.roles.cache.map((role) => role.id) : undefined;
    const channel = member?.guild.channels.cache.get(channelId);
    const isThread = channel && "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
    const parentChannelId = isThread && "parent" in channel ? channel.parent?.id : undefined;

    const whitelistStatus = await getCachedWhitelistStatus(serverId, channelId, memberRoleDiscIds, parentChannelId);

    if (!whitelistStatus.isTriggerAllowed && !bypassWhitelistGate) {
      return {
        isOnCooldown: true,
        remainingSeconds: 0,
        cooldownType: CooldownType.OFF,
        blockedByWhitelist: true,
        whitelistBlockReason: whitelistStatus.blockReason,
      };
    }

    const effectiveCooldownType = whitelistStatus.hasChannelCooldownOverride
      ? (whitelistStatus.channelCooldownType ?? globalCooldownType)
      : globalCooldownType;

    if (whitelistStatus.isChannelWhitelisted) {
      if (whitelistStatus.hasChannelCooldownOverride) {
        log.info(
          `[Cooldown Check] Channel ${channelId} is whitelisted - using channel-specific cooldown type ${effectiveCooldownType}, length ${whitelistStatus.channelCooldownLength}s`,
        );
      } else {
        log.info(
          `[Cooldown Check] Channel ${channelId} is whitelisted - inheriting global cooldown type ${effectiveCooldownType}`,
        );
      }
    } else {
      log.info(
        `[Cooldown Check] Channel ${channelId} NOT whitelisted - using global cooldown type ${effectiveCooldownType}`,
      );
    }

    return this.checkCooldownDb(serverId, userId, channelId, effectiveCooldownType, member);
  }

  /**
   * Sets cooldown for message triggers with whitelist awareness.
   * Resolves effective cooldown type and length from channel-specific overrides.
   *
   * @param serverId             - Discord server/guild ID
   * @param userId               - Discord user ID
   * @param channelId            - Discord channel ID
   * @param globalCooldownType   - Global cooldown type from config
   * @param globalCooldownLength - Global cooldown length from config
   * @param member               - Guild member (for exemption context)
   */
  async setMessageTriggerCooldownWithWhitelist(
    serverId: string,
    userId: string,
    channelId: string,
    globalCooldownType: CooldownType,
    globalCooldownLength: number,
    member: GuildMember | null = null,
  ): Promise<void> {
    const memberRoleDiscIds = member ? member.roles.cache.map((role) => role.id) : undefined;
    const channel = member?.guild.channels.cache.get(channelId);
    const isThread = channel && "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
    const parentChannelId = isThread && "parent" in channel ? channel.parent?.id : undefined;

    const whitelistStatus = await getCachedWhitelistStatus(serverId, channelId, memberRoleDiscIds, parentChannelId);

    const effectiveCooldownType = whitelistStatus.hasChannelCooldownOverride
      ? (whitelistStatus.channelCooldownType ?? globalCooldownType)
      : globalCooldownType;

    const effectiveCooldownLength = whitelistStatus.hasChannelCooldownOverride
      ? (whitelistStatus.channelCooldownLength ?? globalCooldownLength)
      : globalCooldownLength;

    if (whitelistStatus.isChannelWhitelisted) {
      if (whitelistStatus.hasChannelCooldownOverride) {
        log.info(
          `[Cooldown Set] Channel ${channelId} is whitelisted - setting cooldown type ${effectiveCooldownType}, length ${effectiveCooldownLength}s`,
        );
      } else {
        log.info(
          `[Cooldown Set] Channel ${channelId} is whitelisted - inheriting global cooldown type ${effectiveCooldownType}, length ${effectiveCooldownLength}s`,
        );
      }
    }

    await this.setCooldownDb(serverId, userId, channelId, effectiveCooldownType, effectiveCooldownLength);
  }

  /**
   * Checks cooldown for a message event. Derives IDs and effective settings from
   * the Message object and AssembledServerConfig.
   *
   * @param message - The Discord message that triggered the bot
   * @param config  - The Tomori config containing cooldown settings
   */
  async checkMessageTriggerCooldown(message: Message, config: AssembledServerConfig): Promise<CooldownCheckResult> {
    const serverDiscId = message.guildId ?? message.author.id;
    const memberRoleDiscIds = message.member ? message.member.roles.cache.map((role) => role.id) : undefined;

    const isThread =
      "isThread" in message.channel && typeof message.channel.isThread === "function" && message.channel.isThread();
    const parentChannelId = isThread ? message.channel.parent?.id : undefined;

    const whitelistStatus = await getCachedWhitelistStatus(
      serverDiscId,
      message.channelId,
      memberRoleDiscIds,
      parentChannelId,
    );

    if (!whitelistStatus.isTriggerAllowed) {
      return { isOnCooldown: true, remainingSeconds: 999999, cooldownType: CooldownType.OFF };
    }

    const cooldownType = whitelistStatus.hasChannelCooldownOverride
      ? (whitelistStatus.channelCooldownType ?? config.cooldown_type ?? CooldownType.OFF)
      : (config.cooldown_type ?? CooldownType.OFF);

    if (whitelistStatus.isChannelWhitelisted) {
      if (whitelistStatus.hasChannelCooldownOverride) {
        log.info(
          `[Cooldown Check] Channel ${message.channelId} is whitelisted - using channel-specific cooldown type ${cooldownType}, length ${whitelistStatus.channelCooldownLength}s`,
        );
      } else {
        log.info(
          `[Cooldown Check] Channel ${message.channelId} is whitelisted - inheriting global cooldown type ${cooldownType}`,
        );
      }
    }

    if (cooldownType === CooldownType.OFF) {
      return { isOnCooldown: false, remainingSeconds: 0, cooldownType };
    }

    const disableExemptions = process.env.DISABLE_COOLDOWN_EXEMPTIONS === "true";
    const member = message.member;
    const isExempt = !disableExemptions && this.isExemptFromCooldown(member, cooldownType);

    if (isExempt) {
      log.info(
        `[Cooldown Check] User ${message.author.id} is EXEMPT from cooldown type ${cooldownType} (has ManageGuild permission)`,
      );
      return { isOnCooldown: false, remainingSeconds: 0, cooldownType };
    }

    if (disableExemptions && member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      log.warn(`[Cooldown Check] User ${message.author.id} WOULD BE EXEMPT but exemptions are DISABLED for testing`);
    }

    const userDiscIdParam = cooldownType === CooldownType.PER_USER ? message.author.id : null;
    const channelDiscIdParam = cooldownType === CooldownType.PER_CHANNEL ? message.channelId : null;

    try {
      const now = Date.now();
      const [cooldown] = await sql`
        SELECT expiry_time
        FROM cooldowns
        WHERE cooldown_type = ${cooldownType}
        AND server_disc_id = ${serverDiscId}
        AND (${userDiscIdParam}::TEXT IS NULL OR user_disc_id = ${userDiscIdParam})
        AND (${channelDiscIdParam}::TEXT IS NULL OR channel_disc_id = ${channelDiscIdParam})
        AND expiry_time > ${now}
      `;

      if (!cooldown) {
        return { isOnCooldown: false, remainingSeconds: 0, cooldownType };
      }

      const remainingMs = Number(cooldown.expiry_time) - now;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      log.info(
        `[Cooldown Check] FOUND active cooldown - ${remainingSeconds}s remaining (expires: ${cooldown.expiry_time})`,
      );
      return { isOnCooldown: true, remainingSeconds, cooldownType };
    } catch (error) {
      log.warn("Failed to check message trigger cooldown", {
        cooldownType,
        serverDiscId,
        userDiscId: userDiscIdParam,
        channelDiscId: channelDiscIdParam,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return { isOnCooldown: false, remainingSeconds: 0, cooldownType };
    }
  }

  /**
   * Sets cooldown after a successful message event response.
   * Derives IDs and effective settings from the Message object and AssembledServerConfig.
   *
   * @param message - The Discord message that triggered the bot
   * @param config  - The Tomori config containing cooldown settings
   */
  async setMessageTriggerCooldown(message: Message, config: AssembledServerConfig): Promise<void> {
    const serverDiscId = message.guildId ?? message.author.id;
    const memberRoleDiscIds = message.member ? message.member.roles.cache.map((role) => role.id) : undefined;

    const isThread =
      "isThread" in message.channel && typeof message.channel.isThread === "function" && message.channel.isThread();
    const parentChannelId = isThread ? message.channel.parent?.id : undefined;

    const whitelistStatus = await getCachedWhitelistStatus(
      serverDiscId,
      message.channelId,
      memberRoleDiscIds,
      parentChannelId,
    );

    const cooldownType = whitelistStatus.hasChannelCooldownOverride
      ? (whitelistStatus.channelCooldownType ?? config.cooldown_type ?? CooldownType.OFF)
      : (config.cooldown_type ?? CooldownType.OFF);

    const cooldownLengthSeconds = whitelistStatus.hasChannelCooldownOverride
      ? (whitelistStatus.channelCooldownLength ?? config.cooldown_length ?? 5)
      : (config.cooldown_length ?? 5);

    if (whitelistStatus.isChannelWhitelisted) {
      if (whitelistStatus.hasChannelCooldownOverride) {
        log.info(
          `[Cooldown Set] Channel ${message.channelId} is whitelisted - setting cooldown type ${cooldownType}, length ${cooldownLengthSeconds}s`,
        );
      } else {
        log.info(
          `[Cooldown Set] Channel ${message.channelId} is whitelisted - inheriting global cooldown type ${cooldownType}, length ${cooldownLengthSeconds}s`,
        );
      }
    }

    if (cooldownType === CooldownType.OFF) return;

    const cooldownDurationMs = cooldownLengthSeconds * 1000;
    const expiryTime = Date.now() + cooldownDurationMs;
    const userDiscIdParam = cooldownType === CooldownType.PER_USER ? message.author.id : null;
    const channelDiscIdParam = cooldownType === CooldownType.PER_CHANNEL ? message.channelId : null;

    try {
      await sql`
        INSERT INTO cooldowns (
          cooldown_type,
          server_disc_id,
          user_disc_id,
          channel_disc_id,
          expiry_time
        )
        VALUES (
          ${cooldownType},
          ${serverDiscId},
          ${userDiscIdParam},
          ${channelDiscIdParam},
          ${expiryTime}
        )
        ON CONFLICT (cooldown_type, COALESCE(server_disc_id, ''), COALESCE(user_disc_id, ''), COALESCE(channel_disc_id, ''), COALESCE(command_category, ''))
        DO UPDATE SET expiry_time = ${expiryTime}
      `;

      log.info(
        `[Cooldown Set] Successfully set cooldown - type: ${cooldownType}, server: ${serverDiscId}, user: ${userDiscIdParam}, channel: ${channelDiscIdParam}, expires in ${cooldownLengthSeconds}s (expiryTime: ${expiryTime})`,
      );

      const [verification] = await sql`
        SELECT expiry_time FROM cooldowns
        WHERE cooldown_type = ${cooldownType}
        AND server_disc_id = ${serverDiscId}
        AND (${userDiscIdParam}::TEXT IS NULL OR user_disc_id = ${userDiscIdParam})
        AND (${channelDiscIdParam}::TEXT IS NULL OR channel_disc_id = ${channelDiscIdParam})
      `;

      if (verification) {
        log.info(`[Cooldown Set] VERIFIED - Cooldown exists in database with expiry_time: ${verification.expiry_time}`);
      } else {
        log.error(`[Cooldown Set] VERIFICATION FAILED - Cooldown not found in database after insert!`);
      }
    } catch (error) {
      log.warn("Failed to set message trigger cooldown", {
        cooldownType,
        serverDiscId,
        userDiscId: userDiscIdParam,
        channelDiscId: channelDiscIdParam,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Gets the locale key for the cooldown type footer text.
   *
   * @returns The locale key for the footer text
   */
  getCooldownTypeFooterKey(cooldownType: CooldownType): string {
    switch (cooldownType) {
      case CooldownType.PER_USER:
        return "general.message_cooldown_footer_per_user";
      case CooldownType.PER_CHANNEL:
        return "general.message_cooldown_footer_per_channel";
      case CooldownType.SERVER_WIDE:
        return "general.message_cooldown_footer_server_wide";
      case CooldownType.STRICT_SERVER_WIDE:
        return "general.message_cooldown_footer_strict";
      default:
        return "general.message_cooldown_footer_per_user";
    }
  }

  /**
   * Cleans up expired cooldowns from the database via the stored PostgreSQL function.
   * Safe to call at startup and via pg_cron.
   *
   * @returns CooldownsCleanupResult with success flag and deleted count
   */
  async cleanupExpiredCooldowns(): Promise<CooldownsCleanupResult> {
    try {
      log.info("Starting cooldowns cleanup...");
      const [result] = await sql`SELECT cleanup_expired_cooldowns() as deleted_count`;
      const deletedCount = Number(result?.deleted_count || 0);

      if (deletedCount > 0) {
        log.info(`Successfully cleaned up ${deletedCount} expired cooldowns`);
      } else {
        log.info("No expired cooldowns found to clean up");
      }

      return { success: true, deletedCount };
    } catch (error) {
      log.error("Error cleaning up expired cooldowns:", error);
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Clears ALL cooldowns from the database.
   * WARNING: Destructive. use only in development or when explicitly resetting all cooldowns.
   *
   * @returns CooldownsCleanupResult with success flag and deleted count
   */
  async clearAllCooldowns(): Promise<CooldownsCleanupResult> {
    try {
      log.warn("Clearing ALL cooldowns from database...");
      const deletedRows = await sql`DELETE FROM cooldowns RETURNING *`;
      const deletedCount = deletedRows.length;
      log.warn(`Successfully cleared ${deletedCount} cooldown records from database`);
      return { success: true, deletedCount };
    } catch (error) {
      log.error("Error clearing all cooldowns:", error);
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

/** Singleton instance: import this in callers. */
export const cooldownRepository = new CooldownRepository();
