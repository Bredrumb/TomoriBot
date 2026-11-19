import type { CooldownType } from "@/types/db/schema";

export type WhitelistBlockReason = "channel" | "role" | "channel_and_role";

export interface WhitelistCheckResult {
  hasActiveWhitelist: boolean;

  hasActiveChannelWhitelist: boolean;

  isChannelWhitelisted: boolean;

  hasActiveRoleWhitelist: boolean;

  isRoleWhitelisted: boolean;

  hasActivePersonaWhitelist: boolean;

  // Personas restricted to specific channels somewhere in the server, so any persona omitted here can trigger in any
  // channel.
  restrictedPersonaIds?: number[];

  // Only restricted personas allowed in this channel (or parent channel for threads), since unrestricted personas are
  // omitted.
  whitelistedPersonaIds?: number[];

  isTriggerAllowed: boolean;

  blockReason?: WhitelistBlockReason;

  hasChannelCooldownOverride: boolean;

  channelCooldownType?: CooldownType;

  // Duration in seconds when `hasChannelCooldownOverride` is true: `0` disables cooldown and `1-86400` sets the wait.
  channelCooldownLength?: number;
}
